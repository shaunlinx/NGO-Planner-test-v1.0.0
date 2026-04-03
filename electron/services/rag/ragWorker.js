const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const embeddingService = require('./embedding');
const fileProcessor = require('./fileProcessor');
const EntityExtractor = require('./entityExtractor');

// Log with thread ID for debugging
const log = (msg) => {
    // console.log(`[RAG Worker] ${msg}`);
};

// Initialize with worker data
let reranker = null;
let rerankerLoading = false;

const loadReranker = async (modelBasePath) => {
    if (reranker || rerankerLoading) return;
    rerankerLoading = true;
    try {
        const { pipeline, env } = await import('@xenova/transformers');
        
        // Use provided resourcesPath or derive it
        const modelPath = modelBasePath || path.join(process.resourcesPath, 'models');
        
        if (!require('fs').existsSync(modelPath)) {
            log(`Local model path not found: ${modelPath}`);
        } else {
            log(`Using local model path: ${modelPath}`);
        }
        
        env.localModelPath = modelPath;
        env.allowRemoteModels = false; // Force local only
        
        log(`Attempting to load Reranker (BGE-Base) from ${modelPath}...`);
        
        reranker = await pipeline('text-classification', 'Xenova/bge-reranker-base', {
            quantized: true,
            local_files_only: true,
            session_options: {
                intraOpNumThreads: 1,
                interOpNumThreads: 1,
                executionMode: 'sequential',
                graphOptimizationLevel: 'all'
            }
        });
        log("Reranker (BGE-Base) loaded.");
    } catch (e) {
        log(`Failed to load Reranker: ${e.message}`);
        reranker = null;
    }
    rerankerLoading = false;
};

const initWorker = async () => {
    try {
        const { config, resourcesPath } = workerData;
        
        // Configure embedding service
        // Inject resourcesPath so embedding.js can find models
        embeddingService.configure({
            ...config,
            modelBasePath: resourcesPath
        });
        
        log(`Initialized with resourcesPath: ${resourcesPath}`);
        
        // Preload Reranker in background
        loadReranker(resourcesPath).catch(err => log("Reranker preload failed: " + err.message));

        // Notify readiness
        parentPort.postMessage({ type: 'ready' });
    } catch (e) {
        parentPort.postMessage({ type: 'error', error: e.message });
    }
};

