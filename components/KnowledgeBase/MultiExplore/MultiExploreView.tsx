
import React, { useState, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { MultiExploreResponse, ComparisonResult } from './types';
import { CollectedItem } from './CardClip';
import * as KBIcons from '../KBIcons';
import { ComparisonView } from './ComparisonView';

interface MultiExploreViewProps {
    responses: MultiExploreResponse[];
    collectedItems?: CollectedItem[];
    onCollect: (text: string, providerId: string, sourceObj: any) => void;
    // Actions per provider
    onCopy?: (text: string) => void;
    onCopyMarkdown?: (text: string) => void;
    onEdit?: (text: string, providerId: string) => void;
    onUpdateContent?: (text: string, providerId: string) => void;
    onSave?: (text: string, chunks?: any[]) => void;
    onDelete?: (providerId: string) => void;
    onSynthesize?: (providerId: string) => void;
    onCompare?: () => void;
    isGenerating?: boolean;
    isSidebarPinned?: boolean;
    comparisonResult?: ComparisonResult | null;
}

export const MultiExploreView = (props: MultiExploreViewProps) => {
    const { 
        responses, 
        collectedItems = [], 
        onCollect,
        onCopy,
        onSave,
        onDelete,
        onSynthesize,
        isGenerating,
        onCopyMarkdown,
        onEdit,
        onUpdateContent,
        isSidebarPinned = false,
        onCompare,
        comparisonResult = null
    } = props;
    const [ratings, setRatings] = useState<Record<string, number>>({});
    const [showRealNames, setShowRealNames] = useState(false);

    // Inline Edit State: map providerId to text
    const [editingState, setEditingState] = useState<Record<string, string>>({});
    const [activeEditingId, setActiveEditingId] = useState<string | null>(null);

    const handleStartEdit = (providerId: string, currentText: string) => {
        setActiveEditingId(providerId);
        setEditingState(prev => ({ ...prev, [providerId]: currentText }));
    };

    const handleCancelEdit = () => {
        setActiveEditingId(null);
    };

    const handleSaveEdit = (providerId: string) => {
        if (onUpdateContent && editingState[providerId] !== undefined) {
            onUpdateContent(editingState[providerId], providerId);
        }
        setActiveEditingId(null);
    };
    
    // Stable shuffled order map
    const [orderMap, setOrderMap] = useState<Record<string, number>>({});

    // Initialize shuffle order when responses change (and no order exists for them)
    React.useEffect(() => {
        if (responses.length > 0) {
            setOrderMap(prev => {
                // If all current providers already have an order, keep it
                const allExist = responses.every(r => typeof prev[r.providerId] === 'number');
                if (allExist) return prev;

                // Otherwise, assign random order to new ones
                const newOrder = { ...prev };
                const unassigned = responses.filter(r => typeof prev[r.providerId] !== 'number');
                if (unassigned.length > 0) {
                    // Get used indices
                    const usedIndices = new Set(Object.values(prev));
                    let nextIndex = 0;
                    
                    // Shuffle unassigned
                    const shuffled = [...unassigned].sort(() => Math.random() - 0.5);
                    
                    shuffled.forEach(r => {
                        while (usedIndices.has(nextIndex)) nextIndex++;
                        newOrder[r.providerId] = nextIndex;
                        usedIndices.add(nextIndex);
                    });
                }
                return newOrder;
            });
        }
    }, [responses.length]); // Only re-run if count changes, effectively. 
    
    // Check if all finished
    const allFinished = responses.every(r => !r.isLoading);
    
    // Calculate Scores & Sort
    const scoredResponses = useMemo(() => {
        const calculated = responses.map(res => {
            // 1. Recall (from backend, normalized 0-1)
            const recall = typeof res.stats?.recall === 'number' ? Math.max(0, Math.min(1, res.stats.recall)) : 0.5;
            
            // 2. Collection Stats
            const myItems = collectedItems.filter(i => i.providerId === res.providerId);
            const collectionCount = myItems.length;
            const collectionRatio = res.content.length > 0 ? (myItems.reduce((acc, i) => acc + i.text.length, 0) / res.content.length) : 0;
            
            // 3. User Rating
            const rating = ratings[res.providerId] || 0; // 0-5
            
            // Normalize
            const normCount = Math.min(collectionCount / 5, 1);
            const normRatio = Math.min(collectionRatio / 0.2, 1);
            const normRating = rating / 5;
            
            // Weights: Recall 0.4, Count 0.2, Ratio 0.2, Rating 0.2
            const score = (recall * 0.4) + (normCount * 0.2) + (normRatio * 0.2) + (normRating * 0.2);
            
            return { ...res, score: score * 100 };
        });

        // Sort by the stable random order
        return calculated.sort((a, b) => {
            const orderA = orderMap[a.providerId] ?? 999;
            const orderB = orderMap[b.providerId] ?? 999;
            return orderA - orderB;
        });
    }, [responses, collectedItems, ratings, orderMap]);

    const handleMouseUp = (providerId: string) => {
        const selection = window.getSelection();
        if (selection && selection.toString().trim().length > 0) {
            const text = selection.toString().trim();
            // Pass providerId and empty sourceObj for now
            onCollect(text, providerId, {});
        }
    };

    return (
        <div className="w-full flex flex-col gap-4">
            {allFinished && (
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => onCompare && onCompare()}
                        disabled={isGenerating}
                        className={`px-2 py-1 text-xs rounded-md border ${isGenerating ? 'text-slate-400 border-slate-200' : 'text-indigo-600 border-indigo-200 hover:bg-indigo-50'}`}
                        title="使用主力模型生成多模型对比分析"
                    >
                        生成对比分析
                    </button>
                </div>
            )}
            <div className="w-full overflow-x-auto custom-scrollbar">
                <div className="flex min-w-full">
                    {scoredResponses.map((res, idx) => (
                        <div 
                            key={res.providerId} 
                            className={`flex-shrink-0 flex flex-col border-r border-slate-200 dark:border-slate-700/50 ${idx === responses.length - 1 ? 'border-r-0' : ''} group relative`}
                            style={{
                                width: responses.length <= 2 
                                    ? '50%' 
                                    : (!isSidebarPinned ? '35%' : '50%'),
                                minWidth: '350px',
                                maxWidth: responses.length === 1 ? '100%' : '600px'
                            }}
                        >
                             {/* Header */}
                             <div className="p-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex items-center justify-between gap-2 shrink-0 h-12">
                                {/* Left: Status + Name + Eye */}
                                <div className="flex items-center gap-2 min-w-0 flex-1">
                                    <div className={`w-2 h-2 rounded-full shrink-0 ${res.isLoading ? 'bg-yellow-400 animate-pulse' : 'bg-green-400'}`}></div>
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="text-xs font-black text-slate-700 dark:text-slate-300 truncate select-none">
                                            {showRealNames ? res.providerName : `Model ${String.fromCharCode(65 + idx)}`}
                                        </span>
                                        {showRealNames && (
                                            <span className="text-[9px] px-1.5 py-0.5 bg-slate-200 dark:bg-slate-700 rounded text-slate-500 font-mono truncate max-w-[80px]" title={res.modelId}>
                                                {res.modelId}
                                            </span>
                                        )}
                                        <button 
                                            onClick={() => setShowRealNames(!showRealNames)}
                                            className="text-slate-400 hover:text-indigo-600 transition-colors p-0.5"
                                            title={showRealNames ? "Hide Real Names" : "Show Real Names"}
                                        >
                                            <KBIcons.Eye />
                                        </button>
                                    </div>
                                </div>
                                
                                {/* Right: Score + Rating */}
                                <div className="flex items-center gap-2 shrink-0">
                                    <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700/50 px-1.5 py-0.5 rounded-full">
                                        <span className="text-[9px] text-slate-400 font-bold uppercase tracking-wider">Score</span>
                                        <span className={`text-[10px] font-black ${
                                            (res.score || 0) >= 80 ? 'text-green-500' : 
                                            (res.score || 0) >= 60 ? 'text-yellow-500' : 'text-slate-500'
                                        }`}>
                                            {Math.round(res.score || 0)}
                                        </span>
                                    </div>
                                    
                                    <div className="flex items-center -space-x-0.5">
                                        {[1,2,3,4,5].map(star => (
                                            <button 
                                                key={star}
                                                onClick={() => setRatings(prev => ({...prev, [res.providerId]: star}))}
                                                className={`text-[10px] p-0.5 transform hover:scale-125 transition-transform ${star <= (ratings[res.providerId] || 0) ? 'text-yellow-400' : 'text-slate-200'}`}
                                            >
                                                ★
                                            </button>
                                        ))}
                                    </div>
                                </div>
                             </div>
                             
                             {/* Content */}
                             <div 
                                className="p-4 flex-1 overflow-y-auto max-h-[600px] custom-scrollbar selection:bg-indigo-200 dark:selection:bg-indigo-900 relative"
                                onMouseUp={() => handleMouseUp(res.providerId)}
                                onDoubleClick={() => handleStartEdit(res.providerId, res.content)}
                             >
                                {activeEditingId === res.providerId ? (
                                    <div className="flex flex-col gap-2 h-full">
                                        <textarea 
                                            value={editingState[res.providerId] || ''}
                                            onChange={(e) => setEditingState(prev => ({ ...prev, [res.providerId]: e.target.value }))}
                                            className="w-full h-full min-h-[200px] p-3 bg-slate-50 border border-indigo-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 resize-y font-mono text-xs"
                                            autoFocus
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                        <div className="flex justify-end gap-2 sticky bottom-0 bg-white/80 backdrop-blur p-2 border-t border-slate-100">
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleCancelEdit(); }}
                                                className="px-3 py-1 text-xs text-slate-500 hover:bg-slate-100 rounded-md transition-colors"
                                            >
                                                取消
                                            </button>
                                            <button 
                                                onClick={(e) => { e.stopPropagation(); handleSaveEdit(res.providerId); }}
                                                className="px-3 py-1 text-xs bg-indigo-600 text-white hover:bg-indigo-700 rounded-md shadow-sm transition-colors flex items-center gap-1"
                                            >
                                                <span>✓</span> 完成
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    res.error ? (
                                        <div className="text-red-400 text-xs p-4 bg-red-50 dark:bg-red-900/20 rounded-xl">{res.error}</div>
                                    ) : (
                                        <div className="prose prose-xs dark:prose-invert max-w-none pb-8" title="双击可快速编辑">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{res.content || (res.isLoading ? 'Thinking...' : '')}</ReactMarkdown>
                                        </div>
                                    )
                                )}
                             </div>

                             {/* References & Actions Footer */}
                             {!res.isLoading && !res.error && (
                                <div className="p-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/20 shrink-0 flex items-center justify-between min-h-[40px]">
                                    {/* Left: References */}
                                    {res.chunks && res.chunks.length > 0 ? (
                                        <details className="group relative">
                                            <summary className="list-none cursor-pointer flex items-center gap-2 text-[10px] text-slate-400 hover:text-indigo-500 transition-colors">
                                                <span className="font-bold">📚 参考来源 ({res.chunks.length})</span>
                                                <span className="text-slate-300 group-open:rotate-180 transition-transform">▼</span>
                                            </summary>
                                            {/* References Dropdown */}
                                            <div className="absolute left-0 bottom-full mb-2 w-64 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg shadow-xl p-2 space-y-1 z-50 hidden group-open:block animate-fade-in-up">
                                                {res.chunks.map((chunk, i) => (
                                                    <div key={i} className="text-[9px] text-slate-500 truncate hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer p-1 hover:bg-slate-50 dark:hover:bg-slate-700 rounded" title={chunk.text}>
                                                        {i+1}. {chunk.source}
                                                    </div>
                                                ))}
                                            </div>
                                        </details>
                                    ) : <div></div>}

                                    {/* Right: Actions Toolbar */}
                                    <div className="flex items-center gap-1">
                                        <button 
                                            onClick={() => onCopy && onCopy(res.content)}
                                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors"
                                            title="复制纯文本"
                                        >
                                            <KBIcons.Copy />
                                        </button>
                                        <button 
                                            onClick={() => props.onCopyMarkdown && props.onCopyMarkdown(res.content)}
                                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors font-mono text-[10px] w-6 flex items-center justify-center"
                                            title="复制 Markdown"
                                        >
                                            MD
                                        </button>
                                        <button 
                                            onClick={() => props.onEdit && props.onEdit(res.content, res.providerId)}
                                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors"
                                            title="编辑"
                                        >
                                            <KBIcons.Edit />
                                        </button>
                                        <button 
                                            onClick={() => onSave && onSave(res.content, res.chunks)}
                                            className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-md transition-colors"
                                            title="保存到知识库"
                                        >
                                            <KBIcons.Save />
                                        </button>
                                        <div className="w-[1px] h-3 bg-slate-200 mx-1"></div>
                                        <button 
                                            onClick={() => onDelete && onDelete(res.providerId)}
                                            className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-md transition-colors"
                                            title="移除此窗口"
                                        >
                                            <KBIcons.Delete />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>
            {comparisonResult && (
                <ComparisonView result={comparisonResult} />
            )}
        </div>
    );
};
