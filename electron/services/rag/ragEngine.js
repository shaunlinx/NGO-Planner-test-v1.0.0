const vectorStore = require('./vectorStore');
const embeddingService = require('./embedding');
const fileProcessor = require('./fileProcessor');
const EntityExtractor = require('./entityExtractor');
const dbManager = require('../../databaseManager');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { extractTextForSearch } = require('../../utils/searchTextExtractor');

class RAGEngine {
    constructor() {
        this.isReady = false;
        this.ingestionQueue = null;
        this.apiKey = null;
        this.chunkingConfig = null;
        this.embeddingDim = null;
        this._indexedSourcesCache = { ts: 0, set: new Set() };
    }

    setIngestionQueue(queue) {
        this.ingestionQueue = queue;
    }

    async init() {
        if (this.isReady) return;
        console.log("[RAG] Initializing RAG Engine (v2.1 - Fallback & Sanitize Fix Applied)...");

        // Load config from DB
        const provider = await dbManager.getSetting('rag_provider') || 'openai';
        const apiKey = await dbManager.getSetting('rag_api_key');
        const secretKey = await dbManager.getSetting('rag_secret_key');
        const baseUrl = await dbManager.getSetting('rag_base_url');
        const model = await dbManager.getSetting('rag_model');
        const hfToken = await dbManager.getSetting('rag_hf_token');
        const jinaKey = await dbManager.getSetting('rag_jina_key');

        // Load Main API Configs (DeepSeek / Gemini)
        // Note: These might be encrypted (ENC:...) or plain text depending on secure storage availability.
        // EmbeddingService will handle decryption/usage if we pass them.
        // Actually, secure decryption happens in main process secure-get. 
        // dbManager.getSetting returns the raw string from DB.
        // We need to decrypt them here if they are encrypted.
        const { safeStorage } = require('electron');
        
        const decrypt = (val) => {
            if (val && typeof val === 'string' && val.startsWith('ENC:')) {
                if (safeStorage.isEncryptionAvailable()) {
                    try {
                        return safeStorage.decryptString(Buffer.from(val.substring(4), 'hex'));
                    } catch (e) { console.warn("Decryption failed", e); return null; }
                } else {
                    return null;
                }
            }
            return val;
        };

        const deepseekKey = decrypt(await dbManager.getSetting('user_api_key_deepseek'));
        const deepseekStatus = await dbManager.getSetting('user_api_status_deepseek') || 'active';
        
        const googleKey = decrypt(await dbManager.getSetting('user_api_key_google'));
        const googleStatus = await dbManager.getSetting('user_api_status_google') || 'active';

        this.apiKey = apiKey; // Store for file processing usage

        // Always configure embedding service, passing main APIs as fallback/primary for enrichment
        embeddingService.configure({ 
            provider, apiKey, secretKey, baseUrl, model, hfToken, jinaKey,
            deepseekKey, deepseekStatus,
            googleKey, googleStatus
        });

        try {
            const probedDim = await embeddingService.getEmbeddingDim();
            if (typeof probedDim === 'number' && probedDim > 0) {
                this.embeddingDim = probedDim;
                await dbManager.saveSetting('rag_embedding_dim', probedDim);
            }

            const vectorDim = await vectorStore.getVectorDimension();
            if (typeof vectorDim === 'number' && vectorDim > 0) {
                await dbManager.saveSetting('rag_vector_dim', vectorDim);
            }

            if (typeof vectorDim === 'number' && vectorDim > 0 && typeof probedDim === 'number' && probedDim > 0) {
                const mismatch = vectorDim !== probedDim;
                await dbManager.saveSetting('rag_dim_mismatch', mismatch ? 1 : 0);
                if (mismatch) {
                    await dbManager.saveSetting('rag_dim_mismatch_detail', {
                        vectorDim,
                        embeddingDim: probedDim,
                        ts: Date.now()
                    });
                }
            }
        } catch (e) {}

        try {
            const [
                mode,
                parentSize,
                parentOverlap,
                childSize,
                childOverlap,
                chunkSize,
                overlap,
                separators,
                maxChunksPerFile,
                maxEmbeddingsPerFile
            ] = await Promise.all([
                dbManager.getSetting('rag_chunk_mode'),
                dbManager.getSetting('rag_parent_chunk_size'),
                dbManager.getSetting('rag_parent_chunk_overlap'),
                dbManager.getSetting('rag_child_chunk_size'),
                dbManager.getSetting('rag_child_chunk_overlap'),
                dbManager.getSetting('rag_chunk_size'),
                dbManager.getSetting('rag_chunk_overlap'),
                dbManager.getSetting('rag_chunk_separators'),
                dbManager.getSetting('rag_max_chunks_per_file'),
                dbManager.getSetting('rag_max_embeddings_per_file')
            ]);

            this.chunkingConfig = {
                mode: mode === 'simple' ? 'simple' : 'parent_child',
                parentSize: parentSize || 2000,
                parentOverlap: parentOverlap || 200,
                childSize: childSize || 500,
                childOverlap: childOverlap || 50,
                chunkSize: chunkSize || 600,
                overlap: overlap || 100,
                separators: Array.isArray(separators) && separators.length > 0 ? separators : ["\n\n", "\n", "。", "！", "？", ".", "!", "?", "；", ";", " ", ""],
                maxChunksPerFile: maxChunksPerFile || 0,
                maxEmbeddingsPerFile: maxEmbeddingsPerFile || 0
            };
        } catch (e) {
            this.chunkingConfig = null;
        }
        this.isReady = true;
    }

    async ingestFile(filePath, metadata = {}, options = {}) {
        if (!this.isReady) await this.init();
        
        try {
            console.log(`[RAG] Processing file: ${filePath}`);
            
            // Resolve real path if link
            let realPath = filePath;
            try {
                // Use async methods to avoid blocking main thread
                const stats = await fs.promises.lstat(filePath);
                if (stats.isSymbolicLink()) {
                    realPath = await fs.promises.realpath(filePath);
                } else if (process.platform === 'win32' && filePath.toLowerCase().endsWith('.lnk')) {
                    // exec is async, unlike execSync
                    const { exec } = require('child_process');
                    const command = `powershell.exe -noprofile -command "$sh=New-Object -ComObject WScript.Shell;$lnk=$sh.CreateShortcut('${filePath}');$lnk.TargetPath"`;
                    
                    realPath = await new Promise((resolve) => {
                        exec(command, { encoding: 'utf8' }, (error, stdout) => {
                            if (error || !stdout) resolve(filePath);
                            else resolve(stdout.trim() || filePath);
                        });
                    });
                }
            } catch (e) { /* ignore */ }

            // Pass embeddingService for Context Enrichment
            // Use realPath for reading content, but filePath as 'source' to keep UI link valid
            // Destructure using 'let' so we can nullify text later for GC
            let { text, chunks } = await fileProcessor.processFile(realPath, { 
                apiKey: this.apiKey,
                embeddingService: embeddingService,
                ragChunking: this.chunkingConfig
            });
            
            if (!text || text.trim().length === 0) {
                 console.warn(`[RAG] No text extracted from ${filePath}. Skipping ingestion.`);
                 return { success: false, error: "No text extracted from file" };
            }
            
            // Handle saveProcessedAsMd
            let finalSource = filePath;
            if (options.saveProcessedAsMd) {
                const mdPath = filePath + '.md';
                try {
                    fs.writeFileSync(mdPath, text);
                    console.log(`[RAG] Saved processed text to ${mdPath}`);
                    finalSource = mdPath; 
                } catch (err) {
                    console.error(`[RAG] Failed to save MD file: ${err.message}`);
                    // Fallback to original path if save fails
                }
            }

            // Clean up raw text immediately to free memory (can be >100MB)
            // chunks already contains the necessary text parts
            text = null; 
            if (global.gc) global.gc();

            if (chunks.length === 0) {
                 console.warn(`[RAG] Text extracted but 0 chunks created for ${filePath}.`);
                 return { success: false, error: "Text extracted but chunking returned empty" };
            }

            // Delete existing documents for this source BEFORE starting batch ingestion
            // This prevents duplicate chunks if we crash halfway, and avoids "accumulate then delete" pattern
            await vectorStore.deleteDocuments(finalSource);

            let totalIngested = 0;
            let batchDocs = [];
            // Optimization: Increased batch size since we skip Parent embeddings
            const BATCH_SIZE = 50; 
            
            console.log(`[RAG] Embedding ${chunks.length} chunks from ${filePath} (Batch Size: ${BATCH_SIZE})...`);
            
            for (let i = 0; i < chunks.length; i++) {
                const chunkItem = chunks[i];
                
                // Handle both string chunks (legacy) and object chunks (enriched)
                const chunkText = typeof chunkItem === 'string' ? chunkItem : chunkItem.text;
                const chunkContext = typeof chunkItem === 'string' ? '' : (chunkItem.context || '');
                const vectorText = typeof chunkItem === 'string' ? chunkItem : (chunkItem.vector_text || chunkItem.text);

                if (!chunkText || !chunkText.trim()) continue;

                try {
                    // Embed the AUGMENTED text (Context + Original)
                    let vector = null;
                    if (chunkItem.type === 'parent') {
                        // Skip embedding for parents (Optimization)
                        const dim = typeof this.embeddingDim === 'number' && this.embeddingDim > 0 ? this.embeddingDim : 384;
                        vector = new Array(dim).fill(0);
                    } else {
                        vector = await embeddingService.getEmbedding(vectorText);
                    }
                    
                    batchDocs.push({
                        id: chunkItem.id || uuidv4(), // Ensure ID exists
                        type: chunkItem.type || 'standard',
                        parent_id: chunkItem.parent_id || null,
                        chunk_index: chunkItem.chunk_index || 0,
                        vector,
                        text: chunkText,      // Display text (clean)
                        vector_text: vectorText, // Search text (enriched)
                        context: chunkContext, // Metadata
                        source: finalSource, 
                        timestamp: Date.now(),
                        ...metadata
                    });

                    // Batch Ingestion
                    if (batchDocs.length >= BATCH_SIZE) {
                        await vectorStore.addDocuments(batchDocs);
                        totalIngested += batchDocs.length;
                        batchDocs = []; // Clear array to free memory
                        
                        // Yield event loop to allow GC and UI updates
                        await new Promise(resolve => setTimeout(resolve, 0));
                        
                        // Aggressive GC trigger if available (requires --expose-gc)
                        if (global.gc && i % 100 === 0) {
                            global.gc();
                        }
                    }

                } catch (embedErr) {
                    console.error(`[RAG] Embedding failed for chunk ${i} in ${filePath}:`, embedErr.message);
                    // Continue with other chunks? Or fail hard? 
                    // Better to fail hard so user knows RAG is incomplete.
                    throw embedErr;
                }
            }

            // Ingest remaining chunks
            if (batchDocs.length > 0) {
                await vectorStore.addDocuments(batchDocs);
                totalIngested += batchDocs.length;
                batchDocs = [];
            }

            console.log(`[RAG] Successfully ingested ${totalIngested} chunks for ${filePath}`);
            return { success: true, chunks: totalIngested };

        } catch (e) {
            console.error(`[RAG] Ingestion Error for ${filePath}:`, e);
            return { success: false, error: e.message };
        }
    }

