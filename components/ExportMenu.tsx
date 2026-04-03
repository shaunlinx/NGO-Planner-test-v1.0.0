import React, { useState, useRef, useEffect } from 'react';

interface ExportMenuProps {
    content: string;
    type: 'markdown' | 'csv';
    fileName: string;
    className?: string;
    styleConfig?: any; // OptimizationConfig
}

const ExportMenu: React.FC<ExportMenuProps> = ({ content, type, fileName, className = '', styleConfig }) => {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleExport = async (format: 'pdf' | 'docx' | 'xlsx') => {
        setIsOpen(false);
        if (!(window as any).electronAPI?.exportFile) {
            alert("导出功能仅在桌面版可用");
            return;
        }

        const safeName = fileName.replace(/\.[^/.]+$/, ""); // Remove extension
        
        // Prepare content with styles if needed
        let contentToExport = content;
        
        if (styleConfig && type === 'markdown' && (format === 'pdf' || format === 'docx')) {
             // Inject style wrapper for HTML conversion in backend
             // The backend likely converts markdown -> html -> pdf/docx
             // We can prepend a style block or wrap in a div with inline styles
             // Assuming backend uses a standard markdown parser that supports HTML tags
             
             // Construct inline styles from config
             const fontMap: Record<string, string> = {
                'font-serif': 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
                'font-sans': 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
                'font-mono': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
            };
            const fontFamily = fontMap[styleConfig.fontFamily] || styleConfig.fontFamily || 'inherit';
            
            const fontSize = styleConfig.fontSize === 'text-sm' ? '14px' : 
                           styleConfig.fontSize === 'text-base' ? '16px' : 
                           styleConfig.fontSize === 'text-lg' ? '18px' : 
                           styleConfig.fontSize === 'text-xl' ? '20px' : '16px';
                           
            const lineHeight = styleConfig.lineHeight === 'leading-normal' ? '1.5' : 
                             styleConfig.lineHeight === 'leading-relaxed' ? '1.625' : 
                             styleConfig.lineHeight === 'leading-loose' ? '2' : 
                             styleConfig.lineHeight === 'leading-tight' ? '1.25' : '1.5';
                             
            const letterSpacing = styleConfig.letterSpacing === 'tracking-tight' ? '-0.025em' : 
                                styleConfig.letterSpacing === 'tracking-normal' ? '0' : 
                                styleConfig.letterSpacing === 'tracking-wide' ? '0.025em' : '0';

            const styleString = `font-family: ${fontFamily}; font-size: ${fontSize}; line-height: ${lineHeight}; letter-spacing: ${letterSpacing};`;
            
            // Wrap content
            contentToExport = `<div style="${styleString}">\n\n${content}\n\n</div>`;
        }

        const res = await (window as any).electronAPI.exportFile({
            content: contentToExport,
            type,
            format,
            defaultName: `${safeName}.${format}`
        });

        if (res.success) {
            // Optional: Toast notification
            console.log(`Exported to ${res.filePath}`);
        } else if (res.error) {
            alert(`导出失败: ${res.error}`);
        }
    };

    return (
        <div className={`relative inline-block text-left ${className}`} ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="p-1.5 hover:bg-gray-100 rounded-full text-gray-500 hover:text-gray-700 transition-colors"
                title="导出文档"
            >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 5v.01M12 12v.01M12 19v.01M12 6a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2zm0 7a1 1 0 110-2 1 1 0 010 2z" />
                </svg>
            </button>

            {isOpen && (
                <div className="absolute right-0 mt-2 w-40 rounded-xl shadow-xl bg-white ring-1 ring-black ring-opacity-5 z-50 animate-fade-in-up origin-top-right overflow-hidden">
                    <div className="py-1">
                        {type === 'markdown' && (
                            <>
                                <button
                                    onClick={() => handleExport('pdf')}
                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-600 flex items-center gap-2"
                                >
                                    <span>📄</span> 导出 PDF
                                </button>
                                <button
                                    onClick={() => handleExport('docx')}
                                    className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2"
                                >
                                    <span>📝</span> 导出 Word
                                </button>
                            </>
                        )}
                        {type === 'csv' && (
                            <button
                                onClick={() => handleExport('xlsx')}
                                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-green-50 hover:text-green-600 flex items-center gap-2"
                            >
                                <span>📊</span> 导出 Excel
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ExportMenu;
