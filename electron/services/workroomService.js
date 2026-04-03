const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { app } = require('electron');
const dbManager = require('../databaseManager');
const openclawService = require('./openclawService');
const marketplaceService = require('./marketplaceService');

const readJson = async (p) => {
  try {
    const raw = await fs.promises.readFile(p, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    return null;
  }
};

const writeJson = async (p, obj) => {
  await fs.promises.mkdir(path.dirname(p), { recursive: true });
  const s = JSON.stringify(obj || {}, null, 2);
  if (process.platform === 'win32') {
    await fs.promises.writeFile(p, s, 'utf8');
    return;
  }
  await fs.promises.writeFile(p, s, { encoding: 'utf8', mode: 0o600 });
  try {
    await fs.promises.chmod(p, 0o600);
  } catch (e) {}
};

const safeId = (s) =>
  String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);

const now = () => Date.now();

const parseFrontmatter = (md) => {
  const text = String(md || '');
  if (!text.startsWith('---')) return { data: {}, body: text };
  const parts = text.split(/\r?\n---\r?\n/);
  if (parts.length < 2) return { data: {}, body: text };
  const fmBlock = parts[0].replace(/^---\r?\n/, '');
  const body = parts.slice(1).join('\n---\n');
  const data = {};
  for (const line of fmBlock.split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)\s*$/);
    if (!m) continue;
    data[m[1]] = m[2];
  }
  return { data, body };
};

const httpGetJson = async (url) => {
  const u = new URL(String(url || ''));
  if (u.protocol !== 'https:') throw new Error('https_only');
  return await new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'GET',
        hostname: u.hostname,
        port: u.port ? Number(u.port) : 443,
        path: `${u.pathname}${u.search}`,
        headers: {
          'user-agent': 'ngo-planner-desktop',
          accept: 'application/vnd.github+json'
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += String(c || '');
          if (raw.length > 2_000_000) res.destroy();
        });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`http_${res.statusCode || 0}`));
            return;
          }
          try {
            resolve(JSON.parse(raw || '{}'));
          } catch (e) {
            reject(new Error('invalid_json'));
          }
        });
      },
    );
    req.on('error', (e) => reject(e));
    req.end();
  });
};

const httpGetText = async (url, maxBytes = 2_000_000) => {
  const u = new URL(String(url || ''));
  if (u.protocol !== 'https:') throw new Error('https_only');
  return await new Promise((resolve, reject) => {
    const req = https.request(
      {
        method: 'GET',
        hostname: u.hostname,
        port: u.port ? Number(u.port) : 443,
        path: `${u.pathname}${u.search}`,
        headers: {
          'user-agent': 'ngo-planner-desktop',
          accept: '*/*'
        }
      },
      (res) => {
        let raw = '';
        res.on('data', (c) => {
          raw += String(c || '');
          if (raw.length > maxBytes) res.destroy();
        });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`http_${res.statusCode || 0}`));
            return;
          }
          resolve(raw);
        });
      },
    );
    req.on('error', (e) => reject(e));
    req.end();
  });
};

const httpGetBuffer = async (url, maxBytes = 10_000_000) => {
  const u = new URL(String(url || ''));
  if (u.protocol !== 'https:') throw new Error('https_only');
  return await new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    const req = https.request(
      {
        method: 'GET',
        hostname: u.hostname,
        port: u.port ? Number(u.port) : 443,
        path: `${u.pathname}${u.search}`,
        headers: { 'user-agent': 'ngo-planner-desktop', accept: '*/*' }
      },
      (res) => {
        res.on('data', (c) => {
          const b = Buffer.isBuffer(c) ? c : Buffer.from(String(c || ''));
          chunks.push(b);
          total += b.length;
          if (total > maxBytes) res.destroy();
        });
        res.on('end', () => {
          if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`http_${res.statusCode || 0}`));
            return;
          }
          resolve(Buffer.concat(chunks));
        });
      },
    );
    req.on('error', (e) => reject(e));
    req.end();
  });
};

const isUnder = (p, root) => {
  const a = path.resolve(String(p || ''));
  const b = path.resolve(String(root || ''));
  const base = b.replace(/\/+$/, '') + path.sep;
  return a === b || a.startsWith(base);
};

// --- Config Constants ---

