import React, { useEffect, useMemo, useRef, useState } from 'react';

type PluginInfo = {
  id: string;
  name?: string;
  description?: string;
  path?: string;
  ui?: {
    entry?: string;
    title?: string;
    permissions?: string[];
  } | null;
};

type RpcRequest = {
  kind: 'ngo-plugin-rpc';
  session: string;
  requestId: string;
  method: string;
  params?: any;
};

const genSession = () => {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
};

const normalizeEntry = (pluginPath: string, entry: string) => {
  const base = String(pluginPath || '').replace(/\\/g, '/');
  const rel = String(entry || '').replace(/\\/g, '/').replace(/^\/+/, '');
  return encodeURI(`file://${base}/${rel}`);
};

const buildAllowedMethods = (perms: string[]) => {
  const s = new Set<string>();
  s.add('ping');
  const has = (p: string) => perms.includes(p);
  if (has('openclaw.read') || has('openclaw.run') || has('openclaw.manage')) {
    s.add('openclaw.getStatus');
    s.add('openclaw.getGatewayLogTail');
    s.add('openclaw.getAgentLogTail');
    s.add('openclaw.openDashboard');
  }
  if (has('openclaw.run') || has('openclaw.manage')) {
    s.add('openclaw.ensureRunning');
    s.add('openclaw.runAgentMessage');
  }
  if (has('openclaw.manage')) {
    s.add('openclaw.setEnabled');
    s.add('openclaw.syncBridgeSkill');
    s.add('openclaw.rotateBridgeToken');
    s.add('openclaw.getGatewayToken');
  }
  return s;
};

const PluginHost: React.FC<{ plugin: PluginInfo; onBack?: () => void }> = ({ plugin, onBack }) => {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [session] = useState(() => genSession());
  const perms = Array.isArray(plugin?.ui?.permissions) ? plugin.ui!.permissions!.map(String) : [];
  const allowed = useMemo(() => buildAllowedMethods(perms), [perms.join('|')]);

  const src = useMemo(() => {
    const entry = plugin?.ui && typeof plugin.ui.entry === 'string' ? String(plugin.ui.entry).trim() : '';
    if (!entry || !plugin?.path) return '';
    const base = normalizeEntry(plugin.path, entry);
    const url = new URL(base);
    url.searchParams.set('ngoPluginHost', '1');
    url.searchParams.set('pluginId', String(plugin.id || ''));
    url.searchParams.set('session', session);
    return url.toString();
  }, [plugin?.id, plugin?.path, plugin?.ui, session]);

  useEffect(() => {
    const handler = async (ev: MessageEvent) => {
      const srcWin = iframeRef.current?.contentWindow;
      if (!srcWin || ev.source !== srcWin) return;
      const data = ev.data as RpcRequest;
      if (!data || data.kind !== 'ngo-plugin-rpc') return;
      if (data.session !== session) return;
      const requestId = String(data.requestId || '');
      const respond = (payload: any) => {
        try {
          srcWin.postMessage(
            { kind: 'ngo-plugin-rpc-res', session, requestId, ...payload },
            '*'
          );
        } catch (e) {}
      };

      const method = String(data.method || '');
      if (!allowed.has(method)) {
        respond({ success: false, error: 'permission_denied' });
        return;
      }

      try {
        if (method === 'ping') {
          respond({ success: true, result: { ok: true, pluginId: plugin.id } });
          return;
        }

        const openclaw = (window as any).electronAPI?.openclaw;
        if (!openclaw) {
          respond({ success: false, error: 'openclaw_unavailable' });
          return;
        }

        if (method === 'openclaw.getStatus') {
          const result = await openclaw.getStatus?.();
          respond({ success: true, result });
          return;
        }
        if (method === 'openclaw.getGatewayLogTail') {
          const lines = data.params?.lines;
          const result = await openclaw.getGatewayLogTail?.(lines);
          respond({ success: true, result });
          return;
        }
        if (method === 'openclaw.getAgentLogTail') {
          const lines = data.params?.lines;
          const result = await openclaw.getAgentLogTail?.(lines);
          respond({ success: true, result });
          return;
        }
        if (method === 'openclaw.openDashboard') {
          const result = await openclaw.openDashboard?.();
          respond({ success: true, result });
          return;
        }
        if (method === 'openclaw.getGatewayToken') {
          const result = await openclaw.getGatewayToken?.();
          respond({ success: true, result });
          return;
        }
        if (method === 'openclaw.ensureRunning') {
          const result = await openclaw.ensureRunning?.();
          respond({ success: true, result });
          return;
        }
        if (method === 'openclaw.runAgentMessage') {
          const message = String(data.params?.message || '').trim();
          const result = await openclaw.runAgentMessage?.(message);
          respond({ success: true, result });
          return;
        }
        if (method === 'openclaw.setEnabled') {
          const enabled = !!data.params?.enabled;
          const result = await openclaw.setEnabled?.(enabled);
          respond({ success: true, result });
          return;
        }
        if (method === 'openclaw.syncBridgeSkill') {
          const result = await openclaw.syncBridgeSkill?.();
          respond({ success: true, result });
          return;
        }
        if (method === 'openclaw.rotateBridgeToken') {
          const result = await openclaw.rotateBridgeToken?.();
          respond({ success: true, result });
          return;
        }

        respond({ success: false, error: 'unknown_method' });
      } catch (e: any) {
        respond({ success: false, error: e?.message || 'rpc_failed' });
      }
    };

    window.addEventListener('message', handler as any);
    return () => window.removeEventListener('message', handler as any);
  }, [allowed, plugin.id, session]);

  return (
    <div className="h-full flex flex-col bg-white">
      <div className="p-4 border-b border-slate-200 flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-sm font-black text-slate-800 truncate">{plugin.name || plugin.id}</div>
          <div className="text-[10px] text-slate-500 truncate">{plugin.description || ''}</div>
        </div>
        <div className="flex gap-2 shrink-0">
          <button
            onClick={() => {
              try {
                (window as any).electronAPI?.shell?.openPath?.(plugin.path);
              } catch (e) {}
            }}
            className="px-3 py-2 rounded-xl bg-white text-slate-700 text-xs font-black border border-slate-200 hover:bg-slate-50 transition-all"
          >
            打开目录
          </button>
          <button
            onClick={() => onBack?.()}
            className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black transition-all"
          >
            返回插件中心
          </button>
        </div>
      </div>
      {!src ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
          <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-3xl">🧩</div>
          <p className="font-bold">该插件未提供 UI 入口</p>
          <p className="text-xs mt-2 opacity-60">manifest.json 需提供 ui.entry</p>
        </div>
      ) : (
        <iframe ref={iframeRef} title={String(plugin.id)} src={src} className="flex-1 w-full border-0" />
      )}
    </div>
  );
};

export default PluginHost;