// Handle incoming messages
parentPort.on('message', async (message) => {
    // --- QUERY (Embedding Generation) ---
    if (message.type === 'query') {
        const { text, requestId } = message;
        try {
            const vector = await embeddingService.getEmbedding(text);
            parentPort.postMessage({ type: 'query_result', requestId, success: true, vector });
        } catch (e) {
            parentPort.postMessage({ type: 'query_result', requestId, success: false, error: e.message });
        }
        return;
    }

    // --- RERANK (Cross-Encoder) ---
    if (message.type === 'rerank') {
        const { query, documents, topK, requestId } = message;
        try {
            if (!reranker) {
                // Try loading again if not ready
                await loadReranker(workerData.resourcesPath);
                if (!reranker) throw new Error("Reranker model failed to load.");
            }

            const scored = await Promise.all(documents.map(async doc => {
                try {
                    const docContent = doc.vector_text || doc.text;
                    const output = await reranker(query, { text_pair: docContent });
                    
                    let rawScore = output[0]?.score || output.score || 0;
                    // Sigmoid Normalization: 1 / (1 + e^-x)
                    let normalizedScore = 1 / (1 + Math.exp(-rawScore));
                    
                    // Apply Weight Factor
                    let finalScore = normalizedScore * (doc.weightFactor || 1.0);
                    
                    // Graph-Lite Boost (handled in worker or passed in? Let's assume passed in via doc.finalScore logic or re-apply here)
                    // Actually, let's keep it simple: return the computed score, let main process handle boost if needed?
                    // Or better, Main process already applied boost? No, Main process logic was: Rerank -> Boost.
                    // Wait, original code: Rerank -> Normalize -> Boost.
                    // So we should return the Normalized Score, and let Main process apply Boost?
                    // Or we pass `isBoosted` flag in doc.
                    
                    if (doc.isBoosted) {
                        finalScore *= 1.25;
                    }

                    finalScore = Math.min(Math.max(finalScore, 0), 1);
                    return { ...doc, finalScore };
                } catch (e) {
                    return { ...doc, finalScore: -1 };
                }
            }));

            // Sort and Slice
            scored.sort((a, b) => b.finalScore - a.finalScore);
            const results = scored.slice(0, topK || scored.length);

            parentPort.postMessage({ type: 'rerank_result', requestId, success: true, results });
        } catch (e) {
            parentPort.postMessage({ type: 'rerank_result', requestId, success: false, error: e.message });
        }
        return;
    }

    if (message.type === 'ingest') {
        const { filePath, metadata, options } = message;
        
        try {
            parentPort.postMessage({ type: 'progress', status: 'processing', filePath });
            
            // 1. Process File (Extract Text)
            // Note: fileProcessor.processFile uses embeddingService for enrichment if passed
            let { text, chunks } = await fileProcessor.processFile(filePath, {
                apiKey: embeddingService.config.apiKey,
                embeddingService: embeddingService, // Pass the local instance
                ragChunking: options?.ragChunking
            });

            if (!text || text.trim().length === 0) {
                parentPort.postMessage({ 
                    type: 'result', 
                    success: false, 
                    error: "No text extracted", 
                    filePath 
                });
                return;
            }

            if (chunks.length === 0) {
                parentPort.postMessage({ 
                    type: 'result', 
                    success: false, 
                    error: "Text extracted but 0 chunks", 
                    filePath 
                });
                return;
            }

            // 2. Compute Embeddings (Heavy CPU Task)
            let batchDocs = [];
            // Optimization: Increased batch size since we skip Parent embeddings
            // Child chunks are small, so 50 is safe.
            const BATCH_SIZE = 50; 
            // log(`Embedding ${chunks.length} chunks for ${path.basename(filePath)}...`);

            // Graph-Lite: Extract Entities from Full Text
            const knownProjects = options.knownProjects || [];
            const entities = EntityExtractor.extract(text, knownProjects);
            
            // Clean up text to free memory
            text = null;
            if (global.gc) global.gc();

            for (let i = 0; i < chunks.length; i++) {
                const chunkItem = chunks[i];
                const chunkText = typeof chunkItem === 'string' ? chunkItem : chunkItem.text;
                const chunkContext = typeof chunkItem === 'string' ? '' : (chunkItem.context || '');
                const vectorText = typeof chunkItem === 'string' ? chunkItem : (chunkItem.vector_text || chunkItem.text);

                if (!chunkText || !chunkText.trim()) continue;

                // Optimization: Skip embedding for Parent chunks (context only)
                // We only need embeddings for Child chunks (retrieval targets)
                let vector = null;
                
                if (chunkItem.type === 'parent') {
                    // Use a dummy zero-vector for parents if DB requires it, or null if schema allows.
                    // LanceDB is flexible, but having consistent dimensions is safer.
                    // Assuming 384-dim for BGE-M3/MiniLM. 
                    // Better: use a 1-dim dummy and rely on type filtering? No, schema is fixed.
                    // Let's use a null vector if LanceDB supports it (it usually does for non-vector search).
                    // Or, just generate a zero array of length 1 (schema evolution might handle it).
                    // Actually, if we never search 'parent', the vector value doesn't matter.
                    // Let's try skipping it. If DB complains, we'll fix.
                    // Update: LanceDB usually enforces fixed vector dimension.
                    // We will skip embedding call but we might need a placeholder.
                    // Let's create a small zero vector.
                    const dim = typeof options?.ragEmbeddingDim === 'number' && options.ragEmbeddingDim > 0
                        ? options.ragEmbeddingDim
                        : 384;
                    vector = new Array(dim).fill(0); 
                } else {
                    // Heavy lifting here only for Children
                    vector = await embeddingService.getEmbedding(vectorText);
                }
                
                batchDocs.push({
                    vector,
                    text: chunkText,
                    vector_text: vectorText,
                    context: chunkContext,
                    source: filePath, // Or metadata source
                    timestamp: Date.now(),
                    ...metadata
                });
                
                // Batch Streaming
                if (batchDocs.length >= BATCH_SIZE) {
                    parentPort.postMessage({ type: 'batch_result', docs: batchDocs, filePath });
                    batchDocs = []; // Clear to free memory
                    
                    // Yield to event loop
                    await new Promise(resolve => setTimeout(resolve, 0));
                    
                    // Force GC if exposed
                    if (global.gc && i % 100 === 0) {
                        global.gc();
                    }
                }
            }

            // 3. Return Results (Do not write to DB here)
            parentPort.postMessage({ 
                type: 'result', 
                success: true, 
                docs: batchDocs, // Send remaining docs
                entities, // Return extracted entities
                filePath 
            });

        } catch (e) {
            console.error(`[Worker] Error processing ${filePath}:`, e);
            parentPort.postMessage({ 
                type: 'result', 
                success: false, 
                error: e.message, 
                filePath 
            });
        }
    }
});

// Start initialization immediately
initWorker();
