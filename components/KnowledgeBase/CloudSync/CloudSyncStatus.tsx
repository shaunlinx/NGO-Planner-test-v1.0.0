import React, { useState } from 'react';
import CloudSyncConfigModal from './CloudSyncConfigModal';

interface CloudSyncStatusProps {
    localPaths: string[];
}

const CloudSyncStatus: React.FC<CloudSyncStatusProps> = ({ localPaths }) => {
    const [showConfig, setShowConfig] = useState(false);
    const [isSyncing, setIsSyncing] = useState(false);
    const [isPulling, setIsPulling] = useState(false);

    const handleSync = async () => {
        if (isSyncing) return;
        if (localPaths.length === 0) {
            alert('没有挂载的目录可供同步');
            return;
        }

        setIsSyncing(true);
        try {
            // Check config first (implicitly done by first call)
            // Loop through all paths
            let successCount = 0;
            let totalFiles = 0;
            let errorMsg = '';

            for (const path of localPaths) {
                // @ts-ignore
                const res = await window.electronAPI.invoke('cloud-sync-start', { 
                    localPath: path, 
                    cloudType: 'jianguoyun'
                });

                if (!res.success) {
                    console.error("Sync failed for", path, res.error); // Add logging
                    
                    // Check various error messages that indicate missing config
                    if (res.error && (
                        res.error.includes('disabled') || 
                        res.error.includes('not configured') ||
                        res.error.includes('Invalid sync parameters')
                    )) {
                        setShowConfig(true);
                        errorMsg = 'Need Config';
                        break; // Stop and show config
                    } else {
                        // Don't treat other errors as "Need Config"
                        errorMsg = res.error;
                    }
                } else {
                    successCount++;
                    totalFiles += (res.results?.length || 0);
                }
            }

            if (errorMsg === 'Need Config') {
                // Modal already opened
            } else if (errorMsg) {
                alert(`同步部分失败: ${errorMsg}`);
            } else {
                 alert(`同步完成！${totalFiles} 个文件已更新。`);
            }
        } catch (e) {
            console.error(e);
            alert('同步出错');
        } finally {
            setIsSyncing(false);
        }
    };

    const handlePull = async () => {
        if (isPulling) return;
        if (localPaths.length === 0) {
            alert('没有挂载的目录可供拉取');
            return;
        }

        setIsPulling(true);
        try {
            let downloadedCount = 0;
            let conflictCount = 0;
            let errorMsg = '';

            for (const path of localPaths) {
                // @ts-ignore
                const res = await window.electronAPI.invoke('cloud-sync-pull', { 
                    localPath: path, 
                    cloudType: 'jianguoyun'
                });

                if (!res.success) {
                    console.error("Pull failed for", path, res.error);
                    if (res.error && (
                        res.error.includes('disabled') || 
                        res.error.includes('not configured') ||
                        res.error.includes('Invalid sync parameters')
                    )) {
                        setShowConfig(true);
                        errorMsg = 'Need Config';
                        break;
                    } else {
                        errorMsg = res.error;
                    }
                } else {
                    downloadedCount += (res.downloaded?.length || 0);
                    conflictCount += (res.conflicts?.length || 0);
                }
            }

            if (errorMsg === 'Need Config') {
            } else if (errorMsg) {
                alert(`拉取部分失败: ${errorMsg}`);
            } else {
                alert(`拉取完成！新增 ${downloadedCount} 个文件${conflictCount ? `，冲突副本 ${conflictCount} 个` : ''}。`);
            }
        } catch (e) {
            console.error(e);
            alert('拉取出错');
        } finally {
            setIsPulling(false);
        }
    };

    return (
        <div className="flex items-center gap-1">
            <button 
                onClick={handleSync}
                className={`text-[10px] transition-colors flex items-center gap-1 ${isSyncing ? 'text-indigo-600' : 'text-slate-400 hover:text-indigo-600'}`}
                title="点击立即同步所有挂载目录"
            >
                {isSyncing ? (
                    <>
                        <div className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                        <span>同步中...</span>
                    </>
                ) : (
                    <>
                        <span>☁️</span>
                        <span>云同步</span>
                    </>
                )}
            </button>

            <button 
                onClick={handlePull}
                className={`text-[10px] transition-colors flex items-center gap-1 ${isPulling ? 'text-indigo-600' : 'text-slate-400 hover:text-indigo-600'}`}
                title="从云端拉取新增文件到本地（不删除本地文件）"
            >
                {isPulling ? (
                    <>
                        <div className="w-3 h-3 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                        <span>拉取中...</span>
                    </>
                ) : (
                    <>
                        <span>⬇️</span>
                        <span>拉取</span>
                    </>
                )}
            </button>
            
            <button 
                onClick={(e) => { e.stopPropagation(); setShowConfig(true); }}
                className="text-[10px] text-slate-300 hover:text-slate-500 opacity-50 hover:opacity-100 transition-opacity"
                title="配置云同步"
            >
                ⚙️
            </button>

            {showConfig && (
                <CloudSyncConfigModal 
                    localPaths={localPaths} 
                    onClose={() => setShowConfig(false)}
                    onSave={() => {}} 
                />
            )}
        </div>
    );
};

export default CloudSyncStatus;
