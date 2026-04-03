const lancedb = require('@lancedb/lancedb');
const path = require('path');
const { app } = require('electron');
const fs = require('fs');

class VectorStore {
    constructor() {
        this.db = null;
        this.table = null;
        this.tableName = 'ngo_knowledge_base';
        this.baseDir = path.join(app.getPath('userData'), 'lancedb_store');
        
        // Save initialization promise to await later
        this.initPromise = this.init();
    }

    async init() {
        try {
            if (!fs.existsSync(this.baseDir)) {
                fs.mkdirSync(this.baseDir, { recursive: true });
            }
            this.db = await lancedb.connect(this.baseDir);
            
            // Check if table exists
            const tables = await this.db.tableNames();
            if (tables.includes(this.tableName)) {
                this.table = await this.db.openTable(this.tableName);
                // Try getting row count (if supported) or just log success
                try {
                    const count = await this.table.countRows();
                    console.log(`[VectorStore] Init success. Table '${this.tableName}' has ${count} rows.`);
                } catch (e) {
                    console.log(`[VectorStore] Init success. Table '${this.tableName}' opened.`);
                }
            } else {
                console.log("[VectorStore] Table does not exist yet. Waiting for first ingestion.");
            }
        } catch (e) {
            console.error("[VectorStore] Failed to init LanceDB:", e);
        }
    }

    // Helper to ensure initialization is complete
    async ensureReady() {
        if (this.initPromise) {
            await this.initPromise;
        }
    }

    async recreateTable() {
        await this.ensureReady();
        try {
            const tables = await this.db.tableNames();
            if (tables.includes(this.tableName)) {
                await this.db.dropTable(this.tableName);
                this.table = null;
                console.log(`[VectorStore] Table '${this.tableName}' dropped for schema upgrade.`);
            }
        } catch (e) {
            console.error("[VectorStore] Failed to drop table:", e);
        }
    }

    async getVectorDimension() {
        await this.ensureReady();
        if (!this.table) return null;
        try {
            const rows = await this.table.query().select(['vector']).limit(1).toArray();
            const vec = rows?.[0]?.vector;
            if (vec && typeof vec.length === 'number' && vec.length > 0) return vec.length;
            return null;
        } catch (e) {
            return null;
        }
    }

