const OpenAI = require('openai');
const path = require('path');
// const privacyService = require('../privacyService'); // Lazy load to avoid Worker crash

class HybridEmbeddingService {
    constructor() {
        this.client = null;
        this.config = {
            provider: 'openai', // 'openai' | 'baidu' | 'hybrid'
            apiKey: '',
            secretKey: '',
            baseUrl: '',
            model: 'text-embedding-ada-002',
            hfToken: '',
            jinaKey: '',
            deepseekKey: '',
            deepseekStatus: 'active',
            googleKey: '',
            googleStatus: 'active',
            modelBasePath: null // New: Allow injecting path for Worker support
        };
        
        // Cache
        this.cache = new Map();

        this.embeddingDim = null;
        
        // Baidu Token
        this.baiduToken = null;
        this.baiduTokenExpire = 0;

        // Local Model (Lazy Load)
        this.localPipeline = null;
        this.isLocalLoading = false;
    }

    configure(config) {
        // config: { provider, apiKey, secretKey, baseUrl, model, hfToken, jinaKey }
        const nextConfig = { ...this.config, ...config };
        const dimSensitiveChanged =
            nextConfig.provider !== this.config.provider ||
            nextConfig.model !== this.config.model ||
            nextConfig.baseUrl !== this.config.baseUrl ||
            nextConfig.apiKey !== this.config.apiKey;

        this.config = nextConfig;
        if (dimSensitiveChanged) {
            this.embeddingDim = null;
        }
        
        // Reset client if needed
        if (this.config.provider === 'openai' && this.config.apiKey) {
            this.client = new OpenAI({
                apiKey: this.config.apiKey,
                baseURL: this.config.baseUrl || 'https://api.minimax.chat/v1',
            });
        } else {
            this.client = null;
        }
        
        // Clear cache if provider changes? No, embeddings are usually stable per text. 
        // But if model changes, embeddings change. 
        // For simplicity, we keep cache but maybe we should key it by model too.
        // Let's keep it simple: cache is text -> embedding. If user switches model, results might be mixed.
        // In a real app, cache key should be `model:text`.
    }

