const { spawn, exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const { safeStorage, app, dialog } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const net = require('net');
const crypto = require('crypto');
const dbManager = require('../databaseManager');
const ragEngine = require('./rag/ragEngine');
const privacyService = require('./privacyService');
const agentApprovalService = require('./agentApprovalService');
const marketplaceService = require('./marketplaceService');

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

const parseUrlSafe = (raw) => {
  try {
    const u = new URL(String(raw || '').trim());
    return u;
  } catch (e) {
    return null;
  }
};

const getKbMountRoots = async () => {
  const mounts = await dbManager.getSetting('kb_mounted_folders');
  return Array.isArray(mounts) ? mounts.map((x) => normalizePath(x)).filter(Boolean) : [];
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
  if (process.platform === 'win32') {
    return true;
  }
  for (const b of blocked) {
    const base = b.replace(/\/+$/, '');
    if (n === base || n.startsWith(`${base}/`)) return false;
  }
  return true;
};

const safeBasename = (name) => String(name || '').replace(/[^\p{L}\p{N}\s._-]+/gu, '').trim().slice(0, 120);

const writeAudit = async (entry) => {
  try {
    const baseDir = path.join(app.getPath('userData'), 'storage', 'DATA', 'Logs');
    await fs.promises.mkdir(baseDir, { recursive: true });
    const filePath = path.join(baseDir, 'openclaw-bridge-audit.log');
    try {
      await fs.promises.access(filePath);
    } catch (e) {
      try {
        await fs.promises.writeFile(filePath, '', { encoding: 'utf8', mode: 0o600 });
      } catch (e2) {}
    }
    try {
      await fs.promises.chmod(filePath, 0o600);
    } catch (e) {}
    const line = JSON.stringify({ ts: new Date().toISOString(), ...(entry || {}) });
    await fs.promises.appendFile(filePath, `${line}\n`, 'utf8');
  } catch (e) {}
};

const readTailText = async (filePath, { maxBytes = 256_000, maxLines = 200 } = {}) => {
  try {
    if (!filePath) return '';
    const st = await fs.promises.stat(filePath);
    const size = Number(st.size || 0);
    const readSize = Math.max(0, Math.min(size, maxBytes));
    const start = Math.max(0, size - readSize);
    const fd = await fs.promises.open(filePath, 'r');
    try {
      const buf = Buffer.alloc(readSize);
      await fd.read(buf, 0, readSize, start);
      const text = buf.toString('utf8');
      const lines = text.split(/\r?\n/).filter((l) => l !== '');
      const tail = lines.slice(Math.max(0, lines.length - maxLines)).join('\n');
      return tail;
    } finally {
      try {
        await fd.close();
      } catch (e) {}
    }
  } catch (e) {
    return '';
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

const pathExists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch (e) {
    return false;
  }
};

const isPortOpen = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.end();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(600, () => {
      socket.destroy();
      resolve(false);
    });
  });

const waitForPortOpen = async (port, timeoutMs = 6000) => {
  const deadline = Date.now() + Math.max(200, Number(timeoutMs) || 6000);
  while (Date.now() < deadline) {
    const ok = await isPortOpen(port);
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
};
const OPENCLAW_SECURITY_ROTATE_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const OPENCLAW_SECURITY_CHECK_INTERVAL_MS = 5 * 60 * 1000;
const OPENCLAW_UTILITY_SKILL_CATALOG = [
  { id: 'skill-vetter', aliases: ['skill-vetter'], name: 'skill-vetter', type: 'skill', icon: 'shield', preinstall: true },
  { id: 'tavily-search', aliases: ['tavily-search'], name: 'tavily-search', type: 'skill', icon: 'search', preinstall: true },
  { id: 'find-skills', aliases: ['find-skills'], name: 'find-skills', type: 'skill', icon: 'sparkles', preinstall: true },
  { id: 'self-improving', aliases: ['self-improving'], name: 'self-improving', type: 'skill', icon: 'brain', preinstall: true },
  { id: 'proactive-agent', aliases: ['proactive-agent'], name: 'proactive-agent', type: 'skill', icon: 'workflow', preinstall: true },
  { id: 'memory-setup', aliases: ['memory-setup'], name: 'memory-setup', type: 'skill', icon: 'database', preinstall: true },
  { id: 'gog', aliases: ['gog'], name: 'gog', type: 'skill', icon: 'mail', preinstall: true },
  { id: 'summarize', aliases: ['summarize'], name: 'summarize', type: 'skill', icon: 'file-text', preinstall: true },
  { id: 'automation-workflows', aliases: ['automation-workflows'], name: 'automation-workflows', type: 'skill', icon: 'bot', preinstall: true },
  { id: 'obsidian', aliases: ['obsidian'], name: 'obsidian', type: 'skill', icon: 'book-open', preinstall: true },
  { id: 'qmd', aliases: ['qmd'], name: 'qmd', type: 'skill', icon: 'file-search', preinstall: true },
  { id: 'agent-browser', aliases: ['agent-browser'], name: 'agent-browser', type: 'skill', icon: 'globe', preinstall: true },
  { id: 'feishu', aliases: ['feishu'], name: '飞书连接', type: 'plugin', icon: 'message-circle', preinstall: false },
  { id: 'ngo-planner-bridge', aliases: ['ngo-planner-bridge'], name: 'NGO Planner Bridge', type: 'skill', icon: 'plug', preinstall: true }
];

const findFreePort = async (start, end) => {
  const s = Number.isFinite(Number(start)) ? Number(start) : 18000;
  const e = Number.isFinite(Number(end)) ? Number(end) : s + 200;
  for (let p = s; p <= e; p += 1) {
    const open = await isPortOpen(p);
    if (!open) return p;
  }
  return null;
};

const readJsonBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c.toString();
      if (raw.length > 2_000_000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch (e) {
        resolve(null);
      }
    });
  });

const OPENCLAW_BRIDGE_CAPABILITIES = [
  { id: 'capabilities_catalog', method: 'POST', path: '/skills/capabilities/catalog', category: 'meta', description: '列出 Bridge 可调用能力目录' },
  { id: 'capabilities_get', method: 'POST', path: '/skills/capabilities/get', category: 'meta', description: '按 id 或 path 获取能力详情' },
  { id: 'project_intel_run', method: 'POST', path: '/skills/project-intel/run', category: 'project_intel', description: '创建并启动项目情报任务' },
  { id: 'project_intel_list', method: 'POST', path: '/skills/project-intel/list', category: 'project_intel', description: '列出项目情报任务' },
  { id: 'project_intel_get', method: 'POST', path: '/skills/project-intel/get', category: 'project_intel', description: '获取项目情报任务详情' },
  { id: 'project_intel_items_list', method: 'POST', path: '/skills/project-intel/items/list', category: 'project_intel', description: '列出项目情报条目' },
  { id: 'project_intel_items_update', method: 'POST', path: '/skills/project-intel/items/update', category: 'project_intel', description: '更新项目情报条目' },
  { id: 'project_intel_export', method: 'POST', path: '/skills/project-intel/export', category: 'project_intel', description: '导出项目情报结果' },
  { id: 'project_intel_delete', method: 'POST', path: '/skills/project-intel/delete', category: 'project_intel', description: '删除项目情报任务' },
  { id: 'context_get', method: 'POST', path: '/skills/context/get', category: 'context', description: '获取项目与知识库上下文' },
  { id: 'social_draft_save', method: 'POST', path: '/skills/social/draft', category: 'social', description: '保存社媒草稿' },
  { id: 'approvals_list', method: 'POST', path: '/skills/approvals/list', category: 'approval', description: '列出待审批项' },
  { id: 'approvals_get', method: 'POST', path: '/skills/approvals/get', category: 'approval', description: '获取审批详情' },
  { id: 'kb_query', method: 'POST', path: '/skills/kb/query', category: 'knowledge', description: '知识库检索' },
  { id: 'kb_mount_list', method: 'POST', path: '/skills/kb/mount/list', category: 'knowledge', description: '列出挂载知识目录' },
  { id: 'kb_mount_add', method: 'POST', path: '/skills/kb/mount/add', category: 'knowledge', description: '挂载知识目录' },
  { id: 'kb_mount_remove', method: 'POST', path: '/skills/kb/mount/remove', category: 'knowledge', description: '取消挂载知识目录' },
  { id: 'artifacts_write', method: 'POST', path: '/skills/artifacts/write', category: 'artifact', description: '写入工件文件' },
  { id: 'artifacts_list', method: 'POST', path: '/skills/artifacts/list', category: 'artifact', description: '列出工件文件' },
  { id: 'fs_read', method: 'POST', path: '/skills/fs/read', category: 'filesystem', description: '读取文件内容' },
  { id: 'fs_write', method: 'POST', path: '/skills/fs/write', category: 'filesystem', description: '写入文件内容' },
  { id: 'net_fetch', method: 'POST', path: '/skills/net/fetch', category: 'network', description: '按网络白名单抓取网页' },
  { id: 'team_get', method: 'POST', path: '/skills/team/get', category: 'team', description: '读取团队成员' },
  { id: 'team_upsert', method: 'POST', path: '/skills/team/upsert', category: 'team', description: '新增或更新团队成员' },
  { id: 'team_delete', method: 'POST', path: '/skills/team/delete', category: 'team', description: '删除团队成员' },
  { id: 'org_get', method: 'POST', path: '/skills/org/get', category: 'organization', description: '读取组织信息' },
  { id: 'org_set', method: 'POST', path: '/skills/org/set', category: 'organization', description: '更新组织信息' },
  { id: 'selection_get', method: 'POST', path: '/skills/selection/get', category: 'ui', description: '读取当前选中对象' },
  { id: 'selection_set', method: 'POST', path: '/skills/selection/set', category: 'ui', description: '设置当前选中对象' },
  { id: 'settings_get', method: 'POST', path: '/skills/settings/get', category: 'settings', description: '读取设置项' },
  { id: 'settings_set', method: 'POST', path: '/skills/settings/set', category: 'settings', description: '更新设置项' },
  { id: 'leads_list', method: 'POST', path: '/skills/leads/list', category: 'lead', description: '列出线索' },
  { id: 'leads_upsert', method: 'POST', path: '/skills/leads/upsert', category: 'lead', description: '新增或更新线索' },
  { id: 'leads_delete', method: 'POST', path: '/skills/leads/delete', category: 'lead', description: '删除线索' },
  { id: 'schedules_list', method: 'POST', path: '/skills/schedules/list', category: 'schedule', description: '列出排期' },
  { id: 'schedules_upsert', method: 'POST', path: '/skills/schedules/upsert', category: 'schedule', description: '新增或更新排期' },
  { id: 'schedules_delete', method: 'POST', path: '/skills/schedules/delete', category: 'schedule', description: '删除排期' },
  { id: 'projects_list', method: 'POST', path: '/skills/projects/list', category: 'project', description: '列出项目' },
  { id: 'projects_get', method: 'POST', path: '/skills/projects/get', category: 'project', description: '获取项目详情' },
  { id: 'projects_patch', method: 'POST', path: '/skills/projects/patch', category: 'project', description: '更新项目' },
  { id: 'projects_delete', method: 'POST', path: '/skills/projects/delete', category: 'project', description: '删除项目' },
  { id: 'milestones_update', method: 'POST', path: '/skills/milestones/update', category: 'project', description: '更新里程碑' },
  { id: 'events_list', method: 'POST', path: '/skills/events/list', category: 'calendar', description: '列出日程事件' },
  { id: 'events_upsert', method: 'POST', path: '/skills/events/upsert', category: 'calendar', description: '新增或更新日程事件' },
  { id: 'events_delete', method: 'POST', path: '/skills/events/delete', category: 'calendar', description: '删除日程事件' }
];

const OPENCLAW_BRIDGE_CAPABILITY_BY_ID = OPENCLAW_BRIDGE_CAPABILITIES.reduce((acc, x) => {
  acc[x.id] = x;
  return acc;
}, {});

const OPENCLAW_BRIDGE_CAPABILITY_BY_PATH = OPENCLAW_BRIDGE_CAPABILITIES.reduce((acc, x) => {
  acc[x.path] = x;
  return acc;
}, {});

class OpenClawService {
  constructor() {
    this.enabled = false;
    this.port = 18789;
    this.bridgePort = 18890;
    this.process = null;
    this.lastError = null;
    this.bridgeServer = null;
    this.bridgeToken = null;
    this.gatewayToken = null;
    this.mainWindow = null;
    this.projectIntelService = null;
    this.isReady = false;
    this.gatewayLogPath = null;
    this._gatewayLogStream = null;
    this._postStartSanitizeTimer = null;
    this._uvEnsureTask = null;
    this._securityTimer = null;
    this._securityTaskRunning = false;
    this._lastAutoRotateAt = 0;
    this._lastSecurityCheckAt = 0;
    this._lastSecurityError = '';
    this._startupMaintenanceTask = null;
    this._startupMaintenanceAt = 0;
    this._startupMaintenanceMinIntervalMs = 5 * 60 * 1000;
  }

  setContext({ mainWindow, projectIntelService }) {
    this.mainWindow = mainWindow || null;
    this.projectIntelService = projectIntelService || null;
  }

  async init() {
    if (this.isReady) return;
    const enabled = await dbManager.getSetting('openclaw_enabled');
    this.enabled = enabled === true || enabled === 'true';

    const port = await dbManager.getSetting('openclaw_port');
    if (Number.isFinite(Number(port)) && Number(port) > 0) this.port = Number(port);

    const bridgePort = await dbManager.getSetting('openclaw_bridge_port');
    if (Number.isFinite(Number(bridgePort)) && Number(bridgePort) > 0) this.bridgePort = Number(bridgePort);

    try {
      this._lastAutoRotateAt = Number((await dbManager.getSetting('openclaw_security_last_rotate_at')) || 0) || 0;
    } catch (e) {
      this._lastAutoRotateAt = 0;
    }
    try {
      this._lastSecurityCheckAt = Number((await dbManager.getSetting('openclaw_security_last_check_at')) || 0) || 0;
    } catch (e) {
      this._lastSecurityCheckAt = 0;
    }
    try {
      this._lastSecurityError = String((await dbManager.getSetting('openclaw_security_last_error')) || '');
    } catch (e) {
      this._lastSecurityError = '';
    }

    this.isReady = true;
    this._startSecurityScheduler();
    if (this.enabled) await this.ensureRunning();
  }

  _candidateExecutables() {
    const names = process.platform === 'win32' ? ['openclaw.cmd', 'openclaw.exe', 'openclaw'] : ['openclaw'];
    const candidates = [];

    const binDir = path.join(__dirname, '../bin');
    for (const n of names) candidates.push(path.join(binDir, n));

    if (app.isPackaged) {
      for (const n of names) candidates.push(path.join(process.resourcesPath, 'bin', n));
      for (const n of names) candidates.push(path.join(process.resourcesPath, 'openclaw', n));
    }

    return { names, candidates };
  }

  async _resolveExecutable() {
    const managed = await dbManager.getSetting('openclaw_managed_openclaw_bin');
    if (managed && typeof managed === 'string') {
      try {
        fs.accessSync(managed, fs.constants.X_OK);
        return managed;
      } catch (e) {}
    }

    const { names, candidates } = this._candidateExecutables();

    for (const c of candidates) {
      try {
        fs.accessSync(c, fs.constants.X_OK);
        return c;
      } catch (e) {}
    }

    return findExecutableOnPath(names);
  }

  async _getOpenClawHome() {
    const managedHome = await dbManager.getSetting('openclaw_managed_state_home');
    if (managedHome && typeof managedHome === 'string') return managedHome;
    return path.join(app.getPath('userData'), 'openclaw-state');
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

  _asBool(v, fallback = false) {
    if (v === true || v === 'true' || v === 1 || v === '1') return true;
    if (v === false || v === 'false' || v === 0 || v === '0') return false;
    return !!fallback;
  }

  async _getSecurityConfig() {
    let autoRotateEnabled = true;
    try {
      const raw = await dbManager.getSetting('openclaw_security_auto_rotate_enabled');
      autoRotateEnabled = this._asBool(raw, true);
    } catch (e) {}
    let rotateIntervalMs = OPENCLAW_SECURITY_ROTATE_INTERVAL_MS;
    try {
      const daysRaw = await dbManager.getSetting('openclaw_security_rotate_days');
      const days = Number(daysRaw || 7);
      if (Number.isFinite(days) && days >= 1) {
        rotateIntervalMs = Math.max(24 * 60 * 60 * 1000, Math.round(days * 24 * 60 * 60 * 1000));
      }
    } catch (e) {}
    return { autoRotateEnabled, rotateIntervalMs };
  }

  async _inspectGatewayListeners() {
    const port = Number(this.port || 0);
    if (!Number.isFinite(port) || port <= 0) {
      return { success: false, error: 'invalid_port', listeners: [], localOnly: true };
    }
    const listeners = [];
    try {
      if (process.platform === 'win32') {
        const { stdout } = await execPromise(`netstat -ano -p tcp | findstr :${port}`);
        const lines = String(stdout || '')
          .split('\n')
          .map((x) => String(x || '').trim())
          .filter(Boolean);
        for (const line of lines) {
          const parts = line.split(/\s+/);
          if (parts.length < 5) continue;
          const state = String(parts[3] || '').toUpperCase();
          if (state !== 'LISTENING') continue;
          const localAddr = String(parts[1] || '').trim();
          const pid = Number(parts[4] || 0);
          listeners.push({ addr: localAddr, pid: Number.isFinite(pid) ? pid : null, command: '' });
        }
      } else {
        const { stdout } = await execPromise(`lsof -nP -iTCP:${port} -sTCP:LISTEN`);
        const lines = String(stdout || '')
          .split('\n')
          .map((x) => String(x || '').trim())
          .filter(Boolean);
        for (let i = 1; i < lines.length; i += 1) {
          const line = lines[i];
          const m = line.match(/^(\S+)\s+(\d+)\s+\S+.*\s(TCP\s+.+)$/);
          if (!m) continue;
          const command = String(m[1] || '').trim();
          const pid = Number(m[2] || 0);
          const tcp = String(m[3] || '');
          const n = tcp.match(/TCP\s+(.+?)\s+\(LISTEN\)$/);
          const addr = n ? String(n[1] || '').trim() : '';
          if (!addr) continue;
          listeners.push({ addr, pid: Number.isFinite(pid) ? pid : null, command });
        }
      }
    } catch (e) {
      return { success: false, error: e?.message || 'inspect_failed', listeners: [], localOnly: true };
    }
    const unique = [];
    const seen = new Set();
    for (const it of listeners) {
      const k = `${it.addr}|${it.pid}|${it.command}`;
      if (seen.has(k)) continue;
      seen.add(k);
      unique.push(it);
    }
    const localOnly = unique.every((x) => {
      const a = String(x.addr || '').toLowerCase();
      return (
        a.startsWith('127.0.0.1:') ||
        a.startsWith('[::1]:') ||
        a.startsWith('localhost:') ||
        a.startsWith('::1:')
      );
    });
    return { success: true, listeners: unique, localOnly };
  }

  async _runSecurityMaintenance(reason) {
    if (this._securityTaskRunning) return;
    this._securityTaskRunning = true;
    try {
      this._lastSecurityCheckAt = Date.now();
      try {
        await dbManager.saveSetting('openclaw_security_last_check_at', this._lastSecurityCheckAt);
      } catch (e) {}
      const st = await this.getStatus();
      if (!st?.installed) return;
      const inspect = await this._inspectGatewayListeners();
      if (inspect?.success && !inspect.localOnly) {
        const hasManaged = Array.isArray(inspect.listeners) && inspect.listeners.some((x) => Number(x?.pid) === Number(this.process?.pid));
        const msg = `检测到非本地监听：${(inspect.listeners || []).map((x) => x.addr).join(', ')}`;
        if (hasManaged) {
          await this.stopGateway();
          this.lastError = `${msg}，已自动停止托管 Gateway`;
        } else {
          this.lastError = `${msg}，请先停止外部 Gateway`;
        }
        this._lastSecurityError = this.lastError;
        try {
          await dbManager.saveSetting('openclaw_security_last_error', this._lastSecurityError);
        } catch (e) {}
        return;
      }
      const cfg = await this._getSecurityConfig();
      const due = cfg.autoRotateEnabled && (Date.now() - Number(this._lastAutoRotateAt || 0) >= Number(cfg.rotateIntervalMs || OPENCLAW_SECURITY_ROTATE_INTERVAL_MS));
      if (due) {
        try {
          await this.rotateGatewayToken();
          this._lastAutoRotateAt = Date.now();
          this._lastSecurityError = '';
          try {
            await dbManager.saveSetting('openclaw_security_last_rotate_at', this._lastAutoRotateAt);
            await dbManager.saveSetting('openclaw_security_last_error', '');
          } catch (e) {}
        } catch (e) {
          this._lastSecurityError = String(e?.message || 'auto_rotate_failed');
          try {
            await dbManager.saveSetting('openclaw_security_last_error', this._lastSecurityError);
          } catch (err) {}
        }
      }
    } finally {
      this._securityTaskRunning = false;
    }
  }

  _startSecurityScheduler() {
    try {
      if (this._securityTimer) clearInterval(this._securityTimer);
    } catch (e) {}
    this._securityTimer = setInterval(() => {
      this._runSecurityMaintenance('interval').catch(() => {});
    }, OPENCLAW_SECURITY_CHECK_INTERVAL_MS);
    this._runSecurityMaintenance('startup').catch(() => {});
  }

  _stopSecurityScheduler() {
    try {
      if (this._securityTimer) clearInterval(this._securityTimer);
    } catch (e) {}
    this._securityTimer = null;
  }

  _sanitizeProxyEnv(env) {
    const next = { ...(env || {}) };
    const keys = [
      'HTTP_PROXY',
      'http_proxy',
      'HTTPS_PROXY',
      'https_proxy',
      'ALL_PROXY',
      'all_proxy'
    ];
    for (const k of keys) {
      const raw = next[k];
      if (typeof raw !== 'string') continue;
      const v = raw.trim();
      if (!v) {
        try {
          delete next[k];
        } catch (e) {}
        continue;
      }
      if (v.startsWith('${')) continue;
      if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(v)) continue;
      next[k] = `http://${v}`;
    }
    return next;
  }

