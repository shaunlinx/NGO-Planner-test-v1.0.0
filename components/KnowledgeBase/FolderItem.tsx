import React, { useState } from 'react';
import { FileTree } from '../FileTree';

export const FolderItem: React.FC<{
    folder: string,
    idx: any,
    refreshKey: number,
    activeFiles: Set<string>,
    loadingFiles: Set<string>,
    setContextMenu: (menu: { visible: boolean, x: number, y: number, targetPath: string }) => void,
    onContextMenu: (folder: string, e: React.MouseEvent) => void,
    onPreview: (file: any) => void,
    onToggleIndex: (path: string, active: boolean, isDir?: boolean) => void,
    onFileDrop: (targetFolder: string, files: File[], isCopy: boolean) => void,
    isPrivacyProtected?: boolean, // New Prop
    onTogglePrivacy?: (folder: string, enabled: boolean) => void // New Handler
}> = ({ folder, idx, refreshKey, activeFiles, loadingFiles, setContextMenu, onContextMenu, onPreview, onToggleIndex, onFileDrop, isPrivacyProtected, onTogglePrivacy }) => {
    const [isDragOver, setIsDragOver] = useState(false);

    return (
        <div className="group space-y-0.5">
            <div 
                className={`flex items-center justify-between text-[10px] font-black text-slate-500 uppercase bg-slate-50 p-2 rounded cursor-context-menu transition-all ${isDragOver ? 'ring-2 ring-indigo-400 bg-indigo-50' : 'hover:bg-indigo-50/50'}`}
                onContextMenu={(e) => onContextMenu(folder, e)}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={(e) => {
                    e.preventDefault();
                    setIsDragOver(false);
                    const files = Array.from(e.dataTransfer.files);
                    if (files.length > 0) {
                        const isCopy = e.ctrlKey || e.metaKey; // Windows Ctrl or Mac Cmd
                        onFileDrop(folder, files, isCopy);
                    }
                }}
            >
                <div className="flex items-center gap-2 truncate flex-1">
                    {/* Privacy Shield Icon */}
                    {onTogglePrivacy && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); onTogglePrivacy(folder, !isPrivacyProtected); }}
                            className={`p-1 rounded transition-colors ${isPrivacyProtected ? 'text-green-500 bg-green-50' : 'text-slate-200 hover:text-slate-400'}`}
                            title={isPrivacyProtected ? "隐私保护已开启 (点击关闭)" : "开启隐私保护"}
                        >
                             <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                             </svg>
                        </button>
                    )}
                    <span className={`truncate max-w-[150px] ${isPrivacyProtected ? 'text-green-700 font-bold' : ''}`} title={folder}>{folder.split(/[\\/]/).pop()}</span>
                </div>
                
                {/* Compact Delete Button (visible on hover) */}
                <button 
                    onClick={(e) => { 
                        e.stopPropagation(); 
                        // Position menu near the button
                        const rect = e.currentTarget.getBoundingClientRect();
                        setContextMenu({ visible: true, x: rect.left, y: rect.bottom + 5, targetPath: folder });
                    }} 
                    className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-300 hover:text-red-500 px-1"
                    title="移除挂载"
                >
                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                </button>
            </div>
            <div className="pl-2 border-l border-slate-100 ml-2">
                <FileTree 
                    key={`${folder}-${refreshKey}`}
                    rootPath={folder} 
                    onSelectFile={onPreview}
                    onCheckChange={onToggleIndex}
                    checkedPaths={activeFiles}
                    loadingPaths={loadingFiles}
                />
            </div>
        </div>
    );
};
