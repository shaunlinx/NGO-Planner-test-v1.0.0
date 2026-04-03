const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app, dialog, safeStorage } = require('electron');
const dbManager = require('../databaseManager');

const normalizePath = (p) => {
  try {
    return path.resolve(String(p || '')).replace(/\\/g, '/');
  } catch (e) {
    return String(p || '').replace(/\\/g, '/');
  }
};

const isUnderAnyRoot = (p, roots) => {
  const n = normalizePath(p);
  for (const r0 of roots || []) {
    const r = normalizePath(r0).replace(/\/+$/, '');
    const base = `${r}/`;
    if (n === r || n.startsWith(base)) return true;
  }
  return false;
};

const isSafeMountRoot = (p) => {
  const n = normalizePath(p).replace(/\/+$/, '');
  if (!n) return false;
  const blocked = [
    '/System',
    '/Library',
    '/Applications',
    '/private',
    '/dev',
    '/proc',
    '/sys',
    '/bin',
    '/sbin',
    '/usr'
  ];
  if (process.platform === 'win32') return true;
  for (const b of blocked) {
    const base = b.replace(/\/+$/, '');
    if (n === base || n.startsWith(`${base}/`)) return false;
  }
  return true;
};

const pathExists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch (e) {
    return false;
  }
};

const findExecutableOnPath = (names) => {
  const paths = String(process.env.PATH || '')
    .split(path.delimiter)
    .filter(Boolean);
  for (const p of paths) {
    for (const name of names) {
      const full = path.join(p, name);
      try {
        fs.accessSync(full, fs.constants.X_OK);
        return full;
      } catch (e) {}
    }
  }
  return null;
};

const makeId = () => {
  try {
    return crypto.randomUUID();
  } catch (e) {
    return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
  }
};

class ClaudeCodeService {
  constructor() {
    this.mainWindow = null;
    this.sessions = new Map();
    this.isReady = false;
    this.enabled = true;
    this.managedBin = '';
    this.proxyUrl = '';
    this.noProxy = '';
  }

  setContext({ mainWindow }) {
    this.mainWindow = mainWindow || null;
  }

  async init() {
    try {
      const en = await dbManager.getSetting('claude_code_enabled');
      if (en === false || en === 'false') this.enabled = false;
      if (en === true || en === 'true') this.enabled = true;
    } catch (e) {}
    try {
      const p = await dbManager.getSetting('claude_code_managed_bin');
      if (typeof p === 'string' && p.trim()) this.managedBin = p.trim();
      if (p === '' || p === null) this.managedBin = '';
    } catch (e) {}
    try {
      const proxy = await this._getDecryptedSetting('claude_code_proxy');
      if (typeof proxy === 'string') this.proxyUrl = proxy.trim();
    } catch (e) {}
    try {
      const np = await this._getDecryptedSetting('claude_code_no_proxy');
      if (typeof np === 'string') this.noProxy = np.trim();
    } catch (e) {}
    this.isReady = true;
  }

