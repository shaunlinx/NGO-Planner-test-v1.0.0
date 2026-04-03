import React, { useState, useEffect } from 'react';

interface CloudSyncConfigModalProps {
    onClose: () => void;
    onSave: () => void;
    localPaths: string[];
}

const CloudSyncConfigModal: React.FC<CloudSyncConfigModalProps> = ({ onClose, onSave, localPaths }) => {
    const [provider, setProvider] = useState('jianguoyun');
    const [username, setUsername] = useState('');
    const [token, setToken] = useState('');
    const [targetFolder, setTargetFolder] = useState('/NGO_Backup');
    const [isEnabled, setIsEnabled] = useState(false);
    const [loading, setLoading] = useState(false);
    
    // Encryption State
    const [enableEncryption, setEnableEncryption] = useState(false);
    const [encryptionPassword, setEncryptionPassword] = useState('');

    useEffect(() => {
        // Load existing config
        const loadConfig = async () => {
            // @ts-ignore
            const config = await window.electronAPI.invoke('cloud-sync-get-config', provider);
            if (config) {
                setUsername(config.username || '');
                setTargetFolder(config.target_folder || '/NGO_Backup');
                setIsEnabled(Number(config.is_enabled) === 1);
                // Token is encrypted, don't show or show placeholder
                if (config.encrypted_token) setToken('******');
                
                // Load encryption setting
                if (config.encryption_password) {
                    setEnableEncryption(true);
                    setEncryptionPassword('******');
                } else {
                    setEnableEncryption(false);
                }
            }
        };
        loadConfig();
    }, [provider]);

    const handleSave = async () => {
        setLoading(true);
        try {
            const config: any = {
                username,
                target_folder: targetFolder,
                is_enabled: isEnabled ? 1 : 0,
                sync_frequency: 'manual'
            };
            if (token && token !== '******') {
                config.token = token;
            }
            
            // Handle Encryption Password
            if (enableEncryption) {
                if (encryptionPassword && encryptionPassword !== '******') {
                    config.encryption_password = encryptionPassword;
                } else if (!encryptionPassword) {
                    // Enabled but no password provided (and not placeholder)
                    alert('请输入加密密码');
                    setLoading(false);
                    return;
                }
            } else {
                config.encryption_password = null; // Clear password if disabled
            }

            // @ts-ignore
            const res = await window.electronAPI.invoke('cloud-sync-save-config', { type: provider, config });
            if (res.success) {
                alert('配置已保存');
                onSave();
                onClose();
            } else {
                alert('保存失败: ' + res.error);
            }
        } catch (e) {
            console.error(e);
            alert('保存出错');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
                <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                    <h3 className="font-bold text-slate-700 flex items-center gap-2">
                        <span>☁️</span> 云同步配置
                    </h3>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-600">×</button>
                </div>
                
                <div className="p-6 space-y-4 overflow-y-auto">
                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">本地目录 ({localPaths.length})</label>
                        <div className="text-xs bg-slate-100 p-2 rounded text-slate-600 break-all font-mono max-h-24 overflow-y-auto">
                            {localPaths.map(p => <div key={p}>{p}</div>)}
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-500 mb-1">云服务商</label>
                        <select 
                            value={provider} 
                            onChange={e => setProvider(e.target.value)}
                            className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-100 bg-white"
                        >
                            <option value="jianguoyun">坚果云 (WebDAV)</option>
                            <option value="baidu" disabled>百度网盘 (Coming Soon)</option>
                            <option value="feishu" disabled>飞书云盘 (Coming Soon)</option>
                        </select>
                    </div>

                    <div className="space-y-3 p-4 bg-slate-50 rounded-xl border border-slate-100">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">账号 / 邮箱</label>
                            <input 
                                type="text"
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-100"
                                placeholder="请输入坚果云账号"
                            />
                        </div>
                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="block text-xs font-bold text-slate-500">应用密码 / Token</label>
                                <a 
                                    href="https://www.jianguoyun.com/d/account#safe" 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-[10px] text-indigo-500 hover:text-indigo-700 underline flex items-center gap-1"
                                >
                                    <span>🔑 如何获取？</span>
                                </a>
                            </div>
                            <input 
                                type="password"
                                value={token}
                                onChange={e => setToken(e.target.value)}
                                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-100"
                                placeholder="请输入应用专用密码 (非登录密码)"
                            />
                            <p className="text-[10px] text-slate-400 mt-1">
                                * 为了安全，请使用坚果云生成的应用专用密码
                            </p>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">云端目标路径</label>
                            <input 
                                type="text"
                                value={targetFolder}
                                onChange={e => setTargetFolder(e.target.value)}
                                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-indigo-100"
                                placeholder="/NGO_Backup"
                            />
                        </div>
                    </div>

                    {/* Encryption Config */}
                    <div className="p-4 bg-orange-50 rounded-xl border border-orange-100 space-y-3">
                        <div className="flex items-center justify-between">
                            <h4 className="text-xs font-bold text-orange-800 flex items-center gap-1">
                                🔒 云端文件加密
                            </h4>
                            <button 
                                onClick={() => setEnableEncryption(!enableEncryption)}
                                className={`w-10 h-5 rounded-full transition-colors relative ${enableEncryption ? 'bg-orange-500' : 'bg-slate-300'}`}
                            >
                                <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-transform ${enableEncryption ? 'left-6' : 'left-1'}`} />
                            </button>
                        </div>
                        
                        {enableEncryption && (
                            <div className="animate-fade-in">
                                <label className="block text-[10px] font-bold text-orange-700 mb-1">
                                    自定义解密密码 (云端查看时需要)
                                </label>
                                <input 
                                    type="password"
                                    value={encryptionPassword}
                                    onChange={e => setEncryptionPassword(e.target.value)}
                                    className="w-full text-sm border border-orange-200 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-orange-200"
                                    placeholder="设置密码，文件将打包为加密ZIP上传"
                                />
                                <p className="text-[9px] text-orange-600 mt-1 leading-relaxed">
                                    开启后，所有文件将在本地打包为 <strong>加密的 ZIP 压缩包</strong> 再上传。
                                    在网盘中下载或预览时，需要输入此密码才能解压查看。
                                </p>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center justify-between pt-2">
                        <span className="text-sm font-bold text-slate-600">启用同步</span>
                        <button 
                            onClick={() => setIsEnabled(!isEnabled)}
                            className={`w-12 h-6 rounded-full transition-colors relative ${isEnabled ? 'bg-indigo-500' : 'bg-slate-300'}`}
                        >
                            <div className={`absolute top-1 w-4 h-4 bg-white rounded-full transition-transform ${isEnabled ? 'left-7' : 'left-1'}`} />
                        </button>
                    </div>
                </div>

                <div className="p-4 border-t border-slate-100 flex justify-end gap-3 bg-slate-50">
                    <button 
                        onClick={onClose}
                        className="px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-200 rounded-lg transition-colors"
                    >
                        取消
                    </button>
                    <button 
                        onClick={handleSave}
                        disabled={loading}
                        className="px-6 py-2 text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg shadow-lg shadow-indigo-200 transition-all disabled:opacity-50 flex items-center gap-2"
                    >
                        {loading && <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                        保存配置
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CloudSyncConfigModal;
