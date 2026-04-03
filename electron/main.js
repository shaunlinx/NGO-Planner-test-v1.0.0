
const { app, BrowserWindow, BrowserView, Menu, shell, ipcMain, dialog, safeStorage, clipboard, session } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { GoogleGenAI } = require('@google/genai');

// --- Security: Path Sandbox Utility ---
function isSafePath(targetPath) {
    if (!targetPath) return false;
    const resolved = path.resolve(targetPath);
    
    // 1. Prevent Path Traversal
    if (resolved.includes('..')) return false;

    // 2. Block System Directories
    const systemDirs = [
        '/etc', '/bin', '/sbin', '/usr', '/var',
        'C:\\Windows', 'C:\\Program Files', 'C:\\Program Files (x86)', 'C:\\System32'
    ];
    
    // Allow if strictly within UserData, Temp, or Home (Documents/Downloads/Desktop)
    // Actually, blocking system dirs is safer for a generic "allow user files" app.
    if (systemDirs.some(sys => resolved.startsWith(sys))) {
        return false;
    }
    
    return true;
}
// --------------------------------------

const HTMLtoDOCX = require('html-to-docx');
const XLSX = require('xlsx');

// --- 1. 强制目录初始化 (First Run Logic) ---
const userDataPath = app.getPath('userData');
// const logPath = path.join(userDataPath, 'logs');
// Use temp directory for logs to avoid permission issues
const logPath = path.join(app.getPath('temp'), 'ngo-planner-logs');
const requiredDirs = [
    userDataPath,
    path.join(userDataPath, 'database'),
    path.join(userDataPath, 'storage'),
    path.join(userDataPath, 'storage', 'PLAN'),
    path.join(userDataPath, 'storage', 'REPORT'),
    path.join(userDataPath, 'storage', 'DATA'),
    path.join(userDataPath, 'storage', 'DATA', 'Knowledge'),
    path.join(userDataPath, 'storage', 'DATA', 'Knowledge', 'Prompts'),
    path.join(userDataPath, 'storage', 'DATA', 'Artifacts'),
    logPath
];

requiredDirs.forEach(dir => {
    try {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    } catch (e) {
        console.error(`Failed to create directory ${dir}:`, e);
    }
});

// 简单的日志记录函数
const logFile = path.join(logPath, `main-${new Date().toISOString().split('T')[0]}-${process.pid}.log`);
function writeLog(message) {
    const timestamp = new Date().toISOString();
    const entry = `[${timestamp}] ${message}\n`;
    try {
        fs.appendFileSync(logFile, entry);
    } catch (e) {
        console.warn(`Failed to write to log file: ${e.message}`);
    }
    console.log(message);
}

writeLog(`App startup initialized. UserData: ${userDataPath}`);

const dbManager = require('./databaseManager');
// Explicitly initialize database immediately to trigger schema migrations
dbManager.init();

const storageManager = require('./storageManager');
const ragEngine = require('./services/rag/ragEngine'); // Move require up
const privacyService = require('./services/privacyService');
const pluginManager = require('./services/pluginManager');
const openclawService = require('./services/openclawService');
const claudeCodeService = require('./services/claudeCodeService');
const claudeCodeInstaller = require('./services/claudeCodeInstaller');
const openclawInstaller = require('./services/openclawInstaller');
const marketplaceService = require('./services/marketplaceService');
const skillOrchestrator = require('./services/skillOrchestrator');
const workroomService = require('./services/workroomService');
const socialMediaManager = require('./services/social/socialmediamanager');
socialMediaManager.init();

const GOOGLE_API_KEY = process.env.API_KEY;
const ai = GOOGLE_API_KEY ? new GoogleGenAI({ apiKey: GOOGLE_API_KEY }) : null;

const CrawlerService = require('./services/crawlerService');
const ProjectIntelService = require('./services/projectIntel/projectIntelService');

let mainWindow;
let crawlerService;
let projectIntelService;
let openclawDashboardWindow;
let openclawDashboardWebContentsId;
let openclawDashboardAuthToken = '';
let openclawDashboardAuthPort = 0;
let openclawDashboardWebRequestInstalled = false;
const openclawDashboardAllowedWebContentsIds = new Set();
let openclawDashboardOpenInProgress = false;
let openclawEmbedView;
let openclawEmbedAttached = false;
let openclawEmbedDesiredVisible = false;
let openclawEmbedShowSeq = 0;

const ensureOpenclawDashboardWebRequest = (dashSession) => {
  if (openclawDashboardWebRequestInstalled) return;
  openclawDashboardWebRequestInstalled = true;
  try {
    dashSession.webRequest.onBeforeRequest(
      {
        urls: [
          'ws://127.0.0.1:*',
          'ws://127.0.0.1:*/*',
          'wss://127.0.0.1:*',
          'wss://127.0.0.1:*/*',
          'ws://localhost:*',
          'ws://localhost:*/*',
          'wss://localhost:*',
          'wss://localhost:*/*'
        ]
      },
      (details, cb) => {
        try {
          const token = String(openclawDashboardAuthToken || '').trim();
          const port = Number(openclawDashboardAuthPort || 0);
          if (!token || !port) return cb({});
          
          const u = new URL(details.url);
          // Only inject for localhost/127.0.0.1 and matching port
          const host = u.hostname;
          const isLocal = host === '127.0.0.1' || host === 'localhost';
          const isPortMatch = Number(u.port || 0) === port;
          
          if (!isLocal || !isPortMatch) return cb({});

          try {
            const keys = Array.from(u.searchParams.keys());
            for (const k of keys) {
              if (String(k).startsWith('auth-')) u.searchParams.delete(k);
            }
          } catch (e) {}
          u.searchParams.set('auth', token);
          const nextUrl = u.toString();
          if (nextUrl !== details.url) return cb({ redirectURL: nextUrl });
        } catch (e) {}
        cb({});
      }
    );
  } catch (e) {}

  try {
    dashSession.webRequest.onBeforeSendHeaders(
      {
        urls: [
          'http://127.0.0.1:*',
          'http://127.0.0.1:*/*',
          'https://127.0.0.1:*',
          'https://127.0.0.1:*/*',
          'http://localhost:*',
          'http://localhost:*/*',
          'https://localhost:*',
          'https://localhost:*/*'
        ]
      },
      (details, cb) => {
        try {
          const token = String(openclawDashboardAuthToken || '').trim();
          const port = Number(openclawDashboardAuthPort || 0);
          if (!token || !port) return cb({ requestHeaders: details.requestHeaders });

          const u = new URL(details.url);
          const host = u.hostname;
          const isLocal = host === '127.0.0.1' || host === 'localhost';
          const isPortMatch = Number(u.port || 0) === port;

          if (!isLocal || !isPortMatch) return cb({ requestHeaders: details.requestHeaders });

          const next = { ...(details.requestHeaders || {}) };
          if (!next.Authorization) next.Authorization = `Bearer ${token}`;
          
          // Inject Origin to bypass strict same-origin checks on WS upgrade if needed
          // Some gateways reject WS handshake if Origin doesn't match host
          // We set Origin to match the target to satisfy gateway
          next.Origin = `http://127.0.0.1:${port}`;
          
          return cb({ requestHeaders: next });
        } catch (e) {}
        cb({ requestHeaders: details.requestHeaders });
      }
    );
  } catch (e) {}
};

const ensureOpenclawEmbedView = () => {
  try {
    if (!mainWindow || mainWindow.isDestroyed()) return null;
    if (openclawEmbedView && !openclawEmbedView.webContents.isDestroyed()) return openclawEmbedView;
  } catch (e) {}

  const dashSession = session.fromPartition('persist:openclaw-dashboard');
  ensureOpenclawDashboardWebRequest(dashSession);
  openclawEmbedView = new BrowserView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false, // Allowed for OpenClaw Dashboard // Allowed for OpenClaw Dashboard
      sandbox: false,
      webSecurity: true,
      preload: path.join(__dirname, 'preloadOpenclawDashboard.js'),
      session: dashSession
    }
  });
  try {
    openclawDashboardAllowedWebContentsIds.add(openclawEmbedView.webContents.id);
    openclawEmbedView.webContents.on('destroyed', () => {
      try {
        openclawDashboardAllowedWebContentsIds.delete(openclawEmbedView.webContents.id);
      } catch (e) {}
    });
  } catch (e) {}
  try {
    openclawEmbedView.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
  } catch (e) {}
  try {
    openclawEmbedView.webContents.on('will-navigate', (event, nextUrl) => {
      try {
        const u = new URL(String(nextUrl || ''));
        const host = String(u.host || '').toLowerCase();
        const isLocal = host.startsWith('127.0.0.1') || host.startsWith('localhost');
        const okProto = u.protocol === 'http:' || u.protocol === 'https:';
        if (!okProto || !isLocal) {
          event.preventDefault();
          shell.openExternal(nextUrl);
        }
      } catch (e) {}
    });
  } catch (e) {}
  return openclawEmbedView;
};

function createWindow() {
  const isDev = !app.isPackaged;
  const iconPath = isDev 
      ? path.join(__dirname, '../public/logo.png') 
      : path.join(__dirname, '../dist/logo.png');

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    title: "公益人年历",
    icon: iconPath,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false // Disable webSecurity to allow local file:// access for media preview
    }
  });

  if (process.platform === 'darwin') {
      app.setAboutPanelOptions({
          applicationName: '公益人年历',
          applicationVersion: app.getVersion(),
          copyright: 'Copyright © 2025 NGO Planner',
          credits: 'Designed for Non-Profit Efficiency',
          iconPath: iconPath
      });
  }

  crawlerService = new CrawlerService(mainWindow, dbManager);
  projectIntelService = new ProjectIntelService(mainWindow, dbManager, storageManager, ragEngine);
  openclawService.setContext({ mainWindow, projectIntelService });
  openclawService.init();
  skillOrchestrator.init();
  claudeCodeService.setContext({ mainWindow });

  if (isDev) {
    // Try to connect to Vite dev server from env or default to 5173
    const devPort = process.env.VITE_DEV_SERVER_PORT || 5173;
    const url = `http://localhost:${devPort}`;
    console.log(`[Main] Loading URL: ${url}`);
    mainWindow.loadURL(url).catch(e => {
        console.error(`[Main] Failed to load URL: ${url}`, e);
        // Fallback or retry logic could go here
    });
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Initialize Ingestion Queue with WebContents for events
  if (!ingestionQueue) {
      // Collect Embedding Config
      // Note: We need to resolve secure settings here synchronously or assume default?
      // Since ragEngine handles secure decryption, we should probably fetch them.
      // But ingestionQueue runs in main process, so we can access dbManager.
      // Let's pass a getter or basic config.
      // Better yet: ragEngine already loads config in init().
      // Let's expose a way to get the config from ragEngine or dbManager.
      
      // For the Worker, we need the raw keys (decrypted).
      // We can fetch them here.
      (async () => {
          // Quick decrypt helper
          const { safeStorage } = require('electron');
          const decrypt = async (key) => {
              const val = await dbManager.getSetting(key);
              if (val && typeof val === 'string' && val.startsWith('ENC:')) {
                  if (safeStorage.isEncryptionAvailable()) {
                      try { return safeStorage.decryptString(Buffer.from(val.substring(4), 'hex')); } 
                      catch (e) { return null; }
                  }
                  return null;
              }
              return val;
          };

          const embeddingConfig = {
              provider: await dbManager.getSetting('rag_provider') || 'openai',
              apiKey: await dbManager.getSetting('rag_api_key'),
              secretKey: await dbManager.getSetting('rag_secret_key'),
              baseUrl: await dbManager.getSetting('rag_base_url'),
              model: await dbManager.getSetting('rag_model'),
              hfToken: await dbManager.getSetting('rag_hf_token'),
              jinaKey: await dbManager.getSetting('rag_jina_key'),
              deepseekKey: await decrypt('user_api_key_deepseek'),
              deepseekStatus: await dbManager.getSetting('user_api_status_deepseek'),
              googleKey: await decrypt('user_api_key_google'),
              googleStatus: await dbManager.getSetting('user_api_status_google'),
          };

          // Determine correct resources path for Worker
          let resourcesPath;
          if (app.isPackaged) {
              resourcesPath = process.resourcesPath;
          } else {
              // In dev, models are in project_root/resources
              resourcesPath = path.join(__dirname, '../resources');
          }

          ingestionQueue = new IngestionQueue(ragEngine, mainWindow.webContents, {
              resourcesPath: resourcesPath, 
              embeddingConfig
          });
          ragEngine.setIngestionQueue(ingestionQueue);
          
          // Initialize Project Watcher
          projectWatcher = new ProjectWatcher(ingestionQueue);
          projectWatcher.init();
      })();
  } else {
      // If window re-created, update webContents reference
      ingestionQueue.webContents = mainWindow.webContents;
  }
}

