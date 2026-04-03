const { spawn } = require('child_process');
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const dbManager = require('../databaseManager');

const NODE_VERSION = 'v22.13.1';
const DEFAULT_CLAUDE_CODE_VERSION = 'latest';
const PKG_NAME = '@anthropic-ai/claude-code';

const INSTALL_HEARTBEAT_MS = 3000;
const INSTALL_LOG_TAIL_LINES = 40;

const getOfflineRuntimeRoot = () => {
  if (!app.isPackaged) return null;
  return path.join(process.resourcesPath, 'claude_code_runtime');
};

const getPlatformTriple = () => {
  if (process.platform === 'darwin') return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  if (process.platform === 'linux') return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  if (process.platform === 'win32') return process.arch === 'arm64' ? 'win-arm64' : 'win-x64';
  return null;
};

const ensureDir = async (dir) => {
  await fs.promises.mkdir(dir, { recursive: true });
};

const safeRm = async (targetPath) => {
  try {
    await fs.promises.rm(targetPath, { recursive: true, force: true });
  } catch (e) {}
};

const pathExists = (p) => {
  try {
    fs.accessSync(p);
    return true;
  } catch (e) {
    return false;
  }
};

const downloadToFile = (url, destPath, onProgress, signal) =>
  new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    let request = null;
    const abort = () => {
      try {
        request?.destroy();
      } catch (e) {}
      try {
        file.close(() => fs.rmSync(destPath, { force: true }));
      } catch (e) {}
      reject(new Error('aborted'));
    };

    if (signal?.aborted) {
      abort();
      return;
    }
    const onAbort = () => abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });

    request = https.get(url, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        file.close(() => {
          fs.rmSync(destPath, { force: true });
          resolve(downloadToFile(res.headers.location, destPath, onProgress, signal));
        });
        return;
      }
      if (res.statusCode !== 200) {
        file.close(() => {
          fs.rmSync(destPath, { force: true });
          reject(new Error(`Download failed: ${res.statusCode}`));
        });
        return;
      }
      const total = Number(res.headers['content-length'] || 0);
      let received = 0;
      res.on('data', (chunk) => {
        received += chunk.length;
        if (typeof onProgress === 'function' && total > 0) onProgress({ received, total, ratio: received / total });
      });
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve()));
    });

    request.on('error', (err) => {
      try {
        file.close(() => fs.rmSync(destPath, { force: true }));
      } catch (e) {}
      reject(err);
    });

    request.on('close', () => {
      try {
        if (signal) signal.removeEventListener('abort', onAbort);
      } catch (e) {}
    });
  });

const execSpawnControlled = (command, args, options = {}, hooks = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';
    hooks?.onChild?.(child);
    child.stdout?.on('data', (d) => {
      const s = d.toString();
      stdout += s;
      hooks?.onStdout?.(s);
    });
    child.stderr?.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      hooks?.onStderr?.(s);
    });
    child.on('error', (err) => {
      const s = err?.message ? String(err.message) : String(err);
      stderr += s;
      hooks?.onStderr?.(s);
      resolve({ code: -1, signal: null, stdout, stderr });
    });
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });

const createTailBuffer = (maxLines) => {
  const lines = [];
  let carry = '';
  const push = (text) => {
    const raw = carry + String(text || '');
    const parts = raw.split(/\r?\n/);
    carry = parts.pop() || '';
    for (const p of parts) {
      const v = p.trimEnd();
      if (!v) continue;
      lines.push(v);
      while (lines.length > maxLines) lines.shift();
    }
  };
  const flush = () => {
    const v = carry.trimEnd();
    carry = '';
    if (v) {
      lines.push(v);
      while (lines.length > maxLines) lines.shift();
    }
  };
  const snapshot = () => lines.slice();
  return { push, flush, snapshot };
};

class ClaudeCodeInstaller {
  constructor() {
    this.installRoot = path.join(app.getPath('userData'), 'claude-code-managed');
    this._activeInstall = null;
  }

