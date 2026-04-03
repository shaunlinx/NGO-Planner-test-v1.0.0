const { spawn } = require('child_process');
const net = require('net');
const http = require('http');
const path = require('path');

const isPortFree = (port) =>
  new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.on('error', () => resolve(false));
    server.listen({ host: '127.0.0.1', port }, () => {
      server.close(() => resolve(true));
    });
  });

const tryRequest = (port) =>
  new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/@vite/client' }, (res) => {
      res.resume();
      resolve(res.statusCode && res.statusCode >= 200 && res.statusCode < 600);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(3500, () => {
      try {
        req.destroy();
      } catch (e) {}
      resolve(false);
    });
  });

const tryConnect = (port) =>
  new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port });
    let settled = false;
    const finish = (ok) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch (e) {}
      resolve(ok);
    };
    socket.setTimeout(1200, () => finish(false));
    socket.on('connect', () => finish(true));
    socket.on('error', () => finish(false));
  });

const findPort = async (start, attempts) => {
  for (let i = 0; i < attempts; i++) {
    const port = start + i;
    const free = await isPortFree(port);
    if (free) return port;
  }
  return start;
};

const waitReady = (port, timeoutMs) =>
  new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = async () => {
      const connected = await tryConnect(port);
      const ok = connected ? await tryRequest(port) : false;
      if (ok) {
        resolve(true);
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`Dev server not ready on port ${port}`));
        return;
      }
      setTimeout(tick, 500);
    };
    tick();
  });

const main = async () => {
  const basePort = Number(process.env.VITE_DEV_SERVER_PORT || 5173);
  const port = await findPort(basePort, 40);
  process.env.VITE_DEV_SERVER_PORT = String(port);

  const viteBin = process.platform === 'win32'
    ? path.join(__dirname, '..', 'node_modules', '.bin', 'vite.cmd')
    : path.join(__dirname, '..', 'node_modules', '.bin', 'vite');

  const vite = spawn(viteBin, ['--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..')
  });

  const shutdown = () => {
    try {
      vite.kill();
    } catch (e) {}
  };
  process.on('SIGINT', () => shutdown());
  process.on('SIGTERM', () => shutdown());

  await waitReady(port, 45_000);

  const electronBin = process.platform === 'win32'
    ? path.join(__dirname, '..', 'node_modules', '.bin', 'electron.cmd')
    : path.join(__dirname, '..', 'node_modules', '.bin', 'electron');

  const electron = spawn(electronBin, ['.'], {
    stdio: 'inherit',
    cwd: path.join(__dirname, '..'),
    env: { ...process.env }
  });

  electron.on('close', () => shutdown());
};

main().catch((e) => {
  console.error(e.message || String(e));
  process.exit(1);
});
