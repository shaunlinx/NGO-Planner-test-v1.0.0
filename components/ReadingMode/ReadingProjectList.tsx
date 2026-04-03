import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';

interface ReadingProjectListProps {
    onOpenReader: (file: { name: string, path: string }, purpose: string) => void;
}

const ALL_COLUMNS = [
    { id: 'file_name', label: '文档名称', minWidth: 200, defaultWidth: 250 },
    { id: 'file_type', label: '类型', minWidth: 60, defaultWidth: 80 },
    { id: 'total_pages', label: '页数', minWidth: 60, defaultWidth: 70 },
    { id: 'word_count', label: '字数', minWidth: 60, defaultWidth: 80 },
    { id: 'file_created_at', label: '创建时间', minWidth: 120, defaultWidth: 140 },
    { id: 'ingest_time', label: '导入时间', minWidth: 120, defaultWidth: 140 },
    { id: 'last_read_time', label: '最近阅读', minWidth: 120, defaultWidth: 140 },
    { id: 'total_read_time', label: '阅读时长', minWidth: 80, defaultWidth: 100 },
    { id: 'reading_status', label: '状态', minWidth: 80, defaultWidth: 90 },
    { id: 'read_progress', label: '进度', minWidth: 100, defaultWidth: 120 },
    { id: 'card_count', label: '卡片数', minWidth: 60, defaultWidth: 80 },
    { id: 'top3_tags', label: 'TOP3标签', minWidth: 150, defaultWidth: 200 },
    { id: 'top5_tags', label: 'TOP5标签', minWidth: 200, defaultWidth: 250 },
    { id: 'is_indexed', label: '索引状态', minWidth: 70, defaultWidth: 80 },
    { id: 'chunk_count', label: '切片数', minWidth: 60, defaultWidth: 80 },
    { id: 'hot_chunks', label: '热门切片', minWidth: 100, defaultWidth: 120 },
    { id: 'action', label: '操作', minWidth: 80, defaultWidth: 100 },
];

