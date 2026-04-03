import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ReactFlow, Background, Controls, useNodesState, useEdgesState, Node, Edge, Position, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

interface KnowledgeGraphViewProps {
    files: string[];
}

interface SavedGraph {
    id: string;
    name: string;
    nodes: Node[];
    edges: Edge[];
    sourceFiles: string[];
    created_at: number;
}

const nodeWidth = 180;
const nodeHeight = 50;

const getLayoutedElements = (nodes: Node[], edges: Edge[], direction = 'TB') => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    const isHorizontal = direction === 'LR';
    dagreGraph.setGraph({ rankdir: direction });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const newNodes = nodes.map((node) => {
        const nodeWithPosition = dagreGraph.node(node.id);
        return {
            ...node,
            targetPosition: isHorizontal ? Position.Left : Position.Top,
            sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
            position: {
                x: nodeWithPosition.x - nodeWidth / 2,
                y: nodeWithPosition.y - nodeHeight / 2,
            },
        };
    });

    return { nodes: newNodes, edges };
};

export const KnowledgeGraphView: React.FC<KnowledgeGraphViewProps> = ({ files }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [isSaved, setIsSaved] = useState(false);
    
    // --- Customization State ---
    const [showControls, setShowControls] = useState(false);
    const [showStats, setShowStats] = useState(false); // New: Stats Visibility
    const [graphStyle, setGraphStyle] = useState({
        edgeType: 'default', // default, straight, step, smoothstep, simplebezier
        edgeColor: '#64748b',
        edgeWidth: 1.5,
        nodeColor: '#ffffff',
        nodeBorderColor: '#cbd5e1',
        fontSize: 12,
        direction: 'TB'
    });

    // --- History State ---
    const [showHistory, setShowHistory] = useState(false);
    const [savedGraphs, setSavedGraphs] = useState<SavedGraph[]>([]);
    
    // --- State: Track Source Files for Stale Check ---
    const [graphSourceFiles, setGraphSourceFiles] = useState<string[]>([]);

    // Check if current selection differs from what generated the graph
    const isStale = useMemo(() => {
        if (nodes.length === 0) return false;
        if (files.length !== graphSourceFiles.length) return true;
        const s1 = [...files].sort();
        const s2 = [...graphSourceFiles].sort();
        return s1.some((f, i) => f !== s2[i]);
    }, [files, graphSourceFiles, nodes.length]);

    // --- Effect: Apply Styles Dynamically ---
    useEffect(() => {
        setNodes(nds => nds.map(n => ({
            ...n,
            style: {
                ...n.style,
                background: graphStyle.nodeColor,
                borderColor: graphStyle.nodeBorderColor,
                fontSize: graphStyle.fontSize,
            }
        })));
        setEdges(eds => eds.map(e => ({
            ...e,
            type: graphStyle.edgeType,
            style: {
                ...e.style,
                stroke: graphStyle.edgeColor,
                strokeWidth: graphStyle.edgeWidth
            }
        })));
    }, [graphStyle, setNodes, setEdges]);

    // --- Generation Logic ---
    const generateGraph = useCallback(async () => {
        if (files.length === 0) return;
        setLoading(true);
        setError(null);
        setIsSaved(false);
        try {
            // @ts-ignore
            const res = await window.electronAPI.knowledge.generateGraph(files);
            if (res.error) throw new Error(res.error);

            // Transform to React Flow format
            const rawNodes = res.nodes.map((n: any) => ({
                id: n.id,
                data: { label: n.label },
                position: { x: 0, y: 0 },
                style: { 
                    background: graphStyle.nodeColor, 
                    border: `1px solid ${graphStyle.nodeBorderColor}`, 
                    borderRadius: '8px', 
                    padding: '10px',
                    fontSize: `${graphStyle.fontSize}px`,
                    fontWeight: 'bold',
                    width: nodeWidth,
                    textAlign: 'center',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.05)'
                }
            }));

            const rawEdges = res.edges.map((e: any, i: number) => ({
                id: `e${i}`,
                source: e.source,
                target: e.target,
                label: e.label,
                animated: true,
                type: graphStyle.edgeType,
                style: { stroke: graphStyle.edgeColor, strokeWidth: graphStyle.edgeWidth },
                markerEnd: { type: MarkerType.ArrowClosed, color: graphStyle.edgeColor }
            }));

            const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
                rawNodes,
                rawEdges,
                graphStyle.direction
            );

            setNodes(layoutedNodes);
            setEdges(layoutedEdges);
            setGraphSourceFiles(files); // Mark these files as the source
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [files, setNodes, setEdges, graphStyle.direction]); // Re-gen only if direction changes or files change

    // --- REMOVED: Auto-trigger Effect ---
    // useEffect(() => {
    //    generateGraph();
    // }, [files]); 

    const handleSaveGraph = async () => {
        if (nodes.length === 0) return;
        const name = prompt("请输入图谱名称", `知识图谱-${new Date().toLocaleDateString()}`);
        if (!name) return;

        const graphData = {
            id: Date.now().toString(),
            name,
            nodes,
            edges,
            sourceFiles: files
        };

        // @ts-ignore
        const res = await window.electronAPI.readingMode.saveGraph(graphData);
        if (res.success) {
            setIsSaved(true);
            alert("✅ 图谱已保存！\n该图谱已生成结构化数据表单，可用于后续 RAG 检索增强。");
        } else {
            alert("保存失败: " + res.error);
        }
    };

    const loadSavedGraphs = async () => {
        // @ts-ignore
        const list = await window.electronAPI.readingMode.getSavedGraphs();
        setSavedGraphs(list);
        setShowHistory(true);
    };

    const handleLoadGraph = (g: SavedGraph) => {
        setNodes(g.nodes);
        setEdges(g.edges);
        setShowHistory(false);
    };

    const handleDeleteGraph = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if(!confirm("确定删除此图谱记录吗？")) return;
        // @ts-ignore
        await window.electronAPI.readingMode.deleteSavedGraph(id);
        loadSavedGraphs(); // Refresh
    };

    const handleRelayout = (direction: string) => {
        setGraphStyle(prev => ({ ...prev, direction }));
        const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
            nodes,
            edges,
            direction
        );
        setNodes(layoutedNodes);
        setEdges(layoutedEdges);
    };

    return (
        <div className="w-full h-full relative bg-slate-50">
            {/* Loading Overlay */}
            {loading && (
                <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
                    <div className="w-12 h-12 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                    <p className="text-slate-600 font-bold animate-pulse">正在构建知识图谱...</p>
                    <p className="text-xs text-slate-400 mt-2">基于 AI 语义分析 (Local/LLM)</p>
                </div>
            )}
            
            {/* Error Message */}
            {error && (
                <div className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-red-50 text-red-600 px-4 py-2 rounded-lg border border-red-200 shadow-sm text-sm flex items-center gap-2">
                    <span>⚠️ 生成失败: {error}</span>
                    <button onClick={generateGraph} className="underline hover:text-red-800 font-bold">重试</button>
                </div>
            )}

            {/* Empty/Initial State & Stale State Overlay */}
            {((nodes.length === 0 && !loading && !error) || isStale) && (
                <div className={`absolute inset-0 flex flex-col items-center justify-center text-slate-400 z-20 ${isStale ? 'bg-slate-50/80 backdrop-blur-sm' : 'bg-slate-50'}`}>
                    <div className="w-24 h-24 bg-white rounded-full shadow-sm flex items-center justify-center mb-6 animate-bounce-slow">
                        <span className="text-6xl">🕸️</span>
                    </div>
                    <h2 className="text-2xl font-bold text-slate-700 mb-2">
                        {isStale ? '文档选择已变更' : '知识图谱生成器'}
                    </h2>
                    <p className="text-sm text-slate-500 max-w-md text-center mb-8">
                        {isStale 
                            ? <span>检测到您修改了文档选择 (现选 <span className="font-bold text-indigo-600">{files.length}</span> 个)。<br/>请点击下方按钮重新生成图谱。</span>
                            : <span>已选择 <span className="font-bold text-indigo-600">{files.length}</span> 个文档。<br/>点击下方按钮开始进行语义分析和实体关系提取。</span>
                        }
                    </p>
                    
                    <button 
                        onClick={generateGraph}
                        disabled={files.length === 0}
                        className={`
                            px-8 py-3 rounded-full font-bold text-white shadow-lg transform transition-all hover:scale-105 active:scale-95
                            ${files.length > 0 
                                ? 'bg-gradient-to-r from-indigo-500 to-purple-600 hover:shadow-indigo-500/30' 
                                : 'bg-slate-300 cursor-not-allowed'}
                        `}
                    >
                        {files.length > 0 ? (isStale ? '🔄 更新图谱' : '🚀 开始生成图谱') : '请先在左侧选择文档'}
                    </button>
                    
                    {!isStale && (
                        <div className="mt-8 grid grid-cols-3 gap-8 text-center text-xs text-slate-400">
                            <div>
                                <div className="font-bold text-slate-600 text-lg">LLM</div>
                                <div>语义分析</div>
                            </div>
                            <div>
                                <div className="font-bold text-slate-600 text-lg">RAG</div>
                                <div>实体提取</div>
                            </div>
                            <div>
                                <div className="font-bold text-slate-600 text-lg">Dagre</div>
                                <div>自动布局</div>
                            </div>
                        </div>
                    )}
                    
                    {isStale && nodes.length > 0 && (
                        <button 
                            onClick={() => setGraphSourceFiles(files)} // Dismiss stale warning by syncing state without regen (not ideal but allows viewing old graph)
                            className="mt-4 text-xs text-slate-400 hover:text-slate-600 underline"
                        >
                            暂时忽略 (查看旧图谱)
                        </button>
                    )}
                </div>
            )}

            {/* Main Graph Canvas */}
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                fitView
                attributionPosition="bottom-right"
                minZoom={0.1}
                maxZoom={2}
            >
                <Background color="#e2e8f0" gap={20} size={1} />
                <Controls />
            </ReactFlow>
            
            {/* Top Toolbar */}
            <div className="absolute top-4 right-4 z-40 flex flex-col items-end gap-2">
                {/* Main Action Card */}
                <div className="bg-white/90 backdrop-blur p-3 rounded-xl border border-slate-200 shadow-sm w-48">
                    <h3 className="text-xs font-black text-slate-700 uppercase tracking-wider mb-2 flex items-center gap-1">
                        知识图谱 <span className="text-[9px] bg-indigo-100 text-indigo-600 px-1 rounded">BETA</span>
                    </h3>
                    <div className="text-[10px] text-slate-500 space-y-1 mb-3">
                        <p>📚 来源: {files.length} 个文档</p>
                        <p>🧩 节点: {nodes.length} | 连线: {edges.length}</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                        <button 
                            onClick={generateGraph}
                            className="py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-bold hover:bg-indigo-100 transition-colors flex items-center justify-center gap-1"
                        >
                            🔄 重新生成
                        </button>
                        <button 
                            onClick={handleSaveGraph}
                            className="py-1.5 bg-green-50 text-green-600 rounded-lg text-[10px] font-bold hover:bg-green-100 transition-colors flex items-center justify-center gap-1"
                        >
                            💾 保存
                        </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2">
                         <button 
                            onClick={() => setShowControls(!showControls)}
                            className={`py-1.5 rounded-lg text-[10px] font-bold transition-colors flex items-center justify-center gap-1 border ${showControls ? 'bg-slate-100 border-slate-300' : 'bg-white border-slate-200 text-slate-600'}`}
                        >
                            🎨 样式
                        </button>
                        <button 
                            onClick={() => setShowStats(!showStats)}
                            className={`py-1.5 rounded-lg text-[10px] font-bold transition-colors flex items-center justify-center gap-1 border ${showStats ? 'bg-slate-100 border-slate-300' : 'bg-white border-slate-200 text-slate-600'}`}
                        >
                            📊 统计
                        </button>
                    </div>
                    <button 
                        onClick={loadSavedGraphs}
                        className="w-full mt-2 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-[10px] font-bold hover:bg-slate-50 transition-colors flex items-center justify-center gap-1"
                    >
                        📜 历史记录
                    </button>
                </div>

                {/* Statistics Panel (Transparency) */}
                {showStats && (
                    <div className="bg-white/90 backdrop-blur p-4 rounded-xl border border-slate-200 shadow-lg w-64 animate-fade-in mb-2">
                        <h4 className="text-xs font-bold text-slate-700 uppercase mb-3 border-b pb-2">📊 图谱统计数据</h4>
                        
                        <div className="space-y-3">
                            <div>
                                <h5 className="text-[10px] font-bold text-slate-500 mb-1">算法支持</h5>
                                <div className="text-[10px] text-slate-600 bg-slate-50 p-2 rounded border border-slate-100">
                                    <p>• <strong>提取:</strong> Generative AI (LLM)</p>
                                    <p>• <strong>布局:</strong> Dagre (Hierarchical)</p>
                                    <p>• <strong>渲染:</strong> React Flow</p>
                                </div>
                            </div>

                            <div>
                                <h5 className="text-[10px] font-bold text-slate-500 mb-1">基础指标</h5>
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="bg-slate-50 p-2 rounded text-center">
                                        <div className="text-lg font-black text-indigo-600">{nodes.length}</div>
                                        <div className="text-[9px] text-slate-400">节点数</div>
                                    </div>
                                    <div className="bg-slate-50 p-2 rounded text-center">
                                        <div className="text-lg font-black text-pink-600">{edges.length}</div>
                                        <div className="text-[9px] text-slate-400">关系数</div>
                                    </div>
                                    <div className="bg-slate-50 p-2 rounded text-center">
                                        <div className="text-lg font-black text-emerald-600">{(edges.length / Math.max(1, nodes.length)).toFixed(2)}</div>
                                        <div className="text-[9px] text-slate-400">平均连接度</div>
                                    </div>
                                    <div className="bg-slate-50 p-2 rounded text-center">
                                        <div className="text-lg font-black text-blue-600">{files.length}</div>
                                        <div className="text-[9px] text-slate-400">源文件</div>
                                    </div>
                                </div>
                            </div>

                            <div>
                                <h5 className="text-[10px] font-bold text-slate-500 mb-1">分析说明</h5>
                                <p className="text-[9px] text-slate-400 leading-relaxed">
                                    该图谱基于当前选中文档的 RAG 切片（Chunk），通过 LLM 识别高频实体及其共现关系。节点大小目前固定，未来可基于权重动态调整。
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Customization Panel */}
                {showControls && (
                    <div className="bg-white/90 backdrop-blur p-3 rounded-xl border border-slate-200 shadow-sm w-48 animate-fade-in">
                        <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2">布局与样式</h4>
                        
                        <div className="space-y-3">
                            <div>
                                <label className="text-[10px] text-slate-600 block mb-1">布局方向</label>
                                <div className="flex bg-slate-100 p-0.5 rounded">
                                    <button onClick={() => handleRelayout('TB')} className={`flex-1 text-[10px] py-1 rounded ${graphStyle.direction === 'TB' ? 'bg-white shadow-sm font-bold' : 'text-slate-400'}`}>⬇️ 垂直</button>
                                    <button onClick={() => handleRelayout('LR')} className={`flex-1 text-[10px] py-1 rounded ${graphStyle.direction === 'LR' ? 'bg-white shadow-sm font-bold' : 'text-slate-400'}`}>➡️ 水平</button>
                                </div>
                            </div>

                            <div>
                                <label className="text-[10px] text-slate-600 block mb-1">连线样式</label>
                                <select 
                                    value={graphStyle.edgeType}
                                    onChange={e => setGraphStyle(prev => ({ ...prev, edgeType: e.target.value }))}
                                    className="w-full text-[10px] bg-slate-50 border border-slate-200 rounded p-1 outline-none"
                                >
                                    <option value="default">默认 (Bezier)</option>
                                    <option value="straight">直线 (Straight)</option>
                                    <option value="step">阶梯 (Step)</option>
                                    <option value="smoothstep">圆角阶梯</option>
                                </select>
                            </div>

                            <div>
                                <label className="text-[10px] text-slate-600 block mb-1">节点背景</label>
                                <div className="flex gap-1">
                                    {['#ffffff', '#f1f5f9', '#eff6ff', '#f0fdf4', '#fef2f2'].map(c => (
                                        <button 
                                            key={c}
                                            onClick={() => setGraphStyle(prev => ({ ...prev, nodeColor: c }))}
                                            className={`w-5 h-5 rounded-full border ${graphStyle.nodeColor === c ? 'border-indigo-500 ring-1 ring-indigo-200' : 'border-slate-200'}`}
                                            style={{ backgroundColor: c }}
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* History Modal (Simple Overlay) */}
            {showHistory && (
                <div className="absolute inset-0 z-[60] bg-white/95 backdrop-blur flex flex-col p-6 animate-fade-in">
                    <div className="flex justify-between items-center mb-6">
                        <h2 className="text-lg font-bold text-slate-800">图谱历史记录</h2>
                        <button onClick={() => setShowHistory(false)} className="text-slate-400 hover:text-slate-600">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto pb-10">
                        {savedGraphs.map(g => (
                            <div key={g.id} className="border border-slate-200 rounded-xl p-4 hover:shadow-md hover:border-indigo-200 transition-all bg-white group cursor-pointer" onClick={() => handleLoadGraph(g)}>
                                <div className="flex justify-between items-start mb-2">
                                    <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center text-xl">🕸️</div>
                                    <button 
                                        onClick={(e) => handleDeleteGraph(g.id, e)}
                                        className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity p-1"
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                    </button>
                                </div>
                                <h3 className="font-bold text-slate-800 text-sm mb-1">{g.name}</h3>
                                <div className="text-[10px] text-slate-500 space-y-0.5">
                                    <p>📅 {new Date(g.created_at).toLocaleString()}</p>
                                    <p>📄 {g.sourceFiles.length} 个来源文件</p>
                                    <p>📊 {g.nodes.length} 节点 / {g.edges.length} 连线</p>
                                </div>
                            </div>
                        ))}
                        {savedGraphs.length === 0 && (
                            <div className="col-span-full text-center py-10 text-slate-400">
                                暂无保存的历史图谱
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};
