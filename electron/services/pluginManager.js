const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const dbManager = require('../databaseManager');

class PluginManager {
    constructor() {
        this.plugins = new Map();
        this.pluginsDir = path.join(app.getPath('userData'), 'plugins');
        this.snapshotDir = path.join(app.getPath('userData'), 'plugin-snapshots');
        this.snapshotMetaPath = path.join(this.snapshotDir, 'latest.json');
        this.isInitialized = false;
        this.enabledMap = {};
        this.safeMode = false;
    }

    async init(options = {}) {
        if (this.isInitialized) return;
        this.safeMode = !!options.safeMode;
        
        // Ensure plugins directory exists
        if (!fs.existsSync(this.pluginsDir)) {
            try {
                fs.mkdirSync(this.pluginsDir, { recursive: true });
            } catch (e) {
                console.error('[PluginManager] Failed to create plugins dir:', e);
            }
        }

        if (this.safeMode) {
            this.plugins.clear();
            this.isInitialized = true;
            console.log('[PluginManager] Initialized in safe mode. Plugin loading skipped.');
            return;
        }
        await this.loadPlugins();
        this.isInitialized = true;
        console.log(`[PluginManager] Initialized. Loaded ${this.plugins.size} plugins.`);
    }

    async resetForReinit() {
        for (const id of Array.from(this.plugins.keys())) {
            this._unloadPlugin(id);
        }
        this.plugins.clear();
        this.isInitialized = false;
    }

    async _loadEnabledMap() {
        try {
            const v = await dbManager.getSetting('plugins_enabled');
            if (v && typeof v === 'object') {
                this.enabledMap = v;
            } else {
                this.enabledMap = {};
            }
        } catch (e) {
            this.enabledMap = {};
        }
    }

    _isEnabled(pluginId) {
        const v = this.enabledMap?.[pluginId];
        if (v === false) return false;
        return true;
    }

    async loadPlugins() {
        if (!fs.existsSync(this.pluginsDir)) return;

        await this._loadEnabledMap();
        const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
        
        for (const entry of entries) {
            if (entry.isDirectory()) {
                this.loadPlugin(path.join(this.pluginsDir, entry.name));
            }
        }
    }

    loadPlugin(pluginPath) {
        try {
            const manifestPath = path.join(pluginPath, 'manifest.json');
            if (!fs.existsSync(manifestPath)) return;

            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            
            // Basic validation
            if (!manifest.id || !manifest.name || !manifest.main) {
                console.warn(`[PluginManager] Invalid manifest at ${pluginPath}`);
                return;
            }

            if (!this._isEnabled(manifest.id)) {
                return;
            }

            const scriptPath = path.join(pluginPath, manifest.main);
            if (!fs.existsSync(scriptPath)) {
                console.warn(`[PluginManager] Main script not found: ${scriptPath}`);
                return;
            }

            // In a real protected app, you might want to run this in a separate process or VM
            // For now, we require it (assuming trust or user-installed)
            // To protect CORE, we don't expose internal modules directly, 
            // but we can pass a "PluginAPI" object to the plugin.
            
            const pluginModule = require(scriptPath);
            
            const pluginInstance = {
                manifest,
                path: pluginPath,
                module: pluginModule,
                status: 'loaded'
            };

            this.plugins.set(manifest.id, pluginInstance);
            
            // Lifecycle: activate
            if (typeof pluginModule.activate === 'function') {
                try {
                    pluginModule.activate(this.getAPI());
                } catch (e) {
                    console.error(`[PluginManager] Error activating ${manifest.id}:`, e);
                    pluginInstance.status = 'error';
                    this._disablePluginAfterFault(manifest.id, String(e?.message || 'activate_failed'));
                }
            }

        } catch (e) {
            console.error(`[PluginManager] Failed to load plugin at ${pluginPath}:`, e);
        }
    }