    async indexCard(card) {
        if (!this.isReady) await this.init();
        
        try {
            const tags = Array.isArray(card.ai_tags) ? card.ai_tags.join(', ') : card.ai_tags;
            const cardText = `[Knowledge Card]
Source File: ${path.basename(card.file_path)}
Selected Text: "${card.selected_text}"
Tags: ${tags}
User Note: ${card.user_note}
`;
            
            const vector = await embeddingService.getEmbedding(cardText);
            
            const doc = {
                vector,
                text: cardText, 
                vector_text: cardText, 
                context: JSON.stringify({ type: 'card', cardId: card.id }), 
                source: card.file_path, 
                timestamp: Date.now()
            };
            
            await vectorStore.deleteCard(card.id);
            await vectorStore.addDocuments([doc]);
            
            console.log(`[RAG] Indexed card ${card.id}`);
            return { success: true };
        } catch (e) {
            console.error(`[RAG] Failed to index card ${card.id}:`, e);
            return { success: false, error: e.message };
        }
    }

    async deleteCard(cardId) {
        if (!this.isReady) await this.init();
        await vectorStore.deleteCard(cardId);
        return { success: true };
    }

    async _loadReranker() {
        if (!this.reranker && !this.rerankerLoading) {
            this.rerankerLoading = true;
            try {
                const { pipeline, env } = await import('@xenova/transformers');
                
                // Configure local model path
                // Resolve path relative to app root or use process.resourcesPath
                const isDev = process.env.NODE_ENV === 'development' || !process.resourcesPath;
                // In dev: root/resources/models. In prod: resources/models.
                // __dirname is electron/services/rag. 
                // Need to go up 3 levels to root: rag -> services -> electron -> root.
                const modelPath = isDev 
                    ? path.resolve(__dirname, '../../../resources/models')
                    : path.join(process.resourcesPath, 'models');
                
                if (!fs.existsSync(modelPath)) {
                    console.warn(`[RAG] Local model path not found: ${modelPath}`);
                } else {
                    console.log(`[RAG] Using local model path: ${modelPath}`);
                }
                
                env.localModelPath = modelPath;
                env.allowRemoteModels = false; // Force local only
                
                // SOTA Cross-Encoder
                // Use 'Xenova/bge-reranker-base' because it exists in user's resources.
                // If 'Xenova/bge-m3' folder contains a reranker, we could use that, but base is safer.
                console.log(`[RAG] Attempting to load Reranker (BGE-Base) from ${modelPath}...`);
                
                this.reranker = await pipeline('text-classification', 'Xenova/bge-reranker-base', {
                    quantized: true,
                    local_files_only: true,
                    session_options: {
                        intraOpNumThreads: 1,
                        interOpNumThreads: 1,
                        executionMode: 'sequential',
                        graphOptimizationLevel: 'all'
                    }
                });
                console.log("[RAG] Reranker (BGE-Base) loaded.");
            } catch (e) {
                console.warn("[RAG] Failed to load Reranker (BGE-Base).", e.message);
                this.reranker = null;
            }
            this.rerankerLoading = false;
        }
    }

    async updateChunk(filePath, oldText, newText) {
        if (!this.isReady) await this.init();
        if (oldText === newText) return { success: true };

        try {
            // 1. Delete old chunk
            await vectorStore.deleteChunk(filePath, oldText);

            // 2. Embed new text
            const vector = await embeddingService.getEmbedding(newText);
            if (!vector) throw new Error("Failed to generate embedding for new text");

            // 3. Add new chunk
            // We need context and timestamp. We'll try to preserve them if possible, 
            // but since deleteChunk removes them, we might need to fetch them first or just use defaults.
            // For simplicity in this edit flow, we use current timestamp.
            // A better approach would be read-delete-modify-write, but let's assume UI passes context if needed.
            // Here we just re-insert.
            const doc = {
                text: newText,
                vector: vector,
                source: filePath,
                context: {}, // Metadata lost unless passed, but acceptable for raw text edit
                timestamp: Date.now()
            };

            await vectorStore.addDocuments([doc]);
            return { success: true };
        } catch (e) {
            console.error("Update Chunk Error:", e);
            return { success: false, error: e.message };
        }
    }

    async batchRunAI(filePath, chunks, instruction) {
        if (!this.isReady) await this.init();
        
        const results = [];
        const errors = [];

        // Process in parallel (with concurrency limit ideally, but for now simple Promise.all)
        // We limit to 5 concurrent to avoid rate limits
        const chunksToProcess = [...chunks];
        
        while (chunksToProcess.length > 0) {
            const batch = chunksToProcess.splice(0, 5);
            const promises = batch.map(async (chunk) => {
                try {
                    // 1. Call LLM
                    const prompt = `You are a text editor.
Instruction: ${instruction}
Original Text:
"""
${chunk.text}
"""
Output ONLY the modified text. Do not add quotes or explanations.`;
                    
                    const newText = await embeddingService.completion(prompt);

                    if (!newText || newText === chunk.text) return { status: 'skipped' };

                    // 2. Re-embed and Update
                    await this.updateChunk(filePath, chunk.text, newText.trim());
                    return { status: 'updated', old: chunk.text, new: newText };
                } catch (e) {
                    return { status: 'error', error: e.message, text: chunk.text };
                }
            });

            const batchResults = await Promise.all(promises);
            results.push(...batchResults);
        }

        return { 
            success: true, 
            updated: results.filter(r => r.status === 'updated').length,
            errors: results.filter(r => r.status === 'error')
        };
    }

    async analyzeFile(filePath, content, stats) {
        if (!this.llmService) await this.initialize();

        const prompt = `You are a Knowledge Base Administrator.
Analyze this document and recommend settings.
Current Settings: Status=${stats.status}, Weight=${stats.weight_factor}, Tags=${stats.tags}

Content Preview:
"""
${content.substring(0, 1000)}...
"""

Return a JSON object ONLY (no markdown, no code blocks):
{
  "analysis": "Brief analysis of document value (1 sentence)",
  "suggestion": {
    "status": "active" | "locked" | "deprecated",
    "weight_factor": number (0.5 to 1.5),
    "tags": ["tag1", "tag2"],
    "summary": "One sentence summary of the document",
    "keywords": "keyword1, keyword2, keyword3"
  }
}`;

        try {
            const response = await this.llmService.chat([
                { role: 'user', content: prompt }
            ]);
            
            // Try to parse JSON
            try {
                // Remove markdown code blocks if present
                const cleanJson = response.replace(/```json/g, '').replace(/```/g, '').trim();
                return JSON.parse(cleanJson);
            } catch (e) {
                // Fallback to text
                return { analysis: response };
            }
        } catch (e) {
            console.error("AI Analysis Error:", e);
            return { analysis: "AI analysis failed." };
        }
    }

