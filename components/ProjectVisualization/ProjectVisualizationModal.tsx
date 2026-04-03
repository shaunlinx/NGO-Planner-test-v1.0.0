import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    Background,
    Controls,
    ReactFlow,
    useEdgesState,
    useNodesState,
    useReactFlow,
    ReactFlowProvider,
    type Edge,
    type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import BubbleNode from './BubbleNode';
import { applyForceLayout } from './forceLayout';
import { buildGraph, type VisualizationStyle, type VisualizationView } from './graphBuilders';
import { computeOfflineInsights } from './insights';
import HtmlReportExportModal from './HtmlReportExportModal';
import type { Project, TeamMember } from '../../types';

interface ProjectVisualizationModalProps {
    isOpen: boolean;
    onClose: () => void;
    projects: Project[];
    teamMembers: TeamMember[];
}

const viewLabel: Record<VisualizationView, string> = {
    people: '人员视图',
    projects: '项目视图',
    relations: '关系视图',
    resources: '资源视图',
};

const defaultStyle: VisualizationStyle = {
    edgeType: 'smoothstep',
    edgeColor: '#94a3b8',
    edgeWidth: 1.6,
    palette: {
        pending: '#ef4444',
        inProgress: '#facc15',
        done: '#22c55e',
        urgent: '#f97316',
        financeOk: '#22c55e',
        financeBad: '#ef4444',
        financeUnknown: '#94a3b8',
        ownerStroke: '#6366f1',
        projectStroke: '#0ea5e9',
        docStroke: '#e2e8f0',
        neutralStroke: '#cbd5e1',
        neutralFill: '#f1f5f9',
        neutralText: '#0f172a',
    },
};

const mergePositions = (prev: Node[], next: Node[]) => {
    const map = new Map(prev.map((n) => [n.id, n.position] as const));
    return next.map((n) => {
        const p = map.get(n.id);
        if (!p) return n;
        return { ...n, position: p };
    });
};

const hashSeed = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
};

const seedNewPositions = (prev: Node[], next: Node[], nextEdges: Edge[]) => {
    const prevPos = new Map(prev.map((n) => [n.id, n.position] as const));
    const pos = new Map(next.map((n) => [n.id, n.position] as const));
    const missing = next.filter((n) => !prevPos.has(n.id));
    if (missing.length === 0) return next;

    const neighbors = new Map<string, string[]>();
    nextEdges.forEach((e) => {
        if (!neighbors.has(e.source)) neighbors.set(e.source, []);
        if (!neighbors.has(e.target)) neighbors.set(e.target, []);
        neighbors.get(e.source)!.push(e.target);
        neighbors.get(e.target)!.push(e.source);
    });

    const jitter = (id: string) => {
        const seed = hashSeed(id);
        const a = ((seed % 360) * Math.PI) / 180;
        const r = 50 + (seed % 60);
        return { dx: Math.cos(a) * r, dy: Math.sin(a) * r };
    };

    const seeded: Node[] = [];
    missing.forEach((n) => {
        const ns = neighbors.get(n.id) || [];
        const anchor = ns.map((x) => pos.get(x)).find((p) => p && (p.x !== 0 || p.y !== 0));
        if (anchor) {
            const j = jitter(n.id);
            pos.set(n.id, { x: anchor.x + j.dx, y: anchor.y + j.dy });
            seeded.push({ ...n, position: { x: anchor.x + j.dx, y: anchor.y + j.dy } });
        }
    });

    if (seeded.length === 0) return next;
    return next.map((n) => {
        if (!pos.has(n.id)) return n;
        const p = pos.get(n.id)!;
        if (p.x === 0 && p.y === 0) return n;
        return { ...n, position: p };
    });
};

const getContainerSize = (el: HTMLDivElement | null) => {
    if (!el) return { width: 1100, height: 760 };
    const r = el.getBoundingClientRect();
    return { width: Math.max(720, r.width), height: Math.max(520, r.height) };
};

