const { ipcMain } = require('electron');
const path = require('path');
const { Worker } = require('worker_threads');
const vectorStore = require('./vectorStore'); // Main process DB access
const dbManager = require('../../databaseManager'); // For file stats

class IngestionQueue {
    constructor(ragEngine, webContents, config = {}) {
        this.ragEngine = ragEngine;
        this.webContents = webContents;
        this.config = config; // { resourcesPath, embeddingConfig }
        
        this.queue = [];
        this.processing = false;
        this.totalFiles = 0;
        this.processedFiles = 0;
        
        // Worker Pool (Single worker for now to avoid memory explosion with LLMs)
        this.worker = null;
        this.workerReady = false;
        this.workerBusy = false;
        
        this.pendingRequests = new Map(); // requestId -> { resolve, reject }
        
        this.initWorker();
    }

    async getRagChunkingConfig() {
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

            return {
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
            return {
                mode: 'parent_child',
                parentSize: 2000,
                parentOverlap: 200,
                childSize: 500,
                childOverlap: 50,
                chunkSize: 600,
                overlap: 100,
                separators: ["\n\n", "\n", "。", "！", "？", ".", "!", "?", "；", ";", " ", ""],
                maxChunksPerFile: 0,
                maxEmbeddingsPerFile: 0
            };
        }
    }

    async getRagEmbeddingDim() {
        try {
            const dim = await dbManager.getSetting('rag_embedding_dim');
            const n = typeof dim === 'string' ? Number(dim) : dim;
            return typeof n === 'number' && n > 0 ? n : 0;
        } catch (e) {
            return 0;
        }
    }

    initWorker() {
        if (this.worker) return;

        const workerPath = path.join(__dirname, 'ragWorker.js');
        console.log(`[IngestionQueue] Starting Worker: ${workerPath}`);
        
        this.worker = new Worker(workerPath, {
            workerData: {
                config: this.config.embeddingConfig || {},
                resourcesPath: this.config.resourcesPath
            }
        });

        this.worker.on('message', async (message) => {
            if (message.type === 'ready') {
                console.log("[IngestionQueue] Worker is ready.");
                this.workerReady = true;
                this.processNext();
            } else if (message.type === 'progress') {
                // Relay progress
                this.sendProgress(message.filePath, message.status);
            } else if (message.type === 'batch_result') {
                // Handle incremental batch from worker
                await this.handleBatchResult(message);
            } else if (message.type === 'result') {
                this.handleWorkerResult(message);
            } else if (message.type === 'query_result' || message.type === 'rerank_result') {
                const req = this.pendingRequests.get(message.requestId);
                if (req) {
                    if (message.success) req.resolve(message.vector || message.results);
                    else req.reject(new Error(message.error));
                    this.pendingRequests.delete(message.requestId);
                }
            } else if (message.type === 'error') {
                console.error("[IngestionQueue] Worker Error:", message.error);
            }
        });

        this.worker.on('error', (err) => {
            console.error("[IngestionQueue] Worker Fatal Error:", err);
            // Fail all pending requests
            for (const req of this.pendingRequests.values()) req.reject(err);
            this.pendingRequests.clear();
            
            // Restart logic?
            this.worker = null;
            this.workerReady = false;
            this.workerBusy = false;
            setTimeout(() => this.initWorker(), 1000);
        });

        this.worker.on('exit', (code) => {
            if (code !== 0) console.warn(`[IngestionQueue] Worker stopped with exit code ${code}`);
            this.worker = null;
            this.workerReady = false;
            this.workerBusy = false;
        });
    }

    // --- Async Worker API ---
    async query(text) {
        if (!this.worker) throw new Error("Worker not initialized");
        const requestId = Math.random().toString(36).substring(7);
        return new Promise((resolve, reject) => {
            this.pendingRequests.set(requestId, { resolve, reject });
            this.worker.postMessage({ type: 'query', text, requestId });
        });
    }