    async completion(prompt) {
        // Used for Contextual Retrieval (Ingestion) & Agentic Rewrite
        try {
            // --- Privacy Sandbox Integration ---
            let effectivePrompt = prompt;
            let privacyMapping = null;
            
            // Lazy load privacy service to prevent worker thread crash (DatabaseManager dependency)
            let privacyService = null;
            try {
                privacyService = require('../privacyService');
            } catch (e) {
                console.warn("Privacy Service not available (Worker context?)");
            }

            if (privacyService && privacyService.isEnabled) {
                 console.log("[PrivacySandbox] Anonymizing outgoing prompt...");
                 const result = await privacyService.anonymize(prompt);
                 effectivePrompt = result.text;
                 privacyMapping = result.mapping;
            }

            let responseText = null;

            // 1. Priority: RAG-Specific Configuration (Manual Override)
            if (this.client) { // OpenAI / Compatible configured in RAG tab
                const response = await this.client.chat.completions.create({
                    messages: [{ role: "user", content: effectivePrompt }],
                    model: "gpt-3.5-turbo", // Default
                });
                responseText = response.choices[0].message.content;
            } else if (this.config.provider === 'baidu' && this.config.apiKey) {
                const token = await this._getBaiduAccessToken();
                const url = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/chat/completions?access_token=${token}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ messages: [{ role: "user", content: effectivePrompt }] })
                });
                const data = await res.json();
                responseText = data.result;
            }

            // 2. Priority: Main API (DeepSeek) - Preferred
            else if (this.config.deepseekKey && this.config.deepseekStatus === 'active') {
                const deepseek = new OpenAI({
                    apiKey: this.config.deepseekKey,
                    baseURL: 'https://api.deepseek.com/v1'
                });
                const response = await deepseek.chat.completions.create({
                    messages: [{ role: "user", content: effectivePrompt }],
                    model: "deepseek-chat",
                });
                responseText = response.choices[0].message.content;
            }

            // 3. Priority: Main API (Google Gemini) - Fallback
            else if (this.config.googleKey && this.config.googleStatus === 'active') {
                // Use REST API for simplicity to avoid import issues or reuse SDK if available
                // Gemini Flash 1.5 is good for this
                const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${this.config.googleKey}`;
                const res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: effectivePrompt }] }]
                    })
                });
                const data = await res.json();
                responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
            }

            // --- Privacy Sandbox Restoration ---
            if (responseText && privacyMapping && privacyService) {
                console.log("[PrivacySandbox] Restoring sensitive info in response...");
                const result = await privacyService.deanonymize(responseText, privacyMapping);
                return result.text;
            }

            return responseText;

        } catch (e) {
            console.error("Completion for Context Enrichment failed:", e);
        }
        return null; // Fail silently, fallback to no context
    }

    async getEmbedding(text) {
        const cleanText = text.replace(/\n/g, ' ');
        const cacheKey = `${this.config.provider}:${this.config.model}:${cleanText}`;

        // 1. Check Cache
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        let embedding = null;

        try {
            if (this.config.provider === 'hybrid') {
                embedding = await this._getHybridEmbedding(cleanText);
            } else if (this.config.provider === 'baidu') {
                embedding = await this._getBaiduEmbedding(cleanText);
            } else {
                embedding = await this._getOpenAIEmbedding(cleanText);
            }
        } catch (e) {
            console.error(`Embedding failed (${this.config.provider}):`, e);
            // Fallback to local if not already tried in hybrid
            if (this.config.provider !== 'hybrid') {
                 console.log("Falling back to local model due to error...");
                 embedding = await this._getLocalEmbedding(cleanText);
            } else {
                throw e;
            }
        }

        if (embedding) {
            if (Array.isArray(embedding)) {
                if (this.embeddingDim === null) {
                    this.embeddingDim = embedding.length;
                } else if (this.embeddingDim !== embedding.length) {
                    throw new Error(`Embedding dimension changed at runtime (${this.embeddingDim} -> ${embedding.length}). Please reset and rebuild index.`);
                }
            }
            // Cache result (limit cache size?)
            if (this.cache.size > 1000) {
                const firstKey = this.cache.keys().next().value;
                this.cache.delete(firstKey);
            }
            this.cache.set(cacheKey, embedding);
        }

        return embedding;
    }

    async getEmbeddingDim() {
        if (this.embeddingDim !== null) return this.embeddingDim;
        const vec = await this.getEmbedding('dimension probe');
        if (Array.isArray(vec)) return vec.length;
        return null;
    }

    async _getHybridEmbedding(text) {
        // Strategy: Try Free APIs -> Fallback to Local
        const errors = [];

        // 1. Baidu (If configured) - High quota, fast
        if (this.config.apiKey && this.config.secretKey) {
            try {
                return await this._getBaiduEmbedding(text);
            } catch (e) { errors.push(`Baidu: ${e.message}`); }
        }

        // 2. HuggingFace API (If token present)
        if (this.config.hfToken) {
            try {
                return await this._getHuggingFaceEmbedding(text);
            } catch (e) { errors.push(`HF: ${e.message}`); }
        }

        // 3. Jina AI (If key present)
        if (this.config.jinaKey) {
             try {
                return await this._getJinaEmbedding(text);
            } catch (e) { errors.push(`Jina: ${e.message}`); }
        }

        // 4. Local Fallback
        // Always try local fallback if cloud APIs fail
        console.warn("All Cloud APIs failed or skipped, switching to local model...", errors);
        try {
            return await this._getLocalEmbedding(text);
        } catch (e) {
            errors.push(`Local: ${e.message}`);
            // If even local fails, throw combined error
            throw new Error("All embedding methods failed:\n" + errors.join("\n"));
        }
    }

    async _getBaiduEmbedding(text) {
        if (!this.config.apiKey || !this.config.secretKey) throw new Error("Missing Baidu Keys");
        const token = await this._getBaiduAccessToken();
        const url = `https://aip.baidubce.com/rpc/2.0/ai_custom/v1/wenxinworkshop/embeddings/embedding-v1?access_token=${token}`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ input: [text] })
        });
        const data = await response.json();
        if (data.data?.[0]?.embedding) return data.data[0].embedding;
        throw new Error(JSON.stringify(data));
    }

    async _getHuggingFaceEmbedding(text) {
        // Uses BAAI/bge-m3 or similar popular model
        const model = "BAAI/bge-m3"; 
        const response = await fetch(`https://api-inference.huggingface.co/pipeline/feature-extraction/${model}`, {
            headers: { Authorization: `Bearer ${this.config.hfToken}` },
            method: "POST",
            body: JSON.stringify({ inputs: text, options: { wait_for_model: true } }),
        });
        const result = await response.json();
        if (Array.isArray(result)) return result; // 1D array or nested? usually 1D for feature-extraction if single input
        // Check format
        if (result.error) throw new Error(result.error);
        return result; 
    }

    async _getJinaEmbedding(text) {
        const response = await fetch('https://api.jina.ai/v1/embeddings', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.config.jinaKey}`
            },
            body: JSON.stringify({
                model: 'jina-embeddings-v2-base-en', // or zh
                input: [text]
            })
        });
        const data = await response.json();
        return data.data[0].embedding;
    }

    async _getOpenAIEmbedding(text) {
        if (!this.client) throw new Error("OpenAI Client not initialized");
        const response = await this.client.embeddings.create({
            model: this.config.model,
            input: text,
        });
        return response.data[0].embedding;
    }

    async _getLocalEmbedding(text) {
        // Lazy load Xenova
        if (!this.localPipeline) {
            if (this.isLocalLoading) {
                 // Wait for existing promise to resolve
                 return new Promise((resolve, reject) => {
                     const check = setInterval(() => {
                         if (!this.isLocalLoading) {
                             clearInterval(check);
                             if (this.localPipeline) {
                                 this._getLocalEmbedding(text).then(resolve).catch(reject);
                             } else {
                                 reject(new Error("Local model failed to load"));
                             }
                         }
                     }, 100);
                     // Timeout 60s
                     setTimeout(() => { clearInterval(check); reject(new Error("Local model load timeout")); }, 60000);
                 });
            }
            this.isLocalLoading = true;
            try {
                // Dynamic import to avoid load at startup
                const { pipeline, env } = await import('@xenova/transformers');
                
                // Import fs to check paths
                const fs = require('fs');

                // Define candidate paths
                // Priority 1: Configured path (from Worker/Main injection)
                // Priority 2: Electron resources path (if available in process)
                // Priority 3: Dev path relative to this file
                
                let modelPath = '';
                
                if (this.config.modelBasePath) {
                     modelPath = path.join(this.config.modelBasePath, 'models');
                     console.log(`[Embedding] Using configured model path: ${modelPath}`);
                } else if (process.resourcesPath) {
                     const prodPath = path.join(process.resourcesPath, 'models');
                     if (fs.existsSync(prodPath)) modelPath = prodPath;
                }

                if (!modelPath) {
                     // Fallback to dev path
                     const devPath = path.join(__dirname, '../../..', 'resources', 'models');
                     if (fs.existsSync(devPath)) {
                         modelPath = devPath;
                     }
                }

                if (!modelPath) {
                    console.error("[Embedding] Critical: No valid model path found.");
                    // Last ditch: try to use what we had before as default
                    modelPath = path.join(__dirname, '../../..', 'resources', 'models');
                }

                console.log(`[Embedding] Loading local model from: ${modelPath}`);

                env.localModelPath = modelPath;
                // Important: Transformers.js searches for models in `${localModelPath}/{model_name}` 
                // OR directly in `localModelPath` if using cache dir logic.
                // Since we put models in resources/models/Xenova/all-MiniLM-L6-v2, 
                // and we call pipeline with 'Xenova/all-MiniLM-L6-v2',
                // it will look in ${modelPath}/Xenova/all-MiniLM-L6-v2.
                // This matches our structure!
                
                // ALSO set cacheDir just in case internal logic prefers it
                env.cacheDir = modelPath;
                
                env.allowRemoteModels = false; // Force offline mode

                // Load pipeline
                // Try BGE-M3 (SOTA) first, fallback to MiniLM if missing
                // Optimize for low memory: intraOpNumThreads=1, interOpNumThreads=1
                const sessionOptions = {
                    intraOpNumThreads: 1,
                    interOpNumThreads: 1,
                    executionMode: 'sequential',
                    graphOptimizationLevel: 'all'
                };

                try {
                    console.log("Attempting to load Xenova/bge-m3...");
                    this.localPipeline = await pipeline('feature-extraction', 'Xenova/bge-m3', {
                        local_files_only: true,
                        session_options: sessionOptions
                    });
                    console.log("✅ Local model (BGE-M3) loaded successfully");
                } catch (bgeError) {
                    console.warn("⚠️ BGE-M3 not found or failed to load. Falling back to all-MiniLM-L6-v2.", bgeError.message);
                    this.localPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
                        local_files_only: true,
                        session_options: sessionOptions
                    });
                    console.log("✅ Fallback model (MiniLM) loaded successfully");
                }
            } catch (e) {
                console.error("❌ Local model load error (Final):", e);
                this.isLocalLoading = false;
                throw e;
            }
            this.isLocalLoading = false;
        }

        const output = await this.localPipeline(text, { pooling: 'mean', normalize: true });
        // output.data is Float32Array
        return Array.from(output.data);
    }

    async _getBaiduAccessToken() {
        if (this.baiduToken && Date.now() < this.baiduTokenExpire) return this.baiduToken;
        const url = `https://aip.baidubce.com/oauth/2.0/token?grant_type=client_credentials&client_id=${this.config.apiKey}&client_secret=${this.config.secretKey}`;
        const res = await fetch(url, { method: 'POST' });
        const data = await res.json();
        if (data.access_token) {
            this.baiduToken = data.access_token;
            this.baiduTokenExpire = Date.now() + (data.expires_in - 60) * 1000;
            return this.baiduToken;
        }
        throw new Error(data.error_description || "Baidu Auth Failed");
    }
}

module.exports = new HybridEmbeddingService();