  _getPathsForRoot(root) {
    const nodeRoot = path.join(root, 'node');
    const claudeRoot = path.join(root, 'claude');
    const stateHome = path.join(root, 'state');
    const metaPath = path.join(root, 'install-meta.json');

    const nodeBin = process.platform === 'win32' ? path.join(nodeRoot, 'node.exe') : path.join(nodeRoot, 'bin', 'node');
    const npmBin = process.platform === 'win32' ? path.join(nodeRoot, 'npm.cmd') : path.join(nodeRoot, 'bin', 'npm');

    const claudeBin =
      process.platform === 'win32'
        ? path.join(claudeRoot, 'node_modules', '.bin', 'claude.cmd')
        : path.join(claudeRoot, 'node_modules', '.bin', 'claude');

    return { installRoot: root, nodeRoot, claudeRoot, stateHome, nodeBin, npmBin, claudeBin, metaPath };
  }

  getPaths() {
    return this._getPathsForRoot(this.installRoot);
  }

  async getStatus() {
    const p = this.getPaths();
    const hasNode = fs.existsSync(p.nodeBin);
    const hasClaude = fs.existsSync(p.claudeBin);
    const enabled = (await dbManager.getSetting('claude_code_enabled')) !== false && (await dbManager.getSetting('claude_code_enabled')) !== 'false';
    const desired =
      (await dbManager.getSetting('claude_code_managed_desired_version')) || DEFAULT_CLAUDE_CODE_VERSION;

    const triple = getPlatformTriple();
    const offlineRoot = getOfflineRuntimeRoot();
    const offlineNodeDir = offlineRoot && triple ? path.join(offlineRoot, 'node', triple) : null;
    const offlineTgz = offlineRoot ? path.join(offlineRoot, 'claude', 'claude-code.tgz') : null;

    return {
      success: true,
      enabled,
      desiredVersion: String(desired || DEFAULT_CLAUDE_CODE_VERSION),
      paths: p,
      node: { installed: hasNode, version: NODE_VERSION, offlineAvailable: !!(offlineNodeDir && pathExists(offlineNodeDir)) },
      claude: { installed: hasClaude, pkg: PKG_NAME, offlineAvailable: !!(offlineTgz && pathExists(offlineTgz)) },
      activeInstall: this._activeInstall
        ? {
            running: true,
            step: this._activeInstall.currentStep || 'init',
            startedAt: this._activeInstall.startedAt || 0,
            elapsedMs: Date.now() - (this._activeInstall.startedAt || Date.now()),
            logPath: this._activeInstall.logPath || ''
          }
        : null
    };
  }

  async cancelActiveInstall() {
    if (!this._activeInstall) return { success: true, canceled: false };
    try {
      this._activeInstall.controller?.abort();
    } catch (e) {}
    try {
      this._activeInstall.child?.kill?.();
    } catch (e) {}
    this._activeInstall = null;
    return { success: true, canceled: true };
  }

  async uninstall({ emit } = {}) {
    await this.cancelActiveInstall();
    const p = this.getPaths();
    try {
      emit?.({ step: 'uninstall', message: '清理 Claude Code 托管目录…', progress: 0.2 });
    } catch (e) {}
    await safeRm(p.installRoot);
    try {
      await dbManager.saveSetting('claude_code_managed_bin', '');
      await dbManager.saveSetting('claude_code_managed_desired_version', DEFAULT_CLAUDE_CODE_VERSION);
    } catch (e) {}
    try {
      emit?.({ step: 'uninstall', message: '已完成', progress: 1 });
    } catch (e) {}
    return this.getStatus();
  }

