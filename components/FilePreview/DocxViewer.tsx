import React, { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import mammoth from 'mammoth';

interface DocxViewerProps {
    htmlContent: string;
    onTextSelect?: (text: string, context: string) => void;
    highlightText?: string;
}

export const DocxViewer: React.FC<DocxViewerProps> = ({ htmlContent, onTextSelect, highlightText }) => {
    const containerRef = React.useRef<HTMLDivElement>(null);

    React.useEffect(() => {
        if (highlightText && containerRef.current) {
            // Simple text search and scroll
            // Note: This is a basic implementation. Robust highlighting requires wrapping text in spans.
            // For now, we try to use window.find if supported (Electron/Chrome supports it)
            // or just rely on user finding it.
            // Better: Scroll to the element containing the text?
            // Since we use dangerouslySetInnerHTML, we can't easily wrap without re-parsing.
            
            // Try to find text node
            const treeWalker = document.createTreeWalker(containerRef.current, NodeFilter.SHOW_TEXT);
            while(treeWalker.nextNode()) {
                const node = treeWalker.currentNode;
                if (node.textContent?.includes(highlightText)) {
                    // Scroll into view
                    const element = node.parentElement;
                    element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    // Highlight effect (temporary border)
                    element?.animate([
                        { backgroundColor: 'rgba(255, 255, 0, 0.5)' },
                        { backgroundColor: 'transparent' }
                    ], { duration: 2000 });
                    break;
                }
            }
        }
    }, [highlightText]);

    const handleMouseUp = () => {
        if (!onTextSelect) return;
        const selection = window.getSelection();
        if (selection && selection.toString().trim().length > 0) {
             onTextSelect(selection.toString(), selection.toString()); 
        }
    };

    return (
        <div className="h-full overflow-y-auto bg-slate-50 p-8">
            <div 
                ref={containerRef}
                className="max-w-3xl mx-auto bg-white shadow-sm border border-slate-200 p-12 min-h-full prose prose-slate prose-lg hover:prose-a:text-indigo-600 prose-img:rounded-lg prose-headings:text-slate-800 prose-p:text-slate-600 prose-li:text-slate-600"
                onMouseUp={handleMouseUp}
                style={{ contentVisibility: 'auto', contain: 'content' }}
                dangerouslySetInnerHTML={{ __html: htmlContent }}
            />
        </div>
    );
};
