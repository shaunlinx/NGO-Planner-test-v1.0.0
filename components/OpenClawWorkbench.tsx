import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, Loader2, PanelRightClose, PanelRightOpen, RefreshCw, Terminal, Trash2, Wrench } from 'lucide-react';

type Status = {
  enabled?: boolean;
  installed?: boolean;
  executable?: string | null;
  gateway?: { port?: number; running?: boolean; pid?: number | null; managedByApp?: boolean };
  bridge?: { port?: number; running?: boolean };
  lastError?: string | null;
};

const OpenClawWorkbench: React.FC<{ onOpenToolCenter?: () => void }> = ({ onOpenToolCenter }) => {
  const api = (window as any).electronAPI;

  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);
  const [showUtilityDrawer, setShowUtilityDrawer] = useState(false);
  const [lastError, setLastError] = useState('');
  const [presetBusy, setPresetBusy] = useState(false);
  const [presetResult, setPresetResult] = useState<any>(null);
  const [utilSkills, setUtilSkills] = useState<any>(null);
  const [pluginsBusy, setPluginsBusy] = useState(false);
  const [feishuWizardStep, setFeishuWizardStep] = useState<1 | 2 | 3>(1);
  const [feishuDomain, setFeishuDomain] = useState<'feishu' | 'lark'>('feishu');
  const [feishuAppId, setFeishuAppId] = useState('');
  const [feishuAppSecret, setFeishuAppSecret] = useState('');
  const [feishuSaveBusy, setFeishuSaveBusy] = useState(false);
  const [feishuSaveMsg, setFeishuSaveMsg] = useState('');
  const [scrubBusy, setScrubBusy] = useState(false);
  const [scrubResult, setScrubResult] = useState<any>(null);
  const [diagBusy, setDiagBusy] = useState(false);
  const [diagResult, setDiagResult] = useState<any>(null);

  const refreshLockRef = useRef(0);
  const embedRef = useRef<HTMLDivElement | null>(null);
  const embedShownRef = useRef(false);
  const lastBoundsKeyRef = useRef('');
  const resizeRafRef = useRef<number | null>(null);
  const showRetryTimerRef = useRef<number | null>(null);
  const showRetryCountRef = useRef(0);
  const viewEpochRef = useRef(0);
  const aliveRef = useRef(true);

  const getBounds = () => {
    const el = embedRef.current;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    if (!(r.width > 0 && r.height > 0)) return null;
    return {
      x: Math.max(0, Math.round(r.left)),
      y: Math.max(0, Math.round(r.top)),
      width: Math.max(1, Math.round(r.width)),
      height: Math.max(1, Math.round(r.height))
    };
  };

  const hideEmbed = async () => {
    try {
      await api?.openclaw?.embed?.hide?.();
    } catch (e) {}
    embedShownRef.current = false;
    showRetryCountRef.current = 0;
    try {
      if (showRetryTimerRef.current !== null) window.clearTimeout(showRetryTimerRef.current);
    } catch (e) {}
    showRetryTimerRef.current = null;
  };

  const showEmbed = async () => {
    const epoch = viewEpochRef.current;
    if (!aliveRef.current) return;
    const b = getBounds();
    if (!b) {
      if (showRetryCountRef.current < 6) {
        showRetryCountRef.current += 1;
        try {
          if (showRetryTimerRef.current !== null) window.clearTimeout(showRetryTimerRef.current);
        } catch (e) {}
        showRetryTimerRef.current = window.setTimeout(() => {
          showRetryTimerRef.current = null;
          if (!aliveRef.current) return;
          if (epoch !== viewEpochRef.current) return;
          showEmbed();
        }, 60);
      }
      return;
    }
    showRetryCountRef.current = 0;
    try {
      if (showRetryTimerRef.current !== null) window.clearTimeout(showRetryTimerRef.current);
    } catch (e) {}
    showRetryTimerRef.current = null;
    try {
      if (!aliveRef.current) return;
      if (epoch !== viewEpochRef.current) return;
      const key = `${b.x},${b.y},${b.width},${b.height}`;
      if (embedShownRef.current) {
        if (key === lastBoundsKeyRef.current) return;
        lastBoundsKeyRef.current = key;
        await api?.openclaw?.embed?.resize?.({ bounds: b });
        return;
      }
      lastBoundsKeyRef.current = key;
      const res = await api?.openclaw?.embed?.show?.({ bounds: b });
      if (!aliveRef.current) return;
      if (epoch !== viewEpochRef.current) return;
      if (res?.success) embedShownRef.current = true;
    } catch (e) {}
  };

  const resizeEmbed = async () => {
    if (!embedShownRef.current) return;
    const b = getBounds();
    if (!b) return;
    const key = `${b.x},${b.y},${b.width},${b.height}`;
    if (key === lastBoundsKeyRef.current) return;
    lastBoundsKeyRef.current = key;
    try {
      await api?.openclaw?.embed?.resize?.({ bounds: b });
    } catch (e) {}
  };

  const scheduleResize = () => {
    if (resizeRafRef.current !== null) return;
    resizeRafRef.current = window.requestAnimationFrame(() => {
      resizeRafRef.current = null;
      resizeEmbed();
    });
  };

  const refresh = async () => {
    const seq = Date.now();
    refreshLockRef.current = seq;
    setBusy(true);
    setLastError('');
    try {
      let s: Status | null = null;
      try {
        s = (await api?.openclaw?.getStatus?.()) || null;
      } catch (e: any) {
        setLastError(e?.message || '获取状态失败');
      }
      if (s?.enabled && !s?.gateway?.running) {
        try {
          const ensured = await api?.openclaw?.ensureRunning?.();
          if (ensured && typeof ensured === 'object') s = ensured;
        } catch (e: any) {
          setLastError(e?.message || '启动 OpenClaw 失败');
        }
      }

      if (refreshLockRef.current !== seq) return;
      setStatus(s);
      const running = !!s?.gateway?.running;
      if (running) {
        await showEmbed();
        scheduleResize();
      } else {
        await hideEmbed();
      }
    } finally {
      if (refreshLockRef.current === seq) setBusy(false);
    }
  };

  const loadFeishuSettings = async () => {
    try {
      const secure = (window as any).electronAPI?.secure;
      if (!secure?.get) return;
      const appId = await secure.get('openclaw_feishu_app_id');
      const appSecret = await secure.get('openclaw_feishu_app_secret');
      const domain = await secure.get('openclaw_feishu_domain');
      setFeishuAppId(String(appId || ''));
      setFeishuAppSecret(String(appSecret || ''));
      setFeishuDomain(String(domain || '').trim() === 'lark' ? 'lark' : 'feishu');
    } catch (e) {}
  };

  const saveFeishuSettings = async () => {
    setFeishuSaveBusy(true);
    setFeishuSaveMsg('');
    try {
      const secure = (window as any).electronAPI?.secure;
      if (!secure?.set) {
        setFeishuSaveMsg('❌ 安全存储不可用');
        return false;
      }
      const appId = String(feishuAppId || '').trim();
      const appSecret = String(feishuAppSecret || '').trim();
      if (!appId || !appSecret) {
        setFeishuSaveMsg('❌ 请填写 App ID 与 App Secret');
        return false;
      }
      await secure.set('openclaw_feishu_app_id', appId);
      await secure.set('openclaw_feishu_app_secret', appSecret);
      await secure.set('openclaw_feishu_domain', feishuDomain);
      setFeishuSaveMsg('✅ 已保存到本机');
      return true;
    } catch (e: any) {
      setFeishuSaveMsg(`❌ 保存失败：${e?.message || 'Unknown error'}`);
      return false;
    } finally {
      setFeishuSaveBusy(false);
    }
  };

  const FEISHU_SCOPES_JSON = `{
  "scopes": {
    "tenant": [
      "aily:file:read",
      "aily:file:write",
      "application:application.app_message_stats.overview:readonly",
      "application:application:self_manage",
      "application:bot.menu:write",
      "contact:user.employee_id:readonly",
      "corehr:file:download",
      "event:ip_list",
      "im:chat.access_event.bot_p2p_chat:read",
      "im:chat.members:bot_access",
      "im:message",
      "im:message.group_at_msg:readonly",
      "im:message.p2p_msg:readonly",
      "im:message:readonly",
      "im:message:send_as_bot",
      "im:resource"
    ],
    "user": [
      "aily:file:read",
      "aily:file:write",
      "im:chat.access_event.bot_p2p_chat:read"
    ]
  }
}`;

  useEffect(() => {
    aliveRef.current = true;
    viewEpochRef.current += 1;
    refresh();
    loadFeishuSettings();
    refreshUtilSkills();
    return () => {
      aliveRef.current = false;
      viewEpochRef.current += 1;
      try {
        if (resizeRafRef.current !== null) window.cancelAnimationFrame(resizeRafRef.current);
      } catch (e) {}
      try {
        if (showRetryTimerRef.current !== null) window.clearTimeout(showRetryTimerRef.current);
      } catch (e) {}
      hideEmbed();
    };
  }, []);

  useEffect(() => {
    const running = !!status?.gateway?.running;
    if (!running) return;
    showEmbed().finally(() => scheduleResize());
  }, [status?.gateway?.running]);

  useEffect(() => {
    const running = !!status?.gateway?.running;
    if (!running) return;
    scheduleResize();
  }, [showSidebar, status?.gateway?.running]);

  useEffect(() => {
    const handler = () => {
      const running = !!status?.gateway?.running;
      if (!running) return;
      showEmbed().finally(() => scheduleResize());
    };
    window.addEventListener('openclaw:restore-embed', handler as any);
    return () => window.removeEventListener('openclaw:restore-embed', handler as any);
  }, [status?.gateway?.running]);

  useEffect(() => {
    const handler = () => {
      hideEmbed();
    };
    window.addEventListener('openclaw:hide-embed', handler as any);
    return () => window.removeEventListener('openclaw:hide-embed', handler as any);
  }, []);

  useEffect(() => {
    const el = embedRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => {
      scheduleResize();
    });
    obs.observe(el);
    const onWinResize = () => scheduleResize();
    window.addEventListener('resize', onWinResize);
    return () => {
      window.removeEventListener('resize', onWinResize);
      try {
        obs.disconnect();
      } catch (e) {}
    };
  }, []);

  const canStart = useMemo(() => {
    if (busy) return false;
    if (status?.installed === false) return false;
    return true;
  }, [busy, status?.installed]);

  const refreshUtilSkills = async () => {
    setPluginsBusy(true);
    try {
      const r = await api?.openclaw?.utilitySkills?.list?.();
      setUtilSkills(r || null);
    } catch (e: any) {
      setUtilSkills({ success: false, error: e?.message || 'utility_skills_list_failed' });
    } finally {
      setPluginsBusy(false);
    }
  };

  const runUtilityAction = async (kind: 'toggle' | 'remove' | 'update' | 'repair', skill: any) => {
    const id = String(skill?.id || '').trim();
    if (!id) return;
    setPluginsBusy(true);
    try {
      if (kind === 'toggle') {
        const nextEnabled = !skill?.enabled;
        const r = await api?.openclaw?.utilitySkills?.setEnabled?.({ id, enabled: nextEnabled });
        if (!r?.success) throw new Error(String(r?.error || 'toggle_failed'));
        alert(`${id} 已${nextEnabled ? '启用' : '停用'}`);
      } else if (kind === 'remove') {
        const ok = confirm(`确认删除技能 ${id}？`);
        if (!ok) return;
        const r = await api?.openclaw?.utilitySkills?.remove?.({ id });
        if (!r?.success) throw new Error(String(r?.error || 'remove_failed'));
        alert(`${id} 已删除`);
      } else if (kind === 'update') {
        const r = await api?.openclaw?.utilitySkills?.update?.({ id });
        if (!r?.success) throw new Error(String(r?.error || 'update_failed'));
        alert(`${id} 更新成功`);
      } else {
        const r = await api?.openclaw?.utilitySkills?.install?.({ skills: [id] });
        if (!r?.success) throw new Error(String(r?.failed?.[0]?.error || r?.error || 'repair_failed'));
        alert(`${id} 安装成功`);
      }
    } catch (e: any) {
      alert(`${id} 操作失败：${String(e?.message || 'unknown_error')}`);
    } finally {
      setPluginsBusy(false);
      await refreshUtilSkills();
      await refresh();
    }
  };

  const applyPreset = async () => {
    setPresetBusy(true);
    setPresetResult(null);
    try {
      const r = await api?.openclaw?.applyNgoPreset?.();
      setPresetResult(r);
      await refresh();
      await refreshUtilSkills();
    } catch (e: any) {
      setPresetResult({ success: false, error: e?.message || 'apply_failed' });
    } finally {
      setPresetBusy(false);
    }
  };

  const scrubSensitive = async () => {
    setScrubBusy(true);
    setScrubResult(null);
    try {
      const r = await api?.openclaw?.scrubSensitive?.();
      setScrubResult(r);
    } catch (e: any) {
      setScrubResult({ success: false, error: e?.message || 'scrub_failed' });
    } finally {
      setScrubBusy(false);
    }
  };

  const refreshDiagnostics = async () => {
    setDiagBusy(true);
    try {
      const [gw, rt, ag] = await Promise.all([
        api?.openclaw?.getGatewayLogTail?.(200),
        api?.openclaw?.getRuntimeLogTail?.(200),
        api?.openclaw?.getAgentLogTail?.(200)
      ]);
      setDiagResult({
        success: true,
        gateway: gw,
        runtime: rt,
        agent: ag
      });
    } catch (e: any) {
      setDiagResult({ success: false, error: e?.message || 'diagnostics_failed' });
    } finally {
      setDiagBusy(false);
    }
  };

  const openDashboardWithFeedback = async () => {
    try {
      const res = await api?.openclaw?.openDashboard?.();
      if (res?.success) return;
      const msg = String(res?.detail || res?.error || '打开失败');
      alert(`打开 Dashboard 失败：${msg}`);
      await refresh();
    } catch (e: any) {
      alert(`打开 Dashboard 失败：${e?.message || 'Unknown error'}`);
    }
  };

  const sidebarWidth = 360;

  return (
    <div className="h-full w-full flex flex-col bg-slate-50">
      <div className="px-5 py-4 border-b border-slate-200 bg-white flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-black text-slate-800 truncate">OpenClaw（内嵌工作台）</div>
          <div className="text-[10px] text-slate-500 mt-1 truncate">
            {status?.gateway?.running ? `Gateway 运行中：127.0.0.1:${status?.gateway?.port}` : 'Gateway 未运行（请到工具中心管理安装/启停）'}
            {status?.installed === false ? ' · 未安装' : ''}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onOpenToolCenter?.()}
            className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black transition-all"
            title="前往工具中心管理 OpenClaw"
          >
            工具中心
          </button>
          <button
            onClick={async () => {
              const next = !showUtilityDrawer;
              setShowUtilityDrawer(next);
              if (next) await refreshUtilSkills();
            }}
            className="px-3 py-2 rounded-xl bg-white text-slate-700 text-xs font-black border border-slate-200 hover:bg-slate-50 transition-all inline-flex items-center gap-2"
            title="打开实用技能菜单"
          >
            <Wrench className="w-4 h-4" />
            实用技能
          </button>
          <button
            onClick={() => setShowSidebar((v) => !v)}
            className="px-3 py-2 rounded-xl bg-white text-slate-700 text-xs font-black border border-slate-200 hover:bg-slate-50 transition-all"
            title={showSidebar ? '隐藏设置' : '显示设置'}
          >
            {showSidebar ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </button>
          <button
            onClick={async () => {
              try {
                await api?.openclaw?.embed?.reload?.();
              } catch (e) {}
            }}
            disabled={!status?.gateway?.running}
            className="px-3 py-2 rounded-xl bg-white text-slate-700 text-xs font-black border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50"
            title="刷新内嵌页面"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={openDashboardWithFeedback}
            className="px-3 py-2 rounded-xl bg-white text-slate-700 text-xs font-black border border-slate-200 hover:bg-slate-50 transition-all"
            title="新窗口打开 Dashboard"
          >
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        <div className="flex-1 min-w-0 h-full bg-white">
          {status?.installed === false && (
            <div className="h-full w-full flex flex-col items-center justify-center text-slate-500 px-8 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-3xl">🦾</div>
              <div className="text-sm font-black text-slate-800">未检测到 OpenClaw</div>
              <div className="text-xs mt-2 opacity-80">请先到工具中心完成安装/升级，再回到此处内嵌使用。</div>
              <button
                onClick={() => onOpenToolCenter?.()}
                disabled={!canStart}
                className="mt-4 px-5 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 transition-all disabled:opacity-50"
              >
                前往工具中心
              </button>
              {lastError && <div className="mt-3 text-[10px] text-rose-600">{lastError}</div>}
            </div>
          )}

          {status?.installed !== false && !status?.gateway?.running && (
            <div className="h-full w-full flex flex-col items-center justify-center text-slate-500 px-8 text-center">
              <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-3xl">🧩</div>
              <div className="text-sm font-black text-slate-800">OpenClaw 未启动</div>
              <div className="text-xs mt-2 opacity-80">
                请到工具中心完成启停管理；启动后此处会自动显示内嵌 Dashboard。
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => onOpenToolCenter?.()}
                  disabled={!canStart}
                  className="px-4 py-2 rounded-xl bg-white text-slate-700 text-xs font-black border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50"
                >
                  前往工具中心
                </button>
                <button
                  onClick={openDashboardWithFeedback}
                  className="px-4 py-2 rounded-xl bg-white text-slate-700 text-xs font-black border border-slate-200 hover:bg-slate-50 transition-all"
                >
                  新窗口打开
                </button>
              </div>
              {(lastError || status?.lastError) && (
                <div className="mt-3 text-[10px] text-rose-600">{String(lastError || status?.lastError || '')}</div>
              )}
            </div>
          )}

          {status?.installed !== false && status?.gateway?.running && (
            <div ref={embedRef} className="w-full h-full" />
          )}
        </div>

        {showSidebar && (
          <div
            className="h-full border-l border-slate-200 bg-white shrink-0 overflow-y-auto custom-scrollbar"
            style={{ width: sidebarWidth }}
          >
            <div className="p-5 space-y-4">
              <div className="text-xs font-black text-slate-800">说明</div>
              <div className="text-[10px] text-slate-500 leading-relaxed">
                本工作台用于内嵌使用 OpenClaw 官方 Dashboard（Channels/Skills/Agents 等）。安装/升级/启停/重置鉴权等“能不能用”的管理操作请统一在工具中心完成。
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-black text-slate-800 truncate">NGO Planner 一键配置</div>
                    <div className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                      将 NGO Planner 的模型与通道配置写入 OpenClaw，并按需补齐插件依赖，然后重启 Gateway 使配置生效。
                    </div>
                  </div>
                  <button
                    onClick={applyPreset}
                    disabled={presetBusy}
                    className="px-3 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black transition-all disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {presetBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    一键应用
                  </button>
                </div>
                {presetResult && (
                  <div className="text-[10px] text-slate-600">
                    {presetResult?.success ? (
                      <div className="text-emerald-700 font-black">✅ 已应用</div>
                    ) : (
                      <div className="text-rose-700 font-black">❌ 应用失败：{String(presetResult?.error || 'apply_failed')}</div>
                    )}
                    {Array.isArray(presetResult?.installed) && presetResult.installed.length > 0 && (
                      <div className="mt-2">已启用插件：{presetResult.installed.join(', ')}</div>
                    )}
                    {Array.isArray(presetResult?.installErrors) && presetResult.installErrors.length > 0 && (
                      <div className="mt-2 text-amber-700">
                        插件安装异常：{presetResult.installErrors.map((x: any) => `${x?.plugin || 'unknown'}(${x?.error || 'error'})`).join('、')}
                        {presetResult.installErrors?.[0]?.detail ? (
                          <div className="mt-2 text-[10px] text-slate-600 whitespace-pre-wrap break-words max-h-24 overflow-auto custom-scrollbar">
                            {String(presetResult.installErrors[0].detail || '')}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-black text-slate-800 truncate">最终保险：安全扫描与脱敏</div>
                    <div className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                      扫描 OpenClaw 状态目录下的配置/日志/会话记录，把疑似密钥内容脱敏为 ***REDACTED***，降低被对话复述的风险。
                    </div>
                  </div>
                  <button
                    onClick={scrubSensitive}
                    disabled={scrubBusy}
                    className="px-3 py-2 rounded-xl bg-white text-slate-700 text-[10px] font-black border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {scrubBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    执行
                  </button>
                </div>
                {scrubResult && (
                  <div className="text-[10px] text-slate-600">
                    {scrubResult?.success ? (
                      <div className="text-emerald-700 font-black">✅ 已完成</div>
                    ) : (
                      <div className="text-rose-700 font-black">❌ 执行失败：{String(scrubResult?.error || 'scrub_failed')}</div>
                    )}
                    {scrubResult?.text && (
                      <div className="mt-2">
                        扫描文件：{String(scrubResult.text.scanned ?? '-')} · 修改文件：{String(scrubResult.text.modified ?? '-')}
                      </div>
                    )}
                    {scrubResult?.config?.touched && Array.isArray(scrubResult.config.touched) && scrubResult.config.touched.length > 0 && (
                      <div className="mt-2">已修正配置：{scrubResult.config.touched.length} 处</div>
                    )}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[11px] font-black text-slate-800 truncate">诊断：为什么会 Invalid URL</div>
                    <div className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                      拉取 Gateway/运行时/Agent 近 200 行日志，直接在内嵌控制台里定位错误来源。
                    </div>
                  </div>
                  <button
                    onClick={refreshDiagnostics}
                    disabled={diagBusy}
                    className="px-3 py-2 rounded-xl bg-white text-slate-700 text-[10px] font-black border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50 inline-flex items-center gap-2"
                  >
                    {diagBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    刷新
                  </button>
                </div>
                {diagResult && (
                  <div className="text-[10px] text-slate-600">
                    {diagResult?.success ? (
                      <div className="text-emerald-700 font-black">✅ 已拉取日志</div>
                    ) : (
                      <div className="text-rose-700 font-black">❌ 拉取失败：{String(diagResult?.error || 'diagnostics_failed')}</div>
                    )}
                    {diagResult?.success ? (
                      <div className="mt-2 space-y-2">
                        {(() => {
                          const all = `${diagResult?.gateway?.text || ''}\n${diagResult?.runtime?.text || ''}\n${diagResult?.agent?.text || ''}`;
                          const hasInvalidUrl = all.includes('Invalid URL');
                          return hasInvalidUrl ? (
                            <div className="text-amber-700 font-black">
                              检测到 Invalid URL。通常是某个 URL/代理配置缺少 http(s)://，或某个插件/模型在构造请求 URL 时得到空值。
                            </div>
                          ) : null;
                        })()}
                        <div className="text-[10px] text-slate-700 font-black">Gateway 日志</div>
                        <div className="text-[10px] text-slate-600 whitespace-pre-wrap break-words max-h-28 overflow-auto custom-scrollbar border border-slate-100 rounded-xl p-2 bg-slate-50">
                          {String(diagResult?.gateway?.text || '') || '(无)'}
                        </div>
                        <div className="text-[10px] text-slate-700 font-black">运行时日志（/tmp/openclaw）</div>
                        <div className="text-[10px] text-slate-600 whitespace-pre-wrap break-words max-h-28 overflow-auto custom-scrollbar border border-slate-100 rounded-xl p-2 bg-slate-50">
                          {String(diagResult?.runtime?.text || '') || '(无)'}
                        </div>
                        <div className="text-[10px] text-slate-700 font-black">Agent 日志</div>
                        <div className="text-[10px] text-slate-600 whitespace-pre-wrap break-words max-h-28 overflow-auto custom-scrollbar border border-slate-100 rounded-xl p-2 bg-slate-50">
                          {String(diagResult?.agent?.text || '') || '(无)'}
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 space-y-3">
                <div className="text-[11px] font-black text-slate-800">飞书/Lark 通道向导</div>
                <div className="text-[10px] text-slate-500 leading-relaxed">
                  按步骤创建应用、填入凭据并补齐权限/事件订阅，然后一键应用并重启 Gateway。
                </div>

                <div className="flex items-center gap-2 text-[10px]">
                  {([1, 2, 3] as const).map((n) => (
                    <button
                      key={n}
                      onClick={() => setFeishuWizardStep(n)}
                      className={`px-3 py-2 rounded-xl border text-[10px] font-black transition-colors ${
                        feishuWizardStep === n
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      {n}
                    </button>
                  ))}
                  <div className="flex-1" />
                  <button
                    onClick={loadFeishuSettings}
                    className="px-3 py-2 rounded-xl bg-white text-slate-700 text-[10px] font-black border border-slate-200 hover:bg-slate-50 transition-all"
                  >
                    读取已保存
                  </button>
                </div>

                {feishuWizardStep === 1 && (
                  <div className="space-y-2">
                    <select
                      value={feishuDomain}
                      onChange={(e) => setFeishuDomain(String(e.target.value) === 'lark' ? 'lark' : 'feishu')}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-[10px] font-black text-slate-700"
                    >
                      <option value="feishu">飞书（feishu）</option>
                      <option value="lark">Lark（海外）</option>
                    </select>
                    <div className="flex gap-2">
                      <button
                        onClick={() => {
                          try {
                            const url = feishuDomain === 'lark' ? 'https://open.larksuite.com/app' : 'https://open.feishu.cn/app';
                            (window as any).electronAPI?.shell?.openExternal?.(url);
                          } catch (e) {}
                        }}
                        className="flex-1 px-4 py-2 rounded-xl bg-white text-slate-700 text-[10px] font-black border border-slate-200 hover:bg-slate-50 transition-all"
                      >
                        打开开放平台
                      </button>
                      <button
                        onClick={() => setFeishuWizardStep(2)}
                        className="flex-1 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black transition-all"
                      >
                        下一步
                      </button>
                    </div>
                  </div>
                )}

                {feishuWizardStep === 2 && (
                  <div className="space-y-2">
                    <input
                      value={feishuAppId}
                      onChange={(e) => setFeishuAppId(e.target.value)}
                      placeholder="App ID（如 cli_xxx）"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-[10px] font-black text-slate-700"
                    />
                    <input
                      value={feishuAppSecret}
                      onChange={(e) => setFeishuAppSecret(e.target.value)}
                      placeholder="App Secret"
                      type="password"
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-[10px] font-black text-slate-700"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          const ok = await saveFeishuSettings();
                          if (ok) setFeishuWizardStep(3);
                        }}
                        disabled={feishuSaveBusy}
                        className="flex-1 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black transition-all disabled:opacity-50 inline-flex items-center justify-center gap-2"
                      >
                        {feishuSaveBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        保存并继续
                      </button>
                      <button
                        onClick={() => setFeishuWizardStep(1)}
                        className="flex-1 px-4 py-2 rounded-xl bg-white text-slate-700 text-[10px] font-black border border-slate-200 hover:bg-slate-50 transition-all"
                      >
                        上一步
                      </button>
                    </div>
                    {feishuSaveMsg && <div className="text-[10px] text-slate-600">{feishuSaveMsg}</div>}
                  </div>
                )}

                {feishuWizardStep === 3 && (
                  <div className="space-y-2">
                    <div className="text-[10px] text-slate-500">权限清单（可直接在飞书后台批量导入）</div>
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[10px] font-mono text-slate-700 whitespace-pre-wrap break-words max-h-40 overflow-auto custom-scrollbar">
                      {FEISHU_SCOPES_JSON}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          try {
                            await (window as any).electronAPI?.clipboard?.writeText?.(FEISHU_SCOPES_JSON);
                          } catch (e) {}
                        }}
                        className="flex-1 px-4 py-2 rounded-xl bg-white text-slate-700 text-[10px] font-black border border-slate-200 hover:bg-slate-50 transition-all"
                      >
                        复制权限清单
                      </button>
                      <button
                        onClick={() => {
                          try {
                            (window as any).electronAPI?.shell?.openExternal?.('https://docs.openclaw.ai/channels/feishu');
                          } catch (e) {}
                        }}
                        className="flex-1 px-4 py-2 rounded-xl bg-white text-slate-700 text-[10px] font-black border border-slate-200 hover:bg-slate-50 transition-all"
                      >
                        打开配置教程
                      </button>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={async () => {
                          const ok = await saveFeishuSettings();
                          if (!ok) return;
                          await applyPreset();
                        }}
                        disabled={presetBusy || feishuSaveBusy}
                        className="flex-1 px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black transition-all disabled:opacity-50 inline-flex items-center justify-center gap-2"
                      >
                        {(presetBusy || feishuSaveBusy) ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                        安装插件并应用
                      </button>
                      <button
                        onClick={() => setFeishuWizardStep(2)}
                        className="flex-1 px-4 py-2 rounded-xl bg-white text-slate-700 text-[10px] font-black border border-slate-200 hover:bg-slate-50 transition-all"
                      >
                        上一步
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 p-4 space-y-2">
                <div className="text-[11px] font-black text-slate-700">状态</div>
                <div className="text-[10px] text-slate-600">
                  <div>安装：{status?.installed ? '是' : '否'}</div>
                  <div>Gateway：{status?.gateway?.running ? '运行中' : '未运行'}</div>
                  <div>Gateway 端口：{status?.gateway?.port || '-'}</div>
                  <div>托管：{status?.gateway?.managedByApp ? '是' : '否'}</div>
                  <div>Bridge：{status?.bridge?.running ? '运行中' : '未运行'}</div>
                  <div>Bridge 端口：{status?.bridge?.port || '-'}</div>
                  <div className="truncate">可执行文件：{status?.executable ? String(status.executable) : '-'}</div>
                </div>
                {(status?.lastError || lastError) && (
                  <div className="text-[10px] text-rose-600 break-words">{String(lastError || status?.lastError || '')}</div>
                )}
              </div>

              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="flex gap-2">
                  <button
                    onClick={() => refresh()}
                    disabled={!canStart}
                    className="flex-1 px-4 py-2 rounded-xl bg-white text-slate-700 text-xs font-black border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50"
                  >
                    刷新状态
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        await api?.openclaw?.embed?.reload?.();
                      } catch (e) {}
                    }}
                    disabled={!status?.gateway?.running}
                    className="flex-1 px-4 py-2 rounded-xl bg-white text-slate-700 text-xs font-black border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50"
                  >
                    刷新页面
                  </button>
                </div>
              </div>

              <div className="text-[10px] text-slate-500">
                右上角“新窗口打开”用于排障与对比（如内嵌区域异常，可用新窗口确认服务是否正常）。
              </div>
            </div>
          </div>
        )}
        <div
          className={`absolute top-0 right-0 h-full w-[360px] border-l border-slate-200 bg-white shadow-xl transition-transform duration-200 ${
            showUtilityDrawer ? 'translate-x-0' : 'translate-x-full'
          }`}
        >
          <div className="h-full overflow-y-auto custom-scrollbar p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-black text-slate-800">实用技能</div>
              <button
                onClick={async () => {
                  await refreshUtilSkills();
                }}
                disabled={pluginsBusy}
                className="px-3 py-2 rounded-xl bg-white text-slate-700 text-[10px] font-black border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50 inline-flex items-center gap-2"
              >
                {pluginsBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                刷新
              </button>
            </div>
            <div className="text-[10px] text-slate-500">
              默认预装常用技能包。来源为 skills 的项目会与 OpenClaw Skills 页面一致；来源为 plugins 的项目在 Plugins/Channels 页面显示。
            </div>
            {utilSkills?.success === false && (
              <div className="text-[10px] text-rose-600 break-words">❌ 获取失败：{String(utilSkills?.error || 'unknown')}</div>
            )}
            {Array.isArray(utilSkills?.skills) &&
              utilSkills.skills.map((s: any) => (
                <div key={String(s?.id || Math.random())} className="rounded-xl border border-slate-200 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-[11px] font-black text-slate-800 truncate">{String(s?.name || s?.id || '')}</div>
                      <div className="text-[10px] text-slate-500 truncate">
                        {s?.source === 'plugins' ? '插件来源' : '技能来源'}
                        {' · '}
                        {s?.installed ? '已安装' : '未安装'}
                        {s?.status ? ` · ${String(s.status)}` : ''}
                      </div>
                      {s?.error ? <div className="text-[10px] text-rose-600 truncate">{String(s.error)}</div> : null}
                    </div>
                    <div className="shrink-0 flex items-center gap-1">
                      <button
                        onClick={() => runUtilityAction('toggle', s)}
                        disabled={pluginsBusy || !s?.installed}
                        className={`px-2 py-1 rounded-lg text-[10px] font-black border transition-colors disabled:opacity-50 ${
                          s?.enabled
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                        title={s?.enabled ? '停用' : '启用'}
                      >
                        {s?.enabled ? 'ON' : 'OFF'}
                      </button>
                      <button
                        onClick={() => runUtilityAction('update', s)}
                        disabled={pluginsBusy || !s?.installed}
                        className="px-2 py-1 rounded-lg text-[10px] font-black border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                        title="更新并失败回退"
                      >
                        更新
                      </button>
                      <button
                        onClick={() => runUtilityAction('remove', s)}
                        disabled={pluginsBusy || !s?.installed}
                        className="px-2 py-1 rounded-lg text-[10px] font-black border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 disabled:opacity-50 inline-flex items-center"
                        title="删除"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                      {!s?.installed && (
                        <button
                          onClick={() => runUtilityAction('repair', s)}
                          disabled={pluginsBusy}
                          className="px-2 py-1 rounded-lg text-[10px] font-black border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
                        >
                          修复
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OpenClawWorkbench;
