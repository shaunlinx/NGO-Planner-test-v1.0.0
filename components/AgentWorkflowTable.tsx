import React, { useState, useEffect, useRef, useMemo } from 'react';
import DOMPurify from 'dompurify';
import { TeamMember } from '../types';

// --- Icons ---
const Icons = {
    Plus: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>,
    Play: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
    Settings: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
    Robot: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>,
    Trash: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>,
    SortAsc: () => <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4h13M3 8h9m-9 4h6m4 0l4-4m0 0l4 4m-4-4v12" /></svg>,
    SortDesc: () => <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4h13M3 8h9m-9 4h5m4 0l4 4m0 0l4-4m-4 4V4" /></svg>,
    Filter: () => <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>,
    Transpose: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7" /></svg>,
    File: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.5L18 9v11a2 2 0 01-2 2z" /></svg>,
    Magic: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>,
    Download: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>,
    Eye: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>,
    Edit: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
};

interface Column {
    id: string;
    title: string;
    type: 'text' | 'number' | 'date' | 'select' | 'status';
    options?: string[]; // For select type
    agentId?: string;
    promptTemplate?: string; 
    isProcessing?: boolean;
    width?: number;
}

interface Row {
    id: string;
    [key: string]: any;
    _status?: Record<string, 'idle' | 'queued' | 'running' | 'success' | 'error'>; // Cell-level AI status
}

// --- Cell Editors ---
const CellEditor: React.FC<{ 
    row: Row; 
    col: Column; 
    value: any; 
    onChange: (val: any) => void; 
    onBlur: () => void;
    autoFocus?: boolean;
}> = ({ row, col, value, onChange, onBlur, autoFocus }) => {
    const inputRef = useRef<HTMLInputElement | HTMLSelectElement>(null);

    useEffect(() => {
        if (autoFocus && inputRef.current) inputRef.current.focus();
    }, [autoFocus]);

    if (col.type === 'date') {
        return (
            <input 
                ref={inputRef as any}
                type="date" 
                value={value || ''} 
                onChange={e => onChange(e.target.value)} 
                onBlur={onBlur}
                className="w-full h-full p-2 bg-white outline-none text-sm border-2 border-indigo-500 rounded"
            />
        );
    }

    if (col.type === 'number') {
        return (
            <input 
                ref={inputRef as any}
                type="number" 
                value={value || ''} 
                onChange={e => onChange(e.target.value)} 
                onBlur={onBlur}
                className="w-full h-full p-2 bg-white outline-none text-sm border-2 border-indigo-500 rounded font-mono"
            />
        );
    }

    if (col.type === 'select' || col.type === 'status') {
        const options = col.options || (col.type === 'status' ? ['Not Started', 'In Progress', 'Done', 'Blocked'] : []);
        return (
            <select 
                ref={inputRef as any}
                value={value || ''} 
                onChange={e => { onChange(e.target.value); onBlur(); }} // Auto blur on select
                onBlur={onBlur}
                className="w-full h-full p-2 bg-white outline-none text-sm border-2 border-indigo-500 rounded"
            >
                <option value="">Select...</option>
                {options.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
        );
    }

    // Default Text
    return (
        <div 
            contentEditable
            suppressContentEditableWarning
            onBlur={(e) => { onChange(e.currentTarget.innerHTML); onBlur(); }}
            className="w-full h-full p-3 bg-white outline-none text-sm text-gray-700 shadow-inner min-h-[40px] z-20 relative focus:ring-2 focus:ring-indigo-500 overflow-hidden"
            style={{ maxHeight: '100%' }}
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(value || '') }}
            autoFocus
            ref={el => el && el.focus()}
        />
    );
};

const SmartCell: React.FC<{ content: string; onClick?: () => void }> = ({ content, onClick }) => {
    // 1. Check for Code Block
    const codeBlockMatch = content.match(/```(\w+)?\n([\s\S]*?)```/);
    if (codeBlockMatch) {
        const lang = codeBlockMatch[1] || 'text';
        const code = codeBlockMatch[2];
        return (
            <div className="w-full h-full p-2 bg-slate-900 text-slate-300 font-mono text-xs rounded overflow-hidden relative group" onClick={onClick}>
                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 bg-slate-800 px-1 rounded text-[10px] uppercase text-slate-500">{lang}</div>
                <pre className="whitespace-pre-wrap break-all">{code.substring(0, 100)}{code.length > 100 ? '...' : ''}</pre>
            </div>
        );
    }

    // 2. Check for JSON
    if (content.trim().startsWith('{') && content.trim().endsWith('}')) {
        try {
            const obj = JSON.parse(content);
            return (
                <div className="w-full h-full p-2 bg-amber-50 text-amber-900 font-mono text-xs rounded overflow-hidden relative" onClick={onClick}>
                    <div className="absolute top-1 right-1 bg-amber-100 px-1 rounded text-[10px] text-amber-600 font-bold">JSON</div>
                    <pre className="whitespace-pre-wrap">{JSON.stringify(obj, null, 2).substring(0, 100)}...</pre>
                </div>
            );
        } catch (e) { /* Not valid JSON, fallthrough */ }
    }

    // 3. Check for Markdown Image
    const imgMatch = content.match(/!\[(.*?)\]\((.*?)\)/);
    if (imgMatch) {
        return (
             <div className="w-full h-full p-1 flex items-center justify-center bg-gray-50 rounded overflow-hidden relative group" onClick={onClick}>
                <img src={imgMatch[2]} alt={imgMatch[1]} className="max-h-full max-w-full object-contain rounded" />
                <div className="absolute bottom-0 left-0 right-0 bg-black/50 text-white text-[10px] p-1 truncate opacity-0 group-hover:opacity-100 transition-opacity">
                    {imgMatch[1] || 'Image'}
                </div>
            </div>
        );
    }

    // 4. Default Rich Text / HTML
    return (
        <div 
            className="w-full h-full p-3 text-sm text-gray-700 overflow-hidden text-ellipsis whitespace-nowrap"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(content || '') }}
            onClick={onClick}
        />
    );
};

// --- Status Indicator Component ---
const StatusIndicator: React.FC<{ status: 'idle' | 'queued' | 'running' | 'success' | 'error', onRetry?: () => void }> = ({ status, onRetry }) => {
    if (status === 'idle') return null;
    
    if (status === 'queued') {
        return (
            <div className="absolute top-1 right-1 w-2 h-2 rounded-full bg-gray-300 animate-pulse" title="Waiting in queue..." />
        );
    }
    
    if (status === 'running') {
        return (
            <div className="absolute top-1 right-1 w-3 h-3">
                 <svg className="animate-spin h-3 w-3 text-indigo-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            </div>
        );
    }

    if (status === 'success') {
        return (
            <div className="absolute top-1 right-1 text-green-500 animate-fade-out" style={{ animationDelay: '2s', animationFillMode: 'forwards' }}>
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>
            </div>
        );
    }

    if (status === 'error') {
        return (
            <div className="absolute top-1 right-1 cursor-pointer" onClick={(e) => { e.stopPropagation(); onRetry && onRetry(); }} title="Failed. Click to retry.">
                <span className="text-red-500 text-[10px] font-bold">RETRY</span>
            </div>
        );
    }

    return null;
};