    async rewriteQuery(query) {
        // Simple heuristic: if query is long (> 5 words) or looks like a question, try to extract keywords.
        // If query is short, it's likely already keywords.
        if (query.split(' ').length < 4 && query.length < 20) return query;

        try {
            console.log(`[RAG] Rewriting query: "${query}"`);
            const prompt = `You are a search engine query optimizer. 
Extract the most important keywords and entities from the user's query for a BM25/Keyword search.
Remove stop words, polite phrases, and conversational filler.
Output ONLY the keywords separated by spaces.
User Query: "${query}"`;

            const keywords = await embeddingService.completion(prompt);
            if (keywords && keywords.length < query.length * 1.5) { // Sanity check
                console.log(`[RAG] Rewritten Keywords: "${keywords}"`);
                return keywords.replace(/\n/g, ' ').trim();
            }
        } catch (e) {
            console.warn("[RAG] Query rewrite failed, using original.", e.message);
        }
        return query;
    }

    /**
     * Intention Classifier & Path Resolver
     * Tries to map user natural language ("in the examples folder", "the budget file") to actual file system paths.
     */
    async _resolvePathIntent(query) {
        try {
            // 1. Get all available source paths from Vector Store
            const availableSources = await vectorStore.getAllSources();
            if (!availableSources || availableSources.length === 0) return null;

            // Extract unique folders and files for context
            // Optimization: If too many files, only pass top-level folders or distinct filenames
            const uniqueFolders = [...new Set(availableSources.map(s => path.dirname(s)))];
            const uniqueFiles = availableSources.map(s => path.basename(s));
            
            // Limit candidates to avoid context overflow (e.g. top 100 paths)
            // Combine both folders and files into a "File System Snapshot"
            // We prioritize showing folders, then a sample of files if space permits.
            const candidates = [
                ...uniqueFolders.slice(0, 50).map(f => `[DIR] ${f}`),
                ...availableSources.slice(0, 50).map(f => `[FILE] ${f}`)
            ].join('\n');

            const prompt = `You are a File System Query Router.
Your task is to identify if the user wants to restrict search to a specific folder OR a specific file.

Available File System Snapshot:
${candidates}

User Query: "${query}"

Rules:
1. If user mentions a folder (e.g. "in reports", "under guidelines"), find the best matching [DIR] path.
2. If user mentions a specific file (e.g. "analyze the budget.xlsx", "that pdf about taxes"), find the best matching [FILE] path.
3. Be smart about partial matches (e.g. "examples" -> matches ".../Project/Examples").
4. Be smart about aliases (e.g. "money file" -> might match "budget.xlsx" if obvious).

Return ONLY the matching path string (without [DIR] or [FILE] prefix).
If no specific folder/file is targeted or no match found, return "NULL".`;

            const matchedPath = await embeddingService.completion(prompt);
            const cleanPath = matchedPath ? matchedPath.trim() : "NULL";
            
            if (cleanPath !== "NULL" && availableSources.some(s => s.startsWith(cleanPath))) {
                console.log(`[RAG] 📂 Intent Detected: Restriction to path "${cleanPath}"`);
                return cleanPath;
            }
        } catch (e) {
            console.warn("[RAG] Path intent resolution failed:", e);
        }
        return null;
    }

    async checkCompliance(answer, negativeChunks) {
        if (!negativeChunks || negativeChunks.length === 0 || !answer) {
            return { isCompliant: true, violations: [] };
        }

        const violations = [];
        // Helper to compute Jaccard similarity (word overlap)
        const getJaccard = (str1, str2) => {
            const set1 = new Set(str1.toLowerCase().split(/\s+|[,.，。]/).filter(s => s.length > 1));
            const set2 = new Set(str2.toLowerCase().split(/\s+|[,.，。]/).filter(s => s.length > 1));
            const intersection = new Set([...set1].filter(x => set2.has(x)));
            const union = new Set([...set1, ...set2]);
            return union.size === 0 ? 0 : intersection.size / union.size;
        };

        // Split answer into sentences (rough split for Chinese/English)
        const sentences = answer.split(/[。.!！?？\n]+/).filter(s => s.trim().length > 10);

        for (const sentence of sentences) {
            for (const chunk of negativeChunks) {
                // Determine constraint level
                const level = chunk.constraintLevel || 'strict'; // default strict
                const overlap = getJaccard(sentence, chunk.text);
                
                // Thresholds logic
                let isViolation = false;
                let issueType = '';

                if (level === 'strict') {
                    // Strict: Even small semantic overlap is bad. 
                    // Jaccard > 0.3 (approx 30% word match) implies significant leakage for strict.
                    // Or if specific keywords match? Let's use Jaccard > 0.2 for strict.
                    if (overlap > 0.2) {
                        isViolation = true;
                        issueType = 'Strict Violation (Shield)';
                    }
                } else if (level === 'rephrase') {
                    // Rephrase: Ideas ok, exact copy bad.
                    // Jaccard > 0.5 implies too much verbatim copy.
                    if (overlap > 0.5) {
                        isViolation = true;
                        issueType = 'High Overlap (Rephrase Needed)';
                    }
                } else if (level === 'relaxed') {
                    // Relaxed: < 25% overlap allowed.
                    // Actually, let's say overlap > 0.25 is bad?
                    // "0-25% overlap is allowed" -> violation if overlap > 0.25
                    if (overlap > 0.25) {
                        isViolation = true;
                        issueType = 'Exceeds Allowed Overlap (Relaxed)';
                    }
                }

                if (isViolation) {
                    violations.push({
                        segment: sentence.trim(),
                        sourceChunk: chunk,
                        overlapScore: overlap,
                        issueType
                    });
                }
            }
        }

        return {
            isCompliant: violations.length === 0,
            violations
        };
    }

    // --- Helper Methods ---

    /**
     * Helper: Extract lightweight metadata snapshot (solve too much metadata issue)
     * Extract core metadata, formatted for intent recognition
     */
    async _getLightweightMetadataSnapshot() {
      try {
        // 1. Get all sources from vector store
        const allSources = await vectorStore.getAllSources();
        if (!allSources || allSources.length === 0) return "无可用索引文件";

        // 2. Get extended metadata from database (tags, modify time, etc.)
        const fileConfigs = await dbManager.getFileConfig(allSources);

        // 3. Filter and aggregate core metadata, format lightweight
        const metadataItems = allSources.slice(0, 100) // Limit count to avoid context overflow
          .map(source => {
            const config = fileConfigs[source] || {};
            const fileName = path.basename(source);
            const fileExt = path.extname(source).toLowerCase();
            const fileFolder = path.dirname(source).split(path.sep).slice(-2).join(path.sep); // Keep only last 2 levels
            const tags = config.tags ? config.tags.join(", ") : "无标签";
            const modifyTime = config.lastModified ? new Date(config.lastModified).toLocaleDateString() : "未知时间";

            return `[文件] 名称：${fileName} | 类型：${fileExt} | 所在文件夹：${fileFolder} | 标签：${tags} | 修改时间：${modifyTime}`;
          });

        // 4. Generate snapshot
        return `可用索引文件元数据快照（共${allSources.length}个文件，以下展示前${metadataItems.length}个）：\n${metadataItems.join("\n")}`;
      } catch (e) {
        console.warn("[RAG] Failed to get metadata snapshot:", e);
        return "获取索引元数据失败";
      }
    }