const openOpenClawDashboardWindow = async () => {
  if (openclawDashboardOpenInProgress) {
    try {
      if (openclawDashboardWindow && !openclawDashboardWindow.isDestroyed()) {
        openclawDashboardWindow.show();
        openclawDashboardWindow.focus();
        return { success: true, reused: true };
      }
    } catch (e) {}
    return { success: false, error: 'open_in_progress' };
  }
  openclawDashboardOpenInProgress = true;
  let ensureErr = '';
  try {
    await openclawService.ensureRunning();
  } catch (e) {
    ensureErr = String(e?.message || 'ensure_running_failed');
  }

  try {
    const st = await openclawService.getStatus();
    const port = st?.gateway?.port || 0;
    const running = !!st?.gateway?.running;
    if (!running || !port) {
      return {
        success: false,
        error: 'openclaw_gateway_not_running',
        detail: String(st?.lastError || ensureErr || 'gateway_not_running'),
        status: st || null
      };
    }

    const url = `http://127.0.0.1:${port}/`;
    let gatewayToken = '';
    try {
      gatewayToken = await openclawService.getGatewayToken();
    } catch (e) {
      gatewayToken = '';
    }
    const urlWithAuth = (() => {
      try {
        const t = String(gatewayToken || '').trim();
        if (!t) return url;
        const u = new URL(url);
        u.searchParams.set('auth', t);
        return u.toString();
      } catch (e) {
        return url;
      }
    })();

    const injectConnect = async (webContents) => {
      try {
        const token = String(gatewayToken || '').trim();
        if (!token) return;
        const js = `
        (function(){
          try{
            var token=${JSON.stringify(String(gatewayToken || ''))};
            var port=${JSON.stringify(Number(port || 0))};
            if(!token||!port) return;
            try{
              localStorage.setItem('openclaw_control_ui_settings', JSON.stringify({ token: token, auth: token, wsUrl: 'ws://127.0.0.1:'+port }));
              localStorage.setItem('openclaw_gateway_token', token);
              localStorage.setItem('openclaw_control_ui_token', token);
              localStorage.setItem('openclaw_control_ui_auth', token);
            }catch(e){}
            function setValue(el, v){
              try{
                var proto = Object.getPrototypeOf(el);
                var desc = Object.getOwnPropertyDescriptor(proto, 'value');
                if(desc && desc.set) desc.set.call(el, v);
                else el.value = v;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              }catch(e){}
            }
            function findInputByLabel(labelText){
              var labels = Array.from(document.querySelectorAll('label,div,span'));
              for(var i=0;i<labels.length;i++){
                var t = (labels[i].textContent||'').trim();
                if(!t) continue;
                if(t.toLowerCase()===labelText.toLowerCase()){
                  var root = labels[i].closest('div') || labels[i].parentElement;
                  if(root){
                    var inp = root.querySelector('input');
                    if(inp) return inp;
                  }
                }
              }
              return null;
            }
            var wsInput = findInputByLabel('WebSocket URL');
            if(!wsInput){
              var ins = Array.from(document.querySelectorAll('input'));
              wsInput = ins.find(function(x){ return ((x.placeholder||'')+' '+(x.name||'')).toLowerCase().includes('ws'); }) || null;
            }
            if(wsInput) setValue(wsInput, 'ws://127.0.0.1:'+port);
            var tokenInput = findInputByLabel('Gateway Token');
            if(!tokenInput){
              var ins2 = Array.from(document.querySelectorAll('input'));
              tokenInput = ins2.find(function(x){ return ((x.placeholder||'')+' '+(x.name||'')).toLowerCase().includes('token'); }) || null;
            }
            if(tokenInput) setValue(tokenInput, token);
            var btn = Array.from(document.querySelectorAll('button')).find(function(b){
              var t = (b.textContent||'').trim().toLowerCase();
              return t === 'connect' || t.includes('connect');
            });
            if(btn) btn.click();
          }catch(e){}
        })();
      `;
        await webContents.executeJavaScript(js, true);
      } catch (e) {}
    };

    const dashSession = session.fromPartition('persist:openclaw-dashboard');
    openclawDashboardAuthToken = String(gatewayToken || '');
    openclawDashboardAuthPort = Number(port || 0);
    ensureOpenclawDashboardWebRequest(dashSession);
    try {
      await dashSession.setProxy({ proxyRules: 'direct://' });
    } catch (e) {}
    try {
      if (openclawDashboardWindow && !openclawDashboardWindow.isDestroyed()) {
        openclawDashboardWebContentsId = openclawDashboardWindow.webContents?.id;
        try {
          openclawDashboardWindow.webContents.removeAllListeners('did-finish-load');
        } catch (e) {}
        openclawDashboardWindow.webContents.once('did-finish-load', () => {
          injectConnect(openclawDashboardWindow.webContents);
        });
        await openclawDashboardWindow.loadURL(urlWithAuth);
        openclawDashboardWindow.show();
        openclawDashboardWindow.focus();
        return { success: true, url: urlWithAuth };
      }
    } catch (e) {
      try {
        openclawDashboardWindow.destroy();
      } catch (err) {}
      openclawDashboardWindow = null;
    }

    openclawDashboardWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    title: 'OpenClaw Dashboard',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: false, // Allowed for OpenClaw Dashboard
      sandbox: false,
      webSecurity: true,
      preload: path.join(__dirname, 'preloadOpenclawDashboard.js'),
      session: dashSession
    }
    });
    openclawDashboardWebContentsId = openclawDashboardWindow.webContents?.id;
    try {
      if (openclawDashboardWebContentsId) openclawDashboardAllowedWebContentsIds.add(openclawDashboardWebContentsId);
    } catch (e) {}
    openclawDashboardWindow.on('closed', () => {
      try {
        if (openclawDashboardWebContentsId) openclawDashboardAllowedWebContentsIds.delete(openclawDashboardWebContentsId);
      } catch (e) {}
      openclawDashboardWindow = null;
      openclawDashboardWebContentsId = null;
    });
    openclawDashboardWindow.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url);
      return { action: 'deny' };
    });
    openclawDashboardWindow.webContents.on('will-navigate', (event, nextUrl) => {
      try {
        const u = new URL(String(nextUrl || ''));
        const host = String(u.host || '').toLowerCase();
        const okHost = host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === '127.0.0.1' || host === 'localhost';
        const okProto = u.protocol === 'http:' || u.protocol === 'https:';
        if (!okProto || !okHost) {
          event.preventDefault();
          shell.openExternal(nextUrl);
        }
      } catch (e) {}
    });
    try {
      openclawDashboardWindow.webContents.removeAllListeners('did-finish-load');
    } catch (e) {}
    openclawDashboardWindow.webContents.once('did-finish-load', () => {
      injectConnect(openclawDashboardWindow.webContents);
    });
    await openclawDashboardWindow.loadURL(urlWithAuth);
    openclawDashboardWindow.show();
    return { success: true, url: urlWithAuth };
  } catch (e) {
    return { success: false, error: 'open_dashboard_failed', detail: String(e?.message || 'unknown_error') };
  } finally {
    openclawDashboardOpenInProgress = false;
  }
};

// --- IPC 通道处理 ---

// --- Cache Cleanup IPC ---
ipcMain.handle('app-clear-cache', async (event, options = {}) => {
    try {
        const { session } = require('electron');
        const win = BrowserWindow.fromWebContents(event.sender);
        const ses = win ? win.webContents.session : session.defaultSession;
        
        const results = {
            cache: false,
            storage: false,
            temp: false
        };

        // 1. Clear HTTP Cache & GPU Cache (Renderer)
        if (options.cache) {
            await ses.clearCache();
            results.cache = true;
            
            // Aggressive Cleanup: Try to clear GPUCache and Code Cache folders if possible
            // Note: These might be locked, so we use try-catch and non-blocking attempts
            try {
                const userData = app.getPath('userData');
                const cacheDirs = ['GPUCache', 'Code Cache', 'Crashpad', 'DawnCache', 'ShaderCache'];
                
                cacheDirs.forEach(dir => {
                    const target = path.join(userData, dir);
                    if (fs.existsSync(target)) {
                        try {
                            // Try to remove content, not the dir itself to avoid permission issues if locked
                            fs.readdirSync(target).forEach(file => {
                                try { fs.rmSync(path.join(target, file), { recursive: true, force: true }); } catch(e) {}
                            });
                        } catch (e) { console.warn(`Skipped cleanup for ${dir}: locked`); }
                    }
                });
            } catch (e) {
                console.warn("Aggressive cache cleanup partial failure:", e);
            }
        }

        // 2. Clear Storage Data (LocalStorage, Cookies, IndexedDB, etc.)
        if (options.storage) {
            await ses.clearStorageData({
                storages: ['localstorage', 'cookies', 'indexdb', 'cachestorage', 'serviceworkers', 'websql'] 
            });
            results.storage = true;
        }

        // 3. Clear Temp Files & Logs
        if (options.temp) {
            const tempPath = app.getPath('temp');
            const userData = app.getPath('userData');
            
            // 3.1 App Specific Temp Logs
            const appTempDir = path.join(tempPath, 'ngo-planner-logs'); 
            if (fs.existsSync(appTempDir)) {
                fs.rmSync(appTempDir, { recursive: true, force: true });
            }
            
            // 3.2 Main Logs in UserData (if any)
            const mainLogPath = path.join(userData, 'logs');
            if (fs.existsSync(mainLogPath)) {
                 fs.rmSync(mainLogPath, { recursive: true, force: true });
            }
            
            results.temp = true;
        }

        writeLog(`Cache cleared: ${JSON.stringify(results)}`);
        return { success: true, results };
    } catch (e) {
        console.error("Clear Cache Error:", e);
        return { success: false, error: e.message };
    }
});