const VisualizationInner: React.FC<ProjectVisualizationModalProps> = ({ isOpen, onClose, projects, teamMembers }) => {
    const [view, setView] = useState<VisualizationView>('people');
    const [style, setStyle] = useState<VisualizationStyle>(() => {
        try {
            const raw = localStorage.getItem('ngo.visualization.style');
            if (!raw) return defaultStyle;
            const parsed = JSON.parse(raw);
            return {
                ...defaultStyle,
                ...parsed,
                palette: { ...defaultStyle.palette, ...(parsed?.palette || {}) },
            };
        } catch {
            return defaultStyle;
        }
    });

    const [expandedDocs, setExpandedDocs] = useState<Record<string, boolean>>({});
    const [docChunks, setDocChunks] = useState<Record<string, { status: 'idle' | 'loading' | 'ready' | 'error'; filePath: string; chunks: any[] }>>(
        {}
    );
    const [builtModel, setBuiltModel] = useState<any>(null);
    const offlineInsights = useMemo(() => computeOfflineInsights(builtModel?.tasks || [], projects), [builtModel, projects]);

    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const rf = useReactFlow();
    const canvasRef = useRef<HTMLDivElement | null>(null);
    const latestRef = useRef<{
        projects: Project[];
        teamMembers: TeamMember[];
        style: VisualizationStyle;
        expandedDocs: Record<string, boolean>;
        docChunks: Record<string, { status: 'idle' | 'loading' | 'ready' | 'error'; filePath: string; chunks: any[] }>;
        view: VisualizationView;
    }>({ projects, teamMembers, style, expandedDocs, docChunks, view });
    latestRef.current = { projects, teamMembers, style, expandedDocs, docChunks, view };

    const [showStylePanel, setShowStylePanel] = useState(false);
    const [showAiPanel, setShowAiPanel] = useState(false);
    const [showExportPanel, setShowExportPanel] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);
    const [aiText, setAiText] = useState<string>('');
    const [aiError, setAiError] = useState<string>('');

    const legendRef = useRef<HTMLDivElement | null>(null);
    const dragOffsetRef = useRef<{ x: number; y: number } | null>(null);
    const [isDraggingLegend, setIsDraggingLegend] = useState(false);
    const [legendPos, setLegendPos] = useState<{ x: number; y: number } | null>(() => {
        try {
            const raw = localStorage.getItem('ngo.visualization.legendPos');
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') return { x: parsed.x, y: parsed.y };
            return null;
        } catch {
            return null;
        }
    });

    useEffect(() => {
        try {
            localStorage.setItem('ngo.visualization.style', JSON.stringify(style));
        } catch {}
    }, [style]);

    const buildAiPrompt = useCallback(() => {
        const payload = {
            view,
            generatedAt: new Date().toISOString(),
            summary: {
                tasks: (builtModel?.tasks || []).length,
                ownerConflicts: offlineInsights.ownerConflicts.length,
                projectConflicts: offlineInsights.projectConflicts.length,
                clusters: offlineInsights.tightClusters.length,
            },
            insights: offlineInsights,
            tasks: (builtModel?.tasks || []).slice(0, 220),
        };

        return [
            '你是一个项目排期与资源冲突分析助手。请基于给定的 JSON 数据生成“建议/预警/可并行机会”。',
            '',
            '要求：',
            '1) 输出用中文 Markdown。',
            '2) 分成：总览、冲突预警、可并行机会、对负责人协作建议、对项目层面的风险建议、可立即执行的行动清单。',
            '3) 不要复述原始数据；给出可执行、可落地的建议，并标注触发依据（例如：某负责人在 2 天内有 3 个未完成任务）。',
            '',
            'JSON 数据：',
            '```json',
            JSON.stringify(payload, null, 2),
            '```',
        ].join('\n');
    }, [builtModel, offlineInsights, view]);

    const runAiAnalysis = useCallback(async () => {
        setAiLoading(true);
        setAiError('');
        setAiText('');
        try {
            const prompt = buildAiPrompt();
            // @ts-ignore
            const res = await window.electronAPI?.knowledge?.completion?.({ prompt });
            if (!res?.success) throw new Error(res?.error || 'LLM 调用失败（可能未配置模型或网络不可用）');
            setAiText(res.text || '');
        } catch (e: any) {
            setAiError(e?.message || 'LLM 调用失败');
        } finally {
            setAiLoading(false);
        }
    }, [buildAiPrompt]);

    const applyGraph = useCallback(
        (params: {
            mode: 'force' | 'preserve';
            view: VisualizationView;
            projects: Project[];
            teamMembers: TeamMember[];
            style: VisualizationStyle;
            expandedDocs: Record<string, boolean>;
            docChunks: Record<string, { status: 'idle' | 'loading' | 'ready' | 'error'; filePath: string; chunks: any[] }>;
            fitView?: boolean;
        }) => {
            const built = buildGraph(params.view, {
                projects: params.projects,
                teamMembers: params.teamMembers,
                style: params.style,
                expandedDocs: params.expandedDocs,
                docChunks: params.docChunks,
            });
            setBuiltModel(built.model);

            const { width, height } = getContainerSize(canvasRef.current);
            setNodes((prev) => {
                const base = seedNewPositions(prev, mergePositions(prev, built.nodes), built.edges as any);
                if (params.mode === 'force') {
                    return applyForceLayout(base, built.edges as any, { width, height, iterations: 320, repulsion: 5200, spring: 0.06, gravity: 0.018 });
                }
                return base;
            });
            setEdges(built.edges as any);

            if (params.fitView) {
                requestAnimationFrame(() => {
                    try {
                        rf.fitView({ padding: 0.18, duration: 420 });
                    } catch {}
                });
            }
        },
        [rf, setEdges, setNodes]
    );

    useEffect(() => {
        if (!isOpen) return;
        setExpandedDocs((prev) => (Object.keys(prev).length === 0 ? prev : {}));
        setDocChunks((prev) => (Object.keys(prev).length === 0 ? prev : {}));
        const latest = latestRef.current;
        applyGraph({
            mode: 'force',
            view,
            projects: latest.projects,
            teamMembers: latest.teamMembers,
            style: latest.style,
            expandedDocs: {},
            docChunks: {},
            fitView: true,
        });
    }, [applyGraph, isOpen, view]);

    useEffect(() => {
        if (!isOpen) return;
        const latest = latestRef.current;
        applyGraph({
            mode: 'preserve',
            view: latest.view,
            projects: latest.projects,
            teamMembers: latest.teamMembers,
            style: latest.style,
            expandedDocs: latest.expandedDocs,
            docChunks: latest.docChunks,
            fitView: false,
        });
    }, [applyGraph, docChunks, expandedDocs, isOpen, projects, style, teamMembers]);

    const handleNodeClick = useCallback(
        async (event: any, node: any) => {
            const kind = node?.data?.kind;
            if (kind === 'doc-open') {
                const filePath = node?.data?.filePath as string | undefined;
                if (!filePath) return;
                try {
                    // @ts-ignore
                    await window.electronAPI?.fs?.openPath?.(filePath);
                } catch {}
                return;
            }

            if (kind === 'doc-toggle') {
                const filePath = node?.data?.filePath as string | undefined;
                if (!filePath) return;
                const docId = node.id as string;
                const metaOrAlt = !!event?.metaKey || !!event?.altKey;
                if (metaOrAlt) {
                    try {
                        // @ts-ignore
                        await window.electronAPI?.fs?.openPath?.(filePath);
                    } catch {}
                    return;
                }

                const willExpand = !(expandedDocs[docId] ?? false);
                setExpandedDocs((prev) => ({ ...prev, [docId]: willExpand }));
                if (willExpand && !docChunks[docId]) {
                    setDocChunks((prev) => ({ ...prev, [docId]: { status: 'loading', filePath, chunks: [] } }));
                    try {
                        // @ts-ignore
                        const res = await window.electronAPI?.knowledge?.getChunks?.({ filePath, limit: 8, offset: 0 });
                        if (!res?.success) throw new Error(res?.error || 'Failed to load chunks');
                        setDocChunks((prev) => ({ ...prev, [docId]: { status: 'ready', filePath, chunks: res.chunks || [] } }));
                    } catch {
                        setDocChunks((prev) => ({ ...prev, [docId]: { status: 'error', filePath, chunks: [] } }));
                    }
                }
            }
        },
        [docChunks, expandedDocs]
    );

    useEffect(() => {
        if (!isDraggingLegend) return;

        const handleMove = (e: MouseEvent) => {
            const canvasEl = canvasRef.current;
            const legendEl = legendRef.current;
            const offset = dragOffsetRef.current;
            if (!canvasEl || !legendEl || !offset) return;
            const canvasRect = canvasEl.getBoundingClientRect();
            const legendRect = legendEl.getBoundingClientRect();
            const rawX = e.clientX - canvasRect.left - offset.x;
            const rawY = e.clientY - canvasRect.top - offset.y;
            const x = Math.max(0, Math.min(rawX, canvasRect.width - legendRect.width));
            const y = Math.max(0, Math.min(rawY, canvasRect.height - legendRect.height));
            setLegendPos({ x, y });
        };

        const handleUp = () => {
            setIsDraggingLegend(false);
            dragOffsetRef.current = null;
            try {
                if (legendPos) localStorage.setItem('ngo.visualization.legendPos', JSON.stringify(legendPos));
            } catch {}
        };

        window.addEventListener('mousemove', handleMove);
        window.addEventListener('mouseup', handleUp);
        return () => {
            window.removeEventListener('mousemove', handleMove);
            window.removeEventListener('mouseup', handleUp);
        };
    }, [isDraggingLegend, legendPos]);

    if (!isOpen) return null;

    const nodeTypes = useMemo(() => ({ bubble: BubbleNode }), []);

    return (
        <>
            <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in">
                <div className="bg-white w-full h-full rounded-3xl shadow-2xl border border-slate-100 overflow-hidden relative">
                <div className="absolute top-4 left-6 z-20 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-indigo-600 text-white flex items-center justify-center font-black">⦿</div>
                    <div className="leading-tight">
                        <div className="text-sm font-black text-slate-800">项目可视化</div>
                        <div className="text-[10px] font-bold text-slate-400">{viewLabel[view]}</div>
                    </div>
                    <button
                        onClick={() => {
                            const latest = latestRef.current;
                            applyGraph({
                                mode: 'force',
                                view: latest.view,
                                projects: latest.projects,
                                teamMembers: latest.teamMembers,
                                style: latest.style,
                                expandedDocs: latest.expandedDocs,
                                docChunks: latest.docChunks,
                                fitView: true,
                            });
                        }}
                        className="ml-2 px-3 py-1.5 rounded-full text-xs font-black bg-slate-50 text-slate-700 border border-slate-200 hover:bg-slate-100"
                    >
                        重新布局
                    </button>
                    <button
                        onClick={() => setShowStylePanel((v) => !v)}
                        className={`px-3 py-1.5 rounded-full text-xs font-black border transition-colors ${
                            showStylePanel ? 'bg-slate-100 border-slate-300 text-slate-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                    >
                        样式
                    </button>
                    <button
                        onClick={() => setShowAiPanel((v) => !v)}
                        className={`px-3 py-1.5 rounded-full text-xs font-black border transition-colors ${
                            showAiPanel ? 'bg-slate-100 border-slate-300 text-slate-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                        }`}
                    >
                        AI分析/预警
                    </button>
                    <button
                        onClick={() => setShowExportPanel(true)}
                        className="px-3 py-1.5 rounded-full text-xs font-black border bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100 transition-colors"
                    >
                        导出HTML
                    </button>
                </div>

                <div className="absolute top-4 right-4 z-20 flex gap-2">
                    <button onClick={onClose} className="px-3 py-1.5 bg-white/90 backdrop-blur rounded-full text-xs font-bold text-slate-600 border border-slate-200 hover:bg-slate-50">
                        ✕ 关闭
                    </button>
                </div>

                <div ref={canvasRef} className="w-full h-full bg-slate-50 relative">
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        nodeTypes={nodeTypes}
                        fitView
                        minZoom={0.1}
                        maxZoom={2}
                        attributionPosition="bottom-right"
                        onNodeClick={handleNodeClick}
                    >
                        <Background color="#e2e8f0" gap={20} size={1} />
                        <Controls />
                    </ReactFlow>

                    <div
                        ref={legendRef}
                        className={`absolute z-30 select-none ${isDraggingLegend ? 'cursor-grabbing' : 'cursor-grab'}`}
                        style={legendPos ? { left: legendPos.x, top: legendPos.y } : { right: 24, top: 24 }}
                        onMouseDown={(e) => {
                            const canvasEl = canvasRef.current;
                            const legendEl = legendRef.current;
                            if (!canvasEl || !legendEl) return;
                            const canvasRect = canvasEl.getBoundingClientRect();
                            const legendRect = legendEl.getBoundingClientRect();
                            dragOffsetRef.current = { x: e.clientX - legendRect.left, y: e.clientY - legendRect.top };
                            setIsDraggingLegend(true);
                            setLegendPos((p) => {
                                if (p) return p;
                                return { x: Math.max(0, legendRect.left - canvasRect.left), y: Math.max(0, legendRect.top - canvasRect.top) };
                            });
                        }}
                    >
                        <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">图例</div>
                        <div className="space-y-1 text-[11px] font-semibold text-slate-600">
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ background: style.palette.pending }} />
                                <span>未完成</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ background: style.palette.urgent }} />
                                <span>临期（0–24h）</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ background: style.palette.inProgress }} />
                                <span>进行中</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ background: style.palette.done }} />
                                <span>已完成</span>
                            </div>
                            <div className="pt-1 mt-2 border-t border-slate-200/50 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                预算/支出
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ background: style.palette.financeOk }} />
                                <span>未超支</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ background: style.palette.financeBad }} />
                                <span>超支</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full" style={{ background: style.palette.financeUnknown }} />
                                <span>未知</span>
                            </div>
                        </div>
                    </div>

                    {showStylePanel && (
                        <div className="absolute right-4 top-16 z-30 w-72 bg-white/90 backdrop-blur rounded-2xl border border-slate-200 shadow-lg p-4">
                            <div className="text-xs font-black text-slate-700 mb-3">样式设置</div>
                            <div className="space-y-3">
                                <div>
                                    <div className="text-[10px] font-bold text-slate-500 mb-1">连线形态</div>
                                    <select
                                        value={style.edgeType}
                                        onChange={(e) => setStyle((p) => ({ ...p, edgeType: e.target.value as any }))}
                                        className="w-full text-xs bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 outline-none"
                                    >
                                        <option value="smoothstep">圆角折线</option>
                                        <option value="straight">直线</option>
                                    </select>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-slate-500 mb-1">连线颜色 / 线宽</div>
                                    <div className="flex items-center gap-3">
                                        <input
                                            type="color"
                                            value={style.edgeColor}
                                            onChange={(e) => setStyle((p) => ({ ...p, edgeColor: e.target.value }))}
                                            className="w-10 h-8 bg-transparent"
                                        />
                                        <input
                                            type="range"
                                            min="1"
                                            max="5"
                                            step="0.2"
                                            value={style.edgeWidth}
                                            onChange={(e) => setStyle((p) => ({ ...p, edgeWidth: parseFloat(e.target.value) }))}
                                            className="flex-1 accent-indigo-600"
                                        />
                                        <div className="text-[10px] font-black text-slate-500 w-10 text-right">{style.edgeWidth.toFixed(1)}</div>
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-slate-500 mb-2">任务颜色</div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <label className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                                            未完成
                                            <input
                                                type="color"
                                                value={style.palette.pending}
                                                onChange={(e) => setStyle((p) => ({ ...p, palette: { ...p.palette, pending: e.target.value } }))}
                                                className="w-8 h-6 bg-transparent"
                                            />
                                        </label>
                                        <label className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                                            临期
                                            <input
                                                type="color"
                                                value={style.palette.urgent}
                                                onChange={(e) => setStyle((p) => ({ ...p, palette: { ...p.palette, urgent: e.target.value } }))}
                                                className="w-8 h-6 bg-transparent"
                                            />
                                        </label>
                                        <label className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                                            进行中
                                            <input
                                                type="color"
                                                value={style.palette.inProgress}
                                                onChange={(e) => setStyle((p) => ({ ...p, palette: { ...p.palette, inProgress: e.target.value } }))}
                                                className="w-8 h-6 bg-transparent"
                                            />
                                        </label>
                                        <label className="flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                                            已完成
                                            <input
                                                type="color"
                                                value={style.palette.done}
                                                onChange={(e) => setStyle((p) => ({ ...p, palette: { ...p.palette, done: e.target.value } }))}
                                                className="w-8 h-6 bg-transparent"
                                            />
                                        </label>
                                    </div>
                                </div>
                                <div>
                                    <div className="text-[10px] font-bold text-slate-500 mb-2">财务颜色</div>
                                    <div className="grid grid-cols-3 gap-2">
                                        <label className="flex flex-col items-center gap-1 text-[10px] font-black text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-2 py-2">
                                            未超支
                                            <input
                                                type="color"
                                                value={style.palette.financeOk}
                                                onChange={(e) => setStyle((p) => ({ ...p, palette: { ...p.palette, financeOk: e.target.value } }))}
                                                className="w-8 h-6 bg-transparent"
                                            />
                                        </label>
                                        <label className="flex flex-col items-center gap-1 text-[10px] font-black text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-2 py-2">
                                            超支
                                            <input
                                                type="color"
                                                value={style.palette.financeBad}
                                                onChange={(e) => setStyle((p) => ({ ...p, palette: { ...p.palette, financeBad: e.target.value } }))}
                                                className="w-8 h-6 bg-transparent"
                                            />
                                        </label>
                                        <label className="flex flex-col items-center gap-1 text-[10px] font-black text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-2 py-2">
                                            未知
                                            <input
                                                type="color"
                                                value={style.palette.financeUnknown}
                                                onChange={(e) => setStyle((p) => ({ ...p, palette: { ...p.palette, financeUnknown: e.target.value } }))}
                                                className="w-8 h-6 bg-transparent"
                                            />
                                        </label>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {showAiPanel && (
                        <div className="absolute left-6 top-16 z-30 w-[26rem] max-w-[40vw] bg-white/90 backdrop-blur rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
                            <div className="p-4 border-b border-slate-200 flex items-center justify-between">
                                <div>
                                    <div className="text-xs font-black text-slate-800">分析与预警</div>
                                    <div className="text-[10px] font-bold text-slate-400">优先本地检测，LLM 用于补充建议</div>
                                </div>
                                <button
                                    onClick={runAiAnalysis}
                                    disabled={aiLoading}
                                    className={`px-3 py-1.5 rounded-full text-xs font-black border ${
                                        aiLoading ? 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed' : 'bg-indigo-50 text-indigo-700 border-indigo-200 hover:bg-indigo-100'
                                    }`}
                                >
                                    {aiLoading ? '分析中…' : '发送到LLM'}
                                </button>
                            </div>

                            <div className="p-4 space-y-4 max-h-[60vh] overflow-auto">
                                <div className="grid grid-cols-3 gap-2">
                                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                                        <div className="text-lg font-black text-slate-700">{offlineInsights.ownerConflicts.length}</div>
                                        <div className="text-[10px] font-bold text-slate-400">负责人冲突</div>
                                    </div>
                                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                                        <div className="text-lg font-black text-slate-700">{offlineInsights.projectConflicts.length}</div>
                                        <div className="text-[10px] font-bold text-slate-400">项目时间冲突</div>
                                    </div>
                                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 text-center">
                                        <div className="text-lg font-black text-slate-700">{offlineInsights.tightClusters.length}</div>
                                        <div className="text-[10px] font-bold text-slate-400">紧密簇</div>
                                    </div>
                                </div>

                                {offlineInsights.ownerConflicts.length > 0 && (
                                    <div>
                                        <div className="text-[11px] font-black text-slate-700 mb-2">负责人冲突（≤2天窗口）</div>
                                        <div className="space-y-2">
                                            {offlineInsights.ownerConflicts.slice(0, 6).map((c, idx) => (
                                                <div key={`${c.owner}-${idx}`} className="bg-white border border-slate-200 rounded-xl p-3">
                                                    <div className="flex items-center justify-between">
                                                        <div className="text-[11px] font-black text-slate-800">{c.owner}</div>
                                                        <div className="text-[10px] font-bold text-slate-400">{c.items.length} 项</div>
                                                    </div>
                                                    <div className="mt-2 space-y-1">
                                                        {c.items.slice(0, 4).map((t, i) => (
                                                            <div key={i} className="text-[10px] text-slate-600">
                                                                {t.deadline ? `${t.deadline} • ` : ''}
                                                                {t.projectTitle}：{t.title}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {offlineInsights.projectConflicts.length > 0 && (
                                    <div>
                                        <div className="text-[11px] font-black text-slate-700 mb-2">项目冲突（共享负责人 + 时间接近）</div>
                                        <div className="space-y-2">
                                            {offlineInsights.projectConflicts.slice(0, 6).map((c, idx) => (
                                                <div key={idx} className="bg-white border border-slate-200 rounded-xl p-3">
                                                    <div className="text-[10px] font-black text-slate-800">
                                                        {c.a.title} ↔ {c.b.title}
                                                    </div>
                                                    <div className="mt-1 text-[10px] text-slate-500">
                                                        共享：{c.sharedOwners.slice(0, 6).join('、')}
                                                        {c.sharedOwners.length > 6 ? '…' : ''} • 接近度 {c.overlapScore}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {offlineInsights.tightClusters.length > 0 && (
                                    <div>
                                        <div className="text-[11px] font-black text-slate-700 mb-2">紧密任务簇（建议优先看）</div>
                                        <div className="space-y-2">
                                            {offlineInsights.tightClusters.slice(0, 4).map((g, idx) => (
                                                <div key={idx} className="bg-white border border-slate-200 rounded-xl p-3">
                                                    <div className="text-[10px] font-black text-slate-800">{g.summary}</div>
                                                    <div className="mt-2 space-y-1">
                                                        {g.items.slice(0, 4).map((t, i) => (
                                                            <div key={i} className="text-[10px] text-slate-600">
                                                                {t.deadline ? `${t.deadline} • ` : ''}
                                                                {t.projectTitle}：{t.title}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {aiError ? (
                                    <div className="bg-red-50 border border-red-200 text-red-600 rounded-xl p-3 text-[11px] font-semibold">{aiError}</div>
                                ) : null}

                                {aiText ? (
                                    <div className="bg-white border border-slate-200 rounded-xl p-3">
                                        <div className="text-[11px] font-black text-slate-700 mb-2">LLM 建议</div>
                                        <div className="text-[11px] text-slate-700 whitespace-pre-wrap leading-relaxed">{aiText}</div>
                                    </div>
                                ) : (
                                    <div className="text-[10px] text-slate-400">
                                        可先用本地预警排查冲突；如需更细的行动建议、风险提示与协作策略，再点击“发送到LLM”。
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="absolute bottom-5 left-1/2 -translate-x-1/2 z-20">
                    <div className="flex items-center gap-1 bg-white/85 backdrop-blur border border-slate-200 rounded-full px-1 py-1 shadow-sm">
                        {(Object.keys(viewLabel) as VisualizationView[]).map((k) => (
                            <button
                                key={k}
                                onClick={() => setView(k)}
                                className={`px-3 py-1.5 rounded-full text-[11px] font-black transition-all ${
                                    view === k ? 'bg-indigo-600 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'
                                }`}
                            >
                                {viewLabel[k]}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="absolute bottom-5 left-6 z-20 text-[10px] font-bold text-slate-400">
                    节点可拖拽 • 文档节点可点击打开（关系视图点击可展开切片）
                </div>
                </div>
            </div>

            <HtmlReportExportModal
                isOpen={showExportPanel}
                onClose={() => setShowExportPanel(false)}
                projects={projects}
                teamMembers={teamMembers}
            />
        </>
    );
};

const ProjectVisualizationModal: React.FC<ProjectVisualizationModalProps> = (props) => {
    if (!props.isOpen) return null;
    return (
        <ReactFlowProvider>
            <VisualizationInner {...props} />
        </ReactFlowProvider>
    );
};

export default ProjectVisualizationModal;
