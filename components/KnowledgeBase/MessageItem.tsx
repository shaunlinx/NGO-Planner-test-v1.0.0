import React, { useRef, useLayoutEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import * as KBIcons from './KBIcons'; // Assuming KBIcons is in same folder or need to adjust import

// Define props interface
interface MessageItemProps {
    message: any;
    index: number;
    handleOpenEditor: (index: number, msg: any) => void;
    handleOpenSaveModal: (data: { text: string, chunks: any[] }) => void;
    handlePreview: (file: { name: string, path: string }, highlight?: string) => void;
    updateActiveSession: (updates: any) => void;
    setRightPanelTab: (tab: 'references' | 'compliance') => void;
    activeSession: any; // Passed for context if needed
    onCollect?: (text: string, providerId: string, sourceObj: any) => void;
}

// Action Bar Component
const ActionBar: React.FC<{ 
    message: any, 
    index: number,
    layout: 'vertical' | 'horizontal',
    handleOpenEditor: any,
    handleOpenSaveModal: any,
    updateActiveSession: any,
    activeSession: any
}> = ({ message: m, index: i, layout, handleOpenEditor, handleOpenSaveModal, updateActiveSession, activeSession }) => {
    
    return (
        <div className={`
            flex gap-1 transition-all duration-200 opacity-0 group-hover:opacity-100
            ${layout === 'vertical' ? 'flex-col sticky top-2 h-fit' : 'flex-row mt-2 ml-1'}
        `}>
            <button 
                onClick={() => {
                    // @ts-ignore
                    if (window.electronAPI) {
                        // Simple markdown strip (rough)
                        const text = m.text
                            .replace(/(\*\*|__)(.*?)\1/g, '$2')
                            .replace(/\[([^\]]+)\]\([^\)]+\)/g, '$1')
                            .replace(/^#+\s+/gm, '')
                            .replace(/`{3}[\s\S]*?`{3}/g, '$1')
                            .replace(/`(.+?)`/g, '$1');
                        // @ts-ignore
                        window.electronAPI.clipboard.writeText(text);
                    }
                }}
                className="p-1.5 bg-white border border-slate-100 rounded-lg text-slate-400 hover:text-indigo-600 hover:border-indigo-200 shadow-sm transition-all hover:scale-105"
                title="复制纯文本 (无格式)"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" /></svg>
            </button>
            <button 
                onClick={() => {
                    // @ts-ignore
                    if (window.electronAPI) {
                        // @ts-ignore
                        window.electronAPI.clipboard.writeText(m.text);
                    }
                }}
                className="p-1.5 bg-white border border-slate-100 rounded-lg text-slate-400 hover:text-indigo-600 hover:border-indigo-200 shadow-sm transition-all hover:scale-105"
                title="复制 Markdown (带格式)"
            >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>
            </button>
            <button 
                onClick={() => handleOpenSaveModal({ text: m.text, chunks: m.chunks })}
                className="p-1.5 bg-white border border-slate-100 rounded-lg text-slate-400 hover:text-indigo-600 hover:border-indigo-200 shadow-sm transition-all hover:scale-105"
                title="保存此回复到知识库"
            >
                <KBIcons.Save />
            </button>
            <button 
                onClick={() => handleOpenEditor(i, m)}
                className={`p-1.5 bg-white border border-slate-100 rounded-lg shadow-sm hover:border-indigo-200 transition-all hover:scale-105 ${ (m.complianceWarnings && m.complianceWarnings.length > 0) ? 'text-red-500 border-red-200' : 'text-slate-400 hover:text-indigo-600' }`}
                title="编辑/溯源/优化"
            >
                <KBIcons.Edit />
            </button>
            <button 
                onClick={() => {
                    if (confirm('确定要彻底删除这条回答吗？此操作不可恢复。')) {
                        const newMessages = activeSession.messages.filter((_: any, idx: number) => idx !== i);
                        updateActiveSession({ messages: newMessages });
                    }
                }}
                className="p-1.5 bg-white border border-slate-100 rounded-lg text-slate-400 hover:text-red-600 hover:border-red-200 shadow-sm transition-all hover:scale-105"
                title="删除此回答"
            >
                <KBIcons.Delete />
            </button>
        </div>
    );
};

