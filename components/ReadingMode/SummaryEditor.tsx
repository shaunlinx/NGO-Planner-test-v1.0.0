import React, { useState, useEffect } from 'react';

interface SummaryEditorProps {
    cards: any[];
    purpose: string;
    fileInfo: { name: string; path: string };
    onSave: (content: string) => void;
    onCancel: () => void;
}

export const SummaryEditor: React.FC<SummaryEditorProps> = ({ cards, purpose, fileInfo, onSave, onCancel }) => {
    const [content, setContent] = useState('');
    const [isGenerating, setIsGenerating] = useState(true);

    useEffect(() => {
        const generate = async () => {
            try {
                const cardsContent = cards.map(c => 
                    `- 选文: "${c.selected_text}"\n  笔记: ${c.user_note}\n  标签: ${c.ai_tags.join(', ')}`
                ).join('\n\n');

                const prompt = `
                Context: The user has finished reading a document ("${fileInfo.name}") with the specific purpose: "${purpose}".
                
                User's Knowledge Cards (Notes & Highlights):
                ${cardsContent}

                Task: Generate a comprehensive "Reading Summary" (阅读小结) based ONLY on the user's notes and the reading purpose.
                
                Requirements:
                1. Structure the summary to directly address the "Reading Purpose".
                2. Synthesize the knowledge points from the cards.
                3. Use Markdown format.
                4. Language: Chinese (Simplified).
                5. Tone: Academic, professional, and insightful.
                
                Output the Markdown content directly.
                `;

                const res = await window.electronAPI.knowledge.completion({ prompt });
                if (res.success && res.text) {
                    setContent(res.text);
                } else {
                    setContent('# 生成失败\n请稍后重试或手动编写。');
                }
            } catch (e) {
                console.error("Summary generation error", e);
                setContent('# 生成出错\n' + (e as Error).message);
            } finally {
                setIsGenerating(false);
            }
        };
        generate();
    }, []);

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-xl flex flex-col w-[800px] h-[80vh] shadow-2xl animate-scale-up border border-slate-100">
                <div className="p-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 rounded-t-xl">
                    <div>
                        <h3 className="font-bold text-lg text-slate-800">📝 阅读小结</h3>
                        <p className="text-xs text-slate-500">基于 {cards.length} 条笔记自动生成 • 目的: {purpose}</p>
                    </div>
                    <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>
                
                <div className="flex-1 p-0 relative">
                    {isGenerating ? (
                        <div className="absolute inset-0 flex flex-col items-center justify-center bg-white/80 z-10">
                            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-600 mb-4"></div>
                            <p className="text-slate-500 animate-pulse">正在整理笔记并生成小结...</p>
                        </div>
                    ) : null}
                    <textarea
                        className="w-full h-full p-6 resize-none focus:outline-none text-slate-700 leading-relaxed font-mono text-sm"
                        value={content}
                        onChange={e => setContent(e.target.value)}
                        placeholder="等待生成..."
                    />
                </div>

                <div className="p-4 border-t border-slate-200 bg-slate-50 rounded-b-xl flex justify-between items-center">
                    <span className="text-xs text-slate-400">支持 Markdown 格式</span>
                    <div className="flex gap-3">
                        <button 
                            onClick={onCancel} 
                            className="px-4 py-2 text-slate-500 hover:bg-slate-200 rounded-lg text-sm font-medium transition-colors"
                        >
                            取消
                        </button>
                        <button 
                            onClick={() => onSave(content)} 
                            disabled={isGenerating}
                            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg text-sm font-bold shadow-lg shadow-indigo-200 transition-all flex items-center gap-2"
                        >
                            {isGenerating ? '生成中...' : '保存小结并结束'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