    async _disablePluginAfterFault(pluginId, reason) {
        try {
            await this._loadEnabledMap();
            this.enabledMap = { ...(this.enabledMap || {}), [pluginId]: false };
            await dbManager.saveSetting('plugins_enabled', this.enabledMap);
            const faults = (await dbManager.getSetting('plugin_faults')) || {};
            const prev = faults && typeof faults === 'object' ? faults : {};
            const old = prev[pluginId] && typeof prev[pluginId] === 'object' ? prev[pluginId] : {};
            prev[pluginId] = {
                count: Number(old.count || 0) + 1,
                lastReason: String(reason || ''),
                updatedAt: Date.now()
            };
            await dbManager.saveSetting('plugin_faults', prev);
            this._unloadPlugin(pluginId);
        } catch (e) {}
    }

    async createSnapshot(reason = 'manual') {
        await fs.promises.mkdir(this.snapshotDir, { recursive: true });
        const contentDir = path.join(this.snapshotDir, 'latest');
        try {
            await fs.promises.rm(contentDir, { recursive: true, force: true });
        } catch (e) {}
        await fs.promises.mkdir(contentDir, { recursive: true });
        if (fs.existsSync(this.pluginsDir)) {
            await fs.promises.cp(this.pluginsDir, path.join(contentDir, 'plugins'), { recursive: true });
        } else {
            await fs.promises.mkdir(path.join(contentDir, 'plugins'), { recursive: true });
        }
        await this._loadEnabledMap();
        await fs.promises.writeFile(
            path.join(contentDir, 'enabled-map.json'),
            JSON.stringify(this.enabledMap || {}, null, 2),
            'utf8'
        );
        const meta = { reason: String(reason || 'manual'), createdAt: Date.now() };
        await fs.promises.writeFile(this.snapshotMetaPath, JSON.stringify(meta, null, 2), 'utf8');
        return { success: true, meta };
    }

    async rollbackSnapshot() {
        const contentDir = path.join(this.snapshotDir, 'latest');
        const pluginsBackup = path.join(contentDir, 'plugins');
        const enabledMapPath = path.join(contentDir, 'enabled-map.json');
        if (!fs.existsSync(pluginsBackup) || !fs.existsSync(enabledMapPath)) {
            return { success: false, error: 'snapshot_not_found' };
        }
        for (const id of Array.from(this.plugins.keys())) {
            this._unloadPlugin(id);
        }
        try {
            await fs.promises.rm(this.pluginsDir, { recursive: true, force: true });
        } catch (e) {}
        await fs.promises.mkdir(this.pluginsDir, { recursive: true });
        await fs.promises.cp(pluginsBackup, this.pluginsDir, { recursive: true });
        try {
            const raw = await fs.promises.readFile(enabledMapPath, 'utf8');
            const parsed = JSON.parse(raw);
            this.enabledMap = parsed && typeof parsed === 'object' ? parsed : {};
        } catch (e) {
            this.enabledMap = {};
        }
        await dbManager.saveSetting('plugins_enabled', this.enabledMap);
        await this.resetForReinit();
        await this.init({ safeMode: false });
        return { success: true };
    }

    getSnapshotStatus() {
        const contentDir = path.join(this.snapshotDir, 'latest');
        const exists = fs.existsSync(path.join(contentDir, 'plugins')) && fs.existsSync(path.join(contentDir, 'enabled-map.json'));
        let meta = null;
        try {
            if (fs.existsSync(this.snapshotMetaPath)) {
                meta = JSON.parse(fs.readFileSync(this.snapshotMetaPath, 'utf8'));
            }
        } catch (e) {}
        return { success: true, exists, meta };
    }

    _unloadPlugin(pluginId) {
        const existing = this.plugins.get(pluginId);
        if (!existing) return;
        try {
            if (existing.module && typeof existing.module.deactivate === 'function') {
                existing.module.deactivate();
            }
        } catch (e) {}
        try {
            const mainRel = existing.manifest?.main;
            if (mainRel) {
                const scriptPath = path.join(existing.path, mainRel);
                delete require.cache[require.resolve(scriptPath)];
            }
        } catch (e) {}
        this.plugins.delete(pluginId);
    }

