import React, { useState } from 'react';

export const AIMigrationModal: React.FC<{
    onClose: () => void,
    onMount: (path: string) => void
}> = ({ onClose, onMount }) => {
    const [step, setStep] = useState<'upload' | 'analyzing' | 'review' | 'executing'>('upload');
    const [sourceFiles, setSourceFiles] = useState<string[]>([]);
    const [structure, setStructure] = useState<any>(null);
    const [instruction, setInstruction] = useState('');
    const [targetPath, setTargetPath] = useState('');
    const [executionLog, setExecutionLog] = useState<string[]>([]);

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        
        // @ts-ignore
        if (!window.electronAPI) return;

        const files = Array.from(e.dataTransfer.files).map(f => f.path);
        setSourceFiles(prev => [...new Set([...prev, ...files])]);
    };

    const handleAnalyze = async () => {
        if (sourceFiles.length === 0) return;
        setStep('analyzing');
        
        try {
            const fileList = sourceFiles.map(p => p.split(/[\\/]/).pop() || '');
            
            // @ts-ignore
            const res = await window.electronAPI.knowledge.proposeStructure({
                files: fileList,
                instruction
            });
            
            if (res.success) {
                setStructure(res.structure);
                setStep('review');
            } else {
                alert("分析失败: " + res.error);
                setStep('upload');
            }
        } catch (e: any) {
            alert("错误: " + e.message);
            setStep('upload');
        }
    };

    const handleExecute = async () => {
        if (!structure) return;
        
        // @ts-ignore
        const parentPath = await window.electronAPI.fs.selectFolder();
        if (!parentPath) return;
        
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const smartFolderName = `Smart_Knowledge_Base_${timestamp}`;
        const targetPath = `${parentPath}/${smartFolderName}`; 
        
        setTargetPath(targetPath);
        setStep('executing');
        setExecutionLog(prev => [...prev, `目标父目录: ${parentPath}`]);
        setExecutionLog(prev => [...prev, `创建智能文件夹: ${smartFolderName}`]);

        const fileMap: Record<string, string> = {}; 
        
        setExecutionLog(prev => [...prev, "正在索引源文件..."]);
        
        const scan = async (path: string) => {
            // @ts-ignore
            const items = await window.electronAPI.fs.readDir(path);
            if (items.length === 0) {
                const name = path.split(/[\\/]/).pop() || '';
                fileMap[name] = path;
            } else {
                for (const item of items) {
                    if (item.isDirectory) {
                        await scan(item.path);
                    } else {
                        fileMap[item.name] = item.path;
                    }
                }
            }
        };
        
        for (const src of sourceFiles) {
            await scan(src);
        }
        
        setExecutionLog(prev => [...prev, `索引完成，共找到 ${Object.keys(fileMap).length} 个文件`]);

        const createTree = async (node: any, currentPath: string) => {
            // @ts-ignore
            await window.electronAPI.fs.ensureDir(currentPath);
            
            for (const key in node) {
                const value = node[key];
                if (Array.isArray(value)) {
                    const folderPath = `${currentPath}/${key}`;
                    // @ts-ignore
                    await window.electronAPI.fs.ensureDir(folderPath);
                    
                    for (const filename of value) {
                        const srcPath = fileMap[filename];
                        if (srcPath) {
                            const isWin = navigator.userAgent.includes('Win');
                            try {
                                if (isWin) {
                                     const destPath = `${folderPath}/${filename}.lnk`;
                                     // @ts-ignore
                                     const res = await window.electronAPI.fs.createShortcut(srcPath, destPath);
                                     if (!res.success) throw new Error(res.error);
                                     setExecutionLog(prev => [...prev, `✅ 快捷方式: ${filename}`]);
                                } else {
                                     const destPath = `${folderPath}/${filename}`;
                                     // @ts-ignore
                                     const res = await window.electronAPI.fs.createSymlink(srcPath, destPath);
                                     if (!res.success) throw new Error(res.error);
                                     setExecutionLog(prev => [...prev, `✅ 链接: ${filename}`]);
                                }
                            } catch (e: any) {
                                setExecutionLog(prev => [...prev, `❌ 失败 ${filename}: ${e.message}`]);
                            }
                        } else {
                            setExecutionLog(prev => [...prev, `⚠️ 未找到源文件: ${filename}`]);
                        }
                    }
                } else if (typeof value === 'object') {
                    await createTree(value, `${currentPath}/${key}`);
                }
            }
        };

        try {
            await createTree(structure, targetPath);
            setExecutionLog(prev => [...prev, "🎉 迁移完成！"]);
            
            onMount(targetPath);
            
            setTimeout(() => {
                onClose();
                alert(`智能文件夹已创建并挂载！\n位置: ${targetPath}`);
            }, 1000);
        } catch (e: any) {
            setExecutionLog(prev => [...prev, `🔥 致命错误: ${e.message}`]);
        }
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-slate-50/50">
            <div className="p-6 border-b border-slate-100 bg-white flex justify-between items-center">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl flex items-center justify-center text-white text-2xl shadow-lg">
                        🤖
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-800 text-xl">AI 文件迁移助手</h3>
                        <p className="text-sm text-slate-500">智能重组文件夹结构 (创建快捷方式，不占用额外空间)</p>
                    </div>
                </div>
                <button onClick={onClose} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200 font-bold text-xs transition-all">
                    关闭助手
                </button>
            </div>

            <div className="flex-1 overflow-hidden flex flex-col p-8">
                {step === 'upload' && (
                    <div 
                        className="flex-1 border-3 border-dashed border-indigo-200 rounded-3xl bg-white flex flex-col items-center justify-center transition-all hover:border-indigo-400 hover:bg-indigo-50/30 relative shadow-sm"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleDrop}
                    >
                        {sourceFiles.length === 0 ? (
                            <div className="text-center p-10">
                                <div className="text-6xl mb-6 animate-bounce">📂</div>
                                <h2 className="text-xl font-bold text-slate-700 mb-2">拖入源文件夹或文件到此处</h2>
                                <p className="text-slate-400">支持批量拖入多个文件夹，AI 将自动分析并建议新的分类结构</p>
                            </div>
                        ) : (
                            <div className="w-full h-full p-6 flex flex-col">
                                <div className="flex justify-between items-center mb-4">
                                    <h4 className="font-bold text-slate-700">已添加 ({sourceFiles.length})</h4>
                                    <button onClick={() => setSourceFiles([])} className="text-red-400 hover:text-red-600 text-xs">清空列表</button>
                                </div>
                                <div className="flex-1 overflow-y-auto bg-slate-50 rounded-xl p-4 border border-slate-100">
                                    <ul className="space-y-2">
                                        {sourceFiles.map((f, i) => (
                                            <li key={i} className="text-sm text-slate-600 bg-white px-3 py-2 rounded-lg border border-slate-200 truncate flex items-center gap-2">
                                                <span>📄</span> {f}
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                        )}
                        
                        {sourceFiles.length > 0 && (
                            <div className="absolute bottom-8 flex gap-4">
                                <button 
                                    onClick={handleAnalyze}
                                    className="px-8 py-3 bg-indigo-600 text-white rounded-xl text-lg font-bold shadow-xl hover:bg-indigo-700 hover:scale-105 transition-all flex items-center gap-2"
                                >
                                    <span>⚡️</span> 开始智能分析
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {step === 'analyzing' && (
                    <div className="flex-1 flex flex-col items-center justify-center bg-white rounded-3xl border border-slate-100 shadow-sm">
                        <div className="w-24 h-24 border-4 border-indigo-100 border-t-indigo-600 rounded-full animate-spin mb-8"></div>
                        <h3 className="text-2xl font-bold text-slate-800 mb-2">AI 正在分析文件特征...</h3>
                        <p className="text-slate-500">正在构建最佳分类树，请稍候</p>
                    </div>
                )}

                {step === 'review' && (
                    <div className="flex-1 flex flex-col gap-6 h-full">
                        <div className="flex items-center gap-3 bg-yellow-50 p-4 rounded-xl border border-yellow-100 text-yellow-800 shadow-sm">
                            <span className="text-xl">💡</span>
                            <span className="font-bold">您可以编辑下方的 JSON 结构来调整分类，或者输入指令重新生成。</span>
                        </div>
                        <div className="flex-1 flex gap-6 min-h-0">
                            <div className="flex-1 flex flex-col">
                                <label className="text-xs font-bold text-slate-400 mb-2 uppercase">分类结构预览 (JSON)</label>
                                <textarea 
                                    className="flex-1 bg-slate-900 text-green-400 border border-slate-800 rounded-2xl p-6 font-mono text-sm outline-none focus:border-indigo-500 resize-none shadow-inner"
                                    value={JSON.stringify(structure, null, 2)}
                                    onChange={(e) => {
                                        try { setStructure(JSON.parse(e.target.value)); } catch (err) {}
                                    }}
                                />
                            </div>
                            <div className="w-80 flex flex-col gap-4">
                                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                                    <label className="text-xs font-bold text-slate-400 mb-2 uppercase block">调整指令</label>
                                    <textarea 
                                        className="w-full h-32 bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm outline-none focus:border-indigo-500 mb-2 resize-none"
                                        placeholder="例如: '按年份归档' 或 '把图片单独放'..."
                                        value={instruction}
                                        onChange={e => setInstruction(e.target.value)}
                                    />
                                    <button 
                                        onClick={handleAnalyze}
                                        className="w-full py-2 bg-slate-100 text-slate-600 rounded-xl text-sm font-bold hover:bg-slate-200 transition-all"
                                    >
                                        🔄 重新生成
                                    </button>
                                </div>
                                <div className="mt-auto">
                                    <button 
                                        onClick={handleExecute}
                                        className="w-full py-4 bg-green-600 text-white rounded-2xl font-bold text-lg shadow-lg hover:bg-green-700 transition-all flex items-center justify-center gap-2 hover:scale-[1.02]"
                                    >
                                        ✅ 确认并创建
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {step === 'executing' && (
                    <div className="flex-1 flex flex-col bg-slate-900 rounded-3xl p-6 overflow-hidden font-mono text-sm shadow-2xl border border-slate-800">
                        <div className="flex-1 overflow-y-auto space-y-2 font-mono">
                            {executionLog.map((log, i) => (
                                <div key={i} className={log.startsWith('❌') || log.startsWith('🔥') ? 'text-red-400' : log.startsWith('✅') ? 'text-green-400' : 'text-slate-400'}>
                                    {log}
                                </div>
                            ))}
                        </div>
                        {targetPath && executionLog.length > 0 && !executionLog.some(l => l.includes('完成')) && (
                            <div className="mt-4 flex items-center gap-3 text-indigo-400 pt-4 border-t border-slate-800">
                                <span className="animate-spin text-xl">⏳</span> <span className="font-bold">正在处理文件链接...</span>
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
