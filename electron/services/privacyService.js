const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const dbManager = require('../databaseManager'); // To get settings if needed

class PrivacyService {
    constructor() {
        this.process = null;
        this.queue = [];
        this.isReady = false;
        this.buffer = '';
        this.pendingRequests = new Map();
        this.requestIdCounter = 0;
        this.isEnabled = false; // Global Toggle
        this.privacyFolders = new Set(); // Folder-specific set
    }

    async init() {
        if (this.isReady) return;

        // Load settings
        const enabled = await dbManager.getSetting('privacy_mode_enabled');
        this.isEnabled = enabled === true || enabled === 'true';
        
        const folders = await dbManager.getSetting('privacy_folders');
        try {
            if (Array.isArray(folders)) {
                this.privacyFolders = new Set(folders.map((x) => String(x || '')).filter(Boolean));
            } else if (typeof folders === 'string' && folders.trim()) {
                const parsed = JSON.parse(folders);
                if (Array.isArray(parsed)) this.privacyFolders = new Set(parsed.map((x) => String(x || '')).filter(Boolean));
            }
        } catch (e) {
            this.privacyFolders = new Set();
        }

        // Even if global disabled, we might need it for folder-specific privacy?
        // User said: "I hope privacy sandbox configuration is at folder level... user can protect some files."
        // So we should probably init if either global OR has folders.
        // But for now, let's assume if there are ANY privacy needs, we init.
        
        if (!this.isEnabled && this.privacyFolders.size === 0) {
            console.log("[PrivacyService] Disabled by settings (No folders + Global off).");
            return;
        }

        console.log("[PrivacyService] Initializing Privacy Guard...");
        
        // Strategy: Prefer compiled binary (Protection), fallback to script (Dev/Open)
        let executablePath;
        let spawnArgs = [];
        let command;

        const binaryName = process.platform === 'win32' ? 'privacy_guard.exe' : 'privacy_guard';
        // In packaged app, binaries might be in resources/bin or similar
        // For this example, we check adjacent to python folder or in a 'bin' folder
        const possibleBinary = path.join(__dirname, '../bin', binaryName);
        
        if (fs.existsSync(possibleBinary)) {
            console.log(`[PrivacyService] Found compiled binary: ${possibleBinary}`);
            command = possibleBinary;
            spawnArgs = [];
        } else {
            // Fallback to Source Script
            const scriptPath = path.join(__dirname, '../python/privacy_guard.py');
            if (fs.existsSync(scriptPath)) {
                console.log(`[PrivacyService] Using source script: ${scriptPath}`);
                command = process.platform === 'win32' ? 'python' : 'python3';
                    spawnArgs = ['-u', scriptPath];
            } else {
                console.error("[PrivacyService] No privacy backend found (neither binary nor script).");
                return;
            }
        }

        try {
            this.process = spawn(command, spawnArgs);

            this.process.stdout.on('data', (data) => {
                this._handleData(data);
            });

            this.process.stderr.on('data', (data) => {
                console.error(`[PrivacyGuard Error] ${data}`);
            });

            this.process.on('close', (code) => {
                console.log(`[PrivacyService] Process exited with code ${code}`);
                this.isReady = false;
                this.process = null;
            });

            this.isReady = true;
            console.log("[PrivacyService] Ready.");
        } catch (e) {
            console.error("[PrivacyService] Failed to spawn python process:", e);
        }
    }

    async setEnabled(enabled) {
        this.isEnabled = enabled;
        await dbManager.saveSetting('privacy_mode_enabled', enabled ? 'true' : 'false');
        this._checkStatus();
    }

    async addPrivacyFolder(folderPath) {
        this.privacyFolders.add(folderPath);
        await this._saveFolders();
        this._checkStatus();
    }

    async removePrivacyFolder(folderPath) {
        this.privacyFolders.delete(folderPath);
        await this._saveFolders();
        this._checkStatus(); // Might stop if no folders and global off
    }

    async getPrivacyFolders() {
        // Ensure initialized to read from DB
        if (this.privacyFolders.size === 0) {
             const folders = await dbManager.getSetting('privacy_folders');
             if (folders) {
                 try {
                     if (Array.isArray(folders)) this.privacyFolders = new Set(folders.map((x) => String(x || '')).filter(Boolean));
                     else if (typeof folders === 'string') this.privacyFolders = new Set((JSON.parse(folders) || []).map((x) => String(x || '')).filter(Boolean));
                 } catch(e) {}
             }
        }
        return Array.from(this.privacyFolders);
    }

    _normalizePath(p) {
        try {
            return path.resolve(String(p || '')).replace(/\\/g, '/');
        } catch (e) {
            return String(p || '').replace(/\\/g, '/');
        }
    }

    isPrivacyProtected(filePath) {
        if (this.isEnabled) return true; // Global override
        if (!filePath) return false;
        
        const file = this._normalizePath(filePath);
        // Check if filePath starts with any privacy folder (path boundary safe)
        for (const folder of this.privacyFolders) {
            const base = this._normalizePath(folder).replace(/\/+$/, '') + '/';
            if (file === base.slice(0, -1) || file.startsWith(base)) {
                return true;
            }
        }
        return false;
    }

    async _saveFolders() {
        await dbManager.saveSetting('privacy_folders', Array.from(this.privacyFolders));
    }

    async _checkStatus() {
        const shouldRun = this.isEnabled || this.privacyFolders.size > 0;
        if (shouldRun && !this.isReady) {
            await this.init();
        } else if (!shouldRun && this.isReady) {
            this.stop();
        }
    }

    stop() {
        if (this.process) {
            this.process.kill();
            this.process = null;
            this.isReady = false;
        }
    }

    _handleData(data) {
        // Handle stream fragmentation
        this.buffer += data.toString();
        
        let boundary = this.buffer.indexOf('\n');
        while (boundary !== -1) {
            const line = this.buffer.substring(0, boundary);
            this.buffer = this.buffer.substring(boundary + 1);
            
            if (line.trim()) {
                try {
                    const json = JSON.parse(line);
                    // We need a way to correlate request/response.
                    // Since we use stdin/stdout, it's serial if we don't have IDs.
                    // For simplicity, let's assume we process one at a time or use a queue.
                    // But `spawn` stdio is async.
                    // To map correctly, we should send an ID in request and echo it back.
                    // But my python script currently doesn't echo ID.
                    // I will update python script to echo ID or just use FIFO queue since it's a single process.
                    
                    const resolver = this.queue.shift();
                    if (resolver) {
                        if (json.error) resolver.reject(new Error(json.error));
                        else resolver.resolve(json);
                    }
                } catch (e) {
                    console.error("[PrivacyService] JSON Parse Error:", e);
                }
            }
            boundary = this.buffer.indexOf('\n');
        }
    }

    async anonymize(text, force = false) {
        if (!force && !this.isEnabled && this.privacyFolders.size === 0) return { text, mapping: {} };
        if (!this.isReady) await this.init();
        if (!this.process) return { text, mapping: {} }; // Fail safe

        return this._send({ command: 'anonymize', text });
    }

    async deanonymize(text, mapping, force = false) {
        if (!force && !this.isEnabled && this.privacyFolders.size === 0) return { text };
        if (!this.isReady) await this.init();
        if (!this.process) return { text };

        return this._send({ command: 'deanonymize', text, mapping });
    }

    _send(payload) {
        return new Promise((resolve, reject) => {
            this.queue.push({ resolve, reject });
            // Send as single line JSON
            this.process.stdin.write(JSON.stringify(payload) + '\n');
        });
    }
}

module.exports = new PrivacyService();
