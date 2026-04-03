import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { renderToStaticMarkup } from 'react-dom/server';
import { MilestoneItem, Project, TeamMember } from '../types';

type WritingTaskItem = {
  projectId: string;
  projectTitle: string;
  task: MilestoneItem;
  agent: TeamMember;
};

type WritingDocument = {
  id: string;
  title: string;
  content: string;
  format: 'markdown' | 'word';
  updatedAt: number;
};

type CitationItem = {
  id: string;
  title: string;
  excerpt: string;
  source?: string;
  score?: number;
  createdAt: number;
};

type CapabilityItem = {
  id?: string;
  path?: string;
  description?: string;
  risk?: string;
};

interface WritingAssistantProps {
  projects: Project[];
  tasks: WritingTaskItem[];
  activeTaskId: string | null;
  onSelectTask: (id: string | null) => void;
  onOpenConfig: () => void;
}

const DOCS_KEY = 'writing_assistant_documents_v1';
const UIIcon = {
  add: () => <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 5v14m7-7H5" /></svg>,
  upload: () => <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M12 4v12m0-12l-4 4m4-4l4 4" /></svg>,
  save: () => <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5h14v14H5zM8 5v5h8V5" /></svg>,
  md: () => <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 6h18v12H3zM7 15V9l2 2 2-2v6m3-3h3m-1.5-1.5V15" /></svg>,
  word: () => <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 4h10a2 2 0 012 2v12a2 2 0 01-2 2H7zM9 8l1.2 8L12 11l1.8 5L15 8" /></svg>,
  trash: () => <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 7h12M9 7V5h6v2m-8 0l1 12h8l1-12" /></svg>,
  evidence: () => <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 6h8M6 10h12M6 14h8M6 18h12" /></svg>,
  draft: () => <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 19h16M5 15l9-9 4 4-9 9H5z" /></svg>,
  auto: () => <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 3L4 14h7l-1 7 9-11h-7l1-7z" /></svg>,
  sync: () => <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v6h6M20 20v-6h-6M20 10a8 8 0 00-14-4M4 14a8 8 0 0014 4" /></svg>,
  config: () => <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8a4 4 0 100 8 4 4 0 000-8zm8 4l-2.2.7a7.7 7.7 0 00-.6 1.5l1 2-2 2-2-1a7.7 7.7 0 00-1.5.6L12 20l-1.7-2.2a7.7 7.7 0 00-1.5-.6l-2 1-2-2 1-2a7.7 7.7 0 00-.6-1.5L4 12l2.2-.7a7.7 7.7 0 00.6-1.5l-1-2 2-2 2 1a7.7 7.7 0 001.5-.6L12 4l1.7 2.2a7.7 7.7 0 001.5.6l2-1 2 2-1 2a7.7 7.7 0 00.6 1.5L20 12z" /></svg>,
  edit: () => <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5M18 4l2 2-9 9H9v-2l9-9z" /></svg>,
  preview: () => <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6-10-6-10-6zm10 3a3 3 0 100-6 3 3 0 000 6z" /></svg>,
  split: () => <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 5h16v14H4zM12 5v14" /></svg>
};

