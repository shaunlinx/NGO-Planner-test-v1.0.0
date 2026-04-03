const path = require('path');
const dbManager = require('../databaseManager');
const fs = require('fs');

let chokidar;

class ProjectWatcher {
    constructor(ingestionQueue) {
        this.ingestionQueue = ingestionQueue;
        this.watchers = new Map(); // path -> FSWatcher
        this.projectPaths = new Map(); // path -> { id, status, title }
    }

    async init() {
        if (!chokidar) {
            try {
                const m = await import('chokidar');
                chokidar = m.default || m;
            } catch (e) {
                console.error('[ProjectWatcher] Failed to load chokidar:', e);
                return;
            }
        }
        console.log('[ProjectWatcher] Initializing...');
        await this.refresh();
    }

    async refresh() {
        try {
            const projects = await dbManager.getAllProjects();
            const newPaths = new Map();

            // 1. Map Projects to Paths
            // Default storage path
            // const defaultStorage = path.join(require('electron').app.getPath('userData'), 'storage', 'PLAN');
            // We can watch defaultStorage, but we need to know which file belongs to which project.
            // For Warehouse projects (custom source), we watch the source dir.
            
            for (const p of projects) {
                if (p.source && p.source !== 'Local' && fs.existsSync(p.source)) {
                    // Warehouse Project
                    newPaths.set(p.source, { id: p.id, status: p.status, title: p.title, type: 'warehouse' });
                } else {
                    // Local Project - Files are in storage/PLAN but mixed? 
                    // Or maybe we don't watch individual files for Local projects via folder watch 
                    // unless we can map them. 
                    // For now, let's focus on Warehouse/Folder-based projects which are the main use case for "Import Folder".
                    // If "Local", we assume files are handled via App UI and manually ingested?
                    // But user wants "continuous update". 
                    // If Local files are modified via App, we should trigger ingest.
                    // If App modifies file -> it calls fs.writeFile -> we can hook there or rely on watcher if we watch storage/PLAN.
                }
            }

            // 2. Reconcile Watchers
            // Remove old watchers
            for (const [watchedPath, watcher] of this.watchers) {
                if (!newPaths.has(watchedPath)) {
                    console.log(`[ProjectWatcher] Unwatching: ${watchedPath}`);
                    await watcher.close();
                    this.watchers.delete(watchedPath);
                }
            }

            // Add new watchers
            for (const [dirPath, info] of newPaths) {
                // We watch ALL projects (Active & Archived). 
                // But we handle events differently based on status.
                
                if (!this.watchers.has(dirPath)) {
                    console.log(`[ProjectWatcher] Watching: ${dirPath} (${info.status})`);
                    const watcher = chokidar.watch(dirPath, {
                        ignored: /(^|[\/\\])\../, // ignore dotfiles
                        persistent: true,
                        ignoreInitial: true, // Don't ingest everything on startup, assume initial ingest is done or manual
                        depth: 5
                    });

                    watcher
                        .on('add', path => this.handleFileChange(path, dirPath, 'add'))
                        .on('change', path => this.handleFileChange(path, dirPath, 'change'))
                        .on('unlink', path => this.handleFileRemove(path, dirPath));

                    this.watchers.set(dirPath, watcher);
                }
                
                // Update info (status might change)
                this.projectPaths.set(dirPath, info);
            }

        } catch (e) {
            console.error("[ProjectWatcher] Refresh Error:", e);
        }
    }

    async handleFileChange(filePath, rootPath, event) {
        const projectInfo = this.projectPaths.get(rootPath);
        if (!projectInfo) return;

        // If Archived, we DO NOT sync changes (Read-Only Mode)
        // "When project archived... cannot be edited." -> Freeze KB state.
        if (projectInfo.status === 'Archived') {
            // console.log(`[ProjectWatcher] Ignored change in Archived project: ${filePath}`);
            return;
        }

        // Filter file types
        const ext = path.extname(filePath).toLowerCase();
        if (!['.pdf', '.docx', '.txt', '.md', '.pptx', '.xlsx', '.csv'].includes(ext)) return;

        console.log(`[ProjectWatcher] File ${event}: ${filePath} (Project: ${projectInfo.title})`);
        
        // Trigger Ingestion (Lazy Processing)
        // ingestionQueue handles deduping and processing
        this.ingestionQueue.add({
            name: path.basename(filePath),
            path: filePath,
            projectId: projectInfo.id,
            category: 'Project File'
        });
    }

