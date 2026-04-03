
const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { app } = require('electron');

class DatabaseManager {
    constructor() {
        const userDataPath = app.getPath('userData');
        const dbDir = path.join(userDataPath, 'database');
        
        // 再次确认目录存在（双重保障）
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }

        this.dbPath = path.join(dbDir, 'ngo_data.db');
        this.configPath = path.join(userDataPath, 'settings.json');
        this.db = null;
        // this.init(); // Defer initialization to avoid blocking main process startup
    }

    logToMain(msg) {
        console.log(`[DBManager] ${msg}`);
    }

    init() {
        if (this.db) return; // Idempotent

        try {
            console.time('DB_Init');
            const isNewDb = !fs.existsSync(this.dbPath);
            
            // 严禁使用相对路径
            this.db = new Database(this.dbPath);
            
            // 只要数据库链接成功，就尝试创建表（SQLite 会自动处理 IF NOT EXISTS）
            this.createTables();

            // Run explicit migrations for existing databases
            if (!isNewDb) {
                this.runMigrations();
            }

            if (isNewDb) {
                console.log(`Success: Database created at ${this.dbPath}`);
                this.logToMain(`First-run: Database schema injected successfully at ${this.dbPath}`);
            } else {
                console.log(`Database connected at ${this.dbPath}`);
            }
            
            // 初始化 settings.json 如果不存在
            if (!fs.existsSync(this.configPath)) {
                fs.writeFileSync(this.configPath, JSON.stringify({}, null, 2));
            }
            console.timeEnd('DB_Init');
        } catch (err) {
            console.error("Database init error:", err);
            this.logToMain(`CRITICAL: Database init error: ${err.message}`);
        }
    }

    runMigrations() {
        // Migration for existing tables
        try {
            try {
                const projectsInfo = this.db.pragma("table_info(projects)");
                const hasDeletedAt = projectsInfo.some(c => c.name === 'deletedAt');
                if (!hasDeletedAt) {
                    this.db.prepare("ALTER TABLE projects ADD COLUMN deletedAt INTEGER").run();
                    this.logToMain("Migrated: Added 'deletedAt' column to projects");
                }
                // WeChat / Social Media Migration
            const wechatInfo = this.db.pragma("table_info(wechat_accounts)");
            if (wechatInfo.length === 0) {
                this.db.prepare(`
                    CREATE TABLE IF NOT EXISTS wechat_accounts (
                        id TEXT PRIMARY KEY, 
                        name TEXT, 
                        app_secret TEXT, 
                        app_secret_iv TEXT,
                        access_token TEXT, 
                        token_expires_at INTEGER, 
                        created_at INTEGER, 
                        updated_at INTEGER
                    )
                `).run();
                this.logToMain("Migrated: Created 'wechat_accounts' table");
            }

            const draftInfo = this.db.pragma("table_info(wechat_drafts)");
            if (draftInfo.length === 0) {
                this.db.prepare(`
                    CREATE TABLE IF NOT EXISTS wechat_drafts (
                        id TEXT PRIMARY KEY,
                        account_id TEXT,
                        title TEXT,
                        author TEXT,
                        digest TEXT,
                        content TEXT, 
                        content_source_url TEXT,
                        thumb_media_id TEXT,
                        thumb_url TEXT, 
                        show_cover_pic INTEGER DEFAULT 1,
                        need_open_comment INTEGER DEFAULT 1,
                        only_fans_can_comment INTEGER DEFAULT 0,
                        media_id TEXT, 
                        status TEXT DEFAULT 'local', 
                        created_at INTEGER,
                        updated_at INTEGER,
                        FOREIGN KEY(account_id) REFERENCES wechat_accounts(id) ON DELETE CASCADE
                    )
                `).run();
                this.logToMain("Migrated: Created 'wechat_drafts' table");
            }
        } catch (e) {
                this.logToMain(`Migration check (projects) failed: ${e.message}`);
            }

            const info = this.db.pragma("table_info(kb_file_stats)");
            
            const hasTags = info.some(c => c.name === 'tags');
            if (!hasTags) {
                this.db.prepare("ALTER TABLE kb_file_stats ADD COLUMN tags TEXT DEFAULT '[]'").run();
                this.logToMain("Migrated: Added 'tags' column to kb_file_stats");
            }
            const hasTotalReadTime = info.some(c => c.name === 'total_read_time');
            if (!hasTotalReadTime) {
                this.db.prepare("ALTER TABLE kb_file_stats ADD COLUMN total_read_time REAL DEFAULT 0").run();
                this.logToMain("Migrated: Added 'total_read_time' column to kb_file_stats");
            }
            const hasLastReadTime = info.some(c => c.name === 'last_read_time');
            if (!hasLastReadTime) {
                this.db.prepare("ALTER TABLE kb_file_stats ADD COLUMN last_read_time INTEGER").run();
                this.logToMain("Migrated: Added 'last_read_time' column to kb_file_stats");
            }
            const hasReadProgress = info.some(c => c.name === 'read_progress');
            if (!hasReadProgress) {
                this.db.prepare("ALTER TABLE kb_file_stats ADD COLUMN read_progress REAL DEFAULT 0").run();
                this.logToMain("Migrated: Added 'read_progress' column to kb_file_stats");
            }
            const hasTotalPages = info.some(c => c.name === 'total_pages');
            if (!hasTotalPages) {
                this.db.prepare("ALTER TABLE kb_file_stats ADD COLUMN total_pages INTEGER DEFAULT 0").run();
                this.logToMain("Migrated: Added 'total_pages' column to kb_file_stats");
            }
// ... rest of migrations ...
            // Cloud Sync Migration
            const cloudSyncInfo = this.db.pragma("table_info(cloud_sync_config)");
            const hasEncPwd = cloudSyncInfo.some(c => c.name === 'encryption_password');
            if (!hasEncPwd) {
                this.db.prepare("ALTER TABLE cloud_sync_config ADD COLUMN encryption_password TEXT").run();
                this.logToMain("Migrated: Added 'encryption_password' column to cloud_sync_config");
            }
            const hasEncIv = cloudSyncInfo.some(c => c.name === 'encryption_iv');
            if (!hasEncIv) {
                this.db.prepare("ALTER TABLE cloud_sync_config ADD COLUMN encryption_iv TEXT").run();
                this.logToMain("Migrated: Added 'encryption_iv' column to cloud_sync_config");
            }
        } catch (e) {
            this.logToMain(`Migration check failed: ${e.message}`);
        }
    }

    createTables() {
        const sql = `
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY, title TEXT, domain TEXT, startDate TEXT, status TEXT, 
                source TEXT, type TEXT, leader TEXT, officialPlanContent TEXT, 
                originalPlan TEXT, sops TEXT, expenses TEXT, milestones TEXT, 
                reportVersions TEXT, created_at INTEGER, planLocked INTEGER, 
                financialsLocked INTEGER, executionLocked INTEGER, reportLocked INTEGER, pptLocked INTEGER
            );
            
            -- ... (rest of tables)
            
            CREATE TABLE IF NOT EXISTS cloud_sync_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL, 
                is_enabled INTEGER DEFAULT 0,
                encrypted_token TEXT,
                encrypted_refresh_token TEXT,
                iv TEXT,
                username TEXT,
                target_folder TEXT,
                sync_frequency TEXT DEFAULT 'manual', 
                last_sync_time INTEGER,
                update_time TEXT,
                encryption_password TEXT, 
                encryption_iv TEXT,
                UNIQUE(type)
            );
            
            -- ...
        `;
        // To avoid messing up the huge string in previous steps, I will just call the original logic but rely on runMigrations for old tables.
        // But wait, the original createTables function had the migration logic INSIDE it at the end.
        // My previous edit REMOVED that block implicitly by replacing the function body or confusing the matcher.
        // Let's restore the original CreateTables content but REMOVE the migration block from it, 
        // because I moved it to runMigrations().
        
        // Actually, looking at the previous file content, createTables contained the SQL execution AND the migration try-catch block.
        // My previous SearchReplace only replaced the top part of init and added runMigrations.
        // I need to clean up createTables to NOT contain the duplicate migration logic if I moved it.
        // OR, easier: Just let createTables execute the SQL.
        
        // Let's rewrite createTables to be clean SQL execution.
        
        const sqlReal = `
            CREATE TABLE IF NOT EXISTS projects (
                id TEXT PRIMARY KEY, title TEXT, domain TEXT, startDate TEXT, status TEXT, 
                source TEXT, type TEXT, leader TEXT, officialPlanContent TEXT, 
                originalPlan TEXT, sops TEXT, expenses TEXT, milestones TEXT, 
                reportVersions TEXT, created_at INTEGER, planLocked INTEGER, 
                financialsLocked INTEGER, executionLocked INTEGER, reportLocked INTEGER, pptLocked INTEGER,
                deletedAt INTEGER
            );

            CREATE TABLE IF NOT EXISTS files_registry (
                id TEXT PRIMARY KEY, project_id TEXT, file_name TEXT, absolute_path TEXT, 
                storage_type TEXT, category TEXT, created_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS ai_artifacts (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                milestone_id TEXT,
                title TEXT,
                kind TEXT,
                file_path TEXT,
                meta_json TEXT DEFAULT '{}',
                created_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_ai_artifacts_project_id ON ai_artifacts(project_id);
            CREATE INDEX IF NOT EXISTS idx_ai_artifacts_milestone_id ON ai_artifacts(milestone_id);

            CREATE TABLE IF NOT EXISTS document_chunks (
                id TEXT PRIMARY KEY,
                projectId TEXT,
                content TEXT,
                vector TEXT,
                metadata TEXT
            );

            CREATE TABLE IF NOT EXISTS settings ( key TEXT PRIMARY KEY, value TEXT );
            
            CREATE TABLE IF NOT EXISTS kb_file_stats (
                file_path TEXT PRIMARY KEY,
                ref_count INTEGER DEFAULT 0,
                last_ref_time INTEGER,
                ingest_time INTEGER,
                total_read_time REAL DEFAULT 0,
                last_read_time INTEGER,
                read_progress REAL DEFAULT 0,
                total_pages INTEGER DEFAULT 0,
                status TEXT DEFAULT 'active',
                weight_factor REAL DEFAULT 1.0,
                tags TEXT DEFAULT '[]',
                summary TEXT DEFAULT '',
                keywords TEXT DEFAULT '',
                use_in_rag INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS reading_projects (
                id TEXT PRIMARY KEY,
                purpose TEXT,
                created_at INTEGER,
                updated_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS reading_sessions (
                id TEXT PRIMARY KEY,
                project_id TEXT,
                file_path TEXT,
                created_at INTEGER,
                FOREIGN KEY(project_id) REFERENCES reading_projects(id)
            );

            CREATE TABLE IF NOT EXISTS knowledge_cards (
                id TEXT PRIMARY KEY,
                session_id TEXT,
                file_path TEXT,
                selected_text TEXT,
                context_text TEXT,
                user_note TEXT,
                ai_tags TEXT DEFAULT '[]',
                created_at INTEGER,
                updated_at INTEGER,
                FOREIGN KEY(session_id) REFERENCES reading_sessions(id)
            );

            CREATE TABLE IF NOT EXISTS reading_summaries (
                id TEXT PRIMARY KEY,
                target_id TEXT, -- session_id or project_id
                target_type TEXT, -- 'session' or 'project'
                content TEXT,
                created_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS entity_relationships (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                entity_name TEXT NOT NULL,
                entity_type TEXT NOT NULL, -- 'project', 'person', 'organization'
                confidence REAL DEFAULT 1.0,
                created_at INTEGER,
                FOREIGN KEY(file_path) REFERENCES kb_file_stats(file_path) ON DELETE CASCADE
            );
            
            CREATE INDEX IF NOT EXISTS idx_entity_name ON entity_relationships(entity_name);
            CREATE INDEX IF NOT EXISTS idx_entity_file ON entity_relationships(file_path);

            CREATE TABLE IF NOT EXISTS kb_chat_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                assistant_id TEXT,
                role TEXT,
                content TEXT,
                sources TEXT,
                entities TEXT,
                timestamp INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_chat_assistant ON kb_chat_history(assistant_id);

            CREATE TABLE IF NOT EXISTS saved_graphs (
                id TEXT PRIMARY KEY,
                name TEXT,
                nodes_json TEXT,
                edges_json TEXT,
                source_files_json TEXT,
                created_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS cloud_sync_config (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                type TEXT NOT NULL, -- 'feishu_doc', 'jianguoyun', 'baidu', etc.
                is_enabled INTEGER DEFAULT 0,
                encrypted_token TEXT,
                encrypted_refresh_token TEXT,
                iv TEXT,
                username TEXT,
                target_folder TEXT,
                sync_frequency TEXT DEFAULT 'manual', -- 'manual', 'hourly', 'daily'
                last_sync_time INTEGER,
                update_time TEXT,
                encryption_password TEXT, -- Encrypted password for zip
                encryption_iv TEXT,
                UNIQUE(type)
            );

            CREATE TABLE IF NOT EXISTS cloud_sync_file_record (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                file_path TEXT NOT NULL,
                cloud_type TEXT NOT NULL,
                file_md5 TEXT,
                modify_time INTEGER,
                cloud_path TEXT,
                sync_time INTEGER,
                UNIQUE(file_path, cloud_type)
            );

            CREATE TABLE IF NOT EXISTS cloud_sync_object_record (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cloud_rel_path TEXT NOT NULL,
                cloud_type TEXT NOT NULL,
                file_md5 TEXT,
                modify_time INTEGER,
                cloud_path TEXT,
                sync_time INTEGER,
                local_root_hint TEXT,
                UNIQUE(cloud_rel_path, cloud_type)
            );

            CREATE TABLE IF NOT EXISTS kb_folder_meta (
                folder_id TEXT PRIMARY KEY,
                folder_path TEXT,
                source_type TEXT,
                origin_path TEXT,
                is_external_reference INTEGER DEFAULT 1,
                created_at INTEGER,
                updated_at INTEGER,
                file_count INTEGER,
                size_bytes INTEGER,
                extra_json TEXT DEFAULT '{}'
            );

            CREATE TABLE IF NOT EXISTS kb_file_metadata (
                file_path TEXT PRIMARY KEY,
                title TEXT,
                author TEXT,
                published_time TEXT,
                abstract TEXT,
                keywords_json TEXT DEFAULT '[]',
                source TEXT DEFAULT 'auto',
                updated_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS planner_event_context (
                event_id TEXT PRIMARY KEY,
                config_json TEXT DEFAULT '{}',
                updated_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS project_intel_runs (
                id TEXT PRIMARY KEY,
                mode TEXT,
                user_query TEXT,
                urls_json TEXT DEFAULT '[]',
                keywords_json TEXT DEFAULT '[]',
                plan_json TEXT DEFAULT '{}',
                status TEXT DEFAULT 'created',
                output_dir TEXT,
                output_csv_path TEXT,
                output_html_path TEXT,
                output_md_path TEXT,
                kb_indexed INTEGER DEFAULT 0,
                created_at INTEGER,
                updated_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_project_intel_runs_created_at ON project_intel_runs(created_at);

            CREATE TABLE IF NOT EXISTS project_intel_items (
                id TEXT PRIMARY KEY,
                run_id TEXT,
                url TEXT,
                title TEXT,
                snippet TEXT,
                extracted_json TEXT DEFAULT '{}',
                screenshot_path TEXT,
                raw_text_path TEXT,
                created_at INTEGER,
                updated_at INTEGER,
                FOREIGN KEY(run_id) REFERENCES project_intel_runs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_project_intel_items_run_id ON project_intel_items(run_id);
            CREATE INDEX IF NOT EXISTS idx_project_intel_items_url ON project_intel_items(url);

            CREATE TABLE IF NOT EXISTS project_intel_highlights (
                id TEXT PRIMARY KEY,
                run_id TEXT,
                url TEXT,
                title TEXT,
                selected_text TEXT,
                context_text TEXT,
                tags_json TEXT DEFAULT '[]',
                created_at INTEGER,
                FOREIGN KEY(run_id) REFERENCES project_intel_runs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_project_intel_highlights_run_id ON project_intel_highlights(run_id);

            CREATE TABLE IF NOT EXISTS project_intel_ocr_frames (
                id TEXT PRIMARY KEY,
                run_id TEXT,
                url TEXT,
                title TEXT,
                image_path TEXT,
                ocr_text TEXT,
                created_at INTEGER,
                FOREIGN KEY(run_id) REFERENCES project_intel_runs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_project_intel_ocr_frames_run_id ON project_intel_ocr_frames(run_id);

            CREATE TABLE IF NOT EXISTS interconnect_jobs (
                id TEXT PRIMARY KEY,
                template_id TEXT,
                title TEXT,
                params_json TEXT DEFAULT '{}',
                status TEXT DEFAULT 'created',
                progress INTEGER DEFAULT 0,
                summary_json TEXT DEFAULT '{}',
                error TEXT,
                related_run_id TEXT,
                created_at INTEGER,
                started_at INTEGER,
                finished_at INTEGER,
                updated_at INTEGER
            );
            CREATE INDEX IF NOT EXISTS idx_interconnect_jobs_created_at ON interconnect_jobs(created_at);
            CREATE INDEX IF NOT EXISTS idx_interconnect_jobs_status ON interconnect_jobs(status);

            CREATE TABLE IF NOT EXISTS interconnect_job_steps (
                id TEXT PRIMARY KEY,
                job_id TEXT,
                step_index INTEGER,
                step_name TEXT,
                step_type TEXT,
                status TEXT DEFAULT 'created',
                request_json TEXT DEFAULT '{}',
                response_json TEXT DEFAULT '{}',
                error TEXT,
                created_at INTEGER,
                updated_at INTEGER,
                FOREIGN KEY(job_id) REFERENCES interconnect_jobs(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_interconnect_job_steps_job_id ON interconnect_job_steps(job_id);
        `;
        this.db.exec(sqlReal);
    }

    async updateReadingStats(filePath, durationSeconds, progress, totalPages) {
        try {
            const now = Date.now();
            // Convert seconds to hours
            const hoursToAdd = durationSeconds / 3600;
            
            const stmt = this.db.prepare(`
                INSERT INTO kb_file_stats (file_path, total_read_time, last_read_time, read_progress, total_pages, ingest_time)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(file_path) DO UPDATE SET
                total_read_time = total_read_time + excluded.total_read_time,
                last_read_time = excluded.last_read_time,
                read_progress = MAX(read_progress, excluded.read_progress),
                total_pages = excluded.total_pages
            `);
            
            stmt.run(filePath, hoursToAdd, now, progress || 0, totalPages || 0, now);
            return { success: true };
        } catch (e) {
            try {
                const msg = String(e.message || '');
                if (msg.includes('kb_file_stats') && (msg.includes('no such column') || msg.includes('has no column named'))) {
                    this.runMigrations();
                    return await this.updateReadingStats(filePath, durationSeconds, progress, totalPages);
                }
            } catch (e2) {}
            this.logToMain(`Update Reading Stats Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async _syncFileStats() {
        try {
            // 1. Get existing stats paths
            const stats = this.db.prepare("SELECT file_path FROM kb_file_stats").all();
            const statsSet = new Set(stats.map(s => s.file_path));
            
            // 2. Get ingested files list from settings
            const ingested = await this.getSetting('kb_ingested_files') || [];
            
            // 3. Sync: Add missing files to stats
            const now = Date.now();
            
            if (Array.isArray(ingested)) {
                const insertStmt = this.db.prepare(`
                    INSERT INTO kb_file_stats (file_path, ref_count, last_ref_time, ingest_time, status, weight_factor)
                    VALUES (?, 0, NULL, ?, 'active', 1.0)
                `);
                
                const missing = ingested.filter(path => !statsSet.has(path));
                
                if (missing.length > 0) {
                    const transaction = this.db.transaction((missingFiles) => {
                        for (const path of missingFiles) {
                            insertStmt.run(path, now);
                        }
                    });
                    
                    try {
                        transaction(missing);
                        this.logToMain(`Synced ${missing.length} old files to stats table.`);
                    } catch (err) {
                        this.logToMain(`Failed to sync old files: ${err.message}`);
                    }
                }
            }
        } catch (e) {
            this.logToMain(`Sync File Stats Error: ${e.message}`);
        }
    }

    async getFileStats() {
        try {
            await this._syncFileStats();
            return this.db.prepare("SELECT * FROM kb_file_stats").all();
        } catch (e) {
            this.logToMain(`Get File Stats Error: ${e.message}`);
            return [];
        }
    }

    async updateFileStats(filePath, updates) {
        try {
            // updates: { ref_count_inc, last_ref_time, status, weight_factor, ingest_time, tags }
            // Use an upsert logic
            const current = this.db.prepare("SELECT * FROM kb_file_stats WHERE file_path = ?").get(filePath);
            
            let newStats = {
                file_path: filePath,
                ref_count: current ? current.ref_count : 0,
                last_ref_time: current ? current.last_ref_time : null,
                ingest_time: current ? current.ingest_time : Date.now(),
                status: current ? current.status : 'active',
                weight_factor: current ? current.weight_factor : 1.0,
                tags: current ? current.tags : '[]'
            };

            if (updates.ref_count_inc) newStats.ref_count += updates.ref_count_inc;
            if (updates.last_ref_time) newStats.last_ref_time = updates.last_ref_time;
            if (updates.ingest_time) newStats.ingest_time = updates.ingest_time;
            if (updates.status) newStats.status = updates.status;
            if (updates.weight_factor !== undefined) newStats.weight_factor = updates.weight_factor;
            if (updates.tags) newStats.tags = JSON.stringify(updates.tags);

            const stmt = this.db.prepare(`
                INSERT INTO kb_file_stats (file_path, ref_count, last_ref_time, ingest_time, status, weight_factor, tags)
                VALUES (@file_path, @ref_count, @last_ref_time, @ingest_time, @status, @weight_factor, @tags)
                ON CONFLICT(file_path) DO UPDATE SET
                ref_count=excluded.ref_count,
                last_ref_time=excluded.last_ref_time,
                ingest_time=coalesce(excluded.ingest_time, kb_file_stats.ingest_time),
                status=excluded.status,
                weight_factor=excluded.weight_factor,
                tags=excluded.tags
            `);
            stmt.run(newStats);
            return { success: true };
        } catch (e) {
            this.logToMain(`Update File Stats Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getFileConfig(filePaths) {
        try {
             if (!filePaths || filePaths.length === 0) return {};
             const placeholders = filePaths.map(() => '?').join(',');
             const rows = this.db.prepare(`SELECT file_path, weight_factor, tags FROM kb_file_stats WHERE file_path IN (${placeholders})`).all(filePaths);
             
             // Convert to Map: path -> { weight, tags }
             const config = {};
             rows.forEach(r => {
                 config[r.file_path] = {
                     weight: r.weight_factor || 1.0,
                     tags: JSON.parse(r.tags || '[]')
                 };
             });
             return config;
        } catch (e) {
            this.logToMain(`Get File Config Error: ${e.message}`);
            return {};
        }
    }

    async incrementFileRefs(filePaths) {
        if (!filePaths || filePaths.length === 0) return;
        const now = Date.now();
        const stmt = this.db.prepare(`
            INSERT INTO kb_file_stats (file_path, ref_count, last_ref_time, ingest_time)
            VALUES (?, 1, ?, ?)
            ON CONFLICT(file_path) DO UPDATE SET
            ref_count = ref_count + 1,
            last_ref_time = ?
        `);
        
        const insertTransaction = this.db.transaction((paths) => {
            for (const path of paths) {
                // If ingest_time is missing, it will be set to 'now' on insert, which is acceptable approximation
                // Ideally ingest_time is set during ingestion.
                stmt.run(path, now, now, now); 
            }
        });
        
        try {
            insertTransaction(filePaths);
        } catch (e) {
            this.logToMain(`Increment Refs Error: ${e.message}`);
        }
    }

    async deleteFileStats(filePaths) {
         if (!filePaths || filePaths.length === 0) return;
         const placeholders = filePaths.map(() => '?').join(',');
         this.db.prepare(`DELETE FROM kb_file_stats WHERE file_path IN (${placeholders})`).run(...filePaths);
    }

    async saveProject(p) {
        try {
            const stmt = this.db.prepare(`REPLACE INTO projects (id, title, domain, startDate, status, source, type, leader, officialPlanContent, originalPlan, sops, expenses, milestones, reportVersions, created_at, planLocked, financialsLocked, executionLocked, reportLocked, pptLocked, deletedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
            stmt.run(
                p.id, p.title, p.domain, p.startDate, p.status, p.source, p.type, p.leader, p.officialPlanContent, 
                JSON.stringify(p.originalPlan || {}), JSON.stringify(p.sops || []), JSON.stringify(p.expenses || []), 
                JSON.stringify(p.milestones || []), JSON.stringify(p.reportVersions || []), p.created_at, 
                p.planLocked ? 1 : 0, p.financialsLocked ? 1 : 0, p.executionLocked ? 1 : 0, p.reportLocked ? 1 : 0, p.pptLocked ? 1 : 0
                , (p.deletedAt === undefined ? null : p.deletedAt)
            );
            return { success: true };
        } catch (e) {
            this.logToMain(`Save Project Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getAllProjects() {
        try {
            const rows = this.db.prepare("SELECT * FROM projects ORDER BY created_at DESC").all();
            return rows.map(r => ({
                ...r,
                originalPlan: JSON.parse(r.originalPlan || '{}'),
                sops: JSON.parse(r.sops || '[]'),
                expenses: JSON.parse(r.expenses || '[]'),
                milestones: JSON.parse(r.milestones || '[]'),
                reportVersions: JSON.parse(r.reportVersions || '[]'),
                planLocked: !!r.planLocked,
                financialsLocked: !!r.financialsLocked,
                executionLocked: !!r.executionLocked,
                reportLocked: !!r.reportLocked,
                pptLocked: !!r.pptLocked,
                deletedAt: r.deletedAt === null || r.deletedAt === undefined ? undefined : Number(r.deletedAt)
            }));
        } catch (e) {
            this.logToMain(`Get All Projects Error: ${e.message}`);
            return [];
        }
    }

    async getProjectById(id) {
        try {
            const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id);
            if (!row) return null;
            return {
                ...row,
                originalPlan: JSON.parse(row.originalPlan || '{}'),
                sops: JSON.parse(row.sops || '[]'),
                expenses: JSON.parse(row.expenses || '[]'),
                milestones: JSON.parse(row.milestones || '[]'),
                reportVersions: JSON.parse(row.reportVersions || '[]'),
                planLocked: !!row.planLocked,
                financialsLocked: !!row.financialsLocked,
                executionLocked: !!row.executionLocked,
                reportLocked: !!row.reportLocked,
                pptLocked: !!row.pptLocked,
                deletedAt: row.deletedAt === null || row.deletedAt === undefined ? undefined : Number(row.deletedAt)
            };
        } catch (e) {
            this.logToMain(`Get Project By Id Error: ${e.message}`);
            return null;
        }
    }

    async deleteProject(id) {
        this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
        return { success: true };
    }

    async saveSetting(key, value) {
        try {
            // 1. 存入数据库
            this.db.prepare("REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, JSON.stringify(value));
            
            // 2. 物理同步到 settings.json
            try {
                let config = {};
                if (fs.existsSync(this.configPath)) {
                    const raw = fs.readFileSync(this.configPath, 'utf8');
                    config = JSON.parse(raw || '{}');
                }
                config[key] = value;
                fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
            } catch (e) {
                this.logToMain(`Failed to sync settings.json: ${e.message}`);
            }
            
            return { success: true };
        } catch (e) {
            this.logToMain(`Save Setting Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getSetting(key) {
        try {
            const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key);
            if (row) return JSON.parse(row.value);
            
            if (fs.existsSync(this.configPath)) {
                const config = JSON.parse(fs.readFileSync(this.configPath, 'utf8') || '{}');
                return config[key];
            }
        } catch (e) {}
        
        return null;
    }

    async registerFile(data) {
        const stmt = this.db.prepare(`INSERT INTO files_registry (id, project_id, file_name, absolute_path, storage_type, category, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);
        stmt.run(data.id, data.projectId || 'none', data.fileName, data.absolutePath, data.storageType, data.category, Date.now());
        return { success: true };
    }

    async addAiArtifact(artifact) {
        try {
            const now = Date.now();
            const id = artifact.id || `artifact-${now}-${Math.random().toString(36).slice(2, 8)}`;
            const title = typeof artifact.title === 'string' ? artifact.title : '';
            const kind = typeof artifact.kind === 'string' ? artifact.kind : '';
            const projectId = typeof artifact.projectId === 'string' ? artifact.projectId : null;
            const milestoneId = typeof artifact.milestoneId === 'string' ? artifact.milestoneId : null;
            const filePath = typeof artifact.filePath === 'string' ? artifact.filePath : null;
            const meta = artifact.meta && typeof artifact.meta === 'object' ? artifact.meta : {};
            this.db.prepare(`
                INSERT INTO ai_artifacts (id, project_id, milestone_id, title, kind, file_path, meta_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(id, projectId, milestoneId, title, kind, filePath, JSON.stringify(meta), now);
            return { success: true, id };
        } catch (e) {
            this.logToMain(`Add AI Artifact Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async listAiArtifacts({ projectId, milestoneId, limit = 200 } = {}) {
        try {
            const lim = Math.max(1, Math.min(Number(limit) || 200, 500));
            const where = [];
            const args = [];
            if (typeof projectId === 'string' && projectId.trim()) {
                where.push('project_id = ?');
                args.push(projectId.trim());
            }
            if (typeof milestoneId === 'string' && milestoneId.trim()) {
                where.push('milestone_id = ?');
                args.push(milestoneId.trim());
            }
            const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
            const rows = this.db.prepare(`SELECT * FROM ai_artifacts ${whereSql} ORDER BY created_at DESC LIMIT ?`).all(...args, lim);
            return rows.map(r => ({
                ...r,
                meta: (() => { try { return JSON.parse(r.meta_json || '{}'); } catch (e) { return {}; } })()
            }));
        } catch (e) {
            this.logToMain(`List AI Artifacts Error: ${e.message}`);
            return [];
        }
    }

    // --- Reading Mode Methods ---

    async createReadingProject(id, purpose) {
        try {
            const now = Date.now();
            this.db.prepare("INSERT INTO reading_projects (id, purpose, created_at, updated_at) VALUES (?, ?, ?, ?)").run(id, purpose, now, now);
            return { success: true };
        } catch (e) {
            this.logToMain(`Create Reading Project Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getReadingProjects() {
        try {
            return this.db.prepare("SELECT * FROM reading_projects ORDER BY updated_at DESC").all();
        } catch (e) {
            return [];
        }
    }

    async createReadingSession(id, projectId, filePath) {
        try {
            this.db.prepare("INSERT INTO reading_sessions (id, project_id, file_path, created_at) VALUES (?, ?, ?, ?)").run(id, projectId, filePath, Date.now());
            return { success: true };
        } catch (e) {
            this.logToMain(`Create Reading Session Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getReadingSessions(projectId) {
        try {
            return this.db.prepare("SELECT * FROM reading_sessions WHERE project_id = ? ORDER BY created_at DESC").all(projectId);
        } catch (e) {
            return [];
        }
    }

    async createKnowledgeCard(card) {
        try {
            const now = Date.now();
            const stmt = this.db.prepare(`
                INSERT INTO knowledge_cards (id, session_id, file_path, selected_text, context_text, user_note, ai_tags, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            stmt.run(
                card.id, card.session_id, card.file_path, card.selected_text, 
                card.context_text, card.user_note, JSON.stringify(card.ai_tags || []), now, now
            );
            return { success: true };
        } catch (e) {
            this.logToMain(`Create Card Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getKnowledgeCards(sessionId) {
        try {
            const rows = this.db.prepare("SELECT * FROM knowledge_cards WHERE session_id = ? ORDER BY created_at DESC").all(sessionId);
            return rows.map(r => ({
                ...r,
                ai_tags: JSON.parse(r.ai_tags || '[]')
            }));
        } catch (e) {
            return [];
        }
    }

    async updateKnowledgeCard(id, updates) {
        try {
            // updates: { user_note, ai_tags }
            const current = this.db.prepare("SELECT * FROM knowledge_cards WHERE id = ?").get(id);
            if (!current) return { success: false, error: "Card not found" };

            const note = updates.user_note !== undefined ? updates.user_note : current.user_note;
            const tags = updates.ai_tags !== undefined ? JSON.stringify(updates.ai_tags) : current.ai_tags;

            this.db.prepare("UPDATE knowledge_cards SET user_note = ?, ai_tags = ?, updated_at = ? WHERE id = ?").run(note, tags, Date.now(), id);
            
            return { 
                success: true,
                card: {
                    ...current,
                    user_note: note,
                    ai_tags: JSON.parse(tags),
                    updated_at: Date.now()
                }
            };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async deleteKnowledgeCard(id) {
        try {
            this.db.prepare("DELETE FROM knowledge_cards WHERE id = ?").run(id);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async saveReadingSummary(summary) {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO reading_summaries (id, target_id, target_type, content, created_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET content=excluded.content, created_at=excluded.created_at
            `);
            stmt.run(summary.id, summary.target_id, summary.target_type, summary.content, Date.now());
            return { success: true };
        } catch (e) {
            this.logToMain(`Save Summary Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getReadingSummary(targetId) {
        try {
            return this.db.prepare("SELECT * FROM reading_summaries WHERE target_id = ? ORDER BY created_at DESC LIMIT 1").get(targetId);
        } catch (e) {
            return null;
        }
    }

    // --- Entity Relationship Methods (Graph-Lite) ---

    async saveEntityRelationships(filePath, entities) {
        // entities: [{ name, type, confidence }]
        if (!entities || entities.length === 0) return { success: true };
        
        try {
            const now = Date.now();
            const insert = this.db.prepare(`
                INSERT INTO entity_relationships (file_path, entity_name, entity_type, confidence, created_at)
                VALUES (@file_path, @entity_name, @entity_type, @confidence, @created_at)
            `);

            const deleteOld = this.db.prepare("DELETE FROM entity_relationships WHERE file_path = ?");

            const transaction = this.db.transaction((items) => {
                deleteOld.run(filePath);
                for (const item of items) {
                    insert.run({
                        file_path: filePath,
                        entity_name: item.name,
                        entity_type: item.type,
                        confidence: item.confidence || 1.0,
                        created_at: now
                    });
                }
            });

            transaction(entities);
            return { success: true };
        } catch (e) {
            this.logToMain(`Save Entities Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getRelatedFilesByEntity(entityName) {
        try {
            // Find files that contain this entity
            const rows = this.db.prepare("SELECT file_path FROM entity_relationships WHERE entity_name = ?").all(entityName);
            return rows.map(r => r.file_path);
        } catch (e) {
            return [];
        }
    }

    async getGraphData() {
        try {
            // Get all relationships
            const rels = this.db.prepare("SELECT * FROM entity_relationships").all();
            
            // Get all files involved
            const filePaths = [...new Set(rels.map(r => r.file_path))];
            
            // Get file metadata for better visualization (optional)
            // For now, just nodes and edges
            
            // Nodes: Files + Entities
            // Edges: File -> Entity
            
            return {
                relationships: rels,
                fileCount: filePaths.length,
                entityCount: new Set(rels.map(r => r.entity_name)).size
            };
        } catch (e) {
            this.logToMain(`Get Graph Data Error: ${e.message}`);
            return { relationships: [], fileCount: 0, entityCount: 0 };
        }
    }

    async saveGraphSnapshot(graph) {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO saved_graphs (id, name, nodes_json, edges_json, source_files_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
            `);
            stmt.run(
                graph.id, 
                graph.name, 
                JSON.stringify(graph.nodes), 
                JSON.stringify(graph.edges), 
                JSON.stringify(graph.sourceFiles || []), 
                Date.now()
            );
            return { success: true };
        } catch (e) {
            this.logToMain(`Save Graph Snapshot Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getSavedGraphs() {
        try {
            const rows = this.db.prepare("SELECT * FROM saved_graphs ORDER BY created_at DESC").all();
            return rows.map(r => ({
                ...r,
                nodes: JSON.parse(r.nodes_json || '[]'),
                edges: JSON.parse(r.edges_json || '[]'),
                sourceFiles: JSON.parse(r.source_files_json || '[]')
            }));
        } catch (e) {
            return [];
        }
    }

    async deleteSavedGraph(id) {
        this.db.prepare("DELETE FROM saved_graphs WHERE id = ?").run(id);
        return { success: true };
    }

    async getBatchFileTopTags(filePaths, limit = 3) {
        try {
            if (!filePaths || filePaths.length === 0) return {};
            
            const result = {};
            const stmt = this.db.prepare(`
                SELECT value as tag, COUNT(*) as count 
                FROM knowledge_cards, json_each(ai_tags) 
                WHERE file_path = ? 
                GROUP BY tag 
                ORDER BY count DESC 
                LIMIT ?
            `);

            for (const path of filePaths) {
                try {
                    const rows = stmt.all(path, limit);
                    result[path] = rows.map(r => r.tag);
                } catch (e) {
                    result[path] = [];
                }
            }
            return result;
        } catch (e) {
            this.logToMain(`Batch Top Tags Error: ${e.message}`);
            return {};
        }
    }

    async getExtendedStats() {
        try {
            // Ensure stats table is up-to-date with ingested files
            await this._syncFileStats();

            // Join stats with registry for metadata
            // Also get card counts
            const rows = this.db.prepare(`
                SELECT 
                    s.*,
                    f.file_name, 
                    f.category as file_type, 
                    f.created_at as file_created_at,
                    (SELECT COUNT(*) FROM knowledge_cards k WHERE k.file_path = s.file_path) as card_count
                FROM kb_file_stats s
                LEFT JOIN files_registry f ON f.absolute_path = s.file_path
            `).all();

            // For chunks, we might need a separate query if the table is large
            // or if metadata parsing is required.
            // Let's try a rough count if document_chunks exists
            let chunkCounts = {};
            try {
                 // Check if table exists first
                 const tableExists = this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='document_chunks'").get();
                 if (tableExists) {
                     // This assumes metadata contains the exact file path string. 
                     // Since metadata is JSON text, we use LIKE. 
                     // Warning: This is slow for large datasets. 
                     // Optimized approach: If we had a file_path column in document_chunks.
                     // For now, we'll skip the heavy query or do it very simply for the visible list?
                     // Let's return 0 for now to be safe on performance, or implement a specific 'getChunkInfo' for single files.
                 }
            } catch(e) {}

            return rows;
        } catch (e) {
            this.logToMain(`Extended Stats Error: ${e.message}`);
            return [];
        }
    }

    // --- Cloud Sync Methods ---

    async getCloudSyncConfig(type) {
        try {
            return this.db.prepare("SELECT * FROM cloud_sync_config WHERE type = ?").get(type);
        } catch (e) {
            this.logToMain(`Get Cloud Sync Config Error: ${e.message}`);
            return null;
        }
    }

    async updateCloudSyncConfig(type, config) {
        try {
            const current = await this.getCloudSyncConfig(type);
            const merged = { ...current, ...config, type };
            
            // Ensure all named parameters exist, setting defaults if missing
            if (merged.is_enabled === undefined) merged.is_enabled = 0;
            if (merged.encrypted_token === undefined) merged.encrypted_token = null;
            if (merged.encrypted_refresh_token === undefined) merged.encrypted_refresh_token = null;
            if (merged.iv === undefined) merged.iv = null;
            if (merged.username === undefined) merged.username = null;
            if (merged.target_folder === undefined) merged.target_folder = null;
            if (merged.sync_frequency === undefined) merged.sync_frequency = 'manual';
            if (merged.last_sync_time === undefined) merged.last_sync_time = null;
            if (merged.update_time === undefined) merged.update_time = new Date().toISOString();
            if (merged.encryption_password === undefined) merged.encryption_password = null;
            if (merged.encryption_iv === undefined) merged.encryption_iv = null;

            const stmt = this.db.prepare(`
                INSERT INTO cloud_sync_config (type, is_enabled, encrypted_token, encrypted_refresh_token, iv, username, target_folder, sync_frequency, last_sync_time, update_time, encryption_password, encryption_iv)
                VALUES (@type, @is_enabled, @encrypted_token, @encrypted_refresh_token, @iv, @username, @target_folder, @sync_frequency, @last_sync_time, @update_time, @encryption_password, @encryption_iv)
                ON CONFLICT(type) DO UPDATE SET
                is_enabled=excluded.is_enabled,
                encrypted_token=excluded.encrypted_token,
                encrypted_refresh_token=excluded.encrypted_refresh_token,
                iv=excluded.iv,
                username=excluded.username,
                target_folder=excluded.target_folder,
                sync_frequency=excluded.sync_frequency,
                last_sync_time=excluded.last_sync_time,
                update_time=excluded.update_time,
                encryption_password=excluded.encryption_password,
                encryption_iv=excluded.encryption_iv
            `);
            
            stmt.run(merged);
            return { success: true };
        } catch (e) {
            this.logToMain(`Update Cloud Sync Config Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getSyncFileRecord(filePath, cloudType) {
        try {
            return this.db.prepare("SELECT * FROM cloud_sync_file_record WHERE file_path = ? AND cloud_type = ?").get(filePath, cloudType);
        } catch (e) {
            return null;
        }
    }

    async updateSyncFileRecord(record) {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO cloud_sync_file_record (file_path, cloud_type, file_md5, modify_time, cloud_path, sync_time)
                VALUES (@file_path, @cloud_type, @file_md5, @modify_time, @cloud_path, @sync_time)
                ON CONFLICT(file_path, cloud_type) DO UPDATE SET
                file_md5=excluded.file_md5,
                modify_time=excluded.modify_time,
                cloud_path=excluded.cloud_path,
                sync_time=excluded.sync_time
            `);
            stmt.run(record);
            return { success: true };
        } catch (e) {
            this.logToMain(`Update Sync File Record Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getSyncObjectRecord(cloudRelPath, cloudType) {
        try {
            return this.db
                .prepare("SELECT * FROM cloud_sync_object_record WHERE cloud_rel_path = ? AND cloud_type = ?")
                .get(cloudRelPath, cloudType);
        } catch (e) {
            return null;
        }
    }

    async updateSyncObjectRecord(record) {
        try {
            const stmt = this.db.prepare(`
                INSERT INTO cloud_sync_object_record (cloud_rel_path, cloud_type, file_md5, modify_time, cloud_path, sync_time, local_root_hint)
                VALUES (@cloud_rel_path, @cloud_type, @file_md5, @modify_time, @cloud_path, @sync_time, @local_root_hint)
                ON CONFLICT(cloud_rel_path, cloud_type) DO UPDATE SET
                file_md5=excluded.file_md5,
                modify_time=excluded.modify_time,
                cloud_path=excluded.cloud_path,
                sync_time=excluded.sync_time,
                local_root_hint=excluded.local_root_hint
            `);
            stmt.run(record);
            return { success: true };
        } catch (e) {
            this.logToMain(`Update Sync Object Record Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async upsertKbFolderMeta(meta) {
        try {
            const now = Date.now();
            const merged = {
                folder_id: meta.folder_id,
                folder_path: meta.folder_path || null,
                source_type: meta.source_type || null,
                origin_path: meta.origin_path || null,
                is_external_reference: meta.is_external_reference === undefined ? 1 : meta.is_external_reference,
                created_at: meta.created_at || now,
                updated_at: now,
                file_count: meta.file_count === undefined ? null : meta.file_count,
                size_bytes: meta.size_bytes === undefined ? null : meta.size_bytes,
                extra_json: meta.extra_json ? JSON.stringify(meta.extra_json) : (meta.extra_json === '' ? '{}' : '{}')
            };

            const stmt = this.db.prepare(`
                INSERT INTO kb_folder_meta (folder_id, folder_path, source_type, origin_path, is_external_reference, created_at, updated_at, file_count, size_bytes, extra_json)
                VALUES (@folder_id, @folder_path, @source_type, @origin_path, @is_external_reference, @created_at, @updated_at, @file_count, @size_bytes, @extra_json)
                ON CONFLICT(folder_id) DO UPDATE SET
                folder_path=excluded.folder_path,
                source_type=excluded.source_type,
                origin_path=excluded.origin_path,
                is_external_reference=excluded.is_external_reference,
                updated_at=excluded.updated_at,
                file_count=COALESCE(excluded.file_count, kb_folder_meta.file_count),
                size_bytes=COALESCE(excluded.size_bytes, kb_folder_meta.size_bytes),
                extra_json=excluded.extra_json
            `);
            stmt.run(merged);
            return { success: true };
        } catch (e) {
            this.logToMain(`Upsert KB Folder Meta Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getKbFolderMeta(folderId) {
        try {
            return this.db.prepare("SELECT * FROM kb_folder_meta WHERE folder_id = ?").get(folderId);
        } catch (e) {
            return null;
        }
    }

    async upsertKbFileMetadata(record) {
        try {
            const now = Date.now();
            const stmt = this.db.prepare(`
                INSERT INTO kb_file_metadata (file_path, title, author, published_time, abstract, keywords_json, source, updated_at)
                VALUES (@file_path, @title, @author, @published_time, @abstract, @keywords_json, @source, @updated_at)
                ON CONFLICT(file_path) DO UPDATE SET
                title=excluded.title,
                author=excluded.author,
                published_time=excluded.published_time,
                abstract=excluded.abstract,
                keywords_json=excluded.keywords_json,
                source=excluded.source,
                updated_at=excluded.updated_at
            `);
            stmt.run({
                file_path: record.file_path,
                title: record.title || null,
                author: record.author || null,
                published_time: record.published_time || null,
                abstract: record.abstract || null,
                keywords_json: JSON.stringify(record.keywords || record.keywords_json || []),
                source: record.source || 'auto',
                updated_at: record.updated_at || now
            });
            return { success: true };
        } catch (e) {
            this.logToMain(`Upsert KB File Metadata Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getKbFileMetadata(filePath) {
        try {
            return this.db.prepare("SELECT * FROM kb_file_metadata WHERE file_path = ?").get(filePath);
        } catch (e) {
            return null;
        }
    }

    async getPlannerEventContext(eventId) {
        try {
            const row = this.db.prepare("SELECT * FROM planner_event_context WHERE event_id = ?").get(eventId);
            if (!row) return null;
            return {
                event_id: row.event_id,
                config: JSON.parse(row.config_json || '{}'),
                updated_at: row.updated_at
            };
        } catch (e) {
            return null;
        }
    }

    async upsertPlannerEventContext(eventId, config) {
        try {
            const now = Date.now();
            this.db.prepare(`
                INSERT INTO planner_event_context (event_id, config_json, updated_at)
                VALUES (?, ?, ?)
                ON CONFLICT(event_id) DO UPDATE SET
                    config_json = excluded.config_json,
                    updated_at = excluded.updated_at
            `).run(eventId, JSON.stringify(config || {}), now);
            return { success: true, updated_at: now };
        } catch (e) {
            this.logToMain(`Upsert Planner Event Context Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async deletePlannerEventContext(eventId) {
        try {
            this.db.prepare("DELETE FROM planner_event_context WHERE event_id = ?").run(eventId);
            return { success: true };
        } catch (e) {
            this.logToMain(`Delete Planner Event Context Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async createProjectIntelRun(run) {
        try {
            const now = Date.now();
            const merged = {
                id: run.id,
                mode: run.mode || null,
                user_query: run.user_query || null,
                urls_json: JSON.stringify(run.urls || run.urls_json || []),
                keywords_json: JSON.stringify(run.keywords || run.keywords_json || []),
                plan_json: JSON.stringify(run.plan || run.plan_json || {}),
                status: run.status || 'created',
                output_dir: run.output_dir || null,
                output_csv_path: run.output_csv_path || null,
                output_html_path: run.output_html_path || null,
                output_md_path: run.output_md_path || null,
                kb_indexed: run.kb_indexed ? 1 : 0,
                created_at: run.created_at || now,
                updated_at: run.updated_at || now
            };

            this.db.prepare(`
                INSERT INTO project_intel_runs (
                    id, mode, user_query, urls_json, keywords_json, plan_json, status,
                    output_dir, output_csv_path, output_html_path, output_md_path, kb_indexed,
                    created_at, updated_at
                ) VALUES (
                    @id, @mode, @user_query, @urls_json, @keywords_json, @plan_json, @status,
                    @output_dir, @output_csv_path, @output_html_path, @output_md_path, @kb_indexed,
                    @created_at, @updated_at
                )
            `).run(merged);
            return { success: true, run: merged };
        } catch (e) {
            this.logToMain(`Create Project Intel Run Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async updateProjectIntelRun(id, updates) {
        try {
            const existing = this.db.prepare("SELECT * FROM project_intel_runs WHERE id = ?").get(id);
            if (!existing) return { success: false, error: 'Run not found' };
            const now = Date.now();
            const merged = {
                ...existing,
                ...updates,
                urls_json: updates.urls_json !== undefined ? updates.urls_json : (updates.urls ? JSON.stringify(updates.urls) : existing.urls_json),
                keywords_json: updates.keywords_json !== undefined ? updates.keywords_json : (updates.keywords ? JSON.stringify(updates.keywords) : existing.keywords_json),
                plan_json: updates.plan_json !== undefined ? updates.plan_json : (updates.plan ? JSON.stringify(updates.plan) : existing.plan_json),
                kb_indexed: updates.kb_indexed === undefined ? existing.kb_indexed : (updates.kb_indexed ? 1 : 0),
                updated_at: now
            };

            this.db.prepare(`
                UPDATE project_intel_runs SET
                    mode=@mode,
                    user_query=@user_query,
                    urls_json=@urls_json,
                    keywords_json=@keywords_json,
                    plan_json=@plan_json,
                    status=@status,
                    output_dir=@output_dir,
                    output_csv_path=@output_csv_path,
                    output_html_path=@output_html_path,
                    output_md_path=@output_md_path,
                    kb_indexed=@kb_indexed,
                    updated_at=@updated_at
                WHERE id=@id
            `).run(merged);

            return { success: true, run: merged };
        } catch (e) {
            this.logToMain(`Update Project Intel Run Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getProjectIntelRun(id) {
        try {
            const row = this.db.prepare("SELECT * FROM project_intel_runs WHERE id = ?").get(id);
            if (!row) return null;
            return {
                ...row,
                urls: JSON.parse(row.urls_json || '[]'),
                keywords: JSON.parse(row.keywords_json || '[]'),
                plan: JSON.parse(row.plan_json || '{}')
            };
        } catch (e) {
            return null;
        }
    }

    async listProjectIntelRuns(limit = 50) {
        try {
            const rows = this.db.prepare("SELECT * FROM project_intel_runs ORDER BY created_at DESC LIMIT ?").all(Math.max(1, Math.min(Number(limit) || 50, 200)));
            return rows.map(r => ({
                ...r,
                urls: JSON.parse(r.urls_json || '[]'),
                keywords: JSON.parse(r.keywords_json || '[]'),
                plan: JSON.parse(r.plan_json || '{}')
            }));
        } catch (e) {
            return [];
        }
    }

    async deleteProjectIntelRun(id) {
        try {
            this.db.prepare("DELETE FROM project_intel_runs WHERE id = ?").run(id);
            return { success: true };
        } catch (e) {
            this.logToMain(`Delete Project Intel Run Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async addProjectIntelItem(item) {
        try {
            const now = Date.now();
            const merged = {
                id: item.id,
                run_id: item.run_id,
                url: item.url || null,
                title: item.title || null,
                snippet: item.snippet || null,
                extracted_json: JSON.stringify(item.extracted || item.extracted_json || {}),
                screenshot_path: item.screenshot_path || null,
                raw_text_path: item.raw_text_path || null,
                created_at: item.created_at || now,
                updated_at: item.updated_at || now
            };
            this.db.prepare(`
                INSERT INTO project_intel_items (
                    id, run_id, url, title, snippet, extracted_json, screenshot_path, raw_text_path, created_at, updated_at
                ) VALUES (
                    @id, @run_id, @url, @title, @snippet, @extracted_json, @screenshot_path, @raw_text_path, @created_at, @updated_at
                )
            `).run(merged);
            return { success: true, item: merged };
        } catch (e) {
            this.logToMain(`Add Project Intel Item Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async updateProjectIntelItem(id, updates) {
        try {
            const existing = this.db.prepare("SELECT * FROM project_intel_items WHERE id = ?").get(id);
            if (!existing) return { success: false, error: 'Item not found' };
            const now = Date.now();
            const merged = {
                ...existing,
                ...updates,
                extracted_json: updates.extracted_json !== undefined ? updates.extracted_json : (updates.extracted ? JSON.stringify(updates.extracted) : existing.extracted_json),
                updated_at: now
            };
            this.db.prepare(`
                UPDATE project_intel_items SET
                    url=@url,
                    title=@title,
                    snippet=@snippet,
                    extracted_json=@extracted_json,
                    screenshot_path=@screenshot_path,
                    raw_text_path=@raw_text_path,
                    updated_at=@updated_at
                WHERE id=@id
            `).run(merged);
            return { success: true, item: merged };
        } catch (e) {
            this.logToMain(`Update Project Intel Item Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async listProjectIntelItems(runId) {
        try {
            const rows = this.db.prepare("SELECT * FROM project_intel_items WHERE run_id = ? ORDER BY created_at DESC").all(runId);
            return rows.map(r => ({
                ...r,
                extracted: JSON.parse(r.extracted_json || '{}')
            }));
        } catch (e) {
            return [];
        }
    }

    async deleteProjectIntelItems(ids) {
        try {
            const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
            if (list.length === 0) return { success: true, deleted: 0 };
            const stmt = this.db.prepare("DELETE FROM project_intel_items WHERE id = ?");
            const tx = this.db.transaction((arr) => {
                for (const id of arr) stmt.run(id);
            });
            tx(list);
            return { success: true, deleted: list.length };
        } catch (e) {
            this.logToMain(`Delete Project Intel Items Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async addProjectIntelHighlight(h) {
        try {
            const merged = {
                id: h.id,
                run_id: h.run_id,
                url: h.url || null,
                title: h.title || null,
                selected_text: h.selected_text || '',
                context_text: h.context_text || '',
                tags_json: JSON.stringify(h.tags || h.tags_json || []),
                created_at: h.created_at || Date.now()
            };
            this.db.prepare(`
                INSERT INTO project_intel_highlights (
                    id, run_id, url, title, selected_text, context_text, tags_json, created_at
                ) VALUES (
                    @id, @run_id, @url, @title, @selected_text, @context_text, @tags_json, @created_at
                )
            `).run(merged);
            return { success: true, highlight: merged };
        } catch (e) {
            this.logToMain(`Add Project Intel Highlight Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async listProjectIntelHighlights(runId) {
        try {
            const rows = this.db.prepare("SELECT * FROM project_intel_highlights WHERE run_id = ? ORDER BY created_at DESC").all(runId);
            return rows.map(r => ({
                ...r,
                tags: JSON.parse(r.tags_json || '[]')
            }));
        } catch (e) {
            return [];
        }
    }

    async deleteProjectIntelHighlights(ids) {
        try {
            const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
            if (list.length === 0) return { success: true, deleted: 0 };
            const stmt = this.db.prepare("DELETE FROM project_intel_highlights WHERE id = ?");
            const tx = this.db.transaction((arr) => {
                for (const id of arr) stmt.run(id);
            });
            tx(list);
            return { success: true, deleted: list.length };
        } catch (e) {
            this.logToMain(`Delete Project Intel Highlights Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async addProjectIntelOcrFrame(f) {
        try {
            const merged = {
                id: f.id,
                run_id: f.run_id,
                url: f.url || null,
                title: f.title || null,
                image_path: f.image_path || null,
                ocr_text: f.ocr_text || '',
                created_at: f.created_at || Date.now()
            };
            this.db.prepare(`
                INSERT INTO project_intel_ocr_frames (
                    id, run_id, url, title, image_path, ocr_text, created_at
                ) VALUES (
                    @id, @run_id, @url, @title, @image_path, @ocr_text, @created_at
                )
            `).run(merged);
            return { success: true, frame: merged };
        } catch (e) {
            this.logToMain(`Add Project Intel OCR Frame Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async listProjectIntelOcrFrames(runId) {
        try {
            return this.db.prepare("SELECT * FROM project_intel_ocr_frames WHERE run_id = ? ORDER BY created_at DESC").all(runId);
        } catch (e) {
            return [];
        }
    }

    async deleteProjectIntelOcrFrames(ids) {
        try {
            const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
            if (list.length === 0) return { success: true, deleted: 0 };
            const stmt = this.db.prepare("DELETE FROM project_intel_ocr_frames WHERE id = ?");
            const tx = this.db.transaction((arr) => {
                for (const id of arr) stmt.run(id);
            });
            tx(list);
            return { success: true, deleted: list.length };
        } catch (e) {
            this.logToMain(`Delete Project Intel OCR Frames Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async createInterconnectJob(job) {
        try {
            const now = Date.now();
            const merged = {
                id: job.id,
                template_id: job.template_id || '',
                title: job.title || '',
                params_json: JSON.stringify(job.params || job.params_json || {}),
                status: job.status || 'created',
                progress: Number(job.progress || 0),
                summary_json: JSON.stringify(job.summary || job.summary_json || {}),
                error: job.error || null,
                related_run_id: job.related_run_id || null,
                created_at: job.created_at || now,
                started_at: job.started_at || null,
                finished_at: job.finished_at || null,
                updated_at: job.updated_at || now
            };
            this.db.prepare(`
                INSERT INTO interconnect_jobs (
                    id, template_id, title, params_json, status, progress, summary_json, error, related_run_id,
                    created_at, started_at, finished_at, updated_at
                ) VALUES (
                    @id, @template_id, @title, @params_json, @status, @progress, @summary_json, @error, @related_run_id,
                    @created_at, @started_at, @finished_at, @updated_at
                )
            `).run(merged);
            return { success: true, job: merged };
        } catch (e) {
            this.logToMain(`Create Interconnect Job Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async updateInterconnectJob(id, updates) {
        try {
            const existing = this.db.prepare("SELECT * FROM interconnect_jobs WHERE id = ?").get(id);
            if (!existing) return { success: false, error: 'Job not found' };
            const merged = {
                ...existing,
                ...updates,
                params_json: updates.params_json !== undefined ? updates.params_json : (updates.params ? JSON.stringify(updates.params) : existing.params_json),
                summary_json: updates.summary_json !== undefined ? updates.summary_json : (updates.summary ? JSON.stringify(updates.summary) : existing.summary_json),
                progress: updates.progress === undefined ? existing.progress : Number(updates.progress || 0),
                updated_at: Date.now()
            };
            this.db.prepare(`
                UPDATE interconnect_jobs SET
                    template_id=@template_id,
                    title=@title,
                    params_json=@params_json,
                    status=@status,
                    progress=@progress,
                    summary_json=@summary_json,
                    error=@error,
                    related_run_id=@related_run_id,
                    started_at=@started_at,
                    finished_at=@finished_at,
                    updated_at=@updated_at
                WHERE id=@id
            `).run(merged);
            return { success: true, job: merged };
        } catch (e) {
            this.logToMain(`Update Interconnect Job Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getInterconnectJob(id) {
        try {
            const row = this.db.prepare("SELECT * FROM interconnect_jobs WHERE id = ?").get(id);
            if (!row) return null;
            return {
                ...row,
                params: JSON.parse(row.params_json || '{}'),
                summary: JSON.parse(row.summary_json || '{}')
            };
        } catch (e) {
            return null;
        }
    }

    async listInterconnectJobs(limit = 100) {
        try {
            const rows = this.db.prepare("SELECT * FROM interconnect_jobs ORDER BY created_at DESC LIMIT ?").all(Math.max(1, Math.min(Number(limit) || 100, 500)));
            return rows.map((r) => ({
                ...r,
                params: JSON.parse(r.params_json || '{}'),
                summary: JSON.parse(r.summary_json || '{}')
            }));
        } catch (e) {
            return [];
        }
    }

    async deleteInterconnectJob(id) {
        try {
            this.db.prepare("DELETE FROM interconnect_jobs WHERE id = ?").run(id);
            return { success: true };
        } catch (e) {
            this.logToMain(`Delete Interconnect Job Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async addInterconnectJobStep(step) {
        try {
            const now = Date.now();
            const merged = {
                id: step.id,
                job_id: step.job_id,
                step_index: Number(step.step_index || 0),
                step_name: step.step_name || '',
                step_type: step.step_type || '',
                status: step.status || 'created',
                request_json: JSON.stringify(step.request || step.request_json || {}),
                response_json: JSON.stringify(step.response || step.response_json || {}),
                error: step.error || null,
                created_at: step.created_at || now,
                updated_at: step.updated_at || now
            };
            this.db.prepare(`
                INSERT INTO interconnect_job_steps (
                    id, job_id, step_index, step_name, step_type, status, request_json, response_json, error, created_at, updated_at
                ) VALUES (
                    @id, @job_id, @step_index, @step_name, @step_type, @status, @request_json, @response_json, @error, @created_at, @updated_at
                )
            `).run(merged);
            return { success: true, step: merged };
        } catch (e) {
            this.logToMain(`Add Interconnect Job Step Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async updateInterconnectJobStep(id, updates) {
        try {
            const existing = this.db.prepare("SELECT * FROM interconnect_job_steps WHERE id = ?").get(id);
            if (!existing) return { success: false, error: 'Step not found' };
            const merged = {
                ...existing,
                ...updates,
                request_json: updates.request_json !== undefined ? updates.request_json : (updates.request ? JSON.stringify(updates.request) : existing.request_json),
                response_json: updates.response_json !== undefined ? updates.response_json : (updates.response ? JSON.stringify(updates.response) : existing.response_json),
                updated_at: Date.now()
            };
            this.db.prepare(`
                UPDATE interconnect_job_steps SET
                    step_index=@step_index,
                    step_name=@step_name,
                    step_type=@step_type,
                    status=@status,
                    request_json=@request_json,
                    response_json=@response_json,
                    error=@error,
                    updated_at=@updated_at
                WHERE id=@id
            `).run(merged);
            return { success: true, step: merged };
        } catch (e) {
            this.logToMain(`Update Interconnect Job Step Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async listInterconnectJobSteps(jobId) {
        try {
            const rows = this.db.prepare("SELECT * FROM interconnect_job_steps WHERE job_id = ? ORDER BY step_index ASC, created_at ASC").all(jobId);
            return rows.map((r) => ({
                ...r,
                request: JSON.parse(r.request_json || '{}'),
                response: JSON.parse(r.response_json || '{}')
            }));
        } catch (e) {
            return [];
        }
    }

    // --- WeChat / Social Media Methods ---

    async saveWechatAccount(account) {
        try {
            const now = Date.now();
            const merged = {
                id: account.id, // AppID
                name: account.name || null,
                app_secret: account.app_secret || null,
                app_secret_iv: account.app_secret_iv || null,
                access_token: account.access_token || null,
                token_expires_at: account.token_expires_at || null,
                preview_openid: account.preview_openid || null,
                created_at: account.created_at || now,
                updated_at: now
            };
            
            this.db.prepare(`
                INSERT INTO wechat_accounts (
                    id, name, app_secret, app_secret_iv, access_token, token_expires_at, preview_openid, created_at, updated_at
                ) VALUES (
                    @id, @name, @app_secret, @app_secret_iv, @access_token, @token_expires_at, @preview_openid, @created_at, @updated_at
                )
                ON CONFLICT(id) DO UPDATE SET
                    name=excluded.name,
                    app_secret=excluded.app_secret,
                    app_secret_iv=excluded.app_secret_iv,
                    access_token=excluded.access_token,
                    token_expires_at=excluded.token_expires_at,
                    preview_openid=excluded.preview_openid,
                    updated_at=excluded.updated_at
            `).run(merged);
            return { success: true };
        } catch (e) {
            this.logToMain(`Save WeChat Account Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getWechatAccounts() {
        try {
            return this.db.prepare("SELECT * FROM wechat_accounts ORDER BY created_at DESC").all();
        } catch (e) {
            return [];
        }
    }
    
    async getWechatAccount(id) {
        try {
            return this.db.prepare("SELECT * FROM wechat_accounts WHERE id = ?").get(id);
        } catch (e) {
            return null;
        }
    }

    async deleteWechatAccount(id) {
        try {
            this.db.prepare("DELETE FROM wechat_accounts WHERE id = ?").run(id);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async saveWechatDraft(draft) {
        try {
            const now = Date.now();
            const merged = {
                id: draft.id,
                account_id: draft.account_id,
                title: draft.title || '',
                author: draft.author || '',
                digest: draft.digest || '',
                content: draft.content || '',
                content_source_url: draft.content_source_url || '',
                thumb_media_id: draft.thumb_media_id || '',
                thumb_url: draft.thumb_url || '',
                show_cover_pic: draft.show_cover_pic === undefined ? 1 : (draft.show_cover_pic ? 1 : 0),
                need_open_comment: draft.need_open_comment === undefined ? 1 : (draft.need_open_comment ? 1 : 0),
                only_fans_can_comment: draft.only_fans_can_comment === undefined ? 0 : (draft.only_fans_can_comment ? 1 : 0),
                media_id: draft.media_id || null,
                status: draft.status || 'local',
                created_at: draft.created_at || now,
                updated_at: now
            };

            this.db.prepare(`
                INSERT INTO wechat_drafts (
                    id, account_id, title, author, digest, content, content_source_url, 
                    thumb_media_id, thumb_url, show_cover_pic, need_open_comment, 
                    only_fans_can_comment, media_id, status, created_at, updated_at
                ) VALUES (
                    @id, @account_id, @title, @author, @digest, @content, @content_source_url,
                    @thumb_media_id, @thumb_url, @show_cover_pic, @need_open_comment,
                    @only_fans_can_comment, @media_id, @status, @created_at, @updated_at
                )
                ON CONFLICT(id) DO UPDATE SET
                    title=excluded.title,
                    author=excluded.author,
                    digest=excluded.digest,
                    content=excluded.content,
                    content_source_url=excluded.content_source_url,
                    thumb_media_id=excluded.thumb_media_id,
                    thumb_url=excluded.thumb_url,
                    show_cover_pic=excluded.show_cover_pic,
                    need_open_comment=excluded.need_open_comment,
                    only_fans_can_comment=excluded.only_fans_can_comment,
                    media_id=excluded.media_id,
                    status=excluded.status,
                    updated_at=excluded.updated_at
            `).run(merged);
            return { success: true };
        } catch (e) {
            this.logToMain(`Save WeChat Draft Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getWechatDrafts(accountId) {
        try {
            if (accountId) {
                return this.db.prepare("SELECT * FROM wechat_drafts WHERE account_id = ? ORDER BY updated_at DESC").all(accountId);
            }
            return this.db.prepare("SELECT * FROM wechat_drafts ORDER BY updated_at DESC").all();
        } catch (e) {
            return [];
        }
    }

    async deleteWechatDraft(id) {
        try {
            this.db.prepare("DELETE FROM wechat_drafts WHERE id = ?").run(id);
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async saveChatMessage(msg) {
        try {
            const row = {
                assistant_id: msg.assistant_id,
                role: msg.role,
                content: msg.content || '',
                sources: JSON.stringify(Array.isArray(msg.sources) ? msg.sources : []),
                entities: JSON.stringify(Array.isArray(msg.entities) ? msg.entities : []),
                timestamp: msg.timestamp || Date.now()
            };
            this.db.prepare(`
                INSERT INTO kb_chat_history (assistant_id, role, content, sources, entities, timestamp)
                VALUES (@assistant_id, @role, @content, @sources, @entities, @timestamp)
            `).run(row);

            this.db.prepare(`
                DELETE FROM kb_chat_history
                WHERE assistant_id = @assistant_id
                  AND id NOT IN (
                    SELECT id FROM kb_chat_history
                    WHERE assistant_id = @assistant_id
                    ORDER BY timestamp DESC, id DESC
                    LIMIT 500
                  )
            `).run({ assistant_id: row.assistant_id });

            this.db.prepare(`
                DELETE FROM kb_chat_history
                WHERE timestamp < @threshold
            `).run({ threshold: Date.now() - 90 * 24 * 60 * 60 * 1000 });

            return { success: true };
        } catch (e) {
            this.logToMain(`Save Chat Message Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }

    async getChatHistory(assistantId) {
        try {
            const parseArraySafe = (value) => {
                if (Array.isArray(value)) return value;
                if (value === null || value === undefined || value === '') return [];
                try {
                    const parsed = JSON.parse(value);
                    return Array.isArray(parsed) ? parsed : [];
                } catch (e) {
                    return [];
                }
            };

            const rows = this.db.prepare(`
                SELECT role, content, sources, entities, timestamp
                FROM kb_chat_history
                WHERE assistant_id = ?
                ORDER BY timestamp ASC
                LIMIT 1000
            `).all(assistantId);
            return rows.map(r => ({
                role: r.role,
                text: r.content,
                sources: parseArraySafe(r.sources),
                entities: parseArraySafe(r.entities),
                timestamp: r.timestamp
            }));
        } catch (e) {
            this.logToMain(`Get Chat History Error: ${e.message}`);
            return [];
        }
    }

    async clearChatHistory(assistantId) {
        try {
            if (assistantId && String(assistantId).trim()) {
                this.db.prepare("DELETE FROM kb_chat_history WHERE assistant_id = ?").run(assistantId);
            } else {
                this.db.prepare("DELETE FROM kb_chat_history").run();
            }
            return { success: true };
        } catch (e) {
            this.logToMain(`Clear Chat History Error: ${e.message}`);
            return { success: false, error: e.message };
        }
    }
}

module.exports = new DatabaseManager();
