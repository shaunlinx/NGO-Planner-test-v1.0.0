import React, { useState, useCallback, useRef } from 'react';
import {
  ReactFlow,
  useNodesState,
  useEdgesState,
  addEdge,
  Controls,
  Background,
  Connection,
  Edge,
  MarkerType,
  Handle,
  Position,
  Node,
  NodeProps,
  useReactFlow,
  ReactFlowProvider,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

// --- Custom Node Components ---

const ExecutionNode = React.memo(({ data, isConnectable }: NodeProps) => {
  const onDrop = (event: React.DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const path = event.dataTransfer.getData('application/path');
      if (path && (data as any).onAddPath) {
          (data as any).onAddPath(path);
      }
  };

  const onDragOver = (event: React.DragEvent) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
  };

  return (
    <div className="bg-white rounded-xl shadow-lg border border-slate-200 min-w-[220px] overflow-hidden group">
      {/* Header */}
      <div className="bg-gradient-to-r from-indigo-500 to-purple-600 px-3 py-2 flex justify-between items-center">
        <span className="text-white text-xs font-bold uppercase tracking-wider flex items-center gap-1">
          <span className="text-sm">⚡️</span> {data.role as string || '步骤'}
        </span>
        <button 
          onClick={(data as any).onDelete}
          className="text-white/60 hover:text-white transition-colors"
        >
          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
      
      {/* Body */}
      <div className="p-3">
        <div className="text-[10px] text-slate-400 font-bold mb-1 uppercase">引用资源</div>
        
        {/* Drop Zone for Files */}
        <div 
            onDrop={onDrop}
            onDragOver={onDragOver}
            className={`rounded p-2 text-xs text-slate-600 mb-2 border transition-all ${((data.paths as string[]) || []).length > 0 ? 'bg-slate-50 border-slate-100' : 'bg-indigo-50/50 border-indigo-200 border-dashed hover:bg-indigo-50'}`}
        >
          {((data.paths as string[]) || []).length > 0 ? (
              <div className="flex flex-col gap-1">
                  {(data.paths as string[]).map(p => (
                      <div key={p} className="flex items-center gap-1 truncate">
                          <span>📂</span>
                          <span title={p}>{p.split(/[\\/]/).pop()}</span>
                          <button 
                              onClick={() => (data as any).onRemovePath?.(p)}
                              className="text-slate-300 hover:text-red-500 ml-auto"
                          >
                              ×
                          </button>
                      </div>
                  ))}
              </div>
          ) : (
              <div className="text-center py-2 text-indigo-400 cursor-default">
                  <span className="block text-lg mb-1">📥</span>
                  拖拽文件夹至此替换
              </div>
          )}
        </div>
        
        <div className="text-[10px] text-slate-400 font-bold mb-1 uppercase">执行指令</div>
        <textarea 
          className="w-full bg-slate-50 border border-slate-100 rounded p-2 text-xs outline-none resize-none focus:border-indigo-200 transition-colors"
          rows={3}
          placeholder="例如: 总结关键点..."
          defaultValue={data.instruction as string || ''}
          onChange={(e) => (data as any).onInstructionChange?.(e.target.value)}
        />
      </div>

      {/* Handles */}
      <Handle type="target" position={Position.Left} isConnectable={isConnectable} className="w-3 h-3 bg-indigo-400 border-2 border-white !-left-1.5" />
      <Handle type="source" position={Position.Right} isConnectable={isConnectable} className="w-3 h-3 bg-purple-400 border-2 border-white !-right-1.5" />
    </div>
  );
});

const nodeTypes = {
  execution: ExecutionNode,
};

// --- Sidebar Component ---

const Sidebar = ({ folders }: { folders: string[] }) => {
  const onDragStart = (event: React.DragEvent, nodeType: string, path: string) => {
    event.dataTransfer.setData('application/reactflow', nodeType);
    event.dataTransfer.setData('application/path', path);
    event.dataTransfer.effectAllowed = 'move';
  };

  return (
    <aside className="w-64 bg-slate-50 border-r border-slate-200 flex flex-col h-full">
      <div className="p-4 border-b border-slate-100 bg-white">
        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">资源池</h3>
        <p className="text-[10px] text-slate-400">拖拽文件夹到右侧画布以创建步骤</p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {folders.map((folder) => (
          <div
            key={folder}
            className="bg-white p-3 rounded-lg border border-slate-200 shadow-sm cursor-grab hover:border-indigo-300 hover:shadow-md transition-all flex items-center gap-2 group"
            onDragStart={(event) => onDragStart(event, 'execution', folder)}
            draggable
          >
            <div className="w-8 h-8 bg-indigo-50 text-indigo-500 rounded flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
              📂
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-slate-700 truncate" title={folder}>
                {folder.split(/[\\/]/).pop()}
              </div>
              <div className="text-[10px] text-slate-400 truncate">{folder}</div>
            </div>
          </div>
        ))}
        {folders.length === 0 && (
            <div className="text-center p-4 text-slate-400 text-xs italic">
                暂无挂载资源，请先在资源库挂载文件夹。
            </div>
        )}
      </div>
    </aside>
  );
};

