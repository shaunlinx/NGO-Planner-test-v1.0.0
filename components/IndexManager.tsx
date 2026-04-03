import React, { useState, useEffect, useMemo } from 'react';
import DOMPurify from 'dompurify';

// Icons
const Icons = {
    Filter: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>,
    Sort: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>,
    Refresh: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>,
    Delete: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>,
    Lock: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>,
    Unlock: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" /></svg>,
    Analysis: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
    Eye: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 5 8.268 7.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>,
    Folder: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" /></svg>,
    ChevronRight: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>,
    ChevronDown: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>,
    Send: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>,
    Layers: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
};

interface FileStat {
    file_path: string;
    ref_count: number;
    last_ref_time: number | null;
    ingest_time: number | null;
    status: 'active' | 'locked' | 'deprecated';
    weight_factor: number;
    tags: string; // JSON string in DB
    summary?: string;
    keywords?: string;
    use_in_rag?: number;
    chunk_count?: number; // New field for index status
}

const FileDetailPanel: React.FC<{
    file: FileStat | null;
    onClose: () => void;
    onUpdate: (updated: Partial<FileStat>) => void;
    onDelete: () => void;
}> = ({ file, onClose, onUpdate, onDelete }) => {
    const [activeTab, setActiveTab] = useState<'overview' | 'preview' | 'chunks'>('overview');
    const [tags, setTags] = useState<string[]>([]);
    const [tagInput, setTagInput] = useState('');
    
    // Metadata State
    const [metaSummary, setMetaSummary] = useState(file?.summary || '');
    const [metaKeywords, setMetaKeywords] = useState(file?.keywords || '');
    const [useInRag, setUseInRag] = useState(file?.use_in_rag === 1);
    const [generatingMeta, setGeneratingMeta] = useState(false);

    // AI Analysis State
    const [aiInput, setAiInput] = useState('');
    const [aiHistory, setAiHistory] = useState<{role: 'user'|'model', text: string, suggestion?: any}[]>([]);
    const [analyzing, setAnalyzing] = useState(false);
    
    // ... (Preview & Chunk states remain same)
    
    // Sync local state when file changes
    useEffect(() => {
        if (file) {
            try {
                const parsed = JSON.parse(file.tags || '[]');
                setTags(Array.isArray(parsed) ? parsed : []);
            } catch (e) { setTags([]); }
            
            setMetaSummary(file.summary || '');
            setMetaKeywords(file.keywords || '');
            setUseInRag(file.use_in_rag === 1);
            
            setAiHistory([]);
            // ... reset others
        }
    }, [file]);

    const handleSaveMetadata = () => {
        onUpdate({
            summary: metaSummary,
            keywords: metaKeywords,
            use_in_rag: useInRag ? 1 : 0
        });
        alert("元数据已保存");
    };

    const handleGenerateMetadata = async () => {
        if (!file || generatingMeta) return;
        setGeneratingMeta(true);
        try {
            // Use existing analyzeFile but with specific prompt context
            // Or use a new specialized method. For simplicity, we reuse analyzeFile logic in backend 
            // or just trigger AI Analysis with a specific prompt and parse it.
            // Let's assume we use the chat interface for now or add a new IPC.
            // Actually, we can just ask the AI Chat to generate it and then user can copy?
            // User requested "One-click". Let's use a prompt in AI Chat that returns JSON and we parse it.
            
            const prompt = "请生成该文档的简短摘要（summary）和关键词（keywords），返回JSON格式：{\"summary\": \"...\", \"keywords\": \"...\"}";
            setAiInput(prompt);
            await handleAiAnalyze(prompt, true); // Pass flag to auto-apply if successful? Or just let user see it.
            // Better: Add dedicated backend method or reuse analyzeFile with flag.
            // Let's reuse analyzeFile but looking for specific fields.
        } finally {
            setGeneratingMeta(false);
        }
    };

    // ... (Existing handlers)

    const handleAdoptSuggestion = (suggestion: any) => {
        if (!suggestion) return;
        
        const updates: Partial<FileStat> = {};
        if (suggestion.status) updates.status = suggestion.status;
        if (suggestion.weight_factor) updates.weight_factor = suggestion.weight_factor;
        if (suggestion.tags) {
            const newTags = suggestion.tags;
            setTags(newTags);
            updates.tags = JSON.stringify(newTags);
        }
        if (suggestion.summary) {
            setMetaSummary(suggestion.summary);
            updates.summary = suggestion.summary;
        }
        if (suggestion.keywords) {
            setMetaKeywords(suggestion.keywords);
            updates.keywords = suggestion.keywords;
        }

        onUpdate(updates);
        alert("已采纳 AI 建议配置！");
    };

    // Removed Duplicate handleAiAnalyze

    const [previewContent, setPreviewContent] = useState<{type: string, data: string} | null>(null);
    const [previewError, setPreviewError] = useState<string | null>(null);
    const [loadingPreview, setLoadingPreview] = useState(false);

    // Chunks State
    const [chunks, setChunks] = useState<any[]>([]);
    const [totalChunks, setTotalChunks] = useState(0);
    const [loadingChunks, setLoadingChunks] = useState(false);
    const [chunkPage, setChunkPage] = useState(0);
    const [chunkSearch, setChunkSearch] = useState('');
    const CHUNK_PAGE_SIZE = 20;

    useEffect(() => {
        if (file) {
            try {
                const parsed = JSON.parse(file.tags || '[]');
                setTags(Array.isArray(parsed) ? parsed : []);
            } catch (e) { setTags([]); }
            setAiHistory([]);
            setPreviewContent(null);
            setPreviewError(null);
            setChunks([]);
            setTotalChunks(0);
            setChunkPage(0);
            setChunkSearch('');
            setActiveTab('overview');
        }
    }, [file]);

    // Load Preview when tab active
    useEffect(() => {
        if (activeTab === 'preview' && file && !previewContent && !loadingPreview) {
            setLoadingPreview(true);
            setPreviewError(null);
            // @ts-ignore
            window.electronAPI.fs.readFilePreview(file.file_path).then(res => {
                if (res.success) {
                    setPreviewContent({ type: res.type, data: res.data });
                } else {
                    setPreviewError(res.error || "未知错误");
                }
                setLoadingPreview(false);
            });
        }
    }, [activeTab, file]);

    const [editChunkText, setEditChunkText] = useState<{text: string, original: string} | null>(null);
    const [batchProcessing, setBatchProcessing] = useState(false);

    // Load Chunks when tab active or page/search changes
    const loadChunks = async (reset = false) => {
        if (!file) return;
        setLoadingChunks(true);
        const offset = reset ? 0 : chunkPage * CHUNK_PAGE_SIZE;
        
        try {
            // @ts-ignore
            const res = await window.electronAPI.knowledge.getChunks({
                filePath: file.file_path,
                limit: CHUNK_PAGE_SIZE,
                offset,
                keyword: chunkSearch
            });
            
            if (res.success) {
                if (reset) {
                    setChunks(res.chunks);
                    setChunkPage(1);
                } else {
                    setChunks(prev => [...prev, ...res.chunks]);
                    setChunkPage(prev => prev + 1);
                }
                setTotalChunks(res.total || 0);
            }
        } catch (e) {
            console.error(e);
        } finally {
            setLoadingChunks(false);
        }
    };

    // Initial load when switching to chunks tab OR when previewing media (to show transcript)
    useEffect(() => {
        // Condition: (In chunks tab) OR (Previewing Media/Image to show text)
        const shouldLoad = (activeTab === 'chunks') || 
                          (previewContent && (previewContent.type === 'media' || previewContent.type === 'image'));
                          
        if (shouldLoad && file) {
            // Force load chunks to ensure transcript is shown
            loadChunks(true);
        }
    }, [activeTab, file, previewContent?.type]);

    const handleUpdateChunk = async () => {
        if (!editChunkText || !file) return;
        const { text, original } = editChunkText;
        if (text === original) {
            setEditChunkText(null);
            return;
        }

        if (!confirm("修改切片内容会触发重新嵌入（Re-embedding），确定保存吗？")) return;

        // @ts-ignore
        const res = await window.electronAPI.knowledge.updateChunk({ 
            filePath: file.file_path, 
            oldText: original, 
            newText: text 
        });

        if (res.success) {
            setChunks(prev => prev.map(c => c.text === original ? { ...c, text } : c));
            setEditChunkText(null);
        } else {
            alert("更新失败: " + res.error);
        }
    };

    const handleBatchAI = async (instruction: string) => {
        if (!file || !chunks.length) return;
        if (!confirm(`确定要对当前列表中的 ${chunks.length} 个切片执行 AI 批量操作吗？这可能需要一些时间。`)) return;

        setBatchProcessing(true);
        try {
            // @ts-ignore
            const res = await window.electronAPI.knowledge.batchAiChunks({
                filePath: file.file_path,
                chunks: chunks.map(c => ({ text: c.text })), // Only send text to minimize payload
                instruction
            });

            if (res.success) {
                alert(`批量操作完成！\n成功更新: ${res.updated} 个\n错误: ${res.errors.length} 个`);
                loadChunks(true); // Reload to get fresh data
            } else {
                alert("批量操作失败: " + res.error);
            }
        } catch (e: any) {
            alert("请求错误: " + e.message);
        } finally {
            setBatchProcessing(false);
        }
    };

    // Search handler
    useEffect(() => {
        if (activeTab === 'chunks') {
            const timer = setTimeout(() => {
                loadChunks(true);
            }, 500); // Debounce
            return () => clearTimeout(timer);
        }
    }, [chunkSearch]);

    const handleAddTag = () => {
        if (tagInput.trim() && !tags.includes(tagInput.trim())) {
            const newTags = [...tags, tagInput.trim()];
            setTags(newTags);
            setTagInput('');
            onUpdate({ tags: JSON.stringify(newTags) as any });
        }
    };

    const handleRemoveTag = (t: string) => {
        const newTags = tags.filter(tag => tag !== t);
        setTags(newTags);
        onUpdate({ tags: JSON.stringify(newTags) as any });
    };

    const handleAiAnalyze = async (overrideInput?: any, isMetaGen = false) => {
        if (!file || analyzing) return;
        
        // Handle both click event (object) and string input
        let question = "";
        if (typeof overrideInput === 'string') {
            question = overrideInput;
        } else {
            question = aiInput.trim() || "这个文件是否有必要调整？比如加权、降权、添加标签或删除？";
        }
        
        setAiHistory(prev => [...prev, { role: 'user', text: question }]);
        setAiInput('');
        setAnalyzing(true);

        try {
            // @ts-ignore
            const contentRes = await window.electronAPI.fs.readFilePreview(file.file_path);
            const content = contentRes.success ? (contentRes.data || '') : "无法读取文件内容";

            // @ts-ignore
            const res = await window.electronAPI.knowledge.analyzeFile({
                filePath: file.file_path,
                content,
                stats: file
            });

            if (res.analysis || res.suggestion) {
                const text = res.analysis || "分析完成";
                setAiHistory(prev => [...prev, { 
                    role: 'model', 
                    text: text,
                    suggestion: res.suggestion 
                }]);
                
                // If this was triggered by "Generate Metadata", we could auto-fill?
                // But user asked for "One-click adopt", so showing the button is better.
            } else {
                setAiHistory(prev => [...prev, { role: 'model', text: "分析失败: 无有效响应" }]);
            }
        } catch (e: any) {
            setAiHistory(prev => [...prev, { role: 'model', text: "请求错误: " + e.message }]);
        } finally {
            setAnalyzing(false);
        }
    };

    const handleDeleteChunk = async (text: string) => {
        if (!confirm("确定删除此切片吗？这不会影响原始文件，但会影响检索结果。")) return;
        if (!file) return;

        // @ts-ignore
        const res = await window.electronAPI.knowledge.deleteChunk({ filePath: file.file_path, text });
        if (res.success) {
            setChunks(prev => prev.filter(c => c.text !== text));
        } else {
            alert("删除失败: " + res.error);
        }
    };

    if (!file) return null;

    const widthClass = activeTab === 'overview' ? 'w-96' : 'w-3/4 max-w-5xl';

    return (
        <div className={`absolute right-0 top-0 bottom-0 ${widthClass} bg-white shadow-2xl border-l border-slate-200 flex flex-col z-20 transition-all duration-300`}>
            {/* Header Tabs */}
            <div className="p-0 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
                <div className="flex flex-1 overflow-x-auto no-scrollbar">
                    <button 
                        onClick={() => setActiveTab('overview')}
                        className={`flex-1 min-w-[80px] px-4 py-3 text-xs font-bold transition-all border-b-2 whitespace-nowrap ${activeTab === 'overview' ? 'border-indigo-600 text-indigo-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                    >
                        概览
                    </button>
                    <button 
                        onClick={() => setActiveTab('preview')}
                        className={`flex-1 min-w-[80px] px-4 py-3 text-xs font-bold transition-all border-b-2 whitespace-nowrap ${activeTab === 'preview' ? 'border-indigo-600 text-indigo-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                    >
                        预览内容
                    </button>
                    <button 
                        onClick={() => setActiveTab('chunks')}
                        className={`flex-1 min-w-[100px] px-4 py-3 text-xs font-bold transition-all border-b-2 whitespace-nowrap ${activeTab === 'chunks' ? 'border-indigo-600 text-indigo-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
                    >
                        切片管理 ({chunks.length || '...'})
                    </button>
                </div>
                <div className="px-3 flex items-center shrink-0">
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-200">✕</button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 bg-slate-50/30">
                {activeTab === 'overview' && (
                    <div className="space-y-4 animate-fade-in">
                        {/* File Title */}
                        <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm">
                             <div className="font-bold text-slate-800 text-sm truncate mb-1" title={file.file_path}>
                                {file.file_path.split(/[\\/]/).pop()}
                             </div>
                             <div className="text-[10px] text-slate-400 truncate" title={file.file_path}>{file.file_path}</div>
                        </div>

                        {/* Actions (Simplified) */}
                        <button onClick={onDelete} className="w-full py-2 bg-red-50 text-red-600 rounded-lg text-xs font-bold hover:bg-red-100 transition-all flex items-center justify-center gap-1">
                            <Icons.Delete /> 删除此文件索引
                        </button>

                        {/* Status & Tags Grid */}
                        <div className="grid grid-cols-1 gap-3">
                            {/* Status & Weight */}
                            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm space-y-3">
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase">干预设置</h4>
                                <div className="flex justify-between items-center">
                                    <span className="text-xs text-slate-600">当前状态</span>
                                    <select 
                                        value={file.status}
                                        onChange={(e) => onUpdate({ status: e.target.value as any })}
                                        className="text-xs bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none"
                                    >
                                        <option value="active">正常 (Active)</option>
                                        <option value="locked">锁定 (Locked)</option>
                                        <option value="deprecated">废弃 (Deprecated)</option>
                                    </select>
                                </div>

                                <div>
                                    <div className="flex justify-between items-center mb-1">
                                        <span className="text-xs text-slate-600">权重系数</span>
                                        <span className={`text-xs font-bold ${file.weight_factor > 1 ? 'text-green-600' : file.weight_factor < 1 ? 'text-red-500' : 'text-slate-500'}`}>
                                            {file.weight_factor.toFixed(1)}x
                                        </span>
                                    </div>
                                    <input 
                                        type="range" min="0.1" max="2.0" step="0.1"
                                        value={file.weight_factor}
                                        onChange={(e) => onUpdate({ weight_factor: parseFloat(e.target.value) })}
                                        className="w-full h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
                                    />
                                    <div className="flex justify-between text-[8px] text-slate-400 mt-1">
                                        <span>0.1 (降权)</span>
                                        <span>1.0</span>
                                        <span>2.0 (加权)</span>
                                    </div>
                                </div>
                            </div>

                            {/* Tags */}
                            <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm space-y-2">
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase">标签管理</h4>
                                <div className="flex flex-wrap gap-2 mb-2">
                                    {tags.length === 0 && <span className="text-xs text-slate-300 italic">暂无标签</span>}
                                    {tags.map((t, i) => (
                                        <span key={`${t}-${i}`} className="bg-indigo-50 text-indigo-700 text-xs px-2 py-1 rounded-full flex items-center gap-1">
                                            {t}
                                            <button onClick={() => handleRemoveTag(t)} className="hover:text-red-500">×</button>
                                        </span>
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    <input 
                                        value={tagInput}
                                        onChange={e => setTagInput(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                                        placeholder="输入标签..."
                                        className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 text-xs outline-none focus:border-indigo-500"
                                    />
                                    <button onClick={handleAddTag} className="px-2 bg-indigo-600 text-white rounded-lg text-xs hover:bg-indigo-700 font-bold">+</button>
                                </div>
                            </div>
                        </div>

                        {/* Document Metadata (Summary & Keywords) */}
                        <div className="bg-white p-3 rounded-xl border border-slate-100 shadow-sm space-y-2">
                            <div className="flex justify-between items-center">
                                <h4 className="text-[10px] font-bold text-slate-400 uppercase">文档元数据 (Metadata)</h4>
                                <button 
                                    onClick={handleGenerateMetadata} 
                                    disabled={generatingMeta}
                                    className="text-[10px] text-indigo-600 font-bold hover:bg-indigo-50 px-2 py-0.5 rounded flex items-center gap-1"
                                >
                                    {generatingMeta ? '生成中...' : '✨ 一键生成'}
                                </button>
                            </div>
                            
                            <div className="space-y-2">
                                <div>
                                    <label className="text-[10px] text-slate-500 block mb-1">摘要 (Summary)</label>
                                    <textarea 
                                        value={metaSummary}
                                        onChange={e => setMetaSummary(e.target.value)}
                                        placeholder="暂无摘要..."
                                        className="w-full h-16 bg-slate-50 border border-slate-200 rounded p-2 text-xs outline-none focus:border-indigo-500 resize-none"
                                    />
                                </div>
                                <div>
                                    <label className="text-[10px] text-slate-500 block mb-1">关键词 (Keywords)</label>
                                    <input 
                                        value={metaKeywords}
                                        onChange={e => setMetaKeywords(e.target.value)}
                                        placeholder="逗号分隔..."
                                        className="w-full bg-slate-50 border border-slate-200 rounded p-2 text-xs outline-none focus:border-indigo-500"
                                    />
                                </div>
                                <div className="flex justify-between items-center pt-1">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input 
                                            type="checkbox" 
                                            checked={useInRag}
                                            onChange={e => setUseInRag(e.target.checked)}
                                            className="w-3 h-3 text-indigo-600 rounded" 
                                        />
                                        <span className="text-[10px] text-slate-600">纳入 RAG 索引源</span>
                                    </label>
                                    <button 
                                        onClick={handleSaveMetadata}
                                        className="px-3 py-1 bg-slate-800 text-white text-[10px] font-bold rounded hover:bg-slate-700"
                                    >
                                        保存元数据
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* AI Analysis Chat */}
                        <div className="flex flex-col h-[250px]">
                            <h4 className="text-[10px] font-bold text-slate-400 uppercase mb-2">AI 辅助分析</h4>
                            <div className="flex-1 bg-white rounded-xl p-3 shadow-sm border border-slate-100 flex flex-col">
                                <div className="flex-1 overflow-y-auto space-y-3 mb-3">
                                    {aiHistory.length === 0 && (
                                        <div className="text-center text-slate-400 text-xs mt-4">
                                            点击下方按钮或输入问题，<br/>分析此文件价值。
                                        </div>
                                    )}
                                    {aiHistory.map((msg, i) => (
                                        <div key={i} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                            <div className={`max-w-[90%] p-2 rounded-lg text-xs leading-relaxed ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-50 border border-slate-100 text-slate-700'}`}>
                                                {msg.text}
                                            </div>
                                            {msg.suggestion && (
                                                <div className="mt-2 ml-1">
                                                    <button 
                                                        onClick={() => handleAdoptSuggestion(msg.suggestion)}
                                                        className="flex items-center gap-1 px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg text-[10px] font-bold hover:bg-green-100 transition-colors shadow-sm"
                                                    >
                                                        ⚡️ 采纳此配置方案
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                    {analyzing && <div className="text-xs text-slate-400 animate-pulse">AI 思考中...</div>}
                                </div>
                                <div className="flex gap-2">
                                    <input 
                                        value={aiInput}
                                        onChange={e => setAiInput(e.target.value)}
                                        onKeyDown={e => e.key === 'Enter' && handleAiAnalyze()}
                                        placeholder="输入问题..."
                                        className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-indigo-500"
                                    />
                                    <button 
                                        onClick={(e) => handleAiAnalyze(undefined, false)}
                                        disabled={analyzing}
                                        className="px-3 bg-purple-600 text-white rounded-lg text-xs hover:bg-purple-700 disabled:opacity-50"
                                    >
                                        <Icons.Send />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'preview' && (
                    <div className="h-full flex flex-col animate-fade-in">
                        {loadingPreview ? (
                            <div className="flex items-center justify-center h-full text-slate-400 gap-2">
                                <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
                                加载预览中...
                            </div>
                        ) : previewContent ? (
                            previewContent.type === 'image' ? (
                                <div className="h-full flex flex-col gap-4">
                                    {/* Image Preview */}
                                    <div className="flex-1 bg-slate-100 rounded-xl border border-slate-200 p-4 flex items-center justify-center overflow-hidden">
                                        <img src={previewContent.data} className="max-w-full max-h-full object-contain shadow-lg rounded" />
                                    </div>
                                    {/* OCR Text / Description */}
                                    <div className="h-1/3 bg-white p-4 rounded-xl border border-slate-200 shadow-sm overflow-auto">
                                        <h4 className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider sticky top-0 bg-white pb-2 border-b border-slate-100">
                                            🖼️ 图片内容解析 (OCR)
                                        </h4>
                                        <div className="font-mono text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                                            {chunks.length > 0 ? chunks[0].text : "暂无解析内容，请检查切片标签页。"}
                                        </div>
                                    </div>
                                </div>
                            ) : previewContent.type === 'media' ? (
                                <div className="h-full flex flex-col gap-4">
                                    {/* Media Player */}
                                    <div className="flex-none bg-black rounded-xl border border-slate-800 p-1 flex items-center justify-center overflow-hidden shadow-lg" style={{ minHeight: '200px', maxHeight: '50%' }}>
                                        {/* Use file:// protocol for local media */}
                                        {/* Note: Web security might block this if not handled in main process. 
                                            Assuming safeFileProtocol or similar is not set up, but let's try direct src.
                                            If blocked, we might need a custom protocol or convert to atom:// 
                                            But since we are in Electron with nodeIntegration: false, local file access via file:// usually works if CSP allows.
                                        */}
                                        <video 
                                            controls 
                                            className="w-full h-full object-contain rounded"
                                            src={`file://${previewContent.data}`}
                                        >
                                            Your browser does not support the video tag.
                                        </video>
                                    </div>
                                    
                                    {/* Transcription Text */}
                                    <div className="flex-1 bg-white p-4 rounded-xl border border-slate-200 shadow-sm overflow-auto">
                                        <h4 className="text-xs font-bold text-slate-500 mb-2 uppercase tracking-wider sticky top-0 bg-white pb-2 border-b border-slate-100 flex justify-between items-center">
                                            <span>🎙️ 语音转录 (Python Whisper)</span>
                                            <span className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">
                                                {chunks.length} 个切片
                                            </span>
                                        </h4>
                                        <div className="font-mono text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                                            {chunks.length > 0 ? (
                                                chunks.map((chunk, i) => (
                                                    <div key={i} className="mb-4 pb-4 border-b border-slate-50 last:border-0">
                                                        {/* Try to parse timestamp from text if present [00:00 --> 00:05] */}
                                                        {/* We can make it clickable to seek video in future */}
                                                        <div className="text-slate-800">{chunk.text}</div>
                                                        <div className="mt-1 text-[10px] text-slate-400">Chunk #{i+1} • Score: {(chunk.score||0).toFixed(2)}</div>
                                                    </div>
                                                ))
                                            ) : (
                                                <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                                                    <span>暂无转录内容</span>
                                                    <span className="text-[10px]">请点击右上角“刷新”按钮尝试重新索引</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="flex-1 bg-white p-8 rounded-xl border border-slate-200 shadow-sm overflow-auto font-mono text-xs leading-relaxed text-slate-700 whitespace-pre-wrap">
                                    {previewContent.data}
                                </div>
                            )
                        ) : (
                            <div className="flex items-center justify-center h-full text-red-400">无法加载预览</div>
                        )}
                    </div>
                )}

                {activeTab === 'chunks' && (
                    <div className="h-full flex flex-col animate-fade-in">
                        <div className="mb-4 bg-blue-50 text-blue-700 p-3 rounded-lg text-xs flex flex-col gap-2">
                             <div className="flex items-center gap-2">
                                <Icons.Layers />
                                <span>此处显示该文件在向量数据库中的实际切片。修改内容会触发向量重算。</span>
                             </div>
                             {/* Search Box */}
                             <div className="relative w-full flex gap-2">
                                <div className="relative flex-1">
                                    <input 
                                        value={chunkSearch}
                                        onChange={e => setChunkSearch(e.target.value)}
                                        placeholder="搜索切片内容..."
                                        className="w-full bg-white border border-blue-200 rounded-lg pl-8 pr-3 py-1.5 text-xs outline-none focus:border-blue-500"
                                    />
                                    <svg className="w-3 h-3 text-blue-300 absolute left-2.5 top-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                                </div>
                                {chunkSearch && (
                                    <div className="flex gap-1">
                                        <button 
                                            onClick={() => handleBatchAI(`删除包含 "${chunkSearch}" 的句子`)}
                                            disabled={batchProcessing}
                                            className="px-3 py-1.5 bg-red-100 text-red-600 rounded-lg text-xs font-bold hover:bg-red-200 whitespace-nowrap"
                                        >
                                            批量清洗
                                        </button>
                                        <button 
                                            onClick={() => {
                                                const instruction = prompt("请输入 AI 润色指令 (例如: '将口语化表达改为书面语')");
                                                if (instruction) handleBatchAI(instruction);
                                            }}
                                            disabled={batchProcessing}
                                            className="px-3 py-1.5 bg-purple-100 text-purple-600 rounded-lg text-xs font-bold hover:bg-purple-200 whitespace-nowrap"
                                        >
                                            AI 批量润色
                                        </button>
                                    </div>
                                )}
                             </div>
                        </div>

                        {batchProcessing && (
                            <div className="mb-4 p-3 bg-purple-50 text-purple-700 rounded-lg text-xs flex items-center gap-2 animate-pulse">
                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
                                正在进行 AI 批量处理，请稍候...
                            </div>
                        )}

                        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
                            {chunks.length > 0 ? (
                                <>
                                    {chunks.map((chunk, idx) => (
                                        <div key={idx} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow group">
                                            {editChunkText?.original === chunk.text ? (
                                                <div className="space-y-2">
                                                    <textarea 
                                                        value={editChunkText.text}
                                                        onChange={e => setEditChunkText({ ...editChunkText, text: e.target.value })}
                                                        className="w-full h-32 p-2 border border-indigo-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-indigo-100 outline-none"
                                                    />
                                                    <div className="flex justify-end gap-2">
                                                        <button onClick={() => setEditChunkText(null)} className="px-3 py-1 text-slate-500 text-xs hover:bg-slate-100 rounded">取消</button>
                                                        <button onClick={handleUpdateChunk} className="px-3 py-1 bg-indigo-600 text-white text-xs font-bold rounded hover:bg-indigo-700">保存并重算向量</button>
                                                    </div>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="flex justify-between items-start mb-2">
                                                        <span className="bg-slate-100 text-slate-500 px-2 py-0.5 rounded text-[10px] font-mono">
                                                            Chunk #{idx + 1}
                                                        </span>
                                                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <button 
                                                                onClick={() => setEditChunkText({ text: chunk.text, original: chunk.text })}
                                                                className="text-slate-300 hover:text-indigo-500 p-1"
                                                                title="编辑内容"
                                                            >
                                                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                                                            </button>
                                                            <button 
                                                                onClick={() => handleDeleteChunk(chunk.text)}
                                                                className="text-slate-300 hover:text-red-500 p-1"
                                                                title="删除此切片"
                                                            >
                                                                <Icons.Delete />
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div 
                                                        className="text-xs text-slate-700 leading-relaxed font-mono whitespace-pre-wrap break-words"
                                                        dangerouslySetInnerHTML={{ 
                                                            __html: DOMPurify.sanitize(chunkSearch 
                                                                ? (chunk.text || '').replace(new RegExp(chunkSearch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), match => `<span class="bg-yellow-200 text-yellow-900 font-bold">${match}</span>`) 
                                                                : (chunk.text || ''))
                                                        }}
                                                    />
                                                </>
                                            )}
                                        </div>
                                    ))}
                                    
                                    {/* Load More Trigger */}
                                    <div className="py-4 text-center">
                                        {loadingChunks ? (
                                            <div className="flex items-center justify-center text-slate-400 gap-2 text-xs">
                                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg>
                                                加载更多...
                                            </div>
                                        ) : (chunks.length < totalChunks || (totalChunks === 0 && chunks.length > 0)) ? (
                                            <button 
                                                onClick={() => loadChunks(false)}
                                                className="text-xs text-indigo-600 hover:text-indigo-800 font-bold px-4 py-2 bg-indigo-50 rounded-lg transition-colors"
                                            >
                                                加载更多 ({chunks.length} / {totalChunks || '?'})
                                            </button>
                                        ) : (
                                            <div className="text-xs text-slate-300">已加载全部切片</div>
                                        )}
                                    </div>
                                </>
                            ) : (
                                !loadingChunks && (
                                    <div className="flex items-center justify-center h-32 text-slate-400 text-xs">
                                        {chunkSearch ? "没有找到匹配的切片" : "此文件没有切片数据 (可能未索引或为空)"}
                                    </div>
                                )
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const IndexManager: React.FC<{ onClose: () => void, onPreview: (path: string) => void }> = ({ onClose, onPreview }) => {
    const [stats, setStats] = useState<FileStat[]>([]);
    const [loading, setLoading] = useState(true);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [search, setSearch] = useState('');
    const [filterStatus, setFilterStatus] = useState<string>('all');
    const [filterIndex, setFilterIndex] = useState<string>('all'); // 'all', 'indexed', 'unindexed'
    const [sortConfig, setSortConfig] = useState<{ key: keyof FileStat, dir: 'asc' | 'desc' }>({ key: 'ingest_time', dir: 'desc' });
    const [groupBy, setGroupBy] = useState<'none' | 'folder'>('none');
    const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
    const [activeFile, setActiveFile] = useState<FileStat | null>(null);
    
    // AI Analysis State
    const [analyzing, setAnalyzing] = useState(false);
    const [analysisResult, setAnalysisResult] = useState<any>(null);
    const [rebuilding, setRebuilding] = useState(false);
    const [ragSettingsOpen, setRagSettingsOpen] = useState(false);
    const [ragSettingsLoading, setRagSettingsLoading] = useState(false);
    const [ragSeparatorsText, setRagSeparatorsText] = useState('');
    const [ragDimInfo, setRagDimInfo] = useState<{ embeddingDim: number; vectorDim: number; mismatch: boolean }>({ embeddingDim: 0, vectorDim: 0, mismatch: false });
    const [ragConfig, setRagConfig] = useState({
        mode: 'parent_child' as 'parent_child' | 'simple',
        parentSize: 2000,
        parentOverlap: 200,
        childSize: 500,
        childOverlap: 50,
        chunkSize: 600,
        overlap: 100,
        maxChunksPerFile: 0,
        maxEmbeddingsPerFile: 0
    });

    const loadStats = async () => {
        setLoading(true);
        try {
            // @ts-ignore
            const data = await window.electronAPI.knowledge.getStats();
            // Data is now pre-enriched with chunk_count from main process
            setStats(data || []);
        } catch (e) {
            console.error("Failed to load stats", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadStats();
    }, []);

    const encodeSeparatorForUI = (sep: string) => String(sep).replace(/\n/g, '\\n');
    const decodeSeparatorFromUI = (sep: string) => String(sep).replace(/\\n/g, '\n');

    const loadRagSettings = async () => {
        setRagSettingsLoading(true);
        try {
            const [
                mode,
                parentSize,
                parentOverlap,
                childSize,
                childOverlap,
                chunkSize,
                overlap,
                separators,
                maxChunksPerFile,
                maxEmbeddingsPerFile,
                embeddingDim,
                vectorDim,
                dimMismatch
            ] = await Promise.all([
                window.electronAPI.db.getSetting('rag_chunk_mode'),
                window.electronAPI.db.getSetting('rag_parent_chunk_size'),
                window.electronAPI.db.getSetting('rag_parent_chunk_overlap'),
                window.electronAPI.db.getSetting('rag_child_chunk_size'),
                window.electronAPI.db.getSetting('rag_child_chunk_overlap'),
                window.electronAPI.db.getSetting('rag_chunk_size'),
                window.electronAPI.db.getSetting('rag_chunk_overlap'),
                window.electronAPI.db.getSetting('rag_chunk_separators'),
                window.electronAPI.db.getSetting('rag_max_chunks_per_file'),
                window.electronAPI.db.getSetting('rag_max_embeddings_per_file'),
                window.electronAPI.db.getSetting('rag_embedding_dim'),
                window.electronAPI.db.getSetting('rag_vector_dim'),
                window.electronAPI.db.getSetting('rag_dim_mismatch')
            ]);

            const normalizedMode = mode === 'simple' ? 'simple' : 'parent_child';
            setRagConfig({
                mode: normalizedMode,
                parentSize: parentSize || 2000,
                parentOverlap: parentOverlap || 200,
                childSize: childSize || 500,
                childOverlap: childOverlap || 50,
                chunkSize: chunkSize || 600,
                overlap: overlap || 100,
                maxChunksPerFile: maxChunksPerFile || 0,
                maxEmbeddingsPerFile: maxEmbeddingsPerFile || 0
            });

            const defaultSeparators = ["\n\n", "\n", "。", "！", "？", ".", "!", "?", "；", ";", " ", ""];
            const list = Array.isArray(separators) && separators.length > 0 ? separators : defaultSeparators;
            setRagSeparatorsText(list.map(encodeSeparatorForUI).join('\n'));

            const embeddingDimNum = typeof embeddingDim === 'string' ? Number(embeddingDim) : embeddingDim;
            const vectorDimNum = typeof vectorDim === 'string' ? Number(vectorDim) : vectorDim;
            setRagDimInfo({
                embeddingDim: typeof embeddingDimNum === 'number' && embeddingDimNum > 0 ? embeddingDimNum : 0,
                vectorDim: typeof vectorDimNum === 'number' && vectorDimNum > 0 ? vectorDimNum : 0,
                mismatch: dimMismatch === 1
            });
        } finally {
            setRagSettingsLoading(false);
        }
    };

    const saveRagSettings = async () => {
        const lines = ragSeparatorsText.split('\n').map(s => s.trim()).filter(Boolean);
        const decoded = lines.map(decodeSeparatorFromUI);
        await Promise.all([
            window.electronAPI.db.saveSetting('rag_chunk_mode', ragConfig.mode),
            window.electronAPI.db.saveSetting('rag_parent_chunk_size', ragConfig.parentSize),
            window.electronAPI.db.saveSetting('rag_parent_chunk_overlap', ragConfig.parentOverlap),
            window.electronAPI.db.saveSetting('rag_child_chunk_size', ragConfig.childSize),
            window.electronAPI.db.saveSetting('rag_child_chunk_overlap', ragConfig.childOverlap),
            window.electronAPI.db.saveSetting('rag_chunk_size', ragConfig.chunkSize),
            window.electronAPI.db.saveSetting('rag_chunk_overlap', ragConfig.overlap),
            window.electronAPI.db.saveSetting('rag_chunk_separators', decoded.length > 0 ? decoded : ["\n\n", "\n", "。", "！", "？", ".", "!", "?", "；", ";", " ", ""]),
            window.electronAPI.db.saveSetting('rag_max_chunks_per_file', ragConfig.maxChunksPerFile || 0),
            window.electronAPI.db.saveSetting('rag_max_embeddings_per_file', ragConfig.maxEmbeddingsPerFile || 0)
        ]);
    };

    // Filter & Sort
    const filteredStats = useMemo(() => {
        let res = [...stats];
        
        if (search) {
            const lower = search.toLowerCase();
            res = res.filter(s => s.file_path.toLowerCase().includes(lower));
        }
        
        if (filterStatus !== 'all') {
            res = res.filter(s => s.status === filterStatus);
        }

        if (filterIndex !== 'all') {
            res = res.filter(s => {
                const hasChunks = (s.chunk_count || 0) > 0;
                return filterIndex === 'indexed' ? hasChunks : !hasChunks;
            });
        }

        res.sort((a, b) => {
            const va = a[sortConfig.key];
            const vb = b[sortConfig.key];
            if (va === vb) return 0;
            if (va === null || va === undefined) return 1;
            if (vb === null || vb === undefined) return -1;
            if (va < vb) return sortConfig.dir === 'asc' ? -1 : 1;
            if (va > vb) return sortConfig.dir === 'asc' ? 1 : -1;
            return 0;
        });

        return res;
    }, [stats, search, filterStatus, sortConfig]);

    const groupedStats = useMemo(() => {
        if (groupBy === 'none') return null;
        const groups: Record<string, FileStat[]> = {};
        filteredStats.forEach(stat => {
            // Extract folder path (simple string manipulation for both OS)
            const parts = stat.file_path.split(/[\\/]/);
            parts.pop(); // Remove filename
            
            // Optimization: Group by top-level project folder (or 2nd level) to reduce fragmentation
            // Strategy: Find the first folder that is not user root
            // For now, let's just take the last 2 folder segments if available, or just the parent
            // Actually, user asked to "move up one level".
            // If path is /A/B/C/file.pdf, currently it groups by /A/B/C.
            // New logic: Group by /A/B.
            
            if (parts.length > 1) {
                parts.pop(); // Go up one level
            }
            
            const folder = parts.join('/') || 'Root';
            if (!groups[folder]) groups[folder] = [];
            groups[folder].push(stat);
        });
        return groups;
    }, [filteredStats, groupBy]);

    // Initialize expanded folders
    useEffect(() => {
        // Default to collapsed (empty set)
        setExpandedFolders(new Set());
    }, [groupedStats]); 

    const handleSort = (key: keyof FileStat) => {
        setSortConfig(prev => ({
            key,
            dir: prev.key === key && prev.dir === 'desc' ? 'asc' : 'desc'
        }));
    };

    const handleSelection = (path: string) => {
        const next = new Set(selected);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        setSelected(next);
    };

    const handleSelectFolder = (folderFiles: FileStat[]) => {
        const next = new Set(selected);
        const allSelected = folderFiles.every(f => next.has(f.file_path));
        
        folderFiles.forEach(f => {
            if (allSelected) {
                next.delete(f.file_path);
            } else {
                next.add(f.file_path);
            }
        });
        setSelected(next);
    };

    const handleSelectAll = () => {
        if (selected.size === filteredStats.length) {
            setSelected(new Set());
        } else {
            setSelected(new Set(filteredStats.map(s => s.file_path)));
        }
    };

    const handleDeleteFolder = async (folderPath: string, files: FileStat[]) => {
        if (!confirm(`确定要删除文件夹 "${folderPath}" 下的 ${files.length} 个文件索引吗？`)) return;
        
        const toDelete = files.map(f => f.file_path);
        try {
            // @ts-ignore
            const res = await window.electronAPI.knowledge.batchDelete(toDelete);
            if (res.success) {
                setStats(prev => prev.filter(s => !toDelete.includes(s.file_path)));
                // Also update selection if any were selected
                const nextSelected = new Set(selected);
                toDelete.forEach(p => nextSelected.delete(p));
                setSelected(nextSelected);
            } else {
                alert("部分删除失败: " + res.error);
            }
        } catch (e: any) {
            alert("错误: " + e.message);
        }
    };

    const handleBatchDelete = async () => {
        const toDelete = Array.from(selected).filter(path => {
            const file = stats.find(s => s.file_path === path);
            return file && file.status !== 'locked'; // Skip locked files
        });

        if (toDelete.length === 0) return alert("没有可删除的文件（已锁定或未选择）");
        
        if (!confirm(`确定要删除 ${toDelete.length} 个文件的索引吗？\n注意：这将不可撤销。`)) return;

        try {
            // @ts-ignore
            const res = await window.electronAPI.knowledge.batchDelete(toDelete);
            if (res.success) {
                setStats(prev => prev.filter(s => !toDelete.includes(s.file_path)));
                setSelected(new Set());
            } else {
                alert("删除失败: " + res.error);
            }
        } catch (e: any) {
            alert("错误: " + e.message);
        }
    };

    const handleBatchStatus = async (status: string) => {
        if (selected.size === 0) return;
        setStats(prev => prev.map(s => selected.has(s.file_path) ? { ...s, status: status as any } : s));
        for (const path of Array.from(selected)) {
            // @ts-ignore
            await window.electronAPI.knowledge.updateStatus({ filePath: path, status });
        }
        setSelected(new Set());
    };

    const runAnalysis = async () => {
        setAnalyzing(true);
        try {
            // @ts-ignore
            const result = await window.electronAPI.knowledge.analyzeStats(stats);
            setAnalysisResult(result);
        } catch (e) {
            alert("分析失败");
        } finally {
            setAnalyzing(false);
        }
    };

    const handleRebuildIndex = async () => {
        const targetFiles = selected.size > 0 ? Array.from(selected) : [];
        const isPartial = targetFiles.length > 0;
        
        const confirmMsg = isPartial 
            ? `确定要重新索引选中的 ${targetFiles.length} 个文件吗？` 
            : "确定要重新扫描并索引所有挂载文件吗？\n这将触发大量后台任务，可能占用系统资源。";

        if (!confirm(confirmMsg)) return;
        setRebuilding(true);
        try {
            // @ts-ignore
            const res = await window.electronAPI.knowledge.rebuildIndex(targetFiles);
            if (res.success) {
                alert(`重建任务已启动，共加入队列 ${res.count} 个文件。\n请关注右上角入库进度。`);
                if (isPartial) setSelected(new Set());
                loadStats();
            } else {
                alert("重建失败: " + res.error);
            }
        } catch (e: any) {
            alert("错误: " + e.message);
        } finally {
            setRebuilding(false);
        }
    };

    const handleUpdateFile = async (updated: Partial<FileStat>) => {
        if (!activeFile) return;
        
        // Optimistic UI update
        const newActive = { ...activeFile, ...updated };
        setActiveFile(newActive);
        setStats(prev => prev.map(s => s.file_path === activeFile.file_path ? newActive : s));

        // Call API
        // @ts-ignore
        await window.electronAPI.knowledge.updateStatus({
            filePath: activeFile.file_path,
            status: updated.status,
            weight: updated.weight_factor,
            tags: updated.tags ? JSON.parse(updated.tags) : undefined
        });
    };

    const handleDeleteSingle = async () => {
        if (!activeFile) return;
        if (!confirm("确定删除此文件的索引吗？")) return;
        // @ts-ignore
        const res = await window.electronAPI.knowledge.deleteIndex(activeFile.file_path);
        if (res.success) {
            setStats(prev => prev.filter(s => s.file_path !== activeFile.file_path));
            setActiveFile(null);
        } else {
            alert("删除失败");
        }
    };

    const renderRow = (stat: FileStat) => (
        <tr 
            key={stat.file_path} 
            className={`border-b border-slate-50 hover:bg-indigo-50/30 transition-colors cursor-pointer ${selected.has(stat.file_path) ? 'bg-indigo-50/50' : ''} ${activeFile?.file_path === stat.file_path ? 'bg-indigo-100/50' : ''}`}
            onClick={() => setActiveFile(stat)}
        >
            <td className="p-3" onClick={e => e.stopPropagation()}>
                <input 
                    type="checkbox" 
                    checked={selected.has(stat.file_path)} 
                    onChange={() => handleSelection(stat.file_path)} 
                />
            </td>
            <td className="p-3">
                <div className="flex items-center gap-2">
                    <div className="flex flex-col overflow-hidden">
                        <div className="font-bold truncate max-w-[280px] text-indigo-900" title={stat.file_path}>{stat.file_path.split(/[\\/]/).pop()}</div>
                        <div className="text-[10px] text-slate-400 truncate max-w-[280px]">{stat.file_path}</div>
                    </div>
                </div>
            </td>
            <td className="p-3 text-center">
                <span className={`px-2 py-0.5 rounded-full font-bold ${stat.ref_count > 10 ? 'bg-red-100 text-red-600' : stat.ref_count > 0 ? 'bg-orange-50 text-orange-600' : 'bg-slate-100 text-slate-400'}`}>
                    {stat.ref_count}
                </span>
            </td>
            <td className="p-3 text-slate-500">
                {stat.last_ref_time ? new Date(stat.last_ref_time).toLocaleDateString() : '-'}
            </td>
            <td className="p-3 text-slate-500">
                {stat.ingest_time ? new Date(stat.ingest_time).toLocaleDateString() : '-'}
            </td>
            <td className="p-3 text-center">
                {(stat.chunk_count || 0) > 0 ? (
                    <span className="text-[10px] bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
                        已索引 ({stat.chunk_count})
                    </span>
                ) : (
                    <span className="text-[10px] bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">
                        未索引
                    </span>
                )}
            </td>
            <td className="p-3 text-center">
                {stat.status === 'locked' ? (
                    <span className="text-xs" title="已锁定">🔒</span>
                ) : stat.status === 'deprecated' ? (
                    <span className="text-xs text-red-500" title="已废弃">⚠️</span>
                ) : (
                    <span className="text-green-500">●</span>
                )}
            </td>
        </tr>
    );

    return (
        <div className="absolute inset-0 z-[90] bg-black/50 backdrop-blur-sm flex items-center justify-center p-8 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden animate-scale-up border border-slate-100 relative">
                
                {/* Detail Panel Overlay */}
                {activeFile && (
                    <FileDetailPanel 
                        file={activeFile} 
                        onClose={() => setActiveFile(null)} 
                        onUpdate={handleUpdateFile}
                        onDelete={handleDeleteSingle}
                    />
                )}

                {/* Header */}
                <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                    <div>
                        <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                            📚 知识库生命周期管理 (KLM)
                            <span className="text-[10px] bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">Beta</span>
                        </h3>
                        <p className="text-xs text-slate-400">管理索引、监控热度、优化知识质量</p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={async () => {
                                setRagSettingsOpen(true);
                                await loadRagSettings();
                            }}
                            className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold shadow-sm hover:bg-slate-50 transition-all flex items-center gap-1"
                            title="RAG 切片与 Embedding 配置"
                        >
                            <span>⚙️</span>
                            RAG 设置
                        </button>
                        <button 
                            onClick={handleRebuildIndex}
                            disabled={rebuilding}
                            className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold shadow-sm hover:bg-slate-50 transition-all flex items-center gap-1"
                        >
                            {rebuilding ? <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg> : <Icons.Refresh />}
                            重建索引
                        </button>
                        <button 
                            onClick={runAnalysis}
                            disabled={analyzing}
                            className="px-3 py-1.5 bg-gradient-to-r from-purple-500 to-indigo-600 text-white rounded-lg text-xs font-bold shadow-md hover:opacity-90 transition-all flex items-center gap-1"
                        >
                            {analyzing ? <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"/></svg> : <Icons.Analysis />}
                            AI 智能诊断
                        </button>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-600 px-2">✕</button>
                    </div>
                </div>

                {ragSettingsOpen && (
                    <div className="absolute inset-0 z-[95] bg-black/40 backdrop-blur-sm flex items-center justify-center p-6">
                        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden border border-slate-100">
                            <div className="p-4 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                                <div className="font-bold text-slate-800">RAG 切片与 Embedding 设置</div>
                                <button onClick={() => setRagSettingsOpen(false)} className="text-slate-400 hover:text-slate-600 px-2">✕</button>
                            </div>

                            <div className="p-4 space-y-4">
                                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-between">
                                    <div className="text-xs font-bold text-slate-700">
                                        Embedding 维度：{ragDimInfo.embeddingDim || '待探测'}，索引向量维度：{ragDimInfo.vectorDim || '待探测'}
                                    </div>
                                    {ragDimInfo.mismatch && (
                                        <div className="text-[10px] font-black text-red-600 bg-red-50 border border-red-200 px-2 py-1 rounded-full">
                                            维度不一致：需要重置向量库并重建索引
                                        </div>
                                    )}
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    <div className="col-span-1">
                                        <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">切片模式</div>
                                        <select
                                            value={ragConfig.mode}
                                            onChange={(e) => setRagConfig(prev => ({ ...prev, mode: e.target.value === 'simple' ? 'simple' : 'parent_child' }))}
                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none"
                                        >
                                            <option value="parent_child">父子切片（推荐）</option>
                                            <option value="simple">简单切片</option>
                                        </select>
                                    </div>
                                    <div className="col-span-2">
                                        <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">上限（0 表示不限制）</div>
                                        <div className="grid grid-cols-2 gap-3">
                                            <input
                                                type="number"
                                                value={ragConfig.maxChunksPerFile}
                                                onChange={(e) => setRagConfig(prev => ({ ...prev, maxChunksPerFile: Number(e.target.value) }))}
                                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none"
                                                placeholder="每文件最大切片数"
                                            />
                                            <input
                                                type="number"
                                                value={ragConfig.maxEmbeddingsPerFile}
                                                onChange={(e) => setRagConfig(prev => ({ ...prev, maxEmbeddingsPerFile: Number(e.target.value) }))}
                                                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none"
                                                placeholder="每文件最大 Embedding 数"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {ragConfig.mode === 'parent_child' ? (
                                    <div className="grid grid-cols-4 gap-3">
                                        <div>
                                            <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Parent Size</div>
                                            <input type="number" value={ragConfig.parentSize} onChange={(e) => setRagConfig(prev => ({ ...prev, parentSize: Number(e.target.value) }))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none" />
                                        </div>
                                        <div>
                                            <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Parent Overlap</div>
                                            <input type="number" value={ragConfig.parentOverlap} onChange={(e) => setRagConfig(prev => ({ ...prev, parentOverlap: Number(e.target.value) }))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none" />
                                        </div>
                                        <div>
                                            <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Child Size</div>
                                            <input type="number" value={ragConfig.childSize} onChange={(e) => setRagConfig(prev => ({ ...prev, childSize: Number(e.target.value) }))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none" />
                                        </div>
                                        <div>
                                            <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Child Overlap</div>
                                            <input type="number" value={ragConfig.childOverlap} onChange={(e) => setRagConfig(prev => ({ ...prev, childOverlap: Number(e.target.value) }))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none" />
                                        </div>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Chunk Size</div>
                                            <input type="number" value={ragConfig.chunkSize} onChange={(e) => setRagConfig(prev => ({ ...prev, chunkSize: Number(e.target.value) }))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none" />
                                        </div>
                                        <div>
                                            <div className="text-[10px] font-bold text-slate-400 uppercase mb-1">Overlap</div>
                                            <input type="number" value={ragConfig.overlap} onChange={(e) => setRagConfig(prev => ({ ...prev, overlap: Number(e.target.value) }))} className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs font-bold outline-none" />
                                        </div>
                                    </div>
                                )}

                                <div>
                                    <div className="flex items-center justify-between mb-1">
                                        <div className="text-[10px] font-bold text-slate-400 uppercase">分隔符（每行一个，\\n 表示换行）</div>
                                        <div className="text-[10px] text-slate-400">
                                            当前总切片：{stats.reduce((acc, s) => acc + (s.chunk_count || 0), 0)}
                                        </div>
                                    </div>
                                    <textarea
                                        value={ragSeparatorsText}
                                        onChange={(e) => setRagSeparatorsText(e.target.value)}
                                        rows={6}
                                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-[11px] font-bold outline-none font-mono"
                                        placeholder="\\n\\n\n\\n\n。\n！\n？\n."
                                    />
                                </div>
                            </div>

                            <div className="p-4 border-t border-slate-100 bg-white flex justify-end gap-2">
                                {ragDimInfo.mismatch && (
                                    <button
                                        onClick={async () => {
                                            setRagSettingsOpen(false);
                                            const ok = confirm('检测到 Embedding 维度与现有索引维度不一致。需要重置向量库并重建索引，可能耗时较长。是否继续？');
                                            if (!ok) return;
                                            await window.electronAPI.knowledge.resetIndex();
                                            await handleRebuildIndex();
                                        }}
                                        disabled={ragSettingsLoading || rebuilding}
                                        className="px-4 py-2 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50"
                                    >
                                        重置并重建
                                    </button>
                                )}
                                <button
                                    onClick={() => setRagSettingsOpen(false)}
                                    className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 text-xs font-bold hover:bg-slate-200"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={async () => {
                                        await saveRagSettings();
                                        setRagSettingsOpen(false);
                                        alert('已保存。变更将从下一次重建索引开始生效。');
                                    }}
                                    disabled={ragSettingsLoading}
                                    className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 disabled:opacity-50"
                                >
                                    保存
                                </button>
                                <button
                                    onClick={async () => {
                                        await saveRagSettings();
                                        setRagSettingsOpen(false);
                                        await handleRebuildIndex();
                                    }}
                                    disabled={ragSettingsLoading || rebuilding}
                                    className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 disabled:opacity-50"
                                >
                                    保存并重建索引
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* AI Analysis Result */}
                {analysisResult && (
                    <div className="bg-purple-50 p-4 border-b border-purple-100 animate-slide-down">
                        <div className="flex justify-between items-start mb-2">
                            <h4 className="text-sm font-bold text-purple-800">🤖 诊断报告</h4>
                            <button onClick={() => setAnalysisResult(null)} className="text-purple-400 hover:text-purple-600">×</button>
                        </div>
                        <p className="text-xs text-purple-700 mb-2">{analysisResult.summary}</p>
                        <div className="grid grid-cols-2 gap-4">
                            {analysisResult.deprecated_candidates?.length > 0 && (
                                <div className="bg-white/50 p-2 rounded border border-purple-100">
                                    <span className="text-[10px] font-bold text-red-500 uppercase">建议清理 (长期闲置)</span>
                                    <ul className="list-disc pl-4 mt-1 text-[10px] text-slate-600">
                                        {analysisResult.deprecated_candidates.map((p: string) => (
                                            <li key={p} className="truncate">{p.split(/[\\/]/).pop()}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                            {analysisResult.highlight_candidates?.length > 0 && (
                                <div className="bg-white/50 p-2 rounded border border-purple-100">
                                    <span className="text-[10px] font-bold text-green-600 uppercase">热门核心 (建议锁定)</span>
                                    <ul className="list-disc pl-4 mt-1 text-[10px] text-slate-600">
                                        {analysisResult.highlight_candidates.map((p: string) => (
                                            <li key={p} className="truncate">{p.split(/[\\/]/).pop()}</li>
                                        ))}
                                    </ul>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Toolbar */}
                <div className="p-3 bg-white border-b border-slate-100 flex justify-between items-center gap-4">
                    <div className="flex items-center gap-2 flex-1">
                        <div className="relative flex-1 max-w-sm">
                            <input 
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="搜索文件名..."
                                className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs outline-none focus:border-indigo-500"
                            />
                            <svg className="w-3 h-3 text-slate-400 absolute left-2.5 top-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
                        </div>
                        
                        <select 
                            value={filterStatus}
                            onChange={e => setFilterStatus(e.target.value)}
                            className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none text-slate-600"
                        >
                            <option value="all">全部状态</option>
                            <option value="active">正常</option>
                            <option value="locked">已锁定 🔒</option>
                            <option value="deprecated">已废弃 ⚠️</option>
                        </select>

                        <select 
                            value={filterIndex}
                            onChange={e => setFilterIndex(e.target.value)}
                            className="bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none text-slate-600 ml-2"
                        >
                            <option value="all">全部索引情况</option>
                            <option value="indexed">已索引 (Indexed)</option>
                            <option value="unindexed">未索引 (Unindexed)</option>
                        </select>

                        <div className="flex bg-slate-100 rounded-lg p-0.5 ml-2">
                            <button 
                                onClick={() => setGroupBy('none')}
                                className={`px-2 py-1 rounded text-xs transition-all ${groupBy === 'none' ? 'bg-white shadow text-indigo-600 font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                列表
                            </button>
                            <button 
                                onClick={() => setGroupBy('folder')}
                                className={`px-2 py-1 rounded text-xs transition-all ${groupBy === 'folder' ? 'bg-white shadow text-indigo-600 font-bold' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                文件夹
                            </button>
                        </div>
                    </div>

                    <div className="flex items-center gap-2">
                        {selected.size > 0 && (
                            <div className="flex items-center gap-1 animate-fade-in">
                                <span className="text-xs text-slate-500 mr-2">已选 {selected.size} 项</span>
                                <button onClick={() => handleBatchStatus('locked')} className="p-1.5 hover:bg-slate-100 rounded text-slate-500" title="锁定"><Icons.Lock /></button>
                                <button onClick={() => handleBatchStatus('active')} className="p-1.5 hover:bg-slate-100 rounded text-slate-500" title="解锁"><Icons.Unlock /></button>
                                <div className="w-px h-4 bg-slate-200 mx-1"></div>
                                <button onClick={handleBatchDelete} className="px-3 py-1.5 bg-red-50 text-red-600 rounded-lg text-xs font-bold hover:bg-red-100 flex items-center gap-1">
                                    <Icons.Delete /> 删除
                                </button>
                            </div>
                        )}
                        <button onClick={loadStats} className="p-1.5 text-slate-400 hover:text-indigo-600"><Icons.Refresh /></button>
                    </div>
                </div>

                {/* Data Grid */}
                <div className="flex-1 overflow-auto bg-slate-50/30">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-slate-50 sticky top-0 z-10 text-xs font-bold text-slate-500 uppercase shadow-sm">
                            <tr>
                                <th className="p-3 border-b border-slate-200 w-10">
                                    <input type="checkbox" checked={selected.size > 0 && selected.size === filteredStats.length} onChange={handleSelectAll} />
                                </th>
                                <th className="p-3 border-b border-slate-200 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('file_path')}>
                                    文件名称 {sortConfig.key === 'file_path' && (sortConfig.dir === 'asc' ? '↑' : '↓')}
                                </th>
                                <th className="p-3 border-b border-slate-200 cursor-pointer hover:bg-slate-100 w-24 text-center" onClick={() => handleSort('ref_count')}>
                                    热度 🔥 {sortConfig.key === 'ref_count' && (sortConfig.dir === 'asc' ? '↑' : '↓')}
                                </th>
                                <th className="p-3 border-b border-slate-200 cursor-pointer hover:bg-slate-100 w-32" onClick={() => handleSort('last_ref_time')}>
                                    最近使用 {sortConfig.key === 'last_ref_time' && (sortConfig.dir === 'asc' ? '↑' : '↓')}
                                </th>
                                <th className="p-3 border-b border-slate-200 cursor-pointer hover:bg-slate-100 w-32" onClick={() => handleSort('ingest_time')}>
                                    入库时间 {sortConfig.key === 'ingest_time' && (sortConfig.dir === 'asc' ? '↑' : '↓')}
                                </th>
                                <th className="p-3 border-b border-slate-200 cursor-pointer hover:bg-slate-100 w-32" onClick={() => handleSort('chunk_count')}>
                                    索引状态 {sortConfig.key === 'chunk_count' && (sortConfig.dir === 'asc' ? '↑' : '↓')}
                                </th>
                                <th className="p-3 border-b border-slate-200 w-20 text-center">状态</th>
                            </tr>
                        </thead>
                        <tbody className="text-xs text-slate-700 bg-white">
                            {groupBy === 'none' ? (
                                filteredStats.map(renderRow)
                            ) : (
                                Object.entries(groupedStats || {}).map(([folder, files]) => (
                                    <React.Fragment key={folder}>
                                        <tr className="bg-indigo-50/30 border-b border-slate-100 group">
                                            <td colSpan={6} className="p-2">
                                                <div className="flex items-center justify-between pr-4">
                                                    <div className="flex items-center gap-2 flex-1">
                                                        <input 
                                                            type="checkbox"
                                                            checked={files.every(f => selected.has(f.file_path))}
                                                            onChange={(e) => {
                                                                e.stopPropagation();
                                                                handleSelectFolder(files);
                                                            }}
                                                            className="ml-1 mr-2"
                                                        />
                                                        <div 
                                                            className="flex items-center gap-2 cursor-pointer font-bold text-slate-600 hover:text-indigo-600 flex-1"
                                                            onClick={() => {
                                                                const next = new Set(expandedFolders);
                                                                if (next.has(folder)) next.delete(folder);
                                                                else next.add(folder);
                                                                setExpandedFolders(next);
                                                            }}
                                                        >
                                                            {expandedFolders.has(folder) ? <Icons.ChevronDown /> : <Icons.ChevronRight />}
                                                            <Icons.Folder />
                                                            {folder.split('/').pop()} 
                                                            <span className="text-slate-400 font-normal ml-2 text-[10px]">({files.length} 个文件)</span>
                                                            <span className="text-[10px] text-slate-300 ml-auto font-mono truncate max-w-[200px]">{folder}</span>
                                                        </div>
                                                    </div>
                                                    
                                                    <button 
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDeleteFolder(folder, files);
                                                        }}
                                                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded"
                                                        title="删除此文件夹下的所有索引"
                                                    >
                                                        <Icons.Delete />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                        {expandedFolders.has(folder) && files.map(renderRow)}
                                    </React.Fragment>
                                ))
                            )}
                        </tbody>
                    </table>
                    {filteredStats.length === 0 && (
                        <div className="p-10 text-center text-slate-400">暂无数据</div>
                    )}
                </div>
                
                <div className="p-3 border-t border-slate-100 bg-slate-50 text-[10px] text-slate-400 flex justify-between">
                    <span>共 {filteredStats.length} 项</span>
                    <span>数据来源: 本地向量数据库 & 访问日志</span>
                </div>
            </div>
        </div>
    );
};

export default IndexManager;
