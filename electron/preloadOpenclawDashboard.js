const { ipcRenderer } = require('electron');

// Force context isolation off requires us to be careful not to expose electron API
// But here we want to patch window globals, so it's intended.

const isLocalHost = (host) => {
  const h = String(host || '').toLowerCase();
  return h.startsWith('127.0.0.1:') || h.startsWith('localhost:');
};

const setTokenToStorage = (token) => {
  const t = String(token || '').trim();
  if (!t) return;
  const keys = [
    'openclaw_gateway_token',
    'openclaw.gateway.token',
    'openclaw:gateway:token',
    'gateway_token',
    'gatewayToken',
    'OPENCLAW_GATEWAY_TOKEN',
    'authToken',
    'token',
    'openclaw_control_ui_auth',
    'openclaw_control_ui_token'
  ];
  for (const k of keys) {
    try {
      localStorage.setItem(k, t);
    } catch (e) {}
  }
  try {
    localStorage.setItem('openclaw_control_ui_settings', JSON.stringify({ token: t, auth: t }));
  } catch (e) {}
};

// Global token reference for patched functions
let tokenRef = '';

const patchWebSocket = () => {
  const NativeWS = window.WebSocket;
  if (!NativeWS || NativeWS.__ngo_patched) return;
  
  function WrappedWebSocket(url, protocols) {
    let finalUrl = url;
    try {
      const t = String(tokenRef || '').trim();
      const raw = String(url || '');
      const u = new URL(raw, window.location.href);
      if (u.protocol === 'ws:' || u.protocol === 'wss:') {
        if (t && isLocalHost(u.host)) {
          u.searchParams.set('auth', t);
          u.searchParams.set('token', t);
          finalUrl = u.toString();
        }
      }
    } catch (e) {
      console.error('[NGO] WS Patch Error:', e);
    }
    return protocols !== undefined ? new NativeWS(finalUrl, protocols) : new NativeWS(finalUrl);
  }
  
  WrappedWebSocket.prototype = NativeWS.prototype;
  WrappedWebSocket.CONNECTING = NativeWS.CONNECTING;
  WrappedWebSocket.OPEN = NativeWS.OPEN;
  WrappedWebSocket.CLOSING = NativeWS.CLOSING;
  WrappedWebSocket.CLOSED = NativeWS.CLOSED;

  try {
    Object.defineProperty(WrappedWebSocket, '__ngo_patched', { value: true });
    window.WebSocket = WrappedWebSocket;
  } catch (e) {}
};

const patchFetch = () => {
  const nativeFetch = window.fetch;
  if (typeof nativeFetch !== 'function' || nativeFetch.__ngo_patched) return;
  
  const wrapped = function (input, init) {
    let nextInput = input;
    let nextInit = init;

    try {
      const t = String(tokenRef || '').trim();
      const url = typeof input === 'string' ? input : (input && input.url ? input.url : '');
      const u = new URL(String(url || ''), window.location.href);
      
      if (t && isLocalHost(u.host)) {
        nextInit = { ...(init || {}) };
        const h = new Headers((init && init.headers) || (input && input.headers) || undefined);
        if (!h.has('authorization')) h.set('authorization', `Bearer ${t}`);
        nextInit.headers = h;
      }
    } catch (e) {}
    
    return nativeFetch(nextInput, nextInit);
  };

  try {
    Object.defineProperty(wrapped, '__ngo_patched', { value: true });
    window.fetch = wrapped;
  } catch (e) {}
};

(() => {
  try {
    // 1. Try Sync Auth First (Fastest)
    try {
      const res = ipcRenderer.sendSync('openclaw-dashboard-auth-sync');
      const token = res && res.token ? String(res.token) : '';
      if (token) {
        tokenRef = token;
        setTokenToStorage(tokenRef);
        patchWebSocket();
        patchFetch();
        return; // Success, stop here
      }
    } catch (e) {}

    // 2. Fallback to Async (Slower, might miss initial requests)
    ipcRenderer.invoke('openclaw-dashboard-auth').then((res) => {
      const token = res && res.token ? String(res.token) : '';
      if (!token) return;
      tokenRef = token;
      setTokenToStorage(tokenRef);
      patchWebSocket();
      patchFetch();
      
      // Reload if we missed the boat (session marker check)
      try {
        const marker = sessionStorage.getItem('ngo_openclaw_dash_injected');
        if (!marker) {
          sessionStorage.setItem('ngo_openclaw_dash_injected', '1');
          setTimeout(() => {
             window.location.reload(); 
          }, 100);
        }
      } catch (e) {}
    }).catch(() => {});

  } catch (e) {}
})();

(() => {
  try {
    const hookUpdate = () => {
      try {
        const btns = Array.from(document.querySelectorAll('button'));
        const btn = btns.find((b) => {
          const t = String(b.textContent || '').trim().toLowerCase();
          return t === 'update now' || t.includes('update now');
        });
        if (!btn) return false;
        if (btn.__ngo_update_patched) return true;
        Object.defineProperty(btn, '__ngo_update_patched', { value: true });
        btn.addEventListener(
          'click',
          async (ev) => {
            try { ev.preventDefault(); ev.stopPropagation(); } catch (e) {}
            try {
              const ok = confirm('将改用 NGO Planner 托管升级 OpenClaw（更稳定）。是否继续？');
              if (!ok) return;
              const res = await ipcRenderer.invoke('openclaw-managed-install', { openclawVersion: 'latest', force: true });
              if (res?.success) alert('✅ 已开始升级。请到 NGO Planner 系统设置 → OpenClaw 集成查看进度。');
              else alert(`❌ 升级失败：${res?.error || 'Unknown error'}`);
            } catch (e) {
              alert(`❌ 升级失败：${e?.message || 'Unknown error'}`);
            }
          },
          true
        );
        return true;
      } catch (e) {
        return false;
      }
    };

    const tryOnce = () => {
      if (hookUpdate()) return;
      setTimeout(hookUpdate, 500);
      setTimeout(hookUpdate, 1500);
      setTimeout(hookUpdate, 3000);
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryOnce);
    } else {
      tryOnce();
    }
    const obs = new MutationObserver(() => hookUpdate());
    obs.observe(document.documentElement, { childList: true, subtree: true });
  } catch (e) {}
})();
