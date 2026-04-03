
import React, { useEffect, useState, useCallback } from 'react';
import { ReactFlow, Background, Controls, MiniMap, useNodesState, useEdgesState, Position, MarkerType } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import dagre from 'dagre';

interface EntityGraphModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const nodeWidth = 172;
const nodeHeight = 36;

const getLayoutedElements = (nodes: any[], edges: any[], direction = 'LR') => {
    const dagreGraph = new dagre.graphlib.Graph();
    dagreGraph.setDefaultEdgeLabel(() => ({}));

    dagreGraph.setGraph({ rankdir: direction });

    nodes.forEach((node) => {
        dagreGraph.setNode(node.id, { width: nodeWidth, height: nodeHeight });
    });

    edges.forEach((edge) => {
        dagreGraph.setEdge(edge.source, edge.target);
    });

    dagre.layout(dagreGraph);

    const layoutedNodes = nodes.map((node) => {
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

    return { nodes: layoutedNodes, edges };
};

const isHorizontal = true;

const EntityGraphModal: React.FC<EntityGraphModalProps> = ({ isOpen, onClose }) => {
    const [nodes, setNodes, onNodesChange] = useNodesState([]);
    const [edges, setEdges, onEdgesChange] = useEdgesState([]);
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        if (!window.electronAPI) return;
        setLoading(true);
        try {
            // @ts-ignore
            const data = await window.electronAPI.db.getGraphData();
            // data: { relationships: [{file_path, entity_name, entity_type}], fileCount, entityCount }

            const rawNodes: any[] = [];
            const rawEdges: any[] = [];
            const addedNodes = new Set();

            // Process Relationships
            data.relationships.forEach((rel: any, index: number) => {
                const fileName = rel.file_path.split(/[\\/]/).pop();
                const fileId = `file-${rel.file_path}`;
                const entityId = `entity-${rel.entity_name}`;

                // Add File Node
                if (!addedNodes.has(fileId)) {
                    rawNodes.push({
                        id: fileId,
                        data: { label: `📄 ${fileName}` },
                        position: { x: 0, y: 0 },
                        style: { background: '#fff', border: '1px solid #94a3b8', borderRadius: '8px', fontSize: '10px', width: 160 }
                    });
                    addedNodes.add(fileId);
                }

                // Add Entity Node
                if (!addedNodes.has(entityId)) {
                    let color = '#e0e7ff'; // blue for project
                    let icon = '🏗️';
                    if (rel.entity_type === 'person') { color = '#dcfce7'; icon = '👤'; } // green
                    if (rel.entity_type === 'organization') { color = '#fef3c7'; icon = '🏢'; } // yellow

                    rawNodes.push({
                        id: entityId,
                        data: { label: `${icon} ${rel.entity_name}` },
                        position: { x: 0, y: 0 },
                        style: { background: color, border: '1px solid #64748b', borderRadius: '20px', fontSize: '12px', fontWeight: 'bold', width: 'auto', minWidth: 100 }
                    });
                    addedNodes.add(entityId);
                }

                // Add Edge
                rawEdges.push({
                    id: `edge-${index}`,
                    source: fileId,
                    target: entityId,
                    type: 'smoothstep',
                    animated: true,
                    style: { stroke: '#cbd5e1' },
                    markerEnd: { type: MarkerType.ArrowClosed, color: '#cbd5e1' },
                });
            });

            const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(
                rawNodes,
                rawEdges
            );

            setNodes(layoutedNodes);
            setEdges(layoutedEdges);

        } catch (e) {
            console.error("Failed to load graph:", e);
        } finally {
            setLoading(false);
        }
    }, [setNodes, setEdges]);

    useEffect(() => {
        if (isOpen) {
            fetchData();
        }
    }, [isOpen, fetchData]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-8 animate-fade-in">
            <div className="bg-white w-full h-full rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-slate-100 relative">
                <div className="absolute top-4 right-4 z-10 flex gap-2">
                     <button onClick={fetchData} className="px-3 py-1 bg-white shadow-md rounded-full text-xs font-bold text-indigo-600 hover:bg-indigo-50">🔄 Refresh</button>
                     <button onClick={onClose} className="px-3 py-1 bg-white shadow-md rounded-full text-xs font-bold text-slate-500 hover:bg-slate-100">✕ Close</button>
                </div>
                
                <div className="flex-1 w-full h-full bg-slate-50">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-slate-400">Loading Graph...</div>
                    ) : (
                        <ReactFlow
                            nodes={nodes}
                            edges={edges}
                            onNodesChange={onNodesChange}
                            onEdgesChange={onEdgesChange}
                            fitView
                        >
                            <Background color="#e2e8f0" gap={16} />
                            <Controls />
                            <MiniMap />
                        </ReactFlow>
                    )}
                </div>
                <div className="absolute bottom-4 left-4 bg-white/90 backdrop-blur px-4 py-2 rounded-xl text-[10px] text-slate-500 shadow-sm border border-slate-100">
                    <span className="font-bold text-indigo-600">Graph-Lite Visualization</span> • Nodes: {nodes.length} • Edges: {edges.length}
                </div>
            </div>
        </div>
    );
};

export default EntityGraphModal;