    _buildSourceFilter(sources) {
        if (!Array.isArray(sources) || sources.length === 0) return null;
        
        // Generate SQL condition for "Exact Match OR Directory Prefix"
        // This enables "Folder Drag & Drop" support
        // IMPROVED: Handle path separator mismatch (Windows \ vs POSIX /) by checking both.
        const conditions = sources.map(s => {
            // Normalize slashes: check both forward and back slash variants
            const pathForward = s.replace(/\\/g, '/');
            const pathBack = s.replace(/\//g, '\\');
            
            // Escape for SQL string literals
            // Forward slash is safe, just escape quotes
            const safeForward = pathForward.replace(/'/g, "''");
            
            // Backslash is an escape char in some SQL dialects or JS strings, 
            // so we might need double escaping. 
            // In LanceDB SQL, backslash usually needs escaping if inside a string literal?
            // Let's assume standard SQL: 'C:\\path' matches C:\path
            const safeBack = pathBack.replace(/\\/g, "\\\\").replace(/'/g, "''");

            // Match exact file OR folder content (prefix with / or \)
            // We check BOTH normalized versions to be robust against DB inconsistency
            return `(
                source = '${safeForward}' OR source LIKE '${safeForward}/%' OR source LIKE '${safeForward}\\\\%' OR
                source = '${safeBack}' OR source LIKE '${safeBack}\\\\%' OR source LIKE '${safeBack}/%'
            )`;
        });
        
        return `(${conditions.join(' OR ')})`;
    }

    async keywordSearch(queryText, limit = 50, filterSources = null) {
        // "FTS" implementation using SQL LIKE for local reliability
        await this.ensureReady();
        if (!this.table) return [];

        try {
            const safeQuery = queryText.replace(/'/g, "''"); // Basic SQL escape
            // Note: LanceDB 'LIKE' support depends on DataFusion. 
            // If it fails, we might need a fallback, but let's try standard SQL first.
            let whereClause = `text LIKE '%${safeQuery}%'`;

            if (Array.isArray(filterSources) && filterSources.length > 0) {
                const filterClause = this._buildSourceFilter(filterSources);
                if (filterClause) {
                    whereClause += ` AND ${filterClause}`;
                }
            }

            const results = await this.table.query()
                .where(whereClause)
                .limit(limit)
                .toArray();
            
            return results;
        } catch (e) {
            console.warn("[VectorStore] Keyword search failed (likely syntax or support), returning empty:", e);
            return [];
        }
    }

    async getChunksByIds(ids) {
        await this.ensureReady();
        if (!this.table || !ids || ids.length === 0) return [];
        
        try {
            // Construct OR clause for IDs
            // Note: LanceDB might not support IN clause efficiently in SQL string, 
            // so we build OR conditions: id = '...' OR id = '...'
            // Be careful with large lists. 
            // If list is large (>100), maybe do batches.
            // Assuming topK=15, retrieving ~15 parents is fine.
            
            const conditions = ids.map(id => `id = '${id}'`).join(' OR ');
            
            const results = await this.table.query()
                .where(conditions)
                .limit(ids.length)
                .toArray();
                
            return results.map(r => ({
                id: r.id,
                text: r.text,
                source: r.source,
                type: r.type,
                parent_id: r.parent_id
            }));
        } catch (e) {
            console.error("[VectorStore] Get Chunks By IDs Error:", e);
            return [];
        }
    }

    async getChunksBySource(sourcePath, options = {}) {
        await this.ensureReady();
        if (!this.table) return { chunks: [], total: 0 };
        
        const { limit = 20, offset = 0, keyword = '' } = options;
        
        try {
            const safeSource = sourcePath.replace(/\\/g, "\\\\").replace(/'/g, "''");
            
            // Base Where Clause
            let whereClause = `source = '${safeSource}'`;
            if (keyword && keyword.trim()) {
                const safeKeyword = keyword.replace(/'/g, "''");
                whereClause += ` AND text LIKE '%${safeKeyword}%'`;
            }

            // 1. Get Total Count (for pagination UI)
            // LanceDB 0.x might not support fast count with where clause efficiently, 
            // but let's try standard count() if available or fetch all IDs.
            // For now, we might skip total count if it's too slow, or use a separate query.
            // Let's try a lightweight query for count.
            let total = 0;
            try {
                // Approximate or separate count query
                // Use 'source' column for counting as it definitely exists
                const countResult = await this.table.query()
                    .where(whereClause)
                    .limit(10000) // Hard limit for safety
                    .select(['source']) 
                    .toArray();
                total = countResult.length;
            } catch (e) {
                console.warn("[VectorStore] Count failed, defaulting to 0", e);
            }

            // 2. Get Paged Data
            const query = this.table.query()
                .where(whereClause)
                .limit(limit)
                .offset(offset);
            
            // Try to select specific columns
            if (typeof query.select === 'function') {
                query.select(['text', 'source', 'context', 'timestamp']);
            }

            const results = await query.toArray();
            
            const chunks = results.map(r => ({
                id: r.id,
                text: r.text,
                source: r.source,
                chunk_index: r.chunk_index,
                parent_id: r.parent_id,
                type: r.type,
                context: r.context,
                timestamp: r.timestamp,
                // Include vector if needed, but it's heavy
                // vector: r.vector 
            }));

            // Fallback for Total
            if (total === 0 && results.length > 0) {
                 try {
                     // Fallback using source column again
                     const all = await this.table.query()
                        .where(whereClause)
                        .select(['source'])
                        .limit(10000)
                        .toArray();
                     total = all.length;
                 } catch (e) {}
            }

            return { chunks, total };

        } catch (e) {
            console.error(`[VectorStore] Get Chunks Error:`, e);
            return { chunks: [], total: 0 };
        }
    }

    async deleteCard(cardId) {
        await this.ensureReady();
        if (!this.table) return false;
        try {
            // Delete by matching cardId in context JSON string
            await this.table.delete(`context LIKE '%"cardId":"${cardId}"%'`);
            console.log(`[VectorStore] Deleted card: ${cardId}`);
            return true;
        } catch (e) {
            console.error(`[VectorStore] Delete Card Error:`, e);
            return false;
        }
    }

    async deleteChunk(sourcePath, text) {
        await this.ensureReady();
        if (!this.table) return false;
        try {
            const safeSource = sourcePath.replace(/\\/g, "\\\\").replace(/'/g, "''");
            const safeText = text.replace(/'/g, "''");
            await this.table.delete(`source = '${safeSource}' AND text = '${safeText}'`);
            return true;
        } catch (e) {
            console.error(`[VectorStore] Delete Chunk Error:`, e);
            return false;
        }
    }

    async deleteDocuments(sourcePath) {
        await this.ensureReady();
        if (!this.table) return false;
        
        try {
            // Escape path for SQL-like filter
            const safeSource = sourcePath.replace(/\\/g, "\\\\").replace(/'/g, "''");
            await this.table.delete(`source = '${safeSource}'`);
            console.log(`[VectorStore] Deleted documents for source: ${sourcePath}`);
            return true;
        } catch (e) {
            console.error(`[VectorStore] Delete Error for ${sourcePath}:`, e);
            return false;
        }
    }

    async addDocuments(docs) {
        await this.ensureReady();
        if (!this.db) return false;

        try {
            const tables = await this.db.tableNames();
            if (!tables.includes(this.tableName)) {
                this.table = await this.db.createTable(this.tableName, docs);
                console.log(`[VectorStore] Created table '${this.tableName}' with ${docs.length} docs.`);
            } else {
                this.table = await this.db.openTable(this.tableName);
                await this.table.add(docs);
                console.log(`[VectorStore] Added ${docs.length} docs to '${this.tableName}'.`);
            }
            return true;
        } catch (e) {
            console.error("[VectorStore] Add Error:", e);
            return false;
        }
    }

    async getChunkCounts() {
        await this.ensureReady();
        if (!this.table) return {};
        try {
            // Fetch all sources. Optimization: Select only source column.
            // Using a high limit to ensure we count everything. 
            // For massive datasets, this should be paginated or use SQL aggregation if supported.
            const results = await this.table.query()
                .select(['source'])
                .limit(1000000) 
                .toArray();
            
            const counts = {};
            for (const r of results) {
                // Normalize path to forward slashes AND lowercase to ensure consistency across OS
                // DB might store mixed separators depending on ingestion source
                const normSource = r.source.replace(/\\/g, '/').toLowerCase();
                counts[normSource] = (counts[normSource] || 0) + 1;
            }
            return counts;
        } catch (e) {
            console.error("Batch Count Error:", e);
            return {};
        }
    }

    async getAllSources() {
        await this.ensureReady();
        if (!this.table) return [];
        try {
            // Select only source column. 
            // Note: LanceDB distinct/unique might not be direct.
            // Fetching all might be heavy if millions of rows.
            // But for local desktop usage (<100k chunks), it's acceptable.
            // Optimization: Use a separate metadata table in future.
            const results = await this.table.query()
                .select(['source'])
                .limit(100000) // Safety cap
                .toArray();
            
            // Deduplicate in JS
            const sources = [...new Set(results.map(r => r.source))];
            return sources;
        } catch (e) {
            console.error("[VectorStore] Failed to get all sources:", e);
            return [];
        }
    }

    async search(vector, limit = 5, filterSources = null) {
        // 1. Wait for init to prevent returning empty array prematurely
        await this.ensureReady();
        
        if (!this.table) {
            console.warn("[VectorStore] Search skipped: Table not initialized or empty.");
            return [];
        }

        try {
            // 2. Detailed Logging: Log input parameters
            console.log(`[VectorStore] Search initiated. Limit: ${limit}`);
            if (filterSources) {
                 console.log(`[VectorStore] Filter sources count: ${filterSources.length}`);
                 if (filterSources.length > 0) {
                     // Log first path to check format (slashes, etc.)
                     console.log(`[VectorStore] Sample filter source: ${filterSources[0]}`);
                 }
            }

            let query = this.table.vectorSearch(vector).limit(limit);
            
            // 3. Construct Filter Logic
            if (Array.isArray(filterSources)) {
                if (filterSources.length === 0) {
                    console.log("[VectorStore] Filter is empty array. Returning 0 results.");
                    return [];
                }

                // Use new Directory-Aware filter
                const filterClause = this._buildSourceFilter(filterSources);
                if (filterClause) {
                    query = query.where(filterClause);
                }
            }

            const results = await query.toArray();
            console.log(`[VectorStore] Search returned ${results.length} results.`);

            // 4. Debug Mode: If zero results with filter, try "relaxed" query to diagnose
            if (results.length === 0 && filterSources && filterSources.length > 0) {
                console.log("[VectorStore] DEBUG: Zero results with filter. Investigating...");
                
                // Check if DB is empty
                const count = await this.table.countRows();
                console.log(`[VectorStore] Total rows in DB: ${count}`);

                if (count > 0) {
                    // Sample actual path format in DB
                    const sample = await this.table.query().limit(3).toArray();
                    console.log("[VectorStore] DB Sample Sources:", sample.map(r => r.source));

                    // Try unfiltered vector search to see what's top relevant
                    const unfiltered = await this.table.vectorSearch(vector).limit(1).toArray();
                    if (unfiltered.length > 0) {
                        const topMatch = unfiltered[0];
                        console.log(`[VectorStore] Top match (ignoring filter) source: ${topMatch.source}`);
                        
                        // Simple string comparison diagnosis
                        const isIncluded = filterSources.includes(topMatch.source);
                        console.log(`[VectorStore] Is top match in filter list? ${isIncluded}`);
                        if (!isIncluded) {
                            console.log(`[VectorStore] Path Mismatch Detail:`);
                            console.log(`   DB has:   ${JSON.stringify(topMatch.source)}`);
                            console.log(`   Filter 0: ${JSON.stringify(filterSources[0])}`);
                            // Normalized comparison check
                            const dbNorm = topMatch.source.replace(/\\/g, '/');
                            const filterNorm = filterSources[0].replace(/\\/g, '/');
                            console.log(`   Normalized check (DB vs Filter): '${dbNorm}' === '${filterNorm}' ? ${dbNorm === filterNorm}`);
                        }
                    }
                }
            }

            return results;
        } catch (e) {
            console.error("[VectorStore] Search Error:", e);
            return [];
        }
    }
}

module.exports = new VectorStore();
