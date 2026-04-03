import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Project, TeamMember } from '../../types';
import { buildHtmlReportData, renderReportHtml, type ReportGranularity, type ReportNarrative, type ReportPalette } from './reportHtml';

interface HtmlReportExportModalProps {
    isOpen: boolean;
    onClose: () => void;
    projects: Project[];
    teamMembers: TeamMember[];
}

const defaultGranularity: ReportGranularity = {
    includeProjectName: true,
    includeTime: true,
    includeOwners: true,
    includeTaskDetails: true,
    includeProjectStatus: true,
    includeAttachments: true,
    includeNodeMeta: true,
};

const defaultPalette: ReportPalette = {
    bg: '#f8fafc',
    card: '#ffffff',
    text: '#0f172a',
    muted: '#64748b',
    primary: '#4f46e5',
    accent: '#0ea5e9',
    border: '#e2e8f0',
    pending: '#ef4444',
    inProgress: '#facc15',
    done: '#22c55e',
    urgent: '#f97316',
};

const joinPath = (folder: string, file: string) => {
    const sep = folder.includes('\\') ? '\\' : '/';
    const f = folder.endsWith(sep) ? folder.slice(0, -1) : folder;
    return `${f}${sep}${file}`;
};

const safeJson = (text: string) => {
    const t = text.trim();
    const cleaned = t.startsWith('```') ? t.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '') : t;
    return JSON.parse(cleaned);
};

type ReportMode = 'LLM' | 'Template';

const stripCodeFences = (text: string) => {
    const t = (text || '').trim();
    if (!t.startsWith('```')) return t;
    return t.replace(/^```[a-zA-Z]*\n/, '').replace(/\n```$/, '').trim();
};

const sanitizeHtmlForPreview = (rawHtml: string) => {
    const html = stripCodeFences(rawHtml);
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');

    const warnings: string[] = [];

    doc.querySelectorAll('script, iframe, object, embed').forEach((el) => {
        el.remove();
    });

    doc.querySelectorAll('link[rel="stylesheet"]').forEach((el) => {
        const href = el.getAttribute('href') || '';
        if (href && !href.startsWith('data:')) {
            el.remove();
            warnings.push(`已移除外链样式：${href}`);
        }
    });

    doc.querySelectorAll('*').forEach((el) => {
        [...el.attributes].forEach((a) => {
            const n = a.name.toLowerCase();
            if (n.startsWith('on')) el.removeAttribute(a.name);
            if (n === 'src' || n === 'href') {
                const v = (a.value || '').trim();
                if (v.startsWith('http://') || v.startsWith('https://')) {
                    el.removeAttribute(a.name);
                    warnings.push(`已移除外链资源：${v}`);
                }
            }
        });
    });

    const head = doc.head || doc.querySelector('head') || doc.documentElement;
    if (!doc.querySelector('meta[charset]')) {
        const meta = doc.createElement('meta');
        meta.setAttribute('charset', 'utf-8');
        head.prepend(meta);
    }

    if (!doc.querySelector('meta[http-equiv="Content-Security-Policy"]')) {
        const csp = doc.createElement('meta');
        csp.setAttribute('http-equiv', 'Content-Security-Policy');
        csp.setAttribute(
            'content',
            "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline' data:; font-src data:; connect-src 'none'; frame-src 'none'; media-src data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'"
        );
        head.appendChild(csp);
    }

    if (!doc.querySelector('meta[name="viewport"]')) {
        const vp = doc.createElement('meta');
        vp.setAttribute('name', 'viewport');
        vp.setAttribute('content', 'width=device-width, initial-scale=1');
        head.appendChild(vp);
    }

    const baseCss = doc.createElement('style');
    baseCss.textContent = `
html, body { height: 100%; }
body { margin: 0; overflow: auto; -webkit-font-smoothing: antialiased; }
* { box-sizing: border-box; }
`;
    head.appendChild(baseCss);

    return { html: '<!doctype html>\n' + doc.documentElement.outerHTML, warnings };
};

const extractEditableFields = (html: string) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const els = Array.from(doc.querySelectorAll('[data-edit]')) as HTMLElement[];
    const fields = els
        .map((el) => {
            const key = el.getAttribute('data-edit') || '';
            if (!key) return null;
            const value = (el.textContent || '').trim();
            return { key, value };
        })
        .filter(Boolean) as Array<{ key: string; value: string }>;

    const seen = new Set<string>();
    return fields.filter((f) => {
        if (seen.has(f.key)) return false;
        seen.add(f.key);
        return true;
    });
};