// Get Cache Size (Estimate)
ipcMain.handle('app-get-cache-size', async (event) => {
    try {
        const { session } = require('electron');
        const win = BrowserWindow.fromWebContents(event.sender);
        const ses = win ? win.webContents.session : session.defaultSession;
        
        const cacheSize = await ses.getCacheSize();
        return { success: true, size: cacheSize };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('app-export-logs', async () => {
    try {
        const { filePath } = await dialog.showSaveDialog(mainWindow, {
            title: '导出运行日志',
            defaultPath: path.join(app.getPath('desktop'), `ngo-planner-logs-${Date.now()}.zip`),
            filters: [{ name: 'Zip Files', extensions: ['zip'] }]
        });

        if (!filePath) return { success: false };

        const logEntries = fs.readdirSync(logPath)
            .filter(f => f.endsWith('.log'))
            .map(f => ({
                name: f,
                content: fs.readFileSync(path.join(logPath, f), 'utf8')
            }));

        return { success: true, logs: logEntries, savePath: filePath };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('dialog-open-file', async (event, { filters }) => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: filters || [{ name: 'Documents', extensions: ['pdf', 'docx', 'txt', 'md'] }]
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    const filePath = result.filePaths[0];
    const fileName = path.basename(filePath);
    const data = fs.readFileSync(filePath).toString('base64');
    return { name: fileName, data, path: filePath };
});

// 新增：选择文件夹
ipcMain.handle('dialog-open-directory', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory']
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
});

ipcMain.handle('shell-open-path', async (event, fullPath) => {
    return shell.openPath(fullPath);
});

ipcMain.handle('shell-open-external', async (event, url) => {
    return shell.openExternal(url);
});

ipcMain.handle('shell-show-item', async (event, fullPath) => {
    shell.showItemInFolder(fullPath);
    return true;
});

ipcMain.handle('fs-ensure-dir', async (event, dirPath) => {
    try {
        if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
        return true;
    } catch (e) { return false; }
});

ipcMain.handle('fs-write-file', async (event, filePath, content, options) => {
    try {
        const encoding = options?.encoding || 'utf8';
        fs.writeFileSync(filePath, content, encoding);
        writeLog(`File written: ${filePath}`);
        return { success: true };
    } catch (e) { 
        writeLog(`Error writing file ${filePath}: ${e.message}`);
        return { success: false, error: e.message }; 
    }
});

ipcMain.handle('fs-read-file', async (event, filePath) => {
    try {
        const data = fs.readFileSync(filePath, 'utf8');
        return { success: true, data };
    } catch (e) { return { success: false, error: e.message }; }
});

const fileProcessor = require('./services/rag/fileProcessor');

ipcMain.handle('fs-read-file-preview', async (event, filePath) => {
    try {
        let targetPath = filePath;
        
        // Resolve link if needed
        try {
            const lstats = fs.lstatSync(filePath);
            if (lstats.isSymbolicLink()) {
                targetPath = fs.realpathSync(filePath);
            } else if (process.platform === 'win32' && filePath.toLowerCase().endsWith('.lnk')) {
                const { execSync } = require('child_process');
                const command = `powershell.exe -noprofile -command "$sh=New-Object -ComObject WScript.Shell;$lnk=$sh.CreateShortcut('${filePath}');$lnk.TargetPath"`;
                const resolved = execSync(command, { encoding: 'utf8' }).trim();
                if (resolved) targetPath = resolved;
            }
        } catch (e) {
            // Ignore resolution errors, try reading as is
        }

        const ext = path.extname(targetPath).toLowerCase();
        
        // Images: Return Base64 for visual preview
        if (['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext)) {
            const data = fs.readFileSync(targetPath).toString('base64');
            return { success: true, type: 'image', data: `data:image/${ext.slice(1)};base64,${data}` };
        }
        
        // Documents: Use FileProcessor to extract preview content (HTML for docx, Text for others)
        if (['.pdf', '.docx', '.pptx', '.xlsx', '.xls', '.csv'].includes(ext)) {
            try {
                // Use new getPreviewContent for better fidelity (e.g. Docx -> HTML)
                const result = await fileProcessor.getPreviewContent(targetPath);
                if (result.type === 'error') throw new Error(result.error);
                return { success: true, type: result.type, data: result.data };
            } catch (err) {
                return { success: false, error: `解析失败: ${err.message}` };
            }
        }

        // Media Files: Return path for frontend to render <video>/<audio>
        // Do NOT read content to avoid OOM
        if (['.mp3', '.wav', '.m4a', '.mp4', '.mpeg', '.mpga', '.webm', '.mov'].includes(ext)) {
            // For Electron renderer to access local file, we return the absolute path.
            // Frontend might need to prefix with 'file://' or use specific protocol.
            return { success: true, type: 'media', data: targetPath, ext: ext };
        }

        // Text Files: Read directly
        const data = fs.readFileSync(targetPath, 'utf8');
        return { success: true, type: 'text', data };
        
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('fs-exists', async (event, filePath) => {
    return fs.existsSync(filePath);
});

ipcMain.handle('fs-delete-directory', async (event, dirPath) => {
    if (!isSafePath(dirPath)) {
        return { success: false, error: "Security: Access to this path is denied." };
    }
    try {
        if (fs.existsSync(dirPath)) {
            fs.rmSync(dirPath, { recursive: true, force: true });
            writeLog(`Directory deleted: ${dirPath}`);
            return { success: true };
        }
        return { success: true }; // Already gone
    } catch (e) {
        writeLog(`Error deleting directory ${dirPath}: ${e.message}`);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('fs-delete-file', async (event, filePath) => {
    if (!isSafePath(filePath)) {
        return { success: false, error: "Security: Access to this path is denied." };
    }
    try {
        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            fs.rmSync(filePath, { force: true });
        }
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

const missingDirWarned = new Set();

ipcMain.handle('fs-read-dir', async (event, dirPath) => {
    if (!isSafePath(dirPath)) {
        console.warn(`[Security] Blocked access to ${dirPath}`);
        return [];
    }
    try {
        let targetDir = dirPath;
        
        // --- Windows .lnk Transparent Traversal ---
        if (process.platform === 'win32' && dirPath.toLowerCase().endsWith('.lnk')) {
             try {
                const { execSync } = require('child_process');
                const command = `powershell.exe -noprofile -command "$sh=New-Object -ComObject WScript.Shell;$lnk=$sh.CreateShortcut('${dirPath}');$lnk.TargetPath"`;
                const resolved = execSync(command, { encoding: 'utf8' }).trim();
                if (resolved && fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
                    targetDir = resolved; // Read the REAL dir
                }
             } catch (e) {
                 console.warn(`Failed to resolve .lnk dir: ${dirPath}`);
             }
        }
        
        // console.log(`[Main] Reading directory: ${targetDir}`);
        if (!fs.existsSync(targetDir)) {
            if (!missingDirWarned.has(targetDir)) {
                missingDirWarned.add(targetDir);
                console.warn(`[Main] Directory not found: ${targetDir}`);
            }
            return [];
        }
        const entries = fs.readdirSync(targetDir, { withFileTypes: true });
        // console.log(`[Main] Found ${entries.length} entries in ${dirPath}`);
        return entries.map(entry => {
            const fullPath = path.join(dirPath, entry.name);
            let isDirectory = entry.isDirectory();
            let isSymlink = entry.isSymbolicLink();
            let realPath = fullPath;
            let size = 0;
            let mtime = new Date();

            try {
                // If symlink, follow it to get real stats
                if (isSymlink) {
                    const realStats = fs.statSync(fullPath);
                    isDirectory = realStats.isDirectory();
                    size = realStats.size;
                    mtime = realStats.mtime;
                    realPath = fs.realpathSync(fullPath);
                } else {
                    const stats = fs.statSync(fullPath);
                    size = stats.size;
                    mtime = stats.mtime;
                }
                
                // --- Windows .lnk Handling (Advanced) ---
                if (process.platform === 'win32' && fullPath.toLowerCase().endsWith('.lnk')) {
                    try {
                        // Attempt to resolve target to see if it's a directory
                        const { execSync } = require('child_process');
                        const command = `powershell.exe -noprofile -command "$sh=New-Object -ComObject WScript.Shell;$lnk=$sh.CreateShortcut('${fullPath}');$lnk.TargetPath"`;
                        const targetPath = execSync(command, { encoding: 'utf8' }).trim();
                        
                        if (targetPath) {
                            realPath = targetPath;
                            // Check if target is directory
                            try {
                                const targetStats = fs.statSync(targetPath);
                                if (targetStats.isDirectory()) {
                                    isDirectory = true; // Pretend to be a directory!
                                    isSymlink = true; // Treat as symlink for UI logic
                                }
                            } catch (e) { /* Target invalid */ }
                        }
                    } catch (e) { /* Ignore parsing error */ }
                }

                return {
                    name: entry.name,
                    path: fullPath,
                    realPath: realPath, 
                    isDirectory: isDirectory,
                    isSymlink: isSymlink,
                    size: size,
                    mtime: mtime
                };
            } catch (statErr) {
                console.warn(`[Main] Error stat-ing file ${fullPath}:`, statErr);
                // If broken link, return as file but mark broken?
                return {
                    name: entry.name,
                    path: fullPath,
                    isDirectory: false,
                    isSymlink: isSymlink,
                    isBroken: true
                };
            }
        });
    } catch (e) {
        console.error(`Error reading directory ${dirPath}:`, e);
        return [];
    }
});

ipcMain.handle('kb-search-mounted-files', async (event, { query, roots, limit, fileTypeFilter }) => {
    try {
        const q = String(query || '').trim().toLowerCase();
        if (!q) return { success: true, results: [] };

        const maxResults = Math.max(1, Math.min(Number(limit) || 60, 200));
        const results = [];

        const matchesType = (filePath) => {
            const name = String(filePath).split(/[\\/]/).pop() || '';
            const ext = (name.includes('.') ? name.split('.').pop() : '')?.toLowerCase() || '';
            const ft = fileTypeFilter || 'all';
            if (ft === 'all') return true;
            if (ft === 'pdf') return ext === 'pdf';
            if (ft === 'doc') return ext === 'doc' || ext === 'docx';
            if (ft === 'ppt') return ext === 'ppt' || ext === 'pptx';
            if (ft === 'xls') return ext === 'xls' || ext === 'xlsx' || ext === 'csv';
            if (ft === 'md') return ext === 'md' || ext === 'markdown' || ext === 'txt';
            if (ft === 'image') return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff'].includes(ext);
            return true;
        };

        const stack = Array.isArray(roots) ? roots.filter((r) => typeof r === 'string') : [];
        const visited = new Set();
        let scanned = 0;
        const MAX_SCANNED = 50000;

        while (stack.length > 0 && results.length < maxResults && scanned < MAX_SCANNED) {
            const root = stack.pop();
            if (!root || typeof root !== 'string') continue;
            if (!isSafePath(root)) continue;
            if (!fs.existsSync(root)) continue;

            let st;
            try { st = fs.lstatSync(root); } catch (e) { continue; }

            if (st.isSymbolicLink()) {
                let rp = null;
                try { rp = fs.realpathSync(root); } catch (e) {}
                const key = rp || root;
                if (visited.has(key)) continue;
                visited.add(key);
            } else if (st.isDirectory()) {
                let rp = null;
                try { rp = fs.realpathSync(root); } catch (e) {}
                const key = rp || root;
                if (visited.has(key)) continue;
                visited.add(key);
            }

            if (st.isDirectory()) {
                let entries = [];
                try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch (e) { continue; }

                for (const entry of entries) {
                    if (results.length >= maxResults || scanned >= MAX_SCANNED) break;
                    scanned++;
                    if (!entry || !entry.name) continue;
                    if (entry.name.startsWith('.')) continue;
                    const fullPath = path.join(root, entry.name);

                    if (entry.isDirectory()) {
                        stack.push(fullPath);
                        if (entry.name.toLowerCase().includes(q) || fullPath.toLowerCase().includes(q)) {
                            results.push({ name: entry.name, path: fullPath, isDirectory: true });
                        }
                    } else {
                        if (!matchesType(fullPath)) continue;
                        if (entry.name.toLowerCase().includes(q) || fullPath.toLowerCase().includes(q)) {
                            results.push({ name: entry.name, path: fullPath, isDirectory: false });
                        }
                    }
                }
            } else {
                const name = path.basename(root);
                if (matchesType(root) && (name.toLowerCase().includes(q) || root.toLowerCase().includes(q))) {
                    results.push({ name, path: root, isDirectory: false });
                }
            }
        }

        return { success: true, results };
    } catch (e) {
        return { success: false, error: e.message, results: [] };
    }
});

// New IPC: Resolve Link (Symlink or Shortcut)
ipcMain.handle('fs-resolve-link', async (event, linkPath) => {
    try {
        const stats = fs.lstatSync(linkPath);
        if (stats.isSymbolicLink()) {
            return { success: true, path: fs.realpathSync(linkPath) };
        }
        
        // Windows .lnk Parsing via PowerShell
        if (process.platform === 'win32' && linkPath.toLowerCase().endsWith('.lnk')) {
            const { execSync } = require('child_process');
            const command = `powershell.exe -noprofile -command "$sh=New-Object -ComObject WScript.Shell;$lnk=$sh.CreateShortcut('${linkPath}');$lnk.TargetPath"`;
            const targetPath = execSync(command, { encoding: 'utf8' }).trim();
            if (targetPath) return { success: true, path: targetPath };
        }
        
        return { success: false, error: "Not a link or cannot resolve" };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// New IPC: Create Shortcut (Windows .lnk)
ipcMain.handle('fs-create-shortcut', async (event, targetPath, shortcutPath) => {
    if (process.platform !== 'win32') return { success: false, error: "Only supported on Windows" };
    
    try {
        const { execSync } = require('child_process');
        // PowerShell script to create shortcut
        const command = `powershell.exe -noprofile -command "$sh=New-Object -ComObject WScript.Shell;$s=$sh.CreateShortcut('${shortcutPath}');$s.TargetPath='${targetPath}';$s.Save()"`;
        execSync(command);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// New IPC for copying directory contents (files only)
ipcMain.handle('fs-copy-files', async (event, sourceDir, destDir) => {
    console.log(`[IPC] fs-copy-files called: ${sourceDir} -> ${destDir}`);
    try {
        if (!fs.existsSync(sourceDir)) {
             console.warn(`[IPC] Source dir does not exist: ${sourceDir}`);
             return { success: false, error: "Source not found" };
        }
        
        // Recursive copy function
        const copyRecursive = (src, dest) => {
            if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
            
            const entries = fs.readdirSync(src, { withFileTypes: true });
            let count = 0;
            
            for (const entry of entries) {
                const srcPath = path.join(src, entry.name);
                const destPath = path.join(dest, entry.name);
                
                if (entry.isDirectory()) {
                    count += copyRecursive(srcPath, destPath);
                } else {
                    fs.copyFileSync(srcPath, destPath);
                    count++;
                }
            }
            return count;
        };

        const totalCopied = copyRecursive(sourceDir, destDir);
        console.log(`[IPC] Recursively copied ${totalCopied} files.`);
        return { success: true, count: totalCopied };
    } catch (e) {
        console.error("Copy Files Error:", e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('kb-export-local-mounts', async (event, { mode, destDir, folderName, paths }) => {
    try {
        if (!destDir || typeof destDir !== 'string') return { success: false, error: 'Invalid destination' };
        if (!Array.isArray(paths) || paths.length === 0) return { success: false, error: 'No paths to export' };

        const safeName = String(folderName || '本地挂载_导出')
            .replace(/[\\/:*?"<>|]/g, '_')
            .trim() || '本地挂载_导出';

        const exportRoot = path.join(destDir, safeName);
        if (!fs.existsSync(exportRoot)) fs.mkdirSync(exportRoot, { recursive: true });

        const used = new Map();
        const nextName = (base) => {
            const key = base || 'item';
            const n = (used.get(key) || 0) + 1;
            used.set(key, n);
            if (n === 1) return key;
            return `${key}-${n}`;
        };

        const copyRecursive = (src, dest) => {
            const st = fs.statSync(src);
            if (st.isDirectory()) {
                if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
                const entries = fs.readdirSync(src, { withFileTypes: true });
                for (const entry of entries) {
                    const s = path.join(src, entry.name);
                    const d = path.join(dest, entry.name);
                    if (entry.isDirectory()) copyRecursive(s, d);
                    else fs.copyFileSync(s, d);
                }
            } else {
                fs.mkdirSync(path.dirname(dest), { recursive: true });
                fs.copyFileSync(src, dest);
            }
        };

        const createShortcut = (targetPath, shortcutPath) => {
            if (process.platform !== 'win32') throw new Error('Only supported on Windows');
            const { execSync } = require('child_process');
            const command = `powershell.exe -noprofile -command "$sh=New-Object -ComObject WScript.Shell;$s=$sh.CreateShortcut('${shortcutPath}');$s.TargetPath='${targetPath}';$s.Save()"`;
            execSync(command);
        };

        const results = [];
        for (const p of paths) {
            if (!p || typeof p !== 'string') continue;
            if (!fs.existsSync(p)) {
                results.push({ path: p, success: false, error: 'Source not found' });
                continue;
            }

            const base = nextName(path.basename(p));
            const destPath = path.join(exportRoot, base);

            try {
                if (mode === 'shortcut') {
                    if (process.platform === 'win32') {
                        try {
                            const type = fs.statSync(p).isDirectory() ? 'junction' : 'file';
                            fs.symlinkSync(p, destPath, type);
                            results.push({ path: p, success: true, output: destPath });
                        } catch (e) {
                            const lnkPath = destPath.endsWith('.lnk') ? destPath : `${destPath}.lnk`;
                            createShortcut(p, lnkPath);
                            results.push({ path: p, success: true, output: lnkPath });
                        }
                    } else {
                        const type = fs.statSync(p).isDirectory() ? 'dir' : 'file';
                        fs.symlinkSync(p, destPath, type);
                        results.push({ path: p, success: true, output: destPath });
                    }
                } else if (mode === 'copy') {
                    copyRecursive(p, destPath);
                    results.push({ path: p, success: true, output: destPath });
                } else if (mode === 'move') {
                    fs.renameSync(p, destPath);
                    results.push({ path: p, success: true, output: destPath });
                } else {
                    results.push({ path: p, success: false, error: 'Invalid mode' });
                }
            } catch (e) {
                results.push({ path: p, success: false, error: e.message });
            }
        }

        const ok = results.filter(r => r.success).length;
        const fail = results.length - ok;
        return { success: true, exportRoot, results, ok, fail };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// --- New FS Operations for AI Migration Assistant ---

ipcMain.handle('fs-symlink', async (event, target, path) => {
    try {
        // Symlink: 'target' is the existing file, 'path' is the new link location
        // On Windows, 'junction' is often used for dirs, 'file' for files. 
        // Auto-detect type?
        const type = fs.statSync(target).isDirectory() ? 'junction' : 'file';
        fs.symlinkSync(target, path, type);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('fs-rename', async (event, oldPath, newPath) => {
    try {
        fs.renameSync(oldPath, newPath);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('fs-copy-file', async (event, src, dest) => {
    try {
        fs.copyFileSync(src, dest);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('kb-ai-structure-proposal', async (event, { files, instruction }) => {
    try {
        // Ensure RAG Engine is initialized (configures Embedding Service)
        if (!ragEngine.isReady) {
            await ragEngine.init();
        }

        const embeddingServiceModule = require('./services/rag/embedding');
        const prompt = `
        你是一个文件整理专家。请根据以下文件列表，设计一个合理的文件夹分类结构。
        
        用户指令: ${instruction || "按文件类型或项目主题分类"}
        
        文件列表:
        ${JSON.stringify(files.slice(0, 200))} 
        (共 ${files.length} 个文件，以上是部分示例)

        请返回一个 JSON 对象，键是文件夹名称，值是文件名列表（或子文件夹对象）。
        文件名必须严格匹配原列表中的名称。
        根目录下可以是多个文件夹。
        
        示例格式:
        {
            "财务文档": ["2023报表.xlsx", "发票.pdf"],
            "项目资料": {
                "图片": ["site.jpg"],
                "方案": ["plan.docx"]
            }
        }
        
        只返回 JSON。
        `;
        
        const response = await embeddingServiceModule.completion(prompt);
        // Clean markdown code blocks if any
        let jsonStr = '';
        if (typeof response === 'string') {
             jsonStr = response.replace(/```json/g, '').replace(/```/g, '').trim();
        } else if (response && typeof response.text === 'function') {
             jsonStr = response.text().replace(/```json/g, '').replace(/```/g, '').trim();
        } else {
             // Try best effort stringify or direct access
             jsonStr = String(response).replace(/```json/g, '').replace(/```/g, '').trim();
        }
        
        return { success: true, structure: JSON.parse(jsonStr) };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('db-get-projects', async () => dbManager.getAllProjects());
ipcMain.handle('db-save-project', async (event, project) => {
    const res = await dbManager.saveProject(project);
    if (res.success && projectWatcher) {
        // Trigger watcher update to handle status change (Active <-> Archived) or new path
        projectWatcher.refresh();
    }
    return res;
});
ipcMain.handle('db-delete-project', async (event, id) => {
    const res = await dbManager.deleteProject(id);
    if (res.success && projectWatcher) projectWatcher.refresh();
    return res;
});
ipcMain.handle('db-get-setting', async (event, key) => dbManager.getSetting(key));
ipcMain.handle('db-save-setting', async (event, { key, value }) => dbManager.saveSetting(key, value));

ipcMain.handle('llm-openai-test', async (event, params) => {
    try {
        const baseUrl = params && typeof params.baseUrl === 'string' ? params.baseUrl.trim() : '';
        const apiKey = params && typeof params.apiKey === 'string' ? params.apiKey : '';
        if (!baseUrl) return { success: false, error: 'Base URL 不能为空' };

        let parsed;
        try {
            parsed = new URL(baseUrl);
        } catch (e) {
            return { success: false, error: 'Base URL 不是合法 URL' };
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { success: false, error: 'Base URL 只允许 http/https' };
        }

        const normalized = baseUrl.replace(/\/+$/, '');
        const candidates = [];
        candidates.push(`${normalized}/models`);
        if (!/\/v1$/.test(normalized)) candidates.push(`${normalized}/v1/models`);
        const uniqueCandidates = [...new Set(candidates)];

        const headers = { 'Accept': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        for (const url of uniqueCandidates) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 8000);
            try {
                const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
                if (resp.ok) return { success: true };
                if (resp.status === 404) continue;
                let bodyText = '';
                try { bodyText = await resp.text(); } catch (e) {}
                const snippet = bodyText ? bodyText.slice(0, 300) : '';
                return { success: false, error: `HTTP ${resp.status}: ${snippet || resp.statusText}` };
            } catch (e) {
                const msg = e && e.name === 'AbortError' ? '请求超时' : (e && e.message ? e.message : '请求失败');
                return { success: false, error: msg };
            } finally {
                clearTimeout(timeout);
            }
        }

        return { success: false, error: '未找到可用的 OpenAI 兼容接口（/models 或 /v1/models）' };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('llm-openai-list-models', async (event, params) => {
    try {
        const baseUrl = params && typeof params.baseUrl === 'string' ? params.baseUrl.trim() : '';
        const apiKey = params && typeof params.apiKey === 'string' ? params.apiKey : '';
        if (!baseUrl) return { success: false, error: 'Base URL 不能为空', models: [] };

        let parsed;
        try {
            parsed = new URL(baseUrl);
        } catch (e) {
            return { success: false, error: 'Base URL 不是合法 URL', models: [] };
        }
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { success: false, error: 'Base URL 只允许 http/https', models: [] };
        }

        const normalized = baseUrl.replace(/\/+$/, '');
        const candidates = [];
        candidates.push(`${normalized}/models`);
        if (!/\/v1$/.test(normalized)) candidates.push(`${normalized}/v1/models`);
        const uniqueCandidates = [...new Set(candidates)];

        const headers = { 'Accept': 'application/json' };
        if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

        for (const url of uniqueCandidates) {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 10000);
            try {
                const resp = await fetch(url, { method: 'GET', headers, signal: controller.signal });
                if (!resp.ok) {
                    if (resp.status === 404) continue;
                    let bodyText = '';
                    try { bodyText = await resp.text(); } catch (e) {}
                    const snippet = bodyText ? bodyText.slice(0, 300) : '';
                    return { success: false, error: `HTTP ${resp.status}: ${snippet || resp.statusText}`, models: [] };
                }

                const payload = await resp.json();
                const dataArr = Array.isArray(payload?.data) ? payload.data : null;
                const models = dataArr
                    ? dataArr.map((m) => m && typeof m.id === 'string' ? m.id : null).filter(Boolean)
                    : (Array.isArray(payload?.models) ? payload.models.filter((m) => typeof m === 'string') : []);

                return { success: true, models };
            } catch (e) {
                const msg = e && e.name === 'AbortError' ? '请求超时' : (e && e.message ? e.message : '请求失败');
                return { success: false, error: msg, models: [] };
            } finally {
                clearTimeout(timeout);
            }
        }

        return { success: false, error: '未找到可用的 OpenAI 兼容接口（/models 或 /v1/models）', models: [] };
    } catch (e) {
        return { success: false, error: e.message, models: [] };
    }
});

ipcMain.handle('kb-upsert-folder-meta', async (event, meta) => {
    return await dbManager.upsertKbFolderMeta(meta);
});

ipcMain.handle('kb-get-folder-meta', async (event, folderId) => {
    return await dbManager.getKbFolderMeta(folderId);
});

ipcMain.handle('kb-get-file-metadata', async (event, filePath) => {
    return await dbManager.getKbFileMetadata(filePath);
});

ipcMain.handle('kb-save-file-metadata', async (event, record) => {
    return await dbManager.upsertKbFileMetadata({ ...record, source: 'user' });
});

let kbMetadataQueue = Promise.resolve();
const kbMetadataInFlight = new Map();
const normalizeKbMeta = (meta) => {
    const m = meta || {};
    const title = typeof m.title === 'string' ? m.title.trim().slice(0, 200) : null;
    const author = typeof m.author === 'string' ? m.author.trim().slice(0, 120) : null;
    const published_time = typeof m.published_time === 'string' ? m.published_time.trim().slice(0, 40) : null;
    const abstract = typeof m.abstract === 'string' ? m.abstract.trim().slice(0, 800) : null;
    const keywords = Array.isArray(m.keywords) ? m.keywords.filter(k => typeof k === 'string').map(k => k.trim()).filter(Boolean).slice(0, 30) : [];
    return { title, author, published_time, abstract, keywords };
};

const enqueueKbMetadataExtraction = (filePath, { awaitResult } = { awaitResult: false }) => {
    if (!filePath || typeof filePath !== 'string') return Promise.resolve({ success: false, error: 'Invalid file path' });
    if (kbMetadataInFlight.has(filePath)) return kbMetadataInFlight.get(filePath);

    const run = async () => {
        try {
            const st = fs.existsSync(filePath) ? fs.statSync(filePath) : null;
            if (!st || !st.isFile()) return { success: false, error: 'File not found' };
            if (st.size > 50 * 1024 * 1024) {
                const fallback = normalizeKbMeta({ title: path.basename(filePath) });
                await dbManager.upsertKbFileMetadata({ file_path: filePath, ...fallback, source: 'auto' });
                if (mainWindow && !mainWindow.isDestroyed()) {
                    mainWindow.webContents.send('kb-file-metadata-updated', { filePath, meta: fallback });
                }
                return { success: true, meta: fallback };
            }

            const { extractFileMetadata } = require('./utils/metadataExtractor');
            const extracted = normalizeKbMeta(await extractFileMetadata(filePath));
            const res = await dbManager.upsertKbFileMetadata({ file_path: filePath, ...extracted, source: 'auto' });
            if (!res.success) return res;
            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('kb-file-metadata-updated', { filePath, meta: extracted });
            }
            return { success: true, meta: extracted };
        } catch (e) {
            return { success: false, error: e.message };
        }
    };

    const promise = kbMetadataQueue.then(run, run);
    kbMetadataQueue = promise.catch(() => {});
    kbMetadataInFlight.set(filePath, promise);
    promise.finally(() => kbMetadataInFlight.delete(filePath));
    return awaitResult ? promise : promise.then(() => ({ success: true })).catch((e) => ({ success: false, error: e.message }));
};

ipcMain.handle('kb-queue-file-metadata', async (event, filePath) => {
    enqueueKbMetadataExtraction(filePath, { awaitResult: false });
    return { success: true };
});

ipcMain.handle('kb-extract-file-metadata', async (event, filePath) => {
    return await enqueueKbMetadataExtraction(filePath, { awaitResult: true });
});
ipcMain.handle('app-get-version', async () => app.getVersion());
ipcMain.handle('storage-persist', async (event, data) => storageManager.persist(data));

// --- Secure Storage IPC ---
ipcMain.handle('secure-set', async (event, key, value) => {
    try {
        if (!safeStorage.isEncryptionAvailable()) {
            // Fallback for dev/unsupported envs: Just save to DB as plain text (or warn)
            // For now, we use the same dbManager.saveSetting but maybe mark it?
            // Actually, let's just warn and save.
            console.warn("safeStorage not available, saving as plain text in DB settings.");
            await dbManager.saveSetting(key, value);
            return { success: true, encrypted: false };
        }
        const buffer = safeStorage.encryptString(value);
        const hex = buffer.toString('hex');
        await dbManager.saveSetting(key, `ENC:${hex}`);
        return { success: true, encrypted: true };
    } catch (e) {
        console.error("Secure Set Error:", e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('secure-get', async (event, key) => {
    try {
        const val = await dbManager.getSetting(key);
        if (!val) return null;

        if (typeof val === 'string' && val.startsWith('ENC:')) {
            if (!safeStorage.isEncryptionAvailable()) return null; // Cannot decrypt
            const hex = val.substring(4);
            const buffer = Buffer.from(hex, 'hex');
            return safeStorage.decryptString(buffer);
        }
        return val; // Return plain text if not encrypted
    } catch (e) {
        console.error(`Secure Get Error for key '${key}':`, e);
        return null;
    }
});

ipcMain.handle('claude-code-status', async () => claudeCodeService.getStatus());
ipcMain.handle('claude-code-set-enabled', async (event, enabled) => claudeCodeService.setEnabled(!!enabled));
ipcMain.handle('claude-code-set-bin', async (event, p) => claudeCodeService.setManagedBin(p));
ipcMain.handle('claude-code-install-from-path', async (event, p) => claudeCodeService.installFromPath(p));
ipcMain.handle('claude-code-clear-bin', async () => claudeCodeService.clearManagedBin());
ipcMain.handle('claude-code-uninstall-managed', async () => claudeCodeService.uninstallManaged());
ipcMain.handle('claude-code-create-session', async (event, params) => claudeCodeService.createSession(params || {}));
ipcMain.handle('claude-code-write', async (event, payload) => claudeCodeService.write(payload || {}));
ipcMain.handle('claude-code-resize', async (event, payload) => claudeCodeService.resize(payload || {}));
ipcMain.handle('claude-code-kill', async (event, payload) => claudeCodeService.kill(payload || {}));
ipcMain.handle('claude-code-kill-all', async () => {
    try { claudeCodeService.killAll(); } catch (e) {}
    return { success: true };
});
ipcMain.handle('self-mod-get-status', async () => ({
    success: true,
    safeMode: false,
    manualSafeMode: false,
    failCount: 0,
    snapshot: { exists: false }
}));
ipcMain.handle('self-mod-set-safe-mode', async (event, enabled) => ({
    success: true,
    safeMode: !!enabled,
    manualSafeMode: !!enabled,
    failCount: 0,
    snapshot: { exists: false }
}));
ipcMain.handle('self-mod-create-snapshot', async () => ({ success: true }));
ipcMain.handle('self-mod-rollback-snapshot', async () => ({ success: true }));
ipcMain.handle('self-mod-reset-startup-guard', async () => ({ success: true }));
ipcMain.handle('toolhub-get-paths', async () => {
    const userData = app.getPath('userData');
    const managedRoot = path.join(userData, 'openclaw-managed');
    const stateHome = path.join(managedRoot, 'state');
    return {
        success: true,
        openclawManagedRoot: managedRoot,
        openclawStateHome: stateHome,
        claudeManagedRoot: path.join(userData, 'claude-managed'),
        userData
    };
});

ipcMain.handle('claude-code-managed-status', async () => claudeCodeInstaller.getStatus());
ipcMain.handle('claude-code-managed-install', async (event, options) => {
    const emit = (payload) => {
        try { mainWindow?.webContents?.send('claude-code:install-progress', payload); } catch (e) {}
    };
    try {
        const result = await claudeCodeInstaller.startInstall({ emit, options });
        try { await claudeCodeService.init(); } catch (e) {}
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'install failed' };
    }
});
ipcMain.handle('claude-code-managed-cancel', async () => {
    try {
        const result = await claudeCodeInstaller.cancelActiveInstall();
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'cancel failed' };
    }
});
ipcMain.handle('claude-code-managed-uninstall', async () => {
    const emit = (payload) => {
        try { mainWindow?.webContents?.send('claude-code:install-progress', payload); } catch (e) {}
    };
    try { await claudeCodeService.setEnabled(false); } catch (e) {}
    try {
        const result = await claudeCodeInstaller.uninstall({ emit });
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'uninstall failed' };
    }
});

ipcMain.handle('claude-code-resolve-system-proxy', async (event, url) => {
    try {
        const u = String(url || '').trim();
        if (!u) return { success: false, error: 'invalid_url' };
        const win = BrowserWindow.fromWebContents(event.sender);
        const ses = win ? win.webContents.session : session.defaultSession;
        const proxy = await ses.resolveProxy(u);
        return { success: true, proxy: String(proxy || '') };
    } catch (e) {
        return { success: false, error: e.message || 'resolve_proxy_failed' };
    }
});

ipcMain.handle('openclaw-get-status', async () => openclawService.getStatus());
ipcMain.handle('openclaw-ensure-running', async () => openclawService.ensureRunning());
ipcMain.handle('openclaw-set-enabled', async (event, enabled) => openclawService.setEnabled(!!enabled));
ipcMain.handle('openclaw-stop', async () => {
    try {
        await openclawService.init();
    } catch (e) {}
    try {
        await openclawService.setEnabled(false);
    } catch (e) {}
    try {
        await openclawService.stopBridge();
    } catch (e) {}
    try {
        await openclawService.stopGateway();
    } catch (e) {}
    return openclawService.getStatus();
});
ipcMain.handle('openclaw-takeover', async (event, payload) => openclawService.takeoverGateway(payload));
ipcMain.handle('openclaw-run-agent-message', async (event, message) => openclawService.runAgentMessage(message));
ipcMain.handle('openclaw-get-bridge-token', async () => openclawService.getBridgeToken());
ipcMain.handle('openclaw-get-gateway-token', async () => openclawService.getGatewayToken());
ipcMain.handle('openclaw-rotate-gateway-token', async () => openclawService.rotateGatewayToken());
ipcMain.handle('openclaw-rotate-bridge-token', async () => openclawService.rotateBridgeToken());
ipcMain.handle('openclaw-sync-bridge-skill', async () => openclawService.syncBridgeSkill());
ipcMain.handle('openclaw-get-gateway-log-tail', async (event, lines) => openclawService.getGatewayLogTail(lines));
ipcMain.handle('openclaw-get-agent-log-tail', async (event, lines) => openclawService.getAgentLogTail(lines));
ipcMain.handle('openclaw-get-runtime-log-tail', async (event, lines) => openclawService.getRuntimeLogTail(lines));
ipcMain.handle('openclaw-open-dashboard', async () => openOpenClawDashboardWindow());
ipcMain.handle('openclaw-plugins-list', async () => openclawService.pluginsList());
ipcMain.handle('openclaw-plugins-install', async (event, spec) => openclawService.pluginsInstall(spec));
ipcMain.handle('openclaw-utility-skills-list', async () => openclawService.listUtilitySkills());
ipcMain.handle('openclaw-utility-skills-install', async (event, payload) => openclawService.installUtilitySkills(payload || {}));
ipcMain.handle('openclaw-utility-skills-set-enabled', async (event, payload) => openclawService.setUtilitySkillEnabled(payload || {}));
ipcMain.handle('openclaw-utility-skills-remove', async (event, payload) => openclawService.removeUtilitySkill(payload || {}));
ipcMain.handle('openclaw-utility-skills-update', async (event, payload) => openclawService.updateUtilitySkill(payload || {}));
ipcMain.handle('openclaw-gateway-restart', async () => openclawService.restartGateway());
ipcMain.handle('openclaw-apply-ngo-preset', async () => openclawService.applyNgoPlannerPreset());
ipcMain.handle('openclaw-scrub-sensitive', async () => openclawService.scrubSensitiveNow());
ipcMain.handle('openclaw-security-status', async () => openclawService.getSecurityStatus());
ipcMain.handle('openclaw-security-set-config', async (event, payload) => openclawService.setSecurityConfig(payload || {}));
ipcMain.handle('openclaw-security-harden-now', async (event, payload) => openclawService.hardenSecurityNow(payload || {}));

ipcMain.handle('workroom-get-config', async () => workroomService.getConfig());
ipcMain.handle('workroom-save-config', async (event, next) => workroomService.saveConfig(next));
ipcMain.handle('workroom-list-official-skills', async () => workroomService.listOfficialSkills());
ipcMain.handle('workroom-list-marketplace-skills', async () => workroomService.listMarketplaceSkills());
ipcMain.handle('workroom-remote-refresh-index', async (event, payload) => workroomService.refreshRemoteIndex(payload));
ipcMain.handle('workroom-remote-search', async (event, payload) => workroomService.searchRemoteSkills(payload));
ipcMain.handle('workroom-remote-install-skill', async (event, payload) => workroomService.installRemoteSkill(payload));
ipcMain.handle('workroom-audit-skill', async (event, payload) => workroomService.auditSkill(payload));
ipcMain.handle('workroom-oneclick-plan', async (event, payload) => workroomService.planOneClick(payload));
ipcMain.handle('workroom-oneclick-apply', async (event, plan) => workroomService.applyOneClick(plan));

ipcMain.handle('openclaw-embed-show', async (event, payload) => {
    openclawEmbedDesiredVisible = true;
    const showSeq = ++openclawEmbedShowSeq;
    let st = await openclawService.getStatus();
    let port = st?.gateway?.port || 0;
    let running = !!st?.gateway?.running;
    if (!running || !port) {
        try {
            await openclawService.ensureRunning();
        } catch (e) {}
        if (!openclawEmbedDesiredVisible || showSeq !== openclawEmbedShowSeq) {
            return { success: false, error: 'cancelled_by_hide' };
        }
        st = await openclawService.getStatus();
        port = st?.gateway?.port || 0;
        running = !!st?.gateway?.running;
    }
    if (!running || !port) return { success: false, error: 'openclaw_gateway_not_running' };
    if (!openclawEmbedDesiredVisible || showSeq !== openclawEmbedShowSeq) {
        return { success: false, error: 'cancelled_by_hide' };
    }

    let gatewayToken = '';
    try {
        gatewayToken = await openclawService.getGatewayToken();
    } catch (e) {
        gatewayToken = '';
    }

    const prevAuthPort = Number(openclawDashboardAuthPort || 0);
    const prevAuthToken = String(openclawDashboardAuthToken || '');
    openclawDashboardAuthToken = String(gatewayToken || '');
    openclawDashboardAuthPort = Number(port || 0);
    const dashSession = session.fromPartition('persist:openclaw-dashboard');
    ensureOpenclawDashboardWebRequest(dashSession);
    try {
        await dashSession.setProxy({ proxyRules: 'direct://' });
    } catch (e) {}
    const resetSession = !!payload?.resetSession;
    const portChanged = !!prevAuthPort && prevAuthPort !== openclawDashboardAuthPort;
    const tokenChanged = !!prevAuthToken && prevAuthToken !== openclawDashboardAuthToken;
    if (resetSession || portChanged || tokenChanged) {
        try {
            await dashSession.clearStorageData();
            await dashSession.clearCache();
        } catch (e) {}
    }

    const view = ensureOpenclawEmbedView();
    if (!view) return { success: false, error: 'no_main_window' };
    if (!openclawEmbedDesiredVisible || showSeq !== openclawEmbedShowSeq) {
        return { success: false, error: 'cancelled_by_hide' };
    }
    try {
        openclawDashboardWebContentsId = view.webContents.id;
        openclawDashboardAllowedWebContentsIds.add(view.webContents.id);
    } catch (e) {}

    try {
        mainWindow.setBrowserView(view);
        openclawEmbedAttached = true;
    } catch (e) {
        return { success: false, error: 'attach_failed' };
    }

    try {
        const b = payload && payload.bounds ? payload.bounds : null;
        const x = b && Number.isFinite(Number(b.x)) ? Math.max(0, Math.round(Number(b.x))) : 0;
        const y = b && Number.isFinite(Number(b.y)) ? Math.max(0, Math.round(Number(b.y))) : 0;
        const width = b && Number.isFinite(Number(b.width)) ? Math.max(1, Math.round(Number(b.width))) : 800;
        const height = b && Number.isFinite(Number(b.height)) ? Math.max(1, Math.round(Number(b.height))) : 600;
        view.setBounds({ x, y, width, height });
    } catch (e) {}

    const url = `http://127.0.0.1:${port}/`;
    const urlWithAuth = (() => {
        try {
            const t = String(gatewayToken || '').trim();
            if (!t) return url;
            const u = new URL(url);
            u.searchParams.set('auth', t);
            u.searchParams.set('token', t);
            return u.toString();
        } catch (e) {
            return url;
        }
    })();

    const injectConnect = async () => {
        try {
            const token = String(gatewayToken || '').trim();
            if (!token) return;
            const js = `
              (function(){
                try{
                  var token=${JSON.stringify(String(gatewayToken || ''))};
                  var port=${JSON.stringify(Number(port || 0))};
                  if(!token||!port) return;
                  try{
                    try {
                      localStorage.setItem('openclaw_control_ui_settings', JSON.stringify({ token: token, auth: token, wsUrl: 'ws://127.0.0.1:'+port }));
                      localStorage.setItem('openclaw_gateway_token', token);
                      localStorage.setItem('openclaw_control_ui_token', token);
                      localStorage.setItem('openclaw_control_ui_auth', token);
                    } catch(e) {}
                  }catch(e){}
                  var btn = Array.from(document.querySelectorAll('button')).find(function(b){
                    var t3 = (b.textContent||'').trim().toLowerCase();
                    return t3 === 'connect' || t3.includes('connect') || t3 === '连接' || t3.includes('连接');
                  });
                  if(btn) btn.click();
                }catch(e){}
              })();
            `;
            await view.webContents.executeJavaScript(js, true);
        } catch (e) {}
    };

    const forceReload = !!payload?.forceReload;
    const forceReconnect = !!payload?.forceReconnect;
    const shouldReconnect = forceReconnect || resetSession || portChanged || tokenChanged;
    try {
        const currentUrl = String(view.webContents.getURL?.() || '');
        const baseUrl = `http://127.0.0.1:${port}/`;
        if (!forceReload && currentUrl && currentUrl.startsWith(baseUrl)) {
            if (shouldReconnect) {
                injectConnect().catch(() => {});
            }
            return { success: true, reused: true };
        }
    } catch (e) {}

    try {
        view.webContents.once('did-finish-load', async () => {
            try {
                const token = String(gatewayToken || '').trim();
                if (!token) return;
                const js = `
                  (function(){
                    try{
                      var token=${JSON.stringify(String(gatewayToken || ''))};
                      var port=${JSON.stringify(Number(port || 0))};
                      if(!token||!port) return;
                      try{
                        try {
                          localStorage.removeItem('openclaw_control_ui_settings');
                          localStorage.removeItem('openclaw_gateway_token');
                          localStorage.removeItem('openclaw_control_ui_token');
                          localStorage.removeItem('openclaw_control_ui_auth');
                          localStorage.removeItem('OPENCLAW_GATEWAY_TOKEN');
                        } catch(e) {}
                        localStorage.setItem('openclaw_control_ui_settings', JSON.stringify({ token: token, auth: token, wsUrl: 'ws://127.0.0.1:'+port }));
                        localStorage.setItem('openclaw_gateway_token', token);
                        localStorage.setItem('openclaw_control_ui_token', token);
                        localStorage.setItem('openclaw_control_ui_auth', token);
                      }catch(e){}

                      function setValue(el, v){
                        try{
                          var proto = Object.getPrototypeOf(el);
                          var desc = Object.getOwnPropertyDescriptor(proto, 'value');
                          if(desc && desc.set) desc.set.call(el, v);
                          else el.value = v;
                          el.dispatchEvent(new Event('input', { bubbles: true }));
                          el.dispatchEvent(new Event('change', { bubbles: true }));
                        }catch(e){}
                      }
                      function findInputByLabel(labelText){
                        var labels = Array.from(document.querySelectorAll('label,div,span'));
                        for(var i=0;i<labels.length;i++){
                          var t2 = (labels[i].textContent||'').trim();
                          if(!t2) continue;
                          if(t2.toLowerCase()===labelText.toLowerCase()){
                            var root = labels[i].closest('div') || labels[i].parentElement;
                            if(root){
                              var inp = root.querySelector('input');
                              if(inp) return inp;
                            }
                          }
                        }
                        return null;
                      }
                      var wsInput = findInputByLabel('WebSocket URL');
                      if(!wsInput){
                        var ins = Array.from(document.querySelectorAll('input'));
                        wsInput = ins.find(function(x){ return ((x.placeholder||'')+' '+(x.name||'')).toLowerCase().includes('ws'); }) || null;
                      }
                      if(wsInput) setValue(wsInput, 'ws://127.0.0.1:'+port);
                      var tokenInput = findInputByLabel('Gateway Token');
                      if(!tokenInput){
                        var ins2 = Array.from(document.querySelectorAll('input'));
                        tokenInput = ins2.find(function(x){ return ((x.placeholder||'')+' '+(x.name||'')).toLowerCase().includes('token'); }) || null;
                      }
                      if(tokenInput) setValue(tokenInput, token);
                      var btn = Array.from(document.querySelectorAll('button')).find(function(b){
                        var t3 = (b.textContent||'').trim().toLowerCase();
                        return t3 === 'connect' || t3.includes('connect') || t3 === '连接' || t3.includes('连接');
                      });
                      if(btn) btn.click();
                    }catch(e){}
                  })();
                `;
                await view.webContents.executeJavaScript(js, true);
            } catch (e) {}
        });
    } catch (e) {}

    try {
        await view.webContents.loadURL(urlWithAuth);
    } catch (e) {
        return { success: false, error: 'load_failed' };
    }
    if (!openclawEmbedDesiredVisible || showSeq !== openclawEmbedShowSeq) {
        try {
            if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBrowserView(null);
        } catch (e) {}
        openclawEmbedAttached = false;
        return { success: false, error: 'cancelled_by_hide' };
    }
    return { success: true };
});
ipcMain.handle('openclaw-embed-hide', async () => {
    openclawEmbedDesiredVisible = false;
    openclawEmbedShowSeq += 1;
    try {
        if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setBrowserView(null);
    } catch (e) {}
    openclawEmbedAttached = false;
    return { success: true };
});
ipcMain.handle('openclaw-embed-resize', async (event, payload) => {
    if (!openclawEmbedAttached) return { success: false, error: 'not_attached' };
    try {
        const view = ensureOpenclawEmbedView();
        if (!view) return { success: false, error: 'no_view' };
        const b = payload && payload.bounds ? payload.bounds : null;
        const x = b && Number.isFinite(Number(b.x)) ? Math.max(0, Math.round(Number(b.x))) : 0;
        const y = b && Number.isFinite(Number(b.y)) ? Math.max(0, Math.round(Number(b.y))) : 0;
        const width = b && Number.isFinite(Number(b.width)) ? Math.max(1, Math.round(Number(b.width))) : 800;
        const height = b && Number.isFinite(Number(b.height)) ? Math.max(1, Math.round(Number(b.height))) : 600;
        view.setBounds({ x, y, width, height });
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message || 'resize_failed' };
    }
});
ipcMain.handle('openclaw-embed-reload', async () => {
    try {
        const view = ensureOpenclawEmbedView();
        if (!view) return { success: false, error: 'no_view' };
        view.webContents.reloadIgnoringCache();
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message || 'reload_failed' };
    }
});
ipcMain.handle('openclaw-bridge-health', async () => {
    try {
        await openclawService.ensureRunning();
        await openclawService.startBridge();
        const http = require('http');
        const url = `http://127.0.0.1:${openclawService.bridgePort}/health`;
        return await new Promise((resolve) => {
            const req = http.request(url, { method: 'GET' }, (res) => {
                let data = '';
                res.on('data', (c) => { data += c; });
                res.on('end', () => {
                    try {
                        resolve({ success: true, result: JSON.parse(data || '{}') });
                    } catch (e) {
                        resolve({ success: false, error: 'invalid_json' });
                    }
                });
            });
            req.on('error', (e) => resolve({ success: false, error: e.message }));
            req.end();
        });
    } catch (e) {
        return { success: false, error: e.message || 'bridge_health_failed' };
    }
});
ipcMain.handle('openclaw-bridge-request', async (event, payload) => {
    try {
        const p = payload && typeof payload === 'object' ? payload : {};
        const path = typeof p.path === 'string' ? p.path.trim() : '';
        const body = p.body && typeof p.body === 'object' ? p.body : {};
        if (!path || !path.startsWith('/skills/')) return { success: false, error: 'invalid_path' };
        await openclawService.ensureRunning();
        await openclawService.startBridge();
        const http = require('http');
        const token = await openclawService.getBridgeToken();
        const url = `http://127.0.0.1:${openclawService.bridgePort}${path}`;
        const text = JSON.stringify(body || {});
        return await new Promise((resolve) => {
            const req = http.request(
                url,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(text),
                        Authorization: `Bearer ${token}`
                    }
                },
                (res) => {
                    let data = '';
                    res.on('data', (c) => { data += c; });
                    res.on('end', () => {
                        try {
                            resolve(JSON.parse(data || '{}'));
                        } catch (e) {
                            resolve({ success: false, error: 'invalid_json' });
                        }
                    });
                }
            );
            req.on('error', (e) => resolve({ success: false, error: e.message }));
            req.write(text);
            req.end();
        });
    } catch (e) {
        return { success: false, error: e.message || 'bridge_request_failed' };
    }
});
ipcMain.handle('openclaw-list-artifacts', async (event, params) => {
    try {
        const p = params && typeof params === 'object' ? params : {};
        const result = await dbManager.listAiArtifacts({
            projectId: typeof p.projectId === 'string' ? p.projectId : undefined,
            milestoneId: typeof p.milestoneId === 'string' ? p.milestoneId : undefined,
            limit: typeof p.limit === 'number' ? p.limit : 50
        });
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'list artifacts failed' };
    }
});
ipcMain.handle('openclaw-dashboard-auth', async (event) => {
    try {
        if (!event.sender?.id || !openclawDashboardAllowedWebContentsIds.has(event.sender.id)) {
            return { success: false, error: 'forbidden' };
        }
        const token = await openclawService.getGatewayToken();
        const st = await openclawService.getStatus();
        return { success: true, token, port: st?.gateway?.port || 0 };
    } catch (e) {
        return { success: false, error: e.message };
    }
});
ipcMain.on('openclaw-dashboard-auth-sync', (event) => {
    try {
        if (!event.sender?.id || !openclawDashboardAllowedWebContentsIds.has(event.sender.id)) {
            event.returnValue = { success: false, token: '' };
            return;
        }
        const token = String(openclawDashboardAuthToken || '').trim();
        event.returnValue = { success: !!token, token };
    } catch (e) {
        event.returnValue = { success: false, token: '' };
    }
});
ipcMain.handle('openclaw-managed-status', async () => openclawInstaller.getStatus());
ipcMain.handle('openclaw-managed-install', async (event, options) => {
    const emit = (payload) => {
        try { mainWindow?.webContents?.send('openclaw:install-progress', payload); } catch (e) {}
    };
    try {
        const result = await openclawInstaller.startInstall({ emit, options });
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'install failed' };
    }
});
ipcMain.handle('openclaw-managed-cancel', async () => {
    try {
        const result = await openclawInstaller.cancelActiveInstall();
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'cancel failed' };
    }
});
ipcMain.handle('openclaw-managed-rollback', async () => {
    const emit = (payload) => {
        try { mainWindow?.webContents?.send('openclaw:install-progress', payload); } catch (e) {}
    };
    try { await openclawService.setEnabled(false); } catch (e) {}
    try {
        const result = await openclawInstaller.rollback({ emit });
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'rollback failed' };
    }
});
ipcMain.handle('openclaw-managed-uninstall', async () => {
    const emit = (payload) => {
        try { mainWindow?.webContents?.send('openclaw:install-progress', payload); } catch (e) {}
    };
    try { await openclawService.setEnabled(false); } catch (e) {}
    try {
        const result = await openclawInstaller.uninstall({ emit });
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'uninstall failed' };
    }
});

// --- Skill Orchestrator IPC ---
ipcMain.handle('skill-orchestrator:run-analysis', async () => {
    try {
        return await skillOrchestrator.runAnalysisAndSync();
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('marketplace-get-locations', async () => {
    try {
        const result = await marketplaceService.getLocations();
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'get locations failed' };
    }
});
ipcMain.handle('marketplace-list-plugins', async () => {
    try {
        const result = await marketplaceService.listInstalledPlugins();
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'list plugins failed' };
    }
});
ipcMain.handle('marketplace-plugin-set-enabled', async (event, { pluginId, enabled }) => {
    try {
        const result = await marketplaceService.setPluginEnabled(String(pluginId || ''), !!enabled);
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'set enabled failed' };
    }
});
ipcMain.handle('marketplace-plugin-uninstall', async (event, pluginId) => {
    try {
        const result = await marketplaceService.uninstallPlugin(String(pluginId || ''));
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'uninstall failed' };
    }
});
ipcMain.handle('marketplace-plugin-install-from-dir', async (event, srcDir) => {
    try {
        const result = await marketplaceService.installPluginFromDirectory(String(srcDir || ''));
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'install failed' };
    }
});
ipcMain.handle('marketplace-plugin-install-bundled', async (event, bundleId) => {
    try {
        if (bundleId && typeof bundleId === 'object') {
            const id = String(bundleId.bundleId || '').trim();
            const force = bundleId.force !== undefined ? !!bundleId.force : undefined;
            const result = await marketplaceService.installBundledPlugin(id, { force });
            return { success: true, result };
        }
        const result = await marketplaceService.installBundledPlugin(String(bundleId || ''));
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'install bundled failed' };
    }
});
ipcMain.handle('marketplace-list-skills', async () => {
    try {
        const result = await marketplaceService.listSkills();
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'list skills failed' };
    }
});
ipcMain.handle('marketplace-skill-promote', async (event, dir) => {
    try {
        const result = await marketplaceService.promoteDraftSkill(String(dir || ''));
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'promote failed' };
    }
});
ipcMain.handle('marketplace-skill-delete', async (event, dir) => {
    try {
        const result = await marketplaceService.deleteSkill(String(dir || ''));
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'delete failed' };
    }
});
ipcMain.handle('marketplace-skill-import-from-dir', async (event, srcDir) => {
    try {
        const result = await marketplaceService.importSkillFromDirectory(String(srcDir || ''));
        return { success: true, result };
    } catch (e) {
        return { success: false, error: e.message || 'import failed' };
    }
});

// const ragEngine = require('./services/rag/ragEngine'); // Moved to top
const IngestionQueue = require('./services/rag/ingestionQueue');
let ingestionQueue;
const ProjectWatcher = require('./services/projectWatcher');
let projectWatcher;

const exportService = require('./services/exportService');

// --- Export Service IPC ---
ipcMain.handle('export-file', (event, args) => exportService.exportFile(event, args));

ipcMain.handle('kb-update-reading-stats', async (event, { filePath, duration, progress, totalPages }) => {
    return await dbManager.updateReadingStats(filePath, duration, progress, totalPages);
});

ipcMain.handle('kb-get-file-top-tags', async (event, filePaths, limit) => {
    return await dbManager.getBatchFileTopTags(filePaths, limit);
});

ipcMain.handle('kb-get-extended-stats', async () => {
    try {
        const stats = await dbManager.getExtendedStats();
        const vectorStore = require('./services/rag/vectorStore');
        const chunkCounts = await vectorStore.getChunkCounts();
        
        // Merge chunk counts
        return stats.map(s => {
            const normPath = s.file_path.replace(/\\/g, '/').toLowerCase();
            const count = chunkCounts[normPath] || 0;
            return {
                ...s,
                chunk_count: count,
                // If chunk_count > 0, it is effectively indexed
                is_indexed: count > 0 // helper for frontend if needed, though use_in_rag might be the flag
            };
        });
    } catch (e) {
        console.error("Extended Stats Error:", e);
        return [];
    }
});

const limitConcurrency = async (items, concurrency, handler) => {
    const results = new Array(items.length);
    let index = 0;
    const workers = new Array(Math.max(1, concurrency)).fill(0).map(async () => {
        while (index < items.length) {
            const current = index++;
            try {
                results[current] = await handler(items[current], current);
            } catch (e) {
                results[current] = null;
            }
        }
    });
    await Promise.all(workers);
    return results;
};

const scanStaleReadingHistory = async ({ limit = 5000, timeoutMs = 800, delete: shouldDelete = false } = {}) => {
    const stats = await dbManager.getFileStats();
    const candidates = (stats || [])
        .filter((s) => s && typeof s.file_path === 'string')
        .filter((s) => s.last_read_time || s.total_read_time > 0 || s.ingest_time)
        .map((s) => s.file_path)
        .slice(0, Math.max(1, Math.min(Number(limit) || 5000, 20000)));

    const checks = await limitConcurrency(candidates, 8, async (filePath) => {
        const statTask = (async () => {
            try {
                const st = await fs.promises.stat(filePath);
                if (!st.isFile()) return { filePath, stale: true };
                return { filePath, stale: st.size === 0 };
            } catch (e) {
                const code = e && (e.code || e.errno);
                if (code === 'ENOENT' || code === 'ENOTDIR' || code === -2 || code === -20) return { filePath, stale: true };
                return { filePath, stale: false };
            }
        })();

        if (!timeoutMs || Number(timeoutMs) <= 0) return await statTask;
        const timer = new Promise((resolve) => setTimeout(() => resolve({ filePath, stale: true, timedOut: true }), timeoutMs));
        return await Promise.race([timer, statTask]);
    });

    const stalePaths = (checks || []).filter((r) => r && r.stale).map((r) => r.filePath);
    if (shouldDelete && stalePaths.length > 0) {
        await dbManager.deleteFileStats(stalePaths);
    }
    return { stalePaths, deleted: shouldDelete ? stalePaths.length : 0 };
};

ipcMain.handle('kb-scan-stale-reading-history', async (event, options) => {
    try {
        const opts = options || {};
        const res = await scanStaleReadingHistory(opts);
        return { success: true, stalePaths: res.stalePaths, deleted: res.deleted };
    } catch (e) {
        return { success: false, error: e.message, stalePaths: [], deleted: 0 };
    }
});

ipcMain.handle('kb-delete-reading-history', async (event, filePath) => {
    try {
        if (!filePath || typeof filePath !== 'string') return { success: false, error: 'Invalid file path' };
        await dbManager.deleteFileStats([filePath]);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// --- RAG Knowledge Base IPC ---
ipcMain.handle('kb-upload-file', async (event, fileData) => {
    try {
        if (!ingestionQueue) {
            ingestionQueue = new IngestionQueue(ragEngine);
        }
        
        // Ensure name property exists and preserve options
        const fileToIngest = {
            path: fileData.path,
            name: fileData.name || require('path').basename(fileData.path),
            size: 0, // Should get from fs stat
            lastModified: Date.now(),
            options: fileData.options || {} // Preserve options for Worker (e.g. saveProcessedAsMd)
        };
        
        // Force delete existing index first to ensure clean state (especially for re-index)
        try {
            const vectorStore = require('./services/rag/vectorStore');
            await vectorStore.deleteDocuments(fileToIngest.path);
        } catch (e) {
            console.warn(`[Main] Failed to clear index for ${fileToIngest.path}:`, e.message);
        }

        ingestionQueue.addFile(fileToIngest);
        return { success: true };
    } catch (e) {
        console.error("KB Upload Error:", e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('kb-reset-index', async (event) => {
    try {
        const vectorStore = require('./services/rag/vectorStore');
        // Drop and recreate table for schema upgrade / clean slate
        await vectorStore.recreateTable();
        return { success: true };
    } catch (e) {
        console.error("KB Reset Error:", e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('kb-rebuild-index', async (event, filePaths) => {
    try {
        if (!projectWatcher) return { success: false, error: "Project Watcher not initialized" };
        // Support selective reindex if filePaths array provided
        return await projectWatcher.forceRescan(filePaths || []);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// --- RAG Job Management (Stateful) ---
const ragJobs = new Map(); // jobId -> { abortController, pauseController }

class PauseController {
    constructor() {
        this.isPaused = false;
        this.resolve = null;
        this.promise = null;
    }
    pause() {
        if (this.isPaused) return;
        this.isPaused = true;
        this.promise = new Promise(resolve => {
            this.resolve = resolve;
        });
    }
    resume() {
        if (!this.isPaused) return;
        this.isPaused = false;
        if (this.resolve) this.resolve();
        this.resolve = null;
        this.promise = null;
    }
}

ipcMain.handle('kb-start-query', async (event, { text, topK, activeFiles }) => {
    const jobId = crypto.randomUUID();
    const abortController = new AbortController();
    const pauseController = new PauseController();
    
    ragJobs.set(jobId, { abortController, pauseController });
    
    let scopedFiles = Array.isArray(activeFiles) ? activeFiles : [];
    if (scopedFiles.length === 0) {
        const mounts = await dbManager.getSetting('kb_mounted_folders') || [];
        if (Array.isArray(mounts)) scopedFiles = mounts;
    }

    // Run async, don't await. Frontend listens to events.
    ragEngine.query(text, topK, scopedFiles, 1.0, {
        signal: abortController.signal,
        pauseController: pauseController,
        onProgress: (data) => {
            if (!mainWindow || mainWindow.isDestroyed()) return;
            mainWindow.webContents.send('kb-progress', { jobId, ...data });
        }
    }).then(result => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        mainWindow.webContents.send('kb-progress', { 
            jobId, 
            step: 'COMPLETED', 
            progress: 100, 
            data: {
                context: result.context,
                sources: result.sources || [],
                chunks: result.chunks || []
            }
        });
    }).catch(err => {
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const isAborted = err.message === 'Aborted by user';
        mainWindow.webContents.send('kb-progress', { 
            jobId, 
            step: 'ERROR', 
            progress: 0, 
            data: { error: err.message, isAborted }
        });
    }).finally(() => {
        ragJobs.delete(jobId);
    });

    return jobId;
});

ipcMain.handle('kb-control-action', async (event, { jobId, action }) => {
    const job = ragJobs.get(jobId);
    if (!job) return { success: false, error: 'Job not found' };

    try {
        if (action === 'pause') {
            job.pauseController.pause();
            return { success: true, status: 'paused' };
        } else if (action === 'resume') {
            job.pauseController.resume();
            return { success: true, status: 'running' };
        } else if (action === 'stop') {
            job.abortController.abort();
            return { success: true, status: 'stopped' };
        }
        return { success: false, error: 'Unknown action' };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('kb-query', async (event, { text, topK, activeFiles }) => {
    try {
        let scopedFiles = Array.isArray(activeFiles) ? activeFiles : [];
        if (scopedFiles.length === 0) {
            const mounts = await dbManager.getSetting('kb_mounted_folders') || [];
            if (Array.isArray(mounts)) scopedFiles = mounts;
        }
        // Retrieve relevant context
        // Pass activeFiles (array of paths) to filter search results
        const result = await ragEngine.query(text, topK, scopedFiles);
        
        // Return full result including sources for frontend reference
        return {
            context: result.context,
            sources: result.sources || [],
            chunks: result.chunks || [],
            retrievalQuality: result.retrievalQuality || 0,
            debugInfo: result.debugInfo || {}
        };
    } catch (e) {
        console.error("KB Query Error:", e);
        return {
            context: `知识库服务暂时不可用: ${e.message} (请检查 API 设置)。`,
            sources: [],
            chunks: [],
            retrievalQuality: 0,
            debugInfo: {}
        };
    }
});

ipcMain.handle('kb-analyze-intent', async (event, query) => {
    try {
        return await ragEngine.analyzeQueryIntent(query);
    } catch (e) {
        console.error("Intent Analysis Error:", e);
        return { type: 'simple' }; // Fallback
    }
});

ipcMain.handle('kb-completion', async (event, { prompt }) => {
    try {
        const embeddingServiceModule = require('./services/rag/embedding');
        const result = await embeddingServiceModule.completion(prompt);
        return { success: true, text: result };
    } catch (e) {
        console.error("KB Completion Error:", e);
        return { success: false, error: e.message };
    }
});

// --- Privacy Service IPC ---
ipcMain.handle('kb-get-privacy-folders', async (event) => {
    try {
        const privacyService = require('./services/privacyService');
        const folders = await privacyService.getPrivacyFolders();
        return { success: true, folders };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('kb-add-privacy-folder', async (event, folderPath) => {
    try {
        const privacyService = require('./services/privacyService');
        await privacyService.addPrivacyFolder(folderPath);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('kb-remove-privacy-folder', async (event, folderPath) => {
    try {
        const privacyService = require('./services/privacyService');
        await privacyService.removePrivacyFolder(folderPath);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('kb-toggle-privacy', async (event, enabled) => {
    try {
        const privacyService = require('./services/privacyService');
        await privacyService.setEnabled(enabled);
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('kb-get-privacy-status', async (event) => {
    try {
        const dbManager = require('./databaseManager');
        const privacyService = require('./services/privacyService');
        const enabled = await dbManager.getSetting('privacy_mode_enabled');
        // Sync service state just in case
        if (enabled === 'true' && !privacyService.isEnabled) {
            await privacyService.setEnabled(true);
        }
        return { success: true, enabled: enabled === 'true' };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('kb-check-compliance', async (event, { answer, negativeChunks }) => {
    try {
        return await ragEngine.checkCompliance(answer, negativeChunks);
    } catch (e) {
        console.error("Compliance Check Error:", e);
        return { isCompliant: true, violations: [] }; // Fail open
    }
});

ipcMain.handle('kb-chat', async (event, { sessionId, text, contexts, workflow }) => {
    try {
        if (!ragEngine.isReady) {
            console.log('[Main] Initializing RAG Engine...');
            await ragEngine.init();
        }
        
        // Execute Workflow Mode if provided
        if (workflow && workflow.nodes && workflow.nodes.length > 0) {
            console.log(`[Main] Executing Workflow: ${workflow.nodes.length} steps`);
            
            // 1. Topological Sort (Linear execution for MVP)
            // MVP: We assume the frontend passed nodes in creation order or we just sort by edges?
            // Actually, for MVP let's assume strict sequential A -> B -> C based on edges.
            // Or simpler: Just find the start node (no incoming edges) and traverse.
            
            const nodes = workflow.nodes;
            const edges = workflow.edges;
            
            // Find start nodes (nodes that are not targets of any edge)
            const targetIds = new Set(edges.map(e => e.target));
            const startNodes = nodes.filter(n => !targetIds.has(n.id));
            
            if (startNodes.length === 0 && nodes.length > 0) {
                // Cycle detected or disconnected components? 
                // Fallback to first node in list
                startNodes.push(nodes[0]);
            }
            
            // Execution Context (accumulated results)
            let currentContext = "";
            let finalResponse = "";
            let sources = [];
            let chunks = [];
            
            // Sequential Execution
            // We use a queue for BFS/traversal
            let queue = [...startNodes];
            const visited = new Set();
            
            // For MVP, we only support linear chains or simple fan-out.
            // We'll execute step-by-step.
            
            let stepCount = 0;
            const MAX_STEPS = 10;
            
            while (queue.length > 0 && stepCount < MAX_STEPS) {
                const currentNode = queue.shift();
                if (visited.has(currentNode.id)) continue;
                visited.add(currentNode.id);
                stepCount++;
                
                console.log(`[Workflow] Step ${stepCount}: Executing node ${currentNode.role}`);
                
                // Prepare prompt for this step
                // Input: User Question + Previous Context (if any) + Node Instruction
                // Resources: Node Paths
                
                const stepPrompt = `
                [Current Task]: ${currentNode.role}
                [Instruction]: ${currentNode.instruction || "Analyze the following documents."}
                [User Question]: ${text}
                ${currentContext ? `[Previous Step Output]:\n${currentContext}` : ""}
                `;
                
                // Execute RAG for this node
                // We treat this node as a mini-chat
                const stepResult = await ragEngine.chat({
                    sessionId: `${sessionId}_step_${stepCount}`, // Virtual session
                    text: stepPrompt,
                    contexts: [{ 
                        role: currentNode.role, 
                        folderPaths: currentNode.paths || [],
                        weight: 1.0 
                    }]
                });
                
                // Accumulate context
                currentContext += `\n\n--- Result from ${currentNode.role} ---\n${stepResult.text}`;
                finalResponse = stepResult.text; // The last node's output is the final answer?
                // Or maybe we should accumulate?
                // Let's keep the last one as "answer" but maybe append logic.
                
                sources.push(...(stepResult.sources || []));
                chunks.push(...(stepResult.chunks || []));
                
                // Find next nodes
                const nextEdges = edges.filter(e => e.source === currentNode.id);
                const nextNodes = nextEdges.map(e => nodes.find(n => n.id === e.target)).filter(Boolean);
                queue.push(...nextNodes);
            }
            
            // Return final combined result
            // Maybe summarize the whole chain?
            // For MVP, return the last step's answer, but appended with a summary if needed.
            // Actually, let's return the last step's text as the "Answer".
            
            return {
                text: finalResponse,
                sources: [...new Set(sources)], // Dedupe
                chunks: chunks
            };
            
        } else {
            // Standard Mode
            const response = await ragEngine.chat({ sessionId, text, contexts });
            return response;
        }
    } catch (e) {
        console.error("KB Chat Error:", e);
        return { text: `Error: ${e.message}`, sources: [] };
    }
});

ipcMain.handle('kb-delete-file-index', async (event, filePath) => {
    try {
        const vectorStore = require('./services/rag/vectorStore');
        
        // 1. Delete from Vector DB
        await vectorStore.deleteDocuments(filePath);
        
        // 2. Delete from Stats DB
        await dbManager.deleteFileStats([filePath]);
        
        writeLog(`Deleted index and stats for: ${filePath}`);
        return { success: true };
    } catch (e) {
        console.error("Delete Index Error:", e);
        return { success: false, error: e.message };
    }
});

ipcMain.handle('kb-get-file-chunks', async (event, { filePath, limit, offset, keyword }) => {
    try {
        const vectorStore = require('./services/rag/vectorStore');
        const result = await vectorStore.getChunksBySource(filePath, { limit, offset, keyword });
        return { success: true, ...result };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('kb-update-chunk', async (event, { filePath, oldText, newText }) => {
    try {
        const ragEngine = require('./services/rag/ragEngine');
        return await ragEngine.updateChunk(filePath, oldText, newText);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('kb-batch-ai-chunks', async (event, { filePath, chunks, instruction }) => {
    try {
        const ragEngine = require('./services/rag/ragEngine');
        return await ragEngine.batchRunAI(filePath, chunks, instruction);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('kb-generate-graph', async (event, filePaths) => {
    try {
        // Ensure RAG Engine is initialized (loads keys/config)
        // ragEngine is defined in outer scope
        await ragEngine.init();

        const vectorStore = require('./services/rag/vectorStore');
        const embeddingServiceModule = require('./services/rag/embedding');
        
        // 1. Gather Content (Chunks)
        let allChunks = [];
        for (const filePath of filePaths) {
            // Get all chunks (limit 50 per file to avoid context overflow?)
            // Or maybe summarize first?
            // For MVP, let's fetch top 20 chunks per file or all if small.
            const result = await vectorStore.getChunksBySource(filePath, { limit: 20 });
            if (result.chunks) {
                allChunks.push(...result.chunks.map(c => `[File: ${path.basename(filePath)}] ${c.text}`));
            }
        }

        if (allChunks.length === 0) {
            return { nodes: [], edges: [] };
        }

        // 2. LLM Analysis
        // We might need to split if too large, but for now assuming reasonable size.
        const context = allChunks.join('\n\n').substring(0, 100000); // Limit context length
        
        const prompt = `
        基于以下文档片段，构建一个知识图谱。
        
        文档内容:
        ${context}
        
        请提取关键实体（概念、人物、组织、事件）作为节点，提取实体之间的关系作为边。
        
        返回 JSON 格式:
        {
            "nodes": [{ "id": "entity_name", "label": "entity_name", "type": "concept" }],
            "edges": [{ "source": "entity_name_1", "target": "entity_name_2", "label": "relation_description" }]
        }
        
        只返回 JSON。节点 ID 必须唯一。
        `;

        const response = await embeddingServiceModule.completion(prompt);
        let jsonStr = '';
        if (typeof response === 'string') {
            jsonStr = response;
        } else if (response && typeof response.text === 'string') {
            jsonStr = response.text;
        } else {
            throw new Error('LLM 无响应');
        }
        jsonStr = jsonStr.replace(/```json/g, '').replace(/```/g, '').trim();
        
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error("Graph Gen Error:", e);
        return { nodes: [], edges: [], error: e.message };
    }
});

ipcMain.handle('kb-delete-chunk', async (event, { filePath, text }) => {
    try {
        const vectorStore = require('./services/rag/vectorStore');
        const success = await vectorStore.deleteChunk(filePath, text);
        return { success };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// New IPCs for Stats Manager
ipcMain.handle('kb-get-stats', async () => {
    try {
        const stats = await dbManager.getFileStats();
        const vectorStore = require('./services/rag/vectorStore');
        const chunkCounts = await vectorStore.getChunkCounts();
        
        // Merge
        return stats.map(s => {
            // Normalize file path for lookup (must match vectorStore normalization)
            // Use lowercase to handle Windows case-insensitivity issues
            const normPath = s.file_path.replace(/\\/g, '/').toLowerCase();
            const count = chunkCounts[normPath] || 0;
            
            // Debug log for first few "unindexed" items to help diagnose path mismatch
            if (count === 0 && Math.random() < 0.05) {
                 // console.log(`[Main] DEBUG: No chunks found for ${s.file_path} (Norm: ${normPath}). Available keys sample: ${Object.keys(chunkCounts).slice(0,3).join(', ')}`);
            }

            return {
                ...s,
                chunk_count: count
            };
        });
    } catch (e) {
        console.error("Get Stats Error:", e);
        return [];
    }
});

ipcMain.handle('kb-update-status', async (event, { filePath, status, weight }) => {
    return dbManager.updateFileStats(filePath, { 
        status: status,
        weight_factor: weight
    });
});

ipcMain.handle('kb-batch-delete', async (event, filePaths) => {
    try {
        const vectorStore = require('./services/rag/vectorStore');
        
        // Parallel delete from Vector DB
        // vectorStore.deleteDocuments takes single path, loop it
        // Optimally, vectorStore should support batch delete via "source IN (...)"
        // But for now loop is fine for UI actions (<100 files)
        for (const p of filePaths) {
            await vectorStore.deleteDocuments(p);
        }
        
        // Batch delete from Stats
        await dbManager.deleteFileStats(filePaths);

        // Remove from kb_ingested_files setting to prevent resurrection
        try {
            const current = await dbManager.getSetting('kb_ingested_files') || [];
            if (Array.isArray(current)) {
                const next = current.filter(p => !filePaths.includes(p));
                if (next.length !== current.length) {
                    await dbManager.saveSetting('kb_ingested_files', next);
                }
            }
        } catch (err) {
            console.warn(`[Main] Failed to update kb_ingested_files for batch delete: ${err.message}`);
        }
        
        return { success: true };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('kb-ai-analyze-stats', async (event, stats) => {
    // Basic AI Analysis
    // We construct a prompt with the JSON stats
    try {
        const prompt = `
        作为知识库管理员，请分析以下文件使用情况数据，并给出清理或优化建议。
        
        数据字段说明：
        - ref_count: 被引用/检索次数（热度）
        - last_ref_time: 最后被检索时间戳
        - ingest_time: 入库时间戳
        
        当前时间戳: ${Date.now()}
        
        文件列表 (Top 50 samples):
        ${JSON.stringify(stats.slice(0, 50))}
        
        请输出 JSON 格式建议：
        {
            "summary": "简短总结",
            "deprecated_candidates": ["path1", "path2"], // 建议删除的冷门文件（长期无引用）
            "highlight_candidates": ["path3"], // 建议关注的热门文件
            "reasoning": "分析理由"
        }
        只返回 JSON。
        `;
        
        const embeddingServiceModule = require('./services/rag/embedding');
        
        const response = await embeddingServiceModule.completion(prompt);
        // Clean markdown code blocks if any
        const jsonStr = response.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(jsonStr);
    } catch (e) {
        return { error: e.message };
    }
});

ipcMain.handle('kb-ai-analyze-file', async (event, { filePath, content, stats }) => {
    try {
        const prompt = `
        作为知识库助手，请分析以下特定文件的使用情况和内容，并给出优化建议。
        
        文件路径: ${filePath}
        使用统计:
        - 被引用次数: ${stats.ref_count}
        - 上次使用: ${stats.last_ref_time ? new Date(stats.last_ref_time).toLocaleString() : '从未使用'}
        - 当前状态: ${stats.status}
        - 权重系数: ${stats.weight_factor}
        
        文件内容摘要:
        ${content.substring(0, 2000)}...
        
        用户问题: "这个文件是否有必要调整？比如加权、降权、添加标签或删除？"
        
        请给出简短的分析和建议（建议格式：保留/删除/加权/降权/加标签），并说明理由。
        `;
        
        const embeddingServiceModule = require('./services/rag/embedding');
        const response = await embeddingServiceModule.completion(prompt);
        return { result: response };
    } catch (e) {
        return { error: e.message };
    }
});

// REMOVED DUPLICATE ipcMain.handle('kb-upload-file')
// This handler is now defined earlier in the file (around line 764)
// to support proper queue management and index cleaning.

// --- Proxy Request IPC (Bypass CORS) ---
ipcMain.handle('proxy-request', async (event, { url, options }) => {
    try {
        const rawUrl = String(url || '').trim();
        if (!rawUrl) return { ok: false, error: 'url required' };
        let u;
        try {
            u = new URL(rawUrl);
        } catch (e) {
            return { ok: false, error: 'invalid url' };
        }
        const protocol = String(u.protocol || '').toLowerCase();
        if (protocol !== 'https:' && protocol !== 'http:') {
            return { ok: false, error: 'unsupported protocol' };
        }
        if (protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(String(u.hostname || '').toLowerCase())) {
            return { ok: false, error: 'http only allowed for localhost' };
        }

        const method = String(options?.method || 'GET').toUpperCase();
        if (!['GET', 'POST'].includes(method)) {
            return { ok: false, error: 'method not allowed' };
        }

        const hostname = String(u.hostname || '').toLowerCase();
        const allowRaw = await dbManager.getSetting('network_allowlist');
        const allowlist = Array.isArray(allowRaw) ? allowRaw.map((x) => String(x || '').toLowerCase()).filter(Boolean) : [];

        const isAllowed = allowlist.includes(hostname) || allowlist.some((d) => d.startsWith('*.') && hostname.endsWith(d.slice(1)));
        if (!isAllowed) {
            const r = await dialog.showMessageBox(mainWindow || undefined, {
                type: 'warning',
                buttons: ['仅本次允许', '加入白名单并允许', '拒绝'],
                defaultId: 2,
                cancelId: 2,
                noLink: true,
                message: '联网访问确认',
                detail: `请求访问：${u.origin}\n\n该域名不在白名单中。是否允许？`
            });
            if (r.response === 2) return { ok: false, error: 'user_denied' };
            if (r.response === 1) {
                await dbManager.saveSetting('network_allowlist', Array.from(new Set([...allowlist, hostname])));
            }
        }

        const safeHeaders = {};
        const inputHeaders = options?.headers && typeof options.headers === 'object' ? options.headers : {};
        for (const [k0, v0] of Object.entries(inputHeaders)) {
            const k = String(k0 || '').toLowerCase();
            if (!k) continue;
            if (k === 'authorization' || k === 'cookie' || k === 'proxy-authorization') continue;
            if (k.startsWith('sec-')) continue;
            safeHeaders[k0] = v0;
        }

        const fetchOptions = {
            method,
            headers: safeHeaders,
            body: method === 'POST' ? (options?.body ?? undefined) : undefined
        };

        const response = await fetch(u.toString(), fetchOptions);
        
        // Serialize Headers
        const headers = {};
        response.headers.forEach((val, key) => headers[key] = val);

        const contentType = headers['content-type'] || '';
        let data;
        
        if (contentType.includes('application/json') || contentType.includes('text/')) {
            data = await response.text();
        } else {
             // Binary data -> Base64
             const arrayBuffer = await response.arrayBuffer();
             data = Buffer.from(arrayBuffer).toString('base64');
             headers['x-is-binary'] = 'true';
        }

        return {
            ok: response.ok,
            status: response.status,
            statusText: response.statusText,
            headers,
            data
        };
    } catch (e) {
        console.error(`[Proxy] Error: ${e.message}`);
        return { ok: false, error: e.message };
    }
});

ipcMain.handle('agent-policy-get', async () => {
    try {
        const svc = require('./services/agentApprovalService');
        const policy = await svc.getPolicy();
        return { success: true, policy };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('agent-policy-set', async (event, next) => {
    try {
        const svc = require('./services/agentApprovalService');
        const policy = await svc.setPolicy(next);
        return { success: true, policy };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('agent-approvals-list', async (event, params) => {
    try {
        const svc = require('./services/agentApprovalService');
        const list = await svc.listApprovals(params || {});
        return { success: true, approvals: list };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('agent-approvals-decide', async (event, payload) => {
    try {
        const svc = require('./services/agentApprovalService');
        const id = payload && typeof payload.id === 'string' ? payload.id : '';
        const decision = payload && typeof payload.decision === 'string' ? payload.decision : '';
        const grantScopeKey = payload && typeof payload.grantScopeKey === 'string' ? payload.grantScopeKey : '';
        const grantTtlMs = payload && Number.isFinite(Number(payload.grantTtlMs)) ? Number(payload.grantTtlMs) : undefined;
        const res = await svc.decide({ id, decision, grantScopeKey, grantTtlMs });
        return res;
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('app-get-path', async (event, name) => {
    return app.getPath(name);
});

ipcMain.handle('clipboard-read-text', async () => {
    return clipboard.readText();
});

ipcMain.handle('clipboard-write-text', async (event, text) => {
    clipboard.writeText(text);
    return true;
});

// --- Crawler IPC ---
ipcMain.handle('crawler-open', async (event, url) => {
    try {
        if (crawlerService) {
            await crawlerService.startSession(url);
            return true;
        }
        console.error("Crawler service not initialized");
        return false;
    } catch (e) {
        console.error("Crawler Open Error:", e);
        return false;
    }
});

ipcMain.handle('crawler-start', async () => {
    if (crawlerService) return crawlerService.startCrawlTask();
    return { success: false, message: "Service not init" };
});

ipcMain.handle('crawler-stop', async () => {
    if (crawlerService) crawlerService.stopCrawl();
    return true;
});

ipcMain.handle('project-intel-create-run', async (event, params) => {
    try {
        if (!projectIntelService) return { success: false, error: 'Service not initialized' };
        return await projectIntelService.createRun(params || {});
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('project-intel-list-runs', async (event, limit) => {
    try {
        if (!projectIntelService) return { success: false, error: 'Service not initialized' };
        return await projectIntelService.listRuns(limit);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('project-intel-get-run', async (event, runId) => {
    try {
        if (!projectIntelService) return { success: false, error: 'Service not initialized' };
        return await projectIntelService.getRun(runId);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('project-intel-delete-run', async (event, runId) => {
    try {
        if (!projectIntelService) return { success: false, error: 'Service not initialized' };
        return await projectIntelService.deleteRun(runId);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('project-intel-list-items', async (event, runId) => {
    try {
        if (!projectIntelService) return { success: false, error: 'Service not initialized' };
        return await projectIntelService.listItems(runId);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('project-intel-update-item', async (event, { itemId, updates }) => {
    try {
        if (!projectIntelService) return { success: false, error: 'Service not initialized' };
        return await projectIntelService.updateItem(itemId, updates || {});
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('project-intel-open-browser', async (event, params) => {
    try {
        if (!projectIntelService) return { success: false, error: 'Service not initialized' };
        return await projectIntelService.openBrowser(params || {});
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('project-intel-plan', async (event, params) => {
    try {
        if (!projectIntelService) return { success: false, error: 'Service not initialized' };
        return await projectIntelService.planTask(params || {});
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('project-intel-start-run', async (event, { runId, params }) => {
    try {
        if (!projectIntelService) return { success: false, error: 'Service not initialized' };
        return await projectIntelService.startRun(runId, params || {});
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('project-intel-stop-run', async (event, runId) => {
    try {
        if (!projectIntelService) return { success: false, error: 'Service not initialized' };
        return projectIntelService.stopRun(runId);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('project-intel-save-selection', async (event, payload) => {
    try {
        if (!projectIntelService) return { success: false, error: 'Service not initialized' };
        return await projectIntelService.saveSelection(payload || {});
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('project-intel-reading-start', async (event, params) => {
    try {
        if (!projectIntelService) return { success: false, error: 'Service not initialized' };
        return await projectIntelService.startReadingTracking(params || {});
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('project-intel-reading-stop', async (event, runId) => {
    try {
        if (!projectIntelService) return { success: false, error: 'Service not initialized' };
        return await projectIntelService.stopReadingTracking(runId);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('project-intel-list-highlights', async (event, runId) => {
    try {
        if (!projectIntelService) return { success: false, error: 'Service not initialized' };
        return await projectIntelService.listHighlights(runId);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('project-intel-list-ocr-frames', async (event, runId) => {
    try {
        if (!projectIntelService) return { success: false, error: 'Service not initialized' };
        return await projectIntelService.listOcrFrames(runId);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('project-intel-export-run', async (event, runId) => {
    try {
        if (!projectIntelService) return { success: false, error: 'Service not initialized' };
        return await projectIntelService.exportRun(runId);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// --- PDF Export IPC ---
ipcMain.handle('print-to-pdf', async (event, { title }) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender);
        if (!win) return { success: false, error: "Window not found" };

        const { filePath } = await dialog.showSaveDialog(win, {
            title: '导出 PDF',
            defaultPath: `${title || 'export'}.pdf`,
            filters: [{ name: 'PDF Document', extensions: ['pdf'] }]
        });

        if (!filePath) return { success: false, canceled: true };

        const data = await win.webContents.printToPDF({
            printBackground: true,
            pageSize: 'A4',
            margins: { top: 1, bottom: 1, left: 1, right: 1 } // Minimal margins
        });

        fs.writeFileSync(filePath, data);
        return { success: true, filePath };
    } catch (e) {
        console.error("PDF Export Error:", e);
        return { success: false, error: e.message };
    }
});

// --- Word Export IPC ---
ipcMain.handle('export-to-word', async (event, { title, htmlContent }) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const { filePath } = await dialog.showSaveDialog(win, {
            title: '导出 Word',
            defaultPath: `${title || 'export'}.docx`,
            filters: [{ name: 'Word Document', extensions: ['docx'] }]
        });

        if (!filePath) return { success: false, canceled: true };

        const fileBuffer = await HTMLtoDOCX(htmlContent, null, {
            table: { row: { cantSplit: true } },
            footer: true,
            pageNumber: true,
        });

        fs.writeFileSync(filePath, fileBuffer);
        return { success: true, filePath };
    } catch (e) {
        console.error("Word Export Error:", e);
        return { success: false, error: e.message };
    }
});

// --- Excel Export IPC ---
ipcMain.handle('export-to-excel', async (event, { title, csvContent }) => {
    try {
        const win = BrowserWindow.fromWebContents(event.sender);
        const { filePath } = await dialog.showSaveDialog(win, {
            title: '导出 Excel',
            defaultPath: `${title || 'export'}.xlsx`,
            filters: [{ name: 'Excel Spreadsheet', extensions: ['xlsx'] }]
        });

        if (!filePath) return { success: false, canceled: true };

        // Parse CSV to Workbook
        const workbook = XLSX.read(csvContent, { type: 'string' });
        
        // Write to file
        XLSX.writeFile(workbook, filePath);
        
        return { success: true, filePath };
    } catch (e) {
        console.error("Excel Export Error:", e);
        return { success: false, error: e.message };
    }
});

// --- Reading Mode & DB IPC ---
ipcMain.handle('db:create-reading-project', async (event, { id, purpose }) => dbManager.createReadingProject(id, purpose));
ipcMain.handle('db:get-reading-projects', async () => dbManager.getReadingProjects());
ipcMain.handle('db:create-reading-session', async (event, { id, projectId, filePath }) => dbManager.createReadingSession(id, projectId, filePath));
ipcMain.handle('db:get-reading-sessions', async (event, projectId) => dbManager.getReadingSessions(projectId));
ipcMain.handle('db:create-knowledge-card', async (event, card) => {
    const res = await dbManager.createKnowledgeCard(card);
    if (res.success) {
        ragEngine.indexCard(card).catch(e => console.error("Card Indexing Failed:", e));
    }
    return res;
});
ipcMain.handle('db:get-knowledge-cards', async (event, sessionId) => dbManager.getKnowledgeCards(sessionId));
ipcMain.handle('db:update-knowledge-card', async (event, { id, updates }) => {
    const res = await dbManager.updateKnowledgeCard(id, updates);
    if (res.success && res.card) {
        ragEngine.indexCard(res.card).catch(e => console.error("Card Re-Indexing Failed:", e));
    }
    return res;
});
ipcMain.handle('db:delete-knowledge-card', async (event, id) => {
    const res = await dbManager.deleteKnowledgeCard(id);
    if (res.success) {
        ragEngine.deleteCard(id).catch(e => console.error("Card De-Indexing Failed:", e));
    }
    return res;
});
ipcMain.handle('db:save-reading-summary', async (event, summary) => dbManager.saveReadingSummary(summary));
ipcMain.handle('db:get-reading-summary', async (event, targetId) => dbManager.getReadingSummary(targetId));

// --- Planner Context IPC ---
ipcMain.handle('planner-context-get', async (event, eventId) => {
    return await dbManager.getPlannerEventContext(eventId);
});

ipcMain.handle('planner-context-upsert', async (event, { eventId, config }) => {
    return await dbManager.upsertPlannerEventContext(eventId, config);
});

ipcMain.handle('planner-context-delete', async (event, eventId) => {
    return await dbManager.deletePlannerEventContext(eventId);
});

ipcMain.handle('planner-context-save-reference-pack', async (event, { eventIds, title, markdown, packId }) => {
    try {
        const safePackId = String(packId || `pack-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`).replace(/[^a-zA-Z0-9._-]/g, '_');
        const baseDir = path.join(userDataPath, 'storage', 'DATA', 'Knowledge', 'PlanningContext', safePackId);
        if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });

        const safeTitle = String(title || 'reference').slice(0, 80).replace(/[^a-zA-Z0-9\u4e00-\u9fa5._-]/g, '_');
        const filePath = path.join(baseDir, `${safeTitle}.md`);
        fs.writeFileSync(filePath, String(markdown || ''), 'utf8');

        if (!ingestionQueue) {
            ingestionQueue = new IngestionQueue(ragEngine, mainWindow?.webContents);
        }
        ingestionQueue.addFile({ path: filePath, name: path.basename(filePath), size: 0, lastModified: Date.now(), options: {} });

        const targets = Array.isArray(eventIds) ? eventIds.filter(Boolean) : [];
        for (const eventId of targets) {
            const current = await dbManager.getPlannerEventContext(eventId);
            const nextConfig = current?.config && typeof current.config === 'object' ? current.config : {};
            const nextScopes = Array.isArray(nextConfig.kbScopes) ? nextConfig.kbScopes.slice() : [];
            if (!nextScopes.includes(baseDir)) nextScopes.push(baseDir);
            nextConfig.kbScopes = nextScopes;

            const packs = Array.isArray(nextConfig.referencePacks) ? nextConfig.referencePacks.slice() : [];
            if (!packs.some(p => p?.packId === safePackId)) {
                packs.push({ packId: safePackId, folderPath: baseDir, filePath, title: safeTitle, createdAt: Date.now() });
            }
            nextConfig.referencePacks = packs;
            await dbManager.upsertPlannerEventContext(eventId, nextConfig);
        }

        return { success: true, packId: safePackId, folderPath: baseDir, filePath };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// --- KB Chat History IPC ---
ipcMain.handle('db:save-chat-message', async (event, msg) => dbManager.saveChatMessage(msg));
ipcMain.handle('db:get-chat-history', async (event, assistantId) => dbManager.getChatHistory(assistantId));
ipcMain.handle('db:clear-chat-history', async (event, assistantId) => dbManager.clearChatHistory(assistantId));

// --- Graph-Lite API ---
ipcMain.handle('db-get-graph-data', async () => {
    return await dbManager.getGraphData();
});

ipcMain.handle('db-save-graph-snapshot', async (event, graph) => {
    return await dbManager.saveGraphSnapshot(graph);
});

ipcMain.handle('db-get-saved-graphs', async () => {
    return await dbManager.getSavedGraphs();
});

ipcMain.handle('db-delete-saved-graph', async (event, id) => {
    return await dbManager.deleteSavedGraph(id);
});

// Re-add fs-read-buffer which was accidentally removed in search block
ipcMain.handle('fs-read-buffer', async (event, filePath) => {
    try {
        // Basic security check
        if (!isSafePath(filePath)) return { success: false, error: "Access denied" };
        
        // Resolve .lnk if needed
        let targetPath = filePath;
        try {
            if (process.platform === 'win32' && filePath.toLowerCase().endsWith('.lnk')) {
                const { execSync } = require('child_process');
                const command = `powershell.exe -noprofile -command "$sh=New-Object -ComObject WScript.Shell;$lnk=$sh.CreateShortcut('${filePath}');$lnk.TargetPath"`;
                const resolved = execSync(command, { encoding: 'utf8' }).trim();
                if (resolved) targetPath = resolved;
            }
        } catch(e) {}

        const buffer = fs.readFileSync(targetPath);
        return { success: true, data: buffer };
    } catch (e) {
        return { success: false, error: e.message };
    }
});

// --- Cloud Sync IPC ---
ipcMain.handle('cloud-sync-start', async (event, { localPath, cloudType, targetPath }) => {
    try {
        const { syncFolderToCloud } = require('./services/cloudSync/cloudFolderSync');
        // dbManager is already required at top level
        const config = await dbManager.getCloudSyncConfig(cloudType);
        if (!config || !config.is_enabled) throw new Error('Cloud sync disabled or not configured');
        
        // Use provided targetPath or fallback to config
        const finalTarget = targetPath || config.target_folder;
        if (!finalTarget) throw new Error('Target folder not configured');

        return await syncFolderToCloud(localPath, cloudType, config, finalTarget);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('cloud-sync-pull', async (event, { localPath, cloudType, targetPath }) => {
    try {
        const { syncCloudToLocal } = require('./services/cloudSync/cloudFolderSync');
        const config = await dbManager.getCloudSyncConfig(cloudType);
        if (!config || !config.is_enabled) throw new Error('Cloud sync disabled or not configured');

        const finalTarget = targetPath || config.target_folder;
        if (!finalTarget) throw new Error('Target folder not configured');

        return await syncCloudToLocal(localPath, cloudType, config, finalTarget);
    } catch (e) {
        return { success: false, error: e.message };
    }
});

ipcMain.handle('cloud-sync-get-config', async (event, type) => {
    return await dbManager.getCloudSyncConfig(type);
});

ipcMain.handle('cloud-sync-save-config', async (event, { type, config }) => {
    // Encrypt token if provided
    if (config.token) {
        const { encryptToken } = require('./utils/cryptoUtils');
        const { encrypted, iv } = encryptToken(config.token);
        config.encrypted_token = encrypted;
        config.iv = iv;
        delete config.token; // Don't save plain token
    }
    
    // Encrypt encryption_password if provided
    if (config.encryption_password) {
        const { encryptToken } = require('./utils/cryptoUtils');
        const { encrypted, iv } = encryptToken(config.encryption_password);
        config.encryption_password = encrypted;
        config.encryption_iv = iv;
    }
    
    return await dbManager.updateCloudSyncConfig(type, config);
});

app.whenReady().then(async () => {
  console.log('[Main] App Ready. Initializing Database...');
  dbManager.init(); // Explicitly initialize DB now
  dbManager.upsertKbFolderMeta({ folder_id: 'internal://reading', folder_path: null, source_type: 'reading_space', origin_path: null, is_external_reference: 0, created_at: Date.now(), extra_json: {} });
  dbManager.upsertKbFolderMeta({ folder_id: 'internal://graphs', folder_path: null, source_type: 'knowledge_graph', origin_path: null, is_external_reference: 0, created_at: Date.now(), extra_json: {} });
  dbManager.upsertKbFolderMeta({ folder_id: 'internal://chat_history', folder_path: null, source_type: 'chat_history', origin_path: null, is_external_reference: 0, created_at: Date.now(), extra_json: {} });
  try { await pluginManager.init(); } catch (e) {}
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

let _quitting = false;

app.on('before-quit', async (e) => {
  if (_quitting) return;
  _quitting = true;
  try {
    e.preventDefault();
  } catch (err) {}

  try { claudeCodeService.killAll(); } catch (err) {}
  try { await openclawService.stopBridge(); } catch (err) {}
  try { await openclawService.stopGateway(); } catch (err) {}

  try {
    app.exit(0);
  } catch (err) {
    try { app.quit(); } catch (err2) {}
  }
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