interface AgentWorkflowTableProps {
    teamMembers: TeamMember[];
    warehousePath?: string;
}

const AgentWorkflowTable: React.FC<AgentWorkflowTableProps> = ({ teamMembers, warehousePath }) => {
    // --- Templates ---
    const TEMPLATES = {
        'content-pipeline': {
            name: '全媒体内容生产流水线',
            columns: [
                { id: 'col-A', title: '选题/灵感', type: 'text', width: 200 },
                { id: 'col-B', title: '文案生成 (Copywriter)', type: 'text', width: 300, agentId: 'agent-copywriter', promptTemplate: '请根据 {{col-A}} 撰写一篇吸引人的社媒文案，包含Emoji和Hashtag。' },
                { id: 'col-C', title: '视觉海报 (Designer)', type: 'text', width: 150, agentId: 'agent-designer', promptTemplate: 'Generate a creative poster prompt for: {{col-A}}' },
                { id: 'col-D', title: '图文排版 (Layout)', type: 'text', width: 200, agentId: 'agent-layout', promptTemplate: 'Combine text from {{col-B}} and image from {{col-C}} into a mobile layout.' },
                { id: 'col-E', title: '一键发布 (Publisher)', type: 'status', width: 120, agentId: 'agent-publisher', promptTemplate: 'Publish content from {{col-D}} to drafts.' }
            ] as Column[],
            rows: [
                { id: 'row-1', 'col-A': '春季社区公益植树活动' },
                { id: 'row-2', 'col-A': '为乡村留守儿童捐赠图书' },
                { id: 'row-3', 'col-A': '海洋垃圾清理志愿者招募' }
            ]
        },
        'field-research': {
            name: '数字田野调查自动化',
            columns: [
                { id: 'col-A', title: '目标链接 (URL)', type: 'text', width: 250 },
                { id: 'col-B', title: '采集状态', type: 'text', width: 150, agentId: 'agent-scraper', promptTemplate: 'Simulate scraping and OCR for: {{col-A}}' },
                { id: 'col-C', title: '清洗结果 (Summary)', type: 'text', width: 300, agentId: 'agent-cleaner', promptTemplate: 'Summarize the content from {{col-B}}' },
                { id: 'col-D', title: '结构化数据 (JSON)', type: 'text', width: 250, agentId: 'agent-formatter', promptTemplate: 'Convert {{col-C}} to JSON' }
            ] as Column[],
            rows: [
                { id: 'row-1', 'col-A': 'https://www.xiaohongshu.com/explore/123456' },
                { id: 'row-2', 'col-A': 'https://mp.weixin.qq.com/s/abcdefg' }
            ]
        }
    };

    const loadTemplate = (templateKey: keyof typeof TEMPLATES) => {
        const t = TEMPLATES[templateKey];
        if (t) {
            setColumns(t.columns);
            setRows(t.rows.map(r => ({ ...r, _status: {} }))); // Reset status
        }
    };

    // --- State ---
    const [columns, setColumns] = useState<Column[]>([
        { id: 'col-A', title: 'A', type: 'text', width: 100 },
        { id: 'col-B', title: 'B', type: 'text', width: 100 },
        { id: 'col-C', title: 'C', type: 'text', width: 100 },
        { id: 'col-D', title: 'D', type: 'text', width: 100 },
        { id: 'col-E', title: 'E', type: 'text', width: 100 },
        { id: 'col-F', title: 'F', type: 'text', width: 100 },
        { id: 'col-G', title: 'G', type: 'text', width: 100 },
        { id: 'col-H', title: 'H', type: 'text', width: 100 },
    ]);
    
    // Generate 20 empty rows
    const [rows, setRows] = useState<Row[]>(
        Array.from({ length: 20 }).map((_, i) => ({ id: `row-${i + 1}` }))
    );

    const [editingColumn, setEditingColumn] = useState<Column | null>(null);
    const [isConfigOpen, setIsConfigOpen] = useState(false);
    
    // View Config
    const [isTransposed, setIsTransposed] = useState(false);
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' } | null>(null);
    const [filterConfig, setFilterConfig] = useState<{ key: string, value: string } | null>(null);

    // Interaction State
    const [contextMenu, setContextMenu] = useState<{ x: number, y: number, rowId: string, colId: string } | null>(null);
    const [headerContextMenu, setHeaderContextMenu] = useState<{ x: number, y: number, colId: string } | null>(null);
    const [draggedRowId, setDraggedRowId] = useState<string | null>(null);
    const [headerFilterInput, setHeaderFilterInput] = useState(''); // New state for inline filter input
    
    const [aiWakeupModal, setAiWakeupModal] = useState<{ rowId: string, colId: string, content: string } | null>(null);
    const [aiWakeupPrompt, setAiWakeupPrompt] = useState('');
    const [fileImportModal, setFileImportModal] = useState<{ rowId: string, colId: string } | null>(null);
    const [availableFiles, setAvailableFiles] = useState<{name: string, path: string, isDir: boolean}[]>([]);
    const [currentPath, setCurrentPath] = useState(warehousePath || '');
    
    // Cell Editing & Preview
    const [editingCell, setEditingCell] = useState<{ rowId: string, colId: string } | null>(null);
    const [hoveredCell, setHoveredCell] = useState<{ rowId: string, colId: string, x: number, y: number, content: string } | null>(null);

    // Refs for resizing
    const resizingCol = useRef<{ id: string, startX: number, startWidth: number } | null>(null);
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // --- Helpers ---
    const experts = useMemo(() => teamMembers.filter(m => m.isAI), [teamMembers]);

    // Apply Sort & Filter
    const processedRows = useMemo(() => {
        let result = [...rows];
        
        const stripTags = (html: string) => {
            const tmp = document.createElement('DIV');
            tmp.innerHTML = html;
            return tmp.textContent || tmp.innerText || '';
        };

        // Filter
        if (filterConfig && filterConfig.value) {
            result = result.filter(row => {
                const rawValue = String(row[filterConfig.key] || '');
                const cellValue = stripTags(rawValue).toLowerCase();
                return cellValue.includes(filterConfig.value.toLowerCase());
            });
        }

        // Sort
        if (sortConfig) {
            result.sort((a, b) => {
                const rawA = String(a[sortConfig.key] || '');
                const rawB = String(b[sortConfig.key] || '');
                const valA = stripTags(rawA);
                const valB = stripTags(rawB);
                
                return sortConfig.direction === 'asc' 
                    ? valA.localeCompare(valB, 'zh-CN')
                    : valB.localeCompare(valA, 'zh-CN');
            });
        }
        return result;
    }, [rows, filterConfig, sortConfig]);

    const [currentTemplate, setCurrentTemplate] = useState<string | null>(null);

    // --- Handlers ---
    const handleTemplateChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const val = e.target.value;
        if (val && TEMPLATES[val as keyof typeof TEMPLATES]) {
            setCurrentTemplate(val);
            loadTemplate(val as keyof typeof TEMPLATES);
        } else {
            setCurrentTemplate(null);
            // Optional: Reset to default empty state
        }
    };

    // 1. Column/Row Management
    const handleAddColumn = () => {
        setColumns([...columns, { id: `col-${Date.now()}`, title: '新列', type: 'text', width: 160 }]);
    };

    const handleAddRow = () => {
        setRows([...rows, { id: `row-${Date.now()}` }]);
    };

    const handleCellChange = (rowId: string, colId: string, value: any) => {
        setRows(prev => prev.map(r => r.id === rowId ? { ...r, [colId]: value } : r));
    };

    const handleDeleteRow = (rowId: string) => {
        setRows(prev => prev.filter(r => r.id !== rowId));
    };

    const handleDeleteColumn = (colId: string) => {
        setColumns(prev => prev.filter(c => c.id !== colId));
    };

    // 2. Drag & Drop Row Reordering
    const handleDragStart = (e: React.DragEvent, rowId: string) => {
        setDraggedRowId(rowId);
        e.dataTransfer.effectAllowed = "move";
        // e.dataTransfer.setData("text/plain", rowId); 
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault(); // Necessary to allow dropping
    };
    
    const handleDragEnd = () => {
        setDraggedRowId(null);
    }

    const handleDrop = (e: React.DragEvent, targetRowId: string) => {
        e.preventDefault();
        if (!draggedRowId || draggedRowId === targetRowId) {
            setDraggedRowId(null);
            return;
        }

        const oldIndex = rows.findIndex(r => r.id === draggedRowId);
        const newIndex = rows.findIndex(r => r.id === targetRowId);
        
        if (oldIndex === -1 || newIndex === -1) {
            setDraggedRowId(null);
            return;
        }

        const newRows = [...rows];
        const [movedRow] = newRows.splice(oldIndex, 1);
        newRows.splice(newIndex, 0, movedRow);
        
        setRows(newRows);
        setDraggedRowId(null);
    };

    // 3. Resizing
    const startResize = (e: React.MouseEvent, colId: string, width: number) => {
        e.preventDefault();
        e.stopPropagation();
        resizingCol.current = { id: colId, startX: e.clientX, startWidth: width };
        document.body.style.cursor = 'col-resize'; // Global cursor
        window.addEventListener('mousemove', handleResizeMove);
        window.addEventListener('mouseup', handleResizeUp);
    };

    const handleResizeMove = (e: MouseEvent) => {
        if (!resizingCol.current) return;
        const diff = e.clientX - resizingCol.current.startX;
        const newWidth = Math.max(80, resizingCol.current.startWidth + diff); // Min width 80
        setColumns(prev => prev.map(c => c.id === resizingCol.current!.id ? { ...c, width: newWidth } : c));
    };

    const handleResizeUp = () => {
        resizingCol.current = null;
        document.body.style.cursor = ''; // Reset cursor
        window.removeEventListener('mousemove', handleResizeMove);
        window.removeEventListener('mouseup', handleResizeUp);
    };

    // 4. AI Agent Execution (Batch)
    const runAgentTask = async (agentId: string, inputData: any, columnId: string): Promise<string> => {
        const agent = experts.find(e => e.id === agentId);
        if (!agent) return "Agent not found";

        // Real API Call if available
        if ((window as any).electronAPI?.knowledge?.completion) {
             const prompt = `Role: ${agent.role}\nTask: Process the following data based on your role.\nData: ${inputData}\n\nOutput only the result.`;
             const res = await (window as any).electronAPI.knowledge.completion({ prompt });
             if (res.success && res.text) return res.text;
        }

        // Mock Logic
        await new Promise(resolve => setTimeout(resolve, 1500));
        
        // Visual Assistant Mock
        if (agentId === 'agent-designer') {
            // Return a placeholder image based on input keyword (mock)
            const keyword = inputData.split(':')[1]?.trim() || 'ngo';
            return `![Generated Poster](https://placehold.co/400x600/indigo/white?text=${encodeURIComponent(keyword)}+Poster)`;
        }

        // Social Publisher Mock
        if (agentId === 'agent-publisher') {
            return `✅ [Published] \n- Platform: WeChat/Xiaohongshu \n- Status: Draft Saved \n- Time: ${new Date().toLocaleTimeString()}`;
        }

        // Field Research / Scraper Mock
        if (agentId === 'agent-scraper') {
             return `🔄 [Scraping] ${inputData} \n... 📸 Screenshot taken \n... 🔍 OCR Processing \n... ✅ Done`;
        }
        if (agentId === 'agent-cleaner') {
             return `📝 [Summary] \n- Title: Annual Report \n- Author: NGO Team \n- Date: 2024-03-20 \n- Key Stats: 500 volunteers, $50k raised.`;
        }
        if (agentId === 'agent-formatter') {
             return JSON.stringify({
                 title: "Annual Report",
                 author: "NGO Team",
                 date: "2024-03-20",
                 stats: { volunteers: 500, raised: 50000 }
             }, null, 2);
        }

        if (agent.role === '传播官') return `[${agent.nickname}]: 文案优化结果...`;
        if (agent.role === '财务') return `[${agent.nickname}]: 预算审核意见...`;
        return `[${agent.nickname}]: 已处理 (${inputData.substring(0, 10)}...)`;
    };

    // --- Queue Management ---
    const [taskQueue, setTaskQueue] = useState<{ id: string, status: 'pending' | 'running' | 'completed' | 'error', rowId: string, colId: string, input: string }[]>([]);
    const [isQueueProcessing, setIsQueueProcessing] = useState(false);

    // Queue Processor
    useEffect(() => {
        const processQueue = async () => {
            if (isQueueProcessing || taskQueue.length === 0) return;
            
            const nextTask = taskQueue.find(t => t.status === 'pending');
            if (!nextTask) return;

            setIsQueueProcessing(true);
            
            // Mark running
            setTaskQueue(prev => prev.map(t => t.id === nextTask.id ? { ...t, status: 'running' } : t));
            setRows(prev => prev.map(r => {
                if (r.id === nextTask.rowId) {
                    return { ...r, _status: { ...r._status, [nextTask.colId]: 'running' } };
                }
                return r;
            }));

            try {
                // Find column config for agentId
                const col = columns.find(c => c.id === nextTask.colId);
                if (col && col.agentId) {
                    const result = await runAgentTask(col.agentId, nextTask.input, col.id);
                    handleCellChange(nextTask.rowId, nextTask.colId, result);
                    
                    setTaskQueue(prev => prev.map(t => t.id === nextTask.id ? { ...t, status: 'completed' } : t));
                    setRows(prev => prev.map(r => {
                        if (r.id === nextTask.rowId) {
                            return { ...r, _status: { ...r._status, [nextTask.colId]: 'success' } };
                        }
                        return r;
                    }));
                }
            } catch (e) {
                console.error(e);
                setTaskQueue(prev => prev.map(t => t.id === nextTask.id ? { ...t, status: 'error' } : t));
                setRows(prev => prev.map(r => {
                    if (r.id === nextTask.rowId) {
                        return { ...r, _status: { ...r._status, [nextTask.colId]: 'error' } };
                    }
                    return r;
                }));
            } finally {
                setIsQueueProcessing(false);
            }
        };

        processQueue();
    }, [taskQueue, isQueueProcessing, columns]);

    const addToQueue = (rowId: string, colId: string, input: string) => {
        const newTask = { id: Math.random().toString(36), status: 'pending' as const, rowId, colId, input };
        setTaskQueue(prev => [...prev, newTask]);
        setRows(prev => prev.map(r => {
            if (r.id === rowId) {
                return { ...r, _status: { ...r._status, [colId]: 'queued' } };
            }
            return r;
        }));
    };

    const handleRunColumnAgent = async (col: Column, singleRowId?: string) => {
        if (!col.agentId) return;
        
        const targetRows = singleRowId ? rows.filter(r => r.id === singleRowId) : rows;

        for (const row of targetRows) {
            let inputContext = '';
            if (col.promptTemplate) {
                inputContext = col.promptTemplate.replace(/\{\{(.*?)\}\}/g, (_, key) => {
                    const targetCol = columns.find(c => c.id === key || c.title === key);
                    return targetCol ? (row[targetCol.id] || '') : `[Missing: ${key}]`;
                });
            } else {
                inputContext = columns.filter(c => c.id !== col.id).map(c => `${c.title}: ${row[c.id] || ''}`).join('\n');
            }
            
            addToQueue(row.id, col.id, inputContext);
        }
    };

    const handleRunRowWorkflow = async (rowId: string) => {
        // Find all AI columns in order
        const aiCols = columns.filter(c => c.agentId);
        for (const col of aiCols) {
            await handleRunColumnAgent(col, rowId);
        }
    };

    // 5. Single Cell AI (Wakeup)
    const handleWakeAI = async () => {
        if (!aiWakeupModal) return;
        const { rowId, colId, content } = aiWakeupModal;
        
        const prompt = `Context: ${content}\nUser Command: ${aiWakeupPrompt}`;
        
        try {
            // Try using real AI if available
            if ((window as any).electronAPI?.knowledge?.completion) {
                const res = await (window as any).electronAPI.knowledge.completion({ 
                    prompt: `You are an AI assistant helping to edit a spreadsheet cell.\nOriginal Content: "${content}"\nUser Instruction: "${aiWakeupPrompt}"\n\nPlease provide only the updated content without explanation.` 
                });
                if (res.success && res.text) {
                    handleCellChange(rowId, colId, res.text);
                } else {
                    throw new Error(res.error || 'AI completion failed');
                }
            } else {
                // Mock fallback
                await new Promise(resolve => setTimeout(resolve, 1000));
                const result = `(AI Modified): ${content} -> ${aiWakeupPrompt}`; 
                handleCellChange(rowId, colId, result);
            }
        } catch (e) {
            console.error("AI Error:", e);
            alert("AI 处理失败，请检查网络或配置");
        }
        
        setAiWakeupModal(null);
        setAiWakeupPrompt('');
    };

    // 6. File Import
    const loadFiles = async (path: string) => {
        if (!path) {
            setAvailableFiles([]);
            return;
        }

        if ((window as any).electronAPI?.fs?.readDirectory) {
            try {
                const files = await (window as any).electronAPI.fs.readDirectory(path);
                setAvailableFiles(files);
            } catch (e) { 
                console.error("Failed to read dir", e);
                setAvailableFiles([]);
            }
        } else {
             // DEV ONLY: Remove in production to avoid confusion
             // If no real backend, we show nothing to indicate "Not Connected"
             setAvailableFiles([]);
        }
    };

    useEffect(() => {
        if (fileImportModal) {
            const targetPath = currentPath || warehousePath || '/'; 
            if (targetPath !== currentPath) {
                 setCurrentPath(targetPath);
            } else {
                 loadFiles(targetPath);
            }
        }
    }, [fileImportModal]);
    
    useEffect(() => {
        if (fileImportModal && currentPath) {
            loadFiles(currentPath);
        }
    }, [currentPath]);

    const handleImportFile = (file: { name: string, path: string }, asLink: boolean) => {
        if (!fileImportModal) return;
        const { rowId, colId } = fileImportModal;
        
        const existing = rows.find(r => r.id === rowId)?.[colId] || '';
        const newValue = asLink 
            ? `${existing} <a href="file://${file.path}" target="_blank" class="text-indigo-600 hover:underline">[附件: ${file.name}]</a>`
            : `${existing} [导入内容: ${file.name}...]`; // In real app, read file content
        
        handleCellChange(rowId, colId, newValue);
        setFileImportModal(null);
    };

    // --- Renderers ---

    const renderHeader = (col: Column) => (
        <th 
            key={col.id} 
            className={`p-3 border-r border-gray-100 relative group select-none bg-gray-50 hover:bg-gray-100 transition-colors ${filterConfig?.key === col.id ? 'bg-indigo-50/50' : ''}`}
            style={{ width: col.width, minWidth: col.width, maxWidth: col.width }}
            onContextMenu={(e) => handleHeaderContextMenu(e, col.id)}
            onDoubleClick={() => { setEditingColumn(col); setIsConfigOpen(true); }}
        >
            <div className="flex items-center justify-between overflow-hidden">
                <div className="flex items-center gap-2 overflow-hidden w-full">
                    <span className={`text-xs font-bold truncate ${filterConfig?.key === col.id ? 'text-indigo-600' : 'text-gray-700'}`}>
                        {col.title}
                        {filterConfig?.key === col.id && <span className="ml-1 text-[9px] bg-indigo-100 text-indigo-700 px-1 rounded">筛选中</span>}
                    </span>
                    {col.agentId && experts.find(e => e.id === col.agentId) && (
                        <div className="flex items-center gap-1">
                             <span className="flex items-center gap-1 px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[10px] font-bold whitespace-nowrap">
                                <Icons.Robot /> {experts.find(e => e.id === col.agentId)?.nickname}
                            </span>
                            {/* Run Column Button */}
                            <button 
                                onClick={(e) => { e.stopPropagation(); handleRunColumnAgent(col); }}
                                className="p-1 hover:bg-indigo-200 rounded text-indigo-600 transition-colors"
                                title="运行此列的所有 AI 任务"
                            >
                                <Icons.Play />
                            </button>
                        </div>
                    )}
                </div>
                {/* Visual Hint for Right Click (Optional) */}
                <div className="opacity-0 group-hover:opacity-30 text-[10px] text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none">
                    右键更多
                </div>
            </div>
            {/* Resize Handle */}
            <div 
                className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-indigo-400 z-20 group-hover:bg-gray-300 transition-colors"
                onMouseDown={(e) => startResize(e, col.id, col.width || 160)}
            />
        </th>
    );

    // Context Menu Logic
    const handleContextMenu = (e: React.MouseEvent, rowId: string, colId: string) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, rowId, colId });
        setHeaderContextMenu(null); // Close other menus
    };

    const handleHeaderContextMenu = (e: React.MouseEvent, colId: string) => {
        e.preventDefault();
        setHeaderContextMenu({ x: e.clientX, y: e.clientY, colId });
        setContextMenu(null); // Close other menus
        
        // Pre-fill existing filter value if any
        if (filterConfig?.key === colId) {
            setHeaderFilterInput(filterConfig.value);
        } else {
            setHeaderFilterInput('');
        }
    };

    // Keyboard Navigation
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (editingCell) {
                // If editing, only handle Escape to cancel or Enter (if not textarea) to save
                if (e.key === 'Escape') {
                    setEditingCell(null);
                    // Refocus grid cell logic would go here
                }
                return;
            }

            // Grid Navigation Logic (requires selected cell state, reusing editingCell or adding new selection state)
            // For now, let's implement basic Enter to Edit if hovering or selected
            // NOTE: A proper grid navigation needs a focusedCell state separate from editingCell
        };
        
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [editingCell]);

    // Enhanced Grid Navigation State
    const [focusedCell, setFocusedCell] = useState<{ rowId: string, colId: string } | null>(null);

    // Grid Key Handler
    const handleGridKeyDown = (e: React.KeyboardEvent) => {
        if (editingCell) return; // Let editor handle keys

        if (!focusedCell) return;

        const rowIndex = processedRows.findIndex(r => r.id === focusedCell.rowId);
        const colIndex = columns.findIndex(c => c.id === focusedCell.colId);
        
        if (rowIndex === -1 || colIndex === -1) return;

        if (e.key === 'ArrowRight') {
            e.preventDefault();
            const nextCol = columns[colIndex + 1];
            if (nextCol) setFocusedCell({ rowId: focusedCell.rowId, colId: nextCol.id });
        } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            const prevCol = columns[colIndex - 1];
            if (prevCol) setFocusedCell({ rowId: focusedCell.rowId, colId: prevCol.id });
        } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            const nextRow = processedRows[rowIndex + 1];
            if (nextRow) setFocusedCell({ rowId: nextRow.id, colId: focusedCell.colId });
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prevRow = processedRows[rowIndex - 1];
            if (prevRow) setFocusedCell({ rowId: prevRow.id, colId: focusedCell.colId });
        } else if (e.key === 'Enter') {
            e.preventDefault();
            setEditingCell(focusedCell);
        } else if (e.key === 'Tab') {
            e.preventDefault();
            const nextCol = columns[colIndex + 1];
            if (nextCol) {
                setFocusedCell({ rowId: focusedCell.rowId, colId: nextCol.id });
            } else {
                // Wrap to next row
                const nextRow = processedRows[rowIndex + 1];
                if (nextRow && columns[0]) {
                    setFocusedCell({ rowId: nextRow.id, colId: columns[0].id });
                }
            }
        }
    };

    // Cell Hover Logic
    const handleCellMouseEnter = (e: React.MouseEvent, rowId: string, colId: string, content: string) => {
        if (editingCell?.rowId === rowId && editingCell?.colId === colId) return;
        
        // Clear any pending close timer
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);

        // Show if content exists
        if (!content) return;

        hoverTimeoutRef.current = setTimeout(() => {
            const rect = (e.target as HTMLElement).getBoundingClientRect();
            setHoveredCell({ rowId, colId, x: rect.left, y: rect.bottom + 5, content });
        }, 500); 
    };

    const handleCellMouseLeave = () => {
        if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
        // Add grace period before closing
        hoverTimeoutRef.current = setTimeout(() => {
            setHoveredCell(null);
        }, 300);
    };

    return (
        <div className="flex flex-col h-full bg-white relative">
            {/* Toolbar */}
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <div>
                    <h2 className="text-lg font-bold text-gray-800">智能多维表格</h2>
                    <div className="flex items-center gap-4 mt-1">
                         <p className="text-xs text-gray-500">配置列字段并关联 AI 专家，实现批量自动化处理</p>
                         <select 
                            className="text-[10px] px-2 py-0.5 rounded border border-indigo-200 bg-indigo-50 text-indigo-700 outline-none cursor-pointer"
                            onChange={handleTemplateChange}
                            value={currentTemplate || ''}
                         >
                             <option value="">-- 选择场景模版 --</option>
                             {Object.entries(TEMPLATES).map(([key, t]) => (
                                 <option key={key} value={key}>{t.name}</option>
                             ))}
                         </select>
                         <button onClick={() => setIsTransposed(!isTransposed)} className={`flex items-center gap-1 text-[10px] px-2 py-0.5 rounded border ${isTransposed ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-gray-200 text-gray-600'}`}>
                             <Icons.Transpose /> {isTransposed ? '行/列已对调' : '行列对调'}
                         </button>
                         {filterConfig && (
                             <button onClick={() => setFilterConfig(null)} className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors">
                                 <span className="font-bold">×</span> 清除筛选: {columns.find(c => c.id === filterConfig.key)?.title}
                             </button>
                         )}
                    </div>
                </div>
                <div className="flex gap-2">
                    <button onClick={handleAddRow} className="px-3 py-1.5 bg-white border border-gray-200 text-gray-600 rounded-lg text-xs font-bold hover:bg-gray-50 flex items-center gap-1 shadow-sm transition-all">
                        <Icons.Plus /> 添加行
                    </button>
                    <button onClick={handleAddColumn} className="px-3 py-1.5 bg-indigo-50 border border-indigo-100 text-indigo-600 rounded-lg text-xs font-bold hover:bg-indigo-100 flex items-center gap-1 shadow-sm transition-all">
                        <Icons.Plus /> 添加列
                    </button>
                </div>
            </div>

            {/* Main Table */}
            <div 
                className="flex-1 overflow-auto p-6 bg-gray-50/30 outline-none"
                tabIndex={0}
                onKeyDown={handleGridKeyDown}
                onClick={(e) => {
                     // Click outside clear focus
                     if ((e.target as HTMLElement).tagName !== 'TD' && (e.target as HTMLElement).tagName !== 'TH') {
                         setFocusedCell(null);
                     }
                }}
            >
                <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm bg-white inline-block">
                    <table className="text-left border-collapse table-fixed" style={{ width: columns.reduce((acc, col) => acc + (col.width || 100), 50) + 'px' }}>
                        {!isTransposed ? (
                            <>
                                <thead>
                                    <tr className="bg-gray-50 border-b border-gray-200">
                                        <th className="p-3 w-12 text-center text-gray-400 font-medium text-xs bg-gray-50 sticky left-0 z-10 border-r border-gray-200">#</th>
                                        {columns.map(renderHeader)}
                                    </tr>
                                </thead>
                                <tbody>
                                    {processedRows.map((row, idx) => (
                                        <tr 
                                            key={row.id} 
                                            className={`border-b border-gray-50 hover:bg-gray-50/30 transition-colors group ${draggedRowId === row.id ? 'opacity-50 bg-indigo-50' : ''}`}
                                            draggable
                                            onDragStart={(e) => handleDragStart(e, row.id)}
                                            onDragOver={handleDragOver}
                                            onDragEnd={handleDragEnd}
                                            onDrop={(e) => handleDrop(e, row.id)}
                                        >
                                            <td 
                                                className="p-3 text-center text-xs text-gray-300 font-mono bg-white group-hover:bg-gray-50/30 sticky left-0 z-10 border-r border-gray-50 cursor-move hover:text-indigo-400 transition-colors"
                                                onContextMenu={(e) => {
                                                    e.preventDefault();
                                                    if (confirm('确认删除该行吗？')) handleDeleteRow(row.id);
                                                }}
                                                title="拖动排序 | 右键删除"
                                            >
                                                <div className="flex flex-col items-center gap-1">
                                                    <span>{idx + 1}</span>
                                                    {/* Row Workflow Button */}
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); handleRunRowWorkflow(row.id); }}
                                                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-indigo-100 rounded text-indigo-600 transition-opacity"
                                                        title="运行此行工作流"
                                                    >
                                                        <Icons.Play />
                                                    </button>
                                                </div>
                                            </td>
                                            {columns.map(col => {
                                                const isFocused = focusedCell?.rowId === row.id && focusedCell?.colId === col.id;
                                                return (
                                                <td 
                                                    key={`${row.id}-${col.id}`} 
                                                    className={`border-r border-gray-50 p-0 relative ${isFocused ? 'ring-2 ring-indigo-500 z-30' : ''}`}
                                                    style={{ width: col.width, minWidth: col.width, maxWidth: col.width, height: '40px' }} // Fixed height & width
                                                    onContextMenu={(e) => handleContextMenu(e, row.id, col.id)}
                                                    onMouseEnter={(e) => handleCellMouseEnter(e, row.id, col.id, row[col.id] || '')}
                                                    onMouseLeave={handleCellMouseLeave}
                                                    onClick={() => {
                                                        setFocusedCell({ rowId: row.id, colId: col.id });
                                                        // Optional: setEditingCell({ rowId: row.id, colId: col.id }); // If we want single click edit
                                                    }}
                                                    onDoubleClick={() => setEditingCell({ rowId: row.id, colId: col.id })}
                                                >
                                                    {editingCell?.rowId === row.id && editingCell?.colId === col.id ? (
                                                        <CellEditor 
                                                            row={row}
                                                            col={col}
                                                            value={row[col.id]}
                                                            onChange={(val) => handleCellChange(row.id, col.id, val)}
                                                            onBlur={() => setEditingCell(null)}
                                                            autoFocus
                                                        />
                                                    ) : (
                                                        <>
                                                            <SmartCell 
                                                                content={row[col.id] || ''}
                                                                onClick={() => setFocusedCell({ rowId: row.id, colId: col.id })}
                                                            />
                                                            <StatusIndicator 
                                                                status={row._status?.[col.id] || 'idle'} 
                                                                onRetry={() => {
                                                                    // Re-construct context and add to queue
                                                                    const inputContext = col.promptTemplate 
                                                                        ? col.promptTemplate.replace(/\{\{(.*?)\}\}/g, (_, key) => {
                                                                            const targetCol = columns.find(c => c.id === key || c.title === key);
                                                                            return targetCol ? (row[targetCol.id] || '') : `[Missing: ${key}]`;
                                                                        })
                                                                        : columns.filter(c => c.id !== col.id).map(c => `${c.title}: ${row[c.id] || ''}`).join('\n');
                                                                    
                                                                    addToQueue(row.id, col.id, inputContext);
                                                                }}
                                                            />
                                                        </>
                                                    )}
                                                </td>
                                            )})}
                                        </tr>
                                    ))}
                                </tbody>
                            </>
                        ) : (
                            // Transposed View
                            <tbody>
                                {columns.map((col) => (
                                    <tr key={col.id} className="border-b border-gray-50">
                                        <th 
                                            className="p-3 w-40 bg-gray-50 text-xs font-bold text-gray-700 border-r border-gray-200 sticky left-0 z-10"
                                            onContextMenu={(e) => handleHeaderContextMenu(e, col.id)}
                                            onDoubleClick={() => { setEditingColumn(col); setIsConfigOpen(true); }}
                                        >
                                            {col.title}
                                            {col.agentId && <div className="text-[9px] text-indigo-600 mt-1">🤖 {experts.find(e=>e.id===col.agentId)?.nickname}</div>}
                                        </th>
                                        {processedRows.map((row) => (
                                            <td key={`${row.id}-${col.id}`} className="border-r border-gray-50 p-0 min-w-[200px]" onContextMenu={(e) => handleContextMenu(e, row.id, col.id)}>
                                                 <div 
                                                    contentEditable
                                                    suppressContentEditableWarning
                                                    onBlur={(e) => handleCellChange(row.id, col.id, e.currentTarget.innerHTML)}
                                                    className="w-full h-full p-3 bg-transparent outline-none text-sm text-gray-700 focus:bg-indigo-50/30 transition-colors whitespace-pre-wrap"
                                                    dangerouslySetInnerHTML={{ __html: row[col.id] || '' }}
                                                />
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        )}
                    </table>
                </div>
            </div>

            {/* Hover Preview Portal/Tooltip */}
            {hoveredCell && (
                <div 
                    className="fixed z-[100] bg-white border border-gray-200 rounded-xl shadow-2xl p-4 max-w-sm max-h-64 overflow-y-auto text-sm text-gray-700 animate-fade-in"
                    style={{ top: hoveredCell.y, left: hoveredCell.x }}
                    onMouseEnter={() => { if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current); }}
                    onMouseLeave={() => setHoveredCell(null)}
                >
                    <div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(hoveredCell.content) }} />
                    <div className="mt-2 pt-2 border-t border-gray-100 flex justify-end">
                        <button 
                            onClick={() => {
                                setEditingCell({ rowId: hoveredCell.rowId, colId: hoveredCell.colId });
                                setHoveredCell(null);
                            }}
                            className="text-xs font-bold text-indigo-600 hover:text-indigo-700 flex items-center gap-1"
                        >
                            <Icons.Edit /> 编辑
                        </button>
                    </div>
                </div>
            )}

            {/* Cell Context Menu */}
            {contextMenu && (
                <div 
                    className="fixed bg-white rounded-lg shadow-xl border border-gray-100 py-1 z-50 w-48 animate-fade-in"
                    style={{ top: contextMenu.y, left: contextMenu.x }}
                >
                    <button 
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-indigo-50 flex items-center gap-2"
                        onClick={() => {
                            setAiWakeupModal({ rowId: contextMenu.rowId, colId: contextMenu.colId, content: rows.find(r=>r.id===contextMenu.rowId)?.[contextMenu.colId] || '' });
                            setContextMenu(null);
                        }}
                    >
                        <Icons.Magic /> AI 智能润色
                    </button>
                    <button 
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-indigo-50 flex items-center gap-2"
                        onClick={() => {
                            setFileImportModal({ rowId: contextMenu.rowId, colId: contextMenu.colId });
                            setContextMenu(null);
                        }}
                    >
                        <Icons.File /> 从知识库导入
                    </button>
                    <div className="h-px bg-gray-100 my-1"></div>
                    <button 
                        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                        onClick={() => {
                            handleDeleteRow(contextMenu.rowId);
                            setContextMenu(null);
                        }}
                    >
                        <Icons.Trash /> 删除此行
                    </button>
                </div>
            )}

            {/* Header Context Menu */}
            {headerContextMenu && (
                <div 
                    className="fixed bg-white rounded-lg shadow-xl border border-gray-100 py-1 z-50 w-48 animate-fade-in"
                    style={{ top: headerContextMenu.y, left: headerContextMenu.x }}
                >
                    <div className="px-4 py-1 text-[10px] text-gray-400 font-bold uppercase tracking-widest">列操作</div>
                    
                    {/* Inline Filter Input */}
                    <div className="px-4 py-2 border-b border-gray-100">
                        <div className="flex items-center gap-2 bg-gray-50 rounded px-2 py-1">
                            <Icons.Filter />
                            <input 
                                value={headerFilterInput}
                                onChange={(e) => setHeaderFilterInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        const val = headerFilterInput.trim();
                                        setFilterConfig(val ? { key: headerContextMenu.colId, value: val } : null);
                                        setHeaderContextMenu(null);
                                    }
                                }}
                                placeholder="输入筛选词回车..."
                                className="w-full bg-transparent text-xs outline-none text-gray-700"
                                autoFocus
                            />
                        </div>
                    </div>

                    <button 
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-indigo-50 flex items-center gap-2"
                        onClick={() => {
                            const col = columns.find(c => c.id === headerContextMenu.colId);
                            if (col) { setEditingColumn(col); setIsConfigOpen(true); }
                            setHeaderContextMenu(null);
                        }}
                    >
                        <Icons.Settings /> 配置/重命名
                    </button>
                    {/* Removed old prompt-based button */}
                    <button 
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-indigo-50 flex items-center gap-2"
                        onClick={() => {
                            setSortConfig({ key: headerContextMenu.colId, direction: 'asc' });
                            setHeaderContextMenu(null);
                        }}
                    >
                        <Icons.SortAsc /> 升序排列
                    </button>
                    <button 
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-indigo-50 flex items-center gap-2"
                        onClick={() => {
                            setSortConfig({ key: headerContextMenu.colId, direction: 'desc' });
                            setHeaderContextMenu(null);
                        }}
                    >
                        <Icons.SortDesc /> 降序排列
                    </button>
                    <div className="h-px bg-gray-100 my-1"></div>
                    <button 
                        className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                        onClick={() => {
                            handleDeleteColumn(headerContextMenu.colId);
                            setHeaderContextMenu(null);
                        }}
                    >
                        <Icons.Trash /> 删除此列
                    </button>
                </div>
            )}

            {/* AI Wakeup Modal */}
            {aiWakeupModal && (
                <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setAiWakeupModal(null)}>
                    <div className="bg-white w-96 rounded-2xl shadow-2xl p-6" onClick={e => e.stopPropagation()}>
                        <h3 className="font-bold text-gray-800 mb-4">AI 智能编辑</h3>
                        <div className="bg-gray-50 p-3 rounded-lg text-xs text-gray-500 mb-4 max-h-32 overflow-y-auto">
                            当前内容: {aiWakeupModal.content.replace(/<[^>]+>/g, '').substring(0, 100)}...
                        </div>
                        <input 
                            value={aiWakeupPrompt}
                            onChange={e => setAiWakeupPrompt(e.target.value)}
                            className="w-full p-3 border border-gray-200 rounded-xl text-sm mb-4 outline-none focus:border-indigo-500"
                            placeholder="请输入指令，例如：'翻译成英文' 或 '扩写这段话'..."
                            autoFocus
                        />
                        <div className="flex justify-end gap-2">
                            <button onClick={() => setAiWakeupModal(null)} className="px-4 py-2 text-gray-500 text-sm font-bold hover:bg-gray-100 rounded-lg">取消</button>
                            <button onClick={handleWakeAI} className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700">执行</button>
                        </div>
                    </div>
                </div>
            )}

            {/* File Import Modal */}
            {fileImportModal && (
                <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setFileImportModal(null)}>
                    <div className="bg-white w-[500px] rounded-2xl shadow-2xl p-6" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-4">
                             <h3 className="font-bold text-gray-800">选择知识库文件</h3>
                             <span className="text-xs text-gray-400 truncate max-w-[200px]" title={currentPath}>{currentPath || '未设置路径'}</span>
                        </div>
                        
                        <div className="border border-gray-200 rounded-xl h-64 overflow-y-auto p-2 mb-4 space-y-1">
                            {/* Always show Parent Directory button if currentPath is not empty */}
                            {currentPath && currentPath !== '/' && (
                                <button 
                                    onClick={() => {
                                        // Simple parent logic
                                        const parent = currentPath.split('/').slice(0, -1).join('/') || '/';
                                        setCurrentPath(parent);
                                    }}
                                    className="w-full text-left px-3 py-2 text-xs font-bold text-gray-500 hover:bg-gray-100 rounded-lg flex items-center gap-2"
                                >
                                    <span className="text-lg">..</span> (返回上级)
                                </button>
                            )}
                            {availableFiles.map(f => (
                                <button 
                                    key={f.path}
                                    onClick={() => f.isDir ? setCurrentPath(f.path) : null}
                                    className={`w-full text-left px-3 py-2 text-sm rounded-lg flex items-center justify-between group ${f.isDir ? 'text-gray-600 hover:bg-gray-50 font-bold' : 'text-indigo-600 hover:bg-indigo-50'}`}
                                >
                                    <span className="flex items-center gap-2">
                                        {f.isDir ? '📁' : '📄'} {f.name}
                                    </span>
                                    {!f.isDir && (
                                        <div className="flex gap-2 opacity-0 group-hover:opacity-100">
                                            <span onClick={(e) => { e.stopPropagation(); handleImportFile(f, true); }} className="px-2 py-1 bg-white border border-indigo-100 rounded text-[10px] hover:bg-indigo-600 hover:text-white cursor-pointer shadow-sm">作为链接</span>
                                            <span onClick={(e) => { e.stopPropagation(); handleImportFile(f, false); }} className="px-2 py-1 bg-white border border-indigo-100 rounded text-[10px] hover:bg-indigo-600 hover:text-white cursor-pointer shadow-sm">导入内容</span>
                                        </div>
                                    )}
                                </button>
                            ))}
                            {availableFiles.length === 0 && (
                                <div className="text-center text-gray-400 py-10 text-xs">
                                    {currentPath ? '暂无文件' : '请在设置中配置知识库路径'}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Existing Column Config Modal (Reused) */}
            {isConfigOpen && editingColumn && (
                <div className="fixed inset-0 bg-black/20 backdrop-blur-sm z-50 flex items-center justify-center" onClick={() => setIsConfigOpen(false)}>
                    <div className="bg-white w-96 rounded-2xl shadow-2xl border border-gray-100 p-6 transform transition-all" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center mb-6">
                            <h3 className="text-lg font-bold text-gray-800">列配置</h3>
                            <button onClick={() => setIsConfigOpen(false)} className="text-gray-400 hover:text-gray-600">&times;</button>
                        </div>
                        
                        <div className="space-y-4">
                            <div className="flex gap-4">
                                <div className="flex-1">
                                    <label className="block text-xs font-bold text-gray-500 mb-1">列标题</label>
                                    <input 
                                        value={editingColumn.title} 
                                        onChange={e => {
                                            const val = e.target.value;
                                            setEditingColumn({...editingColumn, title: val});
                                            setColumns(columns.map(c => c.id === editingColumn.id ? { ...c, title: val } : c));
                                        }}
                                        className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:border-indigo-500 outline-none"
                                    />
                                </div>
                                <div className="w-32">
                                    <label className="block text-xs font-bold text-gray-500 mb-1">数据类型</label>
                                    <select 
                                        value={editingColumn.type}
                                        onChange={e => {
                                            const val = e.target.value as any;
                                            setEditingColumn({...editingColumn, type: val});
                                            setColumns(columns.map(c => c.id === editingColumn.id ? { ...c, type: val } : c));
                                        }}
                                        className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:border-indigo-500 outline-none bg-white"
                                    >
                                        <option value="text">文本</option>
                                        <option value="number">数字</option>
                                        <option value="date">日期</option>
                                        <option value="select">选择器</option>
                                        <option value="status">状态</option>
                                    </select>
                                </div>
                            </div>

                            {(editingColumn.type === 'select' || editingColumn.type === 'status') && (
                                <div className="animate-fade-in">
                                    <label className="block text-xs font-bold text-gray-500 mb-1">选项配置 (逗号分隔)</label>
                                    <input 
                                        value={(editingColumn.options || []).join(', ')} 
                                        onChange={e => {
                                            const opts = e.target.value.split(',').map(s => s.trim()).filter(Boolean);
                                            setEditingColumn({...editingColumn, options: opts});
                                            setColumns(columns.map(c => c.id === editingColumn.id ? { ...c, options: opts } : c));
                                        }}
                                        placeholder="例如: 选项1, 选项2, 选项3"
                                        className="w-full p-2 border border-gray-200 rounded-lg text-sm focus:border-indigo-500 outline-none"
                                    />
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-bold text-gray-500 mb-1">关联 AI 专家</label>
                                <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar border border-gray-100 rounded-lg p-1">
                                    <button 
                                        onClick={() => {
                                            const updates = { agentId: undefined };
                                            setEditingColumn({...editingColumn, ...updates});
                                            setColumns(columns.map(c => c.id === editingColumn.id ? { ...c, ...updates } : c));
                                        }}
                                        className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium flex items-center gap-2 ${!editingColumn.agentId ? 'bg-gray-100 text-gray-700' : 'text-gray-500 hover:bg-gray-50'}`}
                                    >
                                        <span className="w-4 h-4 border border-gray-300 rounded-full flex items-center justify-center text-[8px] bg-white">✕</span>
                                        不关联 (手动填写)
                                    </button>
                                    {experts.length === 0 && (
                                        <div className="p-3 text-xs text-gray-400 text-center bg-gray-50 rounded">
                                            暂无 AI 专家可用<br/>请在“团队设置”中添加 AI 成员
                                        </div>
                                    )}
                                    {experts.map(agent => (
                                        <button 
                                            key={agent.id}
                                            onClick={() => {
                                                const updates = { agentId: agent.id };
                                                setEditingColumn({...editingColumn, ...updates});
                                                setColumns(columns.map(c => c.id === editingColumn.id ? { ...c, ...updates } : c));
                                            }}
                                            className={`w-full text-left px-3 py-2 rounded-md text-xs font-medium flex items-center gap-2 ${editingColumn.agentId === agent.id ? 'bg-indigo-50 text-indigo-700 border border-indigo-100' : 'text-gray-600 hover:bg-gray-50'}`}
                                        >
                                            <span className="text-sm">🤖</span>
                                            <div className="flex-1">
                                                <div className="font-bold">{agent.nickname}</div>
                                                <div className="opacity-60 text-[10px]">{agent.role} · {agent.responsibility}</div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {/* Prompt Template Configuration */}
                            {editingColumn.agentId && (
                                <div className="animate-fade-in">
                                    <label className="block text-xs font-bold text-gray-500 mb-1">
                                        Prompt 模板 (引用其他列: {"{{列ID}}"})
                                    </label>
                                    <textarea 
                                        value={editingColumn.promptTemplate || ''}
                                        onChange={e => {
                                            const val = e.target.value;
                                            setEditingColumn({...editingColumn, promptTemplate: val});
                                            setColumns(columns.map(c => c.id === editingColumn.id ? { ...c, promptTemplate: val } : c));
                                        }}
                                        className="w-full h-24 p-2 border border-gray-200 rounded-lg text-xs font-mono focus:border-indigo-500 outline-none resize-none"
                                        placeholder={`例如: 请根据 {{col-A}} 的内容，生成一份简报...`}
                                    />
                                    <div className="mt-1 flex flex-wrap gap-1">
                                        {columns.filter(c => c.id !== editingColumn.id).map(c => (
                                            <button 
                                                key={c.id}
                                                onClick={() => {
                                                    const val = (editingColumn.promptTemplate || '') + `{{${c.id}}}`;
                                                    setEditingColumn({...editingColumn, promptTemplate: val});
                                                    setColumns(columns.map(col => col.id === editingColumn.id ? { ...col, promptTemplate: val } : col));
                                                }}
                                                className="px-1.5 py-0.5 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded text-[10px] border border-gray-200"
                                            >
                                                +{c.title}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                            
                            <div className="pt-4 border-t border-gray-100">
                                <button 
                                    onClick={() => {
                                        setColumns(columns.filter(c => c.id !== editingColumn.id));
                                        setIsConfigOpen(false);
                                    }}
                                    className="w-full py-2 text-red-500 bg-red-50 rounded-lg text-xs font-bold hover:bg-red-100 flex items-center justify-center gap-2"
                                >
                                    <Icons.Trash /> 删除此列
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AgentWorkflowTable;
