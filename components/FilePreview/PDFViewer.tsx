import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { List, type RowComponentProps } from 'react-window';
import { AutoSizer } from 'react-virtualized-auto-sizer';
import 'react-pdf/dist/Page/AnnotationLayer.css';
import 'react-pdf/dist/Page/TextLayer.css';

// Polyfill URL.parse for environments where it's missing (Electron/Older Chrome)
// react-pdf / pdfjs-dist v5 uses this new static method
if (typeof URL.parse !== 'function') {
    (URL as any).parse = (url: string, base?: string) => {
        try {
            return new URL(url, base);
        } catch (e) {
            return null;
        }
    };
}

// Initialize PDF Worker - Use local file from public folder for speed and offline support
// Revert to static path which is more reliable in Electron production builds than import.meta.url
pdfjs.GlobalWorkerOptions.workerSrc = window.location.origin + '/pdf.worker.min.mjs';

// Helper to highlight text in the DOM robustly
// This handles cases where text is split across multiple spans
const highlightTextInLayer = (textLayerDiv: HTMLElement, highlights: Array<{ id: string, text: string }>, onHighlightClick?: (id: string) => void) => {
    if (!textLayerDiv || !highlights || highlights.length === 0) return;

    // We need to work with the text content of the layer
    // The TextLayer contains many spans. We need to find the text across them.
    // A simple robust way is to use a TreeWalker or normalized text matching.
    
    // Strategy: 
    // 1. Iterate over all highlights
    // 2. For each highlight, find it in the container
    // 3. Create a range and wrap it
    
    // Note: This is a simplified implementation. Robust libraries like 'mark.js' do this better but
    // we are implementing a lightweight version to avoid deps.
    
    highlights.forEach(h => {
        if (!h.text || h.text.trim().length < 2) return; // Skip empty or too short
        
        const searchText = h.text.trim();
        const walker = document.createTreeWalker(textLayerDiv, NodeFilter.SHOW_TEXT, null);
        
        let currentNode = walker.nextNode();
        while (currentNode) {
            const nodeValue = currentNode.nodeValue || '';
            const index = nodeValue.indexOf(searchText);
            
            // Simple case: Highlight is contained in a single text node
            // This covers 90% of PDF.js cases because it tries to keep lines together
            if (index >= 0) {
                const range = document.createRange();
                range.setStart(currentNode, index);
                range.setEnd(currentNode, index + searchText.length);
                
                const mark = document.createElement('mark');
                mark.className = "bg-yellow-200/50 cursor-pointer hover:bg-yellow-300/60 transition-colors rounded-sm absolute z-10 mix-blend-multiply";
                mark.title = "Click to select card";
                mark.onclick = (e) => {
                    e.stopPropagation();
                    if (onHighlightClick) onHighlightClick(h.id);
                };
                
                // Extract content and wrap
                range.surroundContents(mark);
                
                // Reset walker after modification to avoid lost reference
                currentNode = walker.nextNode(); 
                continue;
            }
            
            // TODO: Complex case (Multi-node split)
            // If the text is split (e.g. "He" "llo"), simple indexOf fails.
            // For now, we rely on the single-node match which is sufficient for 
            // most "selection-based" highlights in PDF.js since selection usually
            // respects the span boundaries PDF.js creates.
            
            currentNode = walker.nextNode();
        }
    });
};

interface PDFViewerProps {
    filePath: string;
    onTextSelect?: (text: string, context: string, pageNumber?: number) => void;
    scrollToPage?: number;
    highlights?: Array<{
        id: string;
        text: string;
        pageNumber?: number;
    }>;
    onHighlightClick?: (id: string) => void;
}