  async _injectConfigEnvFallbacks(env, openclawHome) {
    const next = { ...(env || {}) };
    const vars = new Set();
    const paths = [];
    try {
      paths.push(this._openclawConfigPath(openclawHome));
    } catch (e) {}
    try {
      paths.push(path.join(String(openclawHome || ''), 'openclaw.json'));
    } catch (e) {}
    for (const p of paths) {
      try {
        if (!p || !pathExists(p)) continue;
        const txt = await fs.promises.readFile(p, 'utf8');
        const re = /\$\{([A-Z0-9_]+)\}/g;
        let m = null;
        while ((m = re.exec(String(txt || '')))) {
          const k = String(m[1] || '').trim();
          if (k) vars.add(k);
        }
      } catch (e) {}
    }
    for (const k of vars) {
      if (next[k] === undefined || next[k] === null || String(next[k]).trim() === '') next[k] = '__NGOPLANNER_PLACEHOLDER__';
    }
    return next;
  }

  _ensureChildPath(env) {
    const next = { ...(env || {}) };
    const sep = process.platform === 'win32' ? ';' : ':';
    const base = String(next.PATH || process.env.PATH || '');
    const parts = base.split(sep).map((x) => String(x || '').trim()).filter(Boolean);
    const extras = [];
    if (process.platform === 'darwin') {
      extras.push('/usr/local/bin', '/opt/homebrew/bin', '/opt/homebrew/sbin', '/usr/bin', '/bin', '/usr/sbin', '/sbin');
    } else if (process.platform === 'linux') {
      extras.push('/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin');
    }
    const seen = new Set();
    const merged = [];
    for (const p of [...extras, ...parts]) {
      if (!p) continue;
      const key = process.platform === 'win32' ? p.toLowerCase() : p;
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(p);
    }
    if (merged.length) next.PATH = merged.join(sep);
    return next;
  }

  _openclawToolsBin(openclawHome) {
    return path.join(String(openclawHome), '.openclaw', 'tools', 'bin');
  }

  _injectToolsPath(env, openclawHome) {
    const next = { ...(env || {}) };
    const toolsBin = this._openclawToolsBin(openclawHome);
    try {
      if (!fs.existsSync(toolsBin)) return next;
    } catch (e) {
      return next;
    }
    const sep = process.platform === 'win32' ? ';' : ':';
    const cur = String(next.PATH || '');
    const parts = cur.split(sep).map((x) => String(x || '').trim()).filter(Boolean);
    const key = process.platform === 'win32' ? toolsBin.toLowerCase() : toolsBin;
    const has = parts.some((p) => (process.platform === 'win32' ? p.toLowerCase() : p) === key);
    if (has) return next;
    next.PATH = [toolsBin, ...parts].join(sep);
    return next;
  }

  async _downloadToFile(url, destPath, { timeoutMs = 60_000, maxRedirects = 5 } = {}) {
    const u0 = String(url || '').trim();
    if (!u0) throw new Error('invalid_url');
    await fs.promises.mkdir(path.dirname(destPath), { recursive: true });

    const fetchOnce = (u, redirectsLeft) =>
      new Promise((resolve, reject) => {
        const proto = u.startsWith('https:') ? https : http;
        const req = proto.get(u, { headers: { 'User-Agent': 'ngo-planner-openclaw' } }, (res) => {
          const code = Number(res.statusCode || 0);
          const loc = String(res.headers.location || '').trim();
          if ([301, 302, 303, 307, 308].includes(code) && loc && redirectsLeft > 0) {
            try {
              res.resume();
            } catch (e) {}
            const nextUrl = new URL(loc, u).toString();
            resolve(fetchOnce(nextUrl, redirectsLeft - 1));
            return;
          }
          if (code < 200 || code >= 300) {
            try {
              res.resume();
            } catch (e) {}
            reject(new Error(`http_${code}`));
            return;
          }
          const out = fs.createWriteStream(destPath);
          res.pipe(out);
          out.on('finish', () => {
            try {
              out.close();
            } catch (e) {}
            resolve(true);
          });
          out.on('error', (e) => reject(e));
        });
        req.on('error', (e) => reject(e));
        req.setTimeout(timeoutMs, () => {
          try {
            req.destroy(new Error('timeout'));
          } catch (e) {}
        });
      });

    return await fetchOnce(u0, Number.isFinite(Number(maxRedirects)) ? Number(maxRedirects) : 5);
  }

  async _ensureUv(openclawHome) {
    const toolsBin = this._openclawToolsBin(openclawHome);
    const uvName = process.platform === 'win32' ? 'uv.exe' : 'uv';
    const uvxName = process.platform === 'win32' ? 'uvx.exe' : 'uvx';
    const uvPath = path.join(toolsBin, uvName);
    try {
      fs.accessSync(uvPath, fs.constants.X_OK);
      return { success: true, uv: uvPath, skipped: true };
    } catch (e) {}

    if (process.platform !== 'darwin') return { success: false, error: 'unsupported_platform' };
    const arch = process.arch === 'arm64' ? 'aarch64' : 'x86_64';
    const version = '0.10.7';
    const filename = `uv-${arch}-apple-darwin.tar.gz`;
    const url = `https://github.com/astral-sh/uv/releases/download/${version}/${filename}`;

    const tmpRoot = path.join(app.getPath('temp'), 'ngo-planner-openclaw-tools');
    const archivePath = path.join(tmpRoot, `${filename}-${crypto.randomBytes(6).toString('hex')}`);
    const extractDir = path.join(tmpRoot, `uv-extract-${crypto.randomBytes(6).toString('hex')}`);
    try {
      await fs.promises.mkdir(extractDir, { recursive: true });
      await this._downloadToFile(url, archivePath, { timeoutMs: 120_000, maxRedirects: 5 });
      const res = await new Promise((resolve) => {
        const child = spawn('tar', ['-xzf', archivePath, '-C', extractDir], { stdio: ['ignore', 'pipe', 'pipe'] });
        let err = '';
        child.stderr.on('data', (d) => {
          err += String(d || '');
        });
        child.on('close', (code) => resolve({ code, err }));
        child.on('error', (e) => resolve({ code: 1, err: e?.message || 'spawn_failed' }));
      });
      if (Number(res.code) !== 0) return { success: false, error: 'extract_failed', detail: String(res.err || '') };

      await fs.promises.mkdir(toolsBin, { recursive: true });
      const candidates = [path.join(extractDir, uvName), path.join(extractDir, 'uv', uvName)];
      let foundUv = null;
      for (const c of candidates) {
        try {
          fs.accessSync(c, fs.constants.X_OK);
          foundUv = c;
          break;
        } catch (e) {}
      }
      if (!foundUv) {
        try {
          const ents = await fs.promises.readdir(extractDir);
          for (const ent of ents) {
            const full = path.join(extractDir, ent);
            try {
              const st = await fs.promises.stat(full);
              if (st.isFile() && ent === uvName) foundUv = full;
            } catch (e) {}
          }
        } catch (e) {}
      }
      if (!foundUv) return { success: false, error: 'uv_not_found_in_archive' };

      await fs.promises.copyFile(foundUv, uvPath);
      try {
        await fs.promises.chmod(uvPath, 0o755);
      } catch (e) {}

      const uvxCandidates = [path.join(extractDir, uvxName), path.join(extractDir, 'uv', uvxName)];
      for (const c of uvxCandidates) {
        try {
          fs.accessSync(c, fs.constants.X_OK);
          const uvxPath = path.join(toolsBin, uvxName);
          await fs.promises.copyFile(c, uvxPath);
          try {
            await fs.promises.chmod(uvxPath, 0o755);
          } catch (e) {}
          break;
        } catch (e) {}
      }

      return { success: true, uv: uvPath, installed: true };
    } catch (e) {
      return { success: false, error: e?.message || 'uv_install_failed' };
    } finally {
      try {
        await fs.promises.rm(archivePath, { force: true });
      } catch (e) {}
      try {
        await fs.promises.rm(extractDir, { recursive: true, force: true });
      } catch (e) {}
    }
  }

  _ensureUvInBackground(openclawHome) {
    if (this._uvEnsureTask) return this._uvEnsureTask;
    this._uvEnsureTask = (async () => {
      try {
        const res = await this._ensureUv(openclawHome);
        if (!res?.success || !res?.installed) return;
        const running = await isPortOpen(this.port);
        if (!running) return;
        if (!this.process) return;
        await this.restartGateway();
      } catch (e) {}
    })().finally(() => {
      this._uvEnsureTask = null;
    });
    return this._uvEnsureTask;
  }

