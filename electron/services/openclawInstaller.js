const { spawn } = require('child_process');
const { app } = require('electron');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const dbManager = require('../databaseManager');

const NODE_VERSION = 'v22.13.1';
const DEFAULT_OPENCLAW_VERSION = 'latest';
const INSTALL_LOG_TAIL_LINES = 40;
const INSTALL_HEARTBEAT_MS = 3000;
const INSTALL_STUCK_HINT_MS = 30_000;

const getOfflineRuntimeRoot = () => {
  if (!app.isPackaged) return null;
  return path.join(process.resourcesPath, 'openclaw_runtime');
};

const getPlatformTriple = () => {
  if (process.platform === 'darwin') {
    return process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
  }
  if (process.platform === 'linux') {
    return process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64';
  }
  if (process.platform === 'win32') {
    return process.arch === 'arm64' ? 'win-arm64' : 'win-x64';
  }
  return null;
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
        if (typeof onProgress === 'function' && total > 0) {
          onProgress({ received, total, ratio: received / total });
        }
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

const execSpawn = (command, args, options = {}) =>
  new Promise((resolve) => {
    const child = spawn(command, args, options);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) => {
      stderr += err?.message ? String(err.message) : String(err);
      resolve({ code: -1, signal: null, stdout, stderr });
    });
    child.on('close', (code, signal) => resolve({ code, signal, stdout, stderr }));
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

const tryParseNodeMajor = (versionText) => {
  const s = String(versionText || '').trim();
  const m = s.match(/^v(\d+)\./i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
};

const readTextFile = async (p) => {
  try {
    return await fs.promises.readFile(p, 'utf8');
  } catch (e) {
    return '';
  }
};

const formatDuration = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return `${m}m ${r}s`;
};

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

const listBackupDirs = async (installRoot) => {
  const parent = path.dirname(installRoot);
  const base = path.basename(installRoot);
  let entries = [];
  try {
    entries = await fs.promises.readdir(parent, { withFileTypes: true });
  } catch (e) {
    return [];
  }
  const prefix = `${base}.backup-`;
  return entries
    .filter((e) => e.isDirectory() && e.name.startsWith(prefix))
    .map((e) => path.join(parent, e.name))
    .sort((a, b) => b.localeCompare(a));
};

const keepLatestBackups = async (installRoot, keepCount) => {
  const backups = await listBackupDirs(installRoot);
  const extra = backups.slice(keepCount);
  for (const d of extra) {
    await safeRm(d);
  }
};

class OpenClawInstaller {
  constructor() {
    this.installRoot = path.join(app.getPath('userData'), 'openclaw-managed');
    this._activeInstall = null;
  }

  _getPathsForRoot(root) {
    const nodeRoot = path.join(root, 'node');
    const openclawRoot = path.join(root, 'openclaw');
    const stateHome = path.join(root, 'state');
    const metaPath = path.join(root, 'install-meta.json');

    const nodeBin =
      process.platform === 'win32'
        ? path.join(nodeRoot, 'node.exe')
        : path.join(nodeRoot, 'bin', 'node');
    const npmBin =
      process.platform === 'win32'
        ? path.join(nodeRoot, 'npm.cmd')
        : path.join(nodeRoot, 'bin', 'npm');

    const openclawBin =
      process.platform === 'win32'
        ? path.join(openclawRoot, 'node_modules', '.bin', 'openclaw.cmd')
        : path.join(openclawRoot, 'node_modules', '.bin', 'openclaw');

    return { installRoot: root, nodeRoot, openclawRoot, stateHome, nodeBin, npmBin, openclawBin, metaPath };
  }

  getPaths() {
    return this._getPathsForRoot(this.installRoot);
  }

  async getStatus() {
    const p = this.getPaths();
    const hasNode = fs.existsSync(p.nodeBin);
    const hasOpenclaw = fs.existsSync(p.openclawBin);
    const enabled = (await dbManager.getSetting('openclaw_enabled')) === true || (await dbManager.getSetting('openclaw_enabled')) === 'true';

    const triple = getPlatformTriple();
    const offlineRoot = getOfflineRuntimeRoot();
    const offlineNodeDir = offlineRoot && triple ? path.join(offlineRoot, 'node', triple) : null;
    const offlineNodeAvailable = !!offlineNodeDir && pathExists(offlineNodeDir);
    const offlineOpenclawTgz = offlineRoot ? path.join(offlineRoot, 'openclaw', 'openclaw.tgz') : null;
    const offlineOpenclawAvailable = !!offlineOpenclawTgz && pathExists(offlineOpenclawTgz);

    const metaRaw = await readTextFile(p.metaPath);
    const meta = (() => {
      try {
        return JSON.parse(metaRaw || '{}');
      } catch (e) {
        return {};
      }
    })();

    const sysNode = await execSpawn(process.platform === 'win32' ? 'node.exe' : 'node', ['-v']);
    const sysNodeMajor = sysNode.code === 0 ? tryParseNodeMajor(sysNode.stdout) : null;
    const desired = await dbManager.getSetting('openclaw_managed_desired_version');
    const backups = await listBackupDirs(p.installRoot);

    return {
      enabled,
      hasNode,
      hasOpenclaw,
      nodeBin: hasNode ? p.nodeBin : null,
      openclawBin: hasOpenclaw ? p.openclawBin : null,
      installRoot: p.installRoot,
      stateHome: p.stateHome,
      offlineRuntime: {
        available: offlineNodeAvailable || offlineOpenclawAvailable,
        nodeAvailable: offlineNodeAvailable,
        openclawTgzAvailable: offlineOpenclawAvailable
      },
      systemNode: {
        detected: sysNode.code === 0,
        major: sysNodeMajor
      },
      desiredVersion: typeof desired === 'string' && desired.trim() ? desired.trim() : DEFAULT_OPENCLAW_VERSION,
      backups: backups.slice(0, 5),
      activeInstall: this._activeInstall
        ? {
            running: true,
            step: this._activeInstall.currentStep || 'init',
            startedAt: this._activeInstall.startedAt || null,
            elapsedMs: this._activeInstall.startedAt ? Date.now() - this._activeInstall.startedAt : null,
            logPath: this._activeInstall.logPath || null
          }
        : { running: false },
      installedMeta: meta && typeof meta === 'object' ? meta : {}
    };
  }

  async cancelActiveInstall() {
    if (!this._activeInstall) return { success: false, error: 'no active install' };
    try {
      this._activeInstall.controller?.abort();
    } catch (e) {}
    try {
      this._activeInstall.child?.kill();
    } catch (e) {}
    return { success: true };
  }

  startInstall({ emit, options } = {}) {
    if (this._activeInstall) return { success: false, error: '安装正在进行，请稍后重试或先取消' };
    this.install({ emit, options }).catch(() => {});
    return { success: true };
  }

  async install({ emit, options } = {}) {
    if (this._activeInstall) throw new Error('安装正在进行，请稍后重试或先取消');

    const finalPaths = this.getPaths();
    const hasExistingOpenclaw = fs.existsSync(finalPaths.openclawBin);
    const requestedVersion =
      options && typeof options.openclawVersion === 'string' && options.openclawVersion.trim()
        ? options.openclawVersion.trim()
        : '';
    if (hasExistingOpenclaw && !(options && options.force === true) && !requestedVersion) {
      emit?.({ step: 'done', message: '检测到已安装 OpenClaw（跳过）', progress: 1 });
      return { success: true, openclawBin: finalPaths.openclawBin, stateHome: finalPaths.stateHome, skipped: true };
    }
    const stagingRoot = `${finalPaths.installRoot}.staging-${crypto.randomBytes(6).toString('hex')}`;
    const p = this._getPathsForRoot(stagingRoot);

    await safeRm(stagingRoot);
    await ensureDir(stagingRoot);

    const logPath = path.join(app.getPath('userData'), 'openclaw-managed', 'install.log');
    await ensureDir(path.dirname(logPath));
    const logStream = fs.createWriteStream(logPath, { flags: 'a' });
    const tail = createTailBuffer(INSTALL_LOG_TAIL_LINES);
    const startedAt = Date.now();
    let lastOutputAt = Date.now();
    let currentStep = 'init';

    const controller = new AbortController();
    this._activeInstall = { controller, child: null, startedAt, currentStep, logPath };

    const emitWithMeta = (payload) => {
      const now = Date.now();
      const elapsedMs = now - startedAt;
      const idleMs = now - lastOutputAt;
      const stuckHint = idleMs >= INSTALL_STUCK_HINT_MS;
      emit?.({
        ...payload,
        elapsedMs,
        elapsedText: formatDuration(elapsedMs),
        idleMs,
        stuckHint,
        logPath,
        tail: tail.snapshot()
      });
    };

    const heartbeat = setInterval(() => {
      emitWithMeta({
        step: currentStep,
        message: '仍在执行中…（网络或依赖解析阶段可能耗时较长）'
      });
    }, INSTALL_HEARTBEAT_MS);

    const triple = getPlatformTriple();
    if (!triple) throw new Error('Unsupported platform for managed OpenClaw install');

    const isWin = process.platform === 'win32';
    const offlineRoot = getOfflineRuntimeRoot();
    const offlineNodeDir = offlineRoot ? path.join(offlineRoot, 'node', triple) : null;
    const desiredVersion =
      (options && typeof options.openclawVersion === 'string' && options.openclawVersion.trim()) ||
      ((await dbManager.getSetting('openclaw_managed_desired_version')) || DEFAULT_OPENCLAW_VERSION);
    const normalizedDesired = String(desiredVersion || DEFAULT_OPENCLAW_VERSION).trim() || DEFAULT_OPENCLAW_VERSION;

    try {
      const existingNodeRoot = path.join(finalPaths.installRoot, 'node');
      const canReuseExistingNode =
        !(options && options.skipNodeReuse === true) &&
        pathExists(finalPaths.nodeBin) &&
        pathExists(existingNodeRoot);

      if (canReuseExistingNode) {
        currentStep = 'reuse_node';
        this._activeInstall.currentStep = currentStep;
        emitWithMeta({ step: 'reuse_node', message: '复用已安装的 Node（跳过下载）...', progress: 0.2 });
        await fs.promises.cp(existingNodeRoot, p.nodeRoot, { recursive: true });
      } else if (offlineNodeDir && pathExists(offlineNodeDir)) {
        currentStep = 'extract_node';
        this._activeInstall.currentStep = currentStep;
        emitWithMeta({ step: 'extract_node', message: `使用离线 Node 运行时（${triple}）...`, progress: 0.2 });
        await fs.promises.cp(offlineNodeDir, p.nodeRoot, { recursive: true });
      } else {
        const archiveExt = isWin ? 'zip' : 'tar.gz';
        const nodeFilename = `node-${NODE_VERSION}-${triple}.${archiveExt}`;
        const nodeUrl = `https://nodejs.org/dist/${NODE_VERSION}/${nodeFilename}`;
        const tmpDir = path.join(app.getPath('temp'), 'ngo-planner-openclaw');
        await ensureDir(tmpDir);
        const archivePath = path.join(tmpDir, `${nodeFilename}-${crypto.randomBytes(6).toString('hex')}`);

        currentStep = 'download_node';
        this._activeInstall.currentStep = currentStep;
        emitWithMeta({ step: 'download_node', message: `下载 Node.js ${NODE_VERSION}...`, progress: 0 });
        await downloadToFile(
          nodeUrl,
          archivePath,
          (prog) => emitWithMeta({ step: 'download_node', progress: prog.ratio }),
          controller.signal
        );

        currentStep = 'extract_node';
        this._activeInstall.currentStep = currentStep;
        emitWithMeta({ step: 'extract_node', message: '解压 Node.js...', progress: 0.2 });
        await safeRm(p.nodeRoot);
        await ensureDir(p.nodeRoot);

        if (isWin) {
          const res = await execSpawnControlled(
            'powershell.exe',
            [
            '-NoProfile',
            '-Command',
            `Expand-Archive -Force "${archivePath}" "${tmpDir}"`
            ],
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
          if (res.code !== 0) throw new Error(`Extract Node failed: ${res.stderr || res.stdout}`);

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
          if (res.code !== 0) throw new Error(`Extract Node failed: ${res.stderr || res.stdout}`);

          const extractedDir = path.join(tmpDir, `node-${NODE_VERSION}-${triple}`);
          await safeRm(p.nodeRoot);
          await fs.promises.rename(extractedDir, p.nodeRoot);
        }
      }

      currentStep = 'install_openclaw';
      this._activeInstall.currentStep = currentStep;
      emitWithMeta({ step: 'install_openclaw', message: '安装 OpenClaw（本地托管）...', progress: 0.5 });
      await ensureDir(p.openclawRoot);

      const offlineTgz = offlineRoot ? path.join(offlineRoot, 'openclaw', 'openclaw.tgz') : null;
      const installTarget = offlineTgz && pathExists(offlineTgz) ? offlineTgz : `openclaw@${normalizedDesired}`;
      const npmArgs = [
        'install',
        installTarget,
        '--prefix',
        p.openclawRoot,
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
      if (npmRes.code !== 0) throw new Error(`Install OpenClaw failed: ${npmRes.stderr || npmRes.stdout}`);

      if (!fs.existsSync(p.openclawBin)) throw new Error('OpenClaw 安装完成但未找到可执行文件');

      let openclawVersionInstalled = null;
      try {
        const pkgJsonPath = path.join(p.openclawRoot, 'node_modules', 'openclaw', 'package.json');
        const raw = await readTextFile(pkgJsonPath);
        const j = JSON.parse(raw || '{}');
        if (j && typeof j.version === 'string') openclawVersionInstalled = j.version;
      } catch (e) {}

      currentStep = 'configure';
      this._activeInstall.currentStep = currentStep;
      emitWithMeta({ step: 'configure', message: '写入受控配置与技能...', progress: 0.8 });
      await ensureDir(p.stateHome);
      const stateDir = path.join(p.stateHome, '.openclaw');
      const workspaceDir = path.join(p.stateHome, '.openclaw', 'workspace');
      await ensureDir(workspaceDir);

    const skillDir = path.join(workspaceDir, 'skills', 'ngo-planner-bridge');
    await ensureDir(skillDir);
    const skillMd = [
      '---',
      'name: ngo-planner-bridge',
      'description: Use NGO Planner local bridge (context, KB, artifacts, ProjectIntel) via curl + exec tool',
      'metadata: {"openclaw":{"emoji":"🗂️","os":["darwin","linux","win32"]}}',
      '---',
      '',
      'This skill teaches the agent how to call NGO Planner’s local, loopback-only bridge.',
      '',
      'Bridge base:',
      '- URL: ${NGOPLANNER_BRIDGE_URL} (default http://127.0.0.1:${NGOPLANNER_BRIDGE_PORT})',
      '- Auth header: Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}',
      '',
      'Rules:',
      '- All skill endpoints are POST only. Do not use GET for /skills/*.',
      '- There is no endpoint that lists skills. Do not attempt to enumerate endpoints.',
      '- Never print or echo secrets (tokens, env vars). Never include them in final output.',
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
      '      -d \'{"text":"<query>","topK":8}\'',
      '',
      '3) Run ProjectIntel (web list mode):',
      '',
      'exec:',
      '  command: |',
      '    curl -sS -X POST "${NGOPLANNER_BRIDGE_URL}/skills/project-intel/run" \\',
      '      -H "Authorization: Bearer ${NGOPLANNER_BRIDGE_TOKEN}" \\',
      '      -H "Content-Type: application/json" \\',
      '      -d \'{"userQuery":"<query>","urls":[],"keywords":[],"takeScreenshot":true}\'',
      '',
      '4) Write reusable artifacts (process + result) to local disk:',
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
    await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), skillMd, 'utf8');

    const configPath = path.join(stateDir, 'openclaw.json');
    const json = {
      agents: { defaults: { workspace: workspaceDir.replace(/\\/g, '\\\\') } },
      gateway: { port: 18789, mode: 'local' },
      skills: { load: { watch: true, watchDebounceMs: 250 } }
    };
    await fs.promises.writeFile(configPath, JSON.stringify(json, null, 2), 'utf8');

      const meta = {
      installedAt: Date.now(),
      nodeVersion: NODE_VERSION,
        openclawVersion: normalizedDesired,
      openclawVersionInstalled,
      offline: {
        node: !!offlineNodeDir && pathExists(offlineNodeDir),
        openclawTgz: !!offlineTgz && pathExists(offlineTgz)
      }
    };
      await fs.promises.writeFile(p.metaPath, JSON.stringify(meta, null, 2), 'utf8');

      currentStep = 'finalize';
      this._activeInstall.currentStep = currentStep;
      emitWithMeta({ step: 'finalize', message: '完成安装并切换到新版本...', progress: 0.95 });
      if (pathExists(finalPaths.installRoot)) {
        const backupPath = `${finalPaths.installRoot}.backup-${Date.now()}`;
        await safeRm(backupPath);
        try {
          await fs.promises.rename(finalPaths.installRoot, backupPath);
        } catch (e) {
          await safeRm(finalPaths.installRoot);
        }
      }
      await fs.promises.rename(stagingRoot, finalPaths.installRoot);
      await keepLatestBackups(finalPaths.installRoot, 1);

      await dbManager.saveSetting('openclaw_managed_install_root', finalPaths.installRoot);
      await dbManager.saveSetting('openclaw_managed_openclaw_bin', finalPaths.openclawBin);
      await dbManager.saveSetting('openclaw_managed_state_home', finalPaths.stateHome);
      await dbManager.saveSetting('openclaw_port', 18789);
      await dbManager.saveSetting('openclaw_bridge_port', 18890);
      await dbManager.saveSetting('openclaw_managed_openclaw_version', normalizedDesired);
      await dbManager.saveSetting('openclaw_managed_openclaw_version_installed', openclawVersionInstalled);
      await dbManager.saveSetting('openclaw_managed_desired_version', normalizedDesired);

      currentStep = 'done';
      this._activeInstall.currentStep = currentStep;
      tail.flush();
      emitWithMeta({ step: 'done', message: 'OpenClaw 已就绪', progress: 1 });
      return { success: true, openclawBin: finalPaths.openclawBin, stateHome: finalPaths.stateHome };
    } catch (e) {
      await safeRm(stagingRoot);
      tail.flush();
      emitWithMeta({ step: 'error', message: e.message || '安装失败' });
      throw e;
    } finally {
      clearInterval(heartbeat);
      try {
        logStream.end();
      } catch (e) {}
      this._activeInstall = null;
    }
  }

  async rollback({ emit } = {}) {
    const finalPaths = this.getPaths();
    const backups = await listBackupDirs(finalPaths.installRoot);
    const latest = backups[0];
    if (!latest) throw new Error('No backup available');

    emit?.({ step: 'rollback', message: '正在回滚到上一版本...' });
    const currentBackup = `${finalPaths.installRoot}.backup-${Date.now()}`;
    const tmp = `${finalPaths.installRoot}.swap-${crypto.randomBytes(6).toString('hex')}`;

    try {
      await safeRm(tmp);
      await fs.promises.rename(finalPaths.installRoot, tmp);
      await fs.promises.rename(latest, finalPaths.installRoot);
      await safeRm(currentBackup);
      await fs.promises.rename(tmp, currentBackup);
    } catch (e) {
      try {
        if (pathExists(tmp) && !pathExists(finalPaths.installRoot)) {
          await fs.promises.rename(tmp, finalPaths.installRoot);
        }
      } catch (e2) {}
      throw e;
    }

    await keepLatestBackups(finalPaths.installRoot, 1);

    const metaRaw = await readTextFile(path.join(finalPaths.installRoot, 'install-meta.json'));
    let meta = {};
    try {
      meta = JSON.parse(metaRaw || '{}');
    } catch (e) {}
    const openclawVersionInstalled = meta && typeof meta === 'object' ? meta.openclawVersionInstalled : null;
    const desired = meta && typeof meta === 'object' ? meta.openclawVersion : null;

    await dbManager.saveSetting('openclaw_managed_openclaw_version_installed', openclawVersionInstalled || null);
    if (typeof desired === 'string' && desired.trim()) {
      await dbManager.saveSetting('openclaw_managed_desired_version', desired.trim());
      await dbManager.saveSetting('openclaw_managed_openclaw_version', desired.trim());
    }

    emit?.({ step: 'done', message: '已回滚' });
    return { success: true, meta };
  }

  async uninstall({ emit } = {}) {
    const p = this.getPaths();
    emit?.({ step: 'remove', message: '删除托管安装与配置...' });
    await safeRm(p.installRoot);
    const backups = await listBackupDirs(p.installRoot);
    for (const b of backups) await safeRm(b);
    await dbManager.saveSetting('openclaw_managed_install_root', null);
    await dbManager.saveSetting('openclaw_managed_openclaw_bin', null);
    await dbManager.saveSetting('openclaw_managed_state_home', null);
    await dbManager.saveSetting('openclaw_managed_openclaw_version', null);
    await dbManager.saveSetting('openclaw_managed_openclaw_version_installed', null);
    await dbManager.saveSetting('openclaw_managed_desired_version', null);
    await dbManager.saveSetting('openclaw_enabled', false);
    await dbManager.saveSetting('openclaw_port', null);
    await dbManager.saveSetting('openclaw_bridge_port', null);
    await dbManager.saveSetting('openclaw_bridge_token', null);
    emit?.({ step: 'done', message: '已卸载' });
    return { success: true };
  }
}

module.exports = new OpenClawInstaller();
