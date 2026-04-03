const { BrowserWindow, BrowserView, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const OcrQueue = require('./ocrQueue');

const DEFAULT_SAFE_LIMITS = {
  maxUrls: 50,
  maxTextChars: 200000,
  minDelayMs: 1200,
  maxDelayMs: 2800,
  pageLoadTimeoutMs: 20000
};
const BROWSER_BOOKMARKS_KEY = 'project_intel_browser_bookmarks';
const BROWSER_HISTORY_KEY = 'project_intel_browser_history';

const clampNumber = (v, min, max, fallback) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
};

const safeParseJson = (value, fallback) => {
  try {
    if (value === null || value === undefined) return fallback;
    if (typeof value === 'object') return value;
    return JSON.parse(String(value));
  } catch (e) {
    return fallback;
  }
};

const stripCodeFences = (s) => {
  const text = String(s || '');
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) return fence[1].trim();
  return text.trim();
};

const extractFirstJsonObject = (s) => {
  const text = String(s || '');
  let start = -1;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\') {
      if (inString) escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      if (depth > 0) depth--;
      if (depth === 0 && start >= 0) return text.slice(start, i + 1);
    }
  }
  return null;
};

const parseJsonFromLlmText = (raw) => {
  const cleaned = stripCodeFences(raw);
  const direct = safeParseJson(cleaned, null);
  if (direct && typeof direct === 'object') return { ok: true, json: direct };
  const extracted = extractFirstJsonObject(cleaned);
  if (!extracted) return { ok: false, json: null, extracted: null };
  const parsed = safeParseJson(extracted, null);
  if (parsed && typeof parsed === 'object') return { ok: true, json: parsed };
  return { ok: false, json: null, extracted };
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const escapeHtml = (s) =>
  String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const toCsvCell = (v) => {
  const s = String(v ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
};

const tryNormalizeUrl = (raw) => {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return null;
  if (s === 'https://' || s === 'http://') return null;
  try {
    const u = new URL(s);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.toString();
  } catch (e) {
    return null;
  }
};

const toDataUrl = (html) => `data:text/html;charset=utf-8,${encodeURIComponent(String(html || ''))}`;

const renderInfoPage = ({ title, lines }) => {
  const items = Array.isArray(lines) ? lines.filter(Boolean) : [];
  const list = items.map((x) => `<li style="margin:6px 0;line-height:1.55">${escapeHtml(x)}</li>`).join('');
  return `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>${escapeHtml(title || '项目情报浏览器')}</title>
  </head>
  <body style="margin:0;background:#0b1220;color:#e2e8f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif">
    <div style="max-width:920px;margin:0 auto;padding:26px 22px">
      <div style="font-size:18px;font-weight:900">${escapeHtml(title || '项目情报浏览器')}</div>
      <div style="margin-top:10px;background:#111a2e;border:1px solid rgba(148,163,184,0.25);border-radius:16px;padding:14px 16px">
        <ul style="margin:0;padding-left:18px;color:#cbd5e1;font-size:13px">${list}</ul>
      </div>
    </div>
  </body>
</html>
  `.trim();
};

class ProjectIntelService {
  constructor(mainWindow, dbManager, storageManager, ragEngine) {
    this.mainWindow = mainWindow;
    this.dbManager = dbManager;
    this.storageManager = storageManager;
    this.ragEngine = ragEngine;

    this.browserWindow = null;
    this.browserView = null;
    this.browserViewAttached = false;
    this.browserMode = null;
    this.abortRun = null;
    this.currentRunId = null;
    this.pending = null;
    this.readingTracker = null;
    this.ocrQueue = new OcrQueue({ langPath: this._getTessdataPath(), langs: 'chi_sim+eng' });
  }

  _send(eventName, payload) {
    try {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
      this.mainWindow.webContents.send(eventName, payload);
    } catch (e) {}
  }

  _getOutputBaseDir() {
    return path.join(app.getPath('userData'), 'storage', 'KB_PROJECT_INTEL');
  }

  async _ensureRunDir(runId) {
    const dir = path.join(this._getOutputBaseDir(), runId);
    await fs.promises.mkdir(dir, { recursive: true });
    return dir;
  }

  _getTessdataPath() {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'tessdata');
    }
    return path.join(__dirname, '../../../resources/tessdata');
  }

  async createRun(params) {
    const runId = uuidv4();
    const now = Date.now();
    const outputDir = await this._ensureRunDir(runId);

    const mode = params.mode || 'web_list';
    const urls = Array.isArray(params.urls) ? params.urls.slice(0, DEFAULT_SAFE_LIMITS.maxUrls) : [];
    const keywords = Array.isArray(params.keywords) ? params.keywords.slice(0, 20) : [];

    const res = await this.dbManager.createProjectIntelRun({
      id: runId,
      mode,
      user_query: params.userQuery || '',
      urls,
      keywords,
      plan: params.plan || {},
      status: 'created',
      output_dir: outputDir,
      created_at: now,
      updated_at: now
    });

    if (!res.success) return res;
    return { success: true, runId, outputDir };
  }

  async listRuns(limit) {
    const runs = await this.dbManager.listProjectIntelRuns(limit || 50);
    return { success: true, runs };
  }

  async getRun(runId) {
    const run = await this.dbManager.getProjectIntelRun(runId);
    if (!run) return { success: false, error: 'Run not found' };
    return { success: true, run };
  }

  async deleteRun(runId) {
    const run = await this.dbManager.getProjectIntelRun(runId);
    if (run && run.output_dir) {
      try {
        await fs.promises.rm(run.output_dir, { recursive: true, force: true });
      } catch (e) {}
    }
    return await this.dbManager.deleteProjectIntelRun(runId);
  }

  async listItems(runId) {
    const items = await this.dbManager.listProjectIntelItems(runId);
    return { success: true, items };
  }

  async updateItem(itemId, updates) {
    return await this.dbManager.updateProjectIntelItem(itemId, updates || {});
  }

  async openBrowser({ url, runId, title, sessionScope } = {}) {
    const embed = !((sessionScope || '').toLowerCase() === 'window_only');
    const bounds = arguments[0] && arguments[0].bounds ? arguments[0].bounds : null;
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      if (embed && this.browserMode === 'window') {
        try {
          if (typeof this.browserWindow.close === 'function') this.browserWindow.close();
        } catch (e) {}
        this.browserWindow = null;
        this.browserMode = null;
      } else if (!embed && this.browserMode === 'embed') {
        this.hideEmbeddedBrowser();
        this.browserWindow = null;
        this.browserMode = null;
      }
    }
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      if (url) {
        try {
          const norm = tryNormalizeUrl(url);
          if (norm) await this.browserWindow.loadURL(norm);
        } catch (e) {}
      }
      this.browserWindow.focus();
      if (embed) this._applyEmbeddedBounds(bounds);
      return { success: true };
    }

    this.currentRunId = runId || null;
    const scope = String(sessionScope || '').trim().toLowerCase();
    const normForHost = tryNormalizeUrl(url);
    const host = (() => {
      try {
        return normForHost ? new URL(normForHost).hostname : '';
      } catch (e) {
        return '';
      }
    })();
    const partition =
      scope === 'run' && runId
        ? `persist:project-intel:${runId}`
        : scope === 'site' && host
          ? `persist:project-intel:site:${host}`
          : 'persist:project-intel';
    if (embed && this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.browserView) {
        try {
          if (this.browserViewAttached) this.mainWindow.setBrowserView(null);
        } catch (e) {}
        try {
          if (this.browserView.webContents && !this.browserView.webContents.isDestroyed()) this.browserView.webContents.destroy();
        } catch (e) {}
        this.browserView = null;
        this.browserViewAttached = false;
      }
      this.browserView = new BrowserView({
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          partition,
          preload: path.join(__dirname, 'preloadProjectIntelBrowser.js')
        }
      });
      try {
        this.mainWindow.setBrowserView(this.browserView);
        this.browserViewAttached = true;
        this.browserView.setBounds({ x: 0, y: 0, width: 1, height: 1 });
        this.browserView.setAutoResize({ width: false, height: false });
      } catch (e) {
        this.browserView = null;
      }
      if (this.browserView) {
        const wc = this.browserView.webContents;
        this._bindBrowserEvents(wc);
        this.browserMode = 'embed';
        this.browserWindow = {
          isDestroyed: () => !this.browserView || this.browserView.webContents.isDestroyed(),
          loadURL: (u) => wc.loadURL(u),
          focus: () => {
            try {
              if (this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.focus();
            } catch (e) {}
          },
          webContents: wc
        };
      }
    }

    if (!this.browserWindow && embed) {
      this._send('project-intel:update', {
        type: 'browser_embed_fail',
        runId: this.currentRunId,
        error: '无法创建内嵌浏览窗口'
      });
      return { success: false, error: 'Failed to create embedded browser view' };
    }

    if (!this.browserWindow) {
      this.browserWindow = new BrowserWindow({
      width: 1200,
      height: 860,
      title: title || '项目情报浏览器',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
        partition,
        preload: path.join(__dirname, 'preloadProjectIntelBrowser.js')
      }
    });

      this.browserWindow.on('closed', () => {
        this.browserWindow = null;
        this.browserMode = null;
        this._send('project-intel:update', { type: 'browser_closed', runId: this.currentRunId });
      });
      this._bindBrowserEvents(this.browserWindow.webContents);
      this.browserMode = 'window';
    }

    if (url) {
      try {
        const norm = tryNormalizeUrl(url);
        if (!norm) {
          const html = renderInfoPage({
            title: '项目情报浏览器',
            lines: ['未提供有效网址，或网址不完整。', '请返回工作台：填写完整 URL（例如 https://example.com），再点击“打开浏览器”或“创建并执行”。'],
          });
          await this.browserWindow.loadURL(toDataUrl(html));
          return { success: true };
        }
        await this.browserWindow.loadURL(norm);
      } catch (e) {
        try {
          const html = renderInfoPage({
            title: '项目情报浏览器',
            lines: [`无法打开 URL：${String(url || '')}`, `错误：${e.message || ''}`],
          });
          await this.browserWindow.loadURL(toDataUrl(html));
        } catch (e2) {}
        return { success: false, error: e.message };
      }
    } else {
      try {
        const html = renderInfoPage({
          title: '项目情报浏览器',
          lines: ['浏览器已启动。', '请在工作台点击“打开浏览器”进入目标页面，或直接“创建并执行”开始自动检索。'],
        });
        await this.browserWindow.loadURL(toDataUrl(html));
      } catch (e) {}
    }

    return { success: true };
  }

  _bindBrowserEvents(webContents) {
    if (!webContents || webContents.isDestroyed()) return;
    try {
      webContents.setWindowOpenHandler(({ url }) => {
        try {
          if (url) {
            setTimeout(() => {
              try {
                if (this.browserWindow && !this.browserWindow.isDestroyed()) {
                  this.browserWindow.webContents.loadURL(url);
                }
              } catch (e) {}
            }, 0);
          }
        } catch (e) {}
        return { action: 'deny' };
      });
    } catch (e) {}
    webContents.on('did-start-loading', () => {
      const u = this.browserWindow && !this.browserWindow.isDestroyed() ? this.browserWindow.webContents.getURL() : '';
      this._send('project-intel:update', { type: 'browser_loading', runId: this.currentRunId, url: u });
    });
    webContents.on('did-stop-loading', () => {
      const u = this.browserWindow && !this.browserWindow.isDestroyed() ? this.browserWindow.webContents.getURL() : '';
      this._send('project-intel:update', { type: 'browser_stopped', runId: this.currentRunId, url: u });
    });
    webContents.on('did-finish-load', async () => {
      const currentUrl = this.browserWindow && !this.browserWindow.isDestroyed() ? this.browserWindow.webContents.getURL() : '';
      const title = (() => {
        try {
          return webContents.getTitle() || '';
        } catch (e) {
          return '';
        }
      })();
      this._send('project-intel:update', { type: 'browser_loaded', runId: this.currentRunId, url: currentUrl });
      this._recordBrowserHistory(currentUrl, title).catch(() => {});
      try {
        await this._injectSelectionTracker();
      } catch (e) {}
    });
    webContents.on('did-fail-load', async (_event, errorCode, errorDescription, validatedURL) => {
      if (Number(errorCode) === -3) {
        this._send('project-intel:update', {
          type: 'browser_loading_interrupted',
          runId: this.currentRunId,
          errorCode,
          errorDescription,
          url: validatedURL
        });
        return;
      }
      this._send('project-intel:update', {
        type: 'browser_fail',
        runId: this.currentRunId,
        errorCode,
        errorDescription,
        url: validatedURL
      });
      try {
        if (this.browserWindow && !this.browserWindow.isDestroyed()) {
          const html = renderInfoPage({
            title: '页面加载失败',
            lines: [
              `URL：${validatedURL || ''}`,
              `错误：${errorCode} ${errorDescription || ''}`,
              '可能原因：网址不完整/被目标站点拦截/网络不可用/证书或代理问题。',
              '建议：先用“打开浏览器”进入目标站点确认可访问；如需登录，完成登录后再执行。'
            ],
          });
          await this.browserWindow.loadURL(toDataUrl(html));
        }
      } catch (e) {}
    });
    webContents.on('did-navigate', (_event, navigatedUrl) => {
      this._send('project-intel:update', { type: 'browser_navigate', runId: this.currentRunId, url: navigatedUrl });
    });
    webContents.on('did-navigate-in-page', (_event, navigatedUrl, isMainFrame) => {
      if (!isMainFrame) return;
      this._send('project-intel:update', { type: 'browser_navigate_in_page', runId: this.currentRunId, url: navigatedUrl });
    });
    webContents.on('render-process-gone', (_event, details) => {
      this._send('project-intel:update', {
        type: 'browser_crashed',
        runId: this.currentRunId,
        reason: details?.reason || 'unknown'
      });
      try {
        if (this.browserViewAttached && this.mainWindow && !this.mainWindow.isDestroyed()) this.mainWindow.setBrowserView(null);
      } catch (e) {}
      this.browserViewAttached = false;
      this.browserWindow = null;
      this.browserMode = null;
    });
  }

  async _recordBrowserHistory(url, title) {
    const u = tryNormalizeUrl(url);
    if (!u) return;
    const existing = await this.dbManager.getSetting(BROWSER_HISTORY_KEY);
    const list = Array.isArray(existing) ? existing : [];
    const now = Date.now();
    const next = [{ id: uuidv4(), url: u, title: String(title || ''), ts: now }, ...list.filter((x) => x && x.url !== u)].slice(0, 300);
    await this.dbManager.saveSetting(BROWSER_HISTORY_KEY, next);
  }

  _applyEmbeddedBounds(bounds) {
    if (!this.browserView || !this.mainWindow || this.mainWindow.isDestroyed()) return;
    if (!bounds || !Number.isFinite(Number(bounds.width)) || !Number.isFinite(Number(bounds.height))) return;
    try {
      if (!this.browserViewAttached) {
        this.mainWindow.setBrowserView(this.browserView);
        this.browserViewAttached = true;
      }
    } catch (e) {}
    const wb = this.mainWindow.getContentBounds();
    const maxW = Math.max(1, Math.round(Number(wb?.width) || 1200));
    const maxH = Math.max(1, Math.round(Number(wb?.height) || 800));
    const rawX = Number.isFinite(Number(bounds.x)) ? Math.round(Number(bounds.x)) : 0;
    const rawY = Number.isFinite(Number(bounds.y)) ? Math.round(Number(bounds.y)) : 0;
    const x = Math.min(Math.max(0, rawX), Math.max(0, maxW - 1));
    const y = Math.min(Math.max(0, rawY), Math.max(0, maxH - 1));
    const rawW = Math.round(Number(bounds.width));
    const rawH = Math.round(Number(bounds.height));
    const width = Math.min(Math.max(1, rawW), Math.max(1, maxW - x));
    const height = Math.min(Math.max(1, rawH), Math.max(1, maxH - y));
    try {
      this.browserView.setBounds({ x, y, width, height });
      this.browserView.setAutoResize({ width: false, height: false });
    } catch (e) {}
  }

  setEmbeddedBrowserBounds(bounds) {
    this._applyEmbeddedBounds(bounds || null);
    return { success: true };
  }

  hideEmbeddedBrowser() {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return { success: false, error: 'No main window' };
    try {
      if (this.browserView && this.browserViewAttached) {
        this.mainWindow.setBrowserView(null);
        this.browserViewAttached = false;
      }
    } catch (e) {}
    if (this.browserMode === 'embed') {
      this.browserWindow = null;
      this.browserMode = null;
    }
    return { success: true };
  }

  async browserNavigate(action, payload) {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return { success: false, error: 'Browser not ready' };
    const wc = this.browserWindow.webContents;
    const nav = wc.navigationHistory || null;
    try {
      if (action === 'back') {
        if ((nav && nav.canGoBack && nav.canGoBack()) || (!nav && wc.canGoBack())) wc.goBack();
      } else if (action === 'forward') {
        if ((nav && nav.canGoForward && nav.canGoForward()) || (!nav && wc.canGoForward())) wc.goForward();
      } else if (action === 'reload') {
        wc.reload();
      } else if (action === 'open') {
        const u = tryNormalizeUrl(payload?.url);
        if (!u) return { success: false, error: 'Invalid url' };
        await wc.loadURL(u);
      } else if (action === 'search') {
        const q = String(payload?.query || '').trim();
        const engine = String(payload?.engine || 'https://www.baidu.com/s');
        if (!q) return { success: false, error: 'Empty query' };
        let url = `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`;
        try {
          const u = new URL(engine);
          if (u.searchParams.has('wd')) u.searchParams.set('wd', q);
          else if (u.searchParams.has('q')) u.searchParams.set('q', q);
          else u.searchParams.set('wd', q);
          url = u.toString();
        } catch (e) {}
        await wc.loadURL(url);
      } else if (action === 'translate') {
        const current = wc.getURL();
        const norm = tryNormalizeUrl(current);
        if (!norm) return { success: false, error: 'No page url' };
        await wc.loadURL(`https://translate.google.com/translate?hl=zh-CN&sl=auto&tl=zh-CN&u=${encodeURIComponent(norm)}`);
      }
      return { success: true };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  getBrowserState() {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return { success: true, state: null };
    const wc = this.browserWindow.webContents;
    const nav = wc.navigationHistory || null;
    return {
      success: true,
      state: {
        url: wc.getURL() || '',
        title: (() => {
          try {
            return wc.getTitle() || '';
          } catch (e) {
            return '';
          }
        })(),
        canGoBack: nav && nav.canGoBack ? nav.canGoBack() : wc.canGoBack(),
        canGoForward: nav && nav.canGoForward ? nav.canGoForward() : wc.canGoForward(),
        mode: this.browserMode || null
      }
    };
  }

  async listBrowserBookmarks() {
    const bookmarks = await this.dbManager.getSetting(BROWSER_BOOKMARKS_KEY);
    return { success: true, bookmarks: Array.isArray(bookmarks) ? bookmarks : [] };
  }

  async addBrowserBookmark(payload) {
    const url = tryNormalizeUrl(payload?.url);
    if (!url) return { success: false, error: 'Invalid url' };
    const title = String(payload?.title || '').trim();
    const existing = await this.dbManager.getSetting(BROWSER_BOOKMARKS_KEY);
    const list = Array.isArray(existing) ? existing : [];
    const next = [{ id: uuidv4(), url, title, createdAt: Date.now() }, ...list.filter((x) => x && x.url !== url)].slice(0, 200);
    await this.dbManager.saveSetting(BROWSER_BOOKMARKS_KEY, next);
    return { success: true, bookmarks: next };
  }

  async removeBrowserBookmark(id) {
    const existing = await this.dbManager.getSetting(BROWSER_BOOKMARKS_KEY);
    const list = Array.isArray(existing) ? existing : [];
    const next = list.filter((x) => x && x.id !== id);
    await this.dbManager.saveSetting(BROWSER_BOOKMARKS_KEY, next);
    return { success: true, bookmarks: next };
  }

  async listBrowserHistory(limit) {
    const existing = await this.dbManager.getSetting(BROWSER_HISTORY_KEY);
    const list = Array.isArray(existing) ? existing : [];
    const n = Math.max(1, Math.min(Number(limit) || 100, 500));
    return { success: true, history: list.slice(0, n) };
  }

  async clearBrowserHistory() {
    await this.dbManager.saveSetting(BROWSER_HISTORY_KEY, []);
    return { success: true };
  }

  async _injectSelectionTracker() {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return;
    const script = `
      (function(){
        if (window.__ngoPlannerSelectionTrackerInstalled) return;
        window.__ngoPlannerSelectionTrackerInstalled = true;
        let lastSentAt = 0;
        const clamp = (s, max) => (s && s.length > max ? s.slice(0, max) : s);
        const report = async (text, context) => {
          const now = Date.now();
          if (now - lastSentAt < 1200) return;
          lastSentAt = now;
          try {
            if (window.ngoPlannerProjectIntel && window.ngoPlannerProjectIntel.reportSelection) {
              await window.ngoPlannerProjectIntel.reportSelection({
                url: location.href,
                title: document.title,
                selectedText: clamp(text, 4000),
                contextText: clamp(context, 8000),
                ts: now
              });
            }
          } catch (e) {}
        };
        const getSelectionInfo = () => {
          const sel = window.getSelection && window.getSelection();
          if (!sel) return null;
          const t = (sel.toString() || '').trim();
          if (!t || t.length < 10) return null;
          let context = '';
          try {
            if (sel.rangeCount > 0) {
              const r = sel.getRangeAt(0);
              const container = r.commonAncestorContainer && (r.commonAncestorContainer.nodeType === 1 ? r.commonAncestorContainer : r.commonAncestorContainer.parentElement);
              if (container && container.innerText) context = container.innerText;
            }
          } catch (e) {}
          return { t, context };
        };
        document.addEventListener('mouseup', (ev) => {
          if (!ev || ev.isTrusted !== true) return;
          const info = getSelectionInfo();
          if (!info) return;
          report(info.t, info.context);
        }, true);
        document.addEventListener('keyup', (ev) => {
          if (!ev || ev.isTrusted !== true) return;
          if (ev.key !== 'Shift' && ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight' && ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown') return;
          const info = getSelectionInfo();
          if (!info) return;
          report(info.t, info.context);
        }, true);
      })();
    `;
    await this.browserWindow.webContents.executeJavaScript(script);
  }

  async planTask({ userQuery, useKbMetadata, roots }) {
    const query = String(userQuery || '').trim();
    if (!query) return { success: false, error: 'Empty query' };

    let metadataSnapshot = '';
    let graph = null;

    if (useKbMetadata) {
      try {
        if (!this.ragEngine.isReady) await this.ragEngine.init();
      } catch (e) {}

      try {
        const vectorStore = require('../rag/vectorStore');
        const allSources = await vectorStore.getAllSources();
        const selectedRoots = Array.isArray(roots) ? roots.filter((r) => typeof r === 'string' && r.trim()) : [];
        const filtered = selectedRoots.length === 0
          ? allSources
          : allSources.filter((p) => selectedRoots.some((root) => String(p).startsWith(String(root))));
        const fileConfigs = await this.dbManager.getFileConfig(filtered);
        metadataSnapshot = filtered.slice(0, 120).map((source) => {
          const cfg = fileConfigs[source] || {};
          const fileName = path.basename(source);
          const fileExt = path.extname(source).toLowerCase();
          const folder = path.dirname(source).split(path.sep).slice(-2).join(path.sep);
          const tags = cfg.tags ? cfg.tags.join(', ') : '';
          const modify = cfg.lastModified ? new Date(cfg.lastModified).toLocaleDateString() : '';
          return `[文件] 名称：${fileName} | 类型：${fileExt} | 所在文件夹：${folder} | 标签：${tags} | 修改时间：${modify}`;
        }).join('\n');
      } catch (e) {
        metadataSnapshot = '';
      }

      try {
        graph = await this.dbManager.getGraphData();
      } catch (e) {
        graph = null;
      }
    }

    const prompt = `
你是“项目情报自动检索任务规划器”。你要把用户的自然语言检索需求，规划成一个可执行的安全检索方案，并输出严格 JSON（不要 markdown，不要注释）。

安全要求：
1) 不做高频请求，不并发刷站；默认单线程，页面间随机等待 1.2-2.8s
2) 限制每次 run 的最大 URL 数量 50
3) 优先使用公开页面与站内搜索，不绕过登录/风控
4) 对于需要登录的站点，只提示“请先在浏览器窗口登录”，不要尝试破解验证码

你只能输出一个 JSON 对象，结构如下：
{
  "mode": "intent" | "web_list",
  "searchStrategy": {
    "seedQueries": ["..."],
    "keywords": ["..."],
    "siteHints": ["..."],
    "notes": "..."
  },
  "plan": {
    "actions": [
      { "type": "open_login_if_needed", "url": "https://..." },
      { "type": "for_each_url", "urls": ["https://..."], "actions": [
        { "type": "extract_page", "keywords": ["..."], "takeScreenshot": true }
      ]}
    ]
  }
}

可用动作 type 列表（仅能使用这些）：
- open_login_if_needed: { url }
- for_each_url: { urls, actions }
- extract_page: { keywords, takeScreenshot }

可用的“页面抽取”字段：
- title, url, metaDescription, snippets(基于 keywords), timestamp

补充上下文（可能为空）：
[KB Metadata Snapshot]
${metadataSnapshot || 'N/A'}

[KB Graph]
${graph ? JSON.stringify(graph).slice(0, 20000) : 'N/A'}

[User Query]
${query}
    `.trim();

    try {
      const embeddingServiceModule = require('../rag/embedding');
      const text = await embeddingServiceModule.completion(prompt);
      const parsed1 = parseJsonFromLlmText(text);
      if (parsed1.ok) return { success: true, plan: parsed1.json };

      const repairPrompt = [
        '你刚才的输出不是严格 JSON，导致解析失败。',
        '请把它修复为一个“严格 JSON 对象”，必须符合我给定的 schema（字段名保持一致），不要包含任何 Markdown、注释、代码块标记。',
        '',
        '[原始输出]',
        String(text || '').slice(0, 12000),
        '',
        '[再次强调：只输出 JSON 对象]'
      ].join('\n');

      const repaired = await embeddingServiceModule.completion(repairPrompt);
      const parsed2 = parseJsonFromLlmText(repaired);
      if (parsed2.ok) return { success: true, plan: parsed2.json };

      return { success: false, error: 'LLM returned non-JSON plan', raw: repaired, rawFirst: text };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async startRun(runId, params) {
    const run = await this.dbManager.getProjectIntelRun(runId);
    if (!run) return { success: false, error: 'Run not found' };
    if (this.abortRun) return { success: false, error: 'Another run is active' };

    if (params && params.resume === true) {
      if (!this.pending || this.pending.runId !== runId) return { success: false, error: 'No pending run to resume' };
      return await this._executeUrls({
        runId,
        outputDir: this.pending.outputDir,
        urls: this.pending.urls,
        keywords: this.pending.keywords,
        limits: this.pending.limits,
        takeScreenshot: this.pending.takeScreenshot
      });
    }

    const limits = {
      ...DEFAULT_SAFE_LIMITS,
      ...(params && params.limits ? params.limits : {})
    };
    limits.maxUrls = clampNumber(limits.maxUrls, 1, 200, DEFAULT_SAFE_LIMITS.maxUrls);
    limits.maxTextChars = clampNumber(limits.maxTextChars, 2000, 600000, DEFAULT_SAFE_LIMITS.maxTextChars);
    limits.minDelayMs = clampNumber(limits.minDelayMs, 200, 8000, DEFAULT_SAFE_LIMITS.minDelayMs);
    limits.maxDelayMs = clampNumber(limits.maxDelayMs, limits.minDelayMs, 15000, DEFAULT_SAFE_LIMITS.maxDelayMs);
    limits.pageLoadTimeoutMs = clampNumber(limits.pageLoadTimeoutMs, 1000, 90000, DEFAULT_SAFE_LIMITS.pageLoadTimeoutMs);

    const outputDir = run.output_dir || (await this._ensureRunDir(runId));
    const plan = run.plan || {};
    const planActions = safeParseJson(plan.plan || plan, {}).actions || [];
    const searchStrategy = safeParseJson(plan.searchStrategy || {}, {});

    const planUrls = [];
    const planKeywords = [];
    let loginUrl = null;
    for (const a of Array.isArray(planActions) ? planActions : []) {
      if (!a || typeof a !== 'object') continue;
      if (a.type === 'open_login_if_needed' && typeof a.url === 'string' && a.url.trim()) {
        loginUrl = a.url.trim();
      }
      if (a.type === 'for_each_url' && Array.isArray(a.urls)) {
        for (const u of a.urls) {
          if (typeof u === 'string' && u.trim()) planUrls.push(u.trim());
        }
        if (Array.isArray(a.actions)) {
          for (const sub of a.actions) {
            if (sub && sub.type === 'extract_page' && Array.isArray(sub.keywords)) {
              for (const k of sub.keywords) {
                if (typeof k === 'string' && k.trim()) planKeywords.push(k.trim());
              }
            }
          }
        }
      }
    }

    const urls = (planUrls.length > 0 ? planUrls : (Array.isArray(run.urls) ? run.urls : [])).slice(0, limits.maxUrls);
    const keywords = [...new Set([...(Array.isArray(run.keywords) ? run.keywords : []), ...(Array.isArray(searchStrategy.keywords) ? searchStrategy.keywords : []), ...planKeywords])]
      .filter((k) => typeof k === 'string' && k.trim())
      .map((k) => k.trim())
      .slice(0, 20);

    const takeScreenshot = params && params.takeScreenshot !== undefined ? !!params.takeScreenshot : true;

    if (loginUrl && !params?.autoContinueAfterLogin) {
      await this.dbManager.updateProjectIntelRun(runId, { status: 'waiting_login' });
      this.pending = { runId, outputDir, urls, keywords, limits, takeScreenshot };
      await this.openBrowser({ url: loginUrl, runId, title: '项目情报浏览器 - 请先登录' });
      this._send('project-intel:update', { type: 'login_required', runId, url: loginUrl });
      return { success: true, status: 'waiting_login' };
    }

    return await this._executeUrls({ runId, outputDir, urls, keywords, limits, takeScreenshot });
  }

  async _executeUrls({ runId, outputDir, urls, keywords, limits, takeScreenshot }) {
    this.abortRun = { aborted: false };
    this.currentRunId = runId;

    await this.dbManager.updateProjectIntelRun(runId, { status: 'running', output_dir: outputDir });
    this._send('project-intel:update', { type: 'run_started', runId });

    try {
      await this.openBrowser({ url: (urls && urls[0]) || 'about:blank', runId, title: '项目情报浏览器 - 执行中' });

      const total = Array.isArray(urls) ? urls.length : 0;
      this._send('project-intel:update', { type: 'run_total', runId, total });

      let done = 0;
      for (const targetUrl of Array.isArray(urls) ? urls : []) {
        if (this.abortRun.aborted) break;
        done += 1;
        this._send('project-intel:update', { type: 'run_progress', runId, done, total, url: targetUrl });

        await this._loadUrlWithTimeout(targetUrl, limits.pageLoadTimeoutMs);
        await sleep(limits.minDelayMs + Math.random() * (limits.maxDelayMs - limits.minDelayMs));

        const extracted = await this._extractCurrentPage({ keywords, maxTextChars: limits.maxTextChars });

        const itemId = uuidv4();
        const screenshotPath = takeScreenshot ? await this._captureScreenshot(outputDir, itemId) : null;
        const rawTextPath = await this._saveRawText(outputDir, itemId, extracted && extracted.text ? extracted.text : '');

        const saved = await this.dbManager.addProjectIntelItem({
          id: itemId,
          run_id: runId,
          url: extracted.url || targetUrl,
          title: extracted.title || '',
          snippet: (extracted.snippets || []).join('\n'),
          extracted: {
            metaDescription: extracted.metaDescription || '',
            snippets: extracted.snippets || [],
            keywords: keywords || [],
            timestamp: Date.now()
          },
          screenshot_path: screenshotPath,
          raw_text_path: rawTextPath
        });

        if (saved.success) {
          this._send('project-intel:item-found', { runId, item: { ...saved.item, extracted: safeParseJson(saved.item.extracted_json, {}) } });
        }
      }

      const aborted = this.abortRun.aborted;
      try {
        await this.exportRun(runId);
      } catch (e) {}
      await this.dbManager.updateProjectIntelRun(runId, { status: aborted ? 'stopped' : 'completed' });
      this._send('project-intel:update', { type: 'run_finished', runId, status: aborted ? 'stopped' : 'completed' });
      return { success: true, status: aborted ? 'stopped' : 'completed' };
    } catch (e) {
      await this.dbManager.updateProjectIntelRun(runId, { status: 'error' });
      this._send('project-intel:update', { type: 'run_error', runId, error: e.message });
      return { success: false, error: e.message };
    } finally {
      this.abortRun = null;
      if (this.pending && this.pending.runId === runId) this.pending = null;
    }
  }

  stopRun(runId) {
    if (this.currentRunId && runId && this.currentRunId !== runId) return { success: false, error: 'Run mismatch' };
    if (!this.abortRun) {
      if (this.pending && (!runId || this.pending.runId === runId)) this.pending = null;
      return { success: true };
    }
    this.abortRun.aborted = true;
    this._send('project-intel:update', { type: 'run_stopping', runId: this.currentRunId });
    return { success: true };
  }

  async saveSelection({ runId, url, title, selectedText, contextText }) {
    const rid = runId || this.currentRunId;
    if (!rid) return { success: false, error: 'No active run' };

    const st = String(selectedText || '').trim();
    if (st.length < 10) return { success: false, error: 'Selection too short' };

    const cleanUrl = typeof url === 'string' ? url : '';
    const cleanTitle = typeof title === 'string' ? title : '';
    const cleanContext = typeof contextText === 'string' ? contextText.slice(0, 12000) : '';

    let tags = [];
    try {
      const prompt = `
从用户划线内容中提取 3-8 个中文标签（短语），只输出 JSON 数组字符串。
内容：
${st.slice(0, 3500)}
      `.trim();
      const embeddingServiceModule = require('../rag/embedding');
      const out = await embeddingServiceModule.completion(prompt);
      tags = safeParseJson(out, []);
      if (!Array.isArray(tags)) tags = [];
      tags = tags.filter((t) => typeof t === 'string').map((t) => t.trim()).filter(Boolean).slice(0, 12);
    } catch (e) {
      tags = [];
    }

    const id = uuidv4();
    const res = await this.dbManager.addProjectIntelHighlight({
      id,
      run_id: rid,
      url: cleanUrl,
      title: cleanTitle,
      selected_text: st.slice(0, 4000),
      context_text: cleanContext,
      tags
    });
    if (res.success) {
      this._send('project-intel:update', { type: 'highlight_saved', runId: rid, highlight: { ...res.highlight, tags } });
    }
    return res;
  }

  async startReadingTracking({ runId, intervalMs, enableOcr } = {}) {
    const rid = runId || this.currentRunId;
    if (!rid) return { success: false, error: 'No runId' };
    const run = await this.dbManager.getProjectIntelRun(rid);
    if (!run) return { success: false, error: 'Run not found' };
    if (!this.browserWindow || this.browserWindow.isDestroyed()) {
      await this.openBrowser({ url: (run.urls && run.urls[0]) || 'about:blank', runId: rid, title: '项目情报浏览器 - 阅读模式' });
    }

    if (this.readingTracker && this.readingTracker.runId === rid) {
      return { success: true, status: 'already_running' };
    }

    const outputDir = run.output_dir || (await this._ensureRunDir(rid));
    const framesDir = path.join(outputDir, 'frames');
    await fs.promises.mkdir(framesDir, { recursive: true });

    const interval = clampNumber(intervalMs, 1000, 120000, 8000);
    const ocrOn = enableOcr !== undefined ? !!enableOcr : true;

    const tracker = {
      runId: rid,
      interval,
      ocrOn,
      timer: null,
      inFlight: false,
      lastItemUrl: '',
      lastItemAt: 0
    };

    const tick = async () => {
      if (!this.browserWindow || this.browserWindow.isDestroyed()) return;
      if (tracker.inFlight) return;
      tracker.inFlight = true;
      const frameId = uuidv4();
      const url = this.browserWindow.webContents.getURL();
      let title = '';
      try {
        title = await this.browserWindow.webContents.executeJavaScript('document.title || ""');
      } catch (e) {}

      const imagePath = path.join(framesDir, `${frameId}.png`);
      try {
        const image = await this.browserWindow.webContents.capturePage();
        await fs.promises.writeFile(imagePath, image.toPNG());
      } catch (e) {
        tracker.inFlight = false;
        return;
      }

      let text = '';
      if (tracker.ocrOn && this.ocrQueue) {
        const ocrRes = await this.ocrQueue.recognize(imagePath, { langPath: this._getTessdataPath(), langs: 'chi_sim+eng' });
        if (ocrRes && ocrRes.success) text = String(ocrRes.text || '').trim();
      }

      await this.dbManager.addProjectIntelOcrFrame({
        id: frameId,
        run_id: rid,
        url,
        title,
        image_path: imagePath,
        ocr_text: text
      });

      const now = Date.now();
      const shouldSaveItem = !tracker.lastItemUrl || tracker.lastItemUrl !== url || now - tracker.lastItemAt > 45000;
      if (shouldSaveItem) {
        await this._saveCurrentPageAsItem({
          runId: rid,
          outputDir,
          screenshotPath: imagePath,
          maxTextChars: 180000
        });
        tracker.lastItemUrl = url;
        tracker.lastItemAt = now;
      }

      this._send('project-intel:update', { type: 'ocr_frame', runId: rid, frame: { id: frameId, url, title, image_path: imagePath, ocr_text: text } });
      tracker.inFlight = false;
    };

    tracker.timer = setInterval(() => {
      tick().catch(() => {});
    }, interval);

    this.readingTracker = tracker;
    this._send('project-intel:update', { type: 'reading_started', runId: rid, intervalMs: interval, enableOcr: ocrOn });
    return { success: true };
  }

  async stopReadingTracking(runId) {
    const rid = runId || this.currentRunId;
    if (!this.readingTracker || (rid && this.readingTracker.runId !== rid)) return { success: true };
    try {
      clearInterval(this.readingTracker.timer);
    } catch (e) {}
    const stoppedRunId = this.readingTracker.runId;
    this.readingTracker = null;
    try {
      await this.exportRun(stoppedRunId);
    } catch (e) {}
    this._send('project-intel:update', { type: 'reading_stopped', runId: stoppedRunId });
    return { success: true };
  }

  async captureCurrentPage(runId) {
    const rid = runId || this.currentRunId;
    if (!rid) return { success: false, error: 'No runId' };
    const run = await this.dbManager.getProjectIntelRun(rid);
    if (!run) return { success: false, error: 'Run not found' };
    const outputDir = run.output_dir || (await this._ensureRunDir(rid));
    const saved = await this._saveCurrentPageAsItem({ runId: rid, outputDir, maxTextChars: 220000 });
    if (!saved.success) return saved;
    try {
      await this.exportRun(rid);
    } catch (e) {}
    return { success: true, item: saved.item };
  }

  async listHighlights(runId) {
    const rid = runId || this.currentRunId;
    if (!rid) return { success: false, error: 'No runId' };
    const highlights = await this.dbManager.listProjectIntelHighlights(rid);
    return { success: true, highlights };
  }

  async listOcrFrames(runId) {
    const rid = runId || this.currentRunId;
    if (!rid) return { success: false, error: 'No runId' };
    const frames = await this.dbManager.listProjectIntelOcrFrames(rid);
    return { success: true, frames };
  }

  async deleteCaptureRecords({ runId, type, ids, all }) {
    const rid = runId || this.currentRunId;
    if (!rid) return { success: false, error: 'No runId' };
    const t = String(type || '').toLowerCase();
    let targets = Array.isArray(ids) ? ids.filter(Boolean) : [];
    if (all) {
      if (t === 'item') targets = (await this.dbManager.listProjectIntelItems(rid)).map((x) => x.id);
      if (t === 'highlight') targets = (await this.dbManager.listProjectIntelHighlights(rid)).map((x) => x.id);
      if (t === 'frame') targets = (await this.dbManager.listProjectIntelOcrFrames(rid)).map((x) => x.id);
    }
    if (t === 'item') return await this.dbManager.deleteProjectIntelItems(targets);
    if (t === 'highlight') return await this.dbManager.deleteProjectIntelHighlights(targets);
    if (t === 'frame') return await this.dbManager.deleteProjectIntelOcrFrames(targets);
    return { success: false, error: 'Unknown type' };
  }

  async importCaptureToKnowledge({ runId, itemIds }) {
    const rid = runId || this.currentRunId;
    if (!rid) return { success: false, error: 'No runId' };
    const run = await this.dbManager.getProjectIntelRun(rid);
    if (!run) return { success: false, error: 'Run not found' };
    const outputDir = run.output_dir || (await this._ensureRunDir(rid));
    const allItems = await this.dbManager.listProjectIntelItems(rid);
    const set = new Set(Array.isArray(itemIds) ? itemIds.filter(Boolean) : []);
    const picked = set.size > 0 ? allItems.filter((x) => set.has(x.id)) : allItems.slice(0, 200);
    if (picked.length === 0) return { success: false, error: 'No items to import' };
    const lines = ['# 万物互联采集入库', '', `- Run: ${rid}`, `- 时间: ${new Date().toLocaleString()}`, ''];
    for (const it of picked) {
      lines.push(`## ${it.title || '(无标题)'}`);
      lines.push(`- URL: ${it.url || ''}`);
      if (it.snippet) lines.push(`- 摘要: ${String(it.snippet).replace(/\n/g, ' ').slice(0, 4000)}`);
      lines.push('');
    }
    const filePath = path.join(outputDir, `kb_import_${Date.now()}.md`);
    await fs.promises.writeFile(filePath, lines.join('\n'), 'utf-8');
    await this.dbManager.registerFile({
      id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      projectId: 'none',
      fileName: path.basename(filePath),
      absolutePath: filePath,
      storageType: 'local',
      category: 'KB_PROJECT_INTEL'
    });
    return { success: true, filePath, count: picked.length };
  }

  async exportRun(runId) {
    const rid = runId || this.currentRunId;
    if (!rid) return { success: false, error: 'No runId' };
    const run = await this.dbManager.getProjectIntelRun(rid);
    if (!run) return { success: false, error: 'Run not found' };

    const outputDir = run.output_dir || (await this._ensureRunDir(rid));
    const items = await this.dbManager.listProjectIntelItems(rid);
    const highlights = await this.dbManager.listProjectIntelHighlights(rid);
    const frames = await this.dbManager.listProjectIntelOcrFrames(rid);

    const csvPath = path.join(outputDir, `results_${rid}.csv`);
    const mdPath = path.join(outputDir, `results_${rid}.md`);
    const htmlPath = path.join(outputDir, `report_${rid}.html`);

    const csv = this._generateCsv(items);
    const md = this._generateMd(run, items, highlights, frames);
    const html = this._generateHtml(run, items, highlights, frames);

    await fs.promises.writeFile(csvPath, csv, 'utf-8');
    await fs.promises.writeFile(mdPath, md, 'utf-8');
    await fs.promises.writeFile(htmlPath, html, 'utf-8');

    try {
      await this.dbManager.registerFile({
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        projectId: 'none',
        fileName: path.basename(csvPath),
        absolutePath: csvPath,
        storageType: 'local',
        category: 'KB_PROJECT_INTEL'
      });
      await this.dbManager.registerFile({
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        projectId: 'none',
        fileName: path.basename(mdPath),
        absolutePath: mdPath,
        storageType: 'local',
        category: 'KB_PROJECT_INTEL'
      });
      await this.dbManager.registerFile({
        id: `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        projectId: 'none',
        fileName: path.basename(htmlPath),
        absolutePath: htmlPath,
        storageType: 'local',
        category: 'KB_PROJECT_INTEL'
      });
    } catch (e) {}

    await this.dbManager.updateProjectIntelRun(rid, {
      output_dir: outputDir,
      output_csv_path: csvPath,
      output_md_path: mdPath,
      output_html_path: htmlPath
    });

    this._send('project-intel:update', { type: 'export_ready', runId: rid, csvPath, mdPath, htmlPath });
    return { success: true, csvPath, mdPath, htmlPath, outputDir };
  }

  _generateCsv(items) {
    const header = [
      'id',
      'url',
      'title',
      'snippet',
      'metaDescription',
      'keywords',
      'timestamp',
      'screenshotPath',
      'rawTextPath'
    ];
    const lines = [header.map(toCsvCell).join(',')];
    for (const it of Array.isArray(items) ? items : []) {
      const extracted = it.extracted || safeParseJson(it.extracted_json, {});
      const row = [
        it.id || '',
        it.url || '',
        it.title || '',
        it.snippet || '',
        extracted.metaDescription || '',
        Array.isArray(extracted.keywords) ? extracted.keywords.join('|') : '',
        extracted.timestamp || it.created_at || '',
        it.screenshot_path || '',
        it.raw_text_path || ''
      ];
      lines.push(row.map(toCsvCell).join(','));
    }
    return lines.join('\n');
  }

  _generateMd(run, items, highlights, frames) {
    const lines = [];
    lines.push(`# 项目情报检索结果`);
    lines.push('');
    lines.push(`- Run ID: ${run.id}`);
    lines.push(`- 模式: ${run.mode || ''}`);
    lines.push(`- 生成时间: ${new Date(run.created_at || Date.now()).toLocaleString()}`);
    if (run.user_query) lines.push(`- 用户任务: ${run.user_query}`);
    lines.push('');
    lines.push(`## 结果条目`);
    lines.push('');
    for (const it of Array.isArray(items) ? items : []) {
      lines.push(`### ${it.title || '(无标题)'}`);
      lines.push(`- URL: ${it.url || ''}`);
      if (it.snippet) {
        lines.push(`- 摘要:`);
        lines.push('');
        lines.push('```');
        lines.push(String(it.snippet).slice(0, 6000));
        lines.push('```');
      }
      lines.push('');
    }
    lines.push(`## 划线笔记`);
    lines.push('');
    for (const h of Array.isArray(highlights) ? highlights : []) {
      lines.push(`- ${h.title || ''} (${h.url || ''})`);
      lines.push(`  - 标签: ${(Array.isArray(h.tags) ? h.tags : safeParseJson(h.tags_json, [])).join(', ')}`);
      lines.push(`  - 内容: ${String(h.selected_text || '').replace(/\n/g, ' ').slice(0, 2000)}`);
    }
    lines.push('');
    lines.push(`## OCR 轨迹（节选）`);
    lines.push('');
    for (const f of (Array.isArray(frames) ? frames : []).slice(0, 40)) {
      lines.push(`- ${new Date(f.created_at || Date.now()).toLocaleString()} ${f.url || ''}`);
      if (f.ocr_text) lines.push(`  - ${String(f.ocr_text).replace(/\s+/g, ' ').slice(0, 2000)}`);
    }
    lines.push('');
    return lines.join('\n');
  }

  _generateHtml(run, items, highlights, frames) {
    const itemRows = (Array.isArray(items) ? items : []).map((it) => {
      const extracted = it.extracted || safeParseJson(it.extracted_json, {});
      const snippets = Array.isArray(extracted.snippets) ? extracted.snippets.slice(0, 3) : [];
      const img = it.screenshot_path ? `<img src="file://${escapeHtml(it.screenshot_path)}" style="max-width:220px;max-height:140px;border-radius:10px;border:1px solid #e5e7eb" />` : '';
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #eef2f7">${escapeHtml(it.title || '')}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eef2f7"><a href="${escapeHtml(it.url || '')}" target="_blank" rel="noreferrer">${escapeHtml(it.url || '')}</a></td>
          <td style="padding:10px 12px;border-bottom:1px solid #eef2f7;white-space:pre-wrap">${escapeHtml((snippets.join('\n\n') || it.snippet || '').slice(0, 1200))}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #eef2f7">${img}</td>
        </tr>
      `.trim();
    }).join('\n');

    const highlightRows = (Array.isArray(highlights) ? highlights : []).map((h) => {
      const tags = Array.isArray(h.tags) ? h.tags : safeParseJson(h.tags_json, []);
      return `
        <div style="border:1px solid #e5e7eb;border-radius:14px;padding:12px 14px;background:#fff">
          <div style="font-weight:800;color:#0f172a">${escapeHtml(h.title || '')}</div>
          <div style="margin-top:6px;font-size:12px;color:#475569"><a href="${escapeHtml(h.url || '')}" target="_blank" rel="noreferrer">${escapeHtml(h.url || '')}</a></div>
          <div style="margin-top:10px;font-size:13px;color:#0f172a;white-space:pre-wrap">${escapeHtml(String(h.selected_text || '').slice(0, 4000))}</div>
          <div style="margin-top:10px;font-size:12px;color:#334155">标签：${escapeHtml(tags.join(', '))}</div>
        </div>
      `.trim();
    }).join('\n');

    const frameRows = (Array.isArray(frames) ? frames : []).slice(0, 120).map((f) => {
      const img = f.image_path ? `<img src="file://${escapeHtml(f.image_path)}" style="max-width:520px;border-radius:12px;border:1px solid #e5e7eb" />` : '';
      return `
        <div style="display:flex;gap:14px;align-items:flex-start;border:1px solid #e5e7eb;border-radius:16px;padding:12px;background:#fff">
          <div style="flex:0 0 auto">${img}</div>
          <div style="min-width:0">
            <div style="font-weight:800;color:#0f172a">${escapeHtml(f.title || '')}</div>
            <div style="margin-top:6px;font-size:12px;color:#475569">${escapeHtml(new Date(f.created_at || Date.now()).toLocaleString())}</div>
            <div style="margin-top:6px;font-size:12px;color:#475569"><a href="${escapeHtml(f.url || '')}" target="_blank" rel="noreferrer">${escapeHtml(f.url || '')}</a></div>
            <div style="margin-top:10px;font-size:13px;color:#0f172a;white-space:pre-wrap">${escapeHtml(String(f.ocr_text || '').trim().slice(0, 4000))}</div>
          </div>
        </div>
      `.trim();
    }).join('\n');

    return `
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>项目情报检索报告</title>
  </head>
  <body style="margin:0;background:#f8fafc;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif">
    <div style="max-width:1200px;margin:0 auto;padding:28px 22px">
      <div style="display:flex;justify-content:space-between;gap:18px;align-items:flex-start">
        <div>
          <div style="font-size:22px;font-weight:900;letter-spacing:0.02em">项目情报检索报告</div>
          <div style="margin-top:8px;font-size:13px;color:#475569">Run ID：${escapeHtml(run.id)} · ${escapeHtml(run.mode || '')} · ${escapeHtml(new Date(run.created_at || Date.now()).toLocaleString())}</div>
          ${run.user_query ? `<div style="margin-top:10px;font-size:13px;color:#0f172a;white-space:pre-wrap">任务：${escapeHtml(run.user_query)}</div>` : ''}
        </div>
      </div>

      <div style="margin-top:22px;background:#fff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid #eef2f7;font-weight:900">结果表</div>
        <div style="overflow:auto">
          <table style="border-collapse:collapse;width:100%;min-width:860px;font-size:13px">
            <thead>
              <tr style="background:#f1f5f9;color:#334155;text-align:left">
                <th style="padding:10px 12px;border-bottom:1px solid #e2e8f0">标题</th>
                <th style="padding:10px 12px;border-bottom:1px solid #e2e8f0">链接</th>
                <th style="padding:10px 12px;border-bottom:1px solid #e2e8f0">摘要/命中片段</th>
                <th style="padding:10px 12px;border-bottom:1px solid #e2e8f0">截图</th>
              </tr>
            </thead>
            <tbody>
              ${itemRows || ''}
            </tbody>
          </table>
        </div>
      </div>

      <div style="margin-top:22px;display:grid;grid-template-columns:1fr;gap:12px">
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden">
          <div style="padding:14px 16px;border-bottom:1px solid #eef2f7;font-weight:900">划线笔记</div>
          <div style="padding:14px 16px;display:grid;grid-template-columns:1fr;gap:12px">
            ${highlightRows || '<div style="color:#64748b;font-size:13px">暂无</div>'}
          </div>
        </div>
      </div>

      <div style="margin-top:22px;background:#fff;border:1px solid #e5e7eb;border-radius:18px;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid #eef2f7;font-weight:900">阅读轨迹（截图 + OCR）</div>
        <div style="padding:14px 16px;display:flex;flex-direction:column;gap:12px">
          ${frameRows || '<div style="color:#64748b;font-size:13px">暂无</div>'}
        </div>
      </div>
    </div>
  </body>
</html>
    `.trim();
  }

  async _loadUrlWithTimeout(url, timeoutMs) {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) throw new Error('Browser not ready');
    const norm = tryNormalizeUrl(url);
    if (!norm) throw new Error('Invalid URL');
    const loadTask = this.browserWindow.loadURL(norm);
    const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('Page load timeout')), timeoutMs));
    try {
      return await Promise.race([loadTask, timer]);
    } catch (e) {
      try {
        const html = renderInfoPage({
          title: '页面加载超时',
          lines: [`URL：${norm}`, `超时：${Number(timeoutMs) || 0}ms`, '建议：降低频率/检查网络/先手动打开该页面确认可访问。'],
        });
        await this.browserWindow.loadURL(toDataUrl(html));
      } catch (e2) {}
      throw e;
    }
  }

  async _extractCurrentPage({ keywords, maxTextChars }) {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) throw new Error('Browser not ready');
    const kw = Array.isArray(keywords) ? keywords.filter((k) => typeof k === 'string' && k.trim()).slice(0, 20) : [];

    const script = `
      (function(){
        const maxChars = ${JSON.stringify(maxTextChars)};
        const keywords = ${JSON.stringify(kw)};
        const title = document.title || '';
        const url = location.href;
        const meta = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
        let text = '';
        try { text = (document.body && document.body.innerText) ? document.body.innerText : ''; } catch (e) { text = ''; }
        text = text.replace(/\\s+/g, ' ').trim();
        if (text.length > maxChars) text = text.slice(0, maxChars);
        const snippets = [];
        const windowSize = 220;
        for (const k of keywords) {
          if (!k) continue;
          const idx = text.toLowerCase().indexOf(String(k).toLowerCase());
          if (idx >= 0) {
            const start = Math.max(0, idx - windowSize);
            const end = Math.min(text.length, idx + String(k).length + windowSize);
            snippets.push(text.slice(start, end));
          }
        }
        return { title, url, metaDescription: meta, snippets, text };
      })();
    `;

    const extracted = await this.browserWindow.webContents.executeJavaScript(script);
    return extracted || { title: '', url: this.browserWindow.webContents.getURL(), metaDescription: '', snippets: [], text: '' };
  }

  async _captureScreenshot(outputDir, itemId) {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return null;
    try {
      const image = await this.browserWindow.webContents.capturePage();
      const png = image.toPNG();
      const p = path.join(outputDir, `${itemId}.png`);
      await fs.promises.writeFile(p, png);
      return p;
    } catch (e) {
      return null;
    }
  }

  async _saveRawText(outputDir, itemId, text) {
    try {
      const p = path.join(outputDir, `${itemId}.txt`);
      await fs.promises.writeFile(p, String(text || ''), 'utf-8');
      return p;
    } catch (e) {
      return null;
    }
  }

  async _saveCurrentPageAsItem({ runId, outputDir, screenshotPath, maxTextChars }) {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return { success: false, error: 'Browser not ready' };
    try {
      const extracted = await this._extractCurrentPage({ keywords: [], maxTextChars: maxTextChars || 120000 });
      const itemId = uuidv4();
      const shot = screenshotPath || (await this._captureScreenshot(outputDir, itemId));
      const rawTextPath = await this._saveRawText(outputDir, itemId, extracted && extracted.text ? extracted.text : '');
      const plainSnippet = String(extracted?.text || '').replace(/\s+/g, ' ').trim().slice(0, 2200);
      const saved = await this.dbManager.addProjectIntelItem({
        id: itemId,
        run_id: runId,
        url: extracted.url || '',
        title: extracted.title || '',
        snippet: plainSnippet,
        extracted: {
          metaDescription: extracted.metaDescription || '',
          snippets: extracted.snippets || [],
          keywords: [],
          timestamp: Date.now()
        },
        screenshot_path: shot,
        raw_text_path: rawTextPath
      });
      if (saved.success) {
        this._send('project-intel:item-found', { runId, item: { ...saved.item, extracted: safeParseJson(saved.item.extracted_json, {}) } });
        this._send('project-intel:update', { type: 'reading_item_saved', runId, itemId });
      }
      return saved;
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

module.exports = ProjectIntelService;