const DEFAULT_ROLES = [
  {
    id: 'role-designer',
    name: '作图机器人',
    kind: 'designer',
    description: '负责配图、海报、封面图的生成与迭代修改，完成后归档。',
    defaultRoom: 'Design',
    permissions: { network: 'allowlist', write: 'approval', publish: 'never' }
  },
  {
    id: 'role-researcher',
    name: '调研机器人',
    kind: 'researcher',
    description: '负责资料检索、事实核查、引用整理，形成可审阅稿。',
    defaultRoom: 'Writing',
    permissions: { network: 'allowlist', write: 'approval', publish: 'never' }
  },
  {
    id: 'role-operator',
    name: '新媒体运营机器人',
    kind: 'operator',
    description: '负责排版、预览与发布前检查，发布需要人类确认。',
    defaultRoom: 'Community',
    permissions: { network: 'allowlist', write: 'approval', publish: 'confirm' }
  },
  {
    id: 'role-scribe',
    name: '记录机器人',
    kind: 'scribe',
    description: '负责群内讨论记录、整理入库、定期汇总选题。',
    defaultRoom: 'Writing',
    permissions: { network: 'deny', write: 'approval', publish: 'never' }
  },
  {
    id: 'role-finance',
    name: '财务机器人',
    kind: 'finance',
    description: '负责发票/报销登记与汇总，提交审批需要人类确认。',
    defaultRoom: 'Forms',
    permissions: { network: 'deny', write: 'approval', publish: 'never' }
  },
  {
    id: 'role-secretary',
    name: '秘书机器人',
    kind: 'secretary',
    description: '负责会议/活动安排、冲突检测与定时提醒。',
    defaultRoom: 'Community',
    permissions: { network: 'deny', write: 'approval', publish: 'never' }
  }
];

// Based on user's 5 specific scenarios
const DEFAULT_SCENARIOS = [
  {
    id: 'scene-design-iterate',
    name: '群内作图迭代归档',
    description: '群里提出作图需求→生成→反馈修改→一致后归档到知识库/素材库。',
    requiredSources: { kb: true },
    roles: ['role-designer'],
    keywords: ['image', 'design', 'generate', 'poster', 'picture', 'drawing', 'art', '作图', '画图'],
    risk: 'yellow'
  },
  {
    id: 'scene-content-pipeline',
    name: '调研→配图→排版→预览→群审→发布',
    description: '从新想法到终稿与发布的流水线，支持多人反馈迭代。',
    requiredSources: { kb: true, projects: false, calendar: true },
    roles: ['role-researcher', 'role-designer', 'role-operator'],
    keywords: ['research', 'search', 'news', 'article', 'publish', 'draft', 'writer', '调研', '写作'],
    risk: 'red'
  },
  {
    id: 'scene-scribe-kb',
    name: '群讨论记录→知识库沉淀→定期综述',
    description: '记录群观点，持续补充并定期输出选题文档。',
    requiredSources: { kb: true },
    roles: ['role-scribe'],
    keywords: ['record', 'summarize', 'digest', 'notes', 'history', 'archive', '记录', '摘要'],
    risk: 'yellow'
  },
  {
    id: 'scene-finance-expenses',
    name: '发票入群→OCR登记→汇总→定时提审',
    description: '发票附件识别与登记，周期性汇总并提交审批。',
    requiredSources: { projects: true },
    roles: ['role-finance'],
    keywords: ['finance', 'invoice', 'expense', 'receipt', 'money', 'accounting', 'ocr', '报销', '发票'],
    risk: 'red'
  },
  {
    id: 'scene-secretary-calendar',
    name: '群里安排会议→创建日程→定时提醒',
    description: '从群消息提取会议要素，冲突检测后创建日程并提醒。',
    requiredSources: { calendar: true },
    roles: ['role-secretary'],
    keywords: ['calendar', 'schedule', 'meeting', 'appointment', 'remind', 'date', 'time', '会议', '日程'],
    risk: 'yellow'
  }
];

const DEFAULT_POLICY = {
  allowRed: false,
  allowNetwork: true,
  allowPublish: false,
  allowAutoSchedule: true
};

const DEFAULT_SOURCES = [
  {
    id: 'awesome-openclaw',
    type: 'github',
    label: 'Awesome OpenClaw Skills (Community)',
    owner: 'VoltAgent',
    repo: 'awesome-openclaw-skills',
    branch: 'main',
    skillsPath: 'categories',
    enabled: true
  }
];