  async startInstall({ emit, options } = {}) {
    if (this._activeInstall) throw new Error('install_in_progress');

    const controller = new AbortController();
    const p = this.getPaths();
    await ensureDir(p.installRoot);

    const logDir = path.join(p.installRoot, 'logs');
    await ensureDir(logDir);
    const logPath = path.join(logDir, `install-${new Date().toISOString().slice(0, 10)}-${process.pid}-${crypto.randomBytes(4).toString('hex')}.log`);
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const tail = createTailBuffer(INSTALL_LOG_TAIL_LINES);

    const startedAt = Date.now();
    let currentStep = 'init';
    let lastOutputAt = Date.now();

    this._activeInstall = { controller, startedAt, currentStep, child: null, logPath };

    const emitWithMeta = (payload) => {
      if (!emit) return;
      const elapsedMs = Date.now() - startedAt;
      const idleMs = Date.now() - lastOutputAt;
      emit({
        ...payload,
        elapsedMs,
        idleMs,
        logPath,
        tail: tail.snapshot()
      });
    };

    const heartbeat = setInterval(() => emitWithMeta({ step: currentStep, message: '仍在执行中…' }), INSTALL_HEARTBEAT_MS);

    try {
      const triple = getPlatformTriple();
      if (!triple) throw new Error('unsupported_platform');

      const isWin = process.platform === 'win32';
      const offlineRoot = getOfflineRuntimeRoot();
      const offlineNodeDir = offlineRoot ? path.join(offlineRoot, 'node', triple) : null;

      const desiredVersion =
        (options && typeof options.claudeCodeVersion === 'string' && options.claudeCodeVersion.trim()) ||
        ((await dbManager.getSetting('claude_code_managed_desired_version')) || DEFAULT_CLAUDE_CODE_VERSION);
      const normalizedDesired = String(desiredVersion || DEFAULT_CLAUDE_CODE_VERSION).trim() || DEFAULT_CLAUDE_CODE_VERSION;

      currentStep = 'prepare';
      this._activeInstall.currentStep = currentStep;
      emitWithMeta({ step: currentStep, message: '准备安装目录…', progress: 0.05 });
      await ensureDir(p.nodeRoot);
      await ensureDir(p.claudeRoot);

      const canReuseExistingNode = pathExists(p.nodeBin) && pathExists(path.join(p.installRoot, 'node'));
      if (canReuseExistingNode) {
        currentStep = 'reuse_node';
        this._activeInstall.currentStep = currentStep;
        emitWithMeta({ step: currentStep, message: '复用已安装的 Node（跳过下载）…', progress: 0.15 });
      } else if (offlineNodeDir && pathExists(offlineNodeDir)) {
        currentStep = 'extract_node';
        this._activeInstall.currentStep = currentStep;
        emitWithMeta({ step: currentStep, message: `使用离线 Node 运行时（${triple}）…`, progress: 0.15 });
        await safeRm(p.nodeRoot);
        await fs.promises.cp(offlineNodeDir, p.nodeRoot, { recursive: true });
      } else {
        const archiveExt = isWin ? 'zip' : 'tar.gz';
        const nodeFilename = `node-${NODE_VERSION}-${triple}.${archiveExt}`;
        const nodeUrl = `https://nodejs.org/dist/${NODE_VERSION}/${nodeFilename}`;
        const tmpDir = path.join(app.getPath('temp'), 'ngo-planner-claude-code');
        await ensureDir(tmpDir);
        const archivePath = path.join(tmpDir, `${nodeFilename}-${crypto.randomBytes(6).toString('hex')}`);

        currentStep = 'download_node';
        this._activeInstall.currentStep = currentStep;
        emitWithMeta({ step: currentStep, message: `下载 Node.js ${NODE_VERSION}…`, progress: 0 });
        await downloadToFile(nodeUrl, archivePath, (prog) => emitWithMeta({ step: currentStep, progress: prog.ratio }), controller.signal);

        currentStep = 'extract_node';
        this._activeInstall.currentStep = currentStep;
        emitWithMeta({ step: currentStep, message: '解压 Node.js…', progress: 0.2 });
        await safeRm(p.nodeRoot);
        await ensureDir(p.nodeRoot);

        if (isWin) {
          const res = await execSpawnControlled(
            'powershell.exe',
            ['-NoProfile', '-Command', `Expand-Archive -Force "${archivePath}" "${tmpDir}"`],
            { signal: controller.signal },
            {
              onChild: (c) => (this._activeInstall.child = c),
              onStdout: (s) => {
                lastOutputAt = Date.now();
                logStream.write(s);
                tail.push(s);
              },
              onStderr: (s) => {
                lastOutputAt = Date.now();
                logStream.write(s);
                tail.push(s);
              }
            }
          );
          if (res.code !== 0) throw new Error(`extract_node_failed: ${res.stderr || res.stdout}`);
          const extractedDir = path.join(tmpDir, `node-${NODE_VERSION}-${triple}`);
          await fs.promises.cp(extractedDir, p.nodeRoot, { recursive: true });
        } else {
          const res = await execSpawnControlled(
            'tar',
            ['-xzf', archivePath, '-C', tmpDir],
            { signal: controller.signal },
            {
              onChild: (c) => (this._activeInstall.child = c),
              onStdout: (s) => {
                lastOutputAt = Date.now();
                logStream.write(s);
                tail.push(s);
              },
              onStderr: (s) => {
                lastOutputAt = Date.now();
                logStream.write(s);
                tail.push(s);
              }
            }
          );
          if (res.code !== 0) throw new Error(`extract_node_failed: ${res.stderr || res.stdout}`);
          const extractedDir = path.join(tmpDir, `node-${NODE_VERSION}-${triple}`);
          await safeRm(p.nodeRoot);
          await fs.promises.rename(extractedDir, p.nodeRoot);
        }
      }

      currentStep = 'install_claude_code';
      this._activeInstall.currentStep = currentStep;
      emitWithMeta({ step: currentStep, message: '安装 Claude Code（本地托管）…', progress: 0.55 });
      await ensureDir(p.claudeRoot);

      const offlineTgz = offlineRoot ? path.join(offlineRoot, 'claude', 'claude-code.tgz') : null;
      const installTarget = offlineTgz && pathExists(offlineTgz) ? offlineTgz : `${PKG_NAME}@${normalizedDesired}`;
      const npmArgs = [
        'install',
        installTarget,
        '--prefix',
        p.claudeRoot,
        '--no-fund',
        '--no-audit',
        '--progress=false',
        '--fetch-retries=5',
        '--fetch-retry-mintimeout=20000',
        '--fetch-retry-maxtimeout=120000'
      ];

      const npmRes = await execSpawnControlled(
        p.npmBin,
        npmArgs,
        { env: { ...process.env }, signal: controller.signal },
        {
          onChild: (c) => (this._activeInstall.child = c),
          onStdout: (s) => {
            lastOutputAt = Date.now();
            logStream.write(s);
            tail.push(s);
          },
          onStderr: (s) => {
            lastOutputAt = Date.now();
            logStream.write(s);
            tail.push(s);
          }
        }
      );
      if (npmRes.code !== 0) throw new Error(`install_failed: ${npmRes.stderr || npmRes.stdout}`);
      if (!fs.existsSync(p.claudeBin)) throw new Error('install_failed_missing_bin');

      currentStep = 'finalize';
      this._activeInstall.currentStep = currentStep;
      emitWithMeta({ step: currentStep, message: '写入配置…', progress: 0.9 });
      await ensureDir(p.stateHome);
      await fs.promises.writeFile(
        p.metaPath,
        JSON.stringify(
          {
            pkg: PKG_NAME,
            desiredVersion: normalizedDesired,
            nodeVersion: NODE_VERSION,
            installedAt: Date.now(),
            claudeBin: p.claudeBin
          },
          null,
          2
        ),
        'utf8'
      );
      await dbManager.saveSetting('claude_code_managed_desired_version', normalizedDesired);
      await dbManager.saveSetting('claude_code_managed_bin', p.claudeBin);

      emitWithMeta({ step: 'done', message: '✅ 安装完成', progress: 1 });
      return this.getStatus();
    } finally {
      clearInterval(heartbeat);
      try {
        tail.flush();
      } catch (e) {}
      try {
        logStream.end();
      } catch (e) {}
      this._activeInstall = null;
    }
  }
}

module.exports = new ClaudeCodeInstaller();
