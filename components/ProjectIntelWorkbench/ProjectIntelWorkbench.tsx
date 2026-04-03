import React, { useEffect, useMemo, useRef, useState } from 'react';

type TabId = 'BROWSE' | 'AI_SEARCH' | 'DEVICE';

type ProjectIntelRun = {
  id: string;
  status?: string;
  mode?: string;
  urls?: string[];
  output_csv_path?: string;
  output_md_path?: string;
  output_html_path?: string;
  created_at?: number;
};

type ProjectIntelItem = {
  id: string;
  title?: string;
  url?: string;
  snippet?: string;
};

type ProjectIntelHighlight = {
  id: string;
  url?: string;
  title?: string;
  selected_text?: string;
  context_text?: string;
  tags?: string[];
};

type ProjectIntelOcrFrame = {
  id: string;
  url?: string;
  title?: string;
  image_path?: string;
  ocr_text?: string;
  created_at?: number;
};

type InterconnectJob = {
  id: string;
  status?: string;
  related_run_id?: string;
};

type InterconnectStep = {
  id: string;
  step_index: number;
  step_name: string;
  status: string;
  error?: string;
};

type BrowserState = {
  url?: string;
  title?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  mode?: string | null;
};

type BrowserBookmark = {
  id: string;
  url: string;
  title?: string;
  createdAt?: number;
};

const parseLines = (text: string) =>
  String(text || '')
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);

const encodeQueryUrl = (baseUrl: string, q: string) => {
  const base = String(baseUrl || '').trim() || 'https://www.baidu.com/s';
  try {
    const u = new URL(base);
    if (u.searchParams.has('wd')) u.searchParams.set('wd', q);
    else if (u.searchParams.has('q')) u.searchParams.set('q', q);
    else u.searchParams.set('wd', q);
    return u.toString();
  } catch (e) {
    return `https://www.baidu.com/s?wd=${encodeURIComponent(q)}`;
  }
};

const Icon = {
  Globe: () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a15 15 0 010 18M12 3a15 15 0 000 18" /></svg>,
  Spark: () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3l2.2 4.8L19 10l-4.8 2.2L12 17l-2.2-4.8L5 10l4.8-2.2L12 3z" /><path d="M19 16l.9 2 .1.1 2 .9-2 .9-.1.1-.9 2-.9-2-.1-.1-2-.9 2-.9.1-.1.9-2z" /></svg>,
  Device: () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="4" width="14" height="11" rx="2" /><path d="M8 20h4M10 15v5" /><rect x="18" y="8" width="3" height="8" rx="1" /></svg>,
  Search: () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.2-3.2" /></svg>,
  Play: () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>,
  Stop: () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg>,
  Capture: () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="6" width="18" height="14" rx="2" /><circle cx="12" cy="13" r="3.5" /><path d="M9 6l1-2h4l1 2" /></svg>,
  Export: () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 3v12" /><path d="M8 11l4 4 4-4" /><path d="M4 21h16" /></svg>,
  Link: () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10 13a5 5 0 007.1 0l2.8-2.8a5 5 0 00-7.1-7.1L11 4" /><path d="M14 11a5 5 0 00-7.1 0L4.1 13.8a5 5 0 107.1 7.1L13 19" /></svg>,
  Cog: () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1 1 0 00.2 1.1l.1.1a2 2 0 01-2.8 2.8l-.1-.1a1 1 0 00-1.1-.2 1 1 0 00-.6.9V21a2 2 0 01-4 0v-.1a1 1 0 00-.6-.9 1 1 0 00-1.1.2l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1 1 0 00.2-1.1 1 1 0 00-.9-.6H3a2 2 0 010-4h.1a1 1 0 00.9-.6 1 1 0 00-.2-1.1l-.1-.1a2 2 0 112.8-2.8l.1.1a1 1 0 001.1.2H8a1 1 0 00.6-.9V3a2 2 0 014 0v.1a1 1 0 00.6.9 1 1 0 001.1-.2l.1-.1a2 2 0 112.8 2.8l-.1.1a1 1 0 00-.2 1.1V8c0 .4.2.7.6.9H21a2 2 0 010 4h-.1a1 1 0 00-.9.6z" /></svg>,
  Logs: () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></svg>
  ,
  Home: () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 11.5l9-7 9 7" /><path d="M5 10.5V20h14v-9.5" /></svg>,
  Box: () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 7l9-4 9 4-9 4-9-4z" /><path d="M3 7v10l9 4 9-4V7" /></svg>,
  Translate: () => <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M4 5h10M9 5v2a8 8 0 01-5 7" /><path d="M5 14l4 5 4-5" /><path d="M14 9h6M17 9v10" /></svg>,
  Baidu: () => <div className="w-4 h-4 rounded-full bg-[#2563eb] text-white text-[9px] leading-4 text-center font-black">百</div>,
  Bing: () => <div className="w-4 h-4 rounded-full bg-[#0ea5a6] text-white text-[9px] leading-4 text-center font-black">B</div>,
  Google: () => <div className="w-4 h-4 rounded-full bg-[#ea4335] text-white text-[9px] leading-4 text-center font-black">G</div>
};

