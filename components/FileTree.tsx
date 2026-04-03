import React, { useState, useEffect } from 'react';

interface FileNode {
    name: string;
    path: string;
    isDirectory: boolean;
    size: number;
    mtime: Date;
    children?: FileNode[];
}

interface FileTreeProps {
    rootPath: string;
    onSelectFile: (file: FileNode) => void;
    onCheckChange?: (path: string, checked: boolean) => void;
    checkedPaths?: Set<string>;
}

const getFileIcon = (fileName: string) => {
    const ext = fileName.split('.').pop()?.toLowerCase();
    switch(ext) {
        case 'pdf': return '📄';
        case 'doc': case 'docx': return '📝';
        case 'xls': case 'xlsx': case 'csv': return '📊';
        case 'ppt': case 'pptx': return '📽️';
        case 'jpg': case 'jpeg': case 'png': return '🖼️';
        case 'txt': case 'md': return '📃';
        default: return '📄';
    }
};

interface FileTreeNodeProps { 
    node: FileNode; 
    level: number; 
    onSelect: (file: FileNode) => void;
    onCheckChange?: (path: string, checked: boolean, isDirectory: boolean) => void;
    checkedPaths?: Set<string>;
    loadingPaths?: Set<string>;
    defaultExpanded?: boolean; 
}

const FileTreeNode: React.FC<FileTreeNodeProps> = ({ node, level, onSelect, onCheckChange, checkedPaths, loadingPaths, defaultExpanded }) => {
    const [expanded, setExpanded] = useState(defaultExpanded || false);
    const [children, setChildren] = useState<FileNode[]>([]);
    const [loading, setLoading] = useState(false);
    const [loaded, setLoaded] = useState(false); 

    // IMPROVED: Check logic handles "Implicit Check" (Inherited from parent)
    // If a parent folder path is in checkedPaths, then this child is visually checked.
    const isExplicitlyChecked = checkedPaths?.has(node.path);
    const isInheritedChecked = checkedPaths ? Array.from(checkedPaths).some(p => node.path.startsWith(p) && (node.path[p.length] === '/' || node.path[p.length] === '\\')) : false;
    const isChecked = isExplicitlyChecked || isInheritedChecked;

    const isIngesting = loadingPaths?.has(node.path);

    const loadChildren = async () => {
        if (!window.electronAPI) return;
        setLoading(true);
        // console.log(`[FileTree] Reading dir: ${node.path}`);
        try {
            const entries = await window.electronAPI.fs.readDir(node.path);
            // console.log(`[FileTree] Found ${entries.length} entries in ${node.path}`);
            // Filter out hidden files
            setChildren(entries.filter(e => !e.name.startsWith('.')));
            setLoaded(true);
        } catch (e) {
            console.error(`[FileTree] Failed to read dir ${node.path}`, e);
        } finally {
            setLoading(false);
        }
    };

    // Auto-load if defaultExpanded is true and not loaded
    useEffect(() => {
        if (defaultExpanded && !loaded && node.isDirectory) {
            loadChildren();
        }
    }, [defaultExpanded, loaded, node.isDirectory]);

    const handleExpand = async () => {
        if (!node.isDirectory) return;
        setExpanded(!expanded);
        if (!expanded && !loaded) { // Load if expanding and not loaded
            loadChildren();
        }
    };

    return (
        <div>
            <div 
                className={`flex items-center gap-1.5 py-0.5 px-1.5 hover:bg-slate-100 rounded cursor-pointer transition-colors text-[11px] ${level === 0 ? 'font-bold' : ''}`}
                style={{ paddingLeft: `${level * 10 + 6}px` }}
                onClick={() => node.isDirectory ? handleExpand() : onSelect(node)}
            >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    {/* ... (arrows and spacers) ... */}
                    {node.isDirectory && (
                        <span className={`text-slate-400 transform transition-transform ${expanded ? 'rotate-90' : ''}`}>
                            ▶
                        </span>
                    )}
                    {!node.isDirectory && <span className="w-3"></span>}
                    
                    {onCheckChange && (
                        <div className="relative flex items-center justify-center w-4 h-4 shrink-0">
                            {isIngesting ? (
                                <span className="absolute animate-spin block w-3 h-3 border-2 border-indigo-500 border-t-transparent rounded-full"></span>
                            ) : (
                                <input 
                                    type="checkbox" 
                                    checked={isChecked}
                                    onChange={(e) => onCheckChange(node.path, e.target.checked, node.isDirectory)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-4 h-4 cursor-pointer"
                                />
                            )}
                        </div>
                    )}
                    
                    {/* ... (rest of the render) ... */}
                    
                    <span className="shrink-0">{node.isDirectory ? '📁' : getFileIcon(node.name)}</span>
                    <span className={`truncate ${node.isDirectory ? 'text-indigo-900' : 'text-slate-600'}`}>
                        {node.name}
                    </span>
                </div>
                
                {!node.isDirectory && (
                    <button 
                        onClick={(e) => { e.stopPropagation(); onSelect(node); }}
                        className="text-[10px] text-slate-400 hover:text-indigo-600 px-1.5"
                    >
                        预览
                    </button>
                )}
            </div>
            
            {expanded && (
                <div>
                    {loading ? (
                        <div className="pl-8 py-1 text-xs text-slate-400">加载中...</div>
                    ) : (
                        children.map(child => (
                            <FileTreeNode 
                                key={child.path} 
                                node={child} 
                                level={level + 1} 
                                onSelect={onSelect} 
                                onCheckChange={onCheckChange}
                                checkedPaths={checkedPaths}
                                loadingPaths={loadingPaths}
                            />
                        ))
                    )}
                    {children.length === 0 && !loading && (
                        <div className="pl-8 py-1 text-xs text-slate-300">（空文件夹）</div>
                    )}
                </div>
            )}
        </div>
    );
};

export const FileTree: React.FC<FileTreeProps & { loadingPaths?: Set<string> }> = ({ rootPath, onSelectFile, onCheckChange, checkedPaths, loadingPaths }) => {
    const [rootNode, setRootNode] = useState<FileNode | null>(null);

    useEffect(() => {
        if (rootPath) {
            setRootNode({
                name: rootPath.split(/[\\/]/).pop() || 'Root',
                path: rootPath,
                isDirectory: true,
                size: 0,
                mtime: new Date()
            });
        }
    }, [rootPath]);

    if (!rootNode) return null;

    return (
        <div className="border border-slate-100 rounded-xl bg-white overflow-hidden">
            <FileTreeNode 
                node={rootNode} 
                level={0} 
                onSelect={onSelectFile} 
                onCheckChange={onCheckChange}
                checkedPaths={checkedPaths}
                loadingPaths={loadingPaths}
                defaultExpanded={true} // Always expand root
            />
        </div>
    );
};