    /**
     * Helper: Generate potential retrieval directions based on intent (Multi-direction)
     * @param {Object} intentAnalysis Intent analysis result
     * @param {string} userQuery User original query
     * @param {string} metadataSnapshot Metadata snapshot
     * @returns {Array} List of retrieval directions (priority, params)
     */
    async _generateRetrievalDirections(intentAnalysis, userQuery, metadataSnapshot) {
      const { strategy, filters } = intentAnalysis;
      const retrievalDirections = [];
      const allSources = await vectorStore.getAllSources();
      const topK = 15;

      // 1. High Priority Directions
      if (strategy.searchMode === "semantic_search") {
        // Direction 1: Optimized Semantic Search (Core)
        retrievalDirections.push({
          priority: 1, // Highest
          type: "semantic_optimized",
          name: "优化语义检索",
          params: {
            query: strategy.rewrittenQuery || userQuery,
            topK: strategy.requirements === "broad" ? Math.min(30, topK * 2) : Math.min(15, topK),
            filterSources: filters.extension ? allSources.filter(s => s.endsWith(filters.extension)) : null
          },
          description: "基于意图优化的语义检索，优先匹配核心语义"
        });

        // Direction 2: Metadata Filtered Semantic Search (New)
        retrievalDirections.push({
          priority: 1,
          type: "semantic_metadata_filtered",
          name: "元数据筛选语义检索",
          params: {
            query: strategy.rewrittenQuery || userQuery,
            topK: Math.min(20, topK * 1.5),
            filterSources: this._filterSourcesByMetadata(allSources, filters) // Helper needed
          },
          description: "基于用户查询筛选元数据（文件类型、标签），再执行语义检索"
        });
      }

      if (strategy.searchMode === "full_doc_scan" && filters && Object.keys(filters).length > 0) {
        const filteredSources = this._filterSourcesByMetadata(allSources, filters);
        if (filteredSources.length > 0) {
            retrievalDirections.push({
            priority: 1,
            type: "full_doc_scan_optimized",
            name: "优化全文档扫描",
            params: {
                sources: filteredSources,
                sampleRate: 0.8 // Higher sample rate
            },
            description: "针对总结/概述需求，优化文档采样，保留更多核心内容"
            });
        }
      }

      // 2. Medium Priority Directions (Supplement)
      retrievalDirections.push({
        priority: 2,
        type: "keyword_entity_boost",
        name: "实体增强关键词检索",
        params: {
          keyword: await this.rewriteQuery(userQuery),
          entities: await this._extractQueryEntities(userQuery), // Reuse existing
          topK: Math.min(25, topK * 1.5)
        },
        description: "基于实体增强的关键词检索，补充语义检索的不足"
      });

      // 3. Low Priority Directions (Fallback)
      retrievalDirections.push({
        priority: 3,
        type: "broad_semantic_fallback",
        name: "宽泛语义兜底检索",
        params: {
          query: userQuery,
          topK: Math.min(50, topK * 3),
          filterSources: null // No limit
        },
        description: "无限制宽泛语义检索，用于高优先级检索召回不足时兜底"
      });

      return retrievalDirections;
    }

    /**
     * Helper: Filter sources by metadata
     */
    _filterSourcesByMetadata(allSources, filters) {
      if (!allSources || allSources.length === 0) return [];

      let filtered = [...allSources];
      // Filter extension
      if (filters.extension) {
        filtered = filtered.filter(s => s.toLowerCase().endsWith(`.${filters.extension.toLowerCase()}`));
      }
      // Filter keyword (filename/tag)
      if (filters.keyword) {
        filtered = filtered.filter(s => {
          const fileName = path.basename(s).toLowerCase();
          return fileName.includes(filters.keyword.toLowerCase());
        });
      }

      return filtered;
    }

    /**
     * Helper: Evaluate retrieval quality (Quantify recall rate)
     * @param {Array} retrievalResults 
     * @param {Object} direction 
     * @returns {number} Quality score (0-100)
     */
    _evaluateRetrievalQuality(retrievalResults, direction) {
      if (!retrievalResults || retrievalResults.length === 0) return 0;

      // 1. Base Score: Count (40%)
      const maxPossible = direction.params.topK || 50;
      const countScore = (retrievalResults.length / maxPossible) * 40;

      // 2. Relevance Score: Avg Score (50%)
      const avgScore = retrievalResults.reduce((sum, item) => sum + (item.finalScore || item.score || 0), 0) / retrievalResults.length;
      const relevanceScore = avgScore * 50;

      // 3. Metadata Match Score (10%)
      const hasMetadataMatch = retrievalResults.some(item => {
        const fileExt = path.extname(item.source).toLowerCase();
        return direction.params.filterSources ? true : false; // Simplified check
      });
      const metadataScore = hasMetadataMatch ? 10 : 0;

      // 4. Total
      return Math.round(countScore + relevanceScore + metadataScore);
    }