const ProjectIntelWorkbench: React.FC<{ overlayActive?: boolean }> = ({ overlayActive = false }) => {
  const projectIntel = (window as any).electronAPI?.projectIntel;
  const interconnect = (window as any).electronAPI?.interconnect;
  const shell = (window as any).electronAPI?.shell;

  const [tab, setTab] = useState<TabId>('BROWSE');
  const [statusLine, setStatusLine] = useState('');
  const [logs, setLogs] = useState<string[]>([]);

  const [runs, setRuns] = useState<ProjectIntelRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState('');
  const [items, setItems] = useState<ProjectIntelItem[]>([]);
  const [highlights, setHighlights] = useState<ProjectIntelHighlight[]>([]);
  const [ocrFrames, setOcrFrames] = useState<ProjectIntelOcrFrame[]>([]);
  const [browserState, setBrowserState] = useState<BrowserState | null>(null);
  const [browserAddress, setBrowserAddress] = useState('');
  const [bookmarks, setBookmarks] = useState<BrowserBookmark[]>([]);
  const [history, setHistory] = useState<BrowserBookmark[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  const [currentJobId, setCurrentJobId] = useState('');
  const [jobSteps, setJobSteps] = useState<InterconnectStep[]>([]);
  const [jobStatus, setJobStatus] = useState('');

  const [searchEngines, setSearchEngines] = useState<Array<{ id: string; name: string; url: string }>>([
    { id: 'baidu', name: '百度', url: 'https://www.baidu.com/s' },
    { id: 'bing', name: '必应', url: 'https://www.bing.com/search' },
    { id: 'google', name: 'Google', url: 'https://www.google.com/search' }
  ]);
  const [selectedEngineId, setSelectedEngineId] = useState('baidu');
  const [browseRunId, setBrowseRunId] = useState('');

  const [aiDemand, setAiDemand] = useState('');
  const [aiLinks] = useState('');
  const [workView, setWorkView] = useState<'EXEC' | 'RESULT'>('EXEC');
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [homeMode, setHomeMode] = useState(true);
  const [readingActive, setReadingActive] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [selectedHighlightIds, setSelectedHighlightIds] = useState<Set<string>>(new Set());
  const [selectedFrameIds, setSelectedFrameIds] = useState<Set<string>>(new Set());
  const execViewportRef = useRef<HTMLDivElement | null>(null);
  const [toolPos, setToolPos] = useState({ x: 16, y: 96 });
  const dragStartRef = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const TOOLBAR_W = 40;
  const TOOLBAR_H = 176;

  const selectedRun = useMemo(() => runs.find((r) => r.id === selectedRunId) || null, [runs, selectedRunId]);
  const selectedEngineUrl = useMemo(() => {
    const found = searchEngines.find((x) => x.id === selectedEngineId);
    return found?.url || searchEngines[0]?.url || 'https://www.baidu.com/s';
  }, [searchEngines, selectedEngineId]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem('projectIntel.searchEngines');
      const sid = localStorage.getItem('projectIntel.selectedEngineId');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) setSearchEngines(parsed);
      }
      if (sid) setSelectedEngineId(sid);
    } catch (e) {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('projectIntel.searchEngines', JSON.stringify(searchEngines));
      localStorage.setItem('projectIntel.selectedEngineId', selectedEngineId);
    } catch (e) {}
  }, [searchEngines, selectedEngineId]);
  const isEmbedTemporarilyHidden = workView === 'EXEC' && overlayActive;
  const isLandingEmpty = workView === 'EXEC' && (homeMode || !browserState?.url) && !isEmbedTemporarilyHidden;

  const appendLog = (text: string) => {
    const line = `${new Date().toLocaleTimeString()} ${text}`;
    setLogs((prev) => [line, ...prev].slice(0, 120));
  };

  const computeEmbedBounds = (rect: DOMRect) => {
    const rail = tab === 'BROWSE' && workView === 'EXEC' ? Math.max(56, Math.round(toolPos.x + TOOLBAR_W + 12)) : 0;
    const x = Math.max(0, Math.round(rect.left + rail));
    const y = Math.max(0, Math.round(rect.top));
    const width = Math.max(1, Math.round(rect.width - rail));
    const height = Math.max(1, Math.round(rect.height));
    return { x, y, width, height };
  };

  useEffect(() => {
    const el = execViewportRef.current;
    if (!el) return;
    const maxX = Math.max(8, el.clientWidth - TOOLBAR_W - 8);
    const maxY = Math.max(8, el.clientHeight - TOOLBAR_H - 8);
    setToolPos((prev) => ({
      x: Math.min(Math.max(8, prev.x), maxX),
      y: Math.min(Math.max(8, prev.y), maxY)
    }));
  }, [leftCollapsed, workView, tab, homeMode, overlayActive]);

  const syncEmbedBounds = async () => {
    if (!projectIntel?.setEmbedBounds) return;
    const el = execViewportRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    await projectIntel.setEmbedBounds(computeEmbedBounds(rect));
  };

  const refreshRuns = async () => {
    if (!projectIntel?.listRuns) return;
    const res = await projectIntel.listRuns(80);
    if (res?.success && Array.isArray(res.runs)) {
      setRuns(res.runs);
      if (!selectedRunId && res.runs[0]?.id) setSelectedRunId(res.runs[0].id);
    }
  };

  const refreshItems = async (runId: string) => {
    if (!projectIntel?.listItems || !runId) return;
    const res = await projectIntel.listItems(runId);
    if (res?.success && Array.isArray(res.items)) setItems(res.items);
  };

  const refreshCompanionData = async (runId: string) => {
    if (!runId) return;
    const tasks: Promise<any>[] = [];
    if (projectIntel?.listHighlights) tasks.push(projectIntel.listHighlights(runId));
    else tasks.push(Promise.resolve({ success: false }));
    if (projectIntel?.listOcrFrames) tasks.push(projectIntel.listOcrFrames(runId));
    else tasks.push(Promise.resolve({ success: false }));
    const [hRes, fRes] = await Promise.all(tasks);
    setHighlights(Array.isArray(hRes?.highlights) ? hRes.highlights : []);
    setOcrFrames(Array.isArray(fRes?.frames) ? fRes.frames : []);
  };

  const refreshBrowserData = async () => {
    if (!projectIntel) return;
    if (projectIntel.getBrowserState) {
      const stateRes = await projectIntel.getBrowserState();
      const st = stateRes?.state || null;
      setBrowserState(st);
      if (st?.url) setBrowserAddress(st.url);
    }
    if (projectIntel.listBookmarks) {
      const bRes = await projectIntel.listBookmarks();
      setBookmarks(Array.isArray(bRes?.bookmarks) ? bRes.bookmarks : []);
    }
    if (projectIntel.listBrowserHistory) {
      const hRes = await projectIntel.listBrowserHistory(80);
      setHistory(Array.isArray(hRes?.history) ? hRes.history : []);
    }
  };

  const refreshJob = async (jobId: string) => {
    if (!jobId || !interconnect?.getJob || !interconnect?.listSteps) return;
    const [jobRes, stepsRes] = await Promise.all([interconnect.getJob(jobId), interconnect.listSteps(jobId)]);
    const job = jobRes?.job as InterconnectJob | undefined;
    if (job) {
      setJobStatus(String(job.status || ''));
      if (job.related_run_id) {
        setSelectedRunId(job.related_run_id);
        await refreshRuns();
        await refreshItems(job.related_run_id);
        await refreshCompanionData(job.related_run_id);
      }
    }
    if (stepsRes?.success && Array.isArray(stepsRes.steps)) setJobSteps(stepsRes.steps);
  };

  const ensureRun = async (mode: string, urlSeed?: string) => {
    if (selectedRunId) return selectedRunId;
    if (!projectIntel?.createRun) return '';
    const urls = urlSeed ? [urlSeed] : [];
    const created = await projectIntel.createRun({ mode, userQuery: mode, urls, keywords: [], plan: {} });
    if (!created?.success || !created.runId) return '';
    setSelectedRunId(created.runId);
    await refreshRuns();
    return created.runId;
  };

  useEffect(() => {
    refreshRuns();
    refreshBrowserData();
  }, []);

  useEffect(() => {
    if (!selectedRunId) return;
    refreshItems(selectedRunId);
    refreshCompanionData(selectedRunId);
  }, [selectedRunId]);

  useEffect(() => {
    if (!projectIntel?.onUpdate) return;
    const off = projectIntel.onUpdate((data: any) => {
      if (!data) return;
      if (data.type === 'run_progress') {
        setStatusLine(`抓取中：${data.done}/${data.total}`);
      } else if (data.type === 'run_finished') {
        setStatusLine(`抓取完成：${data.status || ''}`);
        appendLog(`采集结束：${data.status || ''}`);
        refreshRuns();
        if (selectedRunId) refreshItems(selectedRunId);
        if (selectedRunId) refreshCompanionData(selectedRunId);
      } else if (data.type === 'run_error') {
        setStatusLine(`抓取失败：${data.error || ''}`);
        appendLog(`采集失败：${data.error || ''}`);
      } else if (data.type === 'login_required') {
        setStatusLine('需要登录，请在浏览器窗口登录后继续');
        appendLog('需要登录，已打开浏览器');
      } else if (data.type === 'browser_fail') {
        setStatusLine(`页面加载失败：${data.errorDescription || ''}`);
        appendLog(`浏览器失败：${data.errorDescription || ''}`);
      } else if (data.type === 'browser_loading_interrupted') {
        appendLog('页面跳转中断（继续加载后续页面）');
      } else if (data.type === 'browser_loaded' || data.type === 'browser_navigate' || data.type === 'browser_navigate_in_page') {
        refreshBrowserData();
      } else if (data.type === 'browser_embed_fail') {
        setStatusLine('内嵌浏览启动失败，请重试');
        appendLog(`内嵌浏览失败：${data.error || ''}`);
      } else if (data.type === 'export_ready') {
        setStatusLine('报告已生成');
        appendLog('报告已生成');
        if (selectedRunId) refreshRuns();
      } else if (data.type === 'highlight_saved') {
        appendLog('已记录划线内容');
        if (selectedRunId) refreshCompanionData(selectedRunId);
      } else if (data.type === 'ocr_frame') {
        appendLog('已采集 OCR 片段');
        if (selectedRunId) refreshCompanionData(selectedRunId);
      } else if (data.type === 'reading_item_saved') {
        appendLog('已保存页面文本快照');
        if (selectedRunId) refreshItems(selectedRunId);
      }
    });
    return () => {
      try {
        if (typeof off === 'function') off();
        else projectIntel.offUpdate();
      } catch (e) {}
    };
  }, [projectIntel, selectedRunId]);

  useEffect(() => {
    if (!interconnect?.onUpdate || !interconnect?.getJob) return;
    const off = interconnect.onUpdate(async (event: any) => {
      if (!event) return;
      if (event.type === 'job_started') {
        setCurrentJobId(event.jobId || '');
        setJobStatus('running');
        setStatusLine('AI检索任务已启动');
        appendLog(`任务启动：${event.jobId || ''}`);
      } else if (event.type === 'step_running') {
        appendLog(`执行步骤：${event.name || ''}`);
      } else if (event.type === 'step_done') {
        appendLog(`步骤完成：${event.name || ''}`);
      } else if (event.type === 'job_finished') {
        setJobStatus(event.status || '');
        setStatusLine(event.status === 'completed' ? 'AI检索完成' : `任务结束：${event.status || ''}`);
        appendLog(`任务结束：${event.status || ''}${event.error ? `（${event.error}）` : ''}`);
        await refreshJob(event.jobId);
      }
    });
    return () => {
      try {
        if (typeof off === 'function') off();
        else interconnect.offUpdate();
      } catch (e) {}
    };
  }, [interconnect]);

  useEffect(() => {
    const updateBounds = async () => {
      if (!projectIntel?.setEmbedBounds || !projectIntel?.hideEmbed) return;
      if (workView !== 'EXEC' || tab === 'DEVICE' || overlayActive) {
        await projectIntel.hideEmbed();
        return;
      }
      const el = execViewportRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      await projectIntel.setEmbedBounds(computeEmbedBounds(rect));
    };
    updateBounds().catch(() => {});
    const onResize = () => updateBounds().catch(() => {});
    window.addEventListener('resize', onResize);
    const el = execViewportRef.current;
    let ro: ResizeObserver | null = null;
    if (el && typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(() => {
        updateBounds().catch(() => {});
      });
      ro.observe(el);
    }
    return () => {
      window.removeEventListener('resize', onResize);
      if (ro) ro.disconnect();
    };
  }, [workView, tab, projectIntel, selectedRunId, leftCollapsed, overlayActive, isLandingEmpty, toolPos.x]);

  useEffect(() => {
    return () => {
      try {
        projectIntel?.hideEmbed?.();
      } catch (e) {}
    };
  }, [projectIntel]);

  useEffect(() => {
    if (!currentJobId) return;
    if (jobStatus !== 'running' && jobStatus !== 'created') return;
    const timer = setInterval(() => {
      refreshJob(currentJobId);
    }, 1800);
    return () => clearInterval(timer);
  }, [currentJobId, jobStatus]);

  const handleBrowseSearch = async () => {
    if (!projectIntel?.openBrowser) return;
    try {
      const q = String(browserAddress || '').trim();
      const maybeUrl = /^https?:\/\//i.test(q) || /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(q);
      const url = q ? (maybeUrl ? (q.includes('://') ? q : `https://${q}`) : encodeQueryUrl(selectedEngineUrl, q)) : selectedEngineUrl;
      const rid = browseRunId || selectedRunId || (await ensureRun('browse', url));
      if (rid && !browseRunId) setBrowseRunId(rid);
      const opened = await projectIntel.openBrowser({ url, runId: rid || null, sessionScope: 'global', embed: true });
      if (!opened?.success) {
        setStatusLine(`内嵌浏览失败：${opened?.error || ''}`);
        appendLog(`打开失败：${opened?.error || ''}`);
        return;
      }
      setHomeMode(false);
      setWorkView('EXEC');
      await syncEmbedBounds();
      await refreshBrowserData();
      setStatusLine('已在内嵌窗口打开');
      appendLog(`打开浏览：${url}`);
    } catch (e: any) {
      setStatusLine(`搜索异常：${e?.message || 'unknown error'}`);
    }
  };

  const handleStartCompanion = async () => {
    if (!projectIntel?.startReading || !projectIntel?.openBrowser) return;
    const rid = browseRunId || selectedRunId || (await ensureRun('browse_companion', selectedEngineUrl));
    if (!rid) {
      setStatusLine('无法创建采集任务');
      return;
    }
    setBrowseRunId(rid);
    const opened = await projectIntel.openBrowser({ url: selectedEngineUrl, runId: rid, sessionScope: 'global', embed: true });
    if (!opened?.success) {
      setStatusLine(`内嵌浏览失败：${opened?.error || ''}`);
      appendLog(`打开失败：${opened?.error || ''}`);
      return;
    }
    await syncEmbedBounds();
    const res = await projectIntel.startReading({ runId: rid, intervalMs: 7000, enableOcr: true });
    if (res?.success) {
      setHomeMode(false);
      setReadingActive(true);
      setStatusLine('伴随采集已开启');
      appendLog('伴随采集已开启');
    } else {
      setStatusLine(`开启失败：${res?.error || ''}`);
    }
  };

  const handleStopCompanion = async () => {
    if (!projectIntel?.stopReading) return;
    await projectIntel.stopReading(browseRunId || selectedRunId || null);
    setReadingActive(false);
    setStatusLine('伴随采集已停止，正在生成可编辑报告');
    appendLog('伴随采集已停止');
  };

  const handleCaptureCurrentPage = async () => {
    if (!projectIntel?.captureCurrentPage) return;
    const rid = browseRunId || selectedRunId || (await ensureRun('browse_capture', selectedEngineUrl));
    if (!rid) {
      setStatusLine('无法创建采集任务');
      return;
    }
    setBrowseRunId(rid);
    setSelectedRunId(rid);
    const res = await projectIntel.captureCurrentPage(rid);
    if (!res?.success) {
      setStatusLine(`抓取失败：${res?.error || ''}`);
      return;
    }
    await refreshItems(rid);
    await refreshCompanionData(rid);
    await refreshRuns();
    setStatusLine('当前页已保存为可编辑文本');
    appendLog('手动保存当前页成功');
    setHomeMode(false);
  };

  const handleStartAiSearch = async () => {
    if (!interconnect?.createJob || !interconnect?.runJob) return;
    const demand = String(aiDemand || browserAddress || '').trim();
    const linksList = parseLines(aiLinks).slice(0, 80);
    if (!demand && linksList.length === 0) {
      setStatusLine('请输入检索需求或链接');
      return;
    }

    const payload =
      linksList.length > 0
        ? {
            templateId: 'social_link_intel',
            taskName: demand || 'AI检索任务',
            linksText: linksList.join('\n'),
            analysisGoal: demand || '提炼核心观点、风险、机会',
            extraSkills: ''
          }
        : {
            templateId: 'social_topic_monitor',
            taskName: demand || 'AI检索任务',
            keyword: demand,
            platformHints: '小红书、抖音、公众号',
            days: 7,
            extraSkills: ''
          };

    const created = await interconnect.createJob(payload);
    if (!created?.success) {
      setStatusLine(`创建失败：${created?.error || ''}`);
      return;
    }
    setCurrentJobId(created.jobId);
    setJobStatus('created');
    setStatusLine('任务已创建，开始执行');
    appendLog(`任务创建：${created.jobId}`);
    const res = await interconnect.runJob(created.jobId);
    if (!res?.success) {
      setStatusLine(`启动失败：${res?.error || ''}`);
      appendLog(`任务启动失败：${res?.error || ''}`);
    }
  };

  const handleStopAiSearch = async () => {
    if (!currentJobId || !interconnect?.stopJob) return;
    await interconnect.stopJob(currentJobId);
    setStatusLine('已请求停止任务');
    appendLog('请求停止任务');
  };

  const handleExport = async () => {
    if (!projectIntel?.exportRun || !selectedRunId) return;
    const res = await projectIntel.exportRun(selectedRunId);
    if (!res?.success) {
      setStatusLine(`导出失败：${res?.error || ''}`);
      return;
    }
    setStatusLine('报告已导出');
    await refreshRuns();
  };

  const handleOpenPath = async (p?: string) => {
    if (!p) return;
    if (shell?.showItemInFolder) await shell.showItemInFolder(p);
    else if (shell?.openPath) await shell.openPath(p);
  };

  const handleUpdateItem = async (itemId: string, patch: Partial<ProjectIntelItem>) => {
    if (!projectIntel?.updateItem) return;
    const updates: any = {};
    if (patch.title !== undefined) updates.title = patch.title;
    if (patch.url !== undefined) updates.url = patch.url;
    if (patch.snippet !== undefined) updates.snippet = patch.snippet;
    const res = await projectIntel.updateItem(itemId, updates);
    if (res?.success) setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, ...patch } : it)));
  };

  const handleBrowserNav = async (action: string, payload?: any) => {
    if (!projectIntel?.browserNavigate) return;
    const res = await projectIntel.browserNavigate(action, payload || {});
    if (!res?.success) {
      setStatusLine(`操作失败：${res?.error || ''}`);
      return;
    }
    if (action === 'open' || action === 'search' || action === 'back' || action === 'forward' || action === 'reload' || action === 'translate') {
      setHomeMode(false);
      setWorkView('EXEC');
    }
    setTimeout(() => {
      refreshBrowserData();
    }, 120);
  };

  const handleAddressSubmit = async () => {
    const q = String(browserAddress || '').trim();
    if (!q) return;
    const maybeUrl = /^https?:\/\//i.test(q) || /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(q);
    if (!browserState?.url) {
      await handleBrowseSearch();
      return;
    }
    if (maybeUrl) await handleBrowserNav('open', { url: q.includes('://') ? q : `https://${q}` });
    else await handleBrowserNav('search', { query: q, engine: selectedEngineUrl });
  };

  const handleGoHome = async () => {
    setHomeMode(true);
    setWorkView('EXEC');
    setTab('BROWSE');
  };

  const handleTranslate = async () => {
    if (!browserState?.url) {
      const q = String(browserAddress || '').trim();
      if (!q) return;
      await handleAddressSubmit();
      setTimeout(() => {
        handleBrowserNav('translate').catch(() => {});
      }, 160);
      return;
    }
    await handleBrowserNav('translate');
  };

  const handleToggleCompanion = async () => {
    if (readingActive) await handleStopCompanion();
    else await handleStartCompanion();
  };

  const handleToggleAi = async () => {
    if (currentJobId && (jobStatus === 'running' || jobStatus === 'created')) await handleStopAiSearch();
    else await handleStartAiSearch();
    setTab('AI_SEARCH');
  };

  const handlePickEngine = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!projectIntel?.showEngineMenu) return;
    const rect = (e.currentTarget as HTMLButtonElement).getBoundingClientRect();
    const res = await projectIntel.showEngineMenu({
      engines: searchEngines,
      selectedId: selectedEngineId,
      x: Math.round(rect.left),
      y: Math.round(rect.bottom + 4)
    });
    if (res?.success && res?.id === '__add__') {
      const name = window.prompt('输入搜索引擎名称');
      if (!name) return;
      const url = window.prompt('输入搜索引擎地址（例如 https://www.google.com/search?q=）');
      if (!url) return;
      const id = `custom_${Date.now()}`;
      setSearchEngines((prev) => [{ id, name: String(name).trim(), url: String(url).trim() }, ...prev].slice(0, 30));
      setSelectedEngineId(id);
      return;
    }
    if (res?.success && res?.id) setSelectedEngineId(String(res.id));
  };

  const handleDeleteCapture = async (type: 'item' | 'highlight' | 'frame', all = false) => {
    if (!projectIntel?.deleteCaptureRecords || !selectedRunId) return;
    const ids =
      type === 'item'
        ? Array.from(selectedItemIds)
        : type === 'highlight'
        ? Array.from(selectedHighlightIds)
        : Array.from(selectedFrameIds);
    const res = await projectIntel.deleteCaptureRecords({ runId: selectedRunId, type, ids, all });
    if (!res?.success) {
      setStatusLine(`删除失败：${res?.error || ''}`);
      return;
    }
    if (type === 'item') setSelectedItemIds(new Set());
    if (type === 'highlight') setSelectedHighlightIds(new Set());
    if (type === 'frame') setSelectedFrameIds(new Set());
    await refreshItems(selectedRunId);
    await refreshCompanionData(selectedRunId);
    setStatusLine(`已删除 ${res?.deleted || 0} 条`);
  };

  const handleImportToKb = async () => {
    if (!projectIntel?.importCaptureToKb || !selectedRunId) return;
    const ids = Array.from(selectedItemIds);
    const res = await projectIntel.importCaptureToKb({ runId: selectedRunId, itemIds: ids });
    if (!res?.success) {
      setStatusLine(`入库失败：${res?.error || ''}`);
      return;
    }
    setStatusLine(`已汇入知识库：${res?.count || 0} 条`);
  };

  const handleToolbarMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    dragStartRef.current = { x: e.clientX, y: e.clientY, ox: toolPos.x, oy: toolPos.y };
    const onMove = (ev: MouseEvent) => {
      const s = dragStartRef.current;
      if (!s) return;
      const el = execViewportRef.current;
      const maxX = Math.max(8, (el?.clientWidth || 1200) - TOOLBAR_W - 8);
      const maxY = Math.max(8, (el?.clientHeight || 800) - TOOLBAR_H - 8);
      const nx = Math.min(maxX, Math.max(8, s.ox + (ev.clientX - s.x)));
      const ny = Math.min(maxY, Math.max(8, s.oy + (ev.clientY - s.y)));
      setToolPos({ x: nx, y: ny });
    };
    const onUp = () => {
      dragStartRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div className="h-full bg-slate-50 p-4 overflow-hidden">
      <div className="h-full max-w-[1700px] mx-auto bg-white border border-slate-200 rounded-3xl shadow-sm overflow-hidden flex flex-col">
        <div className="shrink-0 px-4 py-2 border-b border-slate-100 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0 flex-1 relative">
            {leftCollapsed ? (
              <button onClick={() => setLeftCollapsed(false)} className="h-8 w-8 rounded-lg border border-slate-200 text-slate-600 flex items-center justify-center">≡</button>
            ) : null}
            <div className="relative">
              <button
                onClick={() => handleBrowserNav('back')}
                className="absolute left-1 top-1 h-6 w-6 rounded-md border border-slate-200 bg-white text-slate-600 flex items-center justify-center disabled:opacity-40"
                disabled={!browserState?.canGoBack}
              >
                <span className="text-[11px]">←</span>
              </button>
              <button
                onClick={() => handleBrowserNav('forward')}
                className="absolute left-8 top-1 h-6 w-6 rounded-md border border-slate-200 bg-white text-slate-600 flex items-center justify-center disabled:opacity-40"
                disabled={!browserState?.canGoForward}
              >
                <span className="text-[11px]">→</span>
              </button>
              <button onClick={() => handleBrowserNav('reload')} className="absolute left-[60px] top-1 h-6 w-6 rounded-md border border-slate-200 bg-white text-slate-600 flex items-center justify-center">
                <span className="text-[11px]">↻</span>
              </button>
              <button title="搜索引擎" onClick={handlePickEngine} className="absolute left-[86px] top-1 h-6 w-6 rounded-md border border-slate-200 bg-white text-slate-700 flex items-center justify-center">
                {selectedEngineId === 'baidu' ? <Icon.Baidu /> : selectedEngineId === 'bing' ? <Icon.Bing /> : selectedEngineId === 'google' ? <Icon.Google /> : <Icon.Globe />}
              </button>
              <input
                value={browserAddress}
                onChange={(e) => setBrowserAddress(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddressSubmit();
                }}
                className="w-[min(42vw,500px)] min-w-[260px] bg-slate-50 border border-slate-200 rounded-lg pl-[120px] pr-3 py-1.5 text-xs font-bold outline-none"
                placeholder="输入网址或关键词"
              />
            </div>
            <button title="前往" onClick={handleAddressSubmit} className="h-8 w-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center">
              <Icon.Search />
            </button>
            <button title="收藏当前页" onClick={async () => { await projectIntel?.addBookmark?.({ url: browserState?.url, title: browserState?.title }); await refreshBrowserData(); }} className="h-8 w-8 rounded-lg border border-slate-200 text-slate-700 flex items-center justify-center">
              ★
            </button>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button title={readingActive ? '停止采集' : '开始采集'} onClick={handleToggleCompanion} className={`h-8 w-8 rounded-lg ${readingActive ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'} flex items-center justify-center`}>
              {readingActive ? <Icon.Stop /> : <Icon.Play />}
            </button>
            <button title={currentJobId && (jobStatus === 'running' || jobStatus === 'created') ? '停止AI检索' : '开始AI检索'} onClick={handleToggleAi} className={`h-8 w-8 rounded-lg border ${currentJobId && (jobStatus === 'running' || jobStatus === 'created') ? 'border-rose-300 text-rose-600' : 'border-slate-200 text-slate-700'} flex items-center justify-center`}>
              <Icon.Spark />
            </button>
            <div className="flex items-center rounded-full border border-slate-200 bg-slate-100 p-1">
              {[
                { id: 'BROWSE', icon: <Icon.Globe />, title: '实时浏览辅助' },
                { id: 'AI_SEARCH', icon: <Icon.Spark />, title: 'AI自动检索' },
                { id: 'DEVICE', icon: <Icon.Device />, title: '设备同步（预留）' }
              ].map((x) => (
                <button key={x.id} title={x.title} onClick={() => setTab(x.id as TabId)} className={`h-6 w-6 rounded-full flex items-center justify-center ${tab === (x.id as TabId) ? 'bg-indigo-600 text-white' : 'text-slate-600'}`}>
                  {x.icon}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="flex-1 min-h-0 flex">
          <div className={`${leftCollapsed ? 'w-0 p-0 border-r-0 overflow-hidden' : 'w-[280px] p-3 border-r border-slate-100 overflow-auto'} shrink-0 custom-scrollbar transition-all`}>
            {!leftCollapsed ? <button onClick={() => setLeftCollapsed((v) => !v)} className="h-8 w-8 rounded-lg border border-slate-200 text-slate-600 mb-3">≡</button> : null}
            {!leftCollapsed ? (
              <div className="space-y-4">
                <div className="border-t border-slate-100 pt-3">
                  <div className="text-[11px] font-black text-slate-500 mb-2 inline-flex items-center gap-1"><span>★</span><span>收藏</span></div>
                  <div className="space-y-1 max-h-24 overflow-auto custom-scrollbar">
                    {bookmarks.slice(0, 20).map((b) => (
                      <div key={b.id} className="flex items-center justify-between gap-2">
                        <button onClick={() => handleBrowserNav('open', { url: b.url })} className="text-[11px] text-left text-slate-700 truncate">{b.title || b.url}</button>
                        <button onClick={async () => { await projectIntel?.removeBookmark?.(b.id); await refreshBrowserData(); }} className="text-[10px] text-rose-500">删</button>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-100 pt-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-[11px] font-black text-slate-500 inline-flex items-center gap-1"><Icon.Logs /><span>浏览历史</span></div>
                    <button onClick={() => setShowHistory((v) => !v)} className="text-[10px] text-slate-500 inline-flex items-center gap-1"><span>{showHistory ? '收起' : '展开'}</span></button>
                  </div>
                  {showHistory ? (
                    <div className="space-y-1 max-h-28 overflow-auto custom-scrollbar">
                      {history.slice(0, 40).map((h) => (
                        <button key={h.id} onClick={() => handleBrowserNav('open', { url: h.url })} className="block w-full text-left text-[11px] text-slate-700 truncate">
                          {h.title || h.url}
                        </button>
                      ))}
                      <button onClick={async () => { await projectIntel?.clearBrowserHistory?.(); await refreshBrowserData(); }} className="text-[10px] text-rose-500">清空历史</button>
                    </div>
                  ) : null}
                </div>

                <div className="border-t border-slate-100 pt-3">
                  <div className="text-[11px] font-black text-slate-500 mb-2 inline-flex items-center gap-1"><Icon.Capture /><span>采集信息管理</span></div>
                  <div className="flex gap-2 mb-2">
                    <button title="删选中" onClick={() => handleDeleteCapture('item', false)} className="h-7 w-7 rounded border border-slate-200 text-[10px]">删</button>
                    <button title="清空" onClick={() => handleDeleteCapture('item', true)} className="h-7 w-7 rounded border border-slate-200 text-[10px]">空</button>
                    <button title="入库" onClick={handleImportToKb} className="h-7 w-7 rounded bg-indigo-600 text-white text-[10px]">入</button>
                  </div>
                  <div className="max-h-24 overflow-auto custom-scrollbar space-y-1">
                    {items.slice(0, 40).map((it) => (
                      <label key={it.id} className="flex items-center gap-2 text-[11px] text-slate-700">
                        <input type="checkbox" checked={selectedItemIds.has(it.id)} onChange={(e) => setSelectedItemIds((prev) => { const n = new Set(prev); if (e.target.checked) n.add(it.id); else n.delete(it.id); return n; })} />
                        <span className="truncate">{it.title || it.url || it.id}</span>
                      </label>
                    ))}
                  </div>
                  <div className="mt-2 text-[10px] text-slate-500">划线 {highlights.length} / OCR {ocrFrames.length}</div>
                </div>

                <div className="border-t border-slate-100 pt-3">
                  <button onClick={() => setShowTimeline((v) => !v)} className="text-[10px] font-black text-slate-500 inline-flex items-center gap-1"><Icon.Logs />{showTimeline ? '收起反馈' : '展开反馈'}</button>
                  {showTimeline ? (
                    <div className="mt-2 max-h-24 overflow-auto custom-scrollbar space-y-1">
                      {jobSteps.slice(0, 8).map((s) => (
                        <div key={s.id} className="text-[10px] text-slate-700">{s.step_index}. {s.step_name} · {s.status}</div>
                      ))}
                      {logs.slice(0, 6).map((l, i) => (
                        <div key={`${l}-${i}`} className="text-[10px] text-slate-500">{l}</div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex-1 min-h-0 p-3">
            <div className="h-full border border-slate-200 rounded-2xl overflow-hidden relative">
              {tab === 'AI_SEARCH' ? (
                <div className="h-full grid grid-cols-[320px_1fr]">
                  <div className="border-r border-slate-200 p-3 overflow-auto custom-scrollbar">
                    <div className="text-xs font-black text-slate-600 mb-2">执行进程</div>
                    <div className="space-y-1">
                      {jobSteps.map((s) => (
                        <div key={s.id} className="text-[11px] bg-slate-50 border border-slate-200 rounded-lg px-2 py-1">
                          {s.step_index}. {s.step_name} · {s.status}
                        </div>
                      ))}
                      {jobSteps.length === 0 ? <div className="text-[11px] text-slate-500">暂无执行进程</div> : null}
                    </div>
                  </div>
                  <div className="p-3 overflow-auto custom-scrollbar">
                    <div className="text-xs font-black text-slate-600 mb-2">执行产物仓库（万物互联）</div>
                    <div className="flex items-center gap-2 mb-2">
                      {selectedRun?.output_html_path ? <button onClick={() => handleOpenPath(selectedRun.output_html_path)} className="text-xs font-black text-indigo-600">报告</button> : null}
                      {selectedRun?.output_csv_path ? <button onClick={() => handleOpenPath(selectedRun.output_csv_path)} className="text-xs font-black text-slate-600">表格</button> : null}
                      {selectedRun?.output_md_path ? <button onClick={() => handleOpenPath(selectedRun.output_md_path)} className="text-xs font-black text-slate-600">Markdown</button> : null}
                    </div>
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-slate-100 text-slate-500 bg-white sticky top-0">
                          <th className="text-left font-black py-2 pr-2 pl-2">标题</th>
                          <th className="text-left font-black py-2 pr-2">链接</th>
                          <th className="text-left font-black py-2 pr-2">摘要</th>
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((it) => (
                          <tr key={it.id} className="border-b border-slate-100">
                            <td className="py-2 pr-2 pl-2 min-w-[220px] align-top"><input value={it.title || ''} onChange={(e) => handleUpdateItem(it.id, { title: e.target.value })} className="w-full bg-slate-50 border border-slate-100 rounded-lg px-2 py-1 font-bold outline-none" /></td>
                            <td className="py-2 pr-2 min-w-[260px] align-top"><input value={it.url || ''} onChange={(e) => handleUpdateItem(it.id, { url: e.target.value })} className="w-full bg-slate-50 border border-slate-100 rounded-lg px-2 py-1 font-bold outline-none" /></td>
                            <td className="py-2 pr-2 align-top"><textarea value={it.snippet || ''} onChange={(e) => handleUpdateItem(it.id, { snippet: e.target.value })} rows={3} className="w-full bg-slate-50 border border-slate-100 rounded-lg px-2 py-1 font-bold outline-none" /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
              <>
              <div ref={execViewportRef} className={`h-full relative ${workView === 'RESULT' ? 'hidden' : ''}`}>
                {isEmbedTemporarilyHidden ? (
                  <div className="absolute inset-0 bg-slate-50/95 backdrop-blur-[1px] flex items-center justify-center">
                    <div className="text-xs font-bold text-slate-500">为显示面板，实时浏览已临时隐藏</div>
                  </div>
                ) : null}
                {isLandingEmpty ? (
                  <div className="absolute inset-0 overflow-hidden bg-gradient-to-br from-slate-50 via-white to-indigo-50/40 flex items-center justify-center">
                    <div className="ngo-orb ngo-orb-a" />
                    <div className="ngo-orb ngo-orb-b" />
                    <div className="ngo-orb ngo-orb-c" />
                    <div className="w-[760px] max-w-[94%] animate-landing-in">
                      <div className="flex justify-center">
                        <svg viewBox="0 0 900 120" className="w-[620px] max-w-full h-[74px]" aria-label="NGO-PLANNER">
                          <defs>
                            <linearGradient id="ngoGrad" x1="0%" y1="0%" x2="100%" y2="0%">
                              <stop offset="0%" stopColor="#4f46e5">
                                <animate attributeName="stop-color" values="#4f46e5;#2563eb;#4f46e5" dur="4s" repeatCount="indefinite" />
                              </stop>
                              <stop offset="100%" stopColor="#0ea5e9">
                                <animate attributeName="stop-color" values="#0ea5e9;#6366f1;#0ea5e9" dur="4s" repeatCount="indefinite" />
                              </stop>
                            </linearGradient>
                          </defs>
                          <text x="50%" y="72" textAnchor="middle" className="ngo-svg-title" fill="url(#ngoGrad)">NGO-PLANNER</text>
                        </svg>
                      </div>
                      <div className="text-center text-slate-500 text-xs font-bold mt-2 tracking-wider">入口搜索</div>
                      <div className="mt-5 bg-white/90 backdrop-blur-sm border border-indigo-100 rounded-2xl shadow-[0_12px_40px_-20px_rgba(79,70,229,0.55)] p-3 flex items-center gap-2">
                        <div className="h-8 w-8 rounded-lg bg-indigo-50 text-indigo-600 flex items-center justify-center">
                          <Icon.Search />
                        </div>
                        <input
                          value={browserAddress}
                          onChange={(e) => setBrowserAddress(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleAddressSubmit();
                          }}
                          className="flex-1 bg-transparent outline-none text-sm font-bold text-slate-700"
                          placeholder="输入关键词或网址，回车开始"
                        />
                        <button onClick={handleAddressSubmit} className="h-8 px-4 rounded-lg bg-indigo-600 text-white text-xs font-black hover:bg-indigo-500 transition-colors">
                          进入
                        </button>
                      </div>
                      <div className="mt-3 flex items-center justify-center gap-2 flex-wrap">
                        {['小红书 NGO 项目', '公益基金会案例', '乡村振兴项目'].map((q) => (
                          <button key={q} onClick={() => setBrowserAddress(q)} className="px-3 py-1.5 text-[11px] font-bold rounded-full border border-slate-200 text-slate-600 hover:text-indigo-600 hover:border-indigo-200 hover:-translate-y-0.5 transition-all">
                            {q}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              {workView === 'RESULT' ? (
                <div className="h-full overflow-auto custom-scrollbar">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-slate-100 text-slate-500 bg-white sticky top-0">
                        <th className="text-left font-black py-2 pr-2 pl-2">标题</th>
                        <th className="text-left font-black py-2 pr-2">链接</th>
                        <th className="text-left font-black py-2 pr-2">摘要</th>
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((it) => (
                        <tr key={it.id} className="border-b border-slate-100">
                          <td className="py-2 pr-2 pl-2 min-w-[220px] align-top"><input value={it.title || ''} onChange={(e) => handleUpdateItem(it.id, { title: e.target.value })} className="w-full bg-slate-50 border border-slate-100 rounded-lg px-2 py-1 font-bold outline-none" /></td>
                          <td className="py-2 pr-2 min-w-[260px] align-top"><input value={it.url || ''} onChange={(e) => handleUpdateItem(it.id, { url: e.target.value })} className="w-full bg-slate-50 border border-slate-100 rounded-lg px-2 py-1 font-bold outline-none" /></td>
                          <td className="py-2 pr-2 align-top"><textarea value={it.snippet || ''} onChange={(e) => handleUpdateItem(it.id, { snippet: e.target.value })} rows={3} className="w-full bg-slate-50 border border-slate-100 rounded-lg px-2 py-1 font-bold outline-none" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
              </>
              )}
              {tab === 'BROWSE' ? (
                <div
                  style={{ left: toolPos.x, top: toolPos.y }}
                  className="absolute z-20 flex flex-col gap-1 bg-white/92 backdrop-blur-sm border border-slate-200 rounded-2xl p-1 shadow-lg"
                >
                  <div onMouseDown={handleToolbarMouseDown} className="h-3 rounded-md bg-slate-100 border border-slate-200 cursor-move" />
                  <button title="HOME" onClick={handleGoHome} className="h-8 w-8 rounded-lg border border-slate-200 text-slate-700 flex items-center justify-center"><Icon.Home /></button>
                  <button title="产物仓库" onClick={() => setWorkView('RESULT')} className="h-8 w-8 rounded-lg border border-slate-200 text-slate-700 flex items-center justify-center"><Icon.Box /></button>
                  <button title="翻译当前页" onClick={handleTranslate} className="h-8 w-8 rounded-lg border border-slate-200 text-slate-700 flex items-center justify-center"><Icon.Translate /></button>
                  <button title="抓取当前页文本" onClick={handleCaptureCurrentPage} className="h-8 w-8 rounded-lg border border-slate-200 text-slate-700 flex items-center justify-center"><Icon.Capture /></button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProjectIntelWorkbench;
