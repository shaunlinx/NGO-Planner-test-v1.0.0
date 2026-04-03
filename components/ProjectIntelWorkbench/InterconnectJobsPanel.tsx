import React, { useEffect, useMemo, useState } from 'react';

type TemplateField = {
  key: string;
  label: string;
  type: 'text' | 'textarea' | 'number';
  placeholder?: string;
};

type InterconnectTemplate = {
  id: string;
  name: string;
  description?: string;
  fields: TemplateField[];
};

type InterconnectJob = {
  id: string;
  template_id: string;
  title: string;
  status: string;
  progress: number;
  error?: string;
  related_run_id?: string;
  created_at?: number;
  summary?: any;
};

type InterconnectStep = {
  id: string;
  step_index: number;
  step_name: string;
  step_type: string;
  status: string;
  error?: string;
  response?: any;
};

interface InterconnectJobsPanelProps {
  onStatus: (text: string) => void;
  onSelectRun: (runId: string) => void;
}

const InterconnectJobsPanel: React.FC<InterconnectJobsPanelProps> = ({ onStatus, onSelectRun }) => {
  const api = (window as any).electronAPI?.interconnect;
  const [templates, setTemplates] = useState<InterconnectTemplate[]>([]);
  const [jobs, setJobs] = useState<InterconnectJob[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('');
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [steps, setSteps] = useState<InterconnectStep[]>([]);

  const selectedTemplate = useMemo(
    () => templates.find((t) => t.id === selectedTemplateId) || null,
    [templates, selectedTemplateId]
  );

  const selectedJob = useMemo(
    () => jobs.find((j) => j.id === selectedJobId) || null,
    [jobs, selectedJobId]
  );

  const refreshTemplates = async () => {
    if (!api?.listTemplates) return;
    const res = await api.listTemplates();
    if (res?.success && Array.isArray(res.templates)) {
      setTemplates(res.templates);
      if (!selectedTemplateId && res.templates[0]?.id) setSelectedTemplateId(res.templates[0].id);
    }
  };

  const refreshJobs = async () => {
    if (!api?.listJobs) return;
    const res = await api.listJobs(120);
    if (res?.success && Array.isArray(res.jobs)) {
      setJobs(res.jobs);
      if (!selectedJobId && res.jobs[0]?.id) setSelectedJobId(res.jobs[0].id);
    }
  };

  const refreshSteps = async (jobId: string) => {
    if (!api?.listSteps || !jobId) return;
    const res = await api.listSteps(jobId);
    if (res?.success && Array.isArray(res.steps)) setSteps(res.steps);
  };

  useEffect(() => {
    refreshTemplates();
    refreshJobs();
  }, []);

  useEffect(() => {
    if (selectedJobId) refreshSteps(selectedJobId);
  }, [selectedJobId]);

  useEffect(() => {
    if (!api?.onUpdate) return;
    const off = api.onUpdate((event: any) => {
      if (!event) return;
      if (event.type === 'job_started') onStatus(`任务已启动：${event.jobId}`);
      if (event.type === 'job_finished') onStatus(`任务结束：${event.status}${event.error ? ` (${event.error})` : ''}`);
      if (event.type === 'step_running') onStatus(`执行步骤：${event.name}`);
      if (event.type === 'step_done') onStatus(`步骤完成：${event.name}`);
      refreshJobs();
      if (selectedJobId) refreshSteps(selectedJobId);
    });
    return () => {
      try {
        if (typeof off === 'function') off();
        else api.offUpdate();
      } catch (e) {}
    };
  }, [api, selectedJobId, onStatus]);

  const handleCreate = async () => {
    if (!api?.createJob || !selectedTemplate) return;
    const payload: any = { templateId: selectedTemplate.id, ...formData };
    if (!payload.taskName) payload.taskName = selectedTemplate.name;
    const res = await api.createJob(payload);
    if (!res?.success) {
      onStatus(`创建失败：${res?.error || ''}`);
      return;
    }
    onStatus('任务创建成功');
    setSelectedJobId(res.jobId);
    await refreshJobs();
  };

  const handleRun = async (jobId: string) => {
    if (!api?.runJob || !jobId) return;
    onStatus('任务开始执行…');
    const res = await api.runJob(jobId);
    if (!res?.success) onStatus(`执行失败：${res?.error || ''}`);
    await refreshJobs();
    await refreshSteps(jobId);
  };

  const handleStop = async (jobId: string) => {
    if (!api?.stopJob || !jobId) return;
    await api.stopJob(jobId);
    onStatus('已请求停止任务');
  };

  const handleDelete = async (jobId: string) => {
    if (!api?.deleteJob || !jobId) return;
    const res = await api.deleteJob(jobId);
    if (!res?.success) {
      onStatus(`删除失败：${res?.error || ''}`);
      return;
    }
    if (selectedJobId === jobId) setSelectedJobId('');
    onStatus('任务已删除');
    await refreshJobs();
    setSteps([]);
  };

  return (
    <div className="h-full flex gap-6">
      <div className="w-[420px] bg-white border border-slate-200 rounded-[1.6rem] p-5 shadow-sm flex flex-col">
        <div className="text-sm font-black text-slate-800">任务模板</div>
        <div className="mt-3">
          <select
            value={selectedTemplateId}
            onChange={(e) => {
              setSelectedTemplateId(e.target.value);
              setFormData({});
            }}
            className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-100"
          >
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-3 text-[11px] text-slate-500 leading-relaxed min-h-[40px]">{selectedTemplate?.description || ''}</div>

        <div className="mt-3 flex-1 overflow-auto custom-scrollbar pr-1 space-y-3">
          {(selectedTemplate?.fields || []).map((f) => (
            <div key={f.key}>
              <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{f.label}</div>
              {f.type === 'textarea' ? (
                <textarea
                  value={String(formData[f.key] || '')}
                  onChange={(e) => setFormData((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  rows={5}
                  placeholder={f.placeholder || ''}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-100"
                />
              ) : (
                <input
                  type={f.type === 'number' ? 'number' : 'text'}
                  value={String(formData[f.key] || '')}
                  onChange={(e) => setFormData((prev) => ({ ...prev, [f.key]: f.type === 'number' ? Number(e.target.value || 0) : e.target.value }))}
                  placeholder={f.placeholder || ''}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-100"
                />
              )}
            </div>
          ))}
        </div>

        <button
          onClick={handleCreate}
          className="mt-4 bg-indigo-600 text-white rounded-xl py-2.5 text-xs font-black hover:bg-indigo-700"
        >
          创建任务
        </button>
      </div>

      <div className="flex-1 bg-white border border-slate-200 rounded-[1.6rem] p-5 shadow-sm flex flex-col overflow-hidden">
        <div className="flex items-center justify-between">
          <div className="text-sm font-black text-slate-800">任务队列</div>
          <button onClick={refreshJobs} className="text-xs font-black text-slate-600 hover:text-indigo-600">
            刷新
          </button>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-2 max-h-[44%] overflow-auto custom-scrollbar pr-1">
          {jobs.map((j) => (
            <button
              key={j.id}
              onClick={() => setSelectedJobId(j.id)}
              className={`text-left border rounded-xl px-3 py-2 ${
                selectedJobId === j.id ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white hover:border-indigo-200'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="text-xs font-black text-slate-800">{j.title || j.template_id}</div>
                <div className="text-[10px] text-slate-500">{j.status}</div>
              </div>
              <div className="mt-1 text-[11px] text-slate-500">
                {new Date(j.created_at || Date.now()).toLocaleString()} · 进度 {j.progress || 0}%
              </div>
              {j.error ? <div className="mt-1 text-[11px] text-rose-500">{j.error}</div> : null}
            </button>
          ))}
          {jobs.length === 0 ? <div className="text-xs text-slate-500">暂无任务</div> : null}
        </div>

        <div className="mt-4 border-t border-slate-100 pt-4 flex-1 overflow-hidden">
          <div className="flex items-center justify-between">
            <div className="text-xs font-black text-slate-700">任务详情</div>
            <div className="flex items-center gap-2">
              <button
                disabled={!selectedJobId}
                onClick={() => selectedJobId && handleRun(selectedJobId)}
                className="px-3 py-1.5 rounded-lg text-[11px] font-black bg-indigo-600 text-white disabled:opacity-50"
              >
                执行
              </button>
              <button
                disabled={!selectedJobId}
                onClick={() => selectedJobId && handleStop(selectedJobId)}
                className="px-3 py-1.5 rounded-lg text-[11px] font-black bg-slate-800 text-white disabled:opacity-50"
              >
                停止
              </button>
              <button
                disabled={!selectedJobId}
                onClick={() => selectedJobId && handleDelete(selectedJobId)}
                className="px-3 py-1.5 rounded-lg text-[11px] font-black border border-slate-300 text-slate-700 disabled:opacity-50"
              >
                删除
              </button>
              <button
                disabled={!selectedJob?.related_run_id}
                onClick={() => {
                  if (selectedJob?.related_run_id) onSelectRun(selectedJob.related_run_id);
                }}
                className="px-3 py-1.5 rounded-lg text-[11px] font-black border border-indigo-300 text-indigo-600 disabled:opacity-50"
              >
                打开关联采集
              </button>
            </div>
          </div>

          <div className="mt-3 h-[calc(100%-2rem)] overflow-auto custom-scrollbar pr-1 space-y-2">
            {steps.map((s) => (
              <div key={s.id} className="border border-slate-200 rounded-xl p-3 bg-slate-50">
                <div className="flex justify-between items-center">
                  <div className="text-xs font-black text-slate-800">
                    {s.step_index}. {s.step_name}
                  </div>
                  <div className="text-[10px] font-black text-slate-500">{s.status}</div>
                </div>
                {s.error ? <div className="mt-2 text-[11px] text-rose-500">{s.error}</div> : null}
                <pre className="mt-2 text-[10px] text-slate-600 bg-white border border-slate-200 rounded-lg p-2 overflow-auto max-h-40">
{JSON.stringify(s.response || {}, null, 2)}
                </pre>
              </div>
            ))}
            {selectedJobId && steps.length === 0 ? <div className="text-xs text-slate-500">该任务暂无步骤记录</div> : null}
            {!selectedJobId ? <div className="text-xs text-slate-500">请选择任务查看详情</div> : null}
          </div>
        </div>
      </div>
    </div>
  );
};

export default InterconnectJobsPanel;
