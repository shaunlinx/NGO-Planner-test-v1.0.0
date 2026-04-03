import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chatWithKnowledgeBase } from '../services/geminiService';
import EntityGraphModal from './EntityGraphModal';

interface Message {
    role: 'user' | 'model';
    text: string;
    timestamp: number;
    sources?: string[];
    entities?: Array<{ name: string, type: string }>;
}

interface KnowledgeAssistant {
    id: string;
    name: string;
    contexts: any[];
    systemPrompt: string;
    createdAt: number;
}

interface KnowledgeAssistantViewProps {
    assistant: KnowledgeAssistant;
    onUpdateAssistant: (updated: KnowledgeAssistant) => void;
}

const KnowledgeAssistantView: React.FC<KnowledgeAssistantViewProps> = ({ assistant, onUpdateAssistant }) => {
    const buildGreetingMessage = (name: string): Message => ({
        role: 'model',
        text: `你好！我是${name}。我已加载专属知识库，随时为你服务。`,
        timestamp: Date.now()
    });

    // --- Session State ---
    const [messages, setMessages] = useState<Message[]>([
        buildGreetingMessage(assistant.name)
    ]);
    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);

    // --- Graph View State ---
    const [showGraph, setShowGraph] = useState(false);

    // --- Fine-tuning State ---
    const [isFineTuning, setIsFineTuning] = useState(false);
    const [editingAssistant, setEditingAssistant] = useState<KnowledgeAssistant>(assistant);
    const [uploadStatus, setUploadStatus] = useState('');
    const assistantKey = String(
        assistant.id && String(assistant.id).trim()
            ? assistant.id
            : `${assistant.name || 'assistant'}::${assistant.createdAt || ''}`
    );

    const persistMessage = async (msg: Message) => {
        if (!window.electronAPI?.knowledge?.chat) return;
        try {
            await window.electronAPI.knowledge.chat.saveMessage({
                assistant_id: assistantKey,
                role: msg.role,
                content: msg.text,
                sources: msg.sources,
                entities: msg.entities,
                timestamp: msg.timestamp
            });
        } catch (e: any) {
            console.error('[KnowledgeAssistant] 保存对话失败:', e?.message || e);
        }
    };

    // Update local editing state when prop changes
    useEffect(() => {
        setEditingAssistant(assistant);
    }, [assistant]);

    useEffect(() => {
        let cancelled = false;
        const loadHistory = async () => {
            if (!window.electronAPI?.knowledge?.chat) {
                if (!cancelled) setMessages([buildGreetingMessage(assistant.name)]);
                return;
            }
            try {
                const history = await window.electronAPI.knowledge.chat.getHistory(assistantKey);
                if (cancelled) return;
                if (Array.isArray(history) && history.length > 0) {
                    setMessages(history);
                } else {
                    setMessages([buildGreetingMessage(assistant.name)]);
                }
            } catch (e) {
                if (!cancelled) setMessages([buildGreetingMessage(assistant.name)]);
            }
        };
        loadHistory();
        return () => {
            cancelled = true;
        };
    }, [assistantKey, assistant.name]);

    // Scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSendMessage = async () => {
        if (!input.trim() || isLoading) return;
        
        const userMsg: Message = { role: 'user', text: input, timestamp: Date.now() };
        setMessages(prev => [...prev, userMsg]);
        await persistMessage(userMsg);

        const currentInput = input;
        const historyForLLM = [...messages, userMsg].slice(-5);
        setInput('');
        setIsLoading(true);

        try {
            if (window.electronAPI) {
                let contextText = '';
                let sources: string[] = [];

                // Orchestrated RAG
                const queryPromises = assistant.contexts.map(async (ctx) => {
                    const ingested = await window.electronAPI!.db.getSetting('kb_ingested_files') || [];
                    const targetFiles = new Set<string>();
                    
                    ctx.folderPaths.forEach((folder: string) => {
                        ingested.forEach((file: string) => {
                            if (file.startsWith(folder)) targetFiles.add(file);
                        });
                    });

                    if (targetFiles.size === 0) return { role: ctx.role, content: "", sources: [] };

                    // @ts-ignore
                    const result: any = await window.electronAPI!.knowledge.query({ 
                        text: currentInput, 
                        topK: 5,
                        activeFiles: Array.from(targetFiles),
                        weight: ctx.weight || 1.0
                    });

                    const content = (typeof result === 'object' ? result.context : result) || "";
                    const blockSources = (typeof result === 'object' ? result.sources : []) || [];
                    const debugInfo = (typeof result === 'object' ? result.debugInfo : {}) || {};
                    return { role: ctx.role, content, sources: blockSources, weight: ctx.weight, debugInfo };
                });

                const results = await Promise.all(queryPromises);
                
                const contextParts = results.filter(r => r.content).map(r => {
                    let prefix = '';
                    if (r.weight >= 1.2) prefix = '【⭐⭐⭐ 核心依据】';
                    else if (r.weight <= 0.8) prefix = '【仅供参考】';
                    return `${prefix}【${r.role}】\n${r.content}`;
                });
                
                contextText = contextParts.join('\n\n');
                const allSources = new Set<string>();
                results.forEach(r => r.sources.forEach((s: string) => allSources.add(s)));
                sources = Array.from(allSources);

                // Aggregate Entities
                const entities: Array<{name: string, type: string}> = [];
                const seenEntities = new Set();
                results.forEach((r: any) => {
                    if (r.debugInfo && r.debugInfo.detectedEntities) {
                        r.debugInfo.detectedEntities.forEach((e: any) => {
                            const key = `${e.name}-${e.type}`;
                            if (!seenEntities.has(key)) {
                                seenEntities.add(key);
                                entities.push(e);
                            }
                        });
                    }
                });

                // Inject System Prompt
                if (assistant.systemPrompt) {
                    contextText = `【系统指令 (System Prompt)】\n${assistant.systemPrompt}\n\n` + contextText;
                }

                const response = await chatWithKnowledgeBase(currentInput, contextText, historyForLLM);
                const modelMsg: Message = { role: 'model', text: response || '无回答', timestamp: Date.now(), sources, entities };
                setMessages(prev => [...prev, modelMsg]);
                await persistMessage(modelMsg);
            }
        } catch (error: any) {
            const errMsg: Message = { role: 'model', text: `Error: ${error.message}`, timestamp: Date.now() };
            setMessages(prev => [...prev, errMsg]);
            await persistMessage(errMsg);
        } finally {
            setIsLoading(false);
        }
    };

    const handleUploadFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || !e.target.files[0] || !window.electronAPI) return;
        const file = e.target.files[0];
        setUploadStatus('Processing...');

        try {
            // 1. Determine/Create Folder
            const userDataPath = await window.electronAPI.getPath('userData');
            const assistantFolder = `${userDataPath}/storage/DATA/Knowledge/Assistants/${assistant.name.replace(/\s+/g, '_')}`;
            await window.electronAPI.fs.ensureDir(assistantFolder);

            // 2. Write File (Simplified for demo, ideally stream)
            const targetPath = `${assistantFolder}/${file.name}`;
            
            // For now assuming we can read arrayBuffer from file object in renderer
            const buffer = await file.arrayBuffer();
            const base64 = btoa(new Uint8Array(buffer).reduce((data, byte) => data + String.fromCharCode(byte), ''));
            await window.electronAPI.fs.writeFile(targetPath, base64, { encoding: 'base64' });

            // 3. Index
            setUploadStatus('Indexing...');
            // @ts-ignore
            const res = await window.electronAPI.knowledge.upload({ 
                name: file.name, 
                path: targetPath,
                saveProcessedAsMd: true 
            });
            if (!res.success) throw new Error(res.error);

            // 4. Update Contexts
            const folderPath = assistantFolder;
            const hasFolder = editingAssistant.contexts.some(c => c.folderPaths.includes(folderPath));
            
            if (!hasFolder) {
                const newContexts = [...editingAssistant.contexts];
                const uploadsContext = newContexts.find(c => c.role === 'Uploads');
                if (uploadsContext) {
                    if (!uploadsContext.folderPaths.includes(folderPath)) {
                        uploadsContext.folderPaths.push(folderPath);
                    }
                } else {
                    newContexts.push({
                        id: `ctx-uploads-${Date.now()}`,
                        role: 'Uploads',
                        folderPaths: [folderPath],
                        weight: 1.2
                    });
                }
                
                const updatedAssistant = { ...editingAssistant, contexts: newContexts };
                onUpdateAssistant(updatedAssistant);
                setEditingAssistant(updatedAssistant);
            }

            setUploadStatus('✅ Success');
            setTimeout(() => setUploadStatus(''), 2000);

        } catch (e: any) {
            setUploadStatus('❌ Error: ' + e.message);
        }
    };

    const handleSyncAssistant = async () => {
        if (!editingAssistant || !window.electronAPI) return;
        
        if (!confirm(`即将从原始文件夹同步更新到助手“${editingAssistant.name}”的快照中。\n\n注意：这将覆盖助手中的同名文件，新增文档将被索引。如果原始文件夹已移动或删除，同步将跳过。`)) return;

        setUploadStatus('Syncing...');
        
        try {
            let syncCount = 0;
            
            // Iterate all contexts
            for (const ctx of editingAssistant.contexts) {
                // @ts-ignore
                if (ctx.sourceMap) {
                    // @ts-ignore
                    for (const [snapshotPath, originalPath] of Object.entries(ctx.sourceMap)) {
                        // Check original existence
                        // @ts-ignore
                        const exists = await window.electronAPI.fs.exists(originalPath as string);
                        if (exists) {
                            // Copy (Sync)
                            // @ts-ignore
                            const copyRes = await window.electronAPI.fs.copyFiles(originalPath, snapshotPath);
                            if (copyRes.success) {
                                // Re-index snapshot path
                                const indexFolder = async (dirPath: string) => {
                                    // @ts-ignore
                                    const entries = await window.electronAPI.fs.readDir(dirPath);
                                    for (const entry of entries) {
                                        if (entry.isDirectory) {
                                            await indexFolder(entry.path);
                                        } else {
                                            if (!entry.name.startsWith('.')) {
                                                // @ts-ignore
                                                await window.electronAPI.knowledge.upload({ name: entry.name, path: entry.path });
                                            }
                                        }
                                    }
                                };
                                await indexFolder(snapshotPath);
                                syncCount++;
                            }
                        }
                    }
                }
            }
            
            if (syncCount > 0) {
                setUploadStatus('✅ Synced');
                alert(`同步完成！已更新 ${syncCount} 个源文件夹的快照。`);
            } else {
                 setUploadStatus('⚠️ No Link');
                 alert("未找到可同步的原始源文件夹链接 (可能是旧版助手或源文件夹已被移动)。");
            }
            
            setTimeout(() => setUploadStatus(''), 2000);
            
        } catch (e: any) {
            console.error(e);
            setUploadStatus('❌ Error');
            alert(`同步失败: ${e.message}`);
        }
    };

    const handleClearHistory = async () => {
        if (confirm('确定要清空此助手的对话历史吗？')) {
            // @ts-ignore
            if (window.electronAPI && window.electronAPI.knowledge && window.electronAPI.knowledge.chat) {
                // @ts-ignore
                await window.electronAPI.knowledge.chat.clearHistory(assistantKey);
                setMessages([
                    buildGreetingMessage(assistant.name)
                ]);
            }
        }
    };

    const handleClearAllHistory = async () => {
        if (confirm('确定要清空所有知识库助手的历史对话吗？')) {
            if (window.electronAPI?.knowledge?.chat?.clearAllHistory) {
                await window.electronAPI.knowledge.chat.clearAllHistory();
                setMessages([buildGreetingMessage(assistant.name)]);
            }
        }
    };

    const handleSaveFineTuning = () => {
        onUpdateAssistant(editingAssistant);
        setIsFineTuning(false);
    };

    return (
        <div className="flex h-full bg-[#f8fafc] p-6 gap-6 relative">
            {/* Fine Tuning Modal */}
            {isFineTuning && (
                <div className="absolute inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-8 animate-fade-in">
                    <div className="bg-white w-full max-w-2xl h-[85vh] rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-scale-up border border-slate-100">
                        <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                            <div>
                                <h3 className="font-bold text-lg text-slate-800">微调助手: {editingAssistant.name}</h3>
                                <p className="text-xs text-slate-400">调整知识范围与生成逻辑</p>
                            </div>
                            <button onClick={() => setIsFineTuning(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-6 space-y-6">
                             {/* Section 1: Uploads */}
                             <div>
                                <div className="flex justify-between items-center mb-3">
                                    <h4 className="text-xs font-black text-indigo-600 uppercase flex items-center gap-2">
                                        <span>📂</span> 知识库扩充
                                    </h4>
                                    <button 
                                        onClick={handleSyncAssistant}
                                        className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-1 rounded hover:bg-indigo-100 flex items-center gap-1 transition-colors"
                                        title="检查原始文件夹变动并同步到助手快照中"
                                    >
                                        🔄 同步源文件夹
                                    </button>
                                </div>
                                <div className="bg-slate-50 border-2 border-dashed border-slate-200 rounded-xl p-6 text-center hover:border-indigo-300 transition-all group">
                                    <input type="file" id="upload-assistant-file" className="hidden" onChange={handleUploadFile} accept=".pdf,.docx,.txt,.md,.mp3,.wav,.m4a" />
                                    <label htmlFor="upload-assistant-file" className="cursor-pointer flex flex-col items-center gap-2">
                                        <div className="w-10 h-10 bg-white rounded-full shadow-sm flex items-center justify-center text-xl group-hover:scale-110 transition-transform">📤</div>
                                        <span className="text-xs font-bold text-slate-600">点击上传新文档或音频</span>
                                        <span className="text-[10px] text-slate-400">支持 PDF, Word, MP3 (自动转录)</span>
                                    </label>
                                    {uploadStatus && <div className="mt-2 text-xs font-bold text-indigo-600">{uploadStatus}</div>}
                                </div>
                            </div>

                            {/* Section 2: Contexts */}
                            <div>
                                <h4 className="text-xs font-black text-indigo-600 uppercase mb-3 flex items-center gap-2">
                                    <span>🧠</span> 逻辑编排
                                </h4>
                                <div className="space-y-3">
                                    {editingAssistant.contexts.map((ctx, idx) => (
                                        <div key={idx} className="bg-white border border-slate-200 rounded-xl p-3 shadow-sm">
                                            <div className="flex justify-between mb-2">
                                                <input 
                                                    value={ctx.role} 
                                                    onChange={e => {
                                                        const next = [...editingAssistant.contexts];
                                                        next[idx].role = e.target.value;
                                                        setEditingAssistant({...editingAssistant, contexts: next});
                                                    }}
                                                    className="font-bold text-xs text-slate-700 bg-transparent border-b border-dashed border-slate-300 outline-none w-1/2"
                                                />
                                                <span className="text-[10px] bg-slate-100 px-2 py-0.5 rounded text-slate-500">权重: {ctx.weight}</span>
                                            </div>
                                            <div className="text-[10px] text-slate-400 truncate">
                                                {ctx.folderPaths.map((p: string) => p.split(/[\\/]/).pop()).join(', ')}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Section 3: Prompt */}
                            <div>
                                <h4 className="text-xs font-black text-indigo-600 uppercase mb-3 flex items-center gap-2">
                                    <span>🎨</span> 输出微调 (System Prompt)
                                </h4>
                                <textarea 
                                    value={editingAssistant.systemPrompt}
                                    onChange={e => setEditingAssistant({...editingAssistant, systemPrompt: e.target.value})}
                                    className="w-full h-32 bg-slate-50 border border-slate-200 rounded-xl p-3 text-xs font-mono text-slate-600 outline-none focus:ring-2 focus:ring-indigo-100 resize-none"
                                    placeholder="输入系统级指令，例如：'请用幽默的口吻回答' 或 '请只列出要点'..."
                                />
                            </div>
                        </div>
                        <div className="p-4 border-t border-slate-100 bg-white flex justify-end gap-2">
                            <button onClick={() => setIsFineTuning(false)} className="px-4 py-2 rounded-xl text-slate-500 text-xs font-bold hover:bg-slate-100">取消</button>
                            <button onClick={handleSaveFineTuning} className="px-6 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 shadow-lg">保存配置</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Chat Area */}
            <div className="flex-1 flex flex-col bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-white">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg text-lg">
                            🧠
                        </div>
                        <div>
                            <h2 className="font-bold text-slate-800 text-lg">{assistant.name}</h2>
                            <p className="text-xs text-slate-400">专属知识库助手</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button 
                            onClick={() => setShowGraph(true)}
                            className="px-3 py-2 bg-white text-slate-500 rounded-xl text-xs font-bold hover:bg-slate-50 transition-all border border-slate-200 flex items-center gap-1 shadow-sm"
                            title="查看知识图谱关联"
                        >
                            <span>🕸️</span> 图谱
                        </button>
                        <button 
                            onClick={handleClearHistory}
                            className="px-3 py-2 bg-white text-rose-500 rounded-xl text-xs font-bold hover:bg-rose-50 transition-all border border-rose-100 flex items-center gap-1 shadow-sm"
                            title="清空对话历史"
                        >
                            <span>🗑️</span> 清空
                        </button>
                        <button 
                            onClick={handleClearAllHistory}
                            className="px-3 py-2 bg-white text-rose-600 rounded-xl text-xs font-bold hover:bg-rose-50 transition-all border border-rose-200 flex items-center gap-1 shadow-sm"
                            title="清空所有助手历史"
                        >
                            <span>🧹</span> 全清
                        </button>
                        <button 
                            onClick={() => setIsFineTuning(true)}
                            className="px-4 py-2 bg-slate-50 text-indigo-600 rounded-xl text-xs font-bold hover:bg-indigo-50 transition-all border border-indigo-100 flex items-center gap-2"
                        >
                            <span>⚙️</span> 微调设置
                        </button>
                    </div>
                </div>

                <EntityGraphModal isOpen={showGraph} onClose={() => setShowGraph(false)} />

                <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar bg-slate-50/30" ref={scrollRef}>
                    {messages.map((m, i) => (
                        <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[85%] p-4 rounded-3xl text-sm shadow-sm leading-relaxed ${m.role === 'user' ? 'bg-slate-100 text-slate-800' : 'bg-white text-slate-700 border border-slate-100'}`}>
                                <div className="prose prose-sm prose-indigo max-w-none">
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                                </div>
                                {m.sources && m.sources.length > 0 && (
                                    <div className="mt-2 pt-2 border-t border-indigo-100/20 text-[10px] opacity-70 flex flex-col gap-1">
                                        {m.entities && m.entities.length > 0 && (
                                            <div className="flex flex-wrap gap-1 items-center text-indigo-500">
                                                <span>⚡ 实体增强:</span>
                                                {m.entities.map((e, ei) => (
                                                    <span key={ei} className="bg-indigo-50 px-1.5 rounded border border-indigo-100 text-indigo-600 font-bold" title={e.type}>
                                                        {e.name}
                                                    </span>
                                                ))}
                                            </div>
                                        )}
                                        {m.sources && m.sources.length > 0 && (
                                            <div className="flex flex-wrap gap-1 items-center">
                                                <span>📚 参考:</span>
                                                {m.sources.slice(0, 3).map((s, si) => (
                                                    <span key={si} className="underline truncate max-w-[100px]">{s.split(/[\\/]/).pop()}</span>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                    {isLoading && (
                        <div className="flex justify-start">
                            <div className="bg-white border border-slate-100 p-3 rounded-2xl flex gap-1 items-center">
                                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></span>
                                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                            </div>
                        </div>
                    )}
                </div>

                <div className="p-4 border-t border-slate-100 bg-white">
                    <div className="relative flex items-center">
                        <input 
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                    e.preventDefault();
                                    handleSendMessage();
                                }
                            }}
                            placeholder={`向 ${assistant.name} 提问...`}
                            className="w-full pl-5 pr-12 py-3 bg-slate-100 border-none rounded-full text-sm font-bold focus:ring-4 focus:ring-indigo-100 outline-none transition-all shadow-inner"
                        />
                        <button onClick={handleSendMessage} disabled={isLoading} className="absolute right-2 p-2 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 transition-all">
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default KnowledgeAssistantView;
