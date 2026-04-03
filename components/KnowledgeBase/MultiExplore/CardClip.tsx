import React, { useState } from 'react';

export interface CollectedItem {
    id: string;
    text: string;
    providerId: string;
    timestamp: number;
}

interface CardClipProps {
    items: CollectedItem[];
    onRemove: (id: string) => void;
    onSynthesize?: () => void;
    isGenerating?: boolean;
    className?: string;
}

export const CardClip: React.FC<CardClipProps> = ({ items, onRemove, onSynthesize, isGenerating, className }) => {
    const [isHovered, setIsHovered] = useState(false);
    const timeoutRef = React.useRef<NodeJS.Timeout | null>(null);

    const handleMouseEnter = () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        setIsHovered(true);
    };

    const handleMouseLeave = () => {
        timeoutRef.current = setTimeout(() => {
            setIsHovered(false);
        }, 300); // 300ms delay to allow mouse transition
    };

    return (
        <div 
            className={`relative ${className || ''}`}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
        >
            {/* Trigger Icon */}
            <button 
                className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors shadow-sm relative"
                title="收集箱"
            >
                <span className="text-lg">🗃️</span>
                {items.length > 0 && (
                    <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center border-2 border-white dark:border-slate-900">
                        {items.length}
                    </span>
                )}
            </button>

            {/* Popover Content */}
            {isHovered && items.length > 0 && (
                <div className="absolute top-full right-0 mt-2 w-80 bg-white dark:bg-slate-800 border border-slate-100 dark:border-slate-700 rounded-2xl shadow-xl z-50 animate-fade-in-up overflow-hidden">
                     {/* Header */}
                    <div className="flex justify-between items-center p-3 border-b border-slate-100 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50">
                        <h4 className="text-xs font-black text-slate-700 dark:text-white uppercase tracking-wider flex items-center gap-2">
                            <span>🗃️</span> 收集箱 ({items.length})
                        </h4>
                        <span className="text-[9px] text-slate-400">划线内容自动保存</span>
                    </div>
                    
                    {/* List */}
                    <div className="max-h-[400px] overflow-y-auto custom-scrollbar p-2 space-y-2">
                        {items.map(item => (
                            <div key={item.id} className="bg-slate-50 dark:bg-slate-900 rounded-lg p-2.5 border border-slate-100 dark:border-slate-700 group relative hover:shadow-sm transition-shadow">
                                <div className="text-[10px] text-slate-600 dark:text-slate-300 line-clamp-3 leading-relaxed">
                                    "{item.text}"
                                </div>
                                <div className="mt-1.5 flex justify-between items-center">
                                    <span className="text-[9px] text-indigo-400 font-mono bg-indigo-50 dark:bg-indigo-900/30 px-1 rounded">
                                        From: {item.providerId}
                                    </span>
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); onRemove(item.id); }}
                                        className="text-slate-300 hover:text-red-500 transition-colors p-1"
                                    >
                                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                    {/* Footer Action */}
                    {onSynthesize && (
                        <div className="p-2 border-t border-slate-100 dark:border-slate-700 bg-slate-50/30 dark:bg-slate-800/30">
                            <button 
                                onClick={(e) => { e.stopPropagation(); onSynthesize(); }}
                                disabled={isGenerating}
                                className="w-full py-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white rounded-xl text-xs font-bold shadow-md hover:shadow-lg transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {isGenerating ? (
                                    <>
                                        <svg className="animate-spin h-3 w-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        正在生成整合回答...
                                    </>
                                ) : (
                                    <>
                                        <span>✨</span> 开始整合生成
                                    </>
                                )}
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};