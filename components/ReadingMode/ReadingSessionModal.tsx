import React, { useState } from 'react';

interface ReadingSessionModalProps {
    onConfirm: (purpose: string) => void;
    onCancel: () => void;
}

export const ReadingSessionModal: React.FC<ReadingSessionModalProps> = ({ onConfirm, onCancel }) => {
    const [purpose, setPurpose] = useState('');

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200] backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-xl p-6 w-96 shadow-2xl animate-scale-up border border-slate-100">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="font-bold text-lg text-slate-800">🎯 设定阅读目的</h3>
                    <button onClick={onCancel} className="text-slate-400 hover:text-slate-600">✕</button>
                </div>
                
                <p className="text-sm text-slate-500 mb-4 leading-relaxed">
                    在开始之前，请明确您的阅读目标（如：研究主题、待解决的问题、项目背景等）。
                    <br/>
                    <span className="text-indigo-500 text-xs">系统将基于此为您自动生成智能标签和知识关联。</span>
                </p>
                
                <div className="mb-6">
                    <label className="block text-xs font-bold text-slate-400 uppercase mb-1">阅读目的 / 核心问题</label>
                    <textarea
                        className="w-full border border-slate-200 bg-slate-50 p-3 rounded-lg text-sm focus:border-indigo-500 focus:bg-white outline-none transition-all resize-none h-24"
                        placeholder="例如：了解社区养老服务的可持续性模式..."
                        value={purpose}
                        onChange={e => setPurpose(e.target.value)}
                        autoFocus
                        onKeyDown={e => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                if (purpose.trim()) onConfirm(purpose);
                            }
                        }}
                    />
                </div>
                
                <div className="flex justify-end gap-3">
                    <button 
                        onClick={onCancel} 
                        className="px-4 py-2 text-slate-500 hover:bg-slate-100 rounded-lg text-sm font-medium transition-colors"
                    >
                        暂不设定
                    </button>
                    <button 
                        onClick={() => onConfirm(purpose || "通用阅读")} 
                        className="px-6 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-bold shadow-lg shadow-indigo-200 transition-all"
                    >
                        开始深度阅读
                    </button>
                </div>
            </div>
        </div>
    );
};