const MessageItem: React.FC<MessageItemProps> = ({
    message: m,
    index: i,
    handleOpenEditor,
    handleOpenSaveModal,
    handlePreview,
    updateActiveSession,
    setRightPanelTab,
    activeSession,
    onCollect
}) => {
    const isUser = m.role === 'user';
    const bubbleRef = useRef<HTMLDivElement>(null);
    const [isLayoutBottom, setIsLayoutBottom] = useState(false);

    // Dynamic Layout Calculation
    useLayoutEffect(() => {
        if (!bubbleRef.current || isUser) return;
        
        // Threshold: approximate height of 5 vertical buttons + gaps (~160-180px)
        const ACTION_BAR_HEIGHT_THRESHOLD = 180;
        const contentHeight = bubbleRef.current.offsetHeight;
        
        setIsLayoutBottom(contentHeight < ACTION_BAR_HEIGHT_THRESHOLD);
    }, [m.text, isUser]); // Re-run when text changes

    const handleMouseUp = () => {
        const selection = window.getSelection();
        if (selection && selection.toString().trim().length > 0 && onCollect) {
            const text = selection.toString().trim();
            // Use 'default' or model name as providerId
            onCollect(text, 'default', {}); 
        }
    };

    const [isInlineEditing, setIsInlineEditing] = React.useState(false);
    const [editContent, setEditContent] = React.useState(m.text || '');

    const handleSaveInlineEdit = () => {
        // Create new messages array with updated text
        const newMessages = [...activeSession.messages];
        newMessages[i] = { ...newMessages[i], text: editContent };
        updateActiveSession({ messages: newMessages });
        setIsInlineEditing(false);
    };

    return (
        <div className={`flex w-full mb-6 ${isUser ? 'justify-end' : 'justify-start'}`}>
            {/* Wrapper: 
                - User: Row Reverse
                - AI (Vertical Layout): Row
                - AI (Horizontal/Bottom Layout): Column (Bubble top, Actions bottom)
            */}
            <div 
                className={`
                    flex gap-2 max-w-[90%] group relative 
                    ${isUser ? 'flex-row-reverse' : (isLayoutBottom ? 'flex-col items-start' : 'flex-row')}
                `}
                onMouseLeave={(e) => {
                    // Force hide logic if needed, but CSS group-hover handles it well usually.
                }}
            >
                
                {/* Message Bubble */}
                <div 
                    ref={bubbleRef}
                    className={`p-4 rounded-2xl text-sm shadow-sm relative overflow-hidden ${isUser ? 'bg-slate-100 text-slate-800 rounded-tr-none' : 'bg-white border border-slate-100 rounded-tl-none'}`}
                    onMouseUp={!isUser ? handleMouseUp : undefined}
                    onDoubleClick={() => {
                        if (!isUser && !isInlineEditing) {
                            setIsInlineEditing(true);
                            setEditContent(m.text || '');
                        }
                    }}
                >
                    {isInlineEditing ? (
                        <div className="flex flex-col gap-2 min-w-[400px]">
                            <textarea
                                value={editContent}
                                onChange={(e) => setEditContent(e.target.value)}
                                className="w-full h-full min-h-[150px] p-2 bg-slate-50 border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 resize-y font-mono text-xs"
                                autoFocus
                                onClick={(e) => e.stopPropagation()}
                            />
                            <div className="flex justify-end gap-2">
                                <button 
                                    onClick={(e) => { e.stopPropagation(); setIsInlineEditing(false); }}
                                    className="px-3 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded-md transition-colors"
                                >
                                    取消
                                </button>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handleSaveInlineEdit(); }}
                                    className="px-3 py-1 text-xs bg-indigo-600 text-white hover:bg-indigo-700 rounded-md shadow-sm transition-colors flex items-center gap-1"
                                >
                                    <span>✓</span> 完成
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="prose prose-sm max-w-none break-words" title={!isUser ? "双击可快速编辑" : ""}>
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                        </div>
                    )}

                    {/* Compliance Shield Indicator (Absolute inside bubble, stays at top) */}
                    {m.role === 'model' && m.complianceWarnings && m.complianceWarnings.length > 0 && (
                        <div className="absolute left-[-12px] top-[-12px] cursor-pointer z-10" title="存在内容合规警告，点击查看详情" onClick={() => { handleOpenEditor(i, m); setRightPanelTab('compliance'); }}>
                            <div className="w-8 h-8 bg-red-100 text-red-600 rounded-full flex items-center justify-center border border-red-200 shadow-sm animate-pulse">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>
                            </div>
                        </div>
                    )}

                    {/* Display Sources if available */}
                    {m.role === 'model' && m.sources && m.sources.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-slate-100/50">
                            <p className="text-[10px] font-bold text-slate-400 mb-1">参考来源：</p>
                            <div className="flex flex-wrap gap-1">
                                {m.sources.map((src: string, idx: number) => {
                                    const fileName = src.split(/[\\/]/).pop() || src;
                                    return (
                                        <button 
                                            key={idx}
                                            onClick={() => handlePreview({ name: fileName, path: src })}
                                            className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded hover:bg-indigo-100 transition-colors max-w-[200px] truncate"
                                            title={src}
                                        >
                                            📄 {fileName}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                </div>

                {/* Sticky Action Buttons (Outside Bubble) */}
                {!isUser && (
                    <ActionBar 
                        message={m}
                        index={i}
                        layout={isLayoutBottom ? 'horizontal' : 'vertical'}
                        handleOpenEditor={handleOpenEditor}
                        handleOpenSaveModal={handleOpenSaveModal}
                        updateActiveSession={updateActiveSession}
                        activeSession={activeSession}
                    />
                )}
            </div>
        </div>
    );
};

export default MessageItem;
