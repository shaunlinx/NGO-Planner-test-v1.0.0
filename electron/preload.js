
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel, ...args) => {
    // Whitelist channels for direct invocation
    const validChannels = [
        'cloud-sync-start',
        'cloud-sync-pull',
        'cloud-sync-get-config',
        'cloud-sync-save-config',
        'kb-export-local-mounts',
        'kb-upsert-folder-meta',
        'kb-get-folder-meta',
        'kb-get-file-metadata',
        'kb-save-file-metadata',
        'kb-extract-file-metadata',
        'kb-queue-file-metadata',
        'kb-search-mounted-files'
    ];
    if (validChannels.includes(channel)) {
        return ipcRenderer.invoke(channel, ...args);
    }
    // Fallback or error? For now, allowing it if it matches known patterns or throw error
    // To match legacy behavior if user code calls window.electronAPI.invoke('xyz')
    return ipcRenderer.invoke(channel, ...args);
  },
  isDesktop: true,
  shell: {
    openPath: (path) => ipcRenderer.invoke('shell-open-path', path),
    openExternal: (url) => ipcRenderer.invoke('shell-open-external', url),
    showItemInFolder: (path) => ipcRenderer.invoke('shell-show-item', path)
  },
  fs: {
    ensureDir: (path) => ipcRenderer.invoke('fs-ensure-dir', path),
    writeFile: (filePath, content, options) => ipcRenderer.invoke('fs-write-file', filePath, content, options),
    readFile: (filePath) => ipcRenderer.invoke('fs-read-file', filePath),
    readFilePreview: (filePath) => ipcRenderer.invoke('fs-read-file-preview', filePath),
    exists: (filePath) => ipcRenderer.invoke('fs-exists', filePath),
    deleteFile: (filePath) => ipcRenderer.invoke('fs-delete-file', filePath),
    openPath: (path) => ipcRenderer.invoke('shell-open-path', path),
    openExternal: (url) => ipcRenderer.invoke('shell-open-external', url),
    selectFile: (options) => ipcRenderer.invoke('dialog-open-file', options || {}),
    selectFolder: () => ipcRenderer.invoke('dialog-open-directory'),
    deleteDirectory: (dirPath) => ipcRenderer.invoke('fs-delete-directory', dirPath),
    readDir: (dirPath) => ipcRenderer.invoke('fs-read-dir', dirPath),
    copyFiles: (src, dest) => ipcRenderer.invoke('fs-copy-files', src, dest),
    // AI Migration Assistant Ops
    createSymlink: (target, path) => ipcRenderer.invoke('fs-symlink', target, path),
    createShortcut: (target, path) => ipcRenderer.invoke('fs-create-shortcut', target, path), // New IPC
    resolveLink: (path) => ipcRenderer.invoke('fs-resolve-link', path), // New IPC
    rename: (oldPath, newPath) => ipcRenderer.invoke('fs-rename', oldPath, newPath),
    copyFile: (src, dest) => ipcRenderer.invoke('fs-copy-file', src, dest),
    readBuffer: (filePath) => ipcRenderer.invoke('fs-read-buffer', filePath) // New for PDF
  },
  readingMode: {
      createProject: (id, purpose) => ipcRenderer.invoke('db:create-reading-project', { id, purpose }),
      getProjects: () => ipcRenderer.invoke('db:get-reading-projects'),
      createSession: (id, projectId, filePath) => ipcRenderer.invoke('db:create-reading-session', { id, projectId, filePath }),
      getSessions: (projectId) => ipcRenderer.invoke('db:get-reading-sessions', projectId),
      createCard: (card) => ipcRenderer.invoke('db:create-knowledge-card', card),
      getCards: (sessionId) => ipcRenderer.invoke('db:get-knowledge-cards', sessionId),
      updateCard: (id, updates) => ipcRenderer.invoke('db:update-knowledge-card', { id, updates }),
      deleteCard: (id) => ipcRenderer.invoke('db:delete-knowledge-card', id),
      saveSummary: (summary) => ipcRenderer.invoke('db:save-reading-summary', summary),
      getSummary: (targetId) => ipcRenderer.invoke('db:get-reading-summary', targetId),
      saveGraph: (graph) => ipcRenderer.invoke('db-save-graph-snapshot', graph),
      getSavedGraphs: () => ipcRenderer.invoke('db-get-saved-graphs'),
      deleteSavedGraph: (id) => ipcRenderer.invoke('db-delete-saved-graph', id)
  },
  storage: {
    persist: (data) => ipcRenderer.invoke('storage-persist', data)
  },
  plannerContext: {
    get: (eventId) => ipcRenderer.invoke('planner-context-get', eventId),
    upsert: (eventId, config) => ipcRenderer.invoke('planner-context-upsert', { eventId, config }),
    delete: (eventId) => ipcRenderer.invoke('planner-context-delete', eventId),
    saveReferencePack: (params) => ipcRenderer.invoke('planner-context-save-reference-pack', params)
  },
  llm: {
    openaiListModels: (params) => ipcRenderer.invoke('llm-openai-list-models', params),
    openaiTest: (params) => ipcRenderer.invoke('llm-openai-test', params)
  },
  knowledge: {
    startQuery: (params) => ipcRenderer.invoke('kb-start-query', params),
    controlAction: (params) => ipcRenderer.invoke('kb-control-action', params),
    query: (params) => ipcRenderer.invoke('kb-query', params),
    upload: (fileData) => ipcRenderer.invoke('kb-upload-file', fileData),
    deleteIndex: (filePath) => ipcRenderer.invoke('kb-delete-file-index', filePath),
    resetIndex: () => ipcRenderer.invoke('kb-reset-index'),
    rebuildIndex: (filePaths) => ipcRenderer.invoke('kb-rebuild-index', filePaths),
    getStats: () => ipcRenderer.invoke('kb-get-stats'),
    updateStatus: (params) => ipcRenderer.invoke('kb-update-status', params),
    batchDelete: (filePaths) => ipcRenderer.invoke('kb-batch-delete', filePaths),
    analyzeStats: (stats) => ipcRenderer.invoke('kb-ai-analyze-stats', stats),
    analyzeFile: (params) => ipcRenderer.invoke('kb-ai-analyze-file', params),
    getChunks: (params) => ipcRenderer.invoke('kb-get-file-chunks', params),
    deleteChunk: (params) => ipcRenderer.invoke('kb-delete-chunk', params),
    updateChunk: (params) => ipcRenderer.invoke('kb-update-chunk', params),
    batchAiChunks: (params) => ipcRenderer.invoke('kb-batch-ai-chunks', params),
    generateGraph: (filePaths) => ipcRenderer.invoke('kb-generate-graph', filePaths), // New Graph Gen
    completion: (params) => ipcRenderer.invoke('kb-completion', params), // New: Direct LLM Access
    togglePrivacy: (enabled) => ipcRenderer.invoke('kb-toggle-privacy', enabled),
    updateReadingStats: (params) => ipcRenderer.invoke('kb-update-reading-stats', params),
    getFileTopTags: (filePaths, limit) => ipcRenderer.invoke('kb-get-file-top-tags', filePaths, limit),
    getExtendedStats: () => ipcRenderer.invoke('kb-get-extended-stats'),
    scanStaleReadingHistory: (options) => ipcRenderer.invoke('kb-scan-stale-reading-history', options || {}),
    deleteReadingHistory: (filePath) => ipcRenderer.invoke('kb-delete-reading-history', filePath),
    getPrivacyStatus: () => ipcRenderer.invoke('kb-get-privacy-status'),
    getPrivacyFolders: () => ipcRenderer.invoke('kb-get-privacy-folders'),
    addPrivacyFolder: (path) => ipcRenderer.invoke('kb-add-privacy-folder', path),
    removePrivacyFolder: (path) => ipcRenderer.invoke('kb-remove-privacy-folder', path),
    proposeStructure: (params) => ipcRenderer.invoke('kb-ai-structure-proposal', params), // New AI Op
    onIngestProgress: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('kb-ingest-progress', subscription);
        return () => ipcRenderer.removeListener('kb-ingest-progress', subscription);
    },
    onFileMetadataUpdated: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('kb-file-metadata-updated', subscription);
        return () => ipcRenderer.removeListener('kb-file-metadata-updated', subscription);
    },
    // Chat History Ops
    chat: {
        saveMessage: (msg) => ipcRenderer.invoke('db:save-chat-message', msg),
        getHistory: (assistantId) => ipcRenderer.invoke('db:get-chat-history', assistantId),
        clearHistory: (assistantId) => ipcRenderer.invoke('db:clear-chat-history', assistantId),
        clearAllHistory: () => ipcRenderer.invoke('db:clear-chat-history', '')
    }
  },
  llm: {
    openaiListModels: (params) => ipcRenderer.invoke('llm-openai-list-models', params),
    openaiTest: (params) => ipcRenderer.invoke('llm-openai-test', params)
  },
  // Expose on/removeListener for generic events if needed, but better to be explicit.
  // We need to listen to 'kb-progress'.
  on: (channel, callback) => {
      if (['kb-progress'].includes(channel)) {
          ipcRenderer.on(channel, (event, ...args) => callback(event, ...args));
      }
  },
  removeListener: (channel, callback) => {
      if (['kb-progress'].includes(channel)) {
          ipcRenderer.removeListener(channel, callback);
      }
  },
  db: {
      getProjects: () => ipcRenderer.invoke('db-get-projects'),
      saveProject: (project) => ipcRenderer.invoke('db-save-project', project),
      deleteProject: (id) => ipcRenderer.invoke('db-delete-project', id),
      getSetting: (key) => ipcRenderer.invoke('db-get-setting', key),
      saveSetting: (key, value) => ipcRenderer.invoke('db-save-setting', { key, value }),
  },
  update: {
    getVersion: () => ipcRenderer.invoke('app-get-version'),
  },
  app: {
      clearCache: (options) => ipcRenderer.invoke('app-clear-cache', options),
      getCacheSize: () => ipcRenderer.invoke('app-get-cache-size')
  },
  appEvents: {
      onDataRefresh: (callback) => {
          const subscription = (event, data) => callback(data);
          ipcRenderer.on('app:data-refresh', subscription);
          return () => ipcRenderer.removeListener('app:data-refresh', subscription);
      }
  },
  getPath: (name) => ipcRenderer.invoke('app-get-path', name),
  secure: {
    set: (key, value) => ipcRenderer.invoke('secure-set', key, value),
    get: (key) => ipcRenderer.invoke('secure-get', key)
  },
  clipboard: {
    readText: () => ipcRenderer.invoke('clipboard-read-text'),
    writeText: (text) => ipcRenderer.invoke('clipboard-write-text', text)
  },
  crawler: {
    open: (url) => ipcRenderer.invoke('crawler-open', url),
    start: () => ipcRenderer.invoke('crawler-start'),
    stop: () => ipcRenderer.invoke('crawler-stop'),
    onUpdate: (callback) => ipcRenderer.on('crawler-update', (event, data) => callback(data)),
    onDataFound: (callback) => ipcRenderer.on('crawler-data-found', (event, data) => callback(data)),
    offUpdate: () => ipcRenderer.removeAllListeners('crawler-update'),
    offDataFound: () => ipcRenderer.removeAllListeners('crawler-data-found')
  },
  projectIntel: {
    createRun: (params) => ipcRenderer.invoke('project-intel-create-run', params),
    listRuns: (limit) => ipcRenderer.invoke('project-intel-list-runs', limit),
    getRun: (runId) => ipcRenderer.invoke('project-intel-get-run', runId),
    deleteRun: (runId) => ipcRenderer.invoke('project-intel-delete-run', runId),
    listItems: (runId) => ipcRenderer.invoke('project-intel-list-items', runId),
    updateItem: (itemId, updates) => ipcRenderer.invoke('project-intel-update-item', { itemId, updates }),
    openBrowser: (params) => ipcRenderer.invoke('project-intel-open-browser', params),
    browserNavigate: (action, payload) => ipcRenderer.invoke('project-intel-browser-navigate', { action, payload }),
    getBrowserState: () => ipcRenderer.invoke('project-intel-browser-state'),
    listBookmarks: () => ipcRenderer.invoke('project-intel-browser-bookmarks-list'),
    addBookmark: (payload) => ipcRenderer.invoke('project-intel-browser-bookmarks-add', payload || {}),
    removeBookmark: (id) => ipcRenderer.invoke('project-intel-browser-bookmarks-remove', id),
    listBrowserHistory: (limit) => ipcRenderer.invoke('project-intel-browser-history-list', limit),
    clearBrowserHistory: () => ipcRenderer.invoke('project-intel-browser-history-clear'),
    showEngineMenu: (payload) => ipcRenderer.invoke('project-intel-engine-menu', payload || {}),
    setEmbedBounds: (bounds) => ipcRenderer.invoke('project-intel-embed-set-bounds', bounds),
    hideEmbed: () => ipcRenderer.invoke('project-intel-embed-hide'),
    plan: (params) => ipcRenderer.invoke('project-intel-plan', params),
    startRun: (runId, params) => ipcRenderer.invoke('project-intel-start-run', { runId, params }),
    stopRun: (runId) => ipcRenderer.invoke('project-intel-stop-run', runId),
    startReading: (params) => ipcRenderer.invoke('project-intel-reading-start', params),
    stopReading: (runId) => ipcRenderer.invoke('project-intel-reading-stop', runId),
    captureCurrentPage: (runId) => ipcRenderer.invoke('project-intel-capture-current-page', runId),
    listHighlights: (runId) => ipcRenderer.invoke('project-intel-list-highlights', runId),
    listOcrFrames: (runId) => ipcRenderer.invoke('project-intel-list-ocr-frames', runId),
    deleteCaptureRecords: (payload) => ipcRenderer.invoke('project-intel-delete-capture-records', payload || {}),
    importCaptureToKb: (payload) => ipcRenderer.invoke('project-intel-import-capture-to-kb', payload || {}),
    exportRun: (runId) => ipcRenderer.invoke('project-intel-export-run', runId),
    onUpdate: (callback) => ipcRenderer.on('project-intel:update', (event, data) => callback(data)),
    onItemFound: (callback) => ipcRenderer.on('project-intel:item-found', (event, data) => callback(data)),
    offUpdate: () => ipcRenderer.removeAllListeners('project-intel:update'),
    offItemFound: () => ipcRenderer.removeAllListeners('project-intel:item-found')
  },
  interconnect: {
    listTemplates: () => ipcRenderer.invoke('interconnect-list-templates'),
    createJob: (params) => ipcRenderer.invoke('interconnect-create-job', params || {}),
    listJobs: (limit) => ipcRenderer.invoke('interconnect-list-jobs', limit),
    getJob: (jobId) => ipcRenderer.invoke('interconnect-get-job', jobId),
    listSteps: (jobId) => ipcRenderer.invoke('interconnect-list-steps', jobId),
    runJob: (jobId) => ipcRenderer.invoke('interconnect-run-job', jobId),
    stopJob: (jobId) => ipcRenderer.invoke('interconnect-stop-job', jobId),
    deleteJob: (jobId) => ipcRenderer.invoke('interconnect-delete-job', jobId),
    onUpdate: (callback) => ipcRenderer.on('interconnect:update', (event, data) => callback(data)),
    offUpdate: () => ipcRenderer.removeAllListeners('interconnect:update')
  },
  openclaw: {
    getStatus: () => ipcRenderer.invoke('openclaw-get-status'),
    ensureRunning: () => ipcRenderer.invoke('openclaw-ensure-running'),
    setEnabled: (enabled) => ipcRenderer.invoke('openclaw-set-enabled', enabled),
    stop: () => ipcRenderer.invoke('openclaw-stop'),
    takeover: (payload) => ipcRenderer.invoke('openclaw-takeover', payload || {}),
    runAgentMessage: (message) => ipcRenderer.invoke('openclaw-run-agent-message', message),
    openDashboard: () => ipcRenderer.invoke('openclaw-open-dashboard'),
    embed: {
      show: (payload) => ipcRenderer.invoke('openclaw-embed-show', payload || {}),
      hide: () => ipcRenderer.invoke('openclaw-embed-hide'),
      resize: (payload) => ipcRenderer.invoke('openclaw-embed-resize', payload || {}),
      reload: () => ipcRenderer.invoke('openclaw-embed-reload')
    },
    getGatewayToken: () => ipcRenderer.invoke('openclaw-get-gateway-token'),
    getBridgeToken: () => ipcRenderer.invoke('openclaw-get-bridge-token'),
    rotateGatewayToken: () => ipcRenderer.invoke('openclaw-rotate-gateway-token'),
    rotateBridgeToken: () => ipcRenderer.invoke('openclaw-rotate-bridge-token'),
    syncBridgeSkill: () => ipcRenderer.invoke('openclaw-sync-bridge-skill'),
    getGatewayLogTail: (lines) => ipcRenderer.invoke('openclaw-get-gateway-log-tail', lines),
    getAgentLogTail: (lines) => ipcRenderer.invoke('openclaw-get-agent-log-tail', lines),
    getRuntimeLogTail: (lines) => ipcRenderer.invoke('openclaw-get-runtime-log-tail', lines),
    plugins: {
      list: () => ipcRenderer.invoke('openclaw-plugins-list'),
      install: (spec) => ipcRenderer.invoke('openclaw-plugins-install', spec)
    },
    utilitySkills: {
      list: () => ipcRenderer.invoke('openclaw-utility-skills-list'),
      install: (payload) => ipcRenderer.invoke('openclaw-utility-skills-install', payload || {}),
      setEnabled: (payload) => ipcRenderer.invoke('openclaw-utility-skills-set-enabled', payload || {}),
      remove: (payload) => ipcRenderer.invoke('openclaw-utility-skills-remove', payload || {}),
      update: (payload) => ipcRenderer.invoke('openclaw-utility-skills-update', payload || {})
    },
    gateway: {
      restart: () => ipcRenderer.invoke('openclaw-gateway-restart')
    },
    applyNgoPreset: () => ipcRenderer.invoke('openclaw-apply-ngo-preset'),
    scrubSensitive: () => ipcRenderer.invoke('openclaw-scrub-sensitive'),
    security: {
      getStatus: () => ipcRenderer.invoke('openclaw-security-status'),
      setConfig: (payload) => ipcRenderer.invoke('openclaw-security-set-config', payload || {}),
      hardenNow: (payload) => ipcRenderer.invoke('openclaw-security-harden-now', payload || {})
    },
    listArtifacts: (params) => ipcRenderer.invoke('openclaw-list-artifacts', params || {}),
    bridgeHealth: () => ipcRenderer.invoke('openclaw-bridge-health'),
    bridgeRequest: (payload) => ipcRenderer.invoke('openclaw-bridge-request', payload || {}),
    managed: {
      getStatus: () => ipcRenderer.invoke('openclaw-managed-status'),
      install: (options) => ipcRenderer.invoke('openclaw-managed-install', options || {}),
      cancel: () => ipcRenderer.invoke('openclaw-managed-cancel'),
      rollback: () => ipcRenderer.invoke('openclaw-managed-rollback'),
      uninstall: () => ipcRenderer.invoke('openclaw-managed-uninstall'),
      onProgress: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('openclaw:install-progress', subscription);
        return () => ipcRenderer.removeListener('openclaw:install-progress', subscription);
      }
    }
  },
  claudeCode: {
    getStatus: () => ipcRenderer.invoke('claude-code-status'),
    setEnabled: (enabled) => ipcRenderer.invoke('claude-code-set-enabled', !!enabled),
    setExecutablePath: (p) => ipcRenderer.invoke('claude-code-set-bin', p),
    installFromPath: (p) => ipcRenderer.invoke('claude-code-install-from-path', p),
    clearExecutablePath: () => ipcRenderer.invoke('claude-code-clear-bin'),
    uninstallManaged: () => ipcRenderer.invoke('claude-code-uninstall-managed'),
    resolveSystemProxy: (url) => ipcRenderer.invoke('claude-code-resolve-system-proxy', url),
    managed: {
      getStatus: () => ipcRenderer.invoke('claude-code-managed-status'),
      install: (options) => ipcRenderer.invoke('claude-code-managed-install', options || {}),
      cancel: () => ipcRenderer.invoke('claude-code-managed-cancel'),
      uninstall: () => ipcRenderer.invoke('claude-code-managed-uninstall'),
      onProgress: (callback) => {
        const subscription = (event, data) => callback(data);
        ipcRenderer.on('claude-code:install-progress', subscription);
        return () => ipcRenderer.removeListener('claude-code:install-progress', subscription);
      }
    },
    createSession: (params) => ipcRenderer.invoke('claude-code-create-session', params || {}),
    write: (payload) => ipcRenderer.invoke('claude-code-write', payload || {}),
    resize: (payload) => ipcRenderer.invoke('claude-code-resize', payload || {}),
    kill: (payload) => ipcRenderer.invoke('claude-code-kill', payload || {}),
    killAll: () => ipcRenderer.invoke('claude-code-kill-all'),
    onData: (callback) => {
      const subscription = (event, data) => callback(data);
      ipcRenderer.on('claude-code:data', subscription);
      return () => ipcRenderer.removeListener('claude-code:data', subscription);
    },
    onExit: (callback) => {
      const subscription = (event, data) => callback(data);
      ipcRenderer.on('claude-code:exit', subscription);
      return () => ipcRenderer.removeListener('claude-code:exit', subscription);
    }
  },
  toolhub: {
    getPaths: () => ipcRenderer.invoke('toolhub-get-paths')
  },
  marketplace: {
    getLocations: () => ipcRenderer.invoke('marketplace-get-locations'),
    listPlugins: () => ipcRenderer.invoke('marketplace-list-plugins'),
    setPluginEnabled: (pluginId, enabled) => ipcRenderer.invoke('marketplace-plugin-set-enabled', { pluginId, enabled }),
    uninstallPlugin: (pluginId) => ipcRenderer.invoke('marketplace-plugin-uninstall', pluginId),
    installPluginFromDir: (srcDir) => ipcRenderer.invoke('marketplace-plugin-install-from-dir', srcDir),
    installBundledPlugin: (bundleId) => ipcRenderer.invoke('marketplace-plugin-install-bundled', bundleId),
    listSkills: () => ipcRenderer.invoke('marketplace-list-skills'),
    promoteSkill: (dir) => ipcRenderer.invoke('marketplace-skill-promote', dir),
    deleteSkill: (dir) => ipcRenderer.invoke('marketplace-skill-delete', dir),
    importSkillFromDir: (srcDir) => ipcRenderer.invoke('marketplace-skill-import-from-dir', srcDir)
  },
  exportLogs: () => ipcRenderer.invoke('app-export-logs'),
  exportFile: (args) => ipcRenderer.invoke('export-file', args),
  printToPDF: (title) => ipcRenderer.invoke('print-to-pdf', { title }),
  exportToWord: (title, htmlContent) => ipcRenderer.invoke('export-to-word', { title, htmlContent }),
  exportToExcel: (title, csvContent) => ipcRenderer.invoke('export-to-excel', { title, csvContent }),
  proxyRequest: (url, options) => ipcRenderer.invoke('proxy-request', { url, options }),
  agentPolicy: {
    get: () => ipcRenderer.invoke('agent-policy-get'),
    set: (policy) => ipcRenderer.invoke('agent-policy-set', policy)
  },
  skillOrchestrator: {
    runAnalysis: () => ipcRenderer.invoke('skill-orchestrator:run-analysis')
  },
  agentApprovals: {
    list: (params) => ipcRenderer.invoke('agent-approvals-list', params || {}),
    decide: (payload) => ipcRenderer.invoke('agent-approvals-decide', payload || {})
  }
});
