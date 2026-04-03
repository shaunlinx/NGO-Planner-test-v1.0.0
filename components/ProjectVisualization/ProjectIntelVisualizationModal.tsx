import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
    Background,
    Controls,
    ReactFlow,
    useEdgesState,
    useNodesState,
    ReactFlowProvider,
    type Edge,
    type Node,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import BubbleNode from './BubbleNode';
import { applyForceLayout } from './forceLayout';
import { buildIntelGraph } from './intelGraphBuilders';
import type { VisualizationStyle } from './graphBuilders';

type IntelRun = {
    id: string;
    user_query?: string;
    created_at?: number;
};

type IntelItem = {
    id: string;
    run_id: string;
    url?: string;
    title?: string;
    snippet?: string;
    extracted?: any;
    screenshot_path?: string;
    raw_text_path?: string;
    created_at?: number;
};

type IntelHighlight = {
    id: string;
    run_id: string;
    url?: string;
    title?: string;
    selected_text?: string;
    context_text?: string;
    tags?: string[];
    tags_json?: string;
    created_at?: number;
};

type IntelOcrFrame = {
    id: string;
    run_id: string;
    url?: string;
    title?: string;
    image_path?: string;
    ocr_text?: string;
    created_at?: number;
};

interface ProjectIntelVisualizationModalProps {
    isOpen: boolean;
    onClose: () => void;
    run: IntelRun | null;
    items: IntelItem[];
    highlights: IntelHighlight[];
    frames: IntelOcrFrame[];
}

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

const getContainerSize = (el: HTMLDivElement | null) => {
    if (!el) return { width: 1100, height: 760 };
    const r = el.getBoundingClientRect();
    return { width: Math.max(720, r.width), height: Math.max(520, r.height) };
};

const nodeTypes = { bubble: BubbleNode };

const VisualizationInner: React.FC<ProjectIntelVisualizationModalProps> = ({ isOpen, onClose, run, items, highlights, frames }) => {
    const [style] = useState<VisualizationStyle>(defaultStyle);
    const built = useMemo(() => buildIntelGraph({ items, highlights, frames, style }), [items, highlights, frames, style]);
    const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
    const canvasRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        const nextNodes = built.nodes;
        const nextEdges = built.edges;
        setNodes(nextNodes);
        setEdges(nextEdges as any);
        const { width, height } = getContainerSize(canvasRef.current);
        const laid = applyForceLayout(nextNodes, nextEdges as any, { width, height, iterations: 260, repulsion: 5200, spring: 0.06, gravity: 0.014 });
        setNodes(laid);
    }, [isOpen, built.nodes, built.edges, setNodes, setEdges]);

    const openExternal = async (url: string) => {
        const shell = (window as any).electronAPI?.shell;
        if (shell?.openExternal) await shell.openExternal(url);
    };

    const onNodeClick = async (_: any, node: Node) => {
        const d: any = node.data || {};
        const url = typeof d.url === 'string' ? d.url : '';
        if (url) await openExternal(url);
    };

    const relayout = async () => {
        const { width, height } = getContainerSize(canvasRef.current);
        const laid = applyForceLayout(nodes, edges as any, { width, height, iterations: 260, repulsion: 5200, spring: 0.06, gravity: 0.014 });
        setNodes(laid);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50">
            <div className="bg-white w-[92vw] max-w-[1280px] h-[86vh] rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                    <div className="min-w-0">
                        <div className="text-sm font-black text-slate-800">项目情报图谱</div>
                        <div className="mt-1 text-[11px] text-slate-500 truncate">
                            {run?.user_query ? run.user_query : `Run ${run?.id || ''}`} · {items.length} 条结果 · {highlights.length} 条划线 · {frames.length} 条 OCR
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={relayout}
                            className="px-3 py-2 rounded-xl text-xs font-black border border-slate-200 text-slate-700 hover:text-indigo-600 hover:border-indigo-200"
                        >
                            重新布局
                        </button>
                        <button onClick={onClose} className="px-3 py-2 rounded-xl text-xs font-black bg-slate-900 text-white hover:bg-slate-800">
                            关闭
                        </button>
                    </div>
                </div>

                <div ref={canvasRef} className="flex-1 bg-slate-50">
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        onNodesChange={onNodesChange}
                        onEdgesChange={onEdgesChange}
                        nodeTypes={nodeTypes}
                        fitView
                        fitViewOptions={{ padding: 0.22 }}
                        onNodeClick={onNodeClick}
                    >
                        <Background gap={16} size={1} color="#e2e8f0" />
                        <Controls />
                    </ReactFlow>
                </div>
            </div>
        </div>
    );
};

const ProjectIntelVisualizationModal: React.FC<ProjectIntelVisualizationModalProps> = (props) => (
    <ReactFlowProvider>
        <VisualizationInner {...props} />
    </ReactFlowProvider>
);

export default ProjectIntelVisualizationModal;

