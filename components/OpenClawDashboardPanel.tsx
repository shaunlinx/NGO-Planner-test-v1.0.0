import React, { useEffect, useRef, useState } from 'react';

type Status = {
  enabled?: boolean;
  installed?: boolean;
  gateway?: { running?: boolean; port?: number };
  lastError?: string | null;
};

const OpenClawDashboardPanel: React.FC<{ active: boolean }> = ({ active }) => {
  const api = (window as any).electronAPI;
  const [status, setStatus] = useState<Status | null>(null);
  const [booting, setBooting] = useState(false);
  const [msg, setMsg] = useState('');
  const mountRef = useRef<HTMLDivElement | null>(null);
  const shownRef = useRef(false);
  const lastBoundsKeyRef = useRef('');
  const resizeRafRef = useRef<number | null>(null);
  const showRetryTimerRef = useRef<number | null>(null);
  const showRetryCountRef = useRef(0);
  const activeRef = useRef(active);
  const effectSeqRef = useRef(0);
  const showEpochRef = useRef(0);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const getBounds = () => {
    const el = mountRef.current;
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
    showEpochRef.current += 1;
    try {
      await api?.openclaw?.embed?.hide?.();
    } catch (e) {}
    shownRef.current = false;
    lastBoundsKeyRef.current = '';
    if (showRetryTimerRef.current !== null) {
      try {
        window.clearTimeout(showRetryTimerRef.current);
      } catch (e) {}
      showRetryTimerRef.current = null;
    }
  };

  const refreshStatus = async () => {
    try {
      const s = (await api?.openclaw?.getStatus?.()) || null;
      setStatus(s);
      return s;
    } catch (e: any) {
      setMsg(String(e?.message || 'OpenClaw 状态获取失败'));
      return null;
    }
  };

  const ensureReady = async () => {
    setBooting(true);
    setMsg('');
    try {
      let s = await refreshStatus();
      if (!s?.gateway?.running) {
        try {
          await api?.openclaw?.setEnabled?.(true);
        } catch (e) {}
        try {
          const ensured = await api?.openclaw?.ensureRunning?.();
          if (ensured && typeof ensured === 'object') s = ensured;
          if (s && typeof s === 'object') setStatus(s as any);
        } catch (e: any) {
          const text = String(e?.message || '');
          if (!text.toLowerCase().includes('already running')) {
            setMsg(text || 'OpenClaw 启动失败');
          }
        }
        if (!s?.gateway?.running) s = await refreshStatus();
      }
      if (!s?.gateway?.running) {
        setMsg((s?.lastError && String(s.lastError)) || 'OpenClaw 未就绪');
      }
      return s;
    } finally {
      setBooting(false);
    }
  };

  const showOrResize = async () => {
    if (!activeRef.current) return;
    const epoch = showEpochRef.current;
    const b = getBounds();
    if (!b) {
      if (showRetryCountRef.current < 30) {
        showRetryCountRef.current += 1;
        if (showRetryTimerRef.current !== null) {
          try {
            window.clearTimeout(showRetryTimerRef.current);
          } catch (e) {}
        }
        showRetryTimerRef.current = window.setTimeout(() => {
          showRetryTimerRef.current = null;
          showOrResize();
        }, 120);
      }
      return;
    }
    const key = `${b.x},${b.y},${b.width},${b.height}`;
    if (shownRef.current) {
      if (key === lastBoundsKeyRef.current) return;
      lastBoundsKeyRef.current = key;
      try {
        await api?.openclaw?.embed?.resize?.({ bounds: b });
      } catch (e) {}
      return;
    }
    try {
      const res = await api?.openclaw?.embed?.show?.({ bounds: b });
      if (epoch !== showEpochRef.current || !activeRef.current) {
        try {
          await api?.openclaw?.embed?.hide?.();
        } catch (e) {}
        return;
      }
      if (res?.success) {
        shownRef.current = true;
        lastBoundsKeyRef.current = key;
        showRetryCountRef.current = 0;
      }
    } catch (e) {}
  };

  const scheduleResize = () => {
    if (resizeRafRef.current !== null) return;
    resizeRafRef.current = window.requestAnimationFrame(() => {
      resizeRafRef.current = null;
      showOrResize();
    });
  };

  useEffect(() => {
    const seq = ++effectSeqRef.current;
    if (!active) {
      hideEmbed();
      return;
    }
    showOrResize();
    refreshStatus().then((s) => {
      if (seq !== effectSeqRef.current || !activeRef.current) return;
      if (s?.gateway?.running) {
        scheduleResize();
        return;
      }
      ensureReady().then(() => {
        if (seq !== effectSeqRef.current || !activeRef.current) return;
        showOrResize();
      });
    });
  }, [active]);

  useEffect(() => {
    if (!active) return;
    showOrResize();
  }, [active, status?.gateway?.running]);

  useEffect(() => {
    if (!active) return;
    const el = mountRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => scheduleResize());
    obs.observe(el);
    const onWinResize = () => scheduleResize();
    window.addEventListener('resize', onWinResize);
    return () => {
      window.removeEventListener('resize', onWinResize);
      try {
        obs.disconnect();
      } catch (e) {}
    };
  }, [active, status?.gateway?.running]);

  useEffect(() => {
    const onRestore = () => {
      if (!activeRef.current) return;
      showOrResize();
      refreshStatus().then((s) => {
        if (!activeRef.current) return;
        if (s?.gateway?.running) {
          scheduleResize();
          return;
        }
        ensureReady().then(() => {
          if (!activeRef.current) return;
          scheduleResize();
        });
      });
    };
    window.addEventListener('openclaw:restore-embed', onRestore as any);
    return () => window.removeEventListener('openclaw:restore-embed', onRestore as any);
  }, [active]);

  useEffect(() => {
    return () => {
      if (resizeRafRef.current !== null) {
        try {
          window.cancelAnimationFrame(resizeRafRef.current);
        } catch (e) {}
      }
      if (showRetryTimerRef.current !== null) {
        try {
          window.clearTimeout(showRetryTimerRef.current);
        } catch (e) {}
      }
      hideEmbed();
    };
  }, []);

  return (
    <div className="h-full w-full bg-white relative">
      {booting ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/90 text-slate-500 text-sm font-bold">
          正在准备 OpenClaw Dashboard…
        </div>
      ) : null}
      {msg ? (
        <div className="absolute top-2 right-2 z-20 text-[11px] text-rose-600 bg-rose-50 border border-rose-100 rounded px-2 py-1">
          {msg}
        </div>
      ) : null}
      {!status?.gateway?.running && !booting ? (
        <div className="h-full w-full flex items-center justify-center text-slate-400 text-sm font-bold">
          OpenClaw 未就绪，正在重试连接
        </div>
      ) : (
        <div ref={mountRef} className="h-full w-full" />
      )}
    </div>
  );
};

export default OpenClawDashboardPanel;
