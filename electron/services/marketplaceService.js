const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const dbManager = require('../databaseManager');
const pluginManager = require('./pluginManager');

const ensureDir = async (dir) => {
  await fs.promises.mkdir(dir, { recursive: true });
};

const pathExists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch (e) {
    return false;
  }
};

const readText = async (p) => {
  try {
    return await fs.promises.readFile(p, 'utf8');
  } catch (e) {
    return '';
  }
};

const readJson = async (p) => {
  try {
    const raw = await fs.promises.readFile(p, 'utf8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    return null;
  }
};

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
    const k = m[1];
    const v = m[2];
    data[k] = v;
  }
  return { data, body };
};

const listDirs = async (dir) => {
  try {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch (e) {
    return [];
  }
};

const safeCopyDir = async (src, dest) => {
  await ensureDir(path.dirname(dest));
  await fs.promises.cp(src, dest, { recursive: true });
};

const safeRemoveDir = async (dir) => {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch (e) {}
};

class MarketplaceService {
  constructor() {
    this.root = path.join(app.getPath('userData'), 'marketplace');
  }

  _bundledPluginsRoot() {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, 'plugins');
    }
    return path.join(app.getAppPath(), 'resources', 'plugins');
  }

  async getLocations() {
    const userData = app.getPath('userData');
    const pluginsDir = path.join(userData, 'plugins');
    const managedRoot = await dbManager.getSetting('openclaw_managed_install_root');
    const managedState = await dbManager.getSetting('openclaw_managed_state_home');
    const openclawHome = managedState && typeof managedState === 'string' ? path.join(managedState, '.openclaw') : path.join(userData, 'openclaw-state');
    const openclawWorkspace = path.join(openclawHome, 'workspace');
    const openclawWorkspaceSkills = path.join(openclawWorkspace, 'skills');

    const toolsRoot = path.join(this.root, 'tools');
    const draftsRoot = path.join(this.root, 'drafts');
    const toolsSkills = path.join(toolsRoot, 'skills');
    const draftsSkills = path.join(draftsRoot, 'skills');

    return {
      userData,
      pluginsDir,
      openclawManagedRoot: typeof managedRoot === 'string' ? managedRoot : null,
      openclawHome,
      openclawWorkspace,
      openclawWorkspaceSkills,
      marketplaceRoot: this.root,
      toolsRoot,
      draftsRoot,
      toolsSkills,
      draftsSkills
    };
  }

  async listInstalledPlugins() {
    return pluginManager.listInstalledManifests();
  }

  async installPluginFromDirectory(srcDir) {
    return pluginManager.installFromDirectory(srcDir);
  }

  async installBundledPlugin(bundleId) {
    const id = String(bundleId || '').trim();
    if (!id) throw new Error('bundleId required');
    const root = this._bundledPluginsRoot();
    const srcDir = path.join(root, id);
    if (!pathExists(srcDir)) throw new Error('Bundled plugin not found');
    const force = arguments.length >= 2 && arguments[1] && typeof arguments[1] === 'object' ? !!arguments[1].force : true;
    return pluginManager.installFromDirectory(srcDir, { force });
  }

  async setPluginEnabled(pluginId, enabled) {
    return pluginManager.setEnabled(pluginId, enabled);
  }

  async uninstallPlugin(pluginId) {
    return pluginManager.uninstall(pluginId);
  }

  async listSkills() {
    const loc = await this.getLocations();
    await ensureDir(loc.toolsSkills);
    await ensureDir(loc.draftsSkills);

    const draftDirs = [
      ...((await listDirs(loc.draftsSkills)) || []),
      ...((await listDirs(loc.openclawWorkspaceSkills)) || [])
    ];

    const toolDirs = await listDirs(loc.toolsSkills);

    const readSkill = async (dir) => {
      const skillMdPath = path.join(dir, 'SKILL.md');
      const md = await readText(skillMdPath);
      const { data } = parseFrontmatter(md);
      const name = (data.name || path.basename(dir) || '').toString().trim();
      const description = (data.description || '').toString().trim();
      const ok = !!md && !!name;
        const audit = await readJson(path.join(dir, 'audit.json'));
      let stat = null;
      try {
        stat = await fs.promises.stat(skillMdPath);
      } catch (e) {}
      return {
        id: `${dir}`,
        name,
        description,
        dir,
        hasSkillMd: !!md,
        valid: ok,
        updatedAt: stat ? stat.mtimeMs : null,
          audit: audit && typeof audit === 'object' ? audit : null,
        source: 'unknown'
      };
    };

    const drafts = [];
    for (const d of draftDirs) {
      if (path.basename(d) === 'ngo-planner-bridge') continue;
      const s = await readSkill(d);
      s.source = d.startsWith(loc.openclawWorkspaceSkills) ? 'openclaw-workspace' : 'drafts';
      drafts.push(s);
    }

    const tools = [];
    for (const d of toolDirs) {
      const s = await readSkill(d);
      s.source = 'tools';
      tools.push(s);
    }

    const byName = (a, b) => String(a.name).localeCompare(String(b.name));
    drafts.sort(byName);
    tools.sort(byName);

    return { drafts, tools };
  }

  async promoteDraftSkill(dir) {
    const loc = await this.getLocations();
    await ensureDir(loc.toolsSkills);

    const skillMdPath = path.join(dir, 'SKILL.md');
    const md = await readText(skillMdPath);
    const { data } = parseFrontmatter(md);
    const name = (data.name || path.basename(dir) || '').toString().trim();
    if (!md) throw new Error('缺少 SKILL.md');
    if (!name) throw new Error('SKILL.md 缺少 name');

    const safeName = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || path.basename(dir);
    let target = path.join(loc.toolsSkills, safeName);
    let i = 1;
    while (pathExists(target)) {
      target = path.join(loc.toolsSkills, `${safeName}-${i}`);
      i += 1;
    }
    await safeCopyDir(dir, target);
    return { success: true, target };
  }

  async deleteSkill(dir) {
    await safeRemoveDir(dir);
    return { success: true };
  }

  async importSkillFromDirectory(srcDir) {
    const loc = await this.getLocations();
    const md = await readText(path.join(srcDir, 'SKILL.md'));
    const { data } = parseFrontmatter(md);
    const name = (data.name || path.basename(srcDir) || '').toString().trim();
    if (!md) throw new Error('缺少 SKILL.md');
    if (!name) throw new Error('SKILL.md 缺少 name');

    const safeName = name.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || path.basename(srcDir);
    await ensureDir(loc.toolsSkills);
    let target = path.join(loc.toolsSkills, safeName);
    let i = 1;
    while (pathExists(target)) {
      target = path.join(loc.toolsSkills, `${safeName}-${i}`);
      i += 1;
    }
    await safeCopyDir(srcDir, target);
    return { success: true, target };
  }
}

module.exports = new MarketplaceService();
