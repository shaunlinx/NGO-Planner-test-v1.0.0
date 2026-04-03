import React, { useState, useEffect } from 'react';

interface WechatAccount {
    id: string;
    name: string;
    preview_openid?: string;
    created_at: number;
}

interface WechatDraft {
    id: string;
    account_id: string;
    title: string;
    author: string;
    digest: string;
    content: string;
    thumb_url: string; // Local path or URL
    thumb_media_id?: string;
    status: 'local' | 'uploaded' | 'published';
    media_id?: string;
    updated_at: number;
}

const CommunityManager: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'dashboard' | 'accounts' | 'editor' | 'create'>('dashboard');
    const [accounts, setAccounts] = useState<WechatAccount[]>([]);
    const [drafts, setDrafts] = useState<WechatDraft[]>([]);
    const [loading, setLoading] = useState(false);
    const [editingDraft, setEditingDraft] = useState<WechatDraft | null>(null);

    // AI Creation states
    const [creationForm, setCreationForm] = useState({
        topic: '',
        style: '专业权威',
        references: '',
        useKb: true,
        useSearch: false
    });
    const [isCreating, setIsCreating] = useState(false);
    const [creationLogs, setCreationLogs] = useState<string[]>([]);

    // Form states
    const [newAccount, setNewAccount] = useState({ appId: '', appSecret: '', name: '', previewOpenId: '' });

    const invoke = (channel: string, ...args: any[]) => (window as any).electronAPI?.invoke?.(channel, ...args);
    const runAgent = (msg: string) => (window as any).electronAPI?.openclaw?.runAgentMessage?.(msg);

    const loadData = async () => {
        setLoading(true);
        try {
            const accs = await invoke('social-wechat-get-accounts');
            setAccounts(accs || []);
            const drfs = await invoke('social-wechat-get-drafts');
            setDrafts(drfs || []);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadData();
    }, []);

    // ... (keep existing handlers)

    const handleStartCreation = async () => {
        if (!creationForm.topic) {
            alert('请输入创作主题');
            return;
        }
        setIsCreating(true);
        setCreationLogs(prev => [...prev, '正在初始化 AI 创作任务...']);

        const prompt = `
任务：为我创作一篇微信公众号文章。

主题：${creationForm.topic}
风格：${creationForm.style}
参考资料：
${creationForm.references}

执行步骤：
1. ${creationForm.useKb ? '使用工具 `/skills/kb/query` 查询关于该主题的背景知识和事实数据。' : '跳过知识库查询。'}
2. 基于查询结果和参考资料，撰写文章初稿。要求：
   - 标题吸引人，符合微信公众号调性。
   - 正文使用 HTML 格式，排版美观（使用 <h2>, <p>, <ul>, <strong> 等标签）。
   - 摘要控制在 50 字以内。
3. 如果需要配图，请在正文中插入 [图片: 描述] 占位符。
4. 调用工具 \`/skills/social/draft\` 保存草稿。参数：
   - title: 文章标题
   - content: HTML 正文
   - digest: 摘要
   - author: AI助手
   - status: 'local'
   - account_id: ${accounts[0]?.id || ''}

请直接执行，完成后告知我“草稿已保存”。

5. 使用工具 \`/skills/social/draft\` 保存草稿时，必须使用 JSON 格式：
   { "path": "/skills/social/draft", "body": { "title": "...", "content": "...", "digest": "...", "author": "AI", "account_id": "${accounts[0]?.id || ''}" } }
        `.trim();

        try {
            await runAgent(prompt);
            setCreationLogs(prev => [...prev, '指令已发送给 OpenClaw，正在执行...']);
            
            // Poll for drafts to see if a new one appears
            let checks = 0;
            const interval = setInterval(async () => {
                checks++;
                if (checks > 30) { // 30 * 2s = 60s timeout for auto-check
                    clearInterval(interval);
                    setCreationLogs(prev => [...prev, '检测超时，请手动刷新看板查看结果。']);
                    setIsCreating(false);
                    return;
                }
                
                try {
                    const currentDrafts = await invoke('social-wechat-get-drafts');
                    if (currentDrafts && currentDrafts.length > drafts.length) {
                        // Found new draft!
                        clearInterval(interval);
                        setDrafts(currentDrafts);
                        setCreationLogs(prev => [...prev, '🎉 草稿已生成！正在跳转...']);
                        setTimeout(() => {
                            setIsCreating(false);
                            setActiveTab('dashboard');
                        }, 1000);
                    }
                } catch(e) {}
            }, 2000);

        } catch (e: any) {
            setCreationLogs(prev => [...prev, `错误: ${e.message}`]);
            setIsCreating(false);
        }
    };

    const renderCreationWizard = () => (
        <div className="flex h-full gap-6">
            <div className="w-1/2 bg-white p-6 rounded-2xl border border-slate-200 flex flex-col">
                <h3 className="text-lg font-black text-slate-800 mb-4">AI 创作向导</h3>
                <div className="space-y-4 flex-1 overflow-y-auto">
                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">创作主题 <span className="text-red-500">*</span></label>
                        <input 
                            className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-100"
                            placeholder="例如：2024年环保公益项目总结"
                            value={creationForm.topic}
                            onChange={e => setCreationForm({...creationForm, topic: e.target.value})}
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">文章风格</label>
                        <select 
                            className="w-full px-4 py-2 border border-slate-200 rounded-lg text-sm outline-none"
                            value={creationForm.style}
                            onChange={e => setCreationForm({...creationForm, style: e.target.value})}
                        >
                            <option value="专业权威">专业权威（适合报告、分析）</option>
                            <option value="轻松活泼">轻松活泼（适合活动回顾、互动）</option>
                            <option value="感人故事">感人故事（适合人物专访、案例）</option>
                            <option value="简洁明了">简洁明了（适合通知、公告）</option>
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-600 mb-1">参考资料 / 上下文</label>
                        <textarea 
                            className="w-full h-32 p-3 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-100 resize-none"
                            placeholder="粘贴参考文本、URL或简要说明..."
                            value={creationForm.references}
                            onChange={e => setCreationForm({...creationForm, references: e.target.value})}
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm font-bold text-slate-700 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={creationForm.useKb} 
                                onChange={e => setCreationForm({...creationForm, useKb: e.target.checked})}
                                className="w-4 h-4 text-indigo-600 rounded"
                            />
                            调用知识库 (RAG)
                        </label>
                        <p className="text-xs text-slate-400 pl-6">自动检索本地知识库中的相关事实与数据</p>
                    </div>
                </div>
                <div className="pt-4 mt-4 border-t border-slate-100">
                    <button 
                        onClick={handleStartCreation} 
                        disabled={isCreating}
                        className={`w-full py-3 rounded-xl text-sm font-black text-white shadow-lg transition-all ${isCreating ? 'bg-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:shadow-xl hover:scale-[1.02]'}`}
                    >
                        {isCreating ? 'AI 正在思考与创作...' : '✨ 开始生成草稿'}
                    </button>
                </div>
            </div>

            <div className="w-1/2 bg-slate-900 p-6 rounded-2xl border border-slate-800 flex flex-col text-slate-300 font-mono text-xs">
                <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
                    执行日志
                </h3>
                <div className="flex-1 overflow-y-auto space-y-2">
                    {creationLogs.map((log, idx) => (
                        <div key={idx} className="border-l-2 border-slate-700 pl-3 py-1">
                            <span className="text-slate-500">[{new Date().toLocaleTimeString()}]</span> {log}
                        </div>
                    ))}
                    {creationLogs.length === 0 && <div className="text-slate-600 italic">等待任务开始...</div>}
                </div>
            </div>
        </div>
    );


    const handleAddAccount = async () => {
        if (!newAccount.appId || !newAccount.appSecret || !newAccount.name) return;
        try {
            const res = await invoke('social-wechat-add-account', newAccount);
            if (res.success) {
                setNewAccount({ appId: '', appSecret: '', name: '', previewOpenId: '' });
                loadData();
            } else {
                alert('添加失败: ' + res.error);
            }
        } catch (e) {
            alert('添加失败');
        }
    };

    const handleDeleteAccount = async (id: string) => {
        if (!confirm('确定删除该账号吗？')) return;
        await invoke('social-wechat-delete-account', id);
        loadData();
    };

    const handleSaveDraft = async () => {
        if (!editingDraft) return;
        try {
            const res = await invoke('social-wechat-save-draft', editingDraft);
            if (res.success) {
                setEditingDraft(null);
                setActiveTab('dashboard');
                loadData();
            } else {
                alert('保存失败: ' + res.error);
            }
        } catch (e) {
            alert('保存失败');
        }
    };

    const handleCreateDraft = () => {
        if (accounts.length === 0) {
            alert('请先添加公众号账号');
            setActiveTab('accounts');
            return;
        }
        const newDraft: WechatDraft = {
            id: `draft-${Date.now()}`,
            account_id: accounts[0].id,
            title: '新文章',
            author: 'AI助手',
            digest: '',
            content: '',
            thumb_url: '',
            status: 'local',
            updated_at: Date.now()
        };
        setEditingDraft(newDraft);
        setActiveTab('editor');
    };

    const handleEditDraft = (draft: WechatDraft) => {
        setEditingDraft({ ...draft });
        setActiveTab('editor');
    };

    const handleDeleteDraft = async (id: string) => {
        if (!confirm('确定删除该草稿吗？')) return;
        await invoke('social-wechat-delete-draft', id);
        loadData();
    };

    const handleUploadDraft = async (draft: WechatDraft) => {
        if (!confirm('确定上传到微信草稿箱吗？')) return;
        setLoading(true);
        try {
            const res = await invoke('social-wechat-upload-draft', { appId: draft.account_id, draftId: draft.id });
            if (res.success) {
                alert('上传成功！MediaId: ' + res.media_id);
                loadData();
            } else {
                alert('上传失败: ' + res.error);
            }
        } catch (e) {
            alert('上传失败');
        } finally {
            setLoading(false);
        }
    };

    const handlePublishDraft = async (draft: WechatDraft) => {
        if (!draft.media_id) {
            alert('请先上传到草稿箱');
            return;
        }
        if (!confirm('确定正式发布吗？此操作不可撤销！')) return;
        setLoading(true);
        try {
            const res = await invoke('social-wechat-publish', { appId: draft.account_id, mediaId: draft.media_id });
            if (res.success) {
                alert('发布成功！PublishId: ' + res.publish_id);
                loadData();
            } else {
                alert('发布失败: ' + res.error);
            }
        } catch (e) {
            alert('发布失败');
        } finally {
            setLoading(false);
        }
    };

    const handleSendPreview = async (draft: WechatDraft) => {
        const account = accounts.find(a => a.id === draft.account_id);
        if (!account?.preview_openid) {
            alert('该账号未配置预览OpenID，请先在账号管理中设置。');
            return;
        }
        setLoading(true);
        try {
            const res = await invoke('social-wechat-send-preview', { 
                appId: draft.account_id, 
                draftId: draft.id,
                openId: account.preview_openid 
            });
            if (res.success) {
                alert('预览发送成功！请查看微信消息。');
            } else {
                alert('发送失败: ' + res.error);
            }
        } catch (e) {
            alert('发送失败');
        } finally {
            setLoading(false);
        }
    };

    const renderDashboard = () => (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-slate-800">内容看板</h2>
                <button onClick={handleCreateDraft} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700">新建图文</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {drafts.map(draft => (
                    <div key={draft.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-shadow">
                        <div className="flex items-start justify-between mb-2">
                            <span className={`px-2 py-1 rounded text-xs font-bold ${
                                draft.status === 'published' ? 'bg-green-100 text-green-700' :
                                draft.status === 'uploaded' ? 'bg-blue-100 text-blue-700' :
                                'bg-gray-100 text-gray-700'
                            }`}>
                                {draft.status === 'published' ? '已发布' : draft.status === 'uploaded' ? '已上传' : '本地草稿'}
                            </span>
                            <span className="text-xs text-slate-400">{new Date(draft.updated_at).toLocaleDateString()}</span>
                        </div>
                        <h3 className="font-bold text-slate-800 mb-2 truncate">{draft.title}</h3>
                        <p className="text-xs text-slate-500 mb-4 line-clamp-2">{draft.digest || '无摘要'}</p>
                        <div className="flex items-center gap-2 mt-auto">
                            <button onClick={() => handleEditDraft(draft)} className="px-3 py-1.5 bg-slate-100 text-slate-600 rounded text-xs font-bold hover:bg-slate-200">编辑</button>
                            <button onClick={() => handleSendPreview(draft)} disabled={loading} className="px-3 py-1.5 bg-purple-50 text-purple-600 rounded text-xs font-bold hover:bg-purple-100">预览</button>
                            <button onClick={() => handleUploadDraft(draft)} disabled={loading} className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded text-xs font-bold hover:bg-blue-100">上传</button>
                            {draft.status === 'uploaded' && (
                                <button onClick={() => handlePublishDraft(draft)} disabled={loading} className="px-3 py-1.5 bg-green-50 text-green-600 rounded text-xs font-bold hover:bg-green-100">发布</button>
                            )}
                            <button onClick={() => handleDeleteDraft(draft.id)} className="px-3 py-1.5 bg-red-50 text-red-600 rounded text-xs font-bold hover:bg-red-100 ml-auto">删除</button>
                        </div>
                    </div>
                ))}
                {drafts.length === 0 && (
                    <div className="col-span-full py-12 text-center text-slate-400 text-sm">
                        暂无草稿，点击右上角新建
                    </div>
                )}
            </div>
        </div>
    );

    const renderAccounts = () => (
        <div className="space-y-6">
            <div className="bg-white p-6 rounded-2xl border border-slate-200">
                <h3 className="text-sm font-bold text-slate-800 mb-4">添加公众号</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                    <input 
                        className="px-4 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-100"
                        placeholder="公众号名称"
                        value={newAccount.name}
                        onChange={e => setNewAccount({...newAccount, name: e.target.value})}
                    />
                    <input 
                        className="px-4 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-100"
                        placeholder="AppID"
                        value={newAccount.appId}
                        onChange={e => setNewAccount({...newAccount, appId: e.target.value})}
                    />
                    <input 
                        className="px-4 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-100"
                        placeholder="AppSecret"
                        type="password"
                        value={newAccount.appSecret}
                        onChange={e => setNewAccount({...newAccount, appSecret: e.target.value})}
                    />
                    <input 
                        className="px-4 py-2 border border-slate-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-100"
                        placeholder="预览OpenID (可选，用于测试号)"
                        value={newAccount.previewOpenId}
                        onChange={e => setNewAccount({...newAccount, previewOpenId: e.target.value})}
                    />
                </div>
                <button onClick={handleAddAccount} className="px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-bold hover:bg-slate-800">添加账号</button>
            </div>

            <div className="space-y-4">
                <h3 className="text-sm font-bold text-slate-800">已绑定账号</h3>
                {accounts.map(acc => (
                    <div key={acc.id} className="flex items-center justify-between p-4 bg-white rounded-xl border border-slate-200">
                        <div>
                            <div className="font-bold text-slate-800">{acc.name}</div>
                            <div className="text-xs text-slate-400">AppID: {acc.id}</div>
                            {acc.preview_openid && <div className="text-xs text-indigo-400">Preview: {acc.preview_openid}</div>}
                        </div>
                        <button onClick={() => handleDeleteAccount(acc.id)} className="text-red-600 text-xs font-bold hover:underline">解绑</button>
                    </div>
                ))}
                {accounts.length === 0 && <div className="text-sm text-slate-400">暂无绑定账号</div>}
            </div>
        </div>
    );

    const renderEditor = () => {
        if (!editingDraft) return null;
        return (
            <div className="flex flex-col h-full space-y-4">
                <div className="flex items-center justify-between bg-white p-4 rounded-xl border border-slate-200">
                    <div className="flex items-center gap-4">
                        <button onClick={() => setActiveTab('dashboard')} className="text-slate-500 hover:text-slate-800">
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                        </button>
                        <span className="font-bold text-slate-800">编辑图文</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={handleSaveDraft} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-bold hover:bg-indigo-700">保存草稿</button>
                    </div>
                </div>

                <div className="flex-1 grid grid-cols-3 gap-6 overflow-hidden">
                    <div className="col-span-2 flex flex-col gap-4 overflow-y-auto pr-2">
                        <input 
                            className="w-full px-4 py-3 text-lg font-bold border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-100"
                            placeholder="请输入标题"
                            value={editingDraft.title}
                            onChange={e => setEditingDraft({...editingDraft, title: e.target.value})}
                        />
                        <textarea 
                            className="w-full flex-1 p-4 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-indigo-100 resize-none font-mono text-sm"
                            placeholder="请输入正文 (支持 HTML)"
                            value={editingDraft.content}
                            onChange={e => setEditingDraft({...editingDraft, content: e.target.value})}
                        />
                    </div>
                    <div className="col-span-1 bg-white p-4 rounded-xl border border-slate-200 space-y-4 h-fit">
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">发布账号</label>
                            <select 
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none"
                                value={editingDraft.account_id}
                                onChange={e => setEditingDraft({...editingDraft, account_id: e.target.value})}
                            >
                                {accounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">作者</label>
                            <input 
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none"
                                value={editingDraft.author}
                                onChange={e => setEditingDraft({...editingDraft, author: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">摘要</label>
                            <textarea 
                                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm outline-none h-20 resize-none"
                                value={editingDraft.digest}
                                onChange={e => setEditingDraft({...editingDraft, digest: e.target.value})}
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-600 mb-1">封面图路径 (本地绝对路径)</label>
                            <div className="flex gap-2">
                                <input 
                                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-xs outline-none"
                                    value={editingDraft.thumb_url}
                                    onChange={e => setEditingDraft({...editingDraft, thumb_url: e.target.value})}
                                    placeholder="/Users/..."
                                />
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1">请填写本地图片绝对路径</p>
                        </div>
                        <div className="pt-4 border-t border-slate-100">
                             <button className="w-full py-2 bg-slate-50 text-slate-600 rounded-lg text-xs font-bold border border-slate-200 hover:bg-slate-100">
                                ✨ 调用 OpenClaw 生成内容 (暂未实现)
                             </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex-1 flex flex-col h-full bg-slate-50 overflow-hidden">
            <div className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between shrink-0">
                <div>
                    <h1 className="text-xl font-black text-slate-800">社群管家</h1>
                    <p className="text-xs text-slate-500 font-bold mt-1">社交媒体矩阵管理与自动化发布</p>
                </div>
                <div className="flex bg-slate-100 p-1 rounded-lg">
                    <button 
                        onClick={() => setActiveTab('dashboard')}
                        className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'dashboard' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        看板
                    </button>
                    <button 
                        onClick={() => setActiveTab('create')}
                        className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'create' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        AI 创作
                    </button>
                    <button 
                        onClick={() => setActiveTab('accounts')}
                        className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'accounts' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        账号管理
                    </button>
                </div>
            </div>
            
            <div className="flex-1 overflow-hidden p-6">
                {activeTab === 'dashboard' && renderDashboard()}
                {activeTab === 'accounts' && renderAccounts()}
                {activeTab === 'editor' && renderEditor()}
                {activeTab === 'create' && renderCreationWizard()}
            </div>
        </div>
    );
};

export default CommunityManager;