    async rerank(query, documents, topK) {
        if (!this.worker) throw new Error("Worker not initialized");
        const requestId = Math.random().toString(36).substring(7);
        
        // --- Fix DataCloneError ---
        // Create a sanitized lightweight array for the Worker
        const payloadDocs = documents.map((doc, index) => ({
            text: doc.text,
            vector_text: doc.vector_text,
            weightFactor: doc.weightFactor,
            isBoosted: doc.isBoosted,
            _index: index 
        }));

        return new Promise((resolve, reject) => {
            this.pendingRequests.set(requestId, { 
                resolve: (results) => {
                    // Re-hydrate results with original document properties
                    const hydratedResults = results.map(res => {
                        const original = documents[res._index];
                        return { ...original, finalScore: res.finalScore };
                    });
                    resolve(hydratedResults);
                },
                reject 
            });
            
            // Send sanitized payload
            this.worker.postMessage({ type: 'rerank', query, documents: payloadDocs, topK, requestId });
        });
    }

    async handleBatchResult(message) {
        const { docs, filePath } = message;
        if (docs && docs.length > 0) {
            try {
                await vectorStore.addDocuments(docs);
            } catch (e) {
                console.error(`[IngestionQueue] Batch DB Write Error for ${filePath}:`, e);
            }
        }
    }

    async handleWorkerResult(message) {
        const { success, docs, filePath, error, entities } = message;
        this.workerBusy = false;

        if (success) {
            try {
                // Add remaining docs if any (legacy or final batch)
                if (docs && docs.length > 0) {
                    await vectorStore.addDocuments(docs);
                }
                
                this.processedFiles++;
                
                // Register ingest time in stats DB
                dbManager.updateFileStats(filePath, { 
                    ingest_time: Date.now(),
                    status: 'active' 
                }).catch(e => console.error("Failed to update ingest stats:", e));

                // Save extracted entities (Graph-Lite)
                if (entities && entities.length > 0) {
                    dbManager.saveEntityRelationships(filePath, entities)
                        .catch(e => console.error("Failed to save entities:", e));
                }

                this.sendProgress(filePath, 'completed');
            } catch (e) {
                console.error("DB Write Error (Final):", e);
                this.sendProgress(filePath, 'failed', e.message);
            }
        } else {
            this.sendProgress(filePath, 'failed', error || "No docs generated");
        }

        // Trigger next
        this.processNext();
    }

    addFile(file) {
        this.queue.push(file);
        this.totalFiles++;
        this.processNext();
        return { success: true, status: 'queued' };
    }

    // Alias for compatibility
    add(file) {
        return this.addFile(file);
    }

    async processNext() {
        if (!this.workerReady || this.workerBusy || this.queue.length === 0) {
            if (this.queue.length === 0 && !this.workerBusy) {
                this.processing = false;
                this.sendProgress(); // All done
            }
            return;
        }

        this.processing = true;
        this.workerBusy = true;
        const file = this.queue.shift();

        this.sendProgress(file.path, 'processing');
        
        // Clear old documents BEFORE starting processing (Atomic start)
        // This supports the streaming/batching model where we add docs incrementally.
        try {
            await vectorStore.deleteDocuments(file.path);
        } catch (e) {
            console.warn(`[IngestionQueue] Failed to clear old documents for ${file.path} (might be new file):`, e.message);
        }

        // Fetch known projects for Entity Extraction (Graph-Lite)
        let projectNames = [];
        try {
            const projects = await dbManager.getAllProjects();
            projectNames = projects.map(p => p.title);
        } catch (e) {
            console.warn("Failed to fetch projects for NER:", e);
        }

        // Dispatch to Worker
        const ragChunking = await this.getRagChunkingConfig();
        const ragEmbeddingDim = await this.getRagEmbeddingDim();
        this.worker.postMessage({
            type: 'ingest',
            filePath: file.path,
            metadata: { filename: file.name },
            options: {
                ...(file.options || {}),
                ragChunking,
                ragEmbeddingDim,
                knownProjects: projectNames
            }
        });
    }

    sendProgress(currentFile = null, status = 'idle', error = null) {
        if (this.webContents) {
            this.webContents.send('kb-ingest-progress', {
                total: this.totalFiles,
                processed: this.processedFiles,
                pending: this.queue.length,
                currentFile,
                status,
                error
            });
        }
    }

    resetStats() {
        if (this.queue.length === 0 && !this.workerBusy) {
            this.totalFiles = 0;
            this.processedFiles = 0;
        }
    }
}

module.exports = IngestionQueue;
