import React, { useState, useEffect, useRef } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { UniversalReader } from '../FilePreview/UniversalReader';
// PDFViewer and DocxViewer are deprecated in favor of UniversalReader
// import { PDFViewer } from '../FilePreview/PDFViewer';
// import { DocxViewer } from '../FilePreview/DocxViewer';
import { KnowledgeCard, CardData } from './KnowledgeCard';
import { SummaryEditor } from './SummaryEditor';

interface ReaderLayoutProps {
    file: {
        name: string;
        path: string;
        content?: string;
        type: 'text' | 'image' | 'html';
    };
    purpose: string;
    onClose: () => void;
}

export const ReaderLayout: React.FC<ReaderLayoutProps> = ({ file, purpose, onClose }) => {
    const [cards, setCards] = useState<CardData[]>([]);
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [projectId, setProjectId] = useState<string | null>(null);
    const [showSummary, setShowSummary] = useState(false);
    
    // Viewer State
    const [scrollToPage, setScrollToPage] = useState<number>(0);
    const [highlightText, setHighlightText] = useState<string>('');
    const [activeHighlightId, setActiveHighlightId] = useState<string | null>(null);

    // Initialize Session
    useEffect(() => {
        const initSession = async () => {
            try {
                // 1. Find or Create Project for this Purpose
                const projects = await window.electronAPI.readingMode.getProjects();
                let project = projects.find((p: any) => p.purpose === purpose);
                
                if (!project) {
                    const newId = uuidv4();
                    await window.electronAPI.readingMode.createProject(newId, purpose);
                    project = { id: newId };
                }
                setProjectId(project.id);

                // 2. Create Session for this File
                const sessions = await window.electronAPI.readingMode.getSessions(project.id);
                let session = sessions.find((s: any) => s.file_path === file.path);
                
                if (!session) {
                    const newSessionId = uuidv4();
                    await window.electronAPI.readingMode.createSession(newSessionId, project.id, file.path);
                    session = { id: newSessionId };
                }
                setSessionId(session.id);

                // 3. Load Cards
                const loadedCards = await window.electronAPI.readingMode.getCards(session.id);
                // Parse page number from context
                const parsedCards = loadedCards.map((c: any) => {
                    const match = c.context_text?.match(/^\[Page:(\d+)\]/);
                    return {
                        ...c,
                        page_number: match ? parseInt(match[1]) : undefined
                    };
                });
                setCards(parsedCards);

            } catch (e) {
                console.error("Failed to init reading session", e);
            }
        };
        initSession();
    }, [file.path, purpose]);

    // Reading Stats Tracking
    const lastSyncTimeRef = useRef(Date.now());

    useEffect(() => {
        lastSyncTimeRef.current = Date.now();

        const syncStats = () => {
            const now = Date.now();
            const duration = (now - lastSyncTimeRef.current) / 1000; // seconds
            if (duration > 0.5) { // Only sync if meaningful duration
                // Calculate progress (Approximate based on cards)
                const coveredPages = new Set(cards.map(c => c.page_number).filter(p => p !== undefined)).size;
                
                // We assume totalPages is unknown (0) for now unless passed from UniversalReader
                window.electronAPI.knowledge.updateReadingStats({
                    filePath: file.path,
                    duration: duration,
                    progress: coveredPages, // Using covered page count as raw progress for now
                    totalPages: 0 
                });
                lastSyncTimeRef.current = now;
            }
        };

        const interval = setInterval(syncStats, 30000); // Sync every 30s

        return () => {
            clearInterval(interval);
            syncStats(); // Sync on unmount
        };
    }, [file.path, cards]); // Re-create timer if file changes or cards change (to update progress)

    const handleTextSelect = async (text: string, context: string, pageNumber?: number) => {
        if (!sessionId) return;
        
        // 1. Create Card immediately
        const newCard: CardData = {
            id: uuidv4(),
            selected_text: text,
            user_note: '', // Empty initially
            ai_tags: ['分析中...'], // Placeholder
            created_at: Date.now(),
            page_number: pageNumber
        };

        setCards(prev => [newCard, ...prev]);
        
        const contextWithPage = pageNumber ? `[Page:${pageNumber}] ${context}` : context;
        await window.electronAPI.readingMode.createCard({ 
            ...newCard, 
            session_id: sessionId, 
            file_path: file.path, 
            context_text: contextWithPage 
        });

        // 2. Trigger AI Auto-Tagging
        try {
            const prompt = `
            Context: The user is reading a document with the purpose: "${purpose}".
            Selected Text: "${text}"
            Surrounding Context: "${context}"
            
            Task: Generate 3-5 short, relevant tags for this text fragment that relate to the reading purpose.
            Output format: JSON array of strings. e.g. ["Methodology", "Sample Size", "Limitations"]
            `;
            
            // Fix: Check if completion exists before calling, and ensure prompt is passed correctly
            if (window.electronAPI?.knowledge?.completion) {
                const res = await window.electronAPI.knowledge.completion({ prompt });
                if (res && res.success) {
                    let tags = [];
                    try {
                        const jsonStr = res.text.replace(/```json/g, '').replace(/```/g, '').trim();
                        const start = jsonStr.indexOf('[');
                        const end = jsonStr.lastIndexOf(']');
                        if (start >= 0 && end > start) {
                            tags = JSON.parse(jsonStr.substring(start, end + 1));
                        } else {
                            // Fallback: Split by newline if not JSON
                            tags = res.text.split('\n').map(t => t.replace(/^- /, '').trim()).filter(t => t.length > 0).slice(0, 5);
                        }
                    } catch (e) {
                        tags = ['AI_Error'];
                    }
                    
                    if (tags.length === 0) tags = ['General'];

                    setCards(prev => prev.map(c => c.id === newCard.id ? { ...c, ai_tags: tags } : c));
                    await window.electronAPI.readingMode.updateCard(newCard.id, { ai_tags: tags });
                } else {
                    throw new Error("AI Completion failed or returned no success");
                }
            } else {
                 console.warn("AI Knowledge API not available");
                 setCards(prev => prev.map(c => c.id === newCard.id ? { ...c, ai_tags: ['Local'] } : c));
            }
        } catch (e) {
            console.error("AI Tagging failed", e);
            setCards(prev => prev.map(c => c.id === newCard.id ? { ...c, ai_tags: ['Tagging Failed'] } : c));
        }
    };

    const handleUpdateCard = async (id: string, updates: Partial<CardData>) => {
        setCards(prev => prev.map(c => c.id === id ? { ...c, ...updates } : c));
        await window.electronAPI.readingMode.updateCard(id, updates);
    };

    const handleDeleteCard = async (id: string) => {
        setCards(prev => prev.filter(c => c.id !== id));
        await window.electronAPI.readingMode.deleteCard(id);
    };

    const handleCardClick = (card: CardData) => {
        if (card.page_number) setScrollToPage(card.page_number);
        setHighlightText(card.selected_text);
        setActiveHighlightId(card.id);
    };

    const handleSaveSummary = async (content: string) => {
        if (sessionId) {
            await window.electronAPI.readingMode.saveSummary({
                id: uuidv4(),
                target_id: sessionId,
                target_type: 'session',
                content: content
            });
            setShowSummary(false);
            onClose(); // Close reader after saving summary
        }
    };

    return (
        <div className="w-full h-full bg-slate-50 flex flex-col animate-fade-in relative">
            {showSummary && (
                <SummaryEditor 
                    cards={cards} 
                    purpose={purpose} 
                    fileInfo={{ name: file.name, path: file.path }}
                    onSave={handleSaveSummary}
                    onCancel={() => setShowSummary(false)}
                />
            )}

            {/* Header */}
            <div className="bg-white border-b border-slate-200 p-4 flex justify-between items-center shadow-sm z-10">
                <div className="flex items-center gap-4">
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    </button>
                    <div>
                        <h2 className="font-bold text-slate-800">{file.name}</h2>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                            <span className="bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full">阅读目的: {purpose}</span>
                            <span>•</span>
                            <span>{cards.length} 条笔记</span>
                        </div>
                    </div>
                </div>
                <div className="flex gap-2">
                    <button 
                        onClick={() => setShowSummary(true)}
                        className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-sm hover:bg-slate-200 transition-colors font-medium"
                    >
                        生成摘要
                    </button>
                    <button 
                        onClick={() => setShowSummary(true)}
                        className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 font-bold"
                    >
                        完成阅读
                    </button>
                </div>
            </div>

            {/* Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Main Document Area */}
                <div className="flex-1 bg-slate-100 relative overflow-hidden">
                     {/* Universal Reader for ALL file types */}
                     {/* We now rely on the backend to provide text/markdown content for all supported files */}
                     <UniversalReader
                        content={file.content || ''}
                        filePath={file.path}
                        onTextSelect={handleTextSelect}
                        highlights={cards.map(c => ({
                            id: c.id,
                            text: c.selected_text
                        }))}
                        onHighlightClick={(id) => {
                             const card = cards.find(c => c.id === id);
                             if (card) {
                                 // TODO: Scroll card into view
                                 console.log("Highlight clicked:", id);
                             }
                        }}
                        activeHighlightId={activeHighlightId}
                     />
                </div>

                {/* Sidebar */}
                <div className="w-96 bg-white border-l border-slate-200 flex flex-col shadow-xl">
                    <div className="p-4 border-b border-slate-100 font-bold text-slate-700 bg-slate-50 flex justify-between items-center">
                        <span>知识卡片</span>
                        <span className="text-xs font-normal text-slate-400">选中文字自动创建</span>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 bg-slate-50/50">
                        {cards.length === 0 ? (
                            <div className="text-center mt-20 text-slate-400 text-sm">
                                <p>👋 欢迎进入深度阅读模式</p>
                                <p className="mt-2 text-xs">在文档中选中任意文字<br/>即可生成知识卡片</p>
                            </div>
                        ) : (
                            cards.map(card => (
                                <KnowledgeCard 
                                    key={card.id} 
                                    card={card} 
                                    onUpdate={handleUpdateCard} 
                                    onDelete={handleDeleteCard}
                                    onClick={() => handleCardClick(card)}
                                />
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