  _normalizeOpenAIBaseUrl(baseUrl) {
    const raw = String(baseUrl || '').trim();
    if (!raw) return '';
    let cleaned = raw.replace(/\/+$/, '');
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(cleaned) && !cleaned.startsWith('${')) {
      const isLocal = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?(\/|$)/.test(cleaned);
      cleaned = `${isLocal ? 'http' : 'https'}://${cleaned}`;
    }
    if (/\/v1$/i.test(cleaned)) return cleaned;
    return `${cleaned}/v1`;
  }

  _openclawConfigPath(openclawHome) {
    return path.join(String(openclawHome), '.openclaw', 'openclaw.json');
  }

  async _syncMarketplaceSkills(openclawHome) {
    try {
      const loc = await marketplaceService.getLocations();
      const toolsSkills = loc && typeof loc.toolsSkills === 'string' ? loc.toolsSkills : '';
      if (!toolsSkills) return { success: true, synced: [] };
      let entries = [];
      try {
        entries = await fs.promises.readdir(toolsSkills, { withFileTypes: true });
      } catch (e) {
        entries = [];
      }
      const workspaceSkills = path.join(String(openclawHome), '.openclaw', 'workspace', 'skills');
      await fs.promises.mkdir(workspaceSkills, { recursive: true });
      const synced = [];
      for (const ent of entries) {
        if (!ent || !ent.isDirectory()) continue;
        const name = String(ent.name || '').trim();
        if (!name || name === 'ngo-planner-bridge') continue;
        const src = path.join(toolsSkills, name);
        const dest = path.join(workspaceSkills, name);
        try {
          await fs.promises.rm(dest, { recursive: true, force: true });
        } catch (e) {}
        try {
          await fs.promises.cp(src, dest, { recursive: true });
          synced.push(name);
        } catch (e) {}
      }
      return { success: true, synced };
    } catch (e) {
      return { success: false, error: e?.message || 'sync_failed', synced: [] };
    }
  }

  async _readJsonFileSafe(p) {
    try {
      const raw = await fs.promises.readFile(p, 'utf8');
      return JSON.parse(raw || '{}');
    } catch (e) {
      return {};
    }
  }

  async _ensureChannelsConfig(openclawHome, baseConfig) {
    const next = baseConfig && typeof baseConfig === 'object' ? { ...baseConfig } : {};

    const feishuAppId = String((await this._getDecryptedSetting('openclaw_feishu_app_id')) || '').trim();
    const feishuAppSecret = String((await this._getDecryptedSetting('openclaw_feishu_app_secret')) || '').trim();
    const feishuDomain = String((await this._getDecryptedSetting('openclaw_feishu_domain')) || 'feishu').trim() === 'lark' ? 'lark' : 'feishu';

    if (feishuAppId && feishuAppSecret) {
      const channels = next.channels && typeof next.channels === 'object' ? { ...next.channels } : {};
      const feishu = channels.feishu && typeof channels.feishu === 'object' ? { ...channels.feishu } : {};
      const accounts = feishu.accounts && typeof feishu.accounts === 'object' ? { ...feishu.accounts } : {};
      const mainAcc = accounts.main && typeof accounts.main === 'object' ? { ...accounts.main } : {};
      mainAcc.appId = '${FEISHU_APP_ID}';
      mainAcc.appSecret = '${FEISHU_APP_SECRET}';
      accounts.main = mainAcc;
      const defAcc = accounts.default && typeof accounts.default === 'object' ? { ...accounts.default } : {};
      if (!defAcc.appId) defAcc.appId = '${FEISHU_APP_ID}';
      if (!defAcc.appSecret) defAcc.appSecret = '${FEISHU_APP_SECRET}';
      accounts.default = defAcc;
      feishu.enabled = true;
      feishu.dmPolicy = typeof feishu.dmPolicy === 'string' ? feishu.dmPolicy : 'pairing';
      feishu.domain = feishuDomain;
      feishu.accounts = accounts;
      channels.feishu = feishu;
      next.channels = channels;
    }

    return next;
  }

  _scrubSecretsInConfigObject(cfg) {
    const next = cfg && typeof cfg === 'object' ? { ...cfg } : {};
    const channels = next.channels && typeof next.channels === 'object' ? { ...next.channels } : null;
    if (channels && channels.feishu && typeof channels.feishu === 'object') {
      const feishu = { ...channels.feishu };
      const accounts = feishu.accounts && typeof feishu.accounts === 'object' ? { ...feishu.accounts } : {};
      for (const [k, v] of Object.entries(accounts)) {
        const acc = v && typeof v === 'object' ? { ...v } : {};
        const appId = String(acc.appId || '').trim();
        const appSecret = String(acc.appSecret || '').trim();
        if (appId && !appId.startsWith('${')) acc.appId = '${FEISHU_APP_ID}';
        if (appSecret && !appSecret.startsWith('${')) acc.appSecret = '${FEISHU_APP_SECRET}';
        accounts[k] = acc;
      }
      feishu.accounts = accounts;
      channels.feishu = feishu;
      next.channels = channels;
    }
    return next;
  }

  async _scrubSecretsInConfigFiles(openclawHome) {
    const home = String(openclawHome || '').trim();
    if (!home) return { success: false, error: 'invalid_home' };
    const paths = [
      this._openclawConfigPath(home),
      path.join(home, 'openclaw.json')
    ];
    const touched = [];
    for (const p of paths) {
      try {
        const cur = await this._readJsonFileSafe(p);
        const next = this._scrubSecretsInConfigObject(cur);
        if (JSON.stringify(cur || {}) !== JSON.stringify(next || {})) {
          await this._writeJsonFileSafe(p, next);
          touched.push(p);
        }
      } catch (e) {}
    }
    return { success: true, touched };
  }

  async _scrubSecretsInTextFiles(openclawHome, secrets) {
    const home = String(openclawHome || '').trim();
    const values = Array.isArray(secrets)
      ? secrets
          .map((x) => String(x || '').trim())
          .filter((x) => x && !x.startsWith('${') && x.length >= 8 && !/^https?:\/\//i.test(x))
      : [];
    if (!home || values.length === 0) return { success: true, scanned: 0, modified: 0 };

    const candidates = [];
    const pushIfExists = async (p) => {
      try {
        const st = await fs.promises.stat(p);
        if (st && st.isFile()) candidates.push(p);
      } catch (e) {}
    };
    await pushIfExists(path.join(home, 'ngo-planner-openclaw-gateway.log'));
    await pushIfExists(path.join(home, '.openclaw', 'ngo-planner-openclaw-gateway.log'));
    await pushIfExists(path.join(home, '.openclaw', 'ngo-planner-openclaw-agent.log'));

    const walk = async (dir, depth) => {
      if (depth > 6) return;
      let ents = [];
      try {
        ents = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (e) {
        ents = [];
      }
      for (const ent of ents) {
        const name = String(ent?.name || '');
        if (!name) continue;
        const full = path.join(dir, name);
        if (ent.isDirectory()) {
          if (name === 'node_modules' || name === '.git' || name === 'agent') continue;
          await walk(full, depth + 1);
        } else if (ent.isFile()) {
          if (name.endsWith('.jsonl') || name.endsWith('.log')) {
            candidates.push(full);
          }
        }
      }
    };

    await walk(path.join(home, '.openclaw', 'agents'), 0);

    let scanned = 0;
    let modified = 0;
    for (const p of candidates) {
      scanned++;
      try {
        const raw = await fs.promises.readFile(p, 'utf8');
        let next = this._scrubCommonSecretPatterns(raw);
        for (const v of values) {
          if (next.includes(v)) next = next.split(v).join('***REDACTED***');
        }
        if (next !== raw) {
          await fs.promises.writeFile(p, next, { encoding: 'utf8', mode: 0o600 });
          try {
            await fs.promises.chmod(p, 0o600);
          } catch (e) {}
          modified++;
        }
      } catch (e) {}
    }
    return { success: true, scanned, modified };
  }

  async _repairOpenClawAgentCaches(openclawHome) {
    const home = String(openclawHome || '').trim();
    if (!home) return { success: false, error: 'invalid_home' };
    const agentsRoot = path.join(home, '.openclaw', 'agents');
    const targets = [];
    const walk = async (dir, depth) => {
      if (depth > 6) return;
      let ents = [];
      try {
        ents = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (e) {
        ents = [];
      }
      for (const ent of ents) {
        const name = String(ent?.name || '');
        if (!name) continue;
        const full = path.join(dir, name);
        if (ent.isDirectory()) {
          if (name === 'node_modules' || name === '.git' || name === 'sessions') continue;
          await walk(full, depth + 1);
        } else if (ent.isFile()) {
          if (name === 'models.json') targets.push(full);
        }
      }
    };
    await walk(agentsRoot, 0);

    const deleted = [];
    const sanitized = [];
    const needsDeleteBecauseUrlsRedacted = (obj) => {
      const stack = [obj];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object') continue;
        if (Array.isArray(cur)) {
          for (const v of cur) stack.push(v);
          continue;
        }
        for (const [k, v] of Object.entries(cur)) {
          if (v && typeof v === 'object') stack.push(v);
          if (typeof v === 'string' && v === '***REDACTED***' && /(url|baseurl|endpoint)/i.test(String(k))) return true;
        }
      }
      return false;
    };
    const redactSecrets = (obj) => {
      let changed = false;
      const stack = [obj];
      while (stack.length > 0) {
        const cur = stack.pop();
        if (!cur || typeof cur !== 'object') continue;
        if (Array.isArray(cur)) {
          for (const v of cur) stack.push(v);
          continue;
        }
        for (const [k, v] of Object.entries(cur)) {
          if (v && typeof v === 'object') stack.push(v);
          if (typeof v === 'string' && /(apikey|appsecret|secret|token|accesskey)/i.test(String(k)) && v && v !== '***REDACTED***' && !v.startsWith('${')) {
            cur[k] = '***REDACTED***';
            changed = true;
          }
        }
      }
      return changed;
    };
    for (const p of targets) {
      try {
        const raw = await fs.promises.readFile(p, 'utf8');
        let obj = null;
        try {
          obj = JSON.parse(raw || '{}');
        } catch (e) {
          obj = null;
        }
        if (!obj || typeof obj !== 'object') continue;
        if (needsDeleteBecauseUrlsRedacted(obj)) {
          await fs.promises.rm(p, { force: true });
          deleted.push(p);
          continue;
        }
        const changed = redactSecrets(obj);
        if (changed) {
          await this._writeJsonFileSafe(p, obj);
          sanitized.push(p);
        }
      } catch (e) {}
    }
    return { success: true, deleted, sanitized };
  }

  async _cleanupFeishuPluginState(openclawHome) {
    const home = String(openclawHome || '').trim();
    if (!home) return { success: false, error: 'invalid_home' };
    const feishuAppId = String((await this._getDecryptedSetting('openclaw_feishu_app_id')) || '').trim();
    const feishuAppSecret = String((await this._getDecryptedSetting('openclaw_feishu_app_secret')) || '').trim();
    const feishuReady = !!(feishuAppId && feishuAppSecret);
    const extDir = path.join(home, '.openclaw', 'extensions');
    const badDirs = [path.join(extDir, 'feishu'), path.join(extDir, 'feishu-openclaw')];
    for (const d of badDirs) {
      try {
        await fs.promises.rm(d, { recursive: true, force: true });
      } catch (e) {}
    }

    const patchConfig = (cfg) => {
      const next = cfg && typeof cfg === 'object' ? { ...cfg } : {};
      const plugins = next.plugins && typeof next.plugins === 'object' ? { ...next.plugins } : {};
      const entries = plugins.entries && typeof plugins.entries === 'object' ? { ...plugins.entries } : {};
      const installs = plugins.installs && typeof plugins.installs === 'object' ? { ...plugins.installs } : {};
      try { delete installs.feishu; } catch (e) {}
      try { delete installs['feishu-openclaw']; } catch (e) {}
      try { delete entries['feishu-openclaw']; } catch (e) {}
      if (feishuReady) {
        entries.feishu = { ...(entries.feishu && typeof entries.feishu === 'object' ? entries.feishu : {}), enabled: true };
      } else {
        entries.feishu = { ...(entries.feishu && typeof entries.feishu === 'object' ? entries.feishu : {}), enabled: false };
      }
      const allow = Array.isArray(plugins.allow) ? plugins.allow.map((x) => String(x)) : [];
      plugins.allow = feishuReady ? (allow.includes('feishu') ? allow : [...allow, 'feishu']) : allow.filter((x) => x !== 'feishu');
      plugins.entries = entries;
      plugins.installs = installs;
      next.plugins = plugins;
      return next;
    };

    const paths = [this._openclawConfigPath(home), path.join(home, 'openclaw.json')];
    const touched = [];
    for (const p of paths) {
      try {
        const cur = await this._readJsonFileSafe(p);
        const next = patchConfig(cur);
        if (JSON.stringify(cur || {}) !== JSON.stringify(next || {})) {
          await this._writeJsonFileSafe(p, next);
          touched.push(p);
        }
      } catch (e) {}
    }
    return { success: true, touched };
  }

  async _writeJsonFileSafe(p, obj) {
    await fs.promises.mkdir(path.dirname(p), { recursive: true });
    const content = JSON.stringify(obj, null, 2);
    if (process.platform === 'win32') {
      await fs.promises.writeFile(p, content, 'utf8');
      return;
    }
    await fs.promises.writeFile(p, content, { encoding: 'utf8', mode: 0o600 });
    try {
      await fs.promises.chmod(p, 0o600);
    } catch (e) {}
  }

  _safeProviderId(id) {
    return String(id || '')
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 64);
  }

  async _ensureIntegratedModels(openclawHome, opts) {
    const env = {};
    const normalizeStatus = (v, fallback) => {
      const s = String(v || fallback || '').trim().toLowerCase();
      return s === 'paused' ? 'paused' : 'active';
    };

    const deepseekKey = String((await this._getDecryptedSetting('user_api_key_deepseek')) || '').trim();
    const googleKey = String((await this._getDecryptedSetting('user_api_key_google')) || '').trim();
    const deepseekStatus = normalizeStatus(await this._getDecryptedSetting('user_api_status_deepseek'), 'active');
    const googleStatus = normalizeStatus(await this._getDecryptedSetting('user_api_status_google'), 'active');
    const customStatus = normalizeStatus(await this._getDecryptedSetting('user_api_status_custom'), 'paused');
    const selectedCustomId = String((await this._getDecryptedSetting('user_primary_custom_llm_id')) || '').trim();

    const providerPref = String((await this._getDecryptedSetting('user_provider')) || '').trim();
    const deepseekModel = String((await this._getDecryptedSetting('user_model_deepseek')) || 'deepseek-chat').trim() || 'deepseek-chat';
    const googleModel = String((await this._getDecryptedSetting('user_model_google')) || 'gemini-3-flash-preview').trim() || 'gemini-3-flash-preview';
    const deepseekBaseUrlRaw = String((await this._getDecryptedSetting('user_base_url')) || 'https://api.deepseek.com').trim() || 'https://api.deepseek.com';
    const deepseekBaseUrl = this._normalizeOpenAIBaseUrl(deepseekBaseUrlRaw);
    const deepseekActive = !!deepseekKey && deepseekStatus === 'active';
    const googleActive = !!googleKey && googleStatus === 'active';
    const customActive = customStatus === 'active';

    if (deepseekActive) {
      env.NGOPLANNER_DEEPSEEK_API_KEY = deepseekKey;
      env.NGOPLANNER_DEEPSEEK_BASE_URL = deepseekBaseUrl;
    }
    if (googleActive) {
      env.GEMINI_API_KEY = googleKey;
      env.GOOGLE_API_KEY = googleKey;
    }

    const customRaw = await this._getDecryptedSetting('custom_llm_configs');
    let customList = [];
    try {
      if (typeof customRaw === 'string' && customRaw.trim()) customList = JSON.parse(customRaw);
      if (!Array.isArray(customList)) customList = [];
    } catch (e) {
      customList = [];
    }

    const customProviders = {};
    const customPrimaryCandidates = [];
    let selectedCustomPrimary = '';
    for (const c of customList) {
      const id = this._safeProviderId(c?.id || c?.name);
      const modelId = String(c?.modelId || '').trim();
      const baseUrl = this._normalizeOpenAIBaseUrl(c?.baseUrl || '');
      const apiKey = String(c?.apiKey || '').trim();
      const enabled = c?.isEnabled !== false;
      if (!id || !modelId || !baseUrl || !enabled || !customActive) continue;

      const envKeyName = `NGOPLANNER_CUSTOM_${id.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}_API_KEY`;
      if (apiKey) env[envKeyName] = apiKey;

      const providerId = `ngo-${id}`;
      customProviders[providerId] = {
        baseUrl,
        apiKey: apiKey ? `\${${envKeyName}}` : '',
        api: 'openai-completions',
        models: [{ id: modelId, name: String(c?.name || modelId) }]
      };
      const primaryId = `${providerId}/${modelId}`;
      customPrimaryCandidates.push(primaryId);
      if (selectedCustomId && String(c?.id || '').trim() === selectedCustomId) {
        selectedCustomPrimary = primaryId;
      }
    }
    const customPrimary = selectedCustomPrimary || customPrimaryCandidates[0] || '';

    const configPath = this._openclawConfigPath(openclawHome);
    const current = await this._readJsonFileSafe(configPath);

    let next = { ...(current && typeof current === 'object' ? current : {}) };
    const currentModels = next.models && typeof next.models === 'object' ? next.models : {};
    const currentProviders = currentModels.providers && typeof currentModels.providers === 'object' ? currentModels.providers : {};

    const mergedProviders = { ...currentProviders };
    try {
      delete mergedProviders.deepseek;
    } catch (e) {}
    for (const k of Object.keys(mergedProviders)) {
      if (String(k).startsWith('ngo-')) {
        try {
          delete mergedProviders[k];
        } catch (e) {}
      }
    }
    if (deepseekActive) {
      mergedProviders.deepseek = {
        baseUrl: deepseekBaseUrl,
        apiKey: '${NGOPLANNER_DEEPSEEK_API_KEY}',
        api: 'openai-completions',
        models: [{ id: deepseekModel, name: `DeepSeek ${deepseekModel}` }]
      };
    }
    for (const [k, v] of Object.entries(customProviders)) {
      mergedProviders[k] = v;
    }

    next.models = { ...currentModels, mode: 'merge', providers: mergedProviders };

    const agents = next.agents && typeof next.agents === 'object' ? next.agents : {};
    const defaults = agents.defaults && typeof agents.defaults === 'object' ? agents.defaults : {};
    const modelCfg = defaults.model && typeof defaults.model === 'object' ? defaults.model : {};
    const desiredWorkspace = path.join(String(openclawHome), '.openclaw', 'workspace');
    const currentWorkspace = typeof defaults.workspace === 'string' ? defaults.workspace : '';

    let primary = modelCfg.primary;
    const fallbacks = [];
    const addFallback = (id) => {
      if (!id || id === primary) return;
      if (!fallbacks.includes(id)) fallbacks.push(id);
    };

    const wantDeepseekFirst = (providerPref || '').toLowerCase() !== 'google';
    if (customPrimary) {
      primary = customPrimary;
      if (wantDeepseekFirst) {
        if (deepseekActive) addFallback(`deepseek/${deepseekModel}`);
        if (googleActive) addFallback(`google/${googleModel}`);
      } else {
        if (googleActive) addFallback(`google/${googleModel}`);
        if (deepseekActive) addFallback(`deepseek/${deepseekModel}`);
      }
    } else if (deepseekActive && wantDeepseekFirst) {
      primary = `deepseek/${deepseekModel}`;
      if (googleActive) addFallback(`google/${googleModel}`);
    } else if (googleActive) {
      primary = `google/${googleModel}`;
      if (deepseekActive) addFallback(`deepseek/${deepseekModel}`);
    } else if (deepseekActive) {
      primary = `deepseek/${deepseekModel}`;
    }

    next.agents = {
      ...agents,
      defaults: {
        ...defaults,
        workspace: currentWorkspace && currentWorkspace.includes('.staging-') ? desiredWorkspace : (currentWorkspace || desiredWorkspace),
        model: { ...modelCfg, primary, fallbacks }
      }
    };

    const gatewayToken = String((opts && opts.gatewayToken) || (await this._ensureGatewayToken()) || '').trim();
    const gatewayCfg = next.gateway && typeof next.gateway === 'object' ? next.gateway : {};
    const gatewayAuth = gatewayCfg.auth && typeof gatewayCfg.auth === 'object' ? gatewayCfg.auth : {};
    next.gateway = { ...gatewayCfg, port: Number(this.port), mode: 'local', auth: { ...gatewayAuth, token: gatewayToken } };

    try {
      const tools = next.tools && typeof next.tools === 'object' ? { ...next.tools } : {};
      const deny = Array.isArray(tools.deny) ? tools.deny.map((x) => String(x)) : [];
      const mustDeny = [
        'exec',
        'group:runtime',
        'group:automation',
        'group:fs',
        'gateway',
        'cron',
        'sessions_spawn',
        'sessions_send',
        'process'
      ];
      for (const d of mustDeny) {
        if (!deny.includes(d)) deny.push(d);
      }
      tools.deny = deny;
      tools.exec = { ...(tools.exec && typeof tools.exec === 'object' ? tools.exec : {}), security: 'deny', ask: 'always' };
      tools.elevated = { ...(tools.elevated && typeof tools.elevated === 'object' ? tools.elevated : {}), enabled: false };
      tools.fs = { ...(tools.fs && typeof tools.fs === 'object' ? tools.fs : {}), workspaceOnly: true };
      next.tools = tools;
    } catch (e) {}

    try {
      const discovery = next.discovery && typeof next.discovery === 'object' ? { ...next.discovery } : {};
      const mdns = discovery.mdns && typeof discovery.mdns === 'object' ? { ...discovery.mdns } : {};
      if (!mdns.mode) mdns.mode = 'minimal';
      discovery.mdns = mdns;
      next.discovery = discovery;
    } catch (e) {}

    try {
      const logging = next.logging && typeof next.logging === 'object' ? { ...next.logging } : {};
      const patterns = Array.isArray(logging.redactPatterns) ? logging.redactPatterns.map((x) => String(x)) : [];
      const base = [
        'appSecret\\s*[:=]\\s*["\\\']?[^"\\\'\\s]+',
        'openclaw_gateway_token\\s*[:=]\\s*["\\\']?[^"\\\'\\s]+',
        'OPENCLAW_GATEWAY_TOKEN\\s*[:=]\\s*["\\\']?[^"\\\'\\s]+',
        'NGOPLANNER_\\w+_API_KEY\\s*[:=]\\s*["\\\']?[^"\\\'\\s]+'
      ];
      for (const p of base) {
        if (!patterns.includes(p)) patterns.push(p);
      }
      logging.redactPatterns = patterns;
      if (!logging.redactSensitive) logging.redactSensitive = 'tools';
      next.logging = logging;
    } catch (e) {}

    next = await this._ensureChannelsConfig(openclawHome, next);
    try {
      next = this._scrubSecretsInConfigObject(next);
    } catch (e) {}

    const currentStr = JSON.stringify(current || {});
    const nextStr = JSON.stringify(next || {});
    if (currentStr !== nextStr) {
      await this._writeJsonFileSafe(configPath, next);
    }

    try {
      await this._ensureNgoPlannerBridgeSkill(openclawHome);
    } catch (e) {}

    return { env };
  }

  async _ensureNgoPlannerBridgeSkill(openclawHome) {
    const workspaceDir = path.join(String(openclawHome), '.openclaw', 'workspace');
    const skillsDir = path.join(workspaceDir, 'skills', 'ngo-planner-bridge');
    await fs.promises.mkdir(skillsDir, { recursive: true });
    const skillPath = path.join(skillsDir, 'SKILL.md');
    const content = [
      '---',
      'name: ngo-planner-bridge',
      'description: Use NGO Planner local bridge (context, KB, projects, events, org, team, settings) via loopback HTTP with strict scope',
      '---',
      '',
      'This skill teaches the agent how to call NGO Planner’s local, loopback-only bridge.',
      '',
      'Bridge base:',
      '- URL: ${NGOPLANNER_BRIDGE_URL} (default http://127.0.0.1:${NGOPLANNER_BRIDGE_PORT})',
      '- Auth header: Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}',
      '',
      'Security model (must follow):',
      '- File access is sandboxed: you can only read files under folders mounted in NGO Planner Knowledge Base (kb_mounted_folders).',
      '- If a folder/file is marked as privacy-protected, the bridge anonymizes content by default.',
      '- To request raw (non-anonymized) content, send privacyMode="allow". The desktop app will show a mandatory user confirmation dialog.',
      '- Destructive actions (delete) always require user confirmation dialogs in the desktop app.',
      '- Sensitive settings are guarded by allowlists and may require user confirmation dialogs.',
      '- For high-risk operations, the bridge may return error="approval_required". In that case, the request is queued for later approval without blocking the agent.',
      '',
      'Rules:',
      '- All skill endpoints are POST only. Do not use GET for /skills/*.',
      '- There is no endpoint that lists skills. Do not attempt to enumerate endpoints.',
      '- Never print or echo secrets (tokens, env vars). Never include them in final output.',
      '',
      'Preferred calling method (no shell, works in Feishu/webchat):',
      'Use tool `ngo_planner` with JSON parameters:',
      '',
      '```json',
      '{ "path": "/skills/projects/list", "body": {} }',
      '```',
      '',
      'Always include only required fields in body. The tool auto-attaches actor/session metadata.',
      '',
      'Common examples:',
      '',
      'List projects:',
      '```json',
      '{ "path": "/skills/projects/list", "body": {} }',
      '```',
      '',
      'Patch a project (may require approval):',
      '```json',
      '{ "path": "/skills/projects/patch", "body": { "id": "<projectId>", "patch": { "title": "..." } } }',
      '```',
      '',
      'Update a milestone status / completion / evidence (may require approval):',
      '```json',
      '{ "path": "/skills/milestones/update", "body": { "projectId": "<projectId>", "milestoneId": "<milestoneId>", "patch": { "status": "completed", "completionDate": "2026-03-01", "evidenceAdd": ["<feishu_image_id_or_url>"] } } }',
      '```',
      '',
      'Upsert an event (may require approval):',
      '```json',
      '{ "path": "/skills/events/upsert", "body": { "event": { "id": "<id_optional>", "title": "...", "date": "2026-03-01" } } }',
      '```',
      '',
      'Save a social media draft:',
      '```json',
      '{ "path": "/skills/social/draft", "body": { "title": "...", "content": "<html>...</html>", "digest": "...", "author": "AI", "account_id": "optional_app_id" } }',
      '```',
      '',
      'Quick health check (no auth):',
      '',
      'exec:',
      '  command: |',
      '    curl -sS "${NGOPLANNER_BRIDGE_URL}/health"',
      '',
      'Use the exec tool to run curl. Example patterns:',
      '',
      '1) Get work context (project/task scope):',
      '',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/context/get" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"projectId":"<projectId>","milestoneId":"<milestoneId>"}\'',
      '',
      '2) Query local knowledge base (RAG):',
      '',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/kb/query" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"text":"<query>","topK":8,"privacyMode":"anonymize"}\'',
      '',
      '2.1) Check pending approvals (non-destructive):',
      '',
      'List pending approvals:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/approvals/list" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"status":"pending","limit":50}\'',
      '',
      'Get one approval by id:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/approvals/get" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"id":"<approvalId>"}\'',
      '',
      '3) Read a mounted file (sandboxed):',
      '',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/fs/read" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"path":"<absolute_file_path_under_mounts>","maxBytes":240000,"privacyMode":"anonymize"}\'',
      '',
      'If you receive 403 "Path not under mounts":',
      '- Ask the user to mount the folder in NGO Planner Knowledge Base first, then retry.',
      '',
      '3.1) Manage KB mounts (requires user confirmation dialogs):',
      '',
      'List mounts:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/kb/mount/list" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{}\'',
      '',
      'Add a mount (path must be safe; will prompt user confirmation):',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/kb/mount/add" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"path":"<absolute_folder_path>"}\'',
      '',
      'Remove a mount (will prompt user confirmation):',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/kb/mount/remove" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"path":"<absolute_folder_path>"}\'',
      '',
      '3.2) Write a file (sandboxed; many cases require user confirmation):',
      '',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/fs/write" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d @- <<\'JSON\'',
      '    {"path":"<absolute_path_under_mounts_or_artifacts>","mode":"create","privacyMode":"anonymize","content":"Hello"}',
      'JSON',
      '',
      '4) List / get / update projects (use patch, avoid deleting unless user asks):',
      '',
      'List projects:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/projects/list" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{}\'',
      '',
      'Get one project:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/projects/get" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"id":"<projectId>"}\'',
      '',
      'Patch a project (non-destructive):',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/projects/patch" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d @- <<\'JSON\'',
      '    {"id":"<projectId>","patch":{"title":"<new title>","status":"Active"}}',
      'JSON',
      '',
      'Delete a project (destructive, will prompt user confirmation):',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/projects/delete" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"id":"<projectId>"}\'',
      '',
      '5) List / upsert / delete events (calendar) (delete will prompt user confirmation):',
      '',
      'List events:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/events/list" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{}\'',
      '',
      'Upsert event (create if id missing):',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/events/upsert" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d @- <<\'JSON\'',
      '    {"event":{"title":"<title>","date":"<yyyy-mm-dd>","category":"Custom","status":"Active"}}',
      'JSON',
      '',
      'Delete event (destructive, will prompt user confirmation):',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/events/delete" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"id":"<eventId>"}\'',
      '',
      '5.1) Leads (sources) list/upsert/delete (delete will prompt user confirmation):',
      '',
      'List leads:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/leads/list" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{}\'',
      '',
      'Upsert lead (create if id missing):',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/leads/upsert" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d @- <<\'JSON\'',
      '    {"lead":{"name":"<name>","type":"URL","content":"<content>","status":"New","addedAt":1730000000000}}',
      'JSON',
      '',
      'Delete lead (destructive, will prompt user confirmation):',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/leads/delete" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"id":"<leadId>"}\'',
      '',
      '5.2) Saved schedules list/upsert/delete (delete will prompt user confirmation):',
      '',
      'List schedules:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/schedules/list" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{}\'',
      '',
      'Upsert schedule (create if id missing):',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/schedules/upsert" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d @- <<\'JSON\'',
      '    {"schedule":{"title":"<title>","content":"<markdown>","createdAt":1730000000000,"rangeLabel":"<range>"}}',
      'JSON',
      '',
      'Delete schedule (destructive, will prompt user confirmation):',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/schedules/delete" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"id":"<scheduleId>"}\'',
      '',
      '5.3) Network fetch (allowlist + user confirmation for unknown domains):',
      '',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/net/fetch" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"url":"https://example.com","method":"GET"}\'',
      '',
      '5.4) Team & org profile & selection set (some operations require user confirmation):',
      '',
      'Get team:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/team/get" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{}\'',
      '',
      'Upsert team member:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/team/upsert" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d @- <<\'JSON\'',
      '    {"member":{"name":"<name>","nickname":"<nickname>","role":"Volunteer","responsibility":"General","department":"","status":"Active"}}',
      'JSON',
      '',
      'Get org profile:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/org/get" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{}\'',
      '',
      'Set org profile (will prompt user confirmation):',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/org/set" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d @- <<\'JSON\'',
      '    {"profile":{"name":"<org>","description":"<desc>","focusAreas":["教育"]}}',
      'JSON',
      '',
      'Get selected event ids:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/selection/get" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{}\'',
      '',
      'Set selected event ids:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/selection/set" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"ids":["evt-..."]}\'',
      '',
      'Read guarded settings:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/settings/get" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"key":"network_allowlist"}\'',
      '',
      'Write guarded settings (will prompt user confirmation):',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/settings/set" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"key":"network_allowlist","value":["example.com"]}\'',
      '',
      '6) Run ProjectIntel (web list mode):',
      '',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/project-intel/run" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"userQuery":"<query>","urls":[],"keywords":[],"takeScreenshot":true}\'',
      '',
      '6.1) Browse ProjectIntel results (runs + items):',
      '',
      'List runs:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/project-intel/list" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"limit":50}\'',
      '',
      'Get one run:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/project-intel/get" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"runId":"<runId>"}\'',
      '',
      'List items of a run:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/project-intel/items/list" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"runId":"<runId>"}\'',
      '',
      'Update an item:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/project-intel/items/update" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d @- <<\'JSON\'',
      '    {"itemId":"<itemId>","updates":{"snippet":"<new snippet>"}}',
      'JSON',
      '',
      'Export a run:',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/project-intel/export" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"runId":"<runId>"}\'',
      '',
      'Delete a run (destructive, will prompt user confirmation):',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/project-intel/delete" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"runId":"<runId>"}\'',
      '',
      '7) Write reusable artifacts (process + result) to local disk:',
      '',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/artifacts/write" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d @- <<\'JSON\'',
      '    {"projectId":"<projectId>","milestoneId":"<milestoneId>","title":"<title>","kind":"note","content":"# Title\\n\\nBody"}',
      'JSON',
      '',
      'Always store: plan, actions, sources, and a reusable prompt/workflow snippet in the artifact content.',
      '',
      'If you receive 404 for an endpoint:',
      '- The NGO Planner bridge may be running an older build. Ask the user to restart NGO Planner and re-enable OpenClaw integration, then retry.',
      '- Confirm /health capabilities include the endpoint you want.'
    ].join('\n');

    let existing = '';
    try {
      existing = await fs.promises.readFile(skillPath, 'utf8');
    } catch (e) {}
    if (existing !== content) {
      await fs.promises.writeFile(skillPath, content, 'utf8');
    }
  }

  async _copyDirRecursive(src, dst) {
    const from = String(src || '').trim();
    const to = String(dst || '').trim();
    if (!from || !to) return;
    await fs.promises.mkdir(to, { recursive: true });
    const ents = await fs.promises.readdir(from, { withFileTypes: true });
    for (const ent of ents) {
      const name = String(ent?.name || '');
      if (!name) continue;
      const p = path.join(from, name);
      const q = path.join(to, name);
      if (ent.isDirectory()) {
        await this._copyDirRecursive(p, q);
      } else if (ent.isFile()) {
        const buf = await fs.promises.readFile(p);
        await fs.promises.writeFile(q, buf, { mode: 0o600 });
        try {
          await fs.promises.chmod(q, 0o600);
        } catch (e) {}
      }
    }
  }

  async _ensureNgoPlannerBridgeOpenClawPlugin(openclawHome) {
    const home = String(openclawHome || '').trim();
    if (!home) return { success: false, error: 'invalid_home' };
    const pluginId = 'ngo-planner-bridge';
    const src = path.join(__dirname, '../openclaw-extensions', pluginId);
    const dstRoot = path.join(app.getPath('userData'), 'openclaw-managed', 'plugins-cache');
    const dst = path.join(dstRoot, pluginId);
    try {
      await fs.promises.rm(dst, { recursive: true, force: true });
    } catch (e) {}
    try {
      await this._copyDirRecursive(src, dst);
    } catch (e) {
      return { success: false, error: 'plugin_materialize_failed' };
    }

    try {
      const r = await this._runCli(['plugins', 'install', dst], { timeoutMs: 180_000 });
      const next = r ? { ...r, stdout: this._scrubCommonSecretPatterns(r.stdout), stderr: this._scrubCommonSecretPatterns(r.stderr) } : r;
      if (!next?.success) return { success: false, error: 'plugin_install_failed', result: next };
    } catch (e) {
      return { success: false, error: e?.message || 'plugin_install_failed' };
    }

    const patchConfig = (cfg) => {
      const next = cfg && typeof cfg === 'object' ? { ...cfg } : {};
      const plugins = next.plugins && typeof next.plugins === 'object' ? { ...next.plugins } : {};
      const entries = plugins.entries && typeof plugins.entries === 'object' ? { ...plugins.entries } : {};
      const allow = Array.isArray(plugins.allow) ? plugins.allow.map((x) => String(x)) : [];
      if (!allow.includes(pluginId)) allow.push(pluginId);
      entries[pluginId] = { ...(entries[pluginId] && typeof entries[pluginId] === 'object' ? entries[pluginId] : {}), enabled: true };
      plugins.allow = allow;
      plugins.entries = entries;
      next.plugins = plugins;
      return next;
    };

    const paths = [this._openclawConfigPath(home), path.join(home, 'openclaw.json')];
    const touched = [];
    for (const p of paths) {
      try {
        const cur = await this._readJsonFileSafe(p);
        const next = patchConfig(cur);
        if (JSON.stringify(cur || {}) !== JSON.stringify(next || {})) {
          await this._writeJsonFileSafe(p, next);
          touched.push(p);
        }
      } catch (e) {}
    }
    return { success: true, touched };
  }

  _isPidAlive(pid) {
    const n = Number(pid);
    if (!Number.isFinite(n) || n <= 0) return false;
    try {
      process.kill(n, 0);
      return true;
    } catch (e) {
      return false;
    }
  }

  async _getStoredGatewayPid() {
    try {
      const v = await dbManager.getSetting('openclaw_gateway_pid');
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n;
    } catch (e) {}
    return null;
  }

  async _setStoredGatewayPid(pid) {
    try {
      const n = Number(pid);
      await dbManager.saveSetting('openclaw_gateway_pid', Number.isFinite(n) && n > 0 ? n : null);
    } catch (e) {}
  }

  async _cleanupStaleOpenClawSessionLocks(openclawHome) {
    const home = String(openclawHome || '').trim();
    if (!home) return { success: false, error: 'invalid_home' };
    const agentsRoot = path.join(home, '.openclaw', 'agents');
    const targets = [];
    const walk = async (dir, depth) => {
      if (depth > 7) return;
      let ents = [];
      try {
        ents = await fs.promises.readdir(dir, { withFileTypes: true });
      } catch (e) {
        ents = [];
      }
      for (const ent of ents) {
        const name = String(ent?.name || '');
        if (!name) continue;
        const full = path.join(dir, name);
        if (ent.isDirectory()) {
          if (name === 'node_modules' || name === '.git') continue;
          await walk(full, depth + 1);
        } else if (ent.isFile()) {
          if (name.endsWith('.jsonl.lock')) targets.push(full);
        }
      }
    };
    await walk(agentsRoot, 0);
    let scanned = 0;
    let removed = 0;
    for (const p of targets) {
      scanned++;
      let raw = '';
      try {
        raw = await fs.promises.readFile(p, 'utf8');
      } catch (e) {
        continue;
      }
      let pid = null;
      const m1 = raw.match(/\bpid\s*=\s*(\d+)\b/);
      if (m1) pid = Number(m1[1]);
      if (!pid) {
        const m2 = raw.match(/"pid"\s*:\s*(\d+)/);
        if (m2) pid = Number(m2[1]);
      }
      if (!pid || this._isPidAlive(pid)) continue;
      try {
        await fs.promises.rm(p, { force: true });
        removed++;
      } catch (e) {}
    }
    return { success: true, scanned, removed };
  }

  async _ensureBridgeToken() {
    if (this.bridgeToken) return this.bridgeToken;
    const stored = await dbManager.getSetting('openclaw_bridge_token');
    if (stored && typeof stored === 'string' && stored.startsWith('ENC:') && safeStorage.isEncryptionAvailable()) {
      try {
        const buf = Buffer.from(stored.slice(4), 'hex');
        this.bridgeToken = safeStorage.decryptString(buf);
        return this.bridgeToken;
      } catch (e) {}
    }
    if (typeof stored === 'string' && stored && !stored.startsWith('ENC:')) {
      this.bridgeToken = stored;
      return this.bridgeToken;
    }

    const token = crypto.randomBytes(32).toString('hex');
    if (safeStorage.isEncryptionAvailable()) {
      const enc = safeStorage.encryptString(token).toString('hex');
      await dbManager.saveSetting('openclaw_bridge_token', `ENC:${enc}`);
    } else {
      await dbManager.saveSetting('openclaw_bridge_token', token);
    }
    this.bridgeToken = token;
    return token;
  }

  async _ensureGatewayToken() {
    if (this.gatewayToken) return this.gatewayToken;
    const stored = await dbManager.getSetting('openclaw_gateway_token');
    if (stored && typeof stored === 'string' && stored.startsWith('ENC:') && safeStorage.isEncryptionAvailable()) {
      try {
        const buf = Buffer.from(stored.slice(4), 'hex');
        this.gatewayToken = safeStorage.decryptString(buf);
        return this.gatewayToken;
      } catch (e) {}
    }
    if (typeof stored === 'string' && stored && !stored.startsWith('ENC:')) {
      this.gatewayToken = stored;
      return this.gatewayToken;
    }

    const token = crypto.randomBytes(32).toString('hex');
    if (safeStorage.isEncryptionAvailable()) {
      const enc = safeStorage.encryptString(token).toString('hex');
      await dbManager.saveSetting('openclaw_gateway_token', `ENC:${enc}`);
    } else {
      await dbManager.saveSetting('openclaw_gateway_token', token);
    }
    this.gatewayToken = token;
    try {
      const openclawHome = await this._getOpenClawHome();
      const cfgPath = this._openclawConfigPath(openclawHome);
      const cur = await this._readJsonFileSafe(cfgPath);
      const next = { ...(cur && typeof cur === 'object' ? cur : {}) };
      const g = next.gateway && typeof next.gateway === 'object' ? { ...next.gateway } : {};
      const auth = g.auth && typeof g.auth === 'object' ? { ...g.auth } : {};
      auth.token = token;
      g.auth = auth;
      if (!g.port) g.port = Number(this.port) || g.port;
      next.gateway = g;
      await this._writeJsonFileSafe(cfgPath, next);
      try {
        const rootCfgPath = path.join(String(openclawHome), 'openclaw.json');
        const cur2 = await this._readJsonFileSafe(rootCfgPath);
        const next2 = { ...(cur2 && typeof cur2 === 'object' ? cur2 : {}) };
        const g2 = next2.gateway && typeof next2.gateway === 'object' ? { ...next2.gateway } : {};
        const auth2 = g2.auth && typeof g2.auth === 'object' ? { ...g2.auth } : {};
        auth2.token = token;
        g2.auth = auth2;
        if (!g2.port) g2.port = Number(this.port) || g2.port;
        next2.gateway = g2;
        await this._writeJsonFileSafe(rootCfgPath, next2);
      } catch (e) {}
    } catch (e) {}
    return token;
  }

  async getGatewayToken() {
    if (!this.isReady) await this.init();
    return this._ensureGatewayToken();
  }

  async getBridgeToken() {
    if (!this.isReady) await this.init();
    return this._ensureBridgeToken();
  }

  async rotateBridgeToken() {
    if (!this.isReady) await this.init();
    try {
      await dbManager.saveSetting('openclaw_bridge_token', null);
    } catch (e) {}
    this.bridgeToken = null;
    return this._ensureBridgeToken();
  }

  async rotateGatewayToken() {
    if (!this.isReady) await this.init();
    const running = await isPortOpen(this.port);
    if (running && !this.process) {
      throw new Error('检测到外部 Gateway 运行中，无法在应用内重置鉴权');
    }
    try {
      await dbManager.saveSetting('openclaw_gateway_token', null);
    } catch (e) {}
    this.gatewayToken = null;
    const token = await this._ensureGatewayToken();
    if (this.process) {
      await this.stopGateway();
      await this.startGateway();
    }
    this._lastAutoRotateAt = Date.now();
    this._lastSecurityError = '';
    try {
      await dbManager.saveSetting('openclaw_security_last_rotate_at', this._lastAutoRotateAt);
      await dbManager.saveSetting('openclaw_security_last_error', '');
    } catch (e) {}
    return token;
  }

  async getSecurityStatus() {
    if (!this.isReady) await this.init();
    const cfg = await this._getSecurityConfig();
    const inspect = await this._inspectGatewayListeners();
    const tokenConfigured = !!(await this._ensureGatewayToken());
    const nextRotateAt = cfg.autoRotateEnabled
      ? (Number(this._lastAutoRotateAt || 0) > 0 ? Number(this._lastAutoRotateAt || 0) + Number(cfg.rotateIntervalMs || OPENCLAW_SECURITY_ROTATE_INTERVAL_MS) : Date.now())
      : null;
    return {
      success: true,
      autoRotateEnabled: cfg.autoRotateEnabled,
      rotateIntervalDays: Math.max(1, Math.round(Number(cfg.rotateIntervalMs || OPENCLAW_SECURITY_ROTATE_INTERVAL_MS) / (24 * 60 * 60 * 1000))),
      lastRotateAt: Number(this._lastAutoRotateAt || 0) || null,
      nextRotateAt,
      lastCheckAt: Number(this._lastSecurityCheckAt || 0) || null,
      localBindOnly: inspect?.success ? !!inspect.localOnly : null,
      listeners: Array.isArray(inspect?.listeners) ? inspect.listeners : [],
      lastError: String(this._lastSecurityError || '')
    };
  }

  async setSecurityConfig(payload) {
    if (!this.isReady) await this.init();
    const p = payload && typeof payload === 'object' ? payload : {};
    const autoRotateEnabled = p.autoRotateEnabled === undefined ? true : this._asBool(p.autoRotateEnabled, true);
    const daysRaw = Number(p.rotateIntervalDays || 7);
    const rotateIntervalDays = Number.isFinite(daysRaw) ? Math.max(1, Math.round(daysRaw)) : 7;
    await dbManager.saveSetting('openclaw_security_auto_rotate_enabled', autoRotateEnabled);
    await dbManager.saveSetting('openclaw_security_rotate_days', rotateIntervalDays);
    await this._runSecurityMaintenance('config_update');
    return this.getSecurityStatus();
  }

  async hardenSecurityNow(payload) {
    if (!this.isReady) await this.init();
    const p = payload && typeof payload === 'object' ? payload : {};
    const enableAutoRotate = p.enableAutoRotate === undefined ? true : this._asBool(p.enableAutoRotate, true);
    const rotateIntervalDays = Math.max(1, Math.round(Number(p.rotateIntervalDays || 7)));
    await dbManager.saveSetting('openclaw_security_auto_rotate_enabled', enableAutoRotate);
    await dbManager.saveSetting('openclaw_security_rotate_days', rotateIntervalDays);

    const inspect = await this._inspectGatewayListeners();
    if (inspect?.success && !inspect.localOnly) {
      const hasManaged = Array.isArray(inspect.listeners) && inspect.listeners.some((x) => Number(x?.pid) === Number(this.process?.pid));
      if (hasManaged) {
        await this.stopGateway();
        await this.startGateway();
      }
      const inspect2 = await this._inspectGatewayListeners();
      if (inspect2?.success && !inspect2.localOnly) {
        const msg = `仍存在非本地监听：${(inspect2.listeners || []).map((x) => x.addr).join(', ')}`;
        this._lastSecurityError = msg;
        await dbManager.saveSetting('openclaw_security_last_error', msg);
        return { success: false, error: 'non_local_listen_detected', detail: msg, status: await this.getSecurityStatus() };
      }
    }

    await this.rotateGatewayToken();
    this._lastAutoRotateAt = Date.now();
    this._lastSecurityError = '';
    await dbManager.saveSetting('openclaw_security_last_rotate_at', this._lastAutoRotateAt);
    await dbManager.saveSetting('openclaw_security_last_error', '');
    await this._runSecurityMaintenance('harden_now');
    return { success: true, status: await this.getSecurityStatus() };
  }

  async syncBridgeSkill() {
    if (!this.isReady) await this.init();
    const openclawHome = await this._getOpenClawHome();
    await this._ensureNgoPlannerBridgeSkill(openclawHome);
    const s = await this._syncMarketplaceSkills(openclawHome);
    return { success: true, openclawHome, syncedSkills: s?.synced || [] };
  }

  async getGatewayLogTail(lines = 200) {
    const p = this.gatewayLogPath && pathExists(this.gatewayLogPath) ? this.gatewayLogPath : null;
    const tail = await readTailText(p, { maxLines: Number(lines) || 200 });
    return { success: true, logPath: p, text: tail };
  }

  async getAgentLogTail(lines = 200) {
    const openclawHome = await this._getOpenClawHome();
    const p = path.join(openclawHome, '.openclaw', 'ngo-planner-openclaw-agent.log');
    const logPath = pathExists(p) ? p : null;
    const tail = await readTailText(logPath, { maxLines: Number(lines) || 200 });
    return { success: true, logPath, text: tail };
  }

  async getRuntimeLogTail(lines = 200) {
    let logPath = null;
    try {
      const dir = '/tmp/openclaw';
      const ents = await fs.promises.readdir(dir, { withFileTypes: true });
      const files = [];
      for (const ent of ents) {
        if (!ent.isFile()) continue;
        const name = String(ent.name || '');
        if (!name.startsWith('openclaw-') || !name.endsWith('.log')) continue;
        const full = path.join(dir, name);
        try {
          const st = await fs.promises.stat(full);
          files.push({ full, mtimeMs: Number(st?.mtimeMs || 0) });
        } catch (e) {}
      }
      files.sort((a, b) => b.mtimeMs - a.mtimeMs);
      logPath = files[0]?.full || null;
    } catch (e) {
      logPath = null;
    }
    const tail = await readTailText(logPath, { maxLines: Number(lines) || 200 });
    return { success: true, logPath, text: tail };
  }

  async ensureRunning() {
    if (!this.isReady) await this.init();

    let openclawHome = null;
    try {
      openclawHome = await this._getOpenClawHome();
    } catch (e) {
      if (e && e.message) this.lastError = String(e.message);
    }

    let running = await isPortOpen(this.port);
    if (!running) {
      const started = await this.startGateway();
      if (!started?.success) {
        if (started?.error) this.lastError = String(started.error);
        return this.getStatus();
      }
    }

    running = await isPortOpen(this.port);
    if (!running) {
      if (!this.lastError) this.lastError = 'OpenClaw Gateway 未运行';
      return this.getStatus();
    }

    if (this.enabled) {
      const bridge = await this.startBridge();
      if (!bridge?.success && bridge?.error) this.lastError = String(bridge.error);
    }
    this._scheduleStartupMaintenance(openclawHome);
    return this.getStatus();
  }

  _scheduleStartupMaintenance(openclawHome, opts) {
    const home = String(openclawHome || '').trim();
    if (!home) return;
    const force = !!(opts && opts.force);
    if (this._startupMaintenanceTask) return;
    const now = Date.now();
    if (!force && now - Number(this._startupMaintenanceAt || 0) < Number(this._startupMaintenanceMinIntervalMs || 0)) {
      return;
    }

    this._startupMaintenanceTask = (async () => {
      try {
        this._ensureUvInBackground(home);
      } catch (e) {}
      try {
        await this._ensureNgoPlannerBridgeSkill(home);
      } catch (e) {}
      try {
        await this._ensureNgoPlannerBridgeOpenClawPlugin(home);
      } catch (e) {}
      try {
        await this._syncMarketplaceSkills(home);
      } catch (e) {}
      try {
        await this.ensureDefaultUtilitySkills();
      } catch (e) {}
    })()
      .finally(() => {
        this._startupMaintenanceAt = Date.now();
        this._startupMaintenanceTask = null;
      });
  }

  async diagnoseGatewayPort() {
    const port = Number(this.port || 0);
    if (!Number.isFinite(port) || port <= 0) return { success: false, error: 'invalid_port' };

    let pids = [];
    let commands = [];
    try {
      if (process.platform === 'win32') {
        const { stdout } = await execPromise(`netstat -aon | findstr :${port}`);
        const lines = String(stdout || '')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        for (const line of lines) {
          const parts = line.split(/\s+/);
          if (parts.length < 5) continue;
          const localAddr = String(parts[1] || '');
          const state = String(parts[3] || '').toUpperCase();
          const pid = Number(parts[4] || 0);
          if (state !== 'LISTENING') continue;
          if (!localAddr.endsWith(`:${port}`)) continue;
          if (Number.isFinite(pid) && pid > 0) pids.push(pid);
        }
      } else {
        const { stdout } = await execPromise(`lsof -nP -iTCP:${port} -sTCP:LISTEN -Fp -Fc`);
        const lines = String(stdout || '')
          .split('\n')
          .map((l) => l.trim())
          .filter(Boolean);
        for (const line of lines) {
          if (line.startsWith('p')) {
            const pid = Number(line.slice(1));
            if (Number.isFinite(pid) && pid > 0) pids.push(pid);
          } else if (line.startsWith('c')) {
            const cmd = String(line.slice(1) || '').trim();
            if (cmd) commands.push(cmd);
          }
        }
      }
    } catch (e) {}

    pids = Array.from(new Set(pids));
    commands = Array.from(new Set(commands));

    const html = await new Promise((resolve) => {
      const url = `http://127.0.0.1:${port}/`;
      const req = http.request(url, { method: 'GET', timeout: 1500 }, (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += String(c || '');
          if (raw.length > 200_000) {
            try {
              res.destroy();
            } catch (e) {}
          }
        });
        res.on('end', () => resolve(raw));
      });
      req.on('timeout', () => {
        try {
          req.destroy();
        } catch (e) {}
        resolve('');
      });
      req.on('error', () => resolve(''));
      req.end();
    });

    const lc = String(html || '').toLowerCase();
    const looksLikeOpenClaw = lc.includes('openclaw') && (lc.includes('dashboard') || lc.includes('control'));

    return { success: true, port, pids, commands, looksLikeOpenClaw };
  }

  async takeoverGateway(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const confirm = p.confirm === true;

    await this.init();
    const st0 = await this.getStatus();
    if (!st0?.gateway?.running) {
      await this.startGateway();
      if (this.enabled) await this.startBridge();
      return { success: true, status: await this.getStatus() };
    }
    if (st0?.gateway?.managedByApp) return { success: true, status: st0 };

    const diag = await this.diagnoseGatewayPort();
    if (!diag?.success) return { success: false, error: diag?.error || 'diagnose_failed' };
    if (!diag.looksLikeOpenClaw) return { success: false, error: 'port_not_openclaw', diag };
    if (!confirm) return { success: false, error: 'confirm_required', diag };

    const killed = [];
    const failed = [];
    for (const pid of Array.isArray(diag.pids) ? diag.pids : []) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (e) {}
    }
    await new Promise((r) => setTimeout(r, 600));
    for (const pid of Array.isArray(diag.pids) ? diag.pids : []) {
      try {
        process.kill(pid, 'SIGKILL');
        killed.push(pid);
      } catch (e) {
        failed.push(pid);
      }
    }

    try {
      await this._setStoredGatewayPid(null);
    } catch (e) {}
    this.process = null;

    const stillRunning = await isPortOpen(this.port);
    if (stillRunning) return { success: false, error: 'port_still_busy', diag, killed, failed };

    await this.startGateway();
    if (this.enabled) await this.startBridge();
    return { success: true, status: await this.getStatus(), diag, killed, failed };
  }

  async startGateway() {
    const exe = await this._resolveExecutable();
    if (!exe) {
      this.lastError = 'OpenClaw 未安装或未在 PATH 中找到';
      return { success: false, error: this.lastError };
    }

    if (this.process) return { success: true };

    try {
      const args = ['gateway', '--port', String(this.port), '--allow-unconfigured'];
      const openclawHome = await this._getOpenClawHome();
      try {
        fs.mkdirSync(openclawHome, { recursive: true });
      } catch (e) {}
      const gatewayLogPath = path.join(openclawHome, 'ngo-planner-openclaw-gateway.log');
      try {
        await fs.promises.mkdir(path.dirname(gatewayLogPath), { recursive: true });
        this.gatewayLogPath = gatewayLogPath;
        try {
          this._gatewayLogStream?.end?.();
        } catch (e) {}
        this._gatewayLogStream = fs.createWriteStream(gatewayLogPath, { flags: 'a' });
        this._gatewayLogStream.write(`\n[${new Date().toISOString()}] gateway start\n`);
      } catch (e) {
        this.gatewayLogPath = null;
      }
      const token = await this._ensureBridgeToken();
      const gatewayToken = await this._ensureGatewayToken();
      try {
        await this._scrubSecretsInConfigFiles(openclawHome);
      } catch (e) {}
      try {
        await this._cleanupFeishuPluginState(openclawHome);
      } catch (e) {}
      try {
        await this._repairOpenClawAgentCaches(openclawHome);
      } catch (e) {}
      try {
        await this._cleanupStaleOpenClawSessionLocks(openclawHome);
      } catch (e) {}

      let integrated = { env: {} };
      try {
        integrated = await this._ensureIntegratedModels(openclawHome, { gatewayToken });
      } catch (e) {}
      const feishuAppId = String((await this._getDecryptedSetting('openclaw_feishu_app_id')) || '').trim();
      const feishuAppSecret = String((await this._getDecryptedSetting('openclaw_feishu_app_secret')) || '').trim();
      const bridgeUrl = `http://127.0.0.1:${this.bridgePort}`;
      let env = this._sanitizeProxyEnv({
        ...process.env,
        OPENCLAW_HOME: openclawHome,
        OPENCLAW_GATEWAY_TOKEN: gatewayToken,
        NGOPLANNER_BRIDGE_TOKEN: token,
        NGOPLANNER_BRIDGE_PORT: String(this.bridgePort),
        NGOPLANNER_BRIDGE_URL: bridgeUrl,
        ...(feishuAppId ? { FEISHU_APP_ID: feishuAppId } : {}),
        ...(feishuAppSecret ? { FEISHU_APP_SECRET: feishuAppSecret } : {}),
        ...(integrated?.env || {})
      });
      env = await this._injectConfigEnvFallbacks(env, openclawHome);
      env = this._injectToolsPath(this._ensureChildPath(env), openclawHome);
      this.process = spawn(exe, args, { stdio: ['ignore', 'pipe', 'pipe'], env });
      try {
        await this._setStoredGatewayPid(this.process?.pid);
      } catch (e) {}

      this.process.stdout.on('data', (d) => {
        try {
          this._gatewayLogStream?.write?.(String(d || ''));
        } catch (e) {}
      });
      this.process.stderr.on('data', (d) => {
        const msg = String(d || '').trim();
        if (msg) this.lastError = msg;
        try {
          this._gatewayLogStream?.write?.(String(d || ''));
        } catch (e) {}
      });
      this.process.on('close', (code) => {
        this.process = null;
        try {
          this._setStoredGatewayPid(null).catch(() => {});
        } catch (e) {}
        try {
          this._gatewayLogStream?.write?.(`\n[${new Date().toISOString()}] gateway close code=${code}\n`);
        } catch (e) {}
        try {
          this._gatewayLogStream?.end?.();
        } catch (e) {}
        this._gatewayLogStream = null;
      });

      const ready = await waitForPortOpen(this.port, 45_000);
      if (!ready) {
        try {
          this.process?.kill?.('SIGKILL');
        } catch (e) {}
        this.process = null;
        this.lastError = 'OpenClaw Gateway 启动超时';
        return { success: false, error: this.lastError };
      }

      try {
        await this._repairOpenClawAgentCaches(openclawHome);
      } catch (e) {}
      try {
        if (this._postStartSanitizeTimer) clearTimeout(this._postStartSanitizeTimer);
      } catch (e) {}
      this._postStartSanitizeTimer = setTimeout(async () => {
        try {
          await this._repairOpenClawAgentCaches(openclawHome);
        } catch (e) {}
        try {
          await this._scrubSecretsInTextFiles(openclawHome, [
            feishuAppSecret,
            feishuAppId,
            gatewayToken,
            token,
            ...(integrated && integrated.env && typeof integrated.env === 'object' ? Object.values(integrated.env) : [])
          ]);
        } catch (e) {}
      }, 30_000);
      this._scheduleStartupMaintenance(openclawHome, { force: true });

      return { success: true };
    } catch (e) {
      this.lastError = e.message;
      this.process = null;
      return { success: false, error: e.message };
    }
  }

  async stopGateway() {
    this._stopSecurityScheduler();
    const p = this.process;
    let pid = null;
    try {
      pid = p?.pid || (await this._getStoredGatewayPid());
    } catch (e) {
      pid = p?.pid || null;
    }

    if (this._postStartSanitizeTimer) {
      try {
        clearTimeout(this._postStartSanitizeTimer);
      } catch (e) {}
    }
    this._postStartSanitizeTimer = null;
    if (p) {
      try {
        p.kill('SIGTERM');
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 800));
      try {
        p.kill('SIGKILL');
      } catch (e) {}
    } else if (pid && this._isPidAlive(pid)) {
      try {
        process.kill(pid, 'SIGTERM');
      } catch (e) {}
      await new Promise((r) => setTimeout(r, 800));
      try {
        process.kill(pid, 'SIGKILL');
      } catch (e) {}
    }
    this.process = null;
    try {
      await this._setStoredGatewayPid(null);
    } catch (e) {}
    try {
      this._gatewayLogStream?.end?.();
    } catch (e) {}
    this._gatewayLogStream = null;
    return { success: true };
  }

  async forceStopForExit() {
    this._stopSecurityScheduler();
    if (this._postStartSanitizeTimer) {
      try {
        clearTimeout(this._postStartSanitizeTimer);
      } catch (e) {}
      this._postStartSanitizeTimer = null;
    }
    const pid = this.process?.pid || (await this._getStoredGatewayPid()) || null;
    try {
      await this.stopBridge();
    } catch (e) {}
    try {
      await this.stopGateway();
    } catch (e) {}
    if (pid && this._isPidAlive(pid)) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch (e) {}
    }
    try {
      await this._setStoredGatewayPid(null);
    } catch (e) {}
    return { success: true };
  }

  async startBridge() {
    if (this.bridgeServer) return { success: true, port: this.bridgePort };
    await this._ensureBridgeToken();

    this.bridgeServer = http.createServer(async (req, res) => {
      try {
        const url = new URL(req.url || '/', 'http://127.0.0.1');
        const auth = String(req.headers.authorization || '');
        const okAuth = auth === `Bearer ${this.bridgeToken}`;

        if (url.pathname === '/health') {
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: true,
              name: 'ngo-planner-openclaw-bridge',
              version: app.getVersion(),
              apiVersion: 1,
              policy: {
                sandbox: 'kb_mounts_only',
                privacyDefault: 'anonymize',
                rawContentRequiresConfirmation: true,
                destructiveRequiresConfirmation: true,
                network: {
                  transport: 'app_proxy_allowlist',
                  httpLocalOnly: true,
                  methods: ['GET', 'POST']
                }
              },
              capabilities: OPENCLAW_BRIDGE_CAPABILITIES.map((x) => x.id)
            })
          );
          return;
        }

        if (!okAuth) {
          res.writeHead(401, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Unauthorized' }));
          return;
        }

        if (req.method !== 'POST') {
          res.writeHead(405, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Method not allowed' }));
          return;
        }

        const body = await readJsonBody(req);
        if (!body) {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'Invalid JSON' }));
          return;
        }

        const normalizeActor = (a) => {
          const x = a && typeof a === 'object' ? a : {};
          const messageChannel = String(x.messageChannel || '').trim().toLowerCase();
          const sessionKey = String(x.sessionKey || '').trim();
          const agentId = String(x.agentId || '').trim();
          return { messageChannel, sessionKey, agentId };
        };

        const actor = normalizeActor(body.actor);
        const scopeKey = actor.messageChannel && actor.sessionKey ? `${actor.messageChannel}:${actor.sessionKey}` : (actor.sessionKey || actor.messageChannel || 'unknown');
        const asTextPreview = (v, max = 140) => {
          const s = typeof v === 'string' ? v : JSON.stringify(v || {});
          return String(s || '').replace(/\s+/g, ' ').slice(0, max);
        };
        const requireGrant = async ({ action, summary, request } = {}) => {
          const a = String(action || '').trim();
          if (!a) return { ok: false, error: 'invalid_action' };
          const granted = await agentApprovalService.isGranted({ action: a, scopeKey });
          if (granted) return { ok: true };
          const approval = await agentApprovalService.enqueue({
            action: a,
            scopeKey,
            summary: String(summary || `需要授权：${a}`).trim().slice(0, 400),
            request: request && typeof request === 'object' ? request : { value: request }
          });
          await writeAudit({ action: a, allowed: false, reason: 'approval_required', scopeKey, approvalId: approval.id, actor });
          return { ok: false, error: 'approval_required', approvalId: approval.id };
        };

        const gateActionByPath = {
          '/skills/projects/patch': 'projects_patch',
          '/skills/milestones/update': 'milestones_update',
          '/skills/events/upsert': 'events_upsert',
          '/skills/events/delete': 'events_delete',
          '/skills/team/upsert': 'team_upsert',
          '/skills/team/delete': 'team_delete',
          '/skills/org/set': 'org_set',
          '/skills/selection/set': 'selection_set',
          '/skills/settings/set': 'settings_set',
          '/skills/leads/upsert': 'leads_upsert',
          '/skills/leads/delete': 'leads_delete',
          '/skills/schedules/upsert': 'schedules_upsert',
          '/skills/schedules/delete': 'schedules_delete',
          '/skills/artifacts/write': 'artifacts_write'
        };
        const gateAction = gateActionByPath[url.pathname];
        if (gateAction) {
          const gate = await requireGrant({
            action: gateAction,
            summary: `授权执行：${gateAction}`,
            request: { path: url.pathname, preview: asTextPreview(body) }
          });
          if (!gate.ok) {
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: gate.error, approvalId: gate.approvalId }));
            return;
          }
        }

        if (url.pathname === '/skills/agent/execute') {
          res.writeHead(410, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: 'deprecated', hint: 'Use /skills/* endpoints directly via the ngo_planner tool.' }));
          return;
        }

        if (url.pathname === '/skills/capabilities/catalog') {
          const keyword = String(body.keyword || '').trim().toLowerCase();
          const category = String(body.category || '').trim().toLowerCase();
          const list = OPENCLAW_BRIDGE_CAPABILITIES.filter((x) => {
            if (category && String(x.category || '').toLowerCase() !== category) return false;
            if (!keyword) return true;
            const hay = `${x.id} ${x.path} ${x.description} ${x.category}`.toLowerCase();
            return hay.includes(keyword);
          });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, count: list.length, capabilities: list }));
          return;
        }

        if (url.pathname === '/skills/capabilities/get') {
          const id = String(body.id || '').trim();
          const p = String(body.path || '').trim();
          const cap = (id && OPENCLAW_BRIDGE_CAPABILITY_BY_ID[id]) || (p && OPENCLAW_BRIDGE_CAPABILITY_BY_PATH[p]) || null;
          if (!cap) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'capability_not_found' }));
            return;
          }
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, capability: cap }));
          return;
        }

        if (url.pathname === '/skills/project-intel/run') {
          if (!this.projectIntelService) {
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'ProjectIntel service unavailable' }));
            return;
          }

          const userQuery = String(body.userQuery || '');
          const urls = Array.isArray(body.urls) ? body.urls : [];
          const keywords = Array.isArray(body.keywords) ? body.keywords : [];
          const policy = await agentApprovalService.getPolicy();
          const granted = await agentApprovalService.isGranted({ action: 'project_intel_run', scopeKey: 'global' });
          const shouldAllow = !!policy?.autoApprove?.projectIntelRun || granted;
          if (!shouldAllow) {
            const approval = await agentApprovalService.enqueue({
              action: 'project_intel_run',
              scopeKey: 'global',
              summary: `ProjectIntel：${userQuery || '联网情报任务'}`.slice(0, 400),
              request: { userQuery, urlsCount: urls.length, keywordsCount: keywords.length }
            });
            await writeAudit({ action: 'project_intel_run', allowed: false, reason: 'approval_required', approvalId: approval.id });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'approval_required', approvalId: approval.id }));
            return;
          }

          const createRes = await this.projectIntelService.createRun({
            mode: 'web_list',
            userQuery,
            urls,
            keywords,
            plan: body.plan || {}
          });
          if (!createRes || !createRes.success) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: createRes?.error || 'createRun failed' }));
            return;
          }

          const startRes = await this.projectIntelService.startRun(createRes.runId, {
            takeScreenshot: body.takeScreenshot !== undefined ? !!body.takeScreenshot : true,
            autoContinueAfterLogin: !!body.autoContinueAfterLogin,
            limits: typeof body.limits === 'object' && body.limits ? body.limits : undefined
          });
          await writeAudit({ action: 'project_intel_run', allowed: true, runId: createRes.runId });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, runId: createRes.runId, start: startRes }));
          return;
        }

        if (url.pathname === '/skills/project-intel/list') {
          if (!this.projectIntelService?.listRuns) {
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'ProjectIntel service unavailable' }));
            return;
          }
          const limit = Number.isFinite(Number(body.limit)) ? Math.max(1, Math.min(Number(body.limit), 200)) : 50;
          const out = await this.projectIntelService.listRuns(limit);
          await writeAudit({ action: 'project_intel_list', allowed: true, limit });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, ...(out || {}) }));
          return;
        }

        if (url.pathname === '/skills/project-intel/get') {
          if (!this.projectIntelService?.getRun) {
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'ProjectIntel service unavailable' }));
            return;
          }
          const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
          if (!runId) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'runId required' }));
            return;
          }
          const out = await this.projectIntelService.getRun(runId);
          await writeAudit({ action: 'project_intel_get', allowed: !!out?.success, runId });
          res.writeHead(out?.success ? 200 : 404, { 'content-type': 'application/json' });
          res.end(JSON.stringify(out?.success ? { success: true, run: out.run } : { success: false, error: out?.error || 'not_found' }));
          return;
        }

        if (url.pathname === '/skills/project-intel/items/list') {
          if (!this.projectIntelService?.listItems) {
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'ProjectIntel service unavailable' }));
            return;
          }
          const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
          if (!runId) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'runId required' }));
            return;
          }
          const out = await this.projectIntelService.listItems(runId);
          await writeAudit({ action: 'project_intel_items_list', allowed: true, runId });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, ...(out || {}) }));
          return;
        }

        if (url.pathname === '/skills/project-intel/items/update') {
          if (!this.projectIntelService?.updateItem) {
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'ProjectIntel service unavailable' }));
            return;
          }
          const itemId = typeof body.itemId === 'string' ? body.itemId.trim() : '';
          const updates = body.updates && typeof body.updates === 'object' ? body.updates : null;
          if (!itemId || !updates) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'itemId and updates required' }));
            return;
          }
          const out = await this.projectIntelService.updateItem(itemId, updates);
          await writeAudit({ action: 'project_intel_items_update', allowed: !!out?.success, itemId });
          res.writeHead(out?.success ? 200 : 500, { 'content-type': 'application/json' });
          res.end(JSON.stringify(out?.success ? { success: true, ...(out || {}) } : { success: false, error: out?.error || 'update_failed' }));
          return;
        }

        if (url.pathname === '/skills/project-intel/export') {
          if (!this.projectIntelService?.exportRun) {
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'ProjectIntel service unavailable' }));
            return;
          }
          const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
          if (!runId) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'runId required' }));
            return;
          }
          const out = await this.projectIntelService.exportRun(runId);
          await writeAudit({ action: 'project_intel_export', allowed: !!out?.success, runId });
          res.writeHead(out?.success ? 200 : 500, { 'content-type': 'application/json' });
          res.end(JSON.stringify(out?.success ? { success: true, ...(out || {}) } : { success: false, error: out?.error || 'export_failed' }));
          return;
        }

        if (url.pathname === '/skills/project-intel/delete') {
          if (!this.projectIntelService?.deleteRun) {
            res.writeHead(503, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'ProjectIntel service unavailable' }));
            return;
          }
          const runId = typeof body.runId === 'string' ? body.runId.trim() : '';
          if (!runId) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'runId required' }));
            return;
          }
          const granted = await agentApprovalService.isGranted({ action: 'project_intel_delete', scopeKey: runId });
          if (!granted) {
            const approval = await agentApprovalService.enqueue({
              action: 'project_intel_delete',
              scopeKey: runId,
              summary: `删除 ProjectIntel 任务：${runId}`,
              request: { runId }
            });
            await writeAudit({ action: 'project_intel_delete', allowed: false, reason: 'approval_required', runId, approvalId: approval.id });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'approval_required', approvalId: approval.id }));
            return;
          }
          const out = await this.projectIntelService.deleteRun(runId);
          await writeAudit({ action: 'project_intel_delete', allowed: !!out?.success, runId });
          res.writeHead(out?.success ? 200 : 500, { 'content-type': 'application/json' });
          res.end(JSON.stringify(out?.success ? { success: true, ...(out || {}) } : { success: false, error: out?.error || 'delete_failed' }));
          return;
        }

        if (url.pathname === '/skills/social/draft') {
          const socialManager = require('./social/socialmediamanager');
          if (!socialManager || !socialManager.saveDraft) {
             res.writeHead(503, { 'content-type': 'application/json' });
             res.end(JSON.stringify({ success: false, error: 'SocialMediaManager unavailable' }));
             return;
          }
          
          const draft = {
              id: body.id || `draft-${Date.now()}`,
              account_id: body.account_id, 
              title: body.title || '无标题',
              author: body.author || 'AI',
              digest: body.digest || '',
              content: body.content || '',
              thumb_url: body.thumb_url || '',
              status: 'local',
              updated_at: Date.now()
          };

          // If account_id is missing, try to get the first available account
          if (!draft.account_id) {
              const accounts = await socialManager.getAccounts();
              if (accounts && accounts.length > 0) {
                  draft.account_id = accounts[0].id;
              }
          }
          
          const result = await socialManager.saveDraft(draft);
          await writeAudit({ action: 'social_draft_save', allowed: !!result.success, title: draft.title });
          
          res.writeHead(result.success ? 200 : 500, { 'content-type': 'application/json' });
          res.end(JSON.stringify(result));
          return;
        }

        if (url.pathname === '/skills/context/get') {
          const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
          const milestoneId = typeof body.milestoneId === 'string' ? body.milestoneId.trim() : '';
          const kbMountsRaw = await dbManager.getSetting('kb_mounted_folders');
          const kbMounts = Array.isArray(kbMountsRaw) ? kbMountsRaw : [];

          let project = null;
          let milestone = null;
          if (projectId) {
            project = await dbManager.getProjectById(projectId);
            if (!project) {
              res.writeHead(404, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'Project not found' }));
              return;
            }
            if (milestoneId && Array.isArray(project.milestones)) {
              milestone = project.milestones.find((m) => m && m.id === milestoneId) || null;
            }
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              now: new Date().toISOString(),
              kbMounts,
              project,
              milestone
            })
          );
          return;
        }

        if (url.pathname === '/skills/approvals/list') {
          const status = typeof body.status === 'string' ? body.status.trim() : 'pending';
          const limit = Number.isFinite(Number(body.limit)) ? Math.max(1, Math.min(Number(body.limit), 200)) : 100;
          const list = await agentApprovalService.listApprovals({ status });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, approvals: (Array.isArray(list) ? list : []).slice(0, limit) }));
          return;
        }

        if (url.pathname === '/skills/approvals/get') {
          const id = typeof body.id === 'string' ? body.id.trim() : '';
          if (!id) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'id required' }));
            return;
          }
          const item = await agentApprovalService.getApproval(id);
          res.writeHead(item ? 200 : 404, { 'content-type': 'application/json' });
          res.end(JSON.stringify(item ? { success: true, approval: item } : { success: false, error: 'not_found' }));
          return;
        }

        if (url.pathname === '/skills/kb/query') {
          const text = String(body.text || '').trim();
          if (!text) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'text required' }));
            return;
          }
          const topK = Number.isFinite(Number(body.topK)) ? Number(body.topK) : 8;
          let activeFiles = Array.isArray(body.activeFiles) ? body.activeFiles : [];
          if (activeFiles.length === 0) {
            const mounts = await dbManager.getSetting('kb_mounted_folders');
            if (Array.isArray(mounts)) activeFiles = mounts;
          }

          const mounts = await dbManager.getSetting('kb_mounted_folders');
          const mountRoots = Array.isArray(mounts) ? mounts.map((p) => path.resolve(String(p || '')).replace(/\\/g, '/')).filter(Boolean) : [];
          const normalize = (p) => path.resolve(String(p || '')).replace(/\\/g, '/');
          const isUnderMount = (p) => {
            const n = normalize(p);
            for (const r of mountRoots) {
              const base = r.replace(/\/+$/, '') + '/';
              if (n === base.slice(0, -1) || n.startsWith(base)) return true;
            }
            return false;
          };
          activeFiles = (activeFiles || []).map((x) => String(x || '')).filter(Boolean).filter(isUnderMount);
          if (activeFiles.length === 0) {
            await writeAudit({ action: 'kb_query', allowed: false, reason: 'mount_denied' });
            res.writeHead(403, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'No allowed activeFiles (mounts only)' }));
            return;
          }

          const result = await ragEngine.query(text, topK, activeFiles);

          let contextOut = result.context;
          let chunksOut = Array.isArray(result.chunks) ? result.chunks : [];
          const privacyMode = String(body.privacyMode || 'anonymize').trim(); // anonymize | allow
          const shouldProtect = !!result.privacyTriggered;
          let allowRaw = privacyMode === 'allow';
          let approvalId = null;
          if (shouldProtect && allowRaw) {
            const granted = await agentApprovalService.isGranted({ action: 'privacy_raw_kb', scopeKey: 'kb_query' });
            if (!granted) {
              const approval = await agentApprovalService.enqueue({
                action: 'privacy_raw_kb',
                scopeKey: 'kb_query',
                summary: '允许发送原文（KB Query）',
                request: { privacyMode: 'allow' }
              });
              approvalId = approval.id;
              allowRaw = false;
            }
          }

          if (shouldProtect && !allowRaw) {
            try {
              await privacyService.init();
              const a = await privacyService.anonymize(String(contextOut || ''), true);
              contextOut = a?.text ?? contextOut;
              const nextChunks = [];
              for (const c of chunksOut) {
                const a2 = await privacyService.anonymize(String(c?.text || ''), true);
                nextChunks.push({ ...(c || {}), text: a2?.text ?? String(c?.text || '') });
              }
              chunksOut = nextChunks;
            } catch (e) {}
          }

          await writeAudit({ action: 'kb_query', allowed: true, privacyTriggered: shouldProtect, rawAllowed: !!(shouldProtect && allowRaw), sources: (result.sources || []).length, approvalId });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              context: contextOut,
              sources: result.sources || [],
              chunks: chunksOut,
              retrievalQuality: result.retrievalQuality || 0,
              approvalId
            })
          );
          return;
        }

        if (url.pathname === '/skills/artifacts/write') {
          const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
          const milestoneId = typeof body.milestoneId === 'string' ? body.milestoneId.trim() : '';
          const title = String(body.title || 'Artifact').trim() || 'Artifact';
          const kind = typeof body.kind === 'string' ? body.kind.trim() : 'note';
          const content = typeof body.content === 'string' ? body.content : '';
          if (!content) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'content required' }));
            return;
          }

          const ts = new Date().toISOString().replace(/[:.]/g, '-');
          const safeTitle = title.replace(/[^\p{L}\p{N}\s._-]+/gu, '').trim().slice(0, 80) || 'Artifact';
          const baseDir = path.join(app.getPath('userData'), 'storage', 'DATA', 'Artifacts');
          const subDir = path.join(baseDir, projectId || 'Global', milestoneId ? `Milestone-${milestoneId}` : 'General');
          await fs.promises.mkdir(subDir, { recursive: true });
          const ext = typeof body.ext === 'string' && body.ext.trim().startsWith('.') ? body.ext.trim() : '.md';
          const filePath = path.join(subDir, `${ts}-${safeTitle}${ext}`);
          await fs.promises.writeFile(filePath, content, 'utf8');

          const meta = body.meta && typeof body.meta === 'object' ? body.meta : {};
          const addRes = await dbManager.addAiArtifact({
            projectId: projectId || null,
            milestoneId: milestoneId || null,
            title,
            kind,
            filePath,
            meta: { ...meta, source: 'openclaw', writtenAt: new Date().toISOString() }
          });
          if (!addRes || addRes.success === false) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: addRes?.error || 'addAiArtifact failed', filePath }));
            return;
          }

          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, id: addRes.id, filePath }));
          return;
        }

        if (url.pathname === '/skills/artifacts/list') {
          const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
          const milestoneId = typeof body.milestoneId === 'string' ? body.milestoneId.trim() : '';
          const limit = Number.isFinite(Number(body.limit)) ? Number(body.limit) : 200;
          const list = await dbManager.listAiArtifacts({
            projectId: projectId || undefined,
            milestoneId: milestoneId || undefined,
            limit
          });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, artifacts: list }));
          return;
        }

        if (url.pathname === '/skills/fs/read') {
          const p = typeof body.path === 'string' ? body.path.trim() : '';
          if (!p) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'path required' }));
            return;
          }
          const filePath = normalizePath(p);
          const roots = await getKbMountRoots();
          if (!isUnderAnyRoot(filePath, roots)) {
            await writeAudit({ action: 'fs_read', allowed: false, reason: 'mount_denied', path: filePath });
            res.writeHead(403, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Path not under mounts' }));
            return;
          }
          const maxBytes = Number.isFinite(Number(body.maxBytes)) ? Math.max(1, Math.min(Number(body.maxBytes), 1_000_000)) : 240_000;
          let stat = null;
          try {
            stat = await fs.promises.stat(filePath);
          } catch (e) {
            stat = null;
          }
          if (!stat || !stat.isFile()) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'File not found' }));
            return;
          }
          const size = Number(stat.size || 0);
          const readSize = Math.min(size, maxBytes);
          let textRaw = '';
          let truncated = size > readSize;
          try {
            const fd = await fs.promises.open(filePath, 'r');
            try {
              const buf = Buffer.alloc(readSize);
              await fd.read(buf, 0, readSize, 0);
              textRaw = buf.toString('utf8');
            } finally {
              try {
                await fd.close();
              } catch (e) {}
            }
          } catch (e) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Read failed' }));
            return;
          }
          const privacyMode = String(body.privacyMode || 'anonymize').trim(); // anonymize | allow
          const protectedHit = !!privacyService.isPrivacyProtected(filePath);
          let allowRaw = privacyMode === 'allow';
          let approvalId = null;
          if (protectedHit && allowRaw) {
            const granted = await agentApprovalService.isGranted({ action: 'privacy_raw_read', scopeKey: filePath });
            if (!granted) {
              const approval = await agentApprovalService.enqueue({
                action: 'privacy_raw_read',
                scopeKey: filePath,
                summary: `允许发送原文（读取文件）：${path.basename(filePath)}`,
                request: { path: filePath }
              });
              approvalId = approval.id;
              allowRaw = false;
            }
          }
          let textOut = textRaw;
          let anonymized = false;
          if (protectedHit && !allowRaw) {
            try {
              await privacyService.init();
              const a = await privacyService.anonymize(String(textRaw || ''), true);
              textOut = a?.text ?? textRaw;
              anonymized = true;
            } catch (e) {}
          }
          await writeAudit({ action: 'fs_read', allowed: true, path: filePath, privacyTriggered: protectedHit, rawAllowed: !!(protectedHit && allowRaw), truncated, approvalId });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, path: filePath, text: textOut, truncated, anonymized, approvalId }));
          return;
        }

        if (url.pathname === '/skills/fs/write') {
          const rawPath = typeof body.path === 'string' ? body.path.trim() : '';
          const content = typeof body.content === 'string' ? body.content : '';
          if (!rawPath) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'path required' }));
            return;
          }
          if (!content) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'content required' }));
            return;
          }
          const filePath = normalizePath(rawPath);
          const roots = await getKbMountRoots();
          const inMount = isUnderAnyRoot(filePath, roots);
          const artifactsRoot = normalizePath(path.join(app.getPath('userData'), 'storage', 'DATA', 'Artifacts'));
          const inArtifacts = isUnderAnyRoot(filePath, [artifactsRoot]);
          if (!inMount && !inArtifacts) {
            await writeAudit({ action: 'fs_write', allowed: false, reason: 'scope_denied', path: filePath });
            res.writeHead(403, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Write path not allowed' }));
            return;
          }
          if (inMount && !inArtifacts) {
            await writeAudit({ action: 'fs_write', allowed: false, reason: 'mount_write_disabled', path: filePath });
            res.writeHead(403, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'Write to KB mounts disabled' }));
            return;
          }
          const mode = String(body.mode || 'create').trim(); // create | overwrite | append
          if (!['create', 'overwrite', 'append'].includes(mode)) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'invalid mode' }));
            return;
          }
          let approvalId = null;
          let canWrite = await agentApprovalService.isGranted({ action: 'fs_write', scopeKey: filePath });
          if (!canWrite) {
            const approval = await agentApprovalService.enqueue({
              action: 'fs_write',
              scopeKey: filePath,
              summary: `写入文件：${path.basename(filePath)}`,
              request: { path: filePath, mode, inArtifacts, inMount, bytes: String(content || '').length }
            });
            approvalId = approval.id;
            await writeAudit({ action: 'fs_write', allowed: false, reason: 'approval_required', path: filePath, mode, approvalId });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'approval_required', approvalId }));
            return;
          }
          const protectedHit = !!privacyService.isPrivacyProtected(filePath);
          const privacyMode = String(body.privacyMode || 'anonymize').trim(); // anonymize | allow
          let allowRaw = privacyMode === 'allow';
          if (protectedHit && allowRaw) {
            const granted = await agentApprovalService.isGranted({ action: 'privacy_raw_write', scopeKey: filePath });
            if (!granted) {
              const approval = await agentApprovalService.enqueue({
                action: 'privacy_raw_write',
                scopeKey: filePath,
                summary: `允许原文写入：${path.basename(filePath)}`,
                request: { path: filePath, mode }
              });
              approvalId = approvalId || approval.id;
              allowRaw = false;
            }
          }
          let out = content;
          let anonymized = false;
          if (protectedHit && !allowRaw) {
            try {
              await privacyService.init();
              const a = await privacyService.anonymize(String(content || ''), true);
              out = a?.text ?? content;
              anonymized = true;
            } catch (e) {}
          }
          try {
            await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
            if (mode === 'append') await fs.promises.appendFile(filePath, out, 'utf8');
            else if (mode === 'overwrite') await fs.promises.writeFile(filePath, out, 'utf8');
            else {
              const exists = pathExists(filePath);
              if (exists) {
                res.writeHead(409, { 'content-type': 'application/json' });
                res.end(JSON.stringify({ success: false, error: 'file_exists' }));
                return;
              }
              await fs.promises.writeFile(filePath, out, 'utf8');
            }
          } catch (e) {
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'write_failed' }));
            return;
          }
          await writeAudit({ action: 'fs_write', allowed: true, path: filePath, mode, privacyTriggered: protectedHit, rawAllowed: !!(protectedHit && allowRaw), anonymized, approvalId });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, path: filePath, anonymized, approvalId }));
          return;
        }

        if (url.pathname === '/skills/kb/mount/list') {
          const roots = await getKbMountRoots();
          await writeAudit({ action: 'kb_mount_list', allowed: true, count: roots.length });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, mounts: roots }));
          return;
        }

        if (url.pathname === '/skills/kb/mount/add') {
          const p = typeof body.path === 'string' ? body.path.trim() : '';
          if (!p) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'path required' }));
            return;
          }
          const root = normalizePath(p).replace(/\/+$/, '');
          if (!isSafeMountRoot(root)) {
            await writeAudit({ action: 'kb_mount_add', allowed: false, reason: 'unsafe_path', path: root });
            res.writeHead(403, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'unsafe_path' }));
            return;
          }
          const granted = await agentApprovalService.isGranted({ action: 'kb_mount_add', scopeKey: root });
          if (!granted) {
            const approval = await agentApprovalService.enqueue({
              action: 'kb_mount_add',
              scopeKey: root,
              summary: `新增挂载目录：${root}`,
              request: { path: root }
            });
            await writeAudit({ action: 'kb_mount_add', allowed: false, reason: 'approval_required', path: root, approvalId: approval.id });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'approval_required', approvalId: approval.id }));
            return;
          }
          const existing = await dbManager.getSetting('kb_mounted_folders');
          const list = Array.isArray(existing) ? existing.map((x) => String(x || '')).filter(Boolean) : [];
          if (!list.includes(root)) list.push(root);
          await dbManager.saveSetting('kb_mounted_folders', list);
          try { this.mainWindow?.webContents?.send?.('app:data-refresh', { keys: ['kb_mounts'] }); } catch (e) {}
          await writeAudit({ action: 'kb_mount_add', allowed: true, path: root });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, mounts: list }));
          return;
        }

        if (url.pathname === '/skills/kb/mount/remove') {
          const p = typeof body.path === 'string' ? body.path.trim() : '';
          if (!p) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'path required' }));
            return;
          }
          const root = normalizePath(p).replace(/\/+$/, '');
          const granted = await agentApprovalService.isGranted({ action: 'kb_mount_remove', scopeKey: root });
          if (!granted) {
            const approval = await agentApprovalService.enqueue({
              action: 'kb_mount_remove',
              scopeKey: root,
              summary: `移除挂载目录：${root}`,
              request: { path: root }
            });
            await writeAudit({ action: 'kb_mount_remove', allowed: false, reason: 'approval_required', path: root, approvalId: approval.id });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'approval_required', approvalId: approval.id }));
            return;
          }
          const existing = await dbManager.getSetting('kb_mounted_folders');
          const list = Array.isArray(existing) ? existing.map((x) => String(x || '')).filter(Boolean) : [];
          const next = list.filter((x) => normalizePath(x).replace(/\/+$/, '') !== root);
          await dbManager.saveSetting('kb_mounted_folders', next);
          try { this.mainWindow?.webContents?.send?.('app:data-refresh', { keys: ['kb_mounts'] }); } catch (e) {}
          await writeAudit({ action: 'kb_mount_remove', allowed: true, path: root });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, mounts: next }));
          return;
        }

        if (url.pathname === '/skills/net/fetch') {
          const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
          if (!rawUrl) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'url required' }));
            return;
          }
          const u = parseUrlSafe(rawUrl);
          if (!u) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'invalid url' }));
            return;
          }
          const protocol = String(u.protocol || '').toLowerCase();
          if (protocol !== 'https:' && protocol !== 'http:') {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'unsupported protocol' }));
            return;
          }
          if (protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(String(u.hostname || '').toLowerCase())) {
            res.writeHead(403, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'http only allowed for localhost' }));
            return;
          }

          const method = String(body.method || 'GET').toUpperCase();
          if (!['GET', 'POST'].includes(method)) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'method not allowed' }));
            return;
          }

          const hostname = String(u.hostname || '').toLowerCase();
          const evalRes = await agentApprovalService.evaluateNetFetch({ url: u.toString(), hostname });
          if (evalRes.decision !== 'allow') {
            const approval = await agentApprovalService.enqueue({
              action: 'net_fetch',
              scopeKey: hostname,
              summary: `联网访问：${u.origin}`,
              request: { url: u.toString(), method }
            });
            await writeAudit({ action: 'net_fetch', allowed: false, reason: evalRes.reason || 'approval_required', host: hostname, url: u.toString(), approvalId: approval.id });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'approval_required', approvalId: approval.id }));
            return;
          }

          const inHeaders = body.headers && typeof body.headers === 'object' ? body.headers : {};
          const headers = {};
          for (const [k0, v0] of Object.entries(inHeaders)) {
            const k = String(k0 || '').toLowerCase();
            if (!k) continue;
            if (k === 'authorization' || k === 'cookie' || k === 'proxy-authorization') continue;
            if (k.startsWith('sec-')) continue;
            headers[k0] = v0;
          }

          const bodyData = method === 'POST' ? (typeof body.body === 'string' ? body.body : undefined) : undefined;
          let resp;
          try {
            resp = await fetch(u.toString(), { method, headers, body: bodyData });
          } catch (e) {
            await writeAudit({ action: 'net_fetch', allowed: false, reason: 'fetch_failed', host: hostname, url: u.toString() });
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'fetch_failed' }));
            return;
          }

          const outHeaders = {};
          try {
            resp.headers.forEach((val, key) => (outHeaders[key] = val));
          } catch (e) {}

          const contentType = String(outHeaders['content-type'] || '');
          const maxBytes = 1_500_000;
          let data = '';
          let isBinary = false;
          try {
            if (contentType.includes('application/json') || contentType.includes('text/')) {
              const txt = await resp.text();
              data = txt.length > maxBytes ? txt.slice(0, maxBytes) : txt;
            } else {
              const buf = Buffer.from(await resp.arrayBuffer());
              const slice = buf.length > maxBytes ? buf.slice(0, maxBytes) : buf;
              data = slice.toString('base64');
              isBinary = true;
            }
          } catch (e) {
            data = '';
          }
          if (isBinary) outHeaders['x-is-binary'] = 'true';

          await writeAudit({ action: 'net_fetch', allowed: true, host: hostname, url: u.toString(), status: resp.status });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, ok: resp.ok, status: resp.status, statusText: resp.statusText, headers: outHeaders, data }));
          return;
        }

        if (url.pathname === '/skills/notify/send') {
          const channel = String(body.channel || '').trim().toLowerCase();
          const text = String(body.text || '').trim();
          const markdown = typeof body.markdown === 'string' ? body.markdown : '';
          if (!channel) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'channel required' }));
            return;
          }
          if (!text && !markdown) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'text required' }));
            return;
          }

          const strictApproval = true;
          if (strictApproval) {
            const granted = await agentApprovalService.isGranted({ action: 'notify_send', scopeKey: channel });
            if (!granted) {
              const approval = await agentApprovalService.enqueue({
                action: 'notify_send',
                scopeKey: channel,
                summary: `发送通知：${channel}`,
                request: { channel, textPreview: (text || markdown).slice(0, 200) }
              });
              await writeAudit({ action: 'notify_send', allowed: false, reason: 'approval_required', scopeKey: channel, approvalId: approval.id });
              res.writeHead(200, { 'content-type': 'application/json' });
              res.end(JSON.stringify({ success: false, error: 'approval_required', approvalId: approval.id }));
              return;
            }
          }

          let webhook = '';
          if (channel === 'wecom') webhook = String((await this._getDecryptedSetting('notify_wecom_webhook')) || '').trim();
          if (channel === 'feishu') webhook = String((await this._getDecryptedSetting('notify_feishu_webhook')) || '').trim();
          if (!webhook) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'webhook_not_configured' }));
            return;
          }

          let payload = {};
          if (channel === 'wecom') {
            if (markdown) payload = { msgtype: 'markdown', markdown: { content: markdown } };
            else payload = { msgtype: 'text', text: { content: text } };
          } else if (channel === 'feishu') {
            payload = { msg_type: 'text', content: { text: text || markdown } };
          } else {
            payload = { text: text || markdown };
          }

          let resp;
          try {
            resp = await fetch(webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
          } catch (e) {
            await writeAudit({ action: 'notify_send', allowed: false, reason: 'fetch_failed', scopeKey: channel });
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'send_failed' }));
            return;
          }
          await writeAudit({ action: 'notify_send', allowed: true, scopeKey: channel, status: resp.status });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, ok: resp.ok, status: resp.status }));
          return;
        }

        if (url.pathname === '/skills/cloud/sync') {
          const cloudType = String(body.cloudType || 'jianguoyun').trim();
          const granted = await agentApprovalService.isGranted({ action: 'cloud_sync', scopeKey: cloudType });
          if (!granted) {
            const approval = await agentApprovalService.enqueue({
              action: 'cloud_sync',
              scopeKey: cloudType,
              summary: `同步到云盘：${cloudType}`,
              request: { cloudType }
            });
            await writeAudit({ action: 'cloud_sync', allowed: false, reason: 'approval_required', scopeKey: cloudType, approvalId: approval.id });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'approval_required', approvalId: approval.id }));
            return;
          }

          const config = await dbManager.getCloudSyncConfig(cloudType);
          if (!config || !config.is_enabled) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'cloud_sync_not_configured' }));
            return;
          }
          const target = config.target_folder;
          if (!target) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'target_folder_not_configured' }));
            return;
          }
          const artifactsRoot = path.join(app.getPath('userData'), 'storage', 'DATA', 'Artifacts');
          let result;
          try {
            const { syncFolderToCloud } = require('./cloudSync/cloudFolderSync');
            result = await syncFolderToCloud(artifactsRoot, cloudType, config, target);
          } catch (e) {
            await writeAudit({ action: 'cloud_sync', allowed: false, reason: 'sync_failed', scopeKey: cloudType });
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'sync_failed' }));
            return;
          }
          await writeAudit({ action: 'cloud_sync', allowed: true, scopeKey: cloudType });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, result }));
          return;
        }

        if (url.pathname === '/skills/projects/list') {
          const list = await dbManager.getAllProjects();
          await writeAudit({ action: 'projects_list', allowed: true, count: Array.isArray(list) ? list.length : 0 });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, projects: Array.isArray(list) ? list : [] }));
          return;
        }

        if (url.pathname === '/skills/projects/get') {
          const id = typeof body.id === 'string' ? body.id.trim() : '';
          if (!id) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'id required' }));
            return;
          }
          const p = await dbManager.getProjectById(id);
          await writeAudit({ action: 'projects_get', allowed: !!p, id });
          res.writeHead(p ? 200 : 404, { 'content-type': 'application/json' });
          res.end(JSON.stringify(p ? { success: true, project: p } : { success: false, error: 'not_found' }));
          return;
        }

        if (url.pathname === '/skills/milestones/update') {
          const projectId = typeof body.projectId === 'string' ? body.projectId.trim() : '';
          const milestoneId = typeof body.milestoneId === 'string' ? body.milestoneId.trim() : '';
          const patch = body.patch && typeof body.patch === 'object' ? body.patch : null;
          if (!projectId || !milestoneId || !patch) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'projectId, milestoneId, patch required' }));
            return;
          }

          const allowedStatus = new Set(['todo', 'pending', 'doing', 'in_progress', 'done', 'completed', 'cancelled', 'canceled']);
          const statusRaw = patch.status !== undefined ? String(patch.status || '').trim().toLowerCase() : '';
          if (patch.status !== undefined && (!statusRaw || !allowedStatus.has(statusRaw))) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'invalid status' }));
            return;
          }

          const p = await dbManager.getProjectById(projectId);
          if (!p) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'project_not_found' }));
            return;
          }

          const milestones = Array.isArray(p.milestones) ? p.milestones : [];
          const idx = milestones.findIndex((m) => m && String(m.id || '').trim() === milestoneId);
          if (idx < 0) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'milestone_not_found' }));
            return;
          }

          const cur = milestones[idx] && typeof milestones[idx] === 'object' ? milestones[idx] : {};
          const nextMs = { ...cur };
          if (patch.status !== undefined) nextMs.status = statusRaw;

          if (patch.completionDate !== undefined) {
            const v = patch.completionDate;
            if (typeof v === 'string') nextMs.completionDate = v.trim();
            else if (typeof v === 'number' && Number.isFinite(v)) nextMs.completionDate = new Date(v).toISOString().slice(0, 10);
            else nextMs.completionDate = '';
          } else if (statusRaw === 'done' || statusRaw === 'completed') {
            if (!nextMs.completionDate) nextMs.completionDate = new Date().toISOString().slice(0, 10);
          }

          const normalizeEvidence = (ev) => {
            if (!ev) return [];
            if (Array.isArray(ev)) return ev.map((x) => String(x || '').trim()).filter(Boolean).slice(0, 50);
            if (typeof ev === 'string') return [ev.trim()].filter(Boolean);
            return [];
          };

          if (patch.evidenceSet !== undefined) {
            nextMs.evidence = normalizeEvidence(patch.evidenceSet);
          } else if (patch.evidenceAdd !== undefined) {
            const base = normalizeEvidence(nextMs.evidence);
            const add = normalizeEvidence(patch.evidenceAdd);
            const set = new Set([...base, ...add]);
            nextMs.evidence = Array.from(set).slice(0, 50);
          }

          const nextMilestones = [...milestones];
          nextMilestones[idx] = nextMs;
          const nextProject = { ...p, milestones: nextMilestones, id: p.id };

          const saveRes = await dbManager.saveProject(nextProject);
          if (!saveRes?.success) {
            await writeAudit({ action: 'milestones_update', allowed: false, projectId, milestoneId, reason: saveRes?.error || 'save_failed' });
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: saveRes?.error || 'save_failed' }));
            return;
          }
          try { this.mainWindow?.webContents?.send?.('app:data-refresh', { keys: ['projects'] }); } catch (e) {}
          await writeAudit({ action: 'milestones_update', allowed: true, projectId, milestoneId });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, milestone: nextMs }));
          return;
        }

        if (url.pathname === '/skills/projects/patch') {
          const id = typeof body.id === 'string' ? body.id.trim() : '';
          const patch = body.patch && typeof body.patch === 'object' ? body.patch : null;
          if (!id || !patch) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'id and patch required' }));
            return;
          }
          const existing = await dbManager.getProjectById(id);
          if (!existing) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'not_found' }));
            return;
          }
          const next = { ...existing, ...patch, id: existing.id };
          const saveRes = await dbManager.saveProject(next);
          if (!saveRes?.success) {
            await writeAudit({ action: 'projects_patch', allowed: false, id, reason: saveRes?.error || 'save_failed' });
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: saveRes?.error || 'save_failed' }));
            return;
          }
          try { this.mainWindow?.webContents?.send?.('app:data-refresh', { keys: ['projects'] }); } catch (e) {}
          await writeAudit({ action: 'projects_patch', allowed: true, id });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        if (url.pathname === '/skills/projects/delete') {
          const id = typeof body.id === 'string' ? body.id.trim() : '';
          if (!id) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'id required' }));
            return;
          }
          const p = await dbManager.getProjectById(id);
          if (!p) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'not_found' }));
            return;
          }
          const granted = await agentApprovalService.isGranted({ action: 'projects_delete', scopeKey: id });
          if (!granted) {
            const approval = await agentApprovalService.enqueue({
              action: 'projects_delete',
              scopeKey: id,
              summary: `删除项目：${String(p.title || p.id)}`,
              request: { id }
            });
            await writeAudit({ action: 'projects_delete', allowed: false, id, reason: 'approval_required', approvalId: approval.id });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'approval_required', approvalId: approval.id }));
            return;
          }
          await dbManager.deleteProject(id);
          try { this.mainWindow?.webContents?.send?.('app:data-refresh', { keys: ['projects'] }); } catch (e) {}
          await writeAudit({ action: 'projects_delete', allowed: true, id });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        if (url.pathname === '/skills/events/list') {
          const ev = await dbManager.getSetting('app_events');
          const list = Array.isArray(ev) ? ev : [];
          await writeAudit({ action: 'events_list', allowed: true, count: list.length });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, events: list }));
          return;
        }

        if (url.pathname === '/skills/events/upsert') {
          const ev = body.event && typeof body.event === 'object' ? body.event : null;
          if (!ev) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'event required' }));
            return;
          }
          const existing = await dbManager.getSetting('app_events');
          const list = Array.isArray(existing) ? existing : [];
          const makeId = () => {
            try {
              return `evt-${crypto.randomUUID()}`;
            } catch (e) {
              return `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            }
          };
          const id = typeof ev.id === 'string' && ev.id.trim() ? ev.id.trim() : makeId();
          const next = { ...(ev || {}), id };
          const idx = list.findIndex((x) => x && String(x.id || '') === id);
          if (idx >= 0) list[idx] = next;
          else list.push(next);
          if (list.length > 20_000) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'too_many_events' }));
            return;
          }
          const saveRes = await dbManager.saveSetting('app_events', list);
          if (!saveRes?.success) {
            await writeAudit({ action: 'events_upsert', allowed: false, id, reason: saveRes?.error || 'save_failed' });
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: saveRes?.error || 'save_failed' }));
            return;
          }
          try { this.mainWindow?.webContents?.send?.('app:data-refresh', { keys: ['events'] }); } catch (e) {}
          await writeAudit({ action: 'events_upsert', allowed: true, id });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, id }));
          return;
        }

        if (url.pathname === '/skills/events/delete') {
          const id = typeof body.id === 'string' ? body.id.trim() : '';
          if (!id) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'id required' }));
            return;
          }
          const existing = await dbManager.getSetting('app_events');
          const list = Array.isArray(existing) ? existing : [];
          const idx = list.findIndex((x) => x && String(x.id || '') === id);
          if (idx < 0) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'not_found' }));
            return;
          }
          const ev = list[idx] || {};
          const granted = await agentApprovalService.isGranted({ action: 'events_delete', scopeKey: id });
          if (!granted) {
            const approval = await agentApprovalService.enqueue({
              action: 'events_delete',
              scopeKey: id,
              summary: `删除日程：${String(ev.title || ev.id)}`,
              request: { id }
            });
            await writeAudit({ action: 'events_delete', allowed: false, id, reason: 'approval_required', approvalId: approval.id });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'approval_required', approvalId: approval.id }));
            return;
          }
          list.splice(idx, 1);
          const saveRes = await dbManager.saveSetting('app_events', list);
          if (!saveRes?.success) {
            await writeAudit({ action: 'events_delete', allowed: false, id, reason: saveRes?.error || 'save_failed' });
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: saveRes?.error || 'save_failed' }));
            return;
          }
          try { this.mainWindow?.webContents?.send?.('app:data-refresh', { keys: ['events'] }); } catch (e) {}
          await writeAudit({ action: 'events_delete', allowed: true, id });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        if (url.pathname === '/skills/team/get') {
          const v = await dbManager.getSetting('app_team');
          const team = Array.isArray(v) ? v : [];
          await writeAudit({ action: 'team_get', allowed: true, count: team.length });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, team }));
          return;
        }

        if (url.pathname === '/skills/team/upsert') {
          const member = body.member && typeof body.member === 'object' ? body.member : null;
          if (!member) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'member required' }));
            return;
          }
          const existing = await dbManager.getSetting('app_team');
          const list = Array.isArray(existing) ? existing : [];
          const makeId = () => {
            try {
              return `tm-${crypto.randomUUID()}`;
            } catch (e) {
              return `tm-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            }
          };
          const id = typeof member.id === 'string' && member.id.trim() ? member.id.trim() : makeId();
          const next = { ...(member || {}), id };
          const idx = list.findIndex((x) => x && String(x.id || '') === id);
          if (idx >= 0) list[idx] = next;
          else list.push(next);
          if (list.length > 5_000) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'too_many_team_members' }));
            return;
          }
          const saveRes = await dbManager.saveSetting('app_team', list);
          if (!saveRes?.success) {
            await writeAudit({ action: 'team_upsert', allowed: false, id, reason: saveRes?.error || 'save_failed' });
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: saveRes?.error || 'save_failed' }));
            return;
          }
          try { this.mainWindow?.webContents?.send?.('app:data-refresh', { keys: ['team'] }); } catch (e) {}
          await writeAudit({ action: 'team_upsert', allowed: true, id });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, id }));
          return;
        }

        if (url.pathname === '/skills/team/delete') {
          const id = typeof body.id === 'string' ? body.id.trim() : '';
          if (!id) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'id required' }));
            return;
          }
          const existing = await dbManager.getSetting('app_team');
          const list = Array.isArray(existing) ? existing : [];
          const idx = list.findIndex((x) => x && String(x.id || '') === id);
          if (idx < 0) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'not_found' }));
            return;
          }
          const m = list[idx] || {};
          const granted = await agentApprovalService.isGranted({ action: 'team_delete', scopeKey: id });
          if (!granted) {
            const approval = await agentApprovalService.enqueue({
              action: 'team_delete',
              scopeKey: id,
              summary: `删除团队成员：${String(m.name || m.nickname || m.id)}`,
              request: { id }
            });
            await writeAudit({ action: 'team_delete', allowed: false, id, reason: 'approval_required', approvalId: approval.id });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'approval_required', approvalId: approval.id }));
            return;
          }
          list.splice(idx, 1);
          const saveRes = await dbManager.saveSetting('app_team', list);
          if (!saveRes?.success) {
            await writeAudit({ action: 'team_delete', allowed: false, id, reason: saveRes?.error || 'save_failed' });
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: saveRes?.error || 'save_failed' }));
            return;
          }
          try { this.mainWindow?.webContents?.send?.('app:data-refresh', { keys: ['team'] }); } catch (e) {}
          await writeAudit({ action: 'team_delete', allowed: true, id });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        if (url.pathname === '/skills/org/get') {
          const p = await dbManager.getSetting('app_org_profile');
          const profile = p && typeof p === 'object' ? p : null;
          await writeAudit({ action: 'org_get', allowed: true, hasProfile: !!profile });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, profile }));
          return;
        }

        if (url.pathname === '/skills/org/set') {
          const profile = body.profile && typeof body.profile === 'object' ? body.profile : null;
          if (!profile) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'profile required' }));
            return;
          }
          const scopeKey = 'org_profile';
          const granted = await agentApprovalService.isGranted({ action: 'org_set', scopeKey });
          if (!granted) {
            const approval = await agentApprovalService.enqueue({
              action: 'org_set',
              scopeKey,
              summary: '更新机构/组织档案',
              request: { profile }
            });
            await writeAudit({ action: 'org_set', allowed: false, reason: 'approval_required', approvalId: approval.id });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'approval_required', approvalId: approval.id }));
            return;
          }
          const saveRes = await dbManager.saveSetting('app_org_profile', profile);
          if (!saveRes?.success) {
            await writeAudit({ action: 'org_set', allowed: false, reason: saveRes?.error || 'save_failed' });
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: saveRes?.error || 'save_failed' }));
            return;
          }
          try { this.mainWindow?.webContents?.send?.('app:data-refresh', { keys: ['org_profile'] }); } catch (e) {}
          await writeAudit({ action: 'org_set', allowed: true });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        if (url.pathname === '/skills/selection/get') {
          const v = await dbManager.getSetting('app_selected_event_ids');
          const ids = Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
          await writeAudit({ action: 'selection_get', allowed: true, count: ids.length });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, ids }));
          return;
        }

        if (url.pathname === '/skills/selection/set') {
          const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string') : null;
          if (!ids) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'ids required' }));
            return;
          }
          if (ids.length > 50_000) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'too_many_ids' }));
            return;
          }
          const saveRes = await dbManager.saveSetting('app_selected_event_ids', ids);
          if (!saveRes?.success) {
            await writeAudit({ action: 'selection_set', allowed: false, reason: saveRes?.error || 'save_failed' });
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: saveRes?.error || 'save_failed' }));
            return;
          }
          try { this.mainWindow?.webContents?.send?.('app:data-refresh', { keys: ['selected_event_ids'] }); } catch (e) {}
          await writeAudit({ action: 'selection_set', allowed: true, count: ids.length });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        if (url.pathname === '/skills/settings/get') {
          const key = typeof body.key === 'string' ? body.key.trim() : '';
          const allowed = new Set(['warehouse_path', 'kb_auto_subfolders', 'network_allowlist', 'org_configured', 'team_configured', 'openclaw_enabled']);
          if (!key || !allowed.has(key)) {
            res.writeHead(403, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'key not allowed' }));
            return;
          }
          const value = await dbManager.getSetting(key);
          await writeAudit({ action: 'settings_get', allowed: true, key });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, key, value }));
          return;
        }

        if (url.pathname === '/skills/settings/set') {
          const key = typeof body.key === 'string' ? body.key.trim() : '';
          const allowed = new Set(['warehouse_path', 'kb_auto_subfolders', 'network_allowlist']);
          if (!key || !allowed.has(key)) {
            res.writeHead(403, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'key not allowed' }));
            return;
          }
          const granted = await agentApprovalService.isGranted({ action: 'settings_set', scopeKey: key });
          if (!granted) {
            const approval = await agentApprovalService.enqueue({
              action: 'settings_set',
              scopeKey: key,
              summary: `修改设置：${key}`,
              request: { key, value: body.value }
            });
            await writeAudit({ action: 'settings_set', allowed: false, key, reason: 'approval_required', approvalId: approval.id });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'approval_required', approvalId: approval.id }));
            return;
          }
          const value = body.value;
          const saveRes = await dbManager.saveSetting(key, value);
          if (!saveRes?.success) {
            await writeAudit({ action: 'settings_set', allowed: false, key, reason: saveRes?.error || 'save_failed' });
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: saveRes?.error || 'save_failed' }));
            return;
          }
          await writeAudit({ action: 'settings_set', allowed: true, key, valueSize: (() => { try { return JSON.stringify(value || '').length; } catch (e) { return 0; } })() });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        if (url.pathname === '/skills/leads/list') {
          const v = await dbManager.getSetting('app_leads');
          const list = Array.isArray(v) ? v : [];
          await writeAudit({ action: 'leads_list', allowed: true, count: list.length });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, leads: list }));
          return;
        }

        if (url.pathname === '/skills/leads/upsert') {
          const lead = body.lead && typeof body.lead === 'object' ? body.lead : null;
          if (!lead) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'lead required' }));
            return;
          }
          const existing = await dbManager.getSetting('app_leads');
          const list = Array.isArray(existing) ? existing : [];
          const makeId = () => {
            try {
              return `lead-${crypto.randomUUID()}`;
            } catch (e) {
              return `lead-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            }
          };
          const id = typeof lead.id === 'string' && lead.id.trim() ? lead.id.trim() : makeId();
          const next = { ...(lead || {}), id };
          const idx = list.findIndex((x) => x && String(x.id || '') === id);
          if (idx >= 0) list[idx] = next;
          else list.push(next);
          if (list.length > 50_000) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'too_many_leads' }));
            return;
          }
          const saveRes = await dbManager.saveSetting('app_leads', list);
          if (!saveRes?.success) {
            await writeAudit({ action: 'leads_upsert', allowed: false, id, reason: saveRes?.error || 'save_failed' });
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: saveRes?.error || 'save_failed' }));
            return;
          }
          try { this.mainWindow?.webContents?.send?.('app:data-refresh', { keys: ['leads'] }); } catch (e) {}
          await writeAudit({ action: 'leads_upsert', allowed: true, id });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, id }));
          return;
        }

        if (url.pathname === '/skills/leads/delete') {
          const id = typeof body.id === 'string' ? body.id.trim() : '';
          if (!id) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'id required' }));
            return;
          }
          const existing = await dbManager.getSetting('app_leads');
          const list = Array.isArray(existing) ? existing : [];
          const idx = list.findIndex((x) => x && String(x.id || '') === id);
          if (idx < 0) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'not_found' }));
            return;
          }
          const lead = list[idx] || {};
          const granted = await agentApprovalService.isGranted({ action: 'leads_delete', scopeKey: id });
          if (!granted) {
            const approval = await agentApprovalService.enqueue({
              action: 'leads_delete',
              scopeKey: id,
              summary: `删除线索：${String(lead.name || lead.id)}`,
              request: { id }
            });
            await writeAudit({ action: 'leads_delete', allowed: false, id, reason: 'approval_required', approvalId: approval.id });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'approval_required', approvalId: approval.id }));
            return;
          }
          list.splice(idx, 1);
          const saveRes = await dbManager.saveSetting('app_leads', list);
          if (!saveRes?.success) {
            await writeAudit({ action: 'leads_delete', allowed: false, id, reason: saveRes?.error || 'save_failed' });
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: saveRes?.error || 'save_failed' }));
            return;
          }
          try { this.mainWindow?.webContents?.send?.('app:data-refresh', { keys: ['leads'] }); } catch (e) {}
          await writeAudit({ action: 'leads_delete', allowed: true, id });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        if (url.pathname === '/skills/schedules/list') {
          const v = await dbManager.getSetting('app_schedules');
          const list = Array.isArray(v) ? v : [];
          await writeAudit({ action: 'schedules_list', allowed: true, count: list.length });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, schedules: list }));
          return;
        }

        if (url.pathname === '/skills/schedules/upsert') {
          const schedule = body.schedule && typeof body.schedule === 'object' ? body.schedule : null;
          if (!schedule) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'schedule required' }));
            return;
          }
          const existing = await dbManager.getSetting('app_schedules');
          const list = Array.isArray(existing) ? existing : [];
          const makeId = () => {
            try {
              return `sch-${crypto.randomUUID()}`;
            } catch (e) {
              return `sch-${Date.now()}-${Math.random().toString(16).slice(2)}`;
            }
          };
          const id = typeof schedule.id === 'string' && schedule.id.trim() ? schedule.id.trim() : makeId();
          const next = { ...(schedule || {}), id };
          const idx = list.findIndex((x) => x && String(x.id || '') === id);
          if (idx >= 0) list[idx] = next;
          else list.push(next);
          if (list.length > 10_000) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'too_many_schedules' }));
            return;
          }
          const saveRes = await dbManager.saveSetting('app_schedules', list);
          if (!saveRes?.success) {
            await writeAudit({ action: 'schedules_upsert', allowed: false, id, reason: saveRes?.error || 'save_failed' });
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: saveRes?.error || 'save_failed' }));
            return;
          }
          try { this.mainWindow?.webContents?.send?.('app:data-refresh', { keys: ['schedules'] }); } catch (e) {}
          await writeAudit({ action: 'schedules_upsert', allowed: true, id });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true, id }));
          return;
        }

        if (url.pathname === '/skills/schedules/delete') {
          const id = typeof body.id === 'string' ? body.id.trim() : '';
          if (!id) {
            res.writeHead(400, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'id required' }));
            return;
          }
          const existing = await dbManager.getSetting('app_schedules');
          const list = Array.isArray(existing) ? existing : [];
          const idx = list.findIndex((x) => x && String(x.id || '') === id);
          if (idx < 0) {
            res.writeHead(404, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'not_found' }));
            return;
          }
          const sch = list[idx] || {};
          const granted = await agentApprovalService.isGranted({ action: 'schedules_delete', scopeKey: id });
          if (!granted) {
            const approval = await agentApprovalService.enqueue({
              action: 'schedules_delete',
              scopeKey: id,
              summary: `删除排期：${String(sch.title || sch.id)}`,
              request: { id }
            });
            await writeAudit({ action: 'schedules_delete', allowed: false, id, reason: 'approval_required', approvalId: approval.id });
            res.writeHead(200, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: 'approval_required', approvalId: approval.id }));
            return;
          }
          list.splice(idx, 1);
          const saveRes = await dbManager.saveSetting('app_schedules', list);
          if (!saveRes?.success) {
            await writeAudit({ action: 'schedules_delete', allowed: false, id, reason: saveRes?.error || 'save_failed' });
            res.writeHead(500, { 'content-type': 'application/json' });
            res.end(JSON.stringify({ success: false, error: saveRes?.error || 'save_failed' }));
            return;
          }
          try { this.mainWindow?.webContents?.send?.('app:data-refresh', { keys: ['schedules'] }); } catch (e) {}
          await writeAudit({ action: 'schedules_delete', allowed: true, id });
          res.writeHead(200, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
          return;
        }

        res.writeHead(404, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: 'Not found' }));
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: e.message }));
      }
    });

    return new Promise((resolve) => {
      this.bridgeServer.listen(this.bridgePort, '127.0.0.1', () => {
        resolve({ success: true, port: this.bridgePort });
      });
      this.bridgeServer.on('error', (e) => {
        this.lastError = e.message;
        try {
          this.bridgeServer.close();
        } catch (err) {}
        this.bridgeServer = null;
        resolve({ success: false, error: e.message });
      });
    });
  }

  async stopBridge() {
    if (!this.bridgeServer) return { success: true };
    return new Promise((resolve) => {
      const server = this.bridgeServer;
      this.bridgeServer = null;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve({ success: true });
      };
      const timer = setTimeout(() => {
        try {
          server.closeAllConnections?.();
        } catch (e) {}
        try {
          server.close?.();
        } catch (e) {}
        finish();
      }, 1500);
      try {
        server.close(() => {
          try {
            clearTimeout(timer);
          } catch (e) {}
          finish();
        });
      } catch (e) {
        try {
          clearTimeout(timer);
        } catch (err) {}
        finish();
      }
    });
  }

  async setEnabled(enabled) {
    this.enabled = !!enabled;
    await dbManager.saveSetting('openclaw_enabled', this.enabled);
    if (this.enabled) {
      await this.ensureRunning();
    } else {
      await this.stopBridge();
      await this.stopGateway();
    }
    return this.getStatus();
  }

  async restartGateway() {
    if (!this.isReady) await this.init();
    await this.stopGateway();
    await this.startGateway();
    if (this.enabled) {
      await this.startBridge();
    }
    return this.getStatus();
  }

  async _runCli(args, opts) {
    const exe = await this._resolveExecutable();
    if (!exe) return { success: false, error: 'OpenClaw 未安装或未在 PATH 中找到' };
    const openclawHome = await this._getOpenClawHome();
    const argv = Array.isArray(args) ? args.map((x) => String(x)) : [];
    const timeoutMs = Number(opts?.timeoutMs || 120_000);
    let env = this._sanitizeProxyEnv({ ...process.env, OPENCLAW_HOME: openclawHome });
    env = await this._injectConfigEnvFallbacks(env, openclawHome);
    env = this._injectToolsPath(this._ensureChildPath(env), openclawHome);
    try {
      const gatewayToken = await this._ensureGatewayToken();
      let integrated = { env: {} };
      try {
        integrated = await this._ensureIntegratedModels(openclawHome, { gatewayToken });
      } catch (e) {}
      if (integrated && integrated.env && typeof integrated.env === 'object') {
        for (const [k, v] of Object.entries(integrated.env)) {
          env[String(k)] = String(v);
        }
      }
      const feishuAppId = String((await this._getDecryptedSetting('openclaw_feishu_app_id')) || '').trim();
      const feishuAppSecret = String((await this._getDecryptedSetting('openclaw_feishu_app_secret')) || '').trim();
      if (feishuAppId) env.FEISHU_APP_ID = feishuAppId;
      if (feishuAppSecret) env.FEISHU_APP_SECRET = feishuAppSecret;
    } catch (e) {}

    return new Promise((resolve) => {
      let out = '';
      let err = '';
      let done = false;
      const child = spawn(exe, argv, { stdio: ['ignore', 'pipe', 'pipe'], env });
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (e) {}
      }, timeoutMs);
      child.stdout.on('data', (d) => { out += String(d || ''); });
      child.stderr.on('data', (d) => { err += String(d || ''); });
      child.on('close', (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ success: code === 0, exitCode: code, stdout: out, stderr: err });
      });
      child.on('error', (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ success: false, error: e?.message || 'spawn_failed', stdout: out, stderr: err });
      });
    });
  }

  async pluginsList() {
    if (!this.isReady) await this.init();
    const tries = [
      ['plugins', 'list', '--json'],
      ['plugins', 'list']
    ];
    for (const t of tries) {
      const r = await this._runCli(t, { timeoutMs: 60_000 });
      if (r && r.success) {
        const next = { ...r, stdout: this._scrubCommonSecretPatterns(r.stdout), stderr: this._scrubCommonSecretPatterns(r.stderr) };
        return { success: true, result: next };
      }
    }
    return { success: false, error: 'plugins_list_failed' };
  }

  _stripAnsi(text) {
    return String(text || '').replace(/\u001b\[[0-9;]*m/g, '');
  }

  _parsePluginsListOutput(text) {
    const raw = this._extractJsonBlock(text);
    if (!raw) return null;
    try {
      const j = JSON.parse(String(raw));
      return j && typeof j === 'object' ? j : null;
    } catch (e) {
      return null;
    }
  }

  _extractJsonBlock(text) {
    const cleaned = this._stripAnsi(String(text || ''));
    const pObj = cleaned.indexOf('{');
    const pArr = cleaned.indexOf('[');
    const pos =
      pObj < 0 ? pArr : pArr < 0 ? pObj : Math.min(pObj, pArr);
    if (pos < 0) return '';
    const start = cleaned[pos];
    const endCh = start === '[' ? ']' : '}';
    const last = cleaned.lastIndexOf(endCh);
    if (last <= pos) return '';
    return cleaned.slice(pos, last + 1);
  }

  _parseSkillsListOutput(text) {
    const raw = this._extractJsonBlock(text);
    if (!raw) return [];
    try {
      const j = JSON.parse(String(raw));
      if (Array.isArray(j)) return j;
      if (j && Array.isArray(j.skills)) return j.skills;
      if (j && Array.isArray(j.items)) return j.items;
      return [];
    } catch (e) {
      return [];
    }
  }

  async pluginsInstall(spec) {
    if (!this.isReady) await this.init();
    const s = String(spec || '').trim();
    if (!s) return { success: false, error: 'invalid_spec' };
    const r = await this._runCli(['plugins', 'install', s], { timeoutMs: 180_000 });
    const next = r ? { ...r, stdout: this._scrubCommonSecretPatterns(r.stdout), stderr: this._scrubCommonSecretPatterns(r.stderr) } : r;
    if (!next?.success) return { success: false, result: next, error: next?.error || 'install_failed' };
    return { success: true, result: next };
  }

  async _skillsListCli() {
    const tries = [
      ['skills', 'list', '--json'],
      ['skills', 'list']
    ];
    for (const t of tries) {
      const r = await this._runCli(t, { timeoutMs: 60_000 });
      if (r && r.success) return { success: true, result: r };
    }
    return { success: false, error: 'skills_list_failed' };
  }

  async _runClawhub(args, opts) {
    const openclawHome = await this._getOpenClawHome();
    try {
      const gatewayToken = await this._ensureGatewayToken();
      await this._ensureIntegratedModels(openclawHome, { gatewayToken });
    } catch (e) {}
    const workspaceDir = path.join(String(openclawHome), '.openclaw', 'workspace');
    const clawhubHome = path.join(String(openclawHome), '.openclaw', '.clawhub-home');
    const timeoutMs = Number(opts?.timeoutMs || 240_000);
    const npxName = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const npxPath = findExecutableOnPath([npxName]) || npxName;
    let env = this._sanitizeProxyEnv({ ...process.env, OPENCLAW_HOME: openclawHome, HOME: clawhubHome });
    env = await this._injectConfigEnvFallbacks(env, openclawHome);
    env = this._injectToolsPath(this._ensureChildPath(env), openclawHome);
    try {
      await fs.promises.mkdir(clawhubHome, { recursive: true });
      await fs.promises.mkdir(path.join(workspaceDir, 'skills'), { recursive: true });
    } catch (e) {}
    const argv = ['-y', 'clawhub', ...(Array.isArray(args) ? args.map((x) => String(x)) : []), '--workdir', workspaceDir, '--dir', 'skills', '--no-input'];
    return await new Promise((resolve) => {
      let out = '';
      let err = '';
      let done = false;
      const child = spawn(npxPath, argv, { env, stdio: ['ignore', 'pipe', 'pipe'] });
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch (e) {}
      }, Math.max(10_000, timeoutMs));
      child.stdout.on('data', (d) => {
        out += String(d || '');
      });
      child.stderr.on('data', (d) => {
        err += String(d || '');
      });
      child.on('close', (code) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ success: code === 0, exitCode: code, stdout: out, stderr: err, error: code === 0 ? '' : 'clawhub_failed' });
      });
      child.on('error', (e) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve({ success: false, exitCode: 1, stdout: out, stderr: err, error: e?.message || 'spawn_failed' });
      });
    });
  }

  async _skillsInstallCli(id) {
    const r = await this._runClawhub(['install', String(id)], { timeoutMs: 300_000 });
    if (r?.success) return { success: true, result: r };
    return { success: false, result: r, error: r?.error || r?.stderr || 'skills_install_failed' };
  }

  async _skillsUpdateCli(id) {
    const r = await this._runClawhub(['update', String(id)], { timeoutMs: 300_000 });
    if (r?.success) return { success: true, result: r };
    return { success: false, result: r, error: r?.error || r?.stderr || 'skills_update_failed' };
  }

  async _skillsUninstallCli(id) {
    const r = await this._runClawhub(['uninstall', String(id)], { timeoutMs: 180_000 });
    if (r?.success) return { success: true, result: r };
    return { success: false, result: r, error: r?.error || r?.stderr || 'skills_uninstall_failed' };
  }

  async _pluginsSetEnabled(id, enabled) {
    const cmd = enabled ? 'enable' : 'disable';
    const r = await this._runCli(['plugins', cmd, String(id)], { timeoutMs: 120_000 });
    if (r?.success) return { success: true, result: r };
    return { success: false, result: r, error: r?.error || `plugins_${cmd}_failed` };
  }

  async _skillsSetEnabledFallback(id, enabled) {
    const openclawHome = await this._getOpenClawHome();
    const activeDir = path.join(String(openclawHome), '.openclaw', 'workspace', 'skills', String(id));
    const disabledRoot = path.join(String(openclawHome), '.openclaw', 'workspace', 'skills-disabled');
    const disabledDir = path.join(disabledRoot, String(id));
    if (enabled) {
      if (!pathExists(disabledDir)) return { success: true };
      await fs.promises.mkdir(path.dirname(activeDir), { recursive: true });
      await fs.promises.rm(activeDir, { recursive: true, force: true });
      await fs.promises.rename(disabledDir, activeDir);
      return { success: true };
    }
    if (!pathExists(activeDir)) return { success: true };
    await fs.promises.mkdir(disabledRoot, { recursive: true });
    await fs.promises.rm(disabledDir, { recursive: true, force: true });
    await fs.promises.rename(activeDir, disabledDir);
    return { success: true };
  }

  async listUtilitySkills() {
    if (!this.isReady) await this.init();
    const [pluginsRes, skillsRes] = await Promise.all([this.pluginsList(), this._skillsListCli()]);
    const pluginsRaw = `${String(pluginsRes?.result?.stdout || '')}\n${String(pluginsRes?.result?.stderr || '')}`.trim();
    const skillsRaw = `${String(skillsRes?.result?.stdout || '')}\n${String(skillsRes?.result?.stderr || '')}`.trim();
    const pluginsParsed = this._parsePluginsListOutput(pluginsRaw);
    const pluginRows = Array.isArray(pluginsParsed?.plugins) ? pluginsParsed.plugins : [];
    const skillRows = this._parseSkillsListOutput(skillsRaw);
    const norm = (v) => String(v || '').trim().toLowerCase();
    const pluginById = new Map();
    for (const p of pluginRows) {
      const id = norm(p?.id);
      if (id) pluginById.set(id, p);
    }
    const skillById = new Map();
    for (const s of skillRows) {
      const ids = [s?.id, s?.name, s?.slug].map((x) => norm(x)).filter(Boolean);
      for (const id of ids) {
        if (!skillById.has(id)) skillById.set(id, s);
      }
    }
    const list = OPENCLAW_UTILITY_SKILL_CATALOG.map((meta) => {
      const aliases = Array.from(new Set([meta.id, ...(Array.isArray(meta.aliases) ? meta.aliases : [])].map((x) => norm(x)).filter(Boolean)));
      if (meta.type === 'plugin') {
        let p = null;
        for (const a of aliases) {
          if (pluginById.has(a)) {
            p = pluginById.get(a);
            break;
          }
        }
        return {
          ...meta,
          installed: !!p,
          enabled: !!p?.enabled,
          status: String(p?.status || (p ? 'installed' : 'missing')),
          error: p?.error ? String(p.error) : '',
          source: 'plugins'
        };
      }
      let s = null;
      for (const a of aliases) {
        if (skillById.has(a)) {
          s = skillById.get(a);
          break;
        }
      }
      const installed = !!s;
      const enabled = installed ? s?.enabled !== false : false;
      return {
        ...meta,
        installed,
        enabled: installed ? !!enabled : false,
        status: String(s?.status || (installed ? (enabled ? 'installed' : 'disabled') : 'missing')),
        error: s?.error ? String(s.error) : '',
        source: 'skills'
      };
    });
    return {
      success: true,
      skills: list,
      pluginsRaw: this._stripAnsi(pluginsRaw),
      skillsRaw: this._stripAnsi(skillsRaw)
    };
  }

  async installUtilitySkills(payload) {
    if (!this.isReady) await this.init();
    const p = payload && typeof payload === 'object' ? payload : {};
    const requested = Array.isArray(p.skills)
      ? p.skills.map((x) => String(x || '').trim()).filter(Boolean)
      : OPENCLAW_UTILITY_SKILL_CATALOG.filter((x) => x.preinstall).map((x) => x.id);
    const unique = Array.from(new Set(requested));
    const installed = [];
    const failed = [];
    const verifyInstalled = async (id) => {
      const list = await this.listUtilitySkills();
      const row = Array.isArray(list?.skills) ? list.skills.find((x) => String(x?.id || '') === String(id)) : null;
      return !!row?.installed;
    };
    for (const id of unique) {
      const meta = OPENCLAW_UTILITY_SKILL_CATALOG.find((x) => x.id === id);
      const r = meta?.type === 'plugin' ? await this.pluginsInstall(id) : await this._skillsInstallCli(id);
      if (!r?.success && meta?.type !== 'plugin') {
        const fallback = await this.pluginsInstall(id);
        if (fallback?.success && (await verifyInstalled(id))) {
          installed.push(id);
          continue;
        }
      }
      if (r?.success && (await verifyInstalled(id))) installed.push(id);
      else if (r?.success) failed.push({ id, error: 'install_unverified_not_found_in_openclaw' });
      else failed.push({ id, error: String(r?.error || r?.result?.stderr || r?.result?.stdout || 'install_failed') });
    }
    let list = null;
    try {
      list = await this.listUtilitySkills();
    } catch (e) {}
    return { success: failed.length === 0, installed, failed, list };
  }

  async ensureDefaultUtilitySkills() {
    if (!this.isReady) await this.init();
    let bootstrapped = false;
    try {
      bootstrapped = !!(await dbManager.getSetting('openclaw_default_skills_bootstrapped'));
    } catch (e) {}
    if (bootstrapped) return { success: true, skipped: true };
    const res = await this.installUtilitySkills({
      skills: OPENCLAW_UTILITY_SKILL_CATALOG.filter((x) => x.preinstall).map((x) => x.id)
    });
    try {
      await dbManager.saveSetting('openclaw_default_skills_bootstrapped', !!res?.success);
      await dbManager.saveSetting('openclaw_default_skills_bootstrap_last', {
        at: Date.now(),
        success: !!res?.success,
        failed: Array.isArray(res?.failed) ? res.failed : []
      });
    } catch (e) {}
    return { success: !!res?.success, bootstrapped: !!res?.success, result: res };
  }

  async setUtilitySkillEnabled(payload) {
    if (!this.isReady) await this.init();
    const p = payload && typeof payload === 'object' ? payload : {};
    const id = String(p.id || '').trim();
    const enabled = p.enabled === true;
    if (!id) return { success: false, error: 'invalid_id' };
    const meta = OPENCLAW_UTILITY_SKILL_CATALOG.find((x) => x.id === id) || { id, type: 'skill' };
    if (meta.type === 'plugin') {
      const r = await this._pluginsSetEnabled(id, enabled);
      if (!r?.success) return { success: false, error: r?.error || 'set_enabled_failed' };
      await this.restartGateway();
      const status = await this.listUtilitySkills();
      const row = Array.isArray(status?.skills) ? status.skills.find((x) => String(x?.id || '') === id) : null;
      if (row && row.enabled !== enabled) return { success: false, error: 'set_enabled_unverified', status };
      return { success: true, status };
    }
    const cmd = enabled ? 'enable' : 'disable';
    const cli = await this._runCli(['skills', cmd, id], { timeoutMs: 120_000 });
    if (!cli?.success) {
      try {
        await this._skillsSetEnabledFallback(id, enabled);
      } catch (e) {
        return { success: false, error: String(e?.message || `skills_${cmd}_failed`) };
      }
    }
    await this.restartGateway();
    const status = await this.listUtilitySkills();
    const row = Array.isArray(status?.skills) ? status.skills.find((x) => String(x?.id || '') === id) : null;
    if (row && row.enabled !== enabled) return { success: false, error: 'set_enabled_unverified', status };
    return { success: true, status };
  }

  async removeUtilitySkill(payload) {
    if (!this.isReady) await this.init();
    const p = payload && typeof payload === 'object' ? payload : {};
    const id = String(p.id || '').trim();
    if (!id) return { success: false, error: 'invalid_id' };
    const meta = OPENCLAW_UTILITY_SKILL_CATALOG.find((x) => x.id === id) || { id, type: 'skill' };
    if (meta.type === 'plugin') {
      const r = await this._runCli(['plugins', 'uninstall', id], { timeoutMs: 180_000 });
      if (!r?.success) return { success: false, error: r?.error || 'plugins_uninstall_failed' };
      await this.restartGateway();
      const status = await this.listUtilitySkills();
      const row = Array.isArray(status?.skills) ? status.skills.find((x) => String(x?.id || '') === id) : null;
      if (row?.installed) return { success: false, error: 'remove_unverified', status };
      return { success: true, status };
    }
    const r = await this._skillsUninstallCli(id);
    try {
      const openclawHome = await this._getOpenClawHome();
      await fs.promises.rm(path.join(String(openclawHome), '.openclaw', 'workspace', 'skills', id), { recursive: true, force: true });
      await fs.promises.rm(path.join(String(openclawHome), '.openclaw', 'workspace', 'skills-disabled', id), { recursive: true, force: true });
    } catch (e) {}
    if (!r?.success) return { success: false, error: r?.error || 'skills_uninstall_failed' };
    await this.restartGateway();
    const status = await this.listUtilitySkills();
    const row = Array.isArray(status?.skills) ? status.skills.find((x) => String(x?.id || '') === id) : null;
    if (row?.installed) return { success: false, error: 'remove_unverified', status };
    return { success: true, status };
  }

  async updateUtilitySkill(payload) {
    if (!this.isReady) await this.init();
    const p = payload && typeof payload === 'object' ? payload : {};
    const id = String(p.id || '').trim();
    if (!id) return { success: false, error: 'invalid_id' };
    const before = await this.listUtilitySkills();
    const current = Array.isArray(before?.skills) ? before.skills.find((x) => String(x?.id || '') === id) : null;
    const wasInstalled = !!current?.installed;
    const wasEnabled = !!current?.enabled;
    const meta = OPENCLAW_UTILITY_SKILL_CATALOG.find((x) => x.id === id) || { id, type: 'skill' };
    const r = meta.type === 'plugin' ? await this._runCli(['plugins', 'update', id], { timeoutMs: 240_000 }) : await this._skillsUpdateCli(id);
    if (!r?.success) {
      if (wasInstalled) {
        if (meta.type === 'plugin') await this._runCli(['plugins', 'install', id], { timeoutMs: 240_000 });
        else await this._skillsInstallCli(id);
        if (!wasEnabled) {
          try {
            await this.setUtilitySkillEnabled({ id, enabled: false });
          } catch (e) {}
        }
      }
      return { success: false, error: r?.error || 'update_failed', status: await this.listUtilitySkills() };
    }
    await this.restartGateway();
    const status = await this.listUtilitySkills();
    const row = Array.isArray(status?.skills) ? status.skills.find((x) => String(x?.id || '') === id) : null;
    if (!row?.installed) return { success: false, error: 'update_unverified', status };
    return { success: true, status };
  }

  _scrubCommonSecretPatterns(text) {
    let s = String(text || '');
    const rules = [
      [/"appSecret"\s*:\s*"[^"]*"/g, '"appSecret":"***REDACTED***"'],
      [/appSecret\s*[:=]\s*["']?[^"'\s]+/gi, 'appSecret="***REDACTED***"'],
      [/"apiKey"\s*:\s*"[^"]*"/g, '"apiKey":"***REDACTED***"'],
      [/\bOPENCLAW_GATEWAY_TOKEN\b\s*[:=]\s*["']?[^"'\s]+/g, 'OPENCLAW_GATEWAY_TOKEN="***REDACTED***"'],
      [/\bNGOPLANNER_BRIDGE_TOKEN\b\s*[:=]\s*["']?[^"'\s]+/g, 'NGOPLANNER_BRIDGE_TOKEN="***REDACTED***"'],
      [/\bNGOPLANNER_[A-Z0-9_]+_API_KEY\b\s*[:=]\s*["']?[^"'\s]+/g, 'NGOPLANNER_API_KEY="***REDACTED***"']
    ];
    for (const [re, rep] of rules) s = s.replace(re, rep);
    return s;
  }

  async applyNgoPlannerPreset() {
    if (!this.isReady) await this.init();
    const openclawHome = await this._getOpenClawHome();
    const gatewayToken = await this._ensureGatewayToken();
    try {
      await this._ensureNgoPlannerBridgeSkill(openclawHome);
    } catch (e) {}
    try {
      await this._ensureNgoPlannerBridgeOpenClawPlugin(openclawHome);
    } catch (e) {}
    try {
      await this._syncMarketplaceSkills(openclawHome);
    } catch (e) {}
    let integrated = { env: {} };
    try {
      integrated = await this._ensureIntegratedModels(openclawHome, { gatewayToken });
    } catch (e) {}
    try {
      await this._scrubSecretsInConfigFiles(openclawHome);
    } catch (e) {}
    try {
      await this._cleanupFeishuPluginState(openclawHome);
    } catch (e) {}
    try {
      await this._repairOpenClawAgentCaches(openclawHome);
    } catch (e) {}

    const feishuAppId = String((await this._getDecryptedSetting('openclaw_feishu_app_id')) || '').trim();
    const feishuAppSecret = String((await this._getDecryptedSetting('openclaw_feishu_app_secret')) || '').trim();
    try {
      await this._scrubSecretsInTextFiles(openclawHome, [
        feishuAppSecret,
        feishuAppId,
        gatewayToken,
        ...(integrated && integrated.env && typeof integrated.env === 'object' ? Object.values(integrated.env) : [])
      ]);
    } catch (e) {}
    const installed = [];
    const installErrors = [];
    if (feishuAppId && feishuAppSecret) {
      installed.push('feishu');
    }

    await this.restartGateway();
    return { success: true, installed, installErrors, status: await this.getStatus() };
  }

  async scrubSensitiveNow() {
    if (!this.isReady) await this.init();
    const openclawHome = await this._getOpenClawHome();
    const gatewayToken = await this._ensureGatewayToken();
    const bridgeToken = await this._ensureBridgeToken();
    const feishuAppId = String((await this._getDecryptedSetting('openclaw_feishu_app_id')) || '').trim();
    const feishuAppSecret = String((await this._getDecryptedSetting('openclaw_feishu_app_secret')) || '').trim();
    let integrated = { env: {} };
    try {
      integrated = await this._ensureIntegratedModels(openclawHome, { gatewayToken });
    } catch (e) {}

    const cfg = await this._scrubSecretsInConfigFiles(openclawHome);
    const txt = await this._scrubSecretsInTextFiles(openclawHome, [
      feishuAppSecret,
      feishuAppId,
      gatewayToken,
      bridgeToken,
      ...(integrated && integrated.env && typeof integrated.env === 'object' ? Object.values(integrated.env) : [])
    ]);
    let repaired = null;
    try {
      repaired = await this._repairOpenClawAgentCaches(openclawHome);
    } catch (e) {
      repaired = null;
    }
    return { success: true, config: cfg, text: txt, repaired };
  }

  async runAgentMessage(message) {
    const exe = await this._resolveExecutable();
    if (!exe) return { success: false, error: 'OpenClaw 未安装或未在 PATH 中找到' };
    const msg = String(message || '').trim();
    if (!msg) return { success: false, error: 'message required' };

    return new Promise((resolve) => {
      (async () => {
        try {
          const openclawHome = await this._getOpenClawHome();
          try {
            await this.ensureRunning();
            await this.startBridge();
          } catch (e) {}
          const token = await this._ensureBridgeToken();
          try {
            await this._ensureNgoPlannerBridgeSkill(openclawHome);
          } catch (e) {}
          let integrated = { env: {} };
          try {
            const gatewayToken = await this._ensureGatewayToken();
            integrated = await this._ensureIntegratedModels(openclawHome, { gatewayToken });
          } catch (e) {}
          const bridgeUrl = `http://127.0.0.1:${this.bridgePort}`;
          let env = {
            ...process.env,
            OPENCLAW_HOME: openclawHome,
            NGOPLANNER_BRIDGE_TOKEN: token,
            NGOPLANNER_BRIDGE_PORT: String(this.bridgePort),
            NGOPLANNER_BRIDGE_URL: bridgeUrl,
            ...(integrated?.env || {})
          };
          env = this._sanitizeProxyEnv(env);
          env = await this._injectConfigEnvFallbacks(env, openclawHome);
          env = this._injectToolsPath(this._ensureChildPath(env), openclawHome);
          let timeoutMs = 300_000;
          try {
            const v = Number(await dbManager.getSetting('openclaw_agent_timeout_ms'));
            if (Number.isFinite(v) && v >= 60_000) timeoutMs = Math.min(900_000, Math.round(v));
          } catch (e) {}

          const child = spawn(exe, ['agent', '--agent', 'main', '--message', msg], { stdio: ['ignore', 'pipe', 'pipe'], env });
          let out = '';
          let err = '';
          let timedOut = false;
          const agentLogPath = path.join(openclawHome, '.openclaw', 'ngo-planner-openclaw-agent.log');
          let agentLogStream = null;
          try {
            await fs.promises.mkdir(path.dirname(agentLogPath), { recursive: true });
            agentLogStream = fs.createWriteStream(agentLogPath, { flags: 'a' });
            agentLogStream.write(`\n[${new Date().toISOString()}] agent run\n`);
          } catch (e) {}
          const timer = setTimeout(() => {
            timedOut = true;
            try {
              child.kill('SIGTERM');
            } catch (e) {}
            setTimeout(() => {
              try {
                child.kill('SIGKILL');
              } catch (err) {}
            }, 1200);
          }, timeoutMs);
          child.stdout.on('data', (d) => {
            const s = d.toString();
            out += s;
            try {
              agentLogStream?.write?.(s);
            } catch (e) {}
          });
          child.stderr.on('data', (d) => {
            const s = d.toString();
            err += s;
            try {
              agentLogStream?.write?.(s);
            } catch (e) {}
          });
          child.on('close', (code) => {
            clearTimeout(timer);
            try {
              agentLogStream?.write?.(`\n[${new Date().toISOString()}] agent close code=${code}\n`);
            } catch (e) {}
            try {
              agentLogStream?.end?.();
            } catch (e) {}
            const success = code === 0 && !timedOut;
            resolve({
              success,
              code,
              stdout: out.trim(),
              stderr: err.trim(),
              error: !success && timedOut ? 'timeout' : undefined,
              timedOut,
              openclawHome,
              agentLogPath: pathExists(agentLogPath) ? agentLogPath : null
            });
          });
        } catch (e) {
          resolve({ success: false, error: e.message });
        }
      })();
    });
  }

  async getStatus() {
    const exe = await this._resolveExecutable();
    const running = await isPortOpen(this.port);
    return {
      enabled: this.enabled,
      installed: !!exe,
      executable: exe || null,
      gateway: {
        port: this.port,
        running,
        managedByApp: !!this.process,
        pid: this.process?.pid || null,
        logPath: this.gatewayLogPath && pathExists(this.gatewayLogPath) ? this.gatewayLogPath : null
      },
      bridge: {
        port: this.bridgePort,
        running: !!this.bridgeServer
      },
      lastError: this.lastError
    };
  }
}

module.exports = new OpenClawService();
