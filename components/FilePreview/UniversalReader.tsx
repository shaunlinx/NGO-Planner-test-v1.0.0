import React, { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface UniversalReaderProps {
    content: string; // Markdown or Text content
    filePath: string;
    onTextSelect?: (text: string, context: string) => void;
    highlights?: Array<{
        id: string;
        text: string;
    }>;
    onHighlightClick?: (id: string) => void;
    activeHighlightId?: string | null;
}

export const UniversalReader: React.FC<UniversalReaderProps> = ({ 
    content, 
    filePath, 
    onTextSelect, 
    highlights, 
    onHighlightClick,
    activeHighlightId
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [processedContent, setProcessedContent] = useState('');
    const [scale, setScale] = useState(100); // Zoom scale in %

    // Wheel Zoom Handler
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const handleWheel = (e: WheelEvent) => {
            if (e.ctrlKey || e.metaKey) { // Pinch or Ctrl+Wheel
                e.preventDefault();
                setScale(s => {
                    const delta = e.deltaY > 0 ? -5 : 5;
                    return Math.min(Math.max(50, s + delta), 250);
                });
            }
        };

        container.addEventListener('wheel', handleWheel, { passive: false });
        return () => container.removeEventListener('wheel', handleWheel);
    }, []);

    // Process content to inject visual highlights
    useEffect(() => {
        if (!content) return;
        setProcessedContent(content);
    }, [content, highlights]);

    // Handle Text Selection
    const handleMouseUp = () => {
        if (!onTextSelect) return;
        
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        
        if (text && text.length > 0) {
            // Get context (surrounding text)
            // Improved Context Extraction: Get paragraph
            let context = text;
            if (selection?.anchorNode?.parentElement) {
                // Try to grab the full paragraph text
                context = selection.anchorNode.parentElement.textContent || text;
            }
            onTextSelect(text, context);
        }
    };

    // Apply highlights after render and scroll handling
    useEffect(() => {
        if (!highlights || highlights.length === 0 || !containerRef.current) return;

        // Clean up old marks first to avoid duplication (optional but good practice)
        // Actually, React re-renders might handle this, but if we modify DOM directly,
        // we should be careful. Since we rely on useEffect deps, it runs after render.
        // We assume React renders fresh HTML from processedContent.
        
        const container = containerRef.current;
        
        highlights.forEach(h => {
            if (!h.text || h.text.length < 2) return;
            
            // Normalize text for matching (ignore extra whitespace)
            const searchText = h.text.replace(/\s+/g, ' ').trim();
            
            const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
            let node = walker.nextNode();
            
            while (node) {
                const nodeVal = node.nodeValue?.replace(/\s+/g, ' ') || '';
                const idx = nodeVal.indexOf(searchText);
                
                if (idx >= 0) {
                    if (node.parentElement?.tagName === 'MARK') {
                        node = walker.nextNode();
                        continue;
                    }

                    // We need to map the normalized index back to original node value index if possible
                    // Or simplified: just use the raw nodeValue if exact match
                    const rawIdx = (node.nodeValue || '').indexOf(h.text);
                    // If exact match fails, fallback to fuzzy or skip (simple approach: skip)
                    if (rawIdx === -1 && h.text.length > 20) {
                        // If text is long and raw match fails (due to whitespace), we might need complex logic.
                        // For now, let's assume raw match works for UniversalReader since we control the source.
                         node = walker.nextNode();
                         continue;
                    }
                    const finalIdx = rawIdx >= 0 ? rawIdx : idx;

                    // Improved Range Creation logic to handle edge cases
                    try {
                        const range = document.createRange();
                        range.setStart(node, finalIdx);
                        range.setEnd(node, finalIdx + h.text.length);
                        
                        const mark = document.createElement('mark');
                        mark.className = "bg-yellow-200/50 cursor-pointer hover:bg-yellow-300/60 transition-colors rounded-sm";
                        mark.id = `highlight-${h.id}`; // Add ID for scrolling
                        mark.onclick = (e) => {
                            e.stopPropagation();
                            if (onHighlightClick) onHighlightClick(h.id);
                        };
                        
                        range.surroundContents(mark);
                    } catch (e) {
                        // Ignore complex overlap
                    }
                    
                    node = walker.nextNode(); 
                    continue;
                }
                node = walker.nextNode();
            }
        });
    }, [processedContent, highlights]);

    // Scroll to active highlight with better timing
    useEffect(() => {
        if (!activeHighlightId) return;
        
        // Use a small timeout to ensure DOM is ready after re-renders
        const timer = setTimeout(() => {
            const el = document.getElementById(`highlight-${activeHighlightId}`);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // Flash effect
                el.style.backgroundColor = 'rgba(250, 204, 21, 0.8)';
                setTimeout(() => el.style.backgroundColor = '', 1500);
            } else {
                // Retry once if not found immediately (sometimes markdown re-renders async)
                setTimeout(() => {
                     const elRetry = document.getElementById(`highlight-${activeHighlightId}`);
                     if (elRetry) elRetry.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 300);
            }
        }, 100);
        
        return () => clearTimeout(timer);
    }, [activeHighlightId, processedContent]); 

    return (
        <div className="h-full flex flex-col bg-slate-50 relative">
            {/* Toolbar / Header */}
             {/* Increased pt to pt-12 (48px) for macOS traffic lights spacing */}
             <div className="flex-none pt-12 pb-3 px-6 border-b border-slate-200 bg-white flex justify-between items-center z-10 drag-region">
                <div className="flex items-center gap-2 overflow-hidden max-w-[40%]">
                    <div className="p-1 bg-indigo-50 rounded text-indigo-600">
                        {/* File Icon */}
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                    </div>
                    <div className="text-sm font-bold text-slate-700 truncate no-drag" title={filePath}>
                        {filePath.split('/').pop()}
                    </div>
                </div>
                 
                 <div className="flex items-center gap-4 no-drag">
                    {/* Zoom Controls */}
                    <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                        <button onClick={() => setScale(s => Math.max(50, s - 10))} className="p-1 hover:bg-white rounded text-slate-500 w-6 h-6 flex items-center justify-center">-</button>
                        <span className="text-xs w-10 text-center text-slate-600 font-mono">{scale}%</span>
                        <button onClick={() => setScale(s => Math.min(200, s + 10))} className="p-1 hover:bg-white rounded text-slate-500 w-6 h-6 flex items-center justify-center">+</button>
                    </div>

                    <button 
                        onClick={async () => {
                            // Robust open file handler
                            try {
                                // @ts-ignore
                                const result = await window.electronAPI?.shell?.openPath(filePath);
                                if (result) {
                                    console.error("Open failed:", result);
                                    alert(`无法打开文件: ${result}`);
                                }
                            } catch (e) {
                                console.error("Open exception:", e);
                            }
                        }}
                        className="flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded text-xs font-medium transition-colors"
                    >
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                        </svg>
                        打开原文件
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-y-auto p-8" onMouseUp={handleMouseUp}>
                <div 
                    ref={containerRef}
                    style={{ 
                        fontSize: `${scale}%`,
                        maxWidth: scale > 100 ? '100%' : '48rem' // Allow expansion when zoomed in
                    }}
                    className="mx-auto bg-white shadow-sm border border-slate-200 p-12 min-h-full transition-all duration-200 prose prose-slate prose-lg hover:prose-a:text-indigo-600 prose-img:rounded-lg prose-headings:text-slate-800 prose-p:text-slate-600 prose-li:text-slate-600 prose-blockquote:border-indigo-500 prose-blockquote:bg-slate-50 prose-blockquote:py-1 prose-blockquote:px-4"
                >
                    <style>{`
                        .drag-region { -webkit-app-region: drag; }
                        .no-drag { -webkit-app-region: no-drag; }
                        /* ... styles ... */
                        .prose p {
                            text-indent: 2em;
                            text-align: justify;
                            margin-top: 1.2em;
                            margin-bottom: 1.2em;
                            line-height: 1.8;
                        }
                        /* ... other styles preserved ... */
                        .prose h1 {
                            text-align: center;
                            font-size: 2.25em;
                            margin-top: 0;
                            margin-bottom: 1.5em;
                            color: #1e293b;
                            font-weight: 800;
                        }
                        .prose h2 {
                            border-bottom: 2px solid #e2e8f0;
                            padding-bottom: 0.3em;
                            margin-top: 2em;
                            margin-bottom: 1em;
                            color: #334155;
                            font-size: 1.5em;
                        }
                        .prose h3 {
                            color: #475569;
                            margin-top: 1.5em;
                            margin-bottom: 0.8em;
                            font-size: 1.25em;
                            border-left: 4px solid #6366f1;
                            padding-left: 0.8em;
                        }
                        .prose ul, .prose ol {
                            padding-left: 2em;
                        }
                        .prose li {
                            margin-top: 0.5em;
                            margin-bottom: 0.5em;
                        }
                        mark {
                            display: inline;
                            box-decoration-break: clone;
                            -webkit-box-decoration-break: clone;
                        }
                    `}</style>
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {processedContent}
                    </ReactMarkdown>
                </div>
            </div>
        </div>
    );
};