const getResourcesRoot = () => {
  if (app.isPackaged) return process.resourcesPath;
  return app.getAppPath();
};

const officialSkillsRoot = () => {
  const root = getResourcesRoot();
  if (app.isPackaged) return path.join(root, 'official_skills');
  return path.join(root, 'resources', 'official_skills');
};

const copyDirRecursive = async (src, dst) => {
  await fs.promises.mkdir(dst, { recursive: true });
  const ents = await fs.promises.readdir(src, { withFileTypes: true });
  for (const ent of ents) {
    const name = String(ent?.name || '');
    if (!name) continue;
    const a = path.join(src, name);
    const b = path.join(dst, name);
    if (ent.isDirectory()) await copyDirRecursive(a, b);
    else if (ent.isFile()) {
      const buf = await fs.promises.readFile(a);
      await fs.promises.writeFile(b, buf);
    }
  }
};

const sha256File = async (p) => {
  const h = crypto.createHash('sha256');
  const buf = await fs.promises.readFile(p);
  h.update(buf);
  return h.digest('hex');
};

class WorkroomService {
  async getConfig() {
    const stored = await dbManager.getSetting('workroom_config');
    const base = { roles: DEFAULT_ROLES, scenarios: DEFAULT_SCENARIOS, policy: DEFAULT_POLICY, sources: DEFAULT_SOURCES, updatedAt: now() };
    if (!stored || typeof stored !== 'object') return base;
    const merged = {
      ...base,
      ...stored,
      roles: Array.isArray(stored.roles) ? stored.roles : base.roles,
      scenarios: Array.isArray(stored.scenarios) ? stored.scenarios : base.scenarios,
      policy: stored.policy && typeof stored.policy === 'object' ? { ...base.policy, ...stored.policy } : base.policy,
      sources: Array.isArray(stored.sources) ? stored.sources : base.sources
    };
    return merged;
  }

  async saveConfig(next) {
    const cur = await this.getConfig();
    const cfg = next && typeof next === 'object' ? next : {};
    const out = {
      ...cur,
      ...cfg,
      roles: Array.isArray(cfg.roles) ? cfg.roles : cur.roles,
      scenarios: Array.isArray(cfg.scenarios) ? cfg.scenarios : cur.scenarios,
      policy: cfg.policy && typeof cfg.policy === 'object' ? { ...cur.policy, ...cfg.policy } : cur.policy,
      sources: Array.isArray(cfg.sources) ? cfg.sources : cur.sources,
      updatedAt: now()
    };
    await dbManager.saveSetting('workroom_config', out);
    return out;
  }

  async listOfficialSkills() {
    const root = officialSkillsRoot();
    const indexPath = path.join(root, 'index.json');
    const idx = await readJson(indexPath);
    if (!idx || !Array.isArray(idx.skills)) return { success: false, skills: [], error: 'official_index_missing' };
    return { success: true, skills: idx.skills };
  }

  async listMarketplaceSkills() {
    const r = await marketplaceService.listSkills();
    return { success: true, result: r };
  }