  async _getDecryptedSetting(key) {
    const v = await dbManager.getSetting(key);
    if (v && typeof v === 'string' && v.startsWith('ENC:') && safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(v.slice(4), 'hex'));
      } catch (e) {
        return null;
      }
    }
    if (typeof v === 'string') return v;
    return v ?? null;
  }

  _candidateExecutables() {
    const names = process.platform === 'win32' ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude'];
    const candidates = [];

    const fromEnv = String(process.env.NGOPLANNER_CLAUDE_CODE_BIN || '').trim();
    if (fromEnv) candidates.push(fromEnv);

    const managed = String(this.managedBin || '').trim();
    if (managed) candidates.push(managed);

    const binDir = path.join(__dirname, '../bin');
    for (const n of names) candidates.push(path.join(binDir, n));

    if (app.isPackaged) {
      for (const n of names) candidates.push(path.join(process.resourcesPath, 'claude_code_runtime', n));
      for (const n of names) candidates.push(path.join(process.resourcesPath, 'claude_code_runtime', 'bin', n));
      for (const n of names) candidates.push(path.join(process.resourcesPath, 'bin', n));
    }

    return { names, candidates };
  }

  async resolveExecutable() {
    await this.init();
    const { names, candidates } = this._candidateExecutables();
    for (const c of candidates) {
      try {
        fs.accessSync(c, fs.constants.X_OK);
        return c;
      } catch (e) {}
    }
    return findExecutableOnPath(names);
  }

  async setEnabled(enabled) {
    await this.init();
    this.enabled = !!enabled;
    try {
      await dbManager.saveSetting('claude_code_enabled', this.enabled);
    } catch (e) {}
    if (!this.enabled) {
      try {
        this.killAll();
      } catch (e) {}
    }
    return this.getStatus();
  }

  async setManagedBin(p) {
    await this.init();
    const next = String(p || '').trim();
    if (!next) return { success: false, error: 'invalid_path' };
    try {
      fs.accessSync(next, fs.constants.X_OK);
    } catch (e) {
      return { success: false, error: 'not_executable' };
    }
    this.managedBin = next;
    try {
      await dbManager.saveSetting('claude_code_managed_bin', next);
    } catch (e) {}
    return this.getStatus();
  }

  async clearManagedBin() {
    await this.init();
    this.managedBin = '';
    try {
      await dbManager.saveSetting('claude_code_managed_bin', '');
    } catch (e) {}
    return this.getStatus();
  }

  _managedRuntimeDir() {
    return path.join(app.getPath('userData'), 'claude-code-runtime');
  }

  async installFromPath(p) {
    await this.init();
    const src = String(p || '').trim();
    if (!src) return { success: false, error: 'invalid_path' };
    try {
      fs.accessSync(src, fs.constants.X_OK);
    } catch (e) {
      return { success: false, error: 'not_executable' };
    }
    const base = this._managedRuntimeDir();
    const binDir = path.join(base, 'bin');
    const name = process.platform === 'win32' ? 'claude.exe' : 'claude';
    const dest = path.join(binDir, name);
    try {
      await fs.promises.mkdir(binDir, { recursive: true });
      await fs.promises.copyFile(src, dest);
      if (process.platform !== 'win32') {
        try {
          await fs.promises.chmod(dest, 0o755);
        } catch (e) {}
      }
    } catch (e) {
      return { success: false, error: 'copy_failed' };
    }
    this.managedBin = dest;
    try {
      await dbManager.saveSetting('claude_code_managed_bin', dest);
    } catch (e) {}
    return this.getStatus();
  }

  async uninstallManaged() {
    await this.init();
    try {
      this.killAll();
    } catch (e) {}
    try {
      await this.clearManagedBin();
    } catch (e) {}
    const dir = this._managedRuntimeDir();
    try {
      if (pathExists(dir)) {
        await fs.promises.rm(dir, { recursive: true, force: true });
      }
    } catch (e) {}
    return this.getStatus();
  }

  async getStatus() {
    await this.init();
    const exe = await this.resolveExecutable();
    const exists = !!exe && pathExists(exe);
    return {
      success: true,
      isPackaged: !!app.isPackaged,
      enabled: !!this.enabled,
      configuredBin: String(this.managedBin || '').trim(),
      executablePath: exe || '',
      executableExists: exists,
      runningSessions: this.sessions.size
    };
  }

  _requirePty() {
    try {
      return require('node-pty');
    } catch (e) {
      return null;
    }
  }

  async createSession({ cwd, cols, rows, args, env } = {}) {
    await this.init();
    if (!this.enabled) return { success: false, error: 'disabled' };
    const pty = this._requirePty();
    if (!pty) return { success: false, error: 'pty_not_available' };

    const exe = await this.resolveExecutable();
    if (!exe) return { success: false, error: 'claude_code_not_found' };

    const requestedCwd = String(cwd || '').trim();
    const realCwd = requestedCwd ? normalizePath(requestedCwd) : normalizePath(app.getPath('home'));
    if (!pathExists(realCwd)) return { success: false, error: 'cwd_not_found' };
    if (!isSafeMountRoot(realCwd)) return { success: false, error: 'cwd_blocked' };

    const allowRoots = [app.getPath('home'), app.getPath('documents'), app.getPath('downloads'), app.getPath('desktop')].filter(Boolean);
    const isAllowed = isUnderAnyRoot(realCwd, allowRoots);
    if (!isAllowed) {
      const parent = this.mainWindow || undefined;
      const res = await dialog.showMessageBox(parent, {
        type: 'warning',
        buttons: ['允许', '取消'],
        defaultId: 1,
        cancelId: 1,
        title: 'Claude Code 权限确认',
        message: 'Claude Code 将以终端会话形式访问你的本机文件。',
        detail: `是否允许在以下目录运行？\n${realCwd}`
      });
      if (res.response !== 0) return { success: false, error: 'user_denied' };
    }

    const sessionId = makeId();
    const c = Math.max(20, Math.min(Number(cols) || 100, 400));
    const r = Math.max(5, Math.min(Number(rows) || 30, 200));
    const argv = Array.isArray(args) ? args.map((x) => String(x)) : [];

    const baseEnv = { ...process.env };
    const extraEnv = env && typeof env === 'object' ? env : {};
    const mergedEnv = { ...baseEnv, ...extraEnv };
    const proxy = String(this.proxyUrl || '').trim();
    const noProxy = String(this.noProxy || '').trim();
    if (proxy) {
      mergedEnv.HTTPS_PROXY = proxy;
      mergedEnv.HTTP_PROXY = proxy;
      mergedEnv.ALL_PROXY = proxy;
    }
    if (noProxy) {
      mergedEnv.NO_PROXY = noProxy;
    }

    const term = pty.spawn(exe, argv, {
      name: 'xterm-256color',
      cols: c,
      rows: r,
      cwd: realCwd,
      env: mergedEnv
    });

    term.onData((data) => {
      try {
        const wc = this.mainWindow?.webContents;
        if (!wc || wc.isDestroyed()) return;
        wc.send('claude-code:data', { sessionId, data: String(data || '') });
      } catch (e) {}
    });

    term.onExit(() => {
      try {
        const wc = this.mainWindow?.webContents;
        if (wc && !wc.isDestroyed()) wc.send('claude-code:exit', { sessionId });
      } catch (e) {}
      this.sessions.delete(sessionId);
    });

    this.sessions.set(sessionId, { term, cwd: realCwd, createdAt: Date.now() });
    return { success: true, sessionId, cwd: realCwd };
  }

  write({ sessionId, data } = {}) {
    const id = String(sessionId || '').trim();
    const s = this.sessions.get(id);
    if (!s) return { success: false, error: 'not_found' };
    try {
      s.term.write(String(data || ''));
      return { success: true };
    } catch (e) {
      return { success: false, error: 'write_failed' };
    }
  }

  resize({ sessionId, cols, rows } = {}) {
    const id = String(sessionId || '').trim();
    const s = this.sessions.get(id);
    if (!s) return { success: false, error: 'not_found' };
    try {
      const c = Math.max(20, Math.min(Number(cols) || 100, 400));
      const r = Math.max(5, Math.min(Number(rows) || 30, 200));
      s.term.resize(c, r);
      return { success: true };
    } catch (e) {
      return { success: false, error: 'resize_failed' };
    }
  }

  kill({ sessionId } = {}) {
    const id = String(sessionId || '').trim();
    const s = this.sessions.get(id);
    if (!s) return { success: false, error: 'not_found' };
    try {
      s.term.kill();
    } catch (e) {}
    this.sessions.delete(id);
    return { success: true };
  }

  killAll() {
    for (const [id] of this.sessions.entries()) {
      try {
        this.kill({ sessionId: id });
      } catch (e) {}
    }
  }
}

module.exports = new ClaudeCodeService();