const WritingAssistant: React.FC<WritingAssistantProps> = ({
  projects,
  tasks,
  activeTaskId,
  onSelectTask,
  onOpenConfig
}) => {
  const api = (window as any).electronAPI;
  const [docs, setDocs] = useState<WritingDocument[]>([]);
  const [activeDocId, setActiveDocId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('split');
  const [savedTip, setSavedTip] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [ragTopK, setRagTopK] = useState(6);
  const [retrievalBusy, setRetrievalBusy] = useState(false);
  const [citations, setCitations] = useState<CitationItem[]>([]);
  const [draftInstruction, setDraftInstruction] = useState('请基于证据写一版高质量、结构清晰、可直接发布的文稿。');
  const [draftBusy, setDraftBusy] = useState(false);
  const [bridgeCapabilities, setBridgeCapabilities] = useState<CapabilityItem[]>([]);
  const [capBusy, setCapBusy] = useState(false);
  const [selectedSkillPath, setSelectedSkillPath] = useState('/skills/kb/query');
  const [skillBodyText, setSkillBodyText] = useState('{\n  "query": ""\n}');
  const [skillBusy, setSkillBusy] = useState(false);
  const [skillResultText, setSkillResultText] = useState('');
  const [interconnectTemplates, setInterconnectTemplates] = useState<any[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState('');
  const [interconnectFormText, setInterconnectFormText] = useState('{\n  "taskName": "文稿助手-实时补证据"\n}');
  const [interconnectBusy, setInterconnectBusy] = useState(false);
  const [interconnectLog, setInterconnectLog] = useState<string[]>([]);
  const [claudeBusy, setClaudeBusy] = useState(false);
  const [claudeInput, setClaudeInput] = useState('请把当前文稿重构为更清晰的大纲，并给出改写建议。');
  const [claudeOutput, setClaudeOutput] = useState('');
  const [claudeSessionId, setClaudeSessionId] = useState('');
  const [taskStatus, setTaskStatus] = useState('completed');
  const [taskEvidence, setTaskEvidence] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskMsg, setTaskMsg] = useState('');
  const [workflowTab, setWorkflowTab] = useState<'evidence' | 'draft' | 'automation' | 'ops'>('evidence');
  const [showAdvancedAutomation, setShowAdvancedAutomation] = useState(false);
  const [showAdvancedOps, setShowAdvancedOps] = useState(false);
  const [brief, setBrief] = useState('');
  const [audience, setAudience] = useState('公众');
  const [tone, setTone] = useState('专业可信');
  const [oneClickBusy, setOneClickBusy] = useState(false);
  const [oneClickLog, setOneClickLog] = useState<string[]>([]);

  const activeDoc = useMemo(
    () => docs.find((d) => d.id === activeDocId) || null,
    [docs, activeDocId]
  );

  const activeTaskData = useMemo(() => {
    if (!activeTaskId) return null;
    for (const project of projects) {
      const task = (project.milestones || []).find((x) => x.id === activeTaskId);
      if (task) return { project, task };
    }
    return null;
  }, [projects, activeTaskId]);

  const templateFields = useMemo(() => {
    const selected = interconnectTemplates.find((x) => x.id === selectedTemplateId);
    return Array.isArray(selected?.fields) ? selected.fields : [];
  }, [interconnectTemplates, selectedTemplateId]);

  const persistDocs = async (nextDocs: WritingDocument[], nextActiveId?: string) => {
    setDocs(nextDocs);
    if (nextActiveId !== undefined) setActiveDocId(nextActiveId);
    await api?.db?.saveSetting?.(DOCS_KEY, { docs: nextDocs, activeDocId: nextActiveId ?? activeDocId });
    setSavedTip('已保存');
    setTimeout(() => setSavedTip(''), 1200);
  };

  const updateDoc = (patch: Partial<WritingDocument>) => {
    if (!activeDoc) return;
    const next = docs.map((d) =>
      d.id === activeDoc.id
        ? {
            ...d,
            ...patch,
            updatedAt: Date.now()
          }
        : d
    );
    setDocs(next);
  };

  const parseJson = (text: string) => {
    try {
      return JSON.parse(text || '{}');
    } catch (e) {
      return null;
    }
  };

  const renderMarkdownHtml = (content: string) => {
    const html = renderToStaticMarkup(
      <div style={{ fontFamily: 'Arial', lineHeight: '1.75' }}>
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    );
    return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
  };

  const createDoc = async () => {
    const now = Date.now();
    const doc: WritingDocument = {
      id: `doc-${now}`,
      title: `未命名文稿-${new Date(now).toLocaleDateString()}`,
      content: '',
      format: 'markdown',
      updatedAt: now
    };
    const next = [doc, ...docs];
    await persistDocs(next, doc.id);
  };

  const deleteDoc = async (id: string) => {
    const next = docs.filter((d) => d.id !== id);
    const nextActive = next[0]?.id || '';
    await persistDocs(next, nextActive);
  };

  const handleSave = async () => {
    if (!activeDoc) return;
    const next = docs.map((d) =>
      d.id === activeDoc.id
        ? {
            ...d,
            updatedAt: Date.now()
          }
        : d
    );
    await persistDocs(next, activeDoc.id);
  };

  const importDocument = async () => {
    const picked = await api?.fs?.selectFile?.({
      filters: [{ name: 'Documents', extensions: ['md', 'txt', 'docx', 'pdf'] }]
    });
    if (!picked?.path) return;
    const preview = await api?.fs?.readFilePreview?.(picked.path);
    if (!preview?.success) return;
    const content = String(preview?.data || '');
    const now = Date.now();
    const doc: WritingDocument = {
      id: `doc-${now}`,
      title: String(picked.name || `导入文稿-${now}`),
      content,
      format: 'markdown',
      updatedAt: now
    };
    const next = [doc, ...docs];
    await persistDocs(next, doc.id);
  };

  const exportMarkdown = () => {
    if (!activeDoc) return;
    const blob = new Blob([`\uFEFF${activeDoc.content}`], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeDoc.title || '文稿'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportWord = async () => {
    if (!activeDoc) return;
    const html = renderMarkdownHtml(activeDoc.content || '');
    await api?.exportToWord?.(activeDoc.title || '文稿', html);
  };

  const refreshCapabilities = async () => {
    setCapBusy(true);
    try {
      const res = await api?.openclaw?.bridgeRequest?.({
        path: '/skills/capabilities/catalog',
        body: {}
      });
      const list = Array.isArray(res?.result?.capabilities)
        ? res.result.capabilities
        : Array.isArray(res?.result?.skills)
          ? res.result.skills
          : Array.isArray(res?.capabilities)
            ? res.capabilities
            : [];
      setBridgeCapabilities(list);
    } finally {
      setCapBusy(false);
    }
  };

  const refreshInterconnectTemplates = async () => {
    const res = await api?.interconnect?.listTemplates?.();
    const list = Array.isArray(res?.templates) ? res.templates : [];
    setInterconnectTemplates(list);
    if (!selectedTemplateId && list[0]?.id) {
      setSelectedTemplateId(String(list[0].id));
    }
  };

  const retrieveEvidence = async (queryText: string, topKValue: number) => {
    const q = String(queryText || '').trim();
    if (!q) return [];
    const bridgeRes = await api?.openclaw?.bridgeRequest?.({
      path: '/skills/kb/query',
      body: { query: q, topK: topKValue }
    });
    const bridgeItems = Array.isArray(bridgeRes?.result?.chunks)
      ? bridgeRes.result.chunks
      : Array.isArray(bridgeRes?.result?.sources)
        ? bridgeRes.result.sources
        : [];
    let items = bridgeItems;
    if (!items.length) {
      const kbRes = await api?.knowledge?.query?.({ text: q, topK: topKValue, activeFiles: [] });
      items = Array.isArray(kbRes?.chunks) ? kbRes.chunks : Array.isArray(kbRes?.sources) ? kbRes.sources : [];
    }
    const nextCitations: CitationItem[] = items.slice(0, topKValue).map((x: any, idx: number) => ({
      id: `cite-${Date.now()}-${idx}`,
      title: String(x?.title || x?.name || x?.source || `证据${idx + 1}`),
      excerpt: String(x?.text || x?.content || x?.excerpt || ''),
      source: String(x?.source || x?.file || x?.filePath || ''),
      score: Number(x?.score || x?.relevance || 0),
      createdAt: Date.now()
    }));
    setCitations((prev) => [...nextCitations, ...prev].slice(0, 120));
    return nextCitations;
  };

  const runKbRetrieve = async () => {
    const q = String(searchQuery || '').trim();
    if (!q) return;
    setRetrievalBusy(true);
    try {
      await retrieveEvidence(q, ragTopK);
    } finally {
      setRetrievalBusy(false);
    }
  };

  const insertCitation = (item: CitationItem) => {
    if (!activeDoc) return;
    const footnote = `\n\n[^${item.id}]: ${item.title}${item.source ? ` (${item.source})` : ''}\n> ${item.excerpt}\n`;
    updateDoc({ content: `${activeDoc.content}\n\n引用：[^${item.id}]${footnote}` });
  };

  const deepDraft = async () => {
    if (!activeDoc) return;
    setDraftBusy(true);
    try {
      const citationText = citations
        .slice(0, 16)
        .map((c, i) => `[证据${i + 1}] ${c.title}\n来源: ${c.source || '未知'}\n片段: ${c.excerpt}`)
        .join('\n\n');
      const prompt = [
        `任务：${draftInstruction}`,
        '要求：',
        '1) 用中文输出可直接使用的高质量正文；',
        '2) 内容必须基于提供证据，不编造事实；',
        '3) 文末输出“引用清单”，用 [证据序号] 关联。',
        '',
        '当前文稿：',
        activeDoc.content || '(空)',
        '',
        '证据：',
        citationText || '(暂无证据)'
      ].join('\n');
      const res = await api?.knowledge?.completion?.({ prompt });
      if (res?.success && res?.text) {
        updateDoc({ content: String(res.text) });
      }
    } finally {
      setDraftBusy(false);
    }
  };

  const runInterconnect = async () => {
    const templateId = String(selectedTemplateId || '').trim();
    if (!templateId) return;
    const parsed = parseJson(interconnectFormText);
    if (!parsed) {
      setInterconnectLog((prev) => [`参数JSON无效`, ...prev].slice(0, 60));
      return;
    }
    setInterconnectBusy(true);
    try {
      const createRes = await api?.interconnect?.createJob?.({ templateId, ...parsed });
      if (!createRes?.success || !createRes?.jobId) {
        setInterconnectLog((prev) => [`创建失败: ${String(createRes?.error || '')}`, ...prev].slice(0, 60));
        return;
      }
      setInterconnectLog((prev) => [`任务已创建: ${createRes.jobId}`, ...prev].slice(0, 60));
      const runRes = await api?.interconnect?.runJob?.(createRes.jobId);
      if (!runRes?.success) {
        setInterconnectLog((prev) => [`执行失败: ${String(runRes?.error || '')}`, ...prev].slice(0, 60));
      } else {
        setInterconnectLog((prev) => [`任务启动成功: ${createRes.jobId}`, ...prev].slice(0, 60));
      }
    } finally {
      setInterconnectBusy(false);
    }
  };

  const runClaudeAutomation = async () => {
    setClaudeBusy(true);
    try {
      const status = await api?.claudeCode?.getStatus?.();
      if (!status?.enabled) {
        setClaudeOutput('Claude Code 未启用，请先在集成设置中启用。');
        return;
      }
      const prompt = [
        '你是文稿重构助手，请完成：',
        claudeInput,
        '',
        '当前文稿如下：',
        activeDoc?.content || '(空)'
      ].join('\n');
      let sid = claudeSessionId;
      if (!sid) {
        const session = await api?.claudeCode?.createSession?.({
          cols: 120,
          rows: 40
        });
        if (!session?.success || !session?.sessionId) {
          setClaudeOutput(`会话创建失败: ${String(session?.error || '')}`);
          return;
        }
        sid = String(session.sessionId);
        setClaudeSessionId(sid);
      }
      await api?.claudeCode?.write?.({ sessionId: sid, data: `${prompt}\n` });
    } finally {
      setClaudeBusy(false);
    }
  };

  const runSelectedSkill = async () => {
    const path = String(selectedSkillPath || '').trim();
    if (!path.startsWith('/skills/')) return;
    const body = parseJson(skillBodyText);
    if (!body) {
      setSkillResultText('参数JSON无效');
      return;
    }
    setSkillBusy(true);
    try {
      const res = await api?.openclaw?.bridgeRequest?.({ path, body });
      setSkillResultText(JSON.stringify(res, null, 2));
    } finally {
      setSkillBusy(false);
    }
  };

  const applyTaskUpdate = async () => {
    if (!activeTaskData) return;
    setTaskBusy(true);
    setTaskMsg('');
    try {
      const body: any = {
        projectId: String(activeTaskData.project.id),
        milestoneId: String(activeTaskData.task.id),
        patch: {
          status: String(taskStatus || 'completed').trim()
        }
      };
      const ev = String(taskEvidence || '').trim();
      if (ev) body.patch.evidenceAdd = [ev];
      const r = await api?.openclaw?.bridgeRequest?.({ path: '/skills/milestones/update', body });
      if (!r?.success && r?.error === 'approval_required') {
        setTaskMsg(`需要授权：${String(r.approvalId || '')}`);
      } else if (!r?.success) {
        setTaskMsg(String(r?.error || '更新失败'));
      } else {
        setTaskMsg('更新成功');
      }
    } finally {
      setTaskBusy(false);
    }
  };

  const runOneClickWorkflow = async () => {
    if (!activeDoc) return;
    const goal = String(brief || activeDoc.title || '').trim();
    if (!goal) return;
    setOneClickBusy(true);
    setOneClickLog([]);
    try {
      setOneClickLog((prev) => ['1/4 拉取证据…', ...prev].slice(0, 20));
      const evidences = await retrieveEvidence(goal, ragTopK);
      const evidenceText = evidences
        .slice(0, 12)
        .map((c, i) => `[证据${i + 1}] ${c.title}\n来源: ${c.source || '未知'}\n片段: ${c.excerpt}`)
        .join('\n\n');
      setOneClickLog((prev) => ['2/4 生成正文…', ...prev].slice(0, 20));
      const prompt = [
        `写作目标：${goal}`,
        `受众：${audience}`,
        `风格：${tone}`,
        '',
        '要求：',
        '1) 输出可直接发布的完整正文；',
        '2) 仅使用证据，不得臆造；',
        '3) 文末附“引用清单”。',
        '',
        '证据：',
        evidenceText || '(暂无)'
      ].join('\n');
      const res = await api?.knowledge?.completion?.({ prompt });
      if (res?.success && res?.text) {
        updateDoc({ content: String(res.text) });
      }
      setOneClickLog((prev) => ['3/4 触发联网刷新…', ...prev].slice(0, 20));
      if (selectedTemplateId) {
        const createRes = await api?.interconnect?.createJob?.({
          templateId: selectedTemplateId,
          taskName: `文稿更新-${goal}`,
          topic: goal,
          query: goal,
          keywords: goal
        });
        if (createRes?.success && createRes?.jobId) {
          await api?.interconnect?.runJob?.(createRes.jobId);
        }
      }
      setOneClickLog((prev) => ['4/4 完成，正文已更新', ...prev].slice(0, 20));
    } finally {
      setOneClickBusy(false);
    }
  };

  useEffect(() => {
    (async () => {
      const stored = await api?.db?.getSetting?.(DOCS_KEY);
      const loadedDocs = Array.isArray(stored?.docs) ? stored.docs : [];
      if (loadedDocs.length) {
        setDocs(loadedDocs);
        setActiveDocId(String(stored?.activeDocId || loadedDocs[0].id || ''));
      } else {
        const now = Date.now();
        const init: WritingDocument = {
          id: `doc-${now}`,
          title: '文稿草案',
          content: '',
          format: 'markdown',
          updatedAt: now
        };
        setDocs([init]);
        setActiveDocId(init.id);
      }
      await Promise.all([refreshCapabilities(), refreshInterconnectTemplates()]);
    })();
  }, []);

  useEffect(() => {
    const offData = api?.claudeCode?.onData?.((payload: any) => {
      if (!payload?.sessionId) return;
      if (claudeSessionId && payload.sessionId !== claudeSessionId) return;
      setClaudeOutput((prev) => `${prev}${String(payload?.data || '')}`.slice(-20000));
    });
    const offExit = api?.claudeCode?.onExit?.((payload: any) => {
      if (payload?.sessionId && payload.sessionId === claudeSessionId) {
        setClaudeSessionId('');
      }
    });
    const offInterconnect = api?.interconnect?.onUpdate?.((event: any) => {
      if (!event) return;
      if (event.type === 'job_started') setInterconnectLog((prev) => [`任务启动: ${event.jobId}`, ...prev].slice(0, 60));
      if (event.type === 'step_running') setInterconnectLog((prev) => [`步骤执行: ${event.name}`, ...prev].slice(0, 60));
      if (event.type === 'step_done') setInterconnectLog((prev) => [`步骤完成: ${event.name}`, ...prev].slice(0, 60));
      if (event.type === 'job_finished') setInterconnectLog((prev) => [`任务结束: ${event.status}${event.error ? ` (${event.error})` : ''}`, ...prev].slice(0, 60));
    });
    return () => {
      if (typeof offData === 'function') offData();
      if (typeof offExit === 'function') offExit();
      if (typeof offInterconnect === 'function') offInterconnect();
      else api?.interconnect?.offUpdate?.();
    };
  }, [claudeSessionId]);

  useEffect(() => {
    if (!selectedTemplateId || !templateFields.length) return;
    const model: Record<string, any> = { taskName: '文稿助手-实时补证据' };
    templateFields.forEach((f: any) => {
      const key = String(f?.key || '');
      if (!key || model[key] !== undefined) return;
      if (key.toLowerCase().includes('keyword')) model[key] = searchQuery || '';
      else if (key.toLowerCase().includes('query')) model[key] = searchQuery || '';
      else if (key.toLowerCase().includes('topic')) model[key] = activeDoc?.title || '';
      else if (key.toLowerCase().includes('name')) model[key] = '文稿助手自动任务';
      else model[key] = '';
    });
    setInterconnectFormText(JSON.stringify(model, null, 2));
  }, [selectedTemplateId, templateFields.length, searchQuery, activeDoc?.title]);

  return (
    <div className="flex h-full bg-slate-50">
      <div className="w-72 border-r border-slate-200 bg-white p-3 space-y-3 overflow-y-auto">
        <div className="flex items-center justify-between">
          <div className="text-xs font-black text-slate-700">文稿</div>
          <div className="flex items-center gap-1">
            <button title="新建" onClick={createDoc} className="w-7 h-7 rounded-md bg-indigo-600 text-white flex items-center justify-center"><UIIcon.add /></button>
            <button title="导入" onClick={importDocument} className="w-7 h-7 rounded-md border border-slate-200 text-slate-600 flex items-center justify-center"><UIIcon.upload /></button>
          </div>
        </div>
        <div className="space-y-2 max-h-56 overflow-y-auto">
          {docs.map((d) => (
            <button
              key={d.id}
              onClick={() => setActiveDocId(d.id)}
              className={`w-full text-left p-2 rounded-lg border ${activeDocId === d.id ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white'}`}
            >
              <div className="text-xs font-black text-slate-800 truncate">{d.title}</div>
              <div className="text-[10px] text-slate-500">{new Date(d.updatedAt).toLocaleString()}</div>
            </button>
          ))}
        </div>
        {activeDoc && (
          <div className="space-y-2">
            <div className="text-[11px] font-black text-slate-700">当前文稿</div>
            <input
              value={activeDoc.title}
              onChange={(e) => updateDoc({ title: e.target.value })}
              className="w-full px-2 py-2 rounded-lg border border-slate-200 text-xs font-bold bg-white outline-none"
              placeholder="标题"
            />
            <button disabled={oneClickBusy} onClick={runOneClickWorkflow} className="w-full px-2 py-2 rounded-lg bg-slate-900 text-white text-xs font-black disabled:opacity-50">
              {oneClickBusy ? '生成中' : '一键生成正文'}
            </button>
            {!!savedTip && <div className="text-[10px] text-emerald-600 font-bold">{savedTip}</div>}
            <div className="text-[10px] text-slate-400 font-bold">复杂操作在右侧高级功能中</div>
          </div>
        )}
      </div>

      <div className="flex-1 flex flex-col min-w-0">
        <div className="h-12 px-4 border-b border-slate-200 bg-white flex items-center justify-between">
          <div className="text-sm font-black text-slate-800">文稿中心</div>
          <div className="text-[11px] font-black text-slate-400">证据 → 生成 → 刷新</div>
        </div>
        <div className="h-10 px-4 border-b border-slate-100 bg-white flex items-center gap-2 text-slate-500">
          <div title="证据输入" className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center"><UIIcon.evidence /></div>
          <div className="text-[10px] font-black">→</div>
          <div title="正文生成" className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center"><UIIcon.draft /></div>
          <div className="text-[10px] font-black">→</div>
          <div title="自动化执行" className="w-6 h-6 rounded-md bg-slate-100 flex items-center justify-center"><UIIcon.auto /></div>
        </div>
        <div className="flex-1 grid grid-cols-1 xl:grid-cols-3 min-h-0">
          <div className="xl:col-span-2 border-r border-slate-200 bg-white p-3 min-h-0">
            <textarea
              value={activeDoc?.content || ''}
              onChange={(e) => updateDoc({ content: e.target.value })}
              className={`w-full h-full resize-none rounded-xl border border-slate-200 bg-white p-3 text-sm outline-none ${activeDoc?.format === 'word' ? 'leading-8 tracking-[0.02em]' : 'font-mono'}`}
              placeholder="开始写作..."
            />
          </div>
          <div className="hidden xl:block xl:col-span-1 border-r border-slate-200 bg-white p-3 overflow-y-auto">
            <div className={`mx-auto ${activeDoc?.format === 'word' ? 'max-w-[820px] bg-white shadow-sm border border-slate-200 rounded-2xl p-8' : ''}`}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeDoc?.content || ''}</ReactMarkdown>
            </div>
          </div>
          <div className="xl:col-span-1 bg-slate-50 p-3 overflow-y-auto space-y-3">
            <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2">
              <div className="text-xs font-black text-slate-700">一键写作</div>
              <input value={brief} onChange={(e) => setBrief(e.target.value)} className="w-full px-2 py-2 rounded-lg border border-slate-200 text-xs font-bold outline-none" placeholder="写什么（主题）" />
              <div className="grid grid-cols-2 gap-2">
                <input value={audience} onChange={(e) => setAudience(e.target.value)} className="w-full px-2 py-2 rounded-lg border border-slate-200 text-xs font-bold outline-none" placeholder="给谁看" />
                <input value={tone} onChange={(e) => setTone(e.target.value)} className="w-full px-2 py-2 rounded-lg border border-slate-200 text-xs font-bold outline-none" placeholder="风格" />
              </div>
              <button disabled={oneClickBusy} onClick={runOneClickWorkflow} className="w-full px-2 py-2 rounded-lg bg-slate-900 text-white text-xs font-black disabled:opacity-50">
                {oneClickBusy ? '生成中' : '一键生成可发布文稿'}
              </button>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2">
              <div className="text-xs font-black text-slate-700">证据结果</div>
              <div className="max-h-40 overflow-y-auto space-y-2">
                {citations.slice(0, 8).map((c) => (
                  <div key={c.id} className="p-2 rounded-lg border border-slate-200 bg-slate-50">
                    <div className="text-[11px] font-black text-slate-700 truncate">{c.title}</div>
                    <div className="text-[10px] text-slate-500 line-clamp-2">{c.excerpt}</div>
                    <button onClick={() => insertCitation(c)} className="mt-1 text-[10px] font-black text-indigo-600">插入</button>
                  </div>
                ))}
                {!citations.length && <div className="text-[11px] text-slate-400 font-bold">暂无证据</div>}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2">
              <div className="text-xs font-black text-slate-700">执行状态</div>
              <div className="max-h-24 overflow-y-auto rounded-lg bg-slate-50 border border-slate-200 p-2 space-y-1">
                {oneClickLog.map((line, idx) => (
                  <div key={`one-${idx}`} className="text-[10px] text-slate-600 font-bold">{line}</div>
                ))}
                {!oneClickLog.length && <div className="text-[10px] text-slate-400 font-bold">等待执行</div>}
              </div>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2">
              <button onClick={() => setShowAdvancedOps((v) => !v)} className="w-full px-2 py-2 rounded-lg border border-slate-200 text-[11px] font-black text-slate-700">
                {showAdvancedOps ? '收起高级功能' : '展开高级功能'}
              </button>
              {showAdvancedOps && (
                <div className="space-y-3">
                  <div className="rounded-xl border border-slate-200 bg-white p-2 space-y-2">
                    <div className="grid grid-cols-5 gap-1">
                      <button title="保存" onClick={handleSave} className="h-7 rounded-md bg-slate-900 text-white flex items-center justify-center"><UIIcon.save /></button>
                      <button title="导出 Markdown" onClick={exportMarkdown} className="h-7 rounded-md border border-slate-200 text-slate-700 flex items-center justify-center"><UIIcon.md /></button>
                      <button title="导出 Word" onClick={exportWord} className="h-7 rounded-md border border-slate-200 text-slate-700 flex items-center justify-center"><UIIcon.word /></button>
                      <button title="编辑模式" onClick={() => setViewMode('edit')} className={`h-7 rounded-md flex items-center justify-center ${viewMode === 'edit' ? 'bg-indigo-600 text-white' : 'border border-slate-200 text-slate-700'}`}><UIIcon.edit /></button>
                      <button title="预览模式" onClick={() => setViewMode('preview')} className={`h-7 rounded-md flex items-center justify-center ${viewMode === 'preview' ? 'bg-indigo-600 text-white' : 'border border-slate-200 text-slate-700'}`}><UIIcon.preview /></button>
                    </div>
                    <button title="删除当前文稿" onClick={() => activeDoc && deleteDoc(activeDoc.id)} className="w-full h-7 rounded-md border border-rose-200 bg-rose-50 text-rose-600 flex items-center justify-center"><UIIcon.trash /></button>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-2">
                    <div className="grid grid-cols-4 gap-1">
                      <button title="证据" onClick={() => setWorkflowTab('evidence')} className={`h-7 rounded-md flex items-center justify-center ${workflowTab === 'evidence' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}><UIIcon.evidence /></button>
                      <button title="写作" onClick={() => setWorkflowTab('draft')} className={`h-7 rounded-md flex items-center justify-center ${workflowTab === 'draft' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}><UIIcon.draft /></button>
                      <button title="自动化" onClick={() => setWorkflowTab('automation')} className={`h-7 rounded-md flex items-center justify-center ${workflowTab === 'automation' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}><UIIcon.auto /></button>
                      <button title="回写" onClick={() => setWorkflowTab('ops')} className={`h-7 rounded-md flex items-center justify-center ${workflowTab === 'ops' ? 'bg-indigo-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}><UIIcon.sync /></button>
                    </div>
                  </div>

                  {workflowTab === 'evidence' && (
                    <div className="space-y-2">
                      <input value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="w-full px-2 py-2 rounded-lg border border-slate-200 text-xs font-bold outline-none" placeholder="检索问题" />
                      <div className="flex items-center gap-2">
                        <input type="number" min={1} max={20} value={ragTopK} onChange={(e) => setRagTopK(Number(e.target.value || 6))} className="w-16 px-2 py-1.5 rounded-lg border border-slate-200 text-xs font-black outline-none" />
                        <button disabled={retrievalBusy} onClick={runKbRetrieve} className="flex-1 px-2 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-black disabled:opacity-50">{retrievalBusy ? '检索中' : '拉取证据'}</button>
                      </div>
                    </div>
                  )}

                  {workflowTab === 'draft' && (
                    <div className="space-y-2">
                      <textarea value={draftInstruction} onChange={(e) => setDraftInstruction(e.target.value)} rows={3} className="w-full px-2 py-2 rounded-lg border border-slate-200 text-xs font-bold outline-none" />
                      <button disabled={draftBusy} onClick={deepDraft} className="w-full px-2 py-2 rounded-lg bg-slate-900 text-white text-xs font-black disabled:opacity-50">{draftBusy ? '生成中' : '生成正文'}</button>
                    </div>
                  )}

                  {workflowTab === 'automation' && (
                    <div className="space-y-2">
                      <select value={selectedTemplateId} onChange={(e) => setSelectedTemplateId(e.target.value)} className="w-full px-2 py-2 rounded-lg border border-slate-200 text-xs font-black bg-white outline-none">
                        {interconnectTemplates.map((t) => (
                          <option key={String(t.id)} value={String(t.id)}>{String(t.name || t.id)}</option>
                        ))}
                      </select>
                      <textarea value={interconnectFormText} onChange={(e) => setInterconnectFormText(e.target.value)} rows={3} className="w-full px-2 py-2 rounded-lg border border-slate-200 text-xs font-mono outline-none" />
                      <button disabled={interconnectBusy} onClick={runInterconnect} className="w-full px-2 py-2 rounded-lg bg-indigo-600 text-white text-xs font-black disabled:opacity-50">{interconnectBusy ? '执行中' : '执行联网任务'}</button>
                      <textarea value={claudeInput} onChange={(e) => setClaudeInput(e.target.value)} rows={2} className="w-full px-2 py-2 rounded-lg border border-slate-200 text-xs font-bold outline-none" />
                      <button disabled={claudeBusy} onClick={runClaudeAutomation} className="w-full px-2 py-2 rounded-lg bg-slate-900 text-white text-xs font-black disabled:opacity-50">{claudeBusy ? '调用中' : '执行重构'}</button>
                      <button onClick={() => setShowAdvancedAutomation((v) => !v)} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] font-black text-slate-700">{showAdvancedAutomation ? '收起OpenClaw' : '展开OpenClaw'}</button>
                      {showAdvancedAutomation && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="text-[11px] font-black text-slate-700">OpenClaw</div>
                            <button disabled={capBusy} onClick={refreshCapabilities} className="text-[11px] font-black text-indigo-600">{capBusy ? '刷新中' : '刷新目录'}</button>
                          </div>
                          <select value={selectedSkillPath} onChange={(e) => setSelectedSkillPath(e.target.value)} className="w-full px-2 py-2 rounded-lg border border-slate-200 text-xs font-black bg-white outline-none">
                            {bridgeCapabilities.map((c, idx) => {
                              const path = String(c.path || '');
                              return <option key={`${path}-${idx}`} value={path}>{path || c.id || 'unknown'}</option>;
                            })}
                            {!bridgeCapabilities.length && <option value="/skills/kb/query">/skills/kb/query</option>}
                          </select>
                          <textarea value={skillBodyText} onChange={(e) => setSkillBodyText(e.target.value)} rows={3} className="w-full px-2 py-2 rounded-lg border border-slate-200 text-xs font-mono outline-none" />
                          <button disabled={skillBusy} onClick={runSelectedSkill} className="w-full px-2 py-2 rounded-lg bg-indigo-600 text-white text-xs font-black disabled:opacity-50">{skillBusy ? '执行中' : '执行能力'}</button>
                        </div>
                      )}
                    </div>
                  )}

                  {workflowTab === 'ops' && (
                    <div className="space-y-2">
                      <button onClick={onOpenConfig} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] font-black text-indigo-600">配置</button>
                      <div className="space-y-1 max-h-28 overflow-y-auto">
                        {tasks.map((x) => (
                          <button
                            key={String(x?.task?.id || '')}
                            onClick={() => onSelectTask(String(x?.task?.id || ''))}
                            className={`w-full text-left p-2 rounded-lg border ${activeTaskId === String(x?.task?.id || '') ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white'}`}
                          >
                            <div className="text-[11px] font-black text-slate-800 truncate">{x.projectTitle}</div>
                            <div className="text-[10px] text-slate-500 truncate">{String(x?.task?.task || x?.task?.title || '')}</div>
                          </button>
                        ))}
                        {tasks.length === 0 && <div className="text-[11px] text-slate-400 font-bold">暂无写作任务</div>}
                      </div>
                      {activeTaskData && (
                        <div className="space-y-2">
                          <select value={taskStatus} onChange={(e) => setTaskStatus(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] font-black bg-white">
                            <option value="todo">TODO</option>
                            <option value="doing">DOING</option>
                            <option value="in_progress">IN_PROGRESS</option>
                            <option value="completed">COMPLETED</option>
                            <option value="cancelled">CANCELLED</option>
                          </select>
                          <input value={taskEvidence} onChange={(e) => setTaskEvidence(e.target.value)} className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] font-bold bg-white outline-none" placeholder="证据链接(可选)" />
                          <button disabled={taskBusy} onClick={applyTaskUpdate} className="w-full px-2 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-black disabled:opacity-50">{taskBusy ? '提交中' : '回写状态'}</button>
                          {!!taskMsg && <div className="text-[10px] text-slate-600 font-bold">{taskMsg}</div>}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default WritingAssistant;