const applyEditableFields = (html: string, patch: Record<string, string>) => {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    Object.entries(patch).forEach(([key, value]) => {
        const el = doc.querySelector(`[data-edit="${CSS.escape(key)}"]`);
        if (el) el.textContent = value;
    });
    return '<!doctype html>\n' + doc.documentElement.outerHTML;
};

const HtmlReportExportModal: React.FC<HtmlReportExportModalProps> = ({ isOpen, onClose, projects, teamMembers }) => {
    const activeProjects = useMemo(() => projects.filter((p) => p.status !== 'Archived'), [projects]);
    const [selectedIds, setSelectedIds] = useState<string[]>(() => activeProjects.map((p) => p.id));
    const [granularity, setGranularity] = useState<ReportGranularity>(defaultGranularity);
    const [palette, setPalette] = useState<ReportPalette>(defaultPalette);
    const [narrative, setNarrative] = useState<ReportNarrative>(() => ({
        title: '项目情况同步',
        intro: '本报告用于对外同步项目现状与关键风险点，可离线打开并支持 PPT 页面级放大演示。',
        projectNotes: {},
    }));

    const [styleRefUrl, setStyleRefUrl] = useState('');
    const [styleRefImage, setStyleRefImage] = useState<{ name: string; data: string } | null>(null);
    const [aiLoadingStyle, setAiLoadingStyle] = useState(false);
    const [aiLoadingCopy, setAiLoadingCopy] = useState(false);
    const [aiError, setAiError] = useState('');

    const [mode, setMode] = useState<ReportMode>('LLM');
    const [llmPrompt, setLlmPrompt] = useState('');
    const [llmLoading, setLlmLoading] = useState(false);
    const [llmHtmlRaw, setLlmHtmlRaw] = useState('');
    const [llmWarnings, setLlmWarnings] = useState<string[]>([]);
    const [editableFields, setEditableFields] = useState<Array<{ key: string; value: string }>>([]);

    const selectedProjects = useMemo(() => {
        const set = new Set(selectedIds);
        return activeProjects.filter((p) => set.has(p.id));
    }, [activeProjects, selectedIds]);

    const reportData = useMemo(() => buildHtmlReportData(activeProjects, teamMembers, selectedIds), [activeProjects, selectedIds, teamMembers]);

    const templateHtml = useMemo(() => {
        return renderReportHtml(reportData, granularity, palette, narrative);
    }, [granularity, narrative, palette, reportData]);

    const defaultGeneratedPrompt = useMemo(() => {
        const payload = {
            requirements: {
                offline: true,
                noExternalResources: true,
                noJs: true,
                responsive: true,
                avoidOverflow: true,
                language: 'zh-CN',
                editableMarkers: [
                    'data-edit="title"',
                    'data-edit="intro"',
                    'data-edit="project:<projectId>"（项目页备注）',
                ],
            },
            granularity,
            palette,
            narrative: {
                title: narrative.title,
                intro: narrative.intro,
                projectNotes: narrative.projectNotes,
            },
            data: reportData,
        };

        const requirementsText = [
            '请生成一个“静态网页 HTML”，用于对外汇报项目进展（无需任何外链资源、离线可打开）。',
            '',
            '硬性要求：',
            '1) 只输出完整 HTML（包含 <!doctype html>），不要 markdown，不要解释。',
            '2) 不要使用任何外部链接/外部字体/外部脚本：所有 CSS 必须内联在 <style> 内；不要 <script>。',
            '3) 页面必须响应式，不要固定高度导致遮挡；正文区域必须允许滚动（不要全局 overflow:hidden）。',
            '4) 风格高级、现代、适合投屏汇报：卡片化、留白、清晰的信息层级。',
            '5) 需要对“标题/导语/每个项目备注”支持后续局部编辑：请把这些文本放在带 data-edit 的元素中：',
            '   - 标题：data-edit="title"',
            '   - 导语：data-edit="intro"',
            '   - 每个项目备注：data-edit="project:<projectId>"（projectId 来自数据）',
            '6) 任务明细如果过多，应分页/折叠/摘要，不能把页面撑爆。',
            '',
            '输入数据（JSON）：',
            '```json',
            JSON.stringify(payload, null, 2),
            '```',
        ].join('\n');

        return requirementsText;
    }, [granularity, narrative.intro, narrative.projectNotes, narrative.title, palette, reportData]);

    useEffect(() => {
        if (!isOpen) return;
        if (!llmPrompt.trim()) setLlmPrompt(defaultGeneratedPrompt);
    }, [defaultGeneratedPrompt, isOpen, llmPrompt]);

    const activeHtml = useMemo(() => {
        if (mode === 'LLM') {
            if (!llmHtmlRaw.trim()) return '';
            const sanitized = sanitizeHtmlForPreview(llmHtmlRaw);
            return sanitized.html;
        }
        return templateHtml;
    }, [llmHtmlRaw, mode, templateHtml]);

    useEffect(() => {
        if (!isOpen) return;
        if (mode !== 'LLM') return;
        if (!llmHtmlRaw.trim()) {
            setEditableFields([]);
            setLlmWarnings([]);
            return;
        }
        const sanitized = sanitizeHtmlForPreview(llmHtmlRaw);
        setLlmWarnings(sanitized.warnings);
        setEditableFields(extractEditableFields(sanitized.html));
    }, [isOpen, llmHtmlRaw, mode]);

    const toggleAll = useCallback(
        (next: boolean) => {
            setSelectedIds(next ? activeProjects.map((p) => p.id) : []);
        },
        [activeProjects]
    );

    const toggleOne = useCallback((id: string) => {
        setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    }, []);

    const selectStyleImage = useCallback(async () => {
        setAiError('');
        try {
            const file = await window.electronAPI?.fs?.selectFile?.({
                filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
            });
            if (!file) return;
            setStyleRefImage({ name: file.name, data: file.data });
        } catch (e: any) {
            setAiError(e?.message || '选择图片失败');
        }
    }, []);

    const generateByLlm = useCallback(async () => {
        setAiError('');
        setLlmLoading(true);
        try {
            const prompt = llmPrompt.trim();
            if (!prompt) throw new Error('请先填写生成提示词');
            const res = await window.electronAPI?.knowledge?.completion?.({ prompt });
            if (!res?.success) throw new Error(res?.error || 'LLM 调用失败（可能未配置模型或网络不可用）');
            setLlmHtmlRaw(stripCodeFences(res.text || ''));
        } catch (e: any) {
            setAiError(e?.message || '生成失败');
        } finally {
            setLlmLoading(false);
        }
    }, [llmPrompt]);

    const patchField = useCallback((key: string, value: string) => {
        if (mode !== 'LLM') return;
        const sanitized = sanitizeHtmlForPreview(llmHtmlRaw);
        const patched = applyEditableFields(sanitized.html, { [key]: value });
        setLlmHtmlRaw(patched);
    }, [llmHtmlRaw, mode]);

    const runStyleAnalysis = useCallback(async () => {
        setAiError('');
        setAiLoadingStyle(true);
        try {
            const hasImg = !!styleRefImage?.data;
            const hasUrl = !!styleRefUrl.trim();
            if (!hasImg && !hasUrl) throw new Error('请先上传图片或填写网页链接');

            const prompt = [
                '你是一个 UI 视觉风格分析助手。请根据给定参考，输出一个适合“项目汇报HTML”的配色方案 JSON。',
                '',
                '输出要求：只输出 JSON，不要解释。',
                'JSON schema：',
                '{',
                '  "bg":"#RRGGBB",',
                '  "card":"#RRGGBB",',
                '  "text":"#RRGGBB",',
                '  "muted":"#RRGGBB",',
                '  "primary":"#RRGGBB",',
                '  "accent":"#RRGGBB",',
                '  "border":"#RRGGBB",',
                '  "pending":"#RRGGBB",',
                '  "inProgress":"#RRGGBB",',
                '  "done":"#RRGGBB",',
                '  "urgent":"#RRGGBB"',
                '}',
                '',
                hasUrl ? `网页链接：${styleRefUrl.trim()}` : '',
                hasImg ? `参考图片（base64, ${styleRefImage!.name}）：${styleRefImage!.data.slice(0, 1200)}...` : '',
            ]
                .filter(Boolean)
                .join('\n');

            const res = await window.electronAPI?.knowledge?.completion?.({ prompt });
            if (!res?.success) throw new Error(res?.error || 'LLM 调用失败');
            const parsed = safeJson(res.text || '');
            setPalette((p) => ({ ...p, ...parsed }));
        } catch (e: any) {
            setAiError(e?.message || '风格分析失败');
        } finally {
            setAiLoadingStyle(false);
        }
    }, [styleRefImage, styleRefUrl]);

    const runCopyAssist = useCallback(async () => {
        setAiError('');
        setAiLoadingCopy(true);
        try {
            const payload = {
                title: narrative.title,
                intro: narrative.intro,
                projectNotes: narrative.projectNotes,
                projects: selectedProjects.map((p) => ({
                    id: p.id,
                    title: p.title,
                    status: p.status,
                    startDate: p.startDate,
                    milestones: (p.milestones || []).slice(0, 60).map((m) => ({
                        stage: m.stage,
                        task: m.task,
                        status: m.status,
                        completionDate: m.completionDate,
                        chargePerson: m.chargePerson,
                    })),
                })),
            };

            const prompt = [
                '你是一个对外项目同步的撰稿助手。请基于给定 JSON，生成更专业、更精炼、可演示的中文文案。',
                '',
                '要求：',
                '1) 输出只返回 JSON，不要解释。',
                '2) schema：{ "title": string, "intro": string, "projectNotes": { [projectId]: string } }',
                '3) intro 不超过 120 字；每个 projectNotes 不超过 80 字；避免夸张，强调客观事实与行动建议。',
                '',
                '数据：',
                '```json',
                JSON.stringify(payload, null, 2),
                '```',
            ].join('\n');

            const res = await window.electronAPI?.knowledge?.completion?.({ prompt });
            if (!res?.success) throw new Error(res?.error || 'LLM 调用失败');
            const parsed = safeJson(res.text || '');
            setNarrative((prev) => ({
                title: typeof parsed?.title === 'string' ? parsed.title : prev.title,
                intro: typeof parsed?.intro === 'string' ? parsed.intro : prev.intro,
                projectNotes: typeof parsed?.projectNotes === 'object' && parsed?.projectNotes ? { ...prev.projectNotes, ...parsed.projectNotes } : prev.projectNotes,
            }));
        } catch (e: any) {
            setAiError(e?.message || 'AI 文案失败');
        } finally {
            setAiLoadingCopy(false);
        }
    }, [narrative, selectedProjects]);

    const saveHtml = useCallback(async () => {
        setAiError('');
        try {
            const folder = await window.electronAPI?.fs?.selectFolder?.();
            if (!folder) return;
            const safeTitle = (narrative.title || '项目情况同步').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
            const fileName = `${safeTitle}-${new Date().toISOString().slice(0, 10)}.html`;
            const fullPath = joinPath(folder, fileName);
            const res = await window.electronAPI?.fs?.writeFile?.(fullPath, activeHtml, { encoding: 'utf8' });
            if (!res?.success) throw new Error(res?.error || '保存失败');
            await window.electronAPI?.fs?.openPath?.(fullPath);
        } catch (e: any) {
            setAiError(e?.message || '保存失败');
        }
    }, [activeHtml, narrative.title]);

    const exportPdf = useCallback(async () => {
        setAiError('');
        try {
            const api = (window as any).electronAPI;
            if (!api?.exportFile) throw new Error('导出功能仅在桌面版可用');
            const safeTitle = (narrative.title || '项目情况同步').replace(/[\\/:*?"<>|]/g, '_').slice(0, 60);
            const res = await api.exportFile({
                content: activeHtml,
                type: 'html',
                format: 'pdf',
                defaultName: `${safeTitle}-${new Date().toISOString().slice(0, 10)}.pdf`,
            });
            if (!res?.success && res?.error) throw new Error(res.error);
        } catch (e: any) {
            setAiError(e?.message || '导出 PDF 失败');
        }
    }, [activeHtml, narrative.title]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in">
            <div className="bg-white w-full h-full rounded-3xl shadow-2xl border border-slate-100 overflow-hidden flex flex-col">
                <div className="p-4 border-b border-slate-200 bg-white flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black">⇩</div>
                        <div className="leading-tight">
                            <div className="text-sm font-black text-slate-800">导出可交互 HTML 汇报</div>
                            <div className="text-[10px] font-bold text-slate-400">离线打开 · 支持 PPT 页面放大 · 文案可编辑</div>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="flex items-center bg-slate-100 p-1 rounded-full border border-slate-200 mr-2">
                            <button
                                onClick={() => setMode('LLM')}
                                className={`px-3 py-2 rounded-full text-xs font-black transition-colors ${
                                    mode === 'LLM' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                }`}
                            >
                                LLM生成
                            </button>
                            <button
                                onClick={() => setMode('Template')}
                                className={`px-3 py-2 rounded-full text-xs font-black transition-colors ${
                                    mode === 'Template' ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                                }`}
                            >
                                模板生成
                            </button>
                        </div>
                        <button
                            onClick={runCopyAssist}
                            disabled={mode !== 'Template' || aiLoadingCopy || selectedIds.length === 0}
                            className={`px-3 py-2 rounded-full text-xs font-black border ${
                                mode !== 'Template' || aiLoadingCopy || selectedIds.length === 0
                                    ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                                    : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                            }`}
                        >
                            {aiLoadingCopy ? 'AI生成中…' : 'AI文案'}
                        </button>
                        <button
                            onClick={generateByLlm}
                            disabled={mode !== 'LLM' || llmLoading || selectedIds.length === 0}
                            className={`px-3 py-2 rounded-full text-xs font-black border ${
                                mode !== 'LLM' || llmLoading || selectedIds.length === 0
                                    ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                                    : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                            }`}
                        >
                            {llmLoading ? '生成中…' : '生成HTML'}
                        </button>
                        <button
                            onClick={exportPdf}
                            disabled={selectedIds.length === 0 || !activeHtml}
                            className={`px-3 py-2 rounded-full text-xs font-black border ${
                                selectedIds.length === 0 || !activeHtml
                                    ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                                    : 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                            }`}
                        >
                            导出PDF
                        </button>
                        <button
                            onClick={saveHtml}
                            disabled={selectedIds.length === 0 || !activeHtml}
                            className={`px-3 py-2 rounded-full text-xs font-black border ${
                                selectedIds.length === 0 || !activeHtml
                                    ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                                    : 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                            }`}
                        >
                            保存HTML
                        </button>
                        <button onClick={onClose} className="px-3 py-2 rounded-full text-xs font-black bg-white border border-slate-200 text-slate-600 hover:bg-slate-50">
                            ✕ 关闭
                        </button>
                    </div>
                </div>

                <div className="flex-1 min-h-0 grid grid-cols-[420px_1fr]">
                    <div className="border-r border-slate-200 p-4 overflow-auto">
                        <div className="text-xs font-black text-slate-800 mb-2">项目选择</div>
                        <div className="flex gap-2 mb-3">
                            <button onClick={() => toggleAll(true)} className="px-3 py-1.5 rounded-full text-[11px] font-black bg-slate-50 border border-slate-200 text-slate-700 hover:bg-slate-100">
                                全选
                            </button>
                            <button onClick={() => toggleAll(false)} className="px-3 py-1.5 rounded-full text-[11px] font-black bg-white border border-slate-200 text-slate-600 hover:bg-slate-50">
                                清空
                            </button>
                            <div className="ml-auto text-[10px] font-bold text-slate-400 self-center">已选 {selectedIds.length} / {activeProjects.length}</div>
                        </div>

                        <div className="space-y-2">
                            {activeProjects.map((p) => {
                                const checked = selectedIds.includes(p.id);
                                return (
                                    <label key={p.id} className={`flex items-start gap-3 rounded-xl border px-3 py-2 cursor-pointer transition-colors ${checked ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-slate-200 hover:bg-slate-50'}`}>
                                        <input type="checkbox" checked={checked} onChange={() => toggleOne(p.id)} className="mt-1 accent-indigo-600" />
                                        <div className="min-w-0">
                                            <div className="text-[12px] font-black text-slate-800 truncate">{p.title}</div>
                                            <div className="text-[10px] font-bold text-slate-400 mt-1">
                                                {p.startDate} · {p.status}
                                            </div>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>

                        <div className="mt-6">
                            <div className="text-xs font-black text-slate-800 mb-2">颗粒度</div>
                            <div className="grid grid-cols-2 gap-2">
                                {(
                                    [
                                        ['includeProjectName', '项目名'],
                                        ['includeTime', '时间'],
                                        ['includeOwners', '负责人'],
                                        ['includeTaskDetails', '任务明细'],
                                        ['includeProjectStatus', '项目状态'],
                                        ['includeAttachments', '相关附件'],
                                        ['includeNodeMeta', '节点元数据'],
                                    ] as const
                                ).map(([k, label]) => (
                                    <label key={k} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                        <span className="text-[11px] font-black text-slate-700">{label}</span>
                                        <input
                                            type="checkbox"
                                            checked={granularity[k]}
                                            onChange={(e) => setGranularity((prev) => ({ ...prev, [k]: e.target.checked }))}
                                            className="accent-indigo-600"
                                        />
                                    </label>
                                ))}
                            </div>
                        </div>

                        {mode === 'LLM' ? (
                            <div className="mt-6">
                                <div className="text-xs font-black text-slate-800 mb-2">生成提示词（可编辑）</div>
                                <textarea
                                    value={llmPrompt}
                                    onChange={(e) => setLlmPrompt(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-[11px] leading-relaxed font-mono outline-none focus:border-indigo-300 resize-none"
                                    rows={12}
                                />
                                <div className="mt-2 text-[10px] text-slate-400">
                                    建议让 LLM 输出带 data-edit 标记的文本节点，这样右侧可以做“局部内容编辑”。
                                </div>

                                {llmWarnings.length ? (
                                    <div className="mt-3 bg-amber-50 border border-amber-200 text-amber-800 rounded-xl p-3 text-[11px] font-semibold">
                                        {llmWarnings.slice(0, 5).map((w, i) => (
                                            <div key={i}>{w}</div>
                                        ))}
                                        {llmWarnings.length > 5 ? <div>…</div> : null}
                                    </div>
                                ) : null}

                                {editableFields.length ? (
                                    <div className="mt-4">
                                        <div className="text-xs font-black text-slate-800 mb-2">局部内容编辑（data-edit）</div>
                                        <div className="space-y-2">
                                            {editableFields.slice(0, 12).map((f) => (
                                                <div key={f.key} className="rounded-xl border border-slate-200 bg-white p-3">
                                                    <div className="text-[10px] font-black text-slate-500 mb-1">{f.key}</div>
                                                    <textarea
                                                        value={f.value}
                                                        onChange={(e) => {
                                                            const v = e.target.value;
                                                            setEditableFields((prev) => prev.map((x) => (x.key === f.key ? { ...x, value: v } : x)));
                                                            patchField(f.key, v);
                                                        }}
                                                        className="w-full px-2 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:border-indigo-300 resize-none"
                                                        rows={2}
                                                    />
                                                </div>
                                            ))}
                                            {editableFields.length > 12 ? <div className="text-[10px] text-slate-400">仅展示前 12 个可编辑字段</div> : null}
                                        </div>
                                    </div>
                                ) : (
                                    llmHtmlRaw ? <div className="mt-4 text-[10px] text-slate-400">未检测到 data-edit 字段；仍可在下方“HTML源码”直接编辑。</div> : null
                                )}

                                {llmHtmlRaw ? (
                                    <div className="mt-4">
                                        <div className="text-xs font-black text-slate-800 mb-2">HTML 源码（高级编辑）</div>
                                        <textarea
                                            value={llmHtmlRaw}
                                            onChange={(e) => setLlmHtmlRaw(e.target.value)}
                                            className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-[11px] leading-relaxed font-mono outline-none focus:border-indigo-300 resize-none"
                                            rows={10}
                                        />
                                    </div>
                                ) : null}
                            </div>
                        ) : (
                            <div className="mt-6">
                                <div className="text-xs font-black text-slate-800 mb-2">文案编辑</div>
                                <label className="block text-[10px] font-bold text-slate-400 mb-1">标题</label>
                                <input
                                    value={narrative.title}
                                    onChange={(e) => setNarrative((p) => ({ ...p, title: e.target.value }))}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-sm font-bold outline-none focus:border-indigo-300"
                                />
                                <label className="block text-[10px] font-bold text-slate-400 mb-1 mt-3">导语（建议≤120字）</label>
                                <textarea
                                    value={narrative.intro}
                                    onChange={(e) => setNarrative((p) => ({ ...p, intro: e.target.value }))}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs outline-none focus:border-indigo-300 resize-none"
                                    rows={4}
                                />
                                <div className="mt-3 text-[10px] font-bold text-slate-400">项目备注（用于每个项目页标题下方）</div>
                                <div className="mt-2 space-y-2">
                                    {selectedProjects.slice(0, 8).map((p) => (
                                        <div key={p.id} className="rounded-xl border border-slate-200 bg-white p-3">
                                            <div className="text-[11px] font-black text-slate-800 truncate">{p.title}</div>
                                            <textarea
                                                value={narrative.projectNotes[p.id] || ''}
                                                onChange={(e) => setNarrative((prev) => ({ ...prev, projectNotes: { ...prev.projectNotes, [p.id]: e.target.value } }))}
                                                className="mt-2 w-full px-2 py-2 rounded-lg border border-slate-200 bg-slate-50 text-xs outline-none focus:border-indigo-300 resize-none"
                                                rows={2}
                                                placeholder="可填写对外同步的一句话总结/关键风险/下一步行动"
                                            />
                                        </div>
                                    ))}
                                    {selectedProjects.length > 8 ? <div className="text-[10px] text-slate-400">仅展示前 8 个项目备注，其余项目将使用空备注。</div> : null}
                                </div>
                            </div>
                        )}

                        <div className="mt-6">
                            <div className="text-xs font-black text-slate-800 mb-2">视觉风格（可选）</div>
                            <div className="flex gap-2">
                                <button onClick={selectStyleImage} className="px-3 py-2 rounded-full text-xs font-black bg-white border border-slate-200 text-slate-700 hover:bg-slate-50">
                                    上传图片
                                </button>
                                <button
                                    onClick={runStyleAnalysis}
                                    disabled={mode !== 'Template' || aiLoadingStyle}
                                    className={`px-3 py-2 rounded-full text-xs font-black border ${
                                        mode !== 'Template' || aiLoadingStyle
                                            ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed'
                                            : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                                    }`}
                                >
                                    {aiLoadingStyle ? '分析中…' : '分析风格'}
                                </button>
                            </div>
                            {styleRefImage ? <div className="mt-2 text-[10px] font-bold text-slate-500">已选图片：{styleRefImage.name}</div> : null}
                            <div className="mt-3">
                                <label className="block text-[10px] font-bold text-slate-400 mb-1">网页链接（可选）</label>
                                <input
                                    value={styleRefUrl}
                                    onChange={(e) => setStyleRefUrl(e.target.value)}
                                    className="w-full px-3 py-2 rounded-xl border border-slate-200 bg-white text-xs outline-none focus:border-indigo-300"
                                    placeholder="https://example.com"
                                />
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                                {(
                                    [
                                        ['primary', '主色'],
                                        ['accent', '强调'],
                                        ['bg', '背景'],
                                        ['card', '卡片'],
                                        ['text', '文字'],
                                        ['border', '边框'],
                                        ['pending', '未完成'],
                                        ['inProgress', '进行中'],
                                        ['done', '完成'],
                                        ['urgent', '临期'],
                                    ] as const
                                ).map(([k, label]) => (
                                    <label key={k} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                                        <span className="text-[10px] font-black text-slate-700">{label}</span>
                                        <input type="color" value={(palette as any)[k]} onChange={(e) => setPalette((p) => ({ ...p, [k]: e.target.value } as any))} className="w-9 h-7 bg-transparent" />
                                    </label>
                                ))}
                            </div>
                        </div>

                        {aiError ? <div className="mt-4 bg-red-50 border border-red-200 text-red-600 rounded-xl p-3 text-[11px] font-semibold">{aiError}</div> : null}
                    </div>

                    <div className="p-0 bg-slate-100 relative">
                        {activeHtml ? (
                            <iframe title="report-preview" className="w-full h-full border-0 bg-white" sandbox="" srcDoc={activeHtml} />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-slate-400 text-sm font-bold">
                                {mode === 'LLM' ? '请先点击“生成HTML”' : '请选择项目并生成内容'}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default HtmlReportExportModal;