    /**
     * Helper: Run retrieval in batches
     * @param {Array} retrievalDirections 
     * @param {Object} options 
     * @returns {Array} Results + Quality Score
     */
    async _runRetrievalInBatches(retrievalDirections, options) {
      const { signal, pauseController } = options;
      const batchResults = [];
      const BATCH_SIZE = 2; // Run 2 directions per batch

      // Sort by priority
      retrievalDirections.sort((a, b) => a.priority - b.priority);

      // Execute in batches
      for (let i = 0; i < retrievalDirections.length; i += BATCH_SIZE) {
        const currentBatch = retrievalDirections.slice(i, i + BATCH_SIZE);
        console.log(`[RAG] Executing Batch ${Math.floor(i/BATCH_SIZE) + 1}, ${currentBatch.length} directions`);

        // Parallel execution
        const batchPromises = currentBatch.map(async (direction) => {
          try {
            this._checkSignal(signal);
            await this._checkPause(pauseController);

            let results = [];
            // Execute logic based on type
            switch (direction.type) {
              case "semantic_optimized":
              case "semantic_metadata_filtered":
              case "broad_semantic_fallback":
                const vector = await embeddingService.getEmbedding(direction.params.query);
                results = await vectorStore.search(vector, direction.params.topK, direction.params.filterSources);
                break;
              case "full_doc_scan_optimized":
                 // Reusing scanDocuments logic roughly
                 // For now, assuming scanDocuments takes list of sources
                 // results = await this.scanDocuments(direction.params.sources);
                 // Implementing simple scan mock or reuse if available
                 results = []; 
                 break;
              case "keyword_entity_boost":
                results = await vectorStore.keywordSearch(direction.params.keyword, direction.params.topK, direction.params.filterSources);
                break;
              default:
                results = [];
            }

            // Evaluate Quality
            const qualityScore = this._evaluateRetrievalQuality(results, direction);
            return {
              direction,
              results,
              qualityScore,
              success: true
            };
          } catch (e) {
            console.warn(`[RAG] Direction ${direction.name} failed:`, e);
            return {
              direction,
              results: [],
              qualityScore: 0,
              success: false,
              error: e.message
            };
          }
        });

        // Wait for batch
        const currentBatchResults = await Promise.all(batchPromises);
        batchResults.push(...currentBatchResults);

        // GC and Yield
        if (global.gc) global.gc();
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      return batchResults;
    }

    async analyzeQueryIntent(query, historyContext = "") {
        if (!this.isReady) await this.init();
        
        try {
            // 1. Get lightweight metadata snapshot (Core supplement)
            const metadataSnapshot = await this._getLightweightMetadataSnapshot();

            const prompt = `You are a RAG Strategy Planner. Analyze the user's query and generate a retrieval strategy.
        --- SUPPLEMENTARY INFO ---
        History Context (if any): ${historyContext || "No history context"}
        Indexed Files Metadata Snapshot: ${metadataSnapshot}
        --- USER QUERY ---
        User Query: "${query}"
        
        Determine the following:
        1. **searchMode**: 
           - "semantic_search": For specific questions (QA), fact lookup, or searching for specific topics. (Default)
           - "full_doc_scan": For broad requests like "summarize this", "overview of X", "compare these files", "what is this file about". This mode prioritizes reading large chunks of text over searching for keywords.
           - "metadata_filter": For counting, listing files, or checking metadata (e.g. "list pdfs", "how many files").
        
        2. **requirements**:
           - "precise": Need specific facts (Standard Top K).
           - "broad": Need general understanding, extensive context, or multiple perspectives (High Top K).
           - "reasoning": For "Why" questions requiring causal explanation or background context.
           - "instructional": For "How to" questions requiring steps, procedures, or guides.
        
        3. **rewrittenQuery**: 
           - If the user query is a command like "summarize these" or "overview", the semantic search term should be optimized (e.g., "summary", "introduction") or null to scan.
           - If it's a specific question, extract the core semantic keywords.
           - If "reasoning" (Why), append terms like "cause", "reason", "background", "rationale".
           - If "instructional" (How to), append terms like "steps", "guide", "process", "procedure".
        
        4. **filters**: Extract file extensions or metadata constraints if present.
        
        Return JSON ONLY:
        {
          "strategy": {
            "searchMode": "semantic_search" | "full_doc_scan" | "metadata_filter",
            "requirements": "precise" | "broad" | "reasoning" | "instructional",
            "rewrittenQuery": string | null,
            "rationale": "Why you chose this strategy"
          },
          "filters": {
            "extension": "pdf" | "docx" | null,
            "keyword": string | null,
            "date_range": string | null
          }
        }`;

            const response = await embeddingService.completion(prompt);
            let result = { 
                strategy: { searchMode: 'semantic_search', requirements: 'precise', rewrittenQuery: query },
                filters: {}
            };
            
            try {
                const jsonStr = response.replace(/```json/g, '').replace(/```/g, '').trim();
                result = JSON.parse(jsonStr);
            } catch (e) {
                console.warn("[RAG] Intent analysis JSON parse failed, defaulting to simple search.", e);
            }
            
            return result;
        } catch (e) {
            console.error("[RAG] Intent analysis failed:", e);
            return { 
                strategy: { searchMode: 'semantic_search', requirements: 'precise', rewrittenQuery: query },
                filters: {}
            };
        }
    }

    /**
     * Executes a fast, structured search bypassing vector embeddings.
     */
    async executeStructuredSearch(params, reportProgress) {
        reportProgress('RETRIEVAL', 50, 'Executing fast metadata search...');
        
        // Use vectorStore's keyword/SQL capabilities
        // Since we don't have a direct "metadata query" API exposed yet, we use keywordSearch
        // but optimized for metadata if possible.
        // For MVP, we use keywordSearch with the extracted keywords/filters.
        
        let queryText = params.filters?.keyword || "";
        if (!queryText && params.action === 'list') queryText = ""; // List all if no keyword
        
        // Map extension filter to source filter? 
        // vectorStore doesn't strictly support "extension" column query yet without custom SQL.
        // We will fetch results and filter in memory (Fast for < 10k items).
        
        const results = await vectorStore.keywordSearch(queryText, 100); 
        
        // Post-processing in JS
        let filtered = results;
        if (params.filters?.extension) {
            const ext = params.filters.extension.toLowerCase();
            filtered = filtered.filter(r => r.source.toLowerCase().endsWith(`.${ext}`));
        }
        
        reportProgress('DONE', 100, `Found ${filtered.length} items.`);
        
        // Format output based on action
        let answer = "";
        if (params.action === 'count') {
            answer = `Found **${filtered.length}** files matching your criteria.`;
        } else {
            const list = filtered.map(f => `- [${path.basename(f.source)}](${f.source})`).join('\n');
            answer = `Here are the files I found:\n\n${list || "(No files found)"}`;
        }
        
        return {
            answer,
            sources: filtered.map(r => r.source),
            context: "", // No context needed
            chunks: []
        };
    }

    // --- Job Control Helpers ---
    _checkSignal(signal) {
        if (signal?.aborted) throw new Error('Aborted by user');
    }

    async _checkPause(pauseController) {
        if (pauseController?.isPaused) {
            console.log('[RAG] Pipeline paused. Waiting...');
            await pauseController.promise;
            console.log('[RAG] Pipeline resumed.');
        }
    }

    /**
     * Scans specific documents to extract representative chunks for summary/overview.
     * Strategy: Intro + Outro + Middle Sampling.
     */
    async scanDocuments(sources) {
        let allChunks = [];
        for (const source of sources) {
            try {
                // Fetch a generous amount of chunks to cover most small-medium docs
                // For large docs, this gets the first 100 chunks.
                const { chunks } = await vectorStore.getChunksBySource(source, { limit: 100 });
                
                if (!chunks || chunks.length === 0) continue;

                // Sort by chunk_index to restore linear order
                chunks.sort((a, b) => (a.chunk_index || 0) - (b.chunk_index || 0));
                
                let selected = [];
                if (chunks.length <= 30) {
                    // Small doc: take all
                    selected = chunks;
                } else {
                    // Large doc: Take Header, Footer, and systematic sample of Body
                    const start = chunks.slice(0, 10); // First 10 chunks (~3-5k chars)
                    const end = chunks.slice(-10);     // Last 10 chunks
                    
                    // Middle: Sample every 5th chunk to get coverage without exploding token count
                    const middleCandidates = chunks.slice(10, -10);
                    const middle = middleCandidates.filter((_, i) => i % 5 === 0).slice(0, 10);
                    
                    selected = [...start, ...middle, ...end];
                }
                
                // Add filename metadata for clarity
                selected.forEach(c => c.filename = path.basename(c.source));
                allChunks.push(...selected);
            } catch (e) {
                console.warn(`[RAG] Failed to scan document ${source}:`, e);
            }
        }
        return allChunks;
    }

    async query(text, topK = 15, filterSources = null, weight = 1.0, options = {}) {
        if (!this.isReady) await this.init();
        // Reranker is now managed by Worker
        // await this._loadReranker();

        const { signal, onProgress, pauseController } = options;
        const reportProgress = (step, progress, details) => {
            if (onProgress) onProgress({ step, progress, details });
        };

        this._checkSignal(signal);
        reportProgress('INIT', 10, 'Initializing query pipeline...');

        // Increase default topK to 15 (was 3), user can still override.
        if (topK === undefined || topK === null) topK = 15;
        
        const MAX_RETRIES = 1;
        let currentQuery = text;
        
        // --- FEATURE: Natural Language Folder Routing & Fast Path ---
        reportProgress('INTENT', 20, 'Analyzing query intent...');
        await this._checkPause(pauseController);
        
        // PARALLEL EXECUTION: Intent Analysis, Path Resolution, Entity Extraction, and Query Rewriting
        // This significantly reduces wait time by running independent LLM/Logic calls concurrently.
        const [analysis, inferredFolder, queryEntities, keywordQuery] = await Promise.all([
            this.analyzeQueryIntent(text).catch(e => {
                console.warn("[RAG] Intent analysis failed:", e);
                return { strategy: { searchMode: 'semantic_search', requirements: 'precise', rewrittenQuery: text }, filters: {} };
            }),
            this._resolvePathIntent(text).catch(e => null),
            (async () => {
                try {
                    const allProjects = await dbManager.getAllProjects();
                    return EntityExtractor.extract(text, allProjects.map(p => p.title));
                } catch (e) { return []; }
            })(),
            this.rewriteQuery(text).catch(e => text)
        ]);

        const { strategy, filters } = analysis;
        console.log(`[RAG] Strategy Generated:`, strategy);
        
        // --- STRATEGY BRANCH 1: Metadata/Structured Search ---
        if (strategy.searchMode === 'metadata_filter') {
            console.log(`[RAG] Routing to Fast Path: Metadata Filter`);
            reportProgress('INTENT', 25, `Identified structured task.`);
            // Map to existing structured search format
            return await this.executeStructuredSearch({ action: 'list', filters }, reportProgress);
        }

        // --- STRATEGY BRANCH 2: Full Document Scan (Summary/Overview) ---
        if (strategy.searchMode === 'full_doc_scan') {
             console.log(`[RAG] Routing to Scan Path: Full Document Scan`);
             
             // Check if we have a valid scope
             let targetSources = filterSources || [];
             
             // TODO: If no sources selected, maybe try to find by extension filter?
             // For now, only scan if user explicitly selected files or folders.
             
             if (targetSources.length > 0) {
                 reportProgress('INTENT', 25, `Scanning ${targetSources.length} documents for overview...`);
                 
                 // Execute Scan
                 const scanResults = await this.scanDocuments(targetSources);
                 
                 // Assemble Context directly (No Reranking needed for summary)
                 reportProgress('DONE', 100, 'Document scan complete.');
                 
                 const context = scanResults.map((r, i) => 
                    `[${i+1}] (Source: ${path.basename(r.source)})\n${r.text}`
                 ).join('\n\n');
                 
                 return {
                    context,
                    sources: scanResults.map(r => r.source),
                    chunks: scanResults.map((r, i) => ({
                        index: i + 1,
                        text: r.text,
                        source: r.source,
                        score: 1.0, // Artificial score
                        id: r.id,
                        filename: path.basename(r.source)
                    }))
                 };
             } else {
                 console.log("[RAG] Scan mode requested but no sources selected. Falling back to semantic search.");
                 // Fallback to semantic search will proceed below
             }
        }
        
        // --- STRATEGY BRANCH 3: Semantic Search (Default) ---
        // Apply dynamic adjustments based on strategy
        
        if (strategy.rewrittenQuery && strategy.rewrittenQuery !== text) {
            currentQuery = strategy.rewrittenQuery;
            console.log(`[RAG] Strategy applied: Rewrote query to "${currentQuery}"`);
        }
        
        if (strategy.requirements === 'broad') {
            // Increase TopK for broad questions to get more diversity
            // Keep a safety cap of 50
            topK = Math.min(topK * 2, 50);
            console.log(`[RAG] Strategy applied: Increased TopK to ${topK} for broad requirement.`);
        }
        
        if (strategy.requirements === 'reasoning') {
            // For "Why" questions, we need broader context to understand causality
            // And maybe slightly more chunks to piece together the argument
            topK = Math.min(Math.floor(topK * 1.5), 40);
            console.log(`[RAG] Strategy applied: Adjusted for Reasoning (Why) - TopK: ${topK}`);
        }

        if (strategy.requirements === 'instructional') {
            // For "How to", usually specific steps are needed.
            // Standard TopK is usually fine, but ensure we don't filter out step-by-step lists.
            // Maybe boost threshold slightly to ensure high relevance?
            // scoreThreshold = Math.max(scoreThreshold, 0.4); 
            console.log(`[RAG] Strategy applied: Instructional (How To)`);
        }

        // --- FILTER LOGIC (Soft Enforcement with Fallback) ---
        // 1. User Checkboxes (filterSources) are the HARD UNIVERSE.
        // 2. Inferred Intent (NLP) attempts to narrow this down, but if it results in 0 matches, we FALLBACK.
        
        let activeFilterSources = filterSources;
        let intentApplied = null;

        // Use pre-calculated inferredFolder
        if (inferredFolder) {
            console.log(`[RAG] 📂 NLP Intent Detected: "${inferredFolder}"`);
            
            if (filterSources && filterSources.length > 0) {
                // Check compatibility
                const isCompatible = filterSources.some(userPath => 
                    inferredFolder.startsWith(userPath) || userPath.startsWith(inferredFolder)
                );

                if (isCompatible) {
                    const narrowedSources = filterSources.map(userPath => {
                        if (inferredFolder.startsWith(userPath)) return inferredFolder; // Narrow down
                        return userPath;
                    });
                    
                    // Tentatively apply filter
                    activeFilterSources = [...new Set(narrowedSources)];
                    intentApplied = `Narrowed to "${inferredFolder}"`;
                    reportProgress('INTENT', 25, `Focusing search on: ${inferredFolder}`);
                } else {
                    console.warn(`[RAG] Inferred path ${inferredFolder} is outside user selection. Ignoring.`);
                    intentApplied = `Ignored "${inferredFolder}" (Outside Scope)`;
                }
            } else {
                // Auto-select mode
                activeFilterSources = [inferredFolder];
                intentApplied = `Auto-selected "${inferredFolder}"`;
                reportProgress('INTENT', 25, `Routed to folder: ${inferredFolder}`);
            }
        }


        // --- FEATURE: Graph-Lite Entity Boosting ---
        let entityBoostedFiles = new Set();
        // Use pre-calculated queryEntities
        if (queryEntities.length > 0) {
            console.log(`[RAG] Entities detected in query:`, queryEntities.map(e => e.name));
            for (const ent of queryEntities) {
                try {
                    const files = await dbManager.getRelatedFilesByEntity(ent.name);
                    files.forEach(f => entityBoostedFiles.add(f));
                } catch(e) {}
            }
            if (entityBoostedFiles.size > 0) {
                console.log(`[RAG] Identified ${entityBoostedFiles.size} files for Entity Boosting.`);
                reportProgress('INTENT', 28, `Detected Entity: ${queryEntities[0].name}. Boosting related docs.`);
            }
        }


        // --- OPTIMIZATION: Query Rewriting for Keyword Search ---
        // Already done in parallel: keywordQuery
        reportProgress('REWRITE', 30, 'Optimizing query keywords...');
        await this._checkPause(pauseController);
        this._checkSignal(signal);

        // const keywordQuery = await this.rewriteQuery(text); // Already computed
        
        for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                console.log(`[RAG] Query Attempt ${attempt + 1}: "${currentQuery}" (Keywords: "${keywordQuery}")`);
                reportProgress('RETRIEVAL', 40, `Searching database (Attempt ${attempt + 1})...`);
                await this._checkPause(pauseController);
                this._checkSignal(signal);

                // 1. Embed Query (Offload to Worker)
                let vector = null;
                if (this.ingestionQueue) {
                    vector = await this.ingestionQueue.query(currentQuery);
                } else {
                    // Fallback to main process if queue not ready (should not happen in prod)
                    console.warn("[RAG] IngestionQueue not set, running embedding in main process (Slow).");
                    vector = await embeddingService.getEmbedding(currentQuery);
                }

                // 2. Hybrid Retrieval
                const vecResults = await vectorStore.search(vector, 50, activeFilterSources);
                const kwResults = await vectorStore.keywordSearch(keywordQuery, 50, activeFilterSources);
                
                // Merge & Deduplicate
                const combined = new Map();
                [...vecResults, ...kwResults].forEach(doc => {
                    const key = `${doc.source}_${doc.text.substring(0, 30)}`; 
                    if (!combined.has(key)) combined.set(key, doc);
                });
                
                let candidates = Array.from(combined.values());
                console.log(`[RAG] Hybrid search found ${candidates.length} candidates.`);
                reportProgress('RETRIEVAL', 50, `Found ${candidates.length} candidates. Merging...`);

                // --- FALLBACK LOGIC ---
                // If candidates is empty AND we had a strict intent filter active, revert to broad search
                if (candidates.length === 0 && intentApplied && activeFilterSources !== filterSources) {
                    console.warn(`[RAG] Strict intent "${intentApplied}" yielded 0 results. Falling back to Broad Search...`);
                    reportProgress('RETRIEVAL', 55, `No results in focused folder. Expanding search...`);
                    
                    // Re-run search with original filterSources (User selection only)
                    const broadVec = await vectorStore.search(vector, 50, filterSources);
                    const broadKw = await vectorStore.keywordSearch(keywordQuery, 50, filterSources);
                    
                    const broadCombined = new Map();
                    [...broadVec, ...broadKw].forEach(doc => {
                        const key = `${doc.source}_${doc.text.substring(0, 30)}`; 
                        if (!broadCombined.has(key)) broadCombined.set(key, doc);
                    });
                    
                    candidates = Array.from(broadCombined.values());
                    intentApplied += " (FALLBACK TRIGGERED)";
                }

                if (candidates.length > 0 && candidates.length < 6) {
                    try {
                        const od = await this._onDemandKeywordSearch(keywordQuery || text, filterSources || activeFilterSources, { limit: 12, timeBudgetMs: 1200 });
                        if (od.length > 0) {
                            const merged = new Map();
                            candidates.forEach(doc => merged.set(`${doc.source}_${doc.text.substring(0, 30)}`, doc));
                            od.forEach(doc => merged.set(`od_${doc.source}_${doc.text.substring(0, 30)}`, doc));
                            candidates = Array.from(merged.values());
                            intentApplied = intentApplied ? `${intentApplied} + ON-DEMAND` : 'ON-DEMAND';
                        }
                    } catch (e) {}
                }

                if (candidates.length === 0) {
                     // Try one last semantic fallback with relaxed keywords if keyword search failed
                     if (attempt < MAX_RETRIES) {
                         reportProgress('REWRITE', 35, 'No results found. Retrying with broader query...');
                         const newQuery = await embeddingService.completion(`Rewrite this search query to be broader. Query: "${currentQuery}"`);
                         if (newQuery) { currentQuery = newQuery; continue; }
                     }
                     
                     // Fallback: If still no results, try a direct keyword search with the original text as a last resort
                     // This handles cases where keyword extraction failed or was too strict
                     const directKw = await vectorStore.keywordSearch(text, 20, filterSources);
                     if (directKw.length > 0) {
                         console.log(`[RAG] Last resort direct keyword search found ${directKw.length} items.`);
                         candidates = directKw;
                         intentApplied += " (DIRECT KEYWORD FALLBACK)";
                     } else {
                         try {
                             const od = await this._onDemandKeywordSearch(keywordQuery || text, filterSources || activeFilterSources, { limit: 20, timeBudgetMs: 2000 });
                             if (od.length > 0) {
                                 candidates = od;
                                 intentApplied = intentApplied ? `${intentApplied} + ON-DEMAND` : 'ON-DEMAND';
                             } else {
                                 return { context: "", sources: [], chunks: [], debugInfo: { intentApplied } };
                             }
                         } catch (e) {
                             return { context: "", sources: [], chunks: [], debugInfo: { intentApplied } };
                         }
                     }
                }

                // 3. Reranking (Cross-Encoder) & Weight Adjustment
                reportProgress('RERANK', 60, 'Reranking candidates...');
                await this._checkPause(pauseController);
                this._checkSignal(signal);

                let finalResults = [];
                const candidatePaths = candidates.map(c => c.source);
                const fileConfigs = await dbManager.getFileConfig(candidatePaths);
                
                const weightedCandidates = candidates.map(doc => {
                    const config = fileConfigs[doc.source];
                    const weightFactor = config ? config.weight : 1.0;
                    // Inject isBoosted flag for Worker
                    const isBoosted = entityBoostedFiles.has(doc.source);
                    return { ...doc, weightFactor, isBoosted };
                });

                if (this.ingestionQueue) {
                    let minScoreThreshold = 0.35; // Default definition
                    try {
                        // Offload Rerank to Worker (Robust Mode)
                        // Request all candidates to be scored so we can apply thresholding locally
                        const rerankResults = await this.ingestionQueue.rerank(currentQuery, weightedCandidates, candidates.length);
                        
                        minScoreThreshold = 0.35;
                        const highQualityResults = rerankResults.filter(doc => doc.finalScore >= minScoreThreshold);
                        
                        const filteredResults = highQualityResults.length > 0 
                            ? highQualityResults 
                            : rerankResults.slice(0, 3); // Fallback to top 3 even if low score
                            
                        finalResults = filteredResults.slice(0, topK);
                    } catch (e) {
                        console.error("[RAG] Reranker Worker failed, falling back to raw vector scores:", e);
                        // Fallback: Sort by vector score (descending)
                        finalResults = weightedCandidates
                            .sort((a, b) => (b.score || 0) - (a.score || 0))
                            .slice(0, topK);
                    }
                    
                    console.log(`[RAG] Final Selection: ${finalResults.length} chunks (Threshold: ${minScoreThreshold})`);
                    
                    // 4. Agentic Self-Correction
                    if (attempt < MAX_RETRIES && finalResults.length > 0) {
                        const topScore = finalResults[0].finalScore;
                        if (topScore < 0.2) {
                            console.log("[RAG] Low confidence. Triggering Agentic Rewrite...");
                            reportProgress('REWRITE', 70, 'Low confidence. Retrying with improved query...');
                            const prompt = `Rewrite this search query to be more effective for a semantic search. Keep the intent but use better keywords. Original: "${currentQuery}"`;
                            const newQuery = await embeddingService.completion(prompt);
                            if (newQuery) {
                                console.log(`[RAG] Rewritten to: ${newQuery}`);
                                currentQuery = newQuery;
                                continue; // Loop to retry
                            }
                        }
                    }

                } else {
                    // Fallback if no worker (should not happen)
                    finalResults = weightedCandidates.slice(0, topK);
                }

                    // 5. Parent Document Resolution (PDR) & Context Coalescing
                    // 逻辑升级：PDR (Context Expansion) + Coalescing (Merging) + MMR (Diversity)
                    // 目标：确保单点召回有足够上下文(PDR)，同时保证多点召回不碎片化(Coalescing)，且结果多样(MMR)。
                    
                    let finalChunks = finalResults;
                    
                    try {
                        // Phase 1: Parent Document Resolution (PDR) - Context Expansion
                        // 如果命中了一个子切片，尝试获取其完整的父文档窗口，以提供更丰富的上下文。
                        // 这对于“Small-to-Big”检索至关重要。
                        const parentIds = [...new Set(finalResults.map(r => r.parent_id).filter(id => !!id))];
                        if (parentIds.length > 0) {
                            console.log(`[RAG] Resolving ${parentIds.length} parent chunks for context expansion...`);
                            // 注意：getChunksByIds 可能会比较慢，但在本地 SQLite/LanceDB 中通常很快
                            const parents = await vectorStore.getChunksByIds(parentIds);
                            const parentMap = new Map(parents.map(p => [p.id, p]));
                            
                            // 用父文档替换子文档，同时继承子文档的高分
                            const expandedChunksMap = new Map();
                            
                            for (const child of finalResults) {
                                let parentFound = false;
                                if (child.parent_id && parentMap.has(child.parent_id)) {
                                    const parent = parentMap.get(child.parent_id);
                                    // 只有当 parent 有效时才进行合并
                                    if (parent) {
                                        parentFound = true;
                                        if (!expandedChunksMap.has(parent.id)) {
                                            expandedChunksMap.set(parent.id, {
                                                ...parent,
                                                finalScore: child.finalScore, // Inherit best child score
                                                source: child.source,
                                                vector: parent.vector || child.vector // Use parent vector if avail
                                            });
                                        } else {
                                            // Update score if this child is better
                                            const existing = expandedChunksMap.get(parent.id);
                                            if (child.finalScore > existing.finalScore) {
                                                existing.finalScore = child.finalScore;
                                            }
                                        }
                                    }
                                }
                                
                                // 如果没有找到 Parent (或者没有 parent_id)，则保留 Child 原样
                                if (!parentFound) {
                                    expandedChunksMap.set(child.id, child);
                                }
                            }
                            finalChunks = Array.from(expandedChunksMap.values());
                            // Re-sort after expansion
                            finalChunks.sort((a, b) => b.finalScore - a.finalScore);
                            console.log(`[RAG] PDR Expanded: ${finalResults.length} children -> ${finalChunks.length} parent contexts.`);
                        }

                        // Phase 2: Pre-MMR Coalescing (Merging Overlapping/Adjacent Parents)
                        // 即使是父文档，有时也可能被分割成多段。如果检索到了相邻的父文档段，也应该合并。
                        const groups = {};
                        finalChunks.forEach(c => {
                            if (!groups[c.source]) groups[c.source] = [];
                            groups[c.source].push(c);
                        });
                        
                        const coalescedCandidates = [];
                        
                        Object.keys(groups).forEach(source => {
                            const chunks = groups[source];
                            chunks.sort((a, b) => (a.chunk_index || 0) - (b.chunk_index || 0));
                            
                            let currentMerge = null;
                            
                            chunks.forEach(chunk => {
                                if (!currentMerge) {
                                    currentMerge = { ...chunk, mergedIds: [chunk.id] };
                                    return;
                                }
                                
                                // 判断是否相邻 (索引差值 <= 2)
                                const lastIndex = currentMerge.chunk_index || 0;
                                const currIndex = chunk.chunk_index || 0;
                                
                                if (currIndex - lastIndex <= 2) {
                                    // 合并！
                                    currentMerge.text += "\n...\n" + chunk.text;
                                    currentMerge.finalScore = Math.max(currentMerge.finalScore, chunk.finalScore); 
                                    currentMerge.mergedIds.push(chunk.id);
                                    if (chunk.finalScore > currentMerge.finalScore && chunk.vector) {
                                        currentMerge.vector = chunk.vector;
                                    }
                                    currentMerge.chunk_index = currIndex; 
                                } else {
                                    coalescedCandidates.push(currentMerge);
                                    currentMerge = { ...chunk, mergedIds: [chunk.id] };
                                }
                            });
                            
                            if (currentMerge) coalescedCandidates.push(currentMerge);
                        });
                        
                        coalescedCandidates.sort((a, b) => b.finalScore - a.finalScore);

                        // Phase 3: MMR (Maximal Marginal Relevance) Reranking
                        // 对最终的富上下文进行多样性筛选
                        
                        const mmrSelected = [];
                        const lambda = 0.7; 
                        
                        // 检测候选集中的来源多样性
                        // 如果候选集全部来自同一个文件（单文件问答模式），则关闭 Source Penalty
                        // 否则 MMR 会错误地惩罚所有后续切片，导致排序扭曲
                        const uniqueCandidateSources = new Set(coalescedCandidates.map(c => c.source));
                        const isSingleSourceContext = uniqueCandidateSources.size === 1;
                        
                        const calculateSim = (vecA, vecB) => {
                            if (!vecA || !vecB) return 0;
                            // Ensure arrays (handle TypedArrays or Buffer)
                            const a = Array.isArray(vecA) ? vecA : Array.from(vecA);
                            const b = Array.isArray(vecB) ? vecB : Array.from(vecB);
                            return a.reduce((sum, val, i) => sum + val * (b[i] || 0), 0);
                        };

                        const candidates = [...coalescedCandidates];
                        
                        while (mmrSelected.length < topK && candidates.length > 0) {
                            let bestScore = -Infinity;
                            let bestIdx = -1;

                            for (let i = 0; i < candidates.length; i++) {
                                const cand = candidates[i];
                                const relevance = cand.finalScore;
                                let maxSim = 0;
                                
                                for (const selected of mmrSelected) {
                                    // 仅在多文件场景下启用 Source Penalty
                                    // 目的：在全库搜索时，强迫系统跨文件寻找答案
                                    // 保护：在单文件问答时，不惩罚同源，专注于文件内部的语义多样性
                                    if (!isSingleSourceContext && selected.source === cand.source) {
                                        maxSim = Math.max(maxSim, 0.5); // Source penalty
                                    }
                                    
                                    if (cand.vector && selected.vector) {
                                        maxSim = Math.max(maxSim, calculateSim(cand.vector, selected.vector));
                                    }
                                }
                                
                                const mmrScore = lambda * relevance - (1 - lambda) * maxSim;
                                if (mmrScore > bestScore) {
                                    bestScore = mmrScore;
                                    bestIdx = i;
                                }
                            }
                            
                            if (bestIdx !== -1) {
                                mmrSelected.push(candidates[bestIdx]);
                                candidates.splice(bestIdx, 1);
                            } else {
                                break; 
                            }
                        }
                        
                        finalChunks = mmrSelected;
                        console.log(`[RAG] MMR Selected ${finalChunks.length} final contexts.`);

                    } catch (err) {
                        console.warn("[RAG] Advanced Context Processing failed, using defaults:", err);
                        // Fallback to basic results if PDR/MMR fails
                    }

                    // 6. Format Output (Enhanced Context Separation)
                    reportProgress('DONE', 100, 'Context assembly complete.');

                    // --- Privacy Logic Start ---
                    // Lazy load privacy service
                    let privacyService = null;
                    try { privacyService = require('../privacyService'); } catch(e) {}
                    
                    let shouldAnonymize = privacyService && privacyService.isEnabled;
                    
                    if (privacyService && !shouldAnonymize) {
                         // Check folder-level privacy
                         for (const chunk of finalChunks) {
                             if (privacyService.isPrivacyProtected(chunk.source)) {
                                 console.log(`[RAG] Privacy triggered by source: ${chunk.source}`);
                                 shouldAnonymize = true;
                                 break;
                             }
                         }
                    }

                    // Pre-anonymize context if needed to ensure safety before leaving this function
                    // Wait, this function returns `context` string. The CALLER (main.js) usually calls `embeddingService.completion`
                    // Let's check where `ragEngine.query` is called.
                    // It is called in `main.js`: ipcMain.handle('kb-query', ...)
                    // And THEN main.js calls LLM?
                    // No, usually RAG engine does the generation OR returns context for main to do generation.
                    // Let's check `ragEngine.query` return value. 
                    // It returns { context, sources, chunks ... }
                    // Wait, looking at lines 1482+, it returns context.
                    // But where is the LLM generation?
                    // Ah, I missed the generation block in my previous `Read`.
                    // The code I read was inside `_runRetrievalInBatches`? No, it's inside `query`.
                    // The previous `Read` showed:
                    // `// 6. Generate Answer (if QA mode)` was MISSING in the latest Read!
                    // It seems I was looking at `_runRetrievalInBatches` or `query` structure differently.
                    // Line 1482 says "Format Output". And then returns object with context.
                    // This means `ragEngine.query` only does RETRIEVAL.
                    // The GENERATION must be in `main.js` or `KnowledgeBase.tsx` calling a separate endpoint?
                    // Let's check `main.js` again.
                    
                    // Format context with clear file boundaries to prevent LLM from blending sources
                    const context = finalChunks.map((r, i) => 
                        `[[FILE_START_ID:${i+1}]]\nSOURCE_FILENAME: ${path.basename(r.source)}\nCONTENT:\n${r.text}\n[[FILE_END_ID:${i+1}]]`
                    ).join('\n\n');
                    
                    // --- LIFECYCLE HOOK: Increment Ref Count ---
                    const usedSources = [...new Set(finalChunks.map(r => r.source))];
                    if (usedSources.length > 0) {
                        dbManager.incrementFileRefs(usedSources).catch(err => console.error("Stats update failed:", err));
                    }
                    
                    const retrievalQuality = this._evaluateRetrievalQuality(finalChunks, { params: { topK, filterSources: activeFilterSources } });
                    return {
                        context,
                        sources: finalChunks.map(r => r.source),
                        chunks: finalChunks.map((r, i) => ({
                            index: i + 1, 
                            text: r.text,
                            source: r.source,
                            score: r.finalScore || 0,
                            id: r.id, 
                            parent_id: r.parent_id,
                            filename: path.basename(r.source),
                            mergedIds: r.mergedIds // Track merged chunks for debugging
                        })),
                        // Pass privacy flag to caller
                        privacyTriggered: shouldAnonymize, 
                        retrievalQuality,
                    // White-box Debug Info
                    debugInfo: {
                        detectedEntities: queryEntities.map(e => ({ name: e.name, type: e.type })),
                        boostedFileCount: entityBoostedFiles.size,
                        intentApplied,
                        fallbackTriggered: intentApplied && intentApplied.includes('FALLBACK')
                    }
                };

            } catch (e) {
                console.error(`[RAG] Query Attempt ${attempt} Failed:`, e);
                if (attempt === MAX_RETRIES) throw e;
            }
        }
        return { 
            context: "", 
            sources: [], 
            chunks: [], 
            retrievalQuality: 0,
            debugInfo: { 
                detectedEntities: [], 
                boostedFileCount: 0,
                intentApplied,
                error: "Max retries exceeded"
            } 
        };
    }

    async _getIndexedSourcesSet() {
        const now = Date.now();
        if (this._indexedSourcesCache && (now - this._indexedSourcesCache.ts) < 60_000 && this._indexedSourcesCache.set) {
            return this._indexedSourcesCache.set;
        }
        try {
            const sources = await vectorStore.getAllSources();
            const set = new Set(sources.map(s => String(s || '').replace(/\\/g, '/').toLowerCase()));
            this._indexedSourcesCache = { ts: now, set };
            return set;
        } catch (e) {
            const set = this._indexedSourcesCache?.set || new Set();
            this._indexedSourcesCache = { ts: now, set };
            return set;
        }
    }

    _resolveCandidateFiles(filterSources, options = {}) {
        const maxFiles = Math.max(20, Math.min(Number(options.maxFiles) || 400, 3000));
        const maxDepth = Math.max(1, Math.min(Number(options.maxDepth) || 8, 30));
        const out = [];
        const seen = new Set();

        const pushFile = (p) => {
            if (!p || typeof p !== 'string') return;
            const key = p.replace(/\\/g, '/').toLowerCase();
            if (seen.has(key)) return;
            seen.add(key);
            out.push(p);
        };

        const stack = [];
        (Array.isArray(filterSources) ? filterSources : []).forEach(s => stack.push({ p: s, d: 0 }));

        while (stack.length > 0 && out.length < maxFiles) {
            const { p, d } = stack.pop();
            if (!p || typeof p !== 'string') continue;
            if (!fs.existsSync(p)) continue;

            let st;
            try { st = fs.statSync(p); } catch (e) { continue; }
            if (st.isFile()) {
                pushFile(p);
                continue;
            }
            if (!st.isDirectory()) continue;
            if (d >= maxDepth) continue;

            let entries = [];
            try { entries = fs.readdirSync(p, { withFileTypes: true }); } catch (e) { continue; }
            for (const entry of entries) {
                if (out.length >= maxFiles) break;
                if (!entry || !entry.name) continue;
                if (entry.name.startsWith('.')) continue;
                const fullPath = path.join(p, entry.name);
                if (entry.isDirectory()) stack.push({ p: fullPath, d: d + 1 });
                else stack.push({ p: fullPath, d: d + 1 });
            }
        }

        return out;
    }

    async _onDemandKeywordSearch(query, filterSources, options = {}) {
        const q = String(query || '').trim();
        if (!q) return [];
        const qLower = q.toLowerCase();
        const limit = Math.max(1, Math.min(Number(options.limit) || 20, 60));
        const timeBudgetMs = Math.max(200, Math.min(Number(options.timeBudgetMs) || 1500, 10_000));
        const started = Date.now();

        const indexed = await this._getIndexedSourcesSet();
        const candidates = this._resolveCandidateFiles(filterSources, { maxFiles: 600, maxDepth: 10 });

        const results = [];
        const terms = qLower.split(/\s+/).map(t => t.trim()).filter(t => t.length >= 2).slice(0, 8);

        for (const filePath of candidates) {
            if (results.length >= limit) break;
            if ((Date.now() - started) > timeBudgetMs) break;
            const norm = String(filePath || '').replace(/\\/g, '/').toLowerCase();
            if (indexed.has(norm)) continue;

            const text = await extractTextForSearch(filePath, { maxChars: 20000, maxBytes: 50 * 1024 * 1024 });
            if (!text) continue;
            const textLower = text.toLowerCase();

            let hitIndex = -1;
            if (qLower.length >= 2) hitIndex = textLower.indexOf(qLower);
            if (hitIndex < 0 && terms.length > 0) {
                for (const t of terms) {
                    hitIndex = textLower.indexOf(t);
                    if (hitIndex >= 0) break;
                }
            }
            if (hitIndex < 0) continue;

            const start = Math.max(0, hitIndex - 160);
            const end = Math.min(text.length, hitIndex + 400);
            const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();

            results.push({
                id: uuidv4(),
                source: filePath,
                text: snippet,
                context: 'ON_DEMAND_UNINDEXED',
                vector_text: `${path.basename(filePath)}\n${snippet}`,
                timestamp: Date.now(),
                score: 0.2
            });
        }

        return results;
    }

    _extractKeywords(text) {
        // Simple tokenizer for Chinese/English
        // Remove stop words and punctuation
        const stopWords = new Set([
            "的", "了", "和", "是", "就", "都", "而", "及", "与", "着",
            "the", "a", "an", "and", "or", "but", "is", "are", "in", "on", "at", "to", "for"
        ]);

        return text.toLowerCase()
            .replace(/[.,/#!$%^&*;:{}=\-_`~()。，！？、]/g, " ")
            .split(/\s+/)
            .filter(w => w.length > 1 && !stopWords.has(w)) // Ignore single chars and stop words
            .slice(0, 15); // Limit to top 15 keywords
    }
}


module.exports = new RAGEngine();