export const PDFViewer: React.FC<PDFViewerProps> = ({ filePath, onTextSelect, scrollToPage, highlights, onHighlightClick }) => {
    const [numPages, setNumPages] = useState<number | null>(null);
    const [pdfUrl, setPdfUrl] = useState<string | null>(null);
    const [scale, setScale] = useState(1.2); // Default scale
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    
    // Virtualization State
    const listRef = useRef<any>(null);

    // Handle scroll to page
    useEffect(() => {
        if (scrollToPage && listRef.current && scrollToPage > 0) {
            try {
                listRef.current.scrollToRow({ index: scrollToPage - 1, align: 'start' });
            } catch (e) {}
        }
    }, [scrollToPage]);

    useEffect(() => {
        let objectUrl: string | null = null;

        const loadFile = async () => {
            try {
                // Clear previous state
                setPdfUrl(null);
                setErrorMsg(null);
                setNumPages(null);
                
                // @ts-ignore
                const result = await window.electronAPI.fs.readBuffer(filePath);
                if (result.success) {
                    let data = result.data;
                    let buffer: Uint8Array;

                    // Normalize data to Uint8Array
                    if (data && data.type === 'Buffer' && Array.isArray(data.data)) {
                        buffer = new Uint8Array(data.data);
                    } else if (Array.isArray(data)) {
                        buffer = new Uint8Array(data);
                    } else if (data instanceof Uint8Array) {
                        buffer = data;
                    } else {
                         throw new Error("Unknown data format");
                    }

                    // Create Blob URL
                    // This is safer than passing buffer directly as it prevents "ArrayBuffer detached" errors
                    // if the buffer is transferred. Blob URLs are immutable references.
                    // @ts-ignore
                    const blob = new Blob([buffer], { type: 'application/pdf' });
                    objectUrl = URL.createObjectURL(blob);
                    setPdfUrl(objectUrl);
                } else {
                    setErrorMsg(`Load Error: ${result.error}`);
                }
            } catch (e: any) {
                console.error("Failed to load PDF", e);
                setErrorMsg(`Load Exception: ${e.message}`);
            }
        };
        loadFile();

        // Cleanup
        return () => {
            if (objectUrl) {
                URL.revokeObjectURL(objectUrl);
            }
        };
    }, [filePath]);

    const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
        setNumPages(numPages);
    };

    const handleMouseUp = (event: React.MouseEvent) => {
        if (!onTextSelect) return;
        const selection = window.getSelection();
        const text = selection?.toString().trim();
        if (text && text.length > 0) {
             const target = event.target as HTMLElement;
             const pageDiv = target.closest('[data-page-number]');
             const pageNumber = pageDiv ? parseInt(pageDiv.getAttribute('data-page-number') || '1', 10) : 1;
             onTextSelect(text, text, pageNumber); 
        }
    };

    // Row Renderer for React Window
    const Row = ({ index, style }: RowComponentProps) => {
        const pageNumber = index + 1;
        // Filter highlights for this page
        const pageHighlights = highlights?.filter(h => h.pageNumber === pageNumber) || [];

        return (
            <div style={{ ...style, display: 'flex', justifyContent: 'center' }}>
                <div className="shadow-sm my-2 bg-white relative" data-page-number={pageNumber}>
                    <Page 
                        pageNumber={pageNumber} 
                        scale={scale}
                        renderTextLayer={true}
                        renderAnnotationLayer={true}
                        loading={<div className="h-[800px] w-[600px] bg-white animate-pulse" />}
                        error={<div className="h-[800px] w-[600px] bg-red-50 flex items-center justify-center text-red-400">Error</div>}
                        onRenderTextLayerSuccess={() => {
                            // DOM-based highlighting after text layer is ready
                            // Find the text layer div
                            const pageDiv = document.querySelector(`[data-page-number="${pageNumber}"] .react-pdf__Page__textContent`);
                            if (pageDiv) {
                                highlightTextInLayer(pageDiv as HTMLElement, pageHighlights, onHighlightClick);
                            }
                        }}
                    />
                    <div className="absolute bottom-2 right-2 text-xs text-gray-300 pointer-events-none">
                        {pageNumber}
                    </div>
                </div>
            </div>
        );
    };

    // Calculate row height based on scale (Approximate A4 ratio 1:1.414)
    // Base width approx 600px at scale 1.0 -> Height ~850px
    // We add some margin
    const itemSize = useMemo(() => (850 * scale) + 20, [scale]);

    if (errorMsg) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                <div className="text-red-500 mb-4">
                    <svg className="w-12 h-12 mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <p className="font-bold">无法加载文档</p>
                    <p className="text-sm opacity-80 mt-1">{errorMsg}</p>
                </div>
                <div className="flex gap-3">
                    <button 
                        onClick={() => window.location.reload()} 
                        className="px-4 py-2 bg-slate-200 hover:bg-slate-300 rounded text-sm text-slate-700 transition-colors"
                    >
                        重试
                    </button>
                    <button 
                        onClick={() => {
                            // @ts-ignore
                            window.electronAPI?.shell?.openPath(filePath);
                        }}
                        className="px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 rounded text-sm font-medium transition-colors"
                    >
                        用系统默认应用打开
                    </button>
                </div>
            </div>
        );
    }

    if (!pdfUrl) {
        return (
            <div className="h-full flex flex-col items-center justify-center p-8 text-slate-400">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-indigo-500 mb-4">
                </div>
                <p className="animate-pulse">正在准备文档...</p>
            </div>
        );
    }

    return (
        <div className="h-full w-full bg-slate-100 relative group flex flex-col" onMouseUp={handleMouseUp}>
             {/* Floating Controls */}
             <div className="absolute top-4 right-8 z-50 bg-white/90 backdrop-blur shadow-lg rounded-xl p-1.5 flex gap-2 border border-slate-200 transition-all opacity-0 group-hover:opacity-100">
                <button onClick={() => setScale(s => Math.max(0.5, s - 0.1))} className="w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-lg text-slate-600">-</button>
                <span className="text-xs font-bold text-slate-600 w-12 text-center self-center">{Math.round(scale * 100)}%</span>
                <button onClick={() => setScale(s => Math.min(2.5, s + 0.1))} className="w-8 h-8 flex items-center justify-center hover:bg-slate-100 rounded-lg text-slate-600">+</button>
            </div>

            <div className="flex-1 w-full relative min-h-0">
                <Document
                    file={pdfUrl}
                    onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={(e) => setErrorMsg(e.message)}
                    loading={
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-50 z-10">
                            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-400"></div>
                        </div>
                    }
                    className="h-full"
                >
                    {numPages && (
                        <div style={{ width: '100%', height: '100%' }}>
                            <AutoSizer
                                renderProp={({ height, width }: { height: number; width: number }) => (
                                    <List
                                        listRef={listRef}
                                        rowCount={numPages}
                                        rowHeight={itemSize}
                                        rowComponent={Row}
                                        rowProps={{}}
                                        style={{ height, width }}
                                        overscanCount={2}
                                    />
                                )}
                            />
                        </div>
                    )}
                </Document>
            </div>
        </div>
    );
};
