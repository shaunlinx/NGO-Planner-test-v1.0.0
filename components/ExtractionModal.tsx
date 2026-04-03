
import React, { useState, useRef, useEffect } from 'react';
import { CalendarEvent, ExtractionSession, NgoDomain } from '../types';
import { parseEventsFromMixedContent } from '../services/geminiService';
import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

// --- PDF 引擎初始化修复 (Version 5.4.530 ESM Support) ---
const getLibrary = (lib: any) => lib?.default || lib;
const initPdfWorker = () => {
    try {
        const pdfClient = getLibrary(pdfjsLib);
        if (pdfClient && pdfClient.GlobalWorkerOptions) {
            // 使用与 importmap 严格一致的版本号
            pdfClient.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@5.4.530/build/pdf.worker.mjs';
        }
    } catch (e) { console.error("PDF Worker Init Error:", e); }
};
initPdfWorker();

interface ExtractionModalProps {
    session: ExtractionSession;
    onClose: () => void;
    onMinimize: () => void;
    onUpdateSession: (updates: Partial<ExtractionSession>) => void;
    onImport: (events: CalendarEvent[]) => void;
}

const ExtractionModal: React.FC<ExtractionModalProps> = ({ session, onClose, onMinimize, onUpdateSession, onImport }) => {
    const [isHovering, setIsHovering] = useState(false);
    const [isParsing, setIsParsing] = useState(false); // 文件预解析状态
    const fileInputRef = useRef<HTMLInputElement>(null);

    const processFile = async (file: File) => {
        const fileName = file.name.toLowerCase();
        let content: any = null;

        try {
            if (fileName.match(/\.(jpg|jpeg|png)$/)) {
                const base64 = await new Promise<string>((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve((e.target?.result as string).split(',')[1]);
                    reader.readAsDataURL(file);
                });
                content = { inlineData: { mimeType: file.type, data: base64 } };
            } else if (fileName.endsWith('.docx')) {
                const arrayBuffer = await file.arrayBuffer();
                const res = await getLibrary(mammoth).extractRawText({ arrayBuffer });
                content = { text: res.value };
            } else if (fileName.endsWith('.pdf')) {
                const arrayBuffer = await file.arrayBuffer();
                const pdf = await getLibrary(pdfjsLib).getDocument({ data: arrayBuffer }).promise;
                let text = '';
                const maxPages = Math.min(pdf.numPages, 15);
                for (let i = 1; i <= maxPages; i++) {
                    const page = await pdf.getPage(i);
                    text += (await page.getTextContent()).items.map((it: any) => it.str).join(' ') + '\n';
                }
                content = { text };
            } else {
                content = { text: await file.text() };
            }

            return {
                name: file.name,
                type: file.type,
                size: file.size,
                data: JSON.stringify(content)
            };
        } catch (err) {
            console.error(`Error processing ${file.name}:`, err);
            return null;
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        setIsParsing(true);
        try {
            const processed = await Promise.all(files.map(processFile));
            const validFiles = processed.filter(f => f !== null) as any[];
            onUpdateSession({ files: [...session.files, ...validFiles] });
        } finally {
            setIsParsing(false);
            if (e.target) e.target.value = '';
        }
    };

    const removeFile = (index: number) => {
        const next = [...session.files];
        next.splice(index, 1);
        onUpdateSession({ files: next });
    };

    const startExtraction = async () => {
        if (session.inputText.trim() === '' && session.files.length === 0) return;

        onUpdateSession({ status: 'processing', results: [] });
        
        try {
            const parts: any[] = [];
            if (session.inputText.trim()) parts.push({ text: session.inputText });
            session.files.forEach(f => {
                if (f.data) parts.push(JSON.parse(f.data));
            });

            const results = await parseEventsFromMixedContent(parts);
            onUpdateSession({ status: 'ready', results });
        } catch (e: any) {
            onUpdateSession({ status: 'error', error: e.message });
        }
    };

    return (
        <div className={`fixed inset-0 z-[150] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in ${session.isMinimized ? 'hidden' : ''}`}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden animate-fade-in-up">
                {/* Header */}
                <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-indigo-50/50 shrink-0">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl animate-pulse">✨</span>
                        <div>
                            <h3 className="font-bold text-indigo-900 text-sm">AI 智能排期提取</h3>
                            <p className="text-[10px] text-indigo-500 uppercase tracking-widest font-black">支持大文件预解析与多文件识别</p>
                        </div>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={onMinimize} className="px-4 py-1.5 rounded-xl bg-white border border-indigo-100 text-indigo-600 text-xs font-bold hover:shadow-md transition-all">后台运行</button>
                        <button onClick={onClose} className="text-indigo-300 hover:text-indigo-600 text-3xl transition-colors">&times;</button>
                    </div>
                </div>

                <div className="flex-1 overflow-hidden flex">
                    {/* Left Panel */}
                    <div className="w-1/2 flex flex-col p-6 gap-6 border-r border-gray-50">
                        <div className="flex-1 flex flex-col min-h-0">
                            <label className="text-[10px] font-black text-gray-400 uppercase mb-2 tracking-widest">方式一：文本输入</label>
                            <textarea 
                                value={session.inputText}
                                onChange={e => onUpdateSession({ inputText: e.target.value })}
                                placeholder="在这里粘贴活动方案、会议记录或带日期的任务清单..."
                                className="flex-1 bg-slate-50/50 border border-slate-200 rounded-2xl p-4 text-sm outline-none focus:ring-2 focus:ring-indigo-100 resize-none transition-all"
                            />
                        </div>

                        <div className="flex flex-col gap-2">
                            <label className="text-[10px] font-black text-gray-400 uppercase mb-1 tracking-widest">方式二：上传参考文件 ({session.files.length})</label>
                            
                            {session.files.length > 0 && (
                                <div className="flex flex-wrap gap-2 mb-2 max-h-32 overflow-y-auto p-1 custom-scrollbar">
                                    {session.files.map((f, i) => (
                                        <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 rounded-lg border border-indigo-100 text-[10px] font-bold text-indigo-700 animate-fade-in">
                                            <span className="truncate max-w-[120px]">{f.name}</span>
                                            <button onClick={() => removeFile(i)} className="hover:text-red-500 text-sm">&times;</button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            <div 
                                onClick={() => !isParsing && fileInputRef.current?.click()}
                                onDragOver={(e) => { e.preventDefault(); if(!isParsing) setIsHovering(true); }}
                                onDragLeave={() => setIsHovering(false)}
                                onDrop={async (e) => {
                                    e.preventDefault();
                                    setIsHovering(false);
                                    if (isParsing) return;
                                    const files = Array.from(e.dataTransfer.files);
                                    if (files.length === 0) return;
                                    setIsParsing(true);
                                    try {
                                        const processed = await Promise.all(files.map(processFile));
                                        const validFiles = processed.filter(f => f !== null) as any[];
                                        onUpdateSession({ files: [...session.files, ...validFiles] });
                                    } finally { setIsParsing(false); }
                                }}
                                className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all relative group overflow-hidden ${
                                    isParsing ? 'bg-indigo-50/30 border-indigo-200 cursor-wait' : 
                                    isHovering ? 'bg-indigo-50 border-indigo-400' : 'bg-slate-50 border-slate-200 hover:border-indigo-300 cursor-pointer'
                                }`}
                            >
                                <input type="file" multiple ref={fileInputRef} className="hidden" accept=".pdf,.docx,.md,.csv,.jpg,.jpeg,.png" onChange={handleFileSelect} disabled={isParsing} />
                                
                                {isParsing ? (
                                    <div className="flex flex-col items-center animate-pulse">
                                        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-3"></div>
                                        <p className="text-xs font-black text-indigo-600 uppercase tracking-widest">正在读取大文件...</p>
                                        <p className="text-[9px] text-indigo-400 mt-1 italic">正在解析文档物理内容，请稍候</p>
                                    </div>
                                ) : (
                                    <>
                                        <div className={`text-3xl mb-2 transition-transform group-hover:scale-110 ${isHovering ? 'scale-125' : ''}`}>📂</div>
                                        <p className="text-xs font-bold text-slate-600">点击或拖拽文件至此处</p>
                                        <p className="text-[9px] text-slate-400 mt-1 uppercase font-black tracking-tighter">PDF / DOCX / MD / 图片</p>
                                    </>
                                )}
                            </div>
                        </div>

                        <button 
                            onClick={startExtraction}
                            disabled={isParsing || session.status === 'processing' || (session.inputText.trim() === '' && session.files.length === 0)}
                            className={`w-full py-4 rounded-2xl font-black shadow-xl transition-all flex items-center justify-center gap-3 transform active:scale-95 disabled:opacity-50 ${session.status === 'processing' ? 'bg-amber-100 text-amber-600 animate-pulse' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-indigo-100'}`}
                        >
                            {session.status === 'processing' ? <span className="animate-spin text-xl">⏳</span> : '🚀'}
                            {session.status === 'processing' ? 'AI 正在智能识别中...' : '开始提取排期节点'}
                        </button>
                    </div>

                    {/* Right Panel */}
                    <div className="w-1/2 flex flex-col bg-slate-50 overflow-hidden">
                        <div className="p-4 border-b bg-white flex justify-between items-center shadow-sm">
                            <h4 className="text-xs font-black text-gray-500 uppercase tracking-widest">提取预览 ({session.results.length})</h4>
                            {session.results.length > 0 && session.status !== 'processing' && (
                                <button 
                                    onClick={() => {
                                        const newEvents: CalendarEvent[] = session.results.map((p, i) => ({
                                            id: `ai-ext-${Date.now()}-${i}`,
                                            title: p.title || '未命名任务',
                                            date: p.date || new Date().toISOString().split('T')[0],
                                            category: 'Custom',
                                            isCustom: true,
                                            relevantDomains: (p.relevantDomains as NgoDomain[]) || ['其他'],
                                            priority: p.priority || { isImportant: false, isUrgent: false },
                                            status: 'Active',
                                            description: p.description || '',
                                            locked: false
                                        }));
                                        (async () => {
                                            try {
                                                const api = (window as any)?.electronAPI?.plannerContext;
                                                if (!api?.saveReferencePack) return;

                                                const sections: string[] = [];
                                                sections.push(`# AI 排期提取参考包`);
                                                sections.push(`- 生成时间：${new Date().toISOString()}`);
                                                sections.push(`- 会话：${session.id}`);
                                                if (session.inputText?.trim()) {
                                                    sections.push(`\n## 用户输入文本\n${session.inputText.trim().slice(0, 30000)}`);
                                                }
                                                if (Array.isArray(session.files) && session.files.length > 0) {
                                                    sections.push(`\n## 上传文件解析（预解析文本）`);
                                                    for (const f of session.files) {
                                                        const name = String((f as any)?.name || '未知文件');
                                                        const type = String((f as any)?.type || '');
                                                        let body = '';
                                                        try {
                                                            const parsed = (f as any)?.data ? JSON.parse((f as any).data) : null;
                                                            if (parsed?.text) body = String(parsed.text);
                                                        } catch (e) {}
                                                        sections.push(`\n### ${name}${type ? ` (${type})` : ''}`);
                                                        sections.push(body ? body.slice(0, 30000) : '（该文件为图片或无法解析为文本，未写入参考包）');
                                                    }
                                                }
                                                sections.push(`\n## 本次同步到日历的节点\n${newEvents.map(ev => `- ${ev.date} | ${ev.title} | ${ev.id}`).join('\n')}`);

                                                await api.saveReferencePack({
                                                    eventIds: newEvents.map(e => e.id),
                                                    title: `extraction-${session.id}`,
                                                    markdown: sections.join('\n'),
                                                    packId: `extraction-${session.id}`
                                                });
                                            } catch (e) {}
                                        })();
                                        onImport(newEvents);
                                        onClose();
                                    }}
                                    className="bg-green-600 text-white px-5 py-1.5 rounded-xl text-[10px] font-black hover:bg-green-700 shadow-lg shadow-green-100 transition-all"
                                >
                                    确认并同步到日历
                                </button>
                            )}
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar">
                            {session.status === 'processing' ? (
                                <div className="h-full flex flex-col items-center justify-center text-indigo-400">
                                    <div className="relative w-20 h-20 mb-6">
                                        <div className="absolute inset-0 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin"></div>
                                        <div className="absolute inset-2 border-4 border-indigo-50 border-b-indigo-400 rounded-full animate-spin-slow"></div>
                                    </div>
                                    <p className="text-sm font-black animate-pulse uppercase tracking-[0.2em]">正在深度扫描解析排期...</p>
                                    <p className="text-[10px] text-slate-400 mt-2">大型文档分析耗时较长，您可以最小化窗口</p>
                                </div>
                            ) : session.results.length > 0 ? (
                                session.results.map((p, idx) => (
                                    <div key={idx} className="bg-white p-4 rounded-2xl border border-indigo-100 shadow-sm hover:shadow-md transition-all animate-fade-in-up">
                                        <div className="flex justify-between items-start mb-2">
                                            <span className="text-xs font-black text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full font-mono">{p.date}</span>
                                            <div className="flex gap-1">
                                                {p.priority?.isImportant && <span className="px-1.5 py-0.5 rounded bg-red-50 text-red-500 text-[8px] font-black">重要</span>}
                                                {p.priority?.isUrgent && <span className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-500 text-[8px] font-black">紧急</span>}
                                            </div>
                                        </div>
                                        <div className="font-bold text-sm text-slate-800 leading-snug">{p.title}</div>
                                        <div className="mt-2 flex items-center gap-2">
                                            <span className="text-[9px] font-black text-slate-400 uppercase bg-slate-100 px-1.5 py-0.5 rounded">领域: {p.relevantDomains?.[0] || '待确认'}</span>
                                        </div>
                                        <p className="text-[10px] text-slate-400 mt-2 line-clamp-2 italic leading-relaxed">{p.description || '无备注内容。'}</p>
                                    </div>
                                ))
                            ) : session.status === 'error' ? (
                                <div className="h-full flex flex-col items-center justify-center text-red-400 p-8 text-center">
                                    <div className="text-5xl mb-4">⚠️</div>
                                    <p className="font-black text-sm uppercase tracking-widest">提取失败</p>
                                    <p className="text-[10px] mt-2 opacity-70 leading-relaxed">{session.error}</p>
                                    <button onClick={startExtraction} className="mt-6 px-6 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-lg">重试识别</button>
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center opacity-30 italic text-slate-400">
                                    <div className="text-5xl mb-6">🛸</div>
                                    <p className="text-xs uppercase tracking-widest font-black">等待 AI 扫描结果</p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            <style>{`
                .animate-spin-slow { animation: spin 3s linear infinite; }
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
};

export default ExtractionModal;
