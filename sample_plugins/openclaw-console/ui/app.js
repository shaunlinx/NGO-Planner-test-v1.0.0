(() => {
  const qs = new URLSearchParams(location.search);
  const session = qs.get('session') || '';

  const byId = (id) => document.getElementById(id);
  const setText = (id, text) => {
    const el = byId(id);
    if (el) el.textContent = String(text ?? '');
  };
  const setPill = (id, ok) => {
    const el = byId(id);
    if (!el) return;
    el.classList.remove('ok', 'bad');
    el.classList.add(ok ? 'ok' : 'bad');
  };

  const pending = new Map();

  window.addEventListener('message', (ev) => {
    const data = ev.data || {};
    if (data.kind !== 'ngo-plugin-rpc-res') return;
    if (data.session !== session) return;
    const key = String(data.requestId || '');
    const p = pending.get(key);
    if (!p) return;
    pending.delete(key);
    if (data.success) p.resolve(data.result);
    else p.reject(new Error(data.error || 'rpc_failed'));
  });

  const rpc = (method, params) =>
    new Promise((resolve, reject) => {
      const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
      pending.set(requestId, { resolve, reject });
      window.parent.postMessage({ kind: 'ngo-plugin-rpc', session, requestId, method, params }, '*');
      setTimeout(() => {
        if (!pending.has(requestId)) return;
        pending.delete(requestId);
        reject(new Error('timeout'));
      }, 15000);
    });

  const withBusy = async (btnId, fn) => {
    const btn = byId(btnId);
    if (!btn) return fn();
    btn.disabled = true;
    try {
      return await fn();
    } finally {
      btn.disabled = false;
    }
  };

  const refreshStatus = async () => {
    const s = await rpc('openclaw.getStatus');
    setText('vEnabled', s?.enabled ? '已启用' : '未启用');
    setText('vGateway', s?.gateway?.running ? `运行中 (${s?.gateway?.port || ''})` : '未运行');
    setText('vBridge', s?.bridge?.running ? `运行中 (${s?.bridge?.port || ''})` : '未运行');
    setText('vExe', s?.executable || '');
    setText('vHome', s?.openclawHome || '');
    setText('vErr', s?.lastError || '');
    setPill('pillGw', !!s?.gateway?.running);
    setPill('pillAg', true);
    return s;
  };

  const refreshLogs = async () => {
    const gw = await rpc('openclaw.getGatewayLogTail', { lines: 200 });
    const ag = await rpc('openclaw.getAgentLogTail', { lines: 200 });
    setText('gwLog', gw?.text || '(暂无)');
    setText('agLog', ag?.text || '(暂无)');
  };

  const ensureRunning = async () => {
    await rpc('openclaw.ensureRunning');
    await refreshStatus();
    await refreshLogs();
  };

  const syncSkill = async () => {
    await rpc('openclaw.syncBridgeSkill');
  };

  const toggleEnabled = async () => {
    const s = await rpc('openclaw.getStatus');
    await rpc('openclaw.setEnabled', { enabled: !s?.enabled });
    await refreshStatus();
    await refreshLogs();
  };

  const rotateToken = async () => {
    const ok = confirm('这会立刻重置 Bridge Token。旧 Token 将失效，你需要在 OpenClaw 侧更新配置。是否继续？');
    if (!ok) return;
    await rpc('openclaw.rotateBridgeToken');
    await refreshStatus();
  };

  const ensureNativeFrame = async (forceReload) => {
    const wrap = byId('nativeWrap');
    const frame = byId('nativeFrame');
    if (!wrap || !frame) return;
    const s = await refreshStatus();
    if (!s?.gateway?.running) {
      await ensureRunning();
    }
    const s2 = await refreshStatus();
    const port = s2?.gateway?.port || 0;
    if (!port) return;
    const url = `http://127.0.0.1:${port}/`;
    if (forceReload || !String(frame.src || '').includes(`127.0.0.1:${port}`)) {
      frame.src = url;
    }
  };

  const toggleNative = async () => {
    const wrap = byId('nativeWrap');
    if (!wrap) return;
    const show = wrap.style.display === 'none' || !wrap.style.display;
    wrap.style.display = show ? 'block' : 'none';
    if (show) {
      await ensureNativeFrame(false);
    }
  };

  byId('btnRefresh')?.addEventListener('click', () => withBusy('btnRefresh', refreshStatus));
  byId('btnEnsure')?.addEventListener('click', () => withBusy('btnEnsure', ensureRunning));
  byId('btnSync')?.addEventListener('click', () => withBusy('btnSync', syncSkill));
  byId('btnToggle')?.addEventListener('click', () => withBusy('btnToggle', toggleEnabled));
  byId('btnRotate')?.addEventListener('click', () => withBusy('btnRotate', rotateToken));
  byId('btnLogs')?.addEventListener('click', () => withBusy('btnLogs', refreshLogs));
  byId('btnNative')?.addEventListener('click', () => withBusy('btnNative', toggleNative));
  byId('btnNativeReload')?.addEventListener('click', () => withBusy('btnNativeReload', () => ensureNativeFrame(true)));
  byId('btnDashWindow')?.addEventListener('click', () => withBusy('btnDashWindow', async () => {
    try {
      const r = await rpc('openclaw.openDashboard');
      if (!r?.success) alert('打开失败：OpenClaw Gateway 未运行或未就绪');
    } catch (e) {
      alert(`打开失败: ${e?.message || 'Unknown error'}`);
    }
  }));

  const init = async () => {
    try {
      await rpc('ping');
      await refreshStatus();
      await refreshLogs();
    } catch (e) {
      setText('vErr', e?.message || '初始化失败');
      setPill('pillGw', false);
      setPill('pillAg', false);
    }
  };

  init();
})();