  async refreshRemoteIndex(payload) {
    const cfg = await this.getConfig();
    if (!cfg.policy?.allowNetwork) return { success: false, error: 'network_disabled' };
    const p = payload && typeof payload === 'object' ? payload : {};
    const sourceId = String(p.sourceId || '').trim();
    const sources = Array.isArray(cfg.sources) ? cfg.sources : [];
    const src = sources.find((s) => s && String(s.id || '') === sourceId);
    if (!src) return { success: false, error: 'source_not_found' };
    if (src.enabled === false) return { success: false, error: 'source_disabled' };
    
    const owner = String(src.owner || '').trim();
    const repo = String(src.repo || '').trim();
    const branch = String(src.branch || 'main').trim() || 'main';
    const skillsPath = String(src.skillsPath || 'skills').trim().replace(/^\/+|\/+$/g, '');
    if (!owner || !repo) return { success: false, error: 'github_repo_required' };

    // Special handling for VoltAgent/awesome-openclaw-skills
    const isAwesomeList = owner.toLowerCase() === 'voltagent' && repo.toLowerCase().includes('awesome');
    
    let repoMeta = null;
    try {
      repoMeta = await httpGetJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`);
    } catch (e) {
      repoMeta = null;
    }

    const skills = [];
    
    if (isAwesomeList) {
      // Parse Awesome List structure (categories/*.md)
      const listUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(skillsPath)}?ref=${encodeURIComponent(branch)}`;
      let items = [];
      try {
        const data = await httpGetJson(listUrl);
        items = Array.isArray(data) ? data : [];
      } catch (e) {
        return { success: false, error: e?.message || 'github_list_failed' };
      }

      for (const it of items) {
        if (!it || !it.name || !it.name.endsWith('.md')) continue;
        const catUrl = String(it.download_url || '');
        if (!catUrl) continue;
        let md = '';
        try {
          md = await httpGetText(catUrl);
        } catch (e) {
          continue;
        }
        
        // Parse lines like: - [skill-name](url) - description
        const lines = md.split(/\r?\n/);
        for (const line of lines) {
            const m = line.match(/^\s*-\s*\[(.*?)\]\((.*?)\)\s*-\s*(.*)$/);
            if (m) {
                const name = m[1].trim();
                const url = m[2].trim();
                const desc = m[3].trim();
                if (url.includes('github.com')) {
                    skills.push({
                        sourceId,
                        sourceType: 'github-awesome',
                        repo: `${owner}/${repo}`,
                        branch,
                        id: safeId(name),
                        name,
                        description: desc,
                        originUrl: url, // The actual skill repo URL
                        risk: 'unverified',
                        fetchedAt: new Date().toISOString()
                    });
                }
            }
        }
        if (skills.length >= 500) break;
      }

    } else {
      // Generic OpenClaw Skills Repo (folder based)
      const listUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(skillsPath)}?ref=${encodeURIComponent(branch)}`;
      let items = [];
      try {
        const data = await httpGetJson(listUrl);
        items = Array.isArray(data) ? data : [];
      } catch (e) {
        return { success: false, error: e?.message || 'github_list_failed' };
      }

      for (const it of items) {
        if (!it || String(it.type || '') !== 'dir') continue;
        const dirName = String(it.name || '').trim();
        if (!dirName) continue;
        const dirPath = String(it.path || '');
        const dirApiUrl = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodeURIComponent(dirPath)}?ref=${encodeURIComponent(branch)}`;
        let dirItems = [];
        try {
            const d = await httpGetJson(dirApiUrl);
            dirItems = Array.isArray(d) ? d : [];
        } catch (e) {
            continue;
        }
        const skillMd = dirItems.find((x) => x && String(x.name || '') === 'SKILL.md' && String(x.type || '') === 'file');
        if (!skillMd || !skillMd.download_url) continue;
        let md = '';
        try {
            md = await httpGetText(String(skillMd.download_url), 2_000_000);
        } catch (e) {
            md = '';
        }
        const { data } = parseFrontmatter(md);
        const name = String((data && data.name) || dirName).trim();
        const description = String((data && data.description) || '').trim();
        skills.push({
            sourceId,
            sourceType: 'github',
            repo: `${owner}/${repo}`,
            branch,
            skillsPath,
            id: dirName,
            name,
            description,
            dirPath,
            dirHtmlUrl: typeof it.html_url === 'string' ? it.html_url : '',
            risk: 'unverified',
            fetchedAt: new Date().toISOString()
        });
        if (skills.length >= 300) break;
      }
    }

    const cache = {
      sourceId,
      updatedAt: new Date().toISOString(),
      repo: `${owner}/${repo}`,
      branch,
      meta: repoMeta
        ? {
            fullName: String(repoMeta.full_name || ''),
            description: String(repoMeta.description || ''),
            stargazersCount: Number(repoMeta.stargazers_count || 0),
            forksCount: Number(repoMeta.forks_count || 0),
            openIssuesCount: Number(repoMeta.open_issues_count || 0),
            pushedAt: String(repoMeta.pushed_at || ''),
            updatedAt: String(repoMeta.updated_at || ''),
            htmlUrl: String(repoMeta.html_url || '')
          }
        : null,
      skills
    };
    try {
      await dbManager.saveSetting(`workroom_remote_index_${safeId(sourceId)}`, cache);
    } catch (e) {}
    return { success: true, cache };
  }

  async searchRemoteSkills(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const sourceId = String(p.sourceId || '').trim();
    const q = String(p.query || '').trim().toLowerCase();
    if (!sourceId) return { success: false, error: 'sourceId_required' };
    let cache = null;
    try {
      cache = await dbManager.getSetting(`workroom_remote_index_${safeId(sourceId)}`);
    } catch (e) {
      cache = null;
    }
    const skills = Array.isArray(cache?.skills) ? cache.skills : [];
    const list = q
      ? skills.filter((s) => {
          const name = String(s?.name || '').toLowerCase();
          const desc = String(s?.description || '').toLowerCase();
          const id = String(s?.id || '').toLowerCase();
          return name.includes(q) || desc.includes(q) || id.includes(q);
        })
      : skills;
    return { success: true, updatedAt: cache?.updatedAt || null, skills: list.slice(0, 200) };
  }

  async installRemoteSkill(payload) {
    const cfg = await this.getConfig();
    if (!cfg.policy?.allowNetwork) return { success: false, error: 'network_disabled' };
    const p = payload && typeof payload === 'object' ? payload : {};
    const sourceId = String(p.sourceId || '').trim();
    const skillId = String(p.skillId || '').trim();
    const originUrl = String(p.originUrl || '').trim();
    
    if (!sourceId || !skillId) return { success: false, error: 'sourceId_skillId_required' };
    
    // Determine target Repo and Path from originUrl if provided (Awesome List case)
    let targetOwner, targetRepo, targetBranch, targetPath;
    
    if (originUrl) {
         // Parse github url: https://github.com/owner/repo/tree/branch/path/to/skill
         const m = originUrl.match(/github\.com\/([^/]+)\/([^/]+)\/tree\/([^/]+)\/(.*)/);
         if (m) {
             targetOwner = m[1];
             targetRepo = m[2];
             targetBranch = m[3];
             targetPath = m[4];
             // If targetPath ends with SKILL.md, strip it to get the dir
             if (targetPath.endsWith('SKILL.md')) {
                 targetPath = path.dirname(targetPath);
             }
         } else {
             return { success: false, error: 'invalid_origin_url' };
         }
    } else {
        // Fallback to standard source config
        const sources = Array.isArray(cfg.sources) ? cfg.sources : [];
        const src = sources.find((s) => s && String(s.id || '') === sourceId);
        if (!src || src.enabled === false) return { success: false, error: 'source_not_available' };
        targetOwner = String(src.owner || '').trim();
        targetRepo = String(src.repo || '').trim();
        targetBranch = String(src.branch || 'main').trim() || 'main';
        const skillsPath = String(src.skillsPath || 'skills').trim().replace(/^\/+|\/+$/g, '');
        targetPath = `${skillsPath}/${skillId}`;
    }

    if (!targetOwner || !targetRepo) return { success: false, error: 'github_repo_required' };

    const loc = await marketplaceService.getLocations();
    await fs.promises.mkdir(loc.draftsSkills, { recursive: true });
    const dest = path.join(loc.draftsSkills, skillId);
    try {
      await fs.promises.rm(dest, { recursive: true, force: true });
    } catch (e) {}

    const downloadDir = async (repoPath, outDir, state) => {
      if (state.files > 200) throw new Error('too_many_files');
      const url = `https://api.github.com/repos/${encodeURIComponent(targetOwner)}/${encodeURIComponent(targetRepo)}/contents/${encodeURIComponent(repoPath)}?ref=${encodeURIComponent(targetBranch)}`;
      const items = await httpGetJson(url);
      const list = Array.isArray(items) ? items : [];
      await fs.promises.mkdir(outDir, { recursive: true });
      for (const it of list) {
        const type = String(it?.type || '');
        const name = String(it?.name || '');
        if (!name) continue;
        if (type === 'dir') {
          await downloadDir(String(it.path || ''), path.join(outDir, name), state);
        } else if (type === 'file') {
          const dl = String(it.download_url || '');
          if (!dl) continue;
          const buf = await httpGetBuffer(dl, 5_000_000);
          state.files++;
          state.bytes += buf.length;
          if (state.bytes > 20_000_000) throw new Error('too_large');
          await fs.promises.writeFile(path.join(outDir, name), buf);
        }
      }
    };

    try {
      await downloadDir(targetPath, dest, { files: 0, bytes: 0 });
      const mdPath = path.join(dest, 'SKILL.md');
      try {
        const hash = await sha256File(mdPath);
        await writeJson(path.join(dest, 'audit.json'), { id: skillId, ok: false, sha256: hash, verifiedAt: new Date().toISOString(), source: `github:${targetOwner}/${targetRepo}`, note: 'unverified' });
      } catch (e) {}
      return { success: true, dest, sourceId, skillId };
    } catch (e) {
      try {
        await fs.promises.rm(dest, { recursive: true, force: true });
      } catch (e2) {}
      return { success: false, error: e?.message || 'download_failed' };
    }
  }

  async auditSkill(payload) {
    const p = payload && typeof payload === 'object' ? payload : {};
    const dir = String(p.dir || '').trim();
    if (!dir) return { success: false, error: 'dir_required' };
    const loc = await marketplaceService.getLocations();
    const roots = [loc.draftsSkills, loc.toolsSkills, loc.openclawWorkspaceSkills].filter(Boolean);
    if (!roots.some((r) => isUnder(dir, r))) return { success: false, error: 'dir_not_allowed' };

    const state = { files: 0, bytes: 0 };
    const findings = [];
    const exts = {};

    const addFinding = (level, type, file, sample) => {
      findings.push({
        level,
        type,
        file,
        sample: String(sample || '').slice(0, 400)
      });
    };

    const scanText = (text, file) => {
      const t = String(text || '');
      const rules = [
        { level: 'red', type: 'child_process', re: /\b(child_process|spawnSync|execSync|execFileSync)\b/ },
        { level: 'red', type: 'eval', re: /\b(eval|Function)\s*\(/ },
        { level: 'red', type: 'process', re: /\bprocess\.(kill|exit)\b/ },
        { level: 'yellow', type: 'network', re: /\b(https?|fetch)\b/ },
        { level: 'yellow', type: 'fs_write', re: /\b(fs\.promises\.writeFile|fs\.writeFileSync|fs\.rmSync|fs\.promises\.rm)\b/ },
        { level: 'yellow', type: 'token_header', re: /\bAuthorization\s*:\s*Bearer\b/i }
      ];
      for (const r of rules) {
        const m = t.match(r.re);
        if (m) addFinding(r.level, r.type, file, m[0]);
      }
    };

    const walk = async (src, depth) => {
      if (depth > 8) return;
      let ents = [];
      try {
        ents = await fs.promises.readdir(src, { withFileTypes: true });
      } catch (e) {
        ents = [];
      }
      for (const ent of ents) {
        const name = String(ent?.name || '');
        if (!name) continue;
        if (name === 'node_modules' || name === '.git') continue;
        const full = path.join(src, name);
        if (ent.isDirectory()) {
          await walk(full, depth + 1);
        } else if (ent.isFile()) {
          state.files += 1;
          if (state.files > 500) throw new Error('too_many_files');
          let buf = null;
          try {
            buf = await fs.promises.readFile(full);
          } catch (e) {
            continue;
          }
          state.bytes += buf.length;
          if (state.bytes > 25_000_000) throw new Error('too_large');
          const ext = (path.extname(name) || '').toLowerCase() || 'none';
          exts[ext] = (exts[ext] || 0) + 1;
          if (buf.length <= 1_000_000) {
            const text = buf.toString('utf8');
            scanText(text, path.relative(dir, full).replace(/\\/g, '/'));
          }
        }
      }
    };

    try {
      await walk(dir, 0);
    } catch (e) {
      return { success: false, error: e?.message || 'scan_failed' };
    }

    let risk = 'green';
    if (findings.some((f) => f.level === 'red')) risk = 'red';
    else if (findings.some((f) => f.level === 'yellow')) risk = 'yellow';

    const report = {
      ok: risk !== 'red',
      risk,
      scannedAt: new Date().toISOString(),
      totals: { files: state.files, bytes: state.bytes, exts },
      findings,
      auditor: 'Trae Security Module (Static Analysis)'
    };
    try {
      await writeJson(path.join(dir, 'audit.json'), report);
    } catch (e) {}
    return { success: true, report };
  }

  async installOfficialSkills(skillIds) {
    const root = officialSkillsRoot();
    const idxRes = await this.listOfficialSkills();
    // Also check installed drafts
    const loc = await marketplaceService.getLocations();
    
    // We can't strictly validate against "official" index if we are installing community skills.
    // Instead, we trust the caller has already "installed" them to "drafts" via installRemoteSkill.
    // So this method should actually promote from "drafts" to "toolsSkills".
    
    await fs.promises.mkdir(loc.toolsSkills, { recursive: true });
    const installed = [];
    const errors = [];
    
    // skillIds are IDs of folders in drafts
    const wanted = Array.isArray(skillIds) ? skillIds : [];

    for (const id of wanted) {
      const src = path.join(loc.draftsSkills, id);
      const dst = path.join(loc.toolsSkills, id);
      
      // Check if draft exists
      try {
          await fs.promises.access(src);
      } catch (e) {
          // If not in draft, try official
          const offSrc = path.join(root, 'skills', id);
          try {
              await fs.promises.access(offSrc);
              // It is official
              try {
                await fs.promises.rm(dst, { recursive: true, force: true });
                await copyDirRecursive(offSrc, dst);
                installed.push(id);
                continue;
              } catch(e2) {
                 errors.push({ id, error: e2?.message });
                 continue;
              }
          } catch (e2) {
              errors.push({ id, error: 'not_found_in_drafts_or_official' });
              continue;
          }
      }

      try {
        await fs.promises.rm(dst, { recursive: true, force: true });
      } catch (e) {}
      try {
        await copyDirRecursive(src, dst);
        // Copy audit if exists
        try {
             const audit = await readJson(path.join(src, 'audit.json'));
             if (audit) await writeJson(path.join(dst, 'audit.json'), { ...audit, installedAt: new Date().toISOString() });
        } catch(e) {}
        
        installed.push(id);
      } catch (e) {
        errors.push({ id, error: e?.message || 'copy_failed' });
      }
    }
    return { success: errors.length === 0, installed, errors };
  }

  async planOneClick({ businessDescription, selectedSources, requestedScenarioIds, policyOverrides } = {}) {
    const cfg = await this.getConfig();
    const text = String(businessDescription || '').toLowerCase();
    const sources = selectedSources && typeof selectedSources === 'object' ? selectedSources : {};
    const req = Array.isArray(requestedScenarioIds) ? new Set(requestedScenarioIds.map((x) => String(x))) : null;
    const policy = policyOverrides && typeof policyOverrides === 'object' ? { ...cfg.policy, ...policyOverrides } : cfg.policy;

    const scenarioScore = (s) => {
      let score = 0;
      if (req && req.has(s.id)) score += 100;
      const r = s.requiredSources || {};
      if (r.kb && sources.kb) score += 20;
      if (r.projects && sources.projects) score += 20;
      if (r.calendar && sources.calendar) score += 20;
      
      const keywords = s.keywords || [];
      if (keywords.some((w) => text.includes(w.toLowerCase()))) score += 30;
      
      return score;
    };

    const matched = (cfg.scenarios || []).map((s) => ({ ...s, _score: scenarioScore(s) })).filter((s) => s._score > 0);
    matched.sort((a, b) => Number(b._score || 0) - Number(a._score || 0));

    // Retrieve Skills from Remote Index (Awesome List)
    let remoteSkills = [];
    try {
        const cache = await dbManager.getSetting('workroom_remote_index_awesome-openclaw');
        if (cache && Array.isArray(cache.skills)) remoteSkills = cache.skills;
    } catch(e) {}

    const enabledScenarios = matched.map((s) => {
        // Find relevant skills for this scenario from the remote index
        const keywords = s.keywords || [];
        const foundSkills = remoteSkills.filter(sk => {
             const skText = (sk.name + ' ' + sk.description + ' ' + sk.id).toLowerCase();
             return keywords.some(k => skText.includes(k.toLowerCase()));
        }).slice(0, 3); // Top 3

        return { 
            id: s.id, 
            name: s.name, 
            risk: s.risk, 
            score: s._score, 
            roles: s.roles, 
            requiredSkills: s.requiredSkills,
            recommendedCommunitySkills: foundSkills
        };
    });

    const roleIds = new Set();
    const skillIds = new Set();
    const communitySkills = [];
    const risks = [];
    
    for (const s of enabledScenarios) {
      for (const r of s.roles || []) roleIds.add(String(r));
      for (const k of s.requiredSkills || []) skillIds.add(String(k));
      if (s.recommendedCommunitySkills) {
          for (const sk of s.recommendedCommunitySkills) {
              communitySkills.push(sk);
              // We don't auto-add them to skillIds because they need to be downloaded first
              // But we include them in the plan for the UI to show
          }
      }
      if (s.risk === 'red') risks.push({ level: 'red', id: s.id, name: s.name, reason: '包含发布/提审等高风险自动化能力' });
    }

    if (!policy.allowNetwork) {
      risks.push({ level: 'yellow', id: 'policy', name: '联网能力关闭', reason: '将禁用需要外联的技能或要求手动补充资料' });
    }
    if (!policy.allowPublish) {
      risks.push({ level: 'yellow', id: 'policy', name: '发布默认需确认', reason: '发布动作将强制走确认/审批' });
    }

    const canApply = policy.allowRed ? true : !risks.some((r) => r.level === 'red');
    const required = {
      roles: cfg.roles.filter((r) => roleIds.has(String(r.id))),
      scenarios: cfg.scenarios.filter((s) => enabledScenarios.some((x) => x.id === s.id)),
      skillIds: Array.from(skillIds),
      communitySkills
    };

    return {
      success: true,
      canApply,
      policy,
      enabledScenarios,
      required,
      risks
    };
  }

  async applyOneClick(plan) {
    const p = plan && typeof plan === 'object' ? plan : null;
    if (!p || !p.required) return { success: false, error: 'invalid_plan' };
    if (!p.canApply) return { success: false, error: 'risk_blocked' };

    const cfg = await this.getConfig();
    const nextCfg = {
      ...cfg,
      roles: Array.isArray(p.required.roles) ? p.required.roles : cfg.roles,
      scenarios: Array.isArray(p.required.scenarios) ? p.required.scenarios : cfg.scenarios,
      policy: p.policy && typeof p.policy === 'object' ? { ...cfg.policy, ...p.policy } : cfg.policy,
      updatedAt: now()
    };
    await dbManager.saveSetting('workroom_config', nextCfg);
    await dbManager.saveSetting('workroom_last_plan', { ...p, appliedAt: new Date().toISOString() });

    try {
      const existingTeam = await dbManager.getSetting('app_team');
      const team = Array.isArray(existingTeam) ? existingTeam : [];
      const byNickname = new Set(team.map((m) => String(m?.nickname || '')));
      const roomTraitMap = { Writing: '文案', Design: '设计', Forms: '表单', Community: '社群', Custom: '综合' };
      for (const r of Array.isArray(nextCfg.roles) ? nextCfg.roles : []) {
        const name = String(r?.name || '').trim();
        if (!name) continue;
        if (byNickname.has(name)) continue;
        const defaultRoom = String(r?.defaultRoom || 'Custom');
        const trait = roomTraitMap[defaultRoom] || '综合';
        const id = `ai-${safeId(r.id || name)}-${Date.now()}`;
        team.push({
          id,
          nickname: name,
          role: '志愿者',
          responsibility: '其他',
          department: '工作间',
          traits: [String(r?.kind || 'agent'), trait].filter(Boolean),
          isAI: true,
          status: 'Active'
        });
        byNickname.add(name);
      }
      await dbManager.saveSetting('app_team', team);
      try {
        openclawService.mainWindow?.webContents?.send?.('app:data-refresh', { keys: ['team'] });
      } catch (e) {}
    } catch (e) {}

    // Install official skills + any selected community skills
    // Note: applyOneClick expects community skills to have been downloaded/audited separately
    // OR we could trigger download here. For now, we only install what is in skillIds.
    // The UI should handle downloading community skills before calling applyOneClick, 
    // OR add them to skillIds if they are ready in drafts.
    
    const installRes = await this.installOfficialSkills(Array.isArray(p.required.skillIds) ? p.required.skillIds : []);

    try {
      await openclawService.applyNgoPlannerPreset();
    } catch (e) {}
    try {
      await openclawService.ensureRunning();
    } catch (e) {}

    return { success: true, config: nextCfg, install: installRes };
  }
}

module.exports = new WorkroomService();