export const ReadingProjectList: React.FC<ReadingProjectListProps> = ({ onOpenReader }) => {
    const [viewMode, setViewMode] = useState<'history' | 'projects'>('history');
    
    // --- History View State ---
    const [historyViewType, setHistoryViewType] = useState<'card' | 'table'>('card');
    const [readingStats, setReadingStats] = useState<any[]>([]);
    const [fileTopTags, setFileTopTags] = useState<{[path: string]: string[]}>({});
    const [autoCleanupEnabled, setAutoCleanupEnabled] = useState(false);
    const [cleaningEmpty, setCleaningEmpty] = useState(false);
    const [staleHistoryPaths, setStaleHistoryPaths] = useState<Set<string>>(new Set());
    
    const [sortConfig, setSortConfig] = useState<{key: string, direction: 'asc' | 'desc'}>({ key: 'last_read_time', direction: 'desc' });
    
    // Column Management
    const [columns, setColumns] = useState(ALL_COLUMNS.map(c => ({
        ...c,
        width: c.defaultWidth,
        visible: ['file_name', 'reading_status', 'read_progress', 'total_read_time', 'top3_tags', 'action'].includes(c.id)
    })));

    // Resizing State
    const resizingRef = useRef<{ index: number, startX: number, startWidth: number } | null>(null);

    // --- Projects View State ---
    const [projects, setProjects] = useState<any[]>([]);
    const [selectedProject, setSelectedProject] = useState<any | null>(null);
    const [sessions, setSessions] = useState<any[]>([]);
    const [isGeneratingFramework, setIsGeneratingFramework] = useState(false);

    useEffect(() => {
        const init = async () => {
            try {
                const saved = await window.electronAPI.db.getSetting('kb_reading_history_auto_cleanup');
                const enabled = saved === null || saved === undefined ? false : !!saved;
                if (saved === null || saved === undefined) {
                    await window.electronAPI.db.saveSetting('kb_reading_history_auto_cleanup', false);
                }
                setAutoCleanupEnabled(enabled);
                await loadData(enabled);
            } catch (e) {
                await loadData(false);
            }
        };
        init();
        
        // Global mouse up for resizing
        const handleMouseUp = () => {
            resizingRef.current = null;
            document.body.style.cursor = 'default';
            document.body.style.userSelect = 'auto';
        };
        const handleMouseMove = (e: MouseEvent) => {
            if (resizingRef.current) {
                const { index, startX, startWidth } = resizingRef.current;
                const diff = e.clientX - startX;
                setColumns(cols => {
                    const newCols = [...cols];
                    const col = newCols[index];
                    if (!col) return cols;
                    const newWidth = Math.max(col.minWidth, startWidth + diff);
                    newCols[index].width = newWidth;
                    return newCols;
                });
            }
        };

        window.addEventListener('mouseup', handleMouseUp);
        window.addEventListener('mousemove', handleMouseMove);
        return () => {
            window.removeEventListener('mouseup', handleMouseUp);
            window.removeEventListener('mousemove', handleMouseMove);
        };
    }, []);

    const loadData = async (autoCleanup = autoCleanupEnabled) => {
        // Load Extended Stats
        try {
            let staleSet = new Set<string>();
            if (autoCleanup) {
                setCleaningEmpty(true);
                try {
                    const res = await window.electronAPI.knowledge.scanStaleReadingHistory({ limit: 5000, timeoutMs: 800, delete: true });
                    if (res?.success && Array.isArray(res.stalePaths)) {
                        staleSet = new Set(res.stalePaths);
                    }
                } finally {
                    setCleaningEmpty(false);
                }
                setStaleHistoryPaths(new Set());
            } else {
                const res = await window.electronAPI.knowledge.scanStaleReadingHistory({ limit: 5000, timeoutMs: 800, delete: false });
                if (res?.success && Array.isArray(res.stalePaths)) {
                    staleSet = new Set(res.stalePaths);
                    setStaleHistoryPaths(new Set(res.stalePaths));
                } else {
                    setStaleHistoryPaths(new Set());
                }
            }
            // @ts-ignore
            const stats = await window.electronAPI.knowledge.getExtendedStats();
            // Filter for files that have been read or ingested
            // User might want to see all ingested files too? 
            // Previous logic: last_read_time || total_read_time > 0
            // Let's stick to files with reading activity OR explicit ingest for now
            const validFiles = stats.filter((s: any) => s.last_read_time || s.total_read_time > 0 || s.ingest_time);
            const cleanedFiles = autoCleanup ? validFiles.filter((s: any) => !staleSet.has(s.file_path)) : validFiles;
            setReadingStats(cleanedFiles);
            
            // Fetch Top Tags (Limit 5 for TOP5 support)
            const paths = (autoCleanup ? cleanedFiles : validFiles).map((f: any) => f.file_path);
            if (paths.length > 0) {
                // @ts-ignore
                const tagsMap = await window.electronAPI.knowledge.getFileTopTags(paths, 5);
                setFileTopTags(tagsMap);
            }
        } catch(e) { console.error(e); }

        // Load Projects
        try {
            const list = await window.electronAPI.readingMode.getProjects();
            setProjects(list);
        } catch(e) { console.error(e); }
    };

    const handleToggleAutoCleanup = async () => {
        const next = !autoCleanupEnabled;
        setAutoCleanupEnabled(next);
        try {
            await window.electronAPI.db.saveSetting('kb_reading_history_auto_cleanup', next);
        } catch (e) {}
        await loadData(next);
    };

    const handleCleanEmptyNow = async () => {
        setCleaningEmpty(true);
        try {
            await window.electronAPI.knowledge.scanStaleReadingHistory({ limit: 5000, timeoutMs: 800, delete: true });
        } finally {
            setCleaningEmpty(false);
        }
        await loadData(autoCleanupEnabled);
    };

    const handleDeleteHistoryRecord = async (filePath: string) => {
        if (!filePath) return;
        if (!confirm('确定要清理这条阅读历史记录吗？')) return;
        try {
            const res = await window.electronAPI.knowledge.deleteReadingHistory(filePath);
            if (!res?.success) return alert('清理失败: ' + (res?.error || '未知错误'));
            setReadingStats(prev => prev.filter(s => s.file_path !== filePath));
            setStaleHistoryPaths(prev => {
                const next = new Set(prev);
                next.delete(filePath);
                return next;
            });
        } catch (e: any) {
            alert('清理失败: ' + (e?.message || '未知错误'));
        }
    };

    // --- Sorting Logic ---
    const sortedStats = useMemo(() => {
        let sorted = [...readingStats];
        if (sortConfig.key) {
            sorted.sort((a, b) => {
                let aVal: any = '';
                let bVal: any = '';

                switch(sortConfig.key) {
                    case 'file_name':
                        aVal = a.file_name || a.file_path.split(/[\\/]/).pop();
                        bVal = b.file_name || b.file_path.split(/[\\/]/).pop();
                        break;
                    case 'read_progress':
                        aVal = (a.read_progress || 0) / (a.total_pages || 1);
                        bVal = (b.read_progress || 0) / (b.total_pages || 1);
                        break;
                    case 'total_read_time':
                        aVal = a.total_read_time || 0;
                        bVal = b.total_read_time || 0;
                        break;
                    case 'last_read_time':
                        aVal = a.last_read_time || 0;
                        bVal = b.last_read_time || 0;
                        break;
                    case 'file_created_at':
                        aVal = a.file_created_at || 0;
                        bVal = b.file_created_at || 0;
                        break;
                    case 'ingest_time':
                        aVal = a.ingest_time || 0;
                        bVal = b.ingest_time || 0;
                        break;
                    case 'total_pages':
                        aVal = a.total_pages || 0;
                        bVal = b.total_pages || 0;
                        break;
                    case 'card_count':
                        aVal = a.card_count || 0;
                        bVal = b.card_count || 0;
                        break;
                    default:
                        aVal = a[sortConfig.key] || 0;
                        bVal = b[sortConfig.key] || 0;
                }

                if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
                if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
                return 0;
            });
        }
        return sorted;
    }, [readingStats, sortConfig]);

    const handleSort = (key: string) => {
        setSortConfig(current => ({
            key,
            direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
        }));
    };

    const handleResizeStart = (e: React.MouseEvent, index: number) => {
        e.preventDefault();
        e.stopPropagation();
        resizingRef.current = {
            index,
            startX: e.clientX,
            startWidth: columns[index].width
        };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    // --- Render Helpers ---
    const getReadingStatus = (stat: any) => {
        const progress = (stat.read_progress || 0) / (stat.total_pages || 1);
        if (progress >= 0.99) return { label: '已完读', color: 'bg-green-100 text-green-700' };
        if (progress > 0) return { label: '阅读中', color: 'bg-blue-100 text-blue-700' };
        return { label: '未阅读', color: 'bg-slate-100 text-slate-500' };
    };

    const renderCell = (colId: string, stat: any) => {
        const status = getReadingStatus(stat);
        const tags = fileTopTags[stat.file_path] || [];

        switch (colId) {
            case 'file_name':
                return (
                    <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-indigo-50 text-indigo-600 rounded flex items-center justify-center text-[10px] font-bold shrink-0">DOC</div>
                        <div className="truncate font-medium text-slate-700" title={stat.file_path}>{stat.file_name || stat.file_path.split(/[\\/]/).pop()}</div>
                    </div>
                );
            case 'file_type':
                return <span className="uppercase text-xs text-slate-500">{stat.file_type || stat.file_path.split('.').pop()}</span>;
            case 'total_pages':
                return <span className="font-mono text-slate-600">{stat.total_pages || '-'}</span>;
            case 'word_count':
                return <span className="text-slate-400 text-xs italic">N/A</span>;
            case 'file_created_at':
                return <span className="text-slate-500 text-xs">{stat.file_created_at ? new Date(stat.file_created_at).toLocaleDateString() : '-'}</span>;
            case 'ingest_time':
                return <span className="text-slate-500 text-xs">{stat.ingest_time ? new Date(stat.ingest_time).toLocaleDateString() : '-'}</span>;
            case 'last_read_time':
                return <span className="text-slate-600 text-xs">{stat.last_read_time ? new Date(stat.last_read_time).toLocaleString() : '-'}</span>;
            case 'total_read_time':
                return <span className="font-mono text-indigo-600 font-medium">{(stat.total_read_time || 0).toFixed(1)}h</span>;
            case 'reading_status':
                return <span className={`text-[10px] px-2 py-0.5 rounded-full ${status.color}`}>{status.label}</span>;
            case 'read_progress':
                const pct = Math.min(100, ((stat.read_progress || 0) / (stat.total_pages || 1)) * 100);
                return (
                    <div className="w-full max-w-[100px]">
                        <div className="flex justify-between text-[10px] text-slate-500 mb-0.5">
                            <span>{pct.toFixed(0)}%</span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div className="bg-indigo-500 h-full rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                    </div>
                );
            case 'card_count':
                return <span className="font-bold text-slate-700">{stat.card_count || 0}</span>;
            case 'top3_tags':
                return (
                    <div className="flex gap-1 flex-wrap overflow-hidden h-6">
                        {tags.slice(0, 3).map((t, i) => (
                            <span key={i} className="text-[10px] px-1.5 bg-slate-100 text-slate-500 rounded border border-slate-200 truncate max-w-[60px]">{t}</span>
                        ))}
                    </div>
                );
            case 'top5_tags':
                return (
                    <div className="flex gap-1 flex-wrap overflow-hidden h-6">
                        {tags.slice(0, 5).map((t, i) => (
                            <span key={i} className="text-[10px] px-1.5 bg-slate-100 text-slate-500 rounded border border-slate-200 truncate max-w-[60px]">{t}</span>
                        ))}
                    </div>
                );
            case 'is_indexed':
                return stat.use_in_rag ? 
                    <span className="text-green-600 text-[10px] border border-green-200 bg-green-50 px-1 rounded">已索引</span> : 
                    <span className="text-slate-400 text-[10px]">未索引</span>;
            case 'chunk_count':
                 return <span className="text-slate-400 text-xs italic">N/A</span>;
            case 'hot_chunks':
                 return <button className="text-[10px] text-indigo-500 hover:underline" onClick={(e) => { e.stopPropagation(); alert("暂无热度数据"); }}>查看TOP3</button>;
            case 'action':
                if (staleHistoryPaths.has(stat.file_path)) {
                    return (
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-50 text-red-600 border border-red-200">无效记录</span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleDeleteHistoryRecord(stat.file_path);
                                }}
                                className="text-xs font-bold text-red-600 hover:text-red-800 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                            >
                                清理
                            </button>
                        </div>
                    );
                }
                return (
                    <button 
                        onClick={(e) => {
                            e.stopPropagation();
                            onOpenReader({ name: stat.file_name || stat.file_path.split(/[\\/]/).pop(), path: stat.file_path }, 'Resume Reading');
                        }}
                        className="text-xs font-bold text-indigo-600 hover:text-indigo-800 hover:bg-indigo-50 px-2 py-1 rounded transition-colors"
                    >
                        阅读
                    </button>
                );
            default:
                return null;
        }
    };

    // --- Project Handlers (Same as before) ---
    const handleSelectProject = async (p: any) => {
        setSelectedProject(p);
        const sList = await window.electronAPI.readingMode.getSessions(p.id);
        setSessions(sList);
    };

    const handleGenerateFramework = async () => {
        if (!selectedProject || sessions.length === 0) return;
        setIsGeneratingFramework(true);
        try {
            let allCardsContent = "";
            for (const s of sessions) {
                const cards = await window.electronAPI.readingMode.getCards(s.id);
                if (cards && cards.length > 0) {
                    allCardsContent += `\n\n--- Document: ${s.file_path.split('/').pop()} ---\n`;
                    allCardsContent += cards.map((c: any) => 
                        `- Quote: "${c.selected_text}"\n  Note: ${c.user_note}\n  Tags: ${c.ai_tags.join(', ')}`
                    ).join('\n');
                }
            }
            if (!allCardsContent) {
                alert("该主题下暂无笔记，无法生成框架。");
                setIsGeneratingFramework(false);
                return;
            }
            const prompt = `Context: The user has collected knowledge cards from multiple documents for the purpose: "${selectedProject.purpose}".\n\nAggregated Notes:\n${allCardsContent}\n\nTask: Create a comprehensive "Knowledge Framework" (知识框架) that synthesizes these notes into a structured outline.\n\nRequirements:\n1. The framework should be hierarchical (H1, H2, H3).\n2. It must directly address the reading purpose.\n3. Integrate concepts from different documents.\n4. Output in Markdown.\n5. Language: Chinese.`;
            const res = await window.electronAPI.knowledge.completion({ prompt });
            if (res.success && res.text) {
                await window.electronAPI.readingMode.saveSummary({
                    id: uuidv4(),
                    target_id: selectedProject.id,
                    target_type: 'project',
                    content: res.text
                });
                alert("知识框架生成成功！已保存。");
            }
        } catch (e) {
            console.error(e);
            alert("生成失败");
        } finally {
            setIsGeneratingFramework(false);
        }
    };

    return (
        <div className="h-full flex flex-col bg-slate-50">
            {/* Header / Tabs */}
            <div className="px-6 py-4 bg-white border-b border-slate-200 flex items-center justify-between">
                <div className="flex items-center gap-6">
                    <button 
                        onClick={() => setViewMode('history')}
                        className={`text-sm font-bold pb-1 border-b-2 transition-colors ${viewMode === 'history' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                    >
                        📜 阅读历史
                    </button>
                    <button 
                        onClick={() => setViewMode('projects')}
                        className={`text-sm font-bold pb-1 border-b-2 transition-colors ${viewMode === 'projects' ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                    >
                        📚 主题阅读
                    </button>
                </div>

                {viewMode === 'history' && (
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleToggleAutoCleanup}
                            disabled={cleaningEmpty}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${
                                autoCleanupEnabled
                                    ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
                            } ${cleaningEmpty ? 'opacity-50' : ''}`}
                            title="自动清理会在进入阅读历史时，自动移除无效记录（丢失/空文件/不可访问）"
                        >
                            自动清理：{autoCleanupEnabled ? '开' : '关'}
                        </button>
                        <button
                            onClick={handleCleanEmptyNow}
                            disabled={cleaningEmpty}
                            className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors bg-white text-slate-600 border-slate-200 hover:bg-slate-50 ${cleaningEmpty ? 'opacity-50' : ''}`}
                            title="立即清理无效的阅读历史记录"
                        >
                            {cleaningEmpty ? '清理中...' : '清理无效记录'}
                        </button>
                        {!autoCleanupEnabled && staleHistoryPaths.size > 0 && (
                            <span className="text-[11px] text-red-500 font-bold">无效记录 {staleHistoryPaths.size}</span>
                        )}
                         {/* View Switcher */}
                         <div className="flex bg-slate-100 rounded-lg p-0.5 border border-slate-200">
                            <button 
                                onClick={() => setHistoryViewType('card')}
                                className={`p-1.5 rounded-md transition-all ${historyViewType === 'card' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                                title="卡片视图"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" /></svg>
                            </button>
                            <button 
                                onClick={() => setHistoryViewType('table')}
                                className={`p-1.5 rounded-md transition-all ${historyViewType === 'table' ? 'bg-white shadow-sm text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                                title="列表视图"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" /></svg>
                            </button>
                        </div>
                        
                        {/* Advanced Column Filter */}
                        {historyViewType === 'table' && (
                            <div className="relative group z-50">
                                <button className="p-2 hover:bg-slate-100 rounded-lg text-slate-500">
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                                </button>
                                <div className="absolute right-0 top-full mt-2 w-64 bg-white rounded-xl shadow-xl border border-slate-200 p-3 hidden group-hover:block max-h-96 overflow-y-auto">
                                    <div className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider sticky top-0 bg-white pb-2 border-b border-slate-100">展示列配置</div>
                                    <div className="space-y-1">
                                        {columns.map((col, idx) => (
                                            <label key={col.id} className="flex items-center gap-2 text-sm text-slate-700 hover:bg-slate-50 p-1.5 rounded cursor-pointer">
                                                <input 
                                                    type="checkbox" 
                                                    checked={col.visible}
                                                    onChange={() => {
                                                        const newCols = [...columns];
                                                        newCols[idx].visible = !newCols[idx].visible;
                                                        setColumns(newCols);
                                                    }}
                                                    className="rounded text-indigo-600 focus:ring-indigo-500"
                                                />
                                                <span className="flex-1">{col.label}</span>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden bg-slate-50/50">
                {viewMode === 'history' ? (
                    <div className="h-full overflow-hidden flex flex-col">
                         {readingStats.length === 0 ? (
                            <div className="flex flex-col items-center justify-center flex-1 text-slate-400">
                                <span className="text-4xl mb-4">📖</span>
                                <p>暂无阅读记录</p>
                                <p className="text-xs mt-2">在左侧点击文档即可开始阅读</p>
                            </div>
                         ) : historyViewType === 'card' ? (
                            // --- CARD VIEW ---
                            <div className="flex-1 overflow-y-auto p-6">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                                    {sortedStats.map(stat => (
                                        (() => {
                                            const isStale = staleHistoryPaths.has(stat.file_path);
                                            return (
                                        <div 
                                            key={stat.file_path}
                                            onClick={() => {
                                                if (isStale) return alert('该文件已丢失或不可访问，可清理这条阅读历史记录。');
                                                onOpenReader({ 
                                                    name: stat.file_name || stat.file_path.split(/[\\/]/).pop(), 
                                                    path: stat.file_path 
                                                }, 'Resume Reading');
                                            }}
                                            className={`bg-white p-5 rounded-xl shadow-sm border transition-all cursor-pointer group flex flex-col h-[200px] ${
                                                isStale ? 'border-red-200 hover:border-red-300 hover:shadow-md' : 'border-slate-100 hover:shadow-md hover:border-indigo-200'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between mb-3">
                                                <div className="w-10 h-10 bg-indigo-50 text-indigo-600 rounded-lg flex items-center justify-center text-lg shadow-sm">
                                                    📄
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {isStale && (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleDeleteHistoryRecord(stat.file_path);
                                                            }}
                                                            className="opacity-0 group-hover:opacity-100 transition-opacity text-red-500 hover:text-red-700 text-sm"
                                                            title="清理这条无效记录"
                                                        >
                                                            🗑
                                                        </button>
                                                    )}
                                                    <div className="text-[10px] text-slate-400 font-mono bg-slate-50 px-2 py-1 rounded-full">
                                                        {isStale ? '无效' : (stat.last_read_time ? new Date(stat.last_read_time).toLocaleDateString() : 'New')}
                                                    </div>
                                                </div>
                                            </div>
                                            
                                            <h3 className="font-bold text-slate-800 text-sm mb-1 truncate" title={stat.file_path}>
                                                {stat.file_name || stat.file_path.split(/[\\/]/).pop()}
                                            </h3>
                                            
                                            {/* TOP Tags (Fallback to top 3 from map) */}
                                            <div className="flex gap-1 mb-auto flex-wrap h-10 overflow-hidden">
                                                {(fileTopTags[stat.file_path] || []).slice(0,3).map((tag, i) => (
                                                    <span key={i} className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded border border-slate-200">
                                                        #{tag}
                                                    </span>
                                                ))}
                                                {!(fileTopTags[stat.file_path]?.length) && (
                                                    <span className="text-[10px] text-slate-300 italic">暂无关键词</span>
                                                )}
                                            </div>
                                            
                                            {/* Stats Footer */}
                                            <div className="mt-4">
                                                <div className="flex justify-between text-[10px] text-slate-500 mb-1.5">
                                                    <span>已读 {((stat.read_progress || 0) / (stat.total_pages || 1) * 100).toFixed(0)}%</span>
                                                    <span className="font-mono">{((stat.total_read_time || 0).toFixed(1))}h</span>
                                                </div>
                                                <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                                    <div 
                                                        className={`${isStale ? 'bg-red-400' : 'bg-indigo-500'} h-full rounded-full`} 
                                                        style={{ width: `${Math.min(100, ((stat.read_progress || 0) / (stat.total_pages || 1)) * 100)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                            );
                                        })()
                                    ))}
                                </div>
                            </div>
                         ) : (
                             // --- TABLE VIEW (RESIZABLE) ---
                             <div className="flex-1 bg-white shadow-sm border-t border-slate-200 overflow-auto relative">
                                 <table className="w-full text-left text-sm border-collapse" style={{ minWidth: '100%' }}>
                                     <thead className="bg-slate-50 sticky top-0 z-10 shadow-sm h-10">
                                         <tr>
                                             {columns.filter(c => c.visible).map((col, idx) => {
                                                 // Find actual index in original array to pass to resize handler
                                                 const realIndex = columns.findIndex(c => c.id === col.id);
                                                 return (
                                                    <th 
                                                        key={col.id} 
                                                        className="relative px-4 py-2 text-xs uppercase text-slate-500 font-bold tracking-wider select-none border-b border-slate-200 whitespace-nowrap overflow-hidden text-ellipsis group"
                                                        style={{ width: col.width, maxWidth: col.width, minWidth: col.width }}
                                                        onClick={() => handleSort(col.id)}
                                                    >
                                                        <div className="flex items-center justify-between h-full">
                                                            <span className="truncate" title={col.label}>{col.label}</span>
                                                            {sortConfig.key === col.id ? (
                                                                <span className="text-indigo-600 ml-1 text-[10px]">{sortConfig.direction === 'asc' ? '▲' : '▼'}</span>
                                                            ) : (
                                                                <span className="text-slate-300 ml-1 text-[10px] opacity-0 group-hover:opacity-100">▼</span>
                                                            )}
                                                        </div>
                                                        {/* Resize Handle */}
                                                        <div 
                                                            className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-300 z-20"
                                                            onMouseDown={(e) => handleResizeStart(e, realIndex)}
                                                        />
                                                    </th>
                                                 );
                                             })}
                                         </tr>
                                     </thead>
                                     <tbody className="divide-y divide-slate-100">
                                         {sortedStats.map(stat => (
                                             <tr key={stat.file_path} className="hover:bg-slate-50 transition-colors h-12">
                                                 {columns.filter(c => c.visible).map(col => (
                                                     <td 
                                                        key={col.id} 
                                                        className="px-4 py-2 border-r border-transparent last:border-r-0 overflow-hidden whitespace-nowrap text-ellipsis"
                                                        style={{ width: col.width, maxWidth: col.width, minWidth: col.width }}
                                                     >
                                                         {renderCell(col.id, stat)}
                                                     </td>
                                                 ))}
                                             </tr>
                                         ))}
                                     </tbody>
                                 </table>
                             </div>
                         )}
                    </div>
                ) : (
                    // --- PROJECTS VIEW (UNCHANGED) ---
                    <div className="h-full flex gap-6 p-6 overflow-hidden">
                        {/* Project List Sidebar */}
                        <div className="w-80 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col">
                            <div className="p-4 border-b border-slate-100 bg-slate-50 rounded-t-xl">
                                <h3 className="font-bold text-slate-700">主题列表</h3>
                            </div>
                            <div className="flex-1 overflow-y-auto p-2">
                                {projects.map(p => (
                                    <div 
                                        key={p.id}
                                        onClick={() => handleSelectProject(p)}
                                        className={`p-4 rounded-lg cursor-pointer mb-2 transition-colors border ${
                                            selectedProject?.id === p.id 
                                            ? 'bg-indigo-50 border-indigo-200' 
                                            : 'bg-white border-transparent hover:bg-slate-50 border-slate-100'
                                        }`}
                                    >
                                        <h4 className={`font-bold ${selectedProject?.id === p.id ? 'text-indigo-700' : 'text-slate-700'}`}>
                                            {p.purpose}
                                        </h4>
                                        <div className="flex items-center gap-2 mt-2 text-xs text-slate-400">
                                            <span>{new Date(p.created_at).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                ))}
                                {projects.length === 0 && (
                                    <div className="text-center p-8 text-slate-400 text-sm">暂无阅读主题</div>
                                )}
                            </div>
                        </div>

                        {/* Details Area */}
                        <div className="flex-1 bg-white rounded-xl shadow-sm border border-slate-200 flex flex-col overflow-hidden">
                            {selectedProject ? (
                                <>
                                    <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50/50">
                                        <div>
                                            <h2 className="text-xl font-bold text-slate-800">{selectedProject.purpose}</h2>
                                            <p className="text-slate-500 text-sm mt-1">包含 {sessions.length} 篇文献阅读记录</p>
                                        </div>
                                        <button 
                                            onClick={handleGenerateFramework}
                                            disabled={isGeneratingFramework}
                                            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg shadow-lg shadow-indigo-100 text-sm font-bold flex items-center gap-2 disabled:opacity-50"
                                        >
                                            {isGeneratingFramework ? (
                                                <>
                                                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"/>
                                                    生成中...
                                                </>
                                            ) : (
                                                <>
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                                                    生成知识框架
                                                </>
                                            )}
                                        </button>
                                    </div>
                                    
                                    <div className="flex-1 overflow-y-auto p-6">
                                        <h3 className="font-bold text-slate-600 mb-4 text-sm uppercase tracking-wider">包含的文档</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                            {sessions.map(s => (
                                                <div 
                                                    key={s.id} 
                                                    onClick={() => onOpenReader({ name: s.file_path.split(/[\\/]/).pop(), path: s.file_path }, selectedProject.purpose)}
                                                    className="p-4 bg-white rounded-lg border border-slate-100 hover:border-indigo-200 hover:shadow-md transition-all cursor-pointer group"
                                                >
                                                    <div className="flex items-center gap-3 mb-2">
                                                        <div className="w-8 h-8 bg-indigo-50 text-indigo-600 rounded flex items-center justify-center text-xs font-bold">DOC</div>
                                                        <div className="flex-1 truncate font-bold text-slate-700" title={s.file_path}>
                                                            {s.file_path.split('/').pop()}
                                                        </div>
                                                    </div>
                                                    <div className="text-xs text-slate-400 flex justify-between">
                                                        <span>{new Date(s.created_at).toLocaleDateString()}</span>
                                                        <span className="text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity">阅读 →</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
                                    <svg className="w-16 h-16 mb-4 text-slate-200" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                                    <p>请选择左侧的主题以查看详情</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