    async handleFileRemove(filePath, rootPath) {
        const projectInfo = this.projectPaths.get(rootPath);
        if (!projectInfo) return;

        // Even if archived, if file is deleted, we should probably remove index to avoid dead links?
        // But if it's "Read Only", maybe we keep the index?
        // Usually "Archived" means "Don't touch". 
        // If user deletes file from disk, they probably want it gone from KB too.
        
        console.log(`[ProjectWatcher] File removed: ${filePath}`);
        
        try {
            // Remove from Vector DB
            const vectorStore = require('./rag/vectorStore');
            await vectorStore.deleteDocuments(filePath);
            
            // Remove from Stats
            await dbManager.deleteFileStats([filePath]);

            // Update kb_ingested_files setting
            const current = await dbManager.getSetting('kb_ingested_files') || [];
            if (Array.isArray(current)) {
                const next = current.filter(p => p !== filePath);
                if (next.length !== current.length) {
                    await dbManager.saveSetting('kb_ingested_files', next);
                }
            }
        } catch (e) {
            console.error("Failed to handle file removal:", e);
        }
    }

    async forceRescan(specificFiles = []) {
        console.log('[ProjectWatcher] Force Rescan triggered.');
        if (specificFiles && specificFiles.length > 0) {
            console.log(`[ProjectWatcher] Rescanning ${specificFiles.length} specific files.`);
        }
        
        let count = 0;
        
        // Helper to process a single file path
        const processFile = (fullPath, projectId) => {
            const ext = path.extname(fullPath).toLowerCase();
            if (['.pdf', '.docx', '.txt', '.md', '.pptx', '.xlsx', '.csv'].includes(ext)) {
                this.ingestionQueue.add({
                    name: path.basename(fullPath),
                    path: fullPath,
                    projectId: projectId || 'unknown',
                    category: 'Project File'
                });
                count++;
            }
        };

        if (specificFiles && specificFiles.length > 0) {
            // Mode 1: Rescan specific files (Selective)
            for (const filePath of specificFiles) {
                let targetPath = filePath;
                let exists = fs.existsSync(targetPath);
                
                // MacOS Normalization Fallback
                if (!exists && process.platform === 'darwin') {
                    if (fs.existsSync(targetPath.normalize('NFC'))) {
                         targetPath = targetPath.normalize('NFC');
                         exists = true;
                    } else if (fs.existsSync(targetPath.normalize('NFD'))) {
                         targetPath = targetPath.normalize('NFD');
                         exists = true;
                    }
                }

                if (exists) {
                    // Try to find project ID for context (optional)
                    let projectId = 'unknown';
                    for (const [dirPath, info] of this.projectPaths) {
                        if (targetPath.startsWith(dirPath)) {
                            projectId = info.id;
                            break;
                        }
                    }
                    processFile(targetPath, projectId);
                } else {
                    console.warn(`[ProjectWatcher] File not found: ${filePath}`);
                }
            }
        } else {
            // Mode 2: Rescan ALL (Recursive)
            const scanDir = (dir, projectId) => {
                try {
                    if (!fs.existsSync(dir)) return;
                    const entries = fs.readdirSync(dir, { withFileTypes: true });
                    for (const entry of entries) {
                        const fullPath = path.join(dir, entry.name);
                        if (entry.isDirectory()) {
                             if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
                                 scanDir(fullPath, projectId);
                             }
                        } else if (entry.isFile()) {
                            processFile(fullPath, projectId);
                        }
                    }
                } catch (e) {
                    console.warn(`[ProjectWatcher] Scan error for ${dir}:`, e.message);
                }
            };

            for (const [dirPath, info] of this.projectPaths) {
                // Only scan active projects
                if (info.status !== 'Archived') {
                    console.log(`[ProjectWatcher] Scanning project: ${dirPath}`);
                    scanDir(dirPath, info.id);
                }
            }
        }
        
        console.log(`[ProjectWatcher] Rescan complete. Queued ${count} files.`);
        return { success: true, count };
    }
}

module.exports = ProjectWatcher;