    async setEnabled(pluginId, enabled) {
        await this.createSnapshot(`set_enabled:${pluginId}`);
        await this._loadEnabledMap();
        this.enabledMap = { ...(this.enabledMap || {}), [pluginId]: !!enabled };
        await dbManager.saveSetting('plugins_enabled', this.enabledMap);
        try {
            if (enabled) {
                const pluginPath = path.join(this.pluginsDir, pluginId);
                this.loadPlugin(pluginPath);
            } else {
                this._unloadPlugin(pluginId);
            }
        } catch (e) {
            await this.rollbackSnapshot();
            throw e;
        }
        return { success: true };
    }

    listInstalledManifests() {
        if (!fs.existsSync(this.pluginsDir)) return [];
        const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
        const list = [];
        for (const e of entries) {
            if (!e.isDirectory()) continue;
            const dir = path.join(this.pluginsDir, e.name);
            const manifestPath = path.join(dir, 'manifest.json');
            if (!fs.existsSync(manifestPath)) continue;
            try {
                const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
                const id = manifest?.id || e.name;
                list.push({
                    id,
                    name: manifest?.name || id,
                    version: manifest?.version || '',
                    description: manifest?.description || '',
                    ui: manifest?.ui || null,
                    path: dir,
                    enabled: this._isEnabled(id),
                    loaded: this.plugins.has(id),
                    status: this.plugins.get(id)?.status || 'not_loaded'
                });
            } catch (err) {}
        }
        return list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    }

    async uninstall(pluginId) {
        await this.createSnapshot(`uninstall:${pluginId}`);
        this._unloadPlugin(pluginId);
        const pluginPath = path.join(this.pluginsDir, pluginId);
        try {
            await fs.promises.rm(pluginPath, { recursive: true, force: true });
        } catch (e) {}
        await this._loadEnabledMap();
        const next = { ...(this.enabledMap || {}) };
        delete next[pluginId];
        this.enabledMap = next;
        await dbManager.saveSetting('plugins_enabled', next);
        return { success: true };
    }

    async installFromDirectory(srcDir) {
        await this.createSnapshot('install_or_update');
        const manifestPath = path.join(srcDir, 'manifest.json');
        if (!fs.existsSync(manifestPath)) throw new Error('manifest.json not found');
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (!manifest.id || !manifest.name || !manifest.main) throw new Error('Invalid manifest');

        const dest = path.join(this.pluginsDir, manifest.id);
        const force = arguments.length >= 2 && arguments[1] && typeof arguments[1] === 'object' ? !!arguments[1].force : false;
        await this._loadEnabledMap();
        const hadExplicitDisabled = this.enabledMap?.[manifest.id] === false;
        const shouldEnableAfter = !hadExplicitDisabled;
        const existed = fs.existsSync(dest);
        if (existed && !force) throw new Error('Plugin already installed');
        await fs.promises.mkdir(this.pluginsDir, { recursive: true });
        if (existed && force) {
            this._unloadPlugin(manifest.id);
            try {
                await fs.promises.rm(dest, { recursive: true, force: true });
            } catch (e) {}
        }
        try {
            await fs.promises.cp(srcDir, dest, { recursive: true });
            await this.setEnabled(manifest.id, shouldEnableAfter);
            return { success: true, id: manifest.id, updated: existed && force };
        } catch (e) {
            await this.rollbackSnapshot();
            throw e;
        }
    }

    // This is the key to Extensibility: The Exposed API
    getAPI() {
        return {
            // Expose safe utilities
            log: (msg) => console.log(`[Plugin] ${msg}`),
            // Expose controlled hooks
            registerCommand: (command, handler) => {
                console.log(`[PluginManager] Registered command: ${command}`);
                // In a real app, bind this to IPC or UI
            },
            // Maybe expose specific services if safe
            // db: ...
        };
    }

    getAllPlugins() {
        return Array.from(this.plugins.values()).map(p => ({
            id: p.manifest.id,
            name: p.manifest.name,
            version: p.manifest.version,
            description: p.manifest.description,
            status: p.status
        }));
    }
}

module.exports = new PluginManager();
