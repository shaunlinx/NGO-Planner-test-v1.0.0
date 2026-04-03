import React, { useEffect, useMemo, useState } from 'react';
import { ExternalLink, FolderOpen, RefreshCw, Settings, Trash2 } from 'lucide-react';

type PluginRow = {
  id: string;
  name?: string;
  version?: string;
  description?: string;
  path?: string;
  enabled?: boolean;
  loaded?: boolean;
  status?: string;
  ui?: any;
};

type TabId = 'BuiltIn' | 'Plugins' | 'DigitalTwin';

interface ToolCenterProps {
  onOpenPlugin?: (pluginId: string) => void;
  onNavigateToModule?: (moduleId: string) => void;
}

const normalizePath = (value: string) => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '');
const joinPath = (...parts: Array<string | undefined | null>) => {
  const cleaned = parts
    .map((p) => normalizePath(String(p || '').trim()))
    .filter(Boolean);
  if (cleaned.length === 0) return '';
  const [head, ...rest] = cleaned;
  return `${head}${rest.length ? `/${rest.map((x) => x.replace(/^\/+/, '')).join('/')}` : ''}`;
};

const ToolCenter: React.FC<ToolCenterProps> = ({ onOpenPlugin, onNavigateToModule }) => {
  const api = (window as any).electronAPI;

  const [activeTab, setActiveTab] = useState<TabId>('BuiltIn');
  const [busy, setBusy] = useState(false);

  const [locations, setLocations] = useState<any>(null);
  const [plugins, setPlugins] = useState<PluginRow[]>([]);

  const [openclawStatus, setOpenclawStatus] = useState<any>(null);
  const [openclawManaged, setOpenclawManaged] = useState<any>(null);
  const [openclawSecurity, setOpenclawSecurity] = useState<any>(null);
  const [openclawBusy, setOpenclawBusy] = useState(false);
  const [openclawActionError, setOpenclawActionError] = useState('');
  const [openclawVer, setOpenclawVer] = useState('latest');
  const [openclawInstalling, setOpenclawInstalling] = useState(false);
  const [openclawInstallProgress, setOpenclawInstallProgress] = useState(0);
  const [openclawInstallMessage, setOpenclawInstallMessage] = useState('');

  const [claudeStatus, setClaudeStatus] = useState<any>(null);
  const [claudeManaged, setClaudeManaged] = useState<any>(null);
  const [claudeBusy, setClaudeBusy] = useState(false);
  const [claudeInstalling, setClaudeInstalling] = useState(false);
  const [claudeInstallProgress, setClaudeInstallProgress] = useState(0);
  const [claudeInstallMessage, setClaudeInstallMessage] = useState('');
  const [homePath, setHomePath] = useState('');
  const [toolhubPaths, setToolhubPaths] = useState<any>(null);

  const [digitalTwinResult, setDigitalTwinResult] = useState<any>(null);
  const [analyzingTwin, setAnalyzingTwin] = useState(false);

  const refreshPlugins = async () => {
    const market = api?.marketplace;
    if (!market) return;
    setBusy(true);
    try {
      const [locRes, pluginsRes] = await Promise.all([market.getLocations?.(), market.listPlugins?.()]);
      if (locRes?.success) setLocations(locRes.result);
      if (pluginsRes?.success) setPlugins(Array.isArray(pluginsRes.result) ? pluginsRes.result : []);
    } finally {
      setBusy(false);
    }
  };

  const refreshBuiltIn = async () => {
    const openclaw = api?.openclaw;
    const claude = api?.claudeCode;
    const toolhub = api?.toolhub;
    await Promise.all([
      (async () => {
        if (!openclaw) return;
        try {
          const [s, ms, sec] = await Promise.all([
            openclaw.getStatus?.(),
            openclaw.managed?.getStatus?.(),
            openclaw.security?.getStatus?.()
          ]);
          setOpenclawStatus(s || null);
          setOpenclawManaged(ms || null);
          setOpenclawSecurity(sec || null);
          const desired = ms && typeof ms.desiredVersion === 'string' ? ms.desiredVersion : '';
          if (desired) setOpenclawVer(desired);
        } catch (e: any) {}
      })(),
      (async () => {
        if (!claude) return;
        try {
          const [s, ms] = await Promise.all([claude.getStatus?.(), claude.managed?.getStatus?.()]);
          setClaudeStatus(s || null);
          setClaudeManaged(ms || null);
        } catch (e: any) {}
      })(),
      (async () => {
        if (!toolhub?.getPaths) return;
        try {
          const res = await toolhub.getPaths();
          if (res?.success) setToolhubPaths(res);
        } catch (e: any) {}
      })()
    ]);
  };

  useEffect(() => {
    refreshPlugins();
    const h = () => refreshPlugins();
    window.addEventListener('plugins-updated', h as any);
    return () => window.removeEventListener('plugins-updated', h as any);
  }, []);

  useEffect(() => {
    refreshBuiltIn();
  }, [activeTab]);

  useEffect(() => {
    (async () => {
      try {
        const p = await api?.getPath?.('home');
        if (typeof p === 'string' && p.trim()) setHomePath(p.trim());
      } catch (e) {}
    })();
  }, []);

  useEffect(() => {
    const off = api?.openclaw?.managed?.onProgress?.((payload: any) => {
      if (!payload) return;
      const p = payload?.progress !== undefined ? Number(payload.progress) : NaN;
      if (Number.isFinite(p)) setOpenclawInstallProgress(Math.max(0, Math.min(1, p)));
      const msg = String(payload?.message || payload?.step || '');
      if (msg) setOpenclawInstallMessage(msg);
      if (payload?.step === 'done') {
        setOpenclawInstalling(false);
        setOpenclawInstallMessage('✅ 完成');
        refreshBuiltIn();
      }
      if (payload?.step === 'error') {
        setOpenclawInstalling(false);
        setOpenclawInstallMessage('❌ 失败');
        refreshBuiltIn();
      }
    });
    return () => {
      try {
        if (typeof off === 'function') off();
      } catch (e) {}
    };
  }, []);

  useEffect(() => {
    const off = api?.claudeCode?.managed?.onProgress?.((payload: any) => {
      if (!payload) return;
      const p = payload?.progress !== undefined ? Number(payload.progress) : NaN;
      if (Number.isFinite(p)) setClaudeInstallProgress(Math.max(0, Math.min(1, p)));
      const msg = String(payload?.message || payload?.step || '');
      if (msg) setClaudeInstallMessage(msg);
      if (payload?.step === 'done') {
        setClaudeInstalling(false);
        setClaudeInstallMessage('✅ 完成');
        refreshBuiltIn();
      }
      if (payload?.step === 'error') {
        setClaudeInstalling(false);
        setClaudeInstallMessage('❌ 失败');
        refreshBuiltIn();
      }
    });
    return () => {
      try {
        if (typeof off === 'function') off();
      } catch (e) {}
    };
  }, []);

  const installLocalPlugin = async () => {
    const dir = await api?.fs?.selectFolder?.();
    if (!dir) return;
    const market = api?.marketplace;
    if (!market?.installPluginFromDir) return;
    setBusy(true);
    try {
      const res = await market.installPluginFromDir(dir);
      if (!res?.success) alert(`❌ 安装失败：${res?.error || 'Unknown error'}`);
      await refreshPlugins();
      window.dispatchEvent(new Event('plugins-updated'));
    } finally {
      setBusy(false);
    }
  };

  const togglePlugin = async (p: PluginRow) => {
    const market = api?.marketplace;
    if (!market?.setPluginEnabled) return;
    setBusy(true);
    try {
      const res = await market.setPluginEnabled(p.id, !p.enabled);
      if (!res?.success) alert(`❌ 操作失败：${res?.error || 'Unknown error'}`);
      await refreshPlugins();
      window.dispatchEvent(new Event('plugins-updated'));
    } finally {
      setBusy(false);
    }
  };

  const uninstallPlugin = async (p: PluginRow) => {
    const ok = confirm('确认卸载该插件？将删除插件目录。');
    if (!ok) return;
    const market = api?.marketplace;
    if (!market?.uninstallPlugin) return;
    setBusy(true);
    try {
      const res = await market.uninstallPlugin(p.id);
      if (!res?.success) alert(`❌ 卸载失败：${res?.error || 'Unknown error'}`);
      await refreshPlugins();
      window.dispatchEvent(new Event('plugins-updated'));
    } finally {
      setBusy(false);
    }
  };

  const openPath = async (p: string) => {
    try {
      await api?.shell?.openPath?.(p);
    } catch (e) {}
  };

  const runDigitalTwin = async () => {
    if (analyzingTwin) return;
    setAnalyzingTwin(true);
    try {
      const svc = api?.skillOrchestrator;
      if (!svc?.runAnalysis) return;
      const res = await svc.runAnalysis();
      if (res?.success) setDigitalTwinResult(res);
      else alert('分析失败：' + (res?.error || 'Unknown error'));
    } catch (e: any) {
      alert('分析失败：' + (e?.message || 'Unknown error'));
    } finally {
      setAnalyzingTwin(false);
    }
  };

  const openclawRunning = !!openclawStatus?.gateway?.running;
  const openclawInstalled = !!openclawStatus?.installed;
  const openclawManagedByApp = !!openclawStatus?.gateway?.managedByApp;
  const openclawInstalledVersion = openclawManaged?.installedMeta?.openclawVersionInstalled || openclawManaged?.installedMeta?.openclawVersion || '';

  const claudeEnabled = !!claudeStatus?.enabled;
  const claudeDetected = !!claudeStatus?.executableExists;
  const claudeInstalledPath = claudeStatus?.executablePath || claudeStatus?.configuredBin || '';
  const claudeInstallRoot = String(toolhubPaths?.claude?.installRoot || claudeManaged?.paths?.installRoot || claudeManaged?.installRoot || '').trim();
  const claudeStateHome = String(toolhubPaths?.claude?.stateHome || claudeManaged?.paths?.stateHome || claudeManaged?.stateHome || '').trim();
  const modelCenter = toolhubPaths?.modelCenter || null;
  const openclawStats = toolhubPaths?.openclaw?.stats || null;
  const claudeStats = toolhubPaths?.claude?.stats || null;

  const openclawFolders = useMemo(() => {
    const stateHome = String(toolhubPaths?.openclaw?.stateHome || openclawManaged?.stateHome || '').trim();
    const installRoot = String(toolhubPaths?.openclaw?.installRoot || openclawManaged?.installRoot || '').trim();
    const openclawRoot = String(toolhubPaths?.openclaw?.root || (stateHome ? joinPath(stateHome, '.openclaw') : '')).trim();
    const workspace = String(toolhubPaths?.openclaw?.workspace || (openclawRoot ? joinPath(openclawRoot, 'workspace') : '')).trim();
    const skills = workspace ? joinPath(workspace, 'skills') : '';
    const history = openclawRoot ? joinPath(openclawRoot, 'agents') : '';
    const extensions = openclawRoot ? joinPath(openclawRoot, 'extensions') : '';
    const configFile = openclawRoot ? joinPath(openclawRoot, 'openclaw.json') : '';
    return [
      { key: 'openclaw-install', label: 'OpenClaw 安装目录', path: installRoot },
      { key: 'openclaw-state', label: 'OpenClaw 状态目录', path: stateHome },
      { key: 'openclaw-workspace', label: 'OpenClaw 工作区', path: workspace },
      { key: 'openclaw-skills', label: 'OpenClaw Skills', path: String(toolhubPaths?.openclaw?.skills || skills).trim() },
      { key: 'openclaw-history', label: 'OpenClaw 历史会话', path: String(toolhubPaths?.openclaw?.history || history).trim() },
      { key: 'openclaw-extensions', label: 'OpenClaw MCP/扩展', path: String(toolhubPaths?.openclaw?.mcp || extensions).trim() },
      { key: 'openclaw-config', label: 'OpenClaw 配置文件', path: String(toolhubPaths?.openclaw?.configFile || configFile).trim() }
    ];
  }, [openclawManaged, toolhubPaths]);

  const claudeFolders = useMemo(() => {
    const globalClaudeDir = String(toolhubPaths?.claude?.globalRoot || (homePath ? joinPath(homePath, '.claude') : '')).trim();
    const globalSkills = globalClaudeDir ? joinPath(globalClaudeDir, 'skills') : '';
    const globalMcp = globalClaudeDir ? joinPath(globalClaudeDir, 'mcp') : '';
    return [
      { key: 'claude-install', label: 'Claude 托管安装目录', path: claudeInstallRoot },
      { key: 'claude-state', label: 'Claude 状态目录', path: claudeStateHome },
      { key: 'claude-global', label: 'Claude 全局目录', path: globalClaudeDir },
      { key: 'claude-skills', label: 'Claude Skills', path: String(toolhubPaths?.claude?.skills || globalSkills).trim() },
      { key: 'claude-mcp', label: 'Claude MCP', path: String(toolhubPaths?.claude?.mcp || globalMcp).trim() }
    ];
  }, [claudeInstallRoot, claudeStateHome, homePath, toolhubPaths]);

  const modelCenterText = useMemo(() => {
    const total = Number(modelCenter?.totalConfigured || 0);
    const ds = modelCenter?.deepseekConfigured ? 'DeepSeek✓' : 'DeepSeek×';
    const g = modelCenter?.googleConfigured ? 'Google✓' : 'Google×';
    const customEnabled = Number(modelCenter?.customEnabled || 0);
    const customConfigured = Number(modelCenter?.customConfigured || 0);
    return `模型中心：${ds} · ${g} · 自定义 ${customEnabled}/${customConfigured} · 合计 ${total}`;
  }, [modelCenter]);

  const canOpenUi = useMemo(
    () => (p: PluginRow) => !!p.enabled && !!p.ui && typeof (p.ui as any).entry === 'string' && String((p.ui as any).entry).trim(),
    []
  );
  const visiblePlugins = useMemo(
    () => (Array.isArray(plugins) ? plugins : []).filter((p) => !String(p?.id || '').toLowerCase().includes('openclaw')),
    [plugins]
  );

  return (
    <div className="h-full w-full flex flex-col bg-slate-50">
      <div className="p-5 border-b border-slate-200 bg-white flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-black text-slate-800 truncate">工具中心</div>
          <div className="text-[10px] text-slate-500 mt-1 truncate">内置工具管理 + 插件平台 + 数字分身</div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <div className="flex bg-slate-100 rounded-xl p-1">
            {([
              { id: 'BuiltIn', label: '内置工具' },
              { id: 'Plugins', label: '插件平台' },
              { id: 'DigitalTwin', label: '数字分身' }
            ] as Array<{ id: TabId; label: string }>).map((t) => (
              <button
                key={t.id}
                onClick={() => setActiveTab(t.id)}
                className={`px-3 py-2 rounded-lg text-[10px] font-black transition-colors ${
                  activeTab === t.id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => {
              if (activeTab === 'Plugins') refreshPlugins();
              else refreshBuiltIn();
            }}
            disabled={busy || claudeBusy}
            className="px-3 py-2 rounded-xl bg-white text-slate-700 text-xs font-black border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50"
            title="刷新"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar p-5 space-y-4">
        {activeTab === 'BuiltIn' && (
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white rounded-2xl p-4 border border-slate-200">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-black text-slate-800 truncate">OpenClaw</div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {openclawInstalled ? `已检测到 · ${openclawInstalledVersion || 'unknown'}` : '未检测到'}
                    {' · '}
                    {openclawRunning ? `运行中（${openclawStatus?.gateway?.port || '-'}）` : '未运行'}
                  </div>
                  {(openclawStatus?.lastError || '').trim() && (
                    <div className="mt-2 text-[10px] text-rose-600 break-words">{String(openclawStatus?.lastError || '')}</div>
                  )}
                  {openclawActionError && (
                    <div className="mt-2 text-[10px] text-rose-600 break-words">{openclawActionError}</div>
                  )}
                  <div className="mt-2 text-[10px] text-slate-500">
                    OpenClaw 采用单一路径：在本应用内直接打开其原生 Dashboard，安装/启停由系统统一自动处理。
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onNavigateToModule?.('OpenClaw')}
                    className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-[10px] font-black hover:bg-indigo-700 transition-colors"
                  >
                    打开 OpenClaw
                  </button>
                </div>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={async () => {
                    const root = String(openclawManaged?.installRoot || openclawManaged?.stateHome || '').trim();
                    if (root) await openPath(root);
                  }}
                  disabled={!openclawManaged?.installRoot && !openclawManaged?.stateHome}
                  className="px-3 py-2 rounded-xl bg-white text-slate-700 text-[10px] font-black border border-slate-200 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                >
                  <FolderOpen className="w-4 h-4" />
                  打开目录
                </button>
              </div>
            </div>

            <div className="bg-white rounded-2xl p-4 border border-slate-200">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-black text-slate-800 truncate">Claude Code</div>
                  <div className="text-[10px] text-slate-500 mt-1">
                    {claudeEnabled ? '已启用' : '未启用'}
                    {' · '}
                    {claudeDetected ? '已检测到可执行体' : '未检测到可执行体'}
                  </div>
                  {claudeInstalledPath && (
                    <div className="mt-2 text-[10px] text-slate-500 font-mono break-all">{String(claudeInstalledPath)}</div>
                  )}
                  {(claudeStatus?.lastError || '').trim() && (
                    <div className="mt-2 text-[10px] text-rose-600 break-words">{String(claudeStatus?.lastError || '')}</div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => onNavigateToModule?.('ClaudeCode')}
                    className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-[10px] font-black hover:bg-indigo-700 transition-colors"
                  >
                    打开终端
                  </button>
                  <button
                    onClick={async () => {
                      const root = claudeInstallRoot;
                      if (root) await openPath(root);
                    }}
                    disabled={!claudeInstallRoot}
                    className="px-3 py-2 rounded-lg bg-white text-slate-700 text-[10px] font-black border border-slate-200 hover:bg-slate-50 transition-colors disabled:opacity-50"
                    title="打开托管目录"
                  >
                    <FolderOpen className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4 grid grid-cols-3 gap-2">
                <button
                  onClick={async () => {
                    setClaudeBusy(true);
                    try {
                      await api?.claudeCode?.setEnabled?.(true);
                      await refreshBuiltIn();
                    } finally {
                      setClaudeBusy(false);
                    }
                  }}
                  disabled={claudeBusy}
                  className="py-2 rounded-xl bg-emerald-600 text-white text-[10px] font-black hover:bg-emerald-700 disabled:opacity-50"
                >
                  启用
                </button>
                <button
                  onClick={async () => {
                    setClaudeBusy(true);
                    try {
                      await api?.claudeCode?.setEnabled?.(false);
                      await refreshBuiltIn();
                    } finally {
                      setClaudeBusy(false);
                    }
                  }}
                  disabled={claudeBusy}
                  className="py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black hover:bg-black disabled:opacity-50"
                >
                  禁用
                </button>
                <button
                  onClick={() => onNavigateToModule?.('ClaudeCode')}
                  className="py-2 rounded-xl bg-white text-slate-700 text-[10px] font-black border border-slate-200 hover:bg-slate-50 inline-flex items-center justify-center gap-2"
                >
                  <Settings className="w-4 h-4" />
                  配置
                </button>
              </div>

              <div className="mt-4 flex items-center gap-2">
                <button
                  onClick={async () => {
                    setClaudeInstalling(true);
                    setClaudeInstallProgress(0);
                    setClaudeInstallMessage('准备中…');
                    try {
                      const res = await api?.claudeCode?.managed?.install?.({});
                      if (res?.success === false) {
                        setClaudeInstalling(false);
                        setClaudeInstallMessage('❌ 失败');
                        alert(`❌ 安装失败：${res?.error || 'Unknown error'}`);
                      }
                    } catch (e: any) {
                      setClaudeInstalling(false);
                      setClaudeInstallMessage('❌ 失败');
                      alert(`❌ 安装失败：${e?.message || 'Unknown error'}`);
                    }
                  }}
                  disabled={claudeInstalling}
                  className="flex-1 px-4 py-2 rounded-xl bg-indigo-600 text-white text-[10px] font-black hover:bg-indigo-700 disabled:opacity-50"
                >
                  安装/修复
                </button>
                <button
                  onClick={async () => {
                    const ok = confirm('确认卸载托管 Claude Code？');
                    if (!ok) return;
                    setClaudeInstalling(true);
                    setClaudeInstallProgress(0);
                    setClaudeInstallMessage('卸载中…');
                    try {
                      const res = await api?.claudeCode?.managed?.uninstall?.();
                      if (res?.success === false) alert(`❌ 卸载失败：${res?.error || 'Unknown error'}`);
                    } catch (e: any) {
                      alert(`❌ 卸载失败：${e?.message || 'Unknown error'}`);
                    } finally {
                      setClaudeInstalling(false);
                      await refreshBuiltIn();
                    }
                  }}
                  disabled={claudeInstalling}
                  className="px-3 py-2 rounded-xl bg-red-500/10 text-red-600 text-[10px] font-black hover:bg-red-500 hover:text-white transition-colors disabled:opacity-50"
                  title="卸载"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              {(claudeInstalling || claudeInstallMessage) && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[10px] text-slate-500">
                    <div className="font-black">进度</div>
                    <div className="font-mono">{Math.round(claudeInstallProgress * 100)}%</div>
                  </div>
                  <div className="mt-2 h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-600" style={{ width: `${Math.round(claudeInstallProgress * 100)}%` }} />
                  </div>
                  <div className="mt-2 text-[10px] text-slate-500">{claudeInstallMessage}</div>
                </div>
              )}
            </div>

            <div className="bg-white rounded-2xl p-4 border border-slate-200 col-span-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-black text-slate-800">Agent 目录中枢</div>
                  <div className="text-[10px] text-slate-500 mt-1">集中打开安装目录、状态目录、历史记录、Skills 与 MCP 相关目录。</div>
                  {!!modelCenter && <div className="text-[10px] text-slate-500 mt-2">{modelCenterText}</div>}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">OpenClaw</div>
                  {!!openclawStats && (
                    <div className="text-[10px] text-slate-500 mb-2">
                      工作区：{openclawStats.workspaceExists ? '已创建' : '未创建'} · Skills：{Number(openclawStats.skillsCount || 0)} · 历史：{Number(openclawStats.historyCount || 0)} · MCP：{Number(openclawStats.mcpCount || 0)} · 配置：{openclawStats.hasConfigFile ? '存在' : '不存在'}
                    </div>
                  )}
                  <div className="space-y-2">
                    {openclawFolders.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => item.path && openPath(item.path)}
                        disabled={!item.path}
                        className="w-full px-3 py-2 rounded-lg bg-white text-slate-700 text-[10px] font-black border border-slate-200 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center justify-between gap-2"
                        title={item.path || '路径不可用'}
                      >
                        <span className="truncate text-left">{item.label}</span>
                        <FolderOpen className="w-4 h-4 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">Claude Code</div>
                  {!!claudeStats && (
                    <div className="text-[10px] text-slate-500 mb-2">
                      全局目录：{claudeStats.globalExists ? '已创建' : '未创建'} · Skills：{Number(claudeStats.skillsCount || 0)} · MCP：{Number(claudeStats.mcpCount || 0)}
                    </div>
                  )}
                  <div className="space-y-2">
                    {claudeFolders.map((item) => (
                      <button
                        key={item.key}
                        onClick={() => item.path && openPath(item.path)}
                        disabled={!item.path}
                        className="w-full px-3 py-2 rounded-lg bg-white text-slate-700 text-[10px] font-black border border-slate-200 hover:bg-slate-50 disabled:opacity-50 inline-flex items-center justify-between gap-2"
                        title={item.path || '路径不可用'}
                      >
                        <span className="truncate text-left">{item.label}</span>
                        <FolderOpen className="w-4 h-4 shrink-0" />
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'Plugins' && (
          <div className="space-y-3">
            <div className="bg-white rounded-2xl p-4 border border-slate-200 flex items-center justify-between gap-3">
              <div className="text-[10px] text-slate-500">
                插件为可执行代码，建议仅安装可信来源。内置工具（OpenClaw/Claude Code）请在“内置工具”页管理。
              </div>
              <div className="flex gap-2 shrink-0">
                <button
                  onClick={installLocalPlugin}
                  disabled={busy}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black transition-all disabled:opacity-50"
                >
                  安装本地插件
                </button>
                <button
                  onClick={() => locations?.pluginsDir && openPath(locations.pluginsDir)}
                  disabled={busy || !locations?.pluginsDir}
                  className="px-4 py-2 rounded-xl bg-white text-slate-700 text-xs font-black border border-slate-200 hover:bg-slate-50 transition-all disabled:opacity-50"
                >
                  打开插件目录
                </button>
              </div>
            </div>

            {visiblePlugins.map((p) => (
              <div key={p.id} className="bg-white rounded-2xl p-4 border border-slate-200">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-black text-slate-800 truncate">
                      {p.name || p.id} <span className="text-[10px] text-slate-400 font-mono">{p.version || ''}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 break-words mt-1">{p.description || ''}</div>
                    <div className="text-[10px] font-mono text-slate-500 break-all mt-1">{p.path || ''}</div>
                    <div className="text-[10px] text-slate-400 mt-1">
                      状态：{p.enabled ? '已启用' : '未启用'} / {p.loaded ? '已加载' : '未加载'} / {p.status || 'unknown'}
                    </div>
                  </div>
                  <div className="flex flex-col gap-2 shrink-0">
                    <button
                      onClick={() => togglePlugin(p)}
                      disabled={busy}
                      className={`px-3 py-2 rounded-lg text-[10px] font-black transition-colors ${
                        p.enabled ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-green-50 text-green-700 hover:bg-green-100'
                      } disabled:opacity-50`}
                    >
                      {p.enabled ? '停用' : '启用'}
                    </button>
                    <button
                      onClick={() => p.path && openPath(p.path)}
                      className="px-3 py-2 rounded-lg bg-slate-100 text-slate-700 text-[10px] font-black hover:bg-slate-200 transition-colors"
                    >
                      打开目录
                    </button>
                    <button
                      onClick={() => onOpenPlugin?.(p.id)}
                      disabled={!canOpenUi(p)}
                      className="px-3 py-2 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-black hover:bg-indigo-100 transition-colors disabled:opacity-50"
                    >
                      打开插件页面
                    </button>
                    <button
                      onClick={() => uninstallPlugin(p)}
                      disabled={busy}
                      className="px-3 py-2 rounded-lg bg-red-500/10 text-red-600 hover:bg-red-500 hover:text-white text-[10px] font-black transition-colors disabled:opacity-50"
                    >
                      卸载
                    </button>
                  </div>
                </div>
              </div>
            ))}
            {visiblePlugins.length === 0 && <div className="text-xs text-slate-500">暂无已安装插件</div>}
          </div>
        )}

        {activeTab === 'DigitalTwin' && (
          <div className="bg-white rounded-2xl p-6 border border-slate-200">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-black text-slate-800">数字分身配置</div>
                <div className="text-[10px] text-slate-500 mt-1">基于日程、项目与知识库，生成可复用技能建议。</div>
              </div>
              <button
                onClick={runDigitalTwin}
                disabled={analyzingTwin}
                className={`px-5 py-2 rounded-xl text-white text-xs font-black transition-all ${
                  analyzingTwin ? 'bg-slate-400 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-700'
                }`}
              >
                {analyzingTwin ? '分析中…' : '一键生成'}
              </button>
            </div>

            {digitalTwinResult && (
              <div className="mt-6 space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                    <div className="text-2xl font-black text-indigo-600">{digitalTwinResult.context?.projects?.length || 0}</div>
                    <div className="text-[10px] font-black text-slate-400">活跃项目</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                    <div className="text-2xl font-black text-purple-600">{digitalTwinResult.context?.events?.length || 0}</div>
                    <div className="text-[10px] font-black text-slate-400">近期日程</div>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                    <div className="text-2xl font-black text-emerald-600">{digitalTwinResult.context?.recentArtifacts?.length || 0}</div>
                    <div className="text-[10px] font-black text-slate-400">最近资产</div>
                  </div>
                </div>

                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                  <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2">匹配技能</div>
                  <div className="space-y-2">
                    {(digitalTwinResult.matchedSkills || []).map((skill: any, idx: number) => (
                      <div key={idx} className="bg-white rounded-xl p-3 border border-slate-200">
                        <div className="text-xs font-black text-slate-800">{skill.name || 'Unnamed'}</div>
                        <div className="text-[10px] text-slate-500 mt-1">{skill.description || ''}</div>
                      </div>
                    ))}
                    {(Array.isArray(digitalTwinResult.matchedSkills) ? digitalTwinResult.matchedSkills.length : 0) === 0 && (
                      <div className="text-[10px] text-slate-500">未匹配到可用技能：建议先安装/启用插件或完善知识库挂载。</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ToolCenter;