// --- Main Editor Component ---

interface WorkflowEditorProps {
  initialNodes?: Node[];
  initialEdges?: Edge[];
  availableFolders: string[];
  onSave: (nodes: Node[], edges: Edge[]) => void;
}

const WorkflowEditorContent: React.FC<WorkflowEditorProps> = ({ 
  initialNodes = [], 
  initialEdges = [], 
  availableFolders,
  onSave 
}) => {
  const reactFlowWrapper = useRef<HTMLDivElement>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { screenToFlowPosition, fitView } = useReactFlow();

  // Helper to attach handlers to node data
  const enrichNodeData = useCallback((node: Node) => {
      return {
          ...node,
          data: {
              ...node.data,
              onDelete: () => {
                  setNodes((nds) => nds.filter((n) => n.id !== node.id));
              },
              onInstructionChange: (val: string) => {
                  setNodes((nds) => nds.map(n => n.id === node.id ? { ...n, data: { ...n.data, instruction: val } } : n));
              },
              onAddPath: (newPath: string) => {
                  setNodes((nds) => nds.map(n => {
                      if (n.id === node.id) {
                          const currentPaths = (n.data.paths as string[]) || [];
                          if (!currentPaths.includes(newPath)) {
                              return { ...n, data: { ...n.data, paths: [...currentPaths, newPath] } };
                          }
                      }
                      return n;
                  }));
              },
              onRemovePath: (removePath: string) => {
                  setNodes((nds) => nds.map(n => {
                      if (n.id === node.id) {
                          return { ...n, data: { ...n.data, paths: ((n.data.paths as string[]) || []).filter(p => p !== removePath) } };
                      }
                      return n;
                  }));
              }
          }
      };
  }, [setNodes]);

  // Sync state when props change (e.g. template loaded)
  React.useEffect(() => {
      if (initialNodes.length > 0 || initialEdges.length > 0) {
          setNodes(initialNodes.map(enrichNodeData));
          setEdges(initialEdges);
      }
  }, [initialNodes, initialEdges, setNodes, setEdges, enrichNodeData]);

  const onConnect = useCallback(
    (params: Connection) => {
        // Cycle Detection
        // A simple check: Can we reach source from target? If so, it's a cycle.
        // For MVP, just prevent self-loop
        if (params.source === params.target) return;
        
        setEdges((eds) => addEdge({ ...params, animated: true, markerEnd: { type: MarkerType.ArrowClosed } }, eds));
    },
    [setEdges],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();

      const type = event.dataTransfer.getData('application/reactflow');
      const path = event.dataTransfer.getData('application/path');

      if (typeof type === 'undefined' || !type) {
        return;
      }

      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      
      const newNode: Node = {
        id: `node_${Date.now()}`,
        type,
        position,
        data: { 
            role: `步骤 ${nodes.length + 1}`, 
            paths: [path],
            instruction: '',
        },
      };

      setNodes((nds) => nds.concat(enrichNodeData(newNode)));
    },
    [screenToFlowPosition, nodes, setNodes],
  );

  // Auto-save effect or manual save
  // For now, let's expose current state via ref or callback on change?
  // Better: manual save button in panel.

  return (
    <div className="flex h-full w-full bg-slate-50">
      <Sidebar folders={availableFolders} />
      <div className="flex-1 h-full relative" ref={reactFlowWrapper}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onDrop={onDrop}
          onDragOver={onDragOver}
          nodeTypes={nodeTypes}
          fitView
          attributionPosition="bottom-right"
        >
          <Background color="#ccc" gap={16} size={1} />
          <Controls showInteractive={false} position="bottom-left" className="!mb-12 !ml-2" />
          <Panel position="top-right">
            <div className="flex gap-2">
                <button 
                    onClick={() => fitView({ padding: 0.2, duration: 500 })}
                    className="bg-white text-slate-600 px-3 py-2 rounded-lg shadow-md border border-slate-200 font-bold text-xs hover:bg-slate-50 transition-all flex items-center gap-2"
                    title="重置视图"
                >
                    📍
                </button>
                <button 
                    onClick={() => onSave(nodes, edges)}
                    className="bg-indigo-600 text-white px-4 py-2 rounded-lg shadow-lg font-bold text-xs hover:bg-indigo-700 transition-all flex items-center gap-2"
                >
                    💾 保存编排
                </button>
            </div>
          </Panel>
          <Panel position="bottom-left">
             <div className="bg-white/80 backdrop-blur p-2 rounded-lg text-[10px] text-slate-500 border border-slate-200">
                Token 预警: {(nodes.length * 1.5).toFixed(1)}x 倍率 (预估)
             </div>
          </Panel>
        </ReactFlow>
      </div>
    </div>
  );
};

export const WorkflowEditor = (props: WorkflowEditorProps) => (
  <ReactFlowProvider>
    <WorkflowEditorContent {...props} />
  </ReactFlowProvider>
);
