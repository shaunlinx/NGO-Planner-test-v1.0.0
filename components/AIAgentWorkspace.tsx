
import React, { useState, useMemo, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import FormsAssistant from './FormsAssistant';
import CommunityManager from './CommunityManager';
import DesignWorkshop from './DesignWorkshop';
import WritingAssistant from './WritingAssistant';
// Fix: Removed unused executeAgentTask which was not exported by geminiService
import { Project, TeamMember, MilestoneItem, FileAttachment, AgentKnowledgeItem } from '../types';

// 工作间高级图标
const RoomIcons = {
    Writing: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>,
    Design: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h14a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
    Forms: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.5L18 7.5V19a2 2 0 01-2 2z" /></svg>,
    Community: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>,
    Custom: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
};

interface AIAgentWorkspaceProps { projects: Project[]; teamMembers: TeamMember[]; onUpdateProject: (project: Project) => void; warehousePath?: string; }
type AgentRoomType = 'Config' | 'Writing' | 'Design' | 'Forms' | 'Community' | 'Custom';
interface AgentRoomConfig { id: AgentRoomType; label: string; icon: React.ReactNode; desc: string; keywords: string[]; color: string; }

const ROOMS: AgentRoomConfig[] = [
    { id: 'Config', label: '一键配置', icon: <RoomIcons.Custom />, desc: '角色/场景/Skills', keywords: [], color: 'text-indigo-700 bg-indigo-50' },
    { id: 'Writing', label: '文稿助手', icon: <RoomIcons.Writing />, desc: '文案撰写与润色', keywords: ['文案', '传播', '撰写'], color: 'text-pink-600 bg-pink-50' },
    { id: 'Design', label: '设计工坊', icon: <RoomIcons.Design />, desc: '视觉建议与生成', keywords: ['设计', '视觉', '海报'], color: 'text-purple-600 bg-purple-50' },
    { id: 'Forms', label: '表单助手', icon: <RoomIcons.Forms />, desc: '数据处理与制表', keywords: ['数据', '表单', 'Excel'], color: 'text-blue-600 bg-blue-50' },
    { id: 'Community', label: '社群管家', icon: <RoomIcons.Community />, desc: '互动答疑与维护', keywords: ['社群', '志愿者'], color: 'text-green-600 bg-green-50' },
    { id: 'Custom', label: '综合台账', icon: <RoomIcons.Custom />, desc: '其他综合任务', keywords: [], color: 'text-gray-600 bg-gray-50' }
];

const AIAgentWorkspace: React.FC<AIAgentWorkspaceProps> = ({ projects, teamMembers, onUpdateProject, warehousePath }) => {
    const [activeRoom, setActiveRoom] = useState<AgentRoomType>('Config');
    const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
    const [designChatInput, setDesignChatInput] = useState('');
    const [designChatMessages, setDesignChatMessages] = useState<Array<{ id: string; role: 'assistant' | 'user'; content: string }>>([
        { id: 'design-seed', role: 'assistant', content: '我是高级视觉设计师。告诉我风格、情绪、构图或局部修改需求。' }
    ]);
    const [designSourceMode, setDesignSourceMode] = useState<'project_plan' | 'direct'>('project_plan');
    const [designProjectPickerOpen, setDesignProjectPickerOpen] = useState(false);
    const [draftInstructions, setDraftInstructions] = useState<Record<string, string>>({});
    const [useSearch, setUseSearch] = useState(false);

    const emitDesignCommand = (type: string, payload?: any) => {
        window.dispatchEvent(new CustomEvent('design-workshop-command', { detail: { type, payload, ts: Date.now() } }));
    };

    useEffect(() => {
        setActiveTaskId(null);
    }, [activeRoom]);

    const WorkroomConfigPanel: React.FC = () => {
        const [loading, setLoading] = useState(true);
        const [saving, setSaving] = useState(false);
        const [applying, setApplying] = useState(false);
        const [config, setConfig] = useState<any>(null);
        const [officialSkills, setOfficialSkills] = useState<any[]>([]);
        const [marketplace, setMarketplace] = useState<any>(null);
        const [remoteSourceId, setRemoteSourceId] = useState<string>('');
        const [remoteQuery, setRemoteQuery] = useState('');
        const [remoteUpdatedAt, setRemoteUpdatedAt] = useState<string | null>(null);
        const [remoteResults, setRemoteResults] = useState<any[]>([]);
        const [remoteBusy, setRemoteBusy] = useState(false);
        const [remoteInstallBusy, setRemoteInstallBusy] = useState<string | null>(null);
        const [businessDescription, setBusinessDescription] = useState('');
        const [sources, setSources] = useState({ kb: true, projects: true, calendar: true });
        const [plan, setPlan] = useState<any>(null);
        const [error, setError] = useState<string | null>(null);

        const invoke = (channel: string, ...args: any[]) => (window as any).electronAPI?.invoke?.(channel, ...args);

        const load = async () => {
            setLoading(true);
            setError(null);
            try {
                const [cfg, skills, mp] = await Promise.all([
                    invoke('workroom-get-config'),
                    invoke('workroom-list-official-skills'),
                    invoke('workroom-list-marketplace-skills')
                ]);
                setConfig(cfg);
                setOfficialSkills((skills && skills.skills) || []);
                setMarketplace(mp?.result || null);
                const srcs = Array.isArray(cfg?.sources) ? cfg.sources : [];
                const first = srcs[0]?.id ? String(srcs[0].id) : '';
                setRemoteSourceId((prev) => (prev ? prev : first));
            } catch (e: any) {
                setError(e?.message || '加载失败');
            } finally {
                setLoading(false);
            }
        };

        useEffect(() => { load(); }, []);

        const save = async () => {
            if (!config) return;
            setSaving(true);
            setError(null);
            try {
                const next = await invoke('workroom-save-config', config);
                setConfig(next);
                const srcs = Array.isArray(next?.sources) ? next.sources : [];
                const first = srcs[0]?.id ? String(srcs[0].id) : '';
                setRemoteSourceId((prev) => (prev ? prev : first));
            } catch (e: any) {
                setError(e?.message || '保存失败');
            } finally {
                setSaving(false);
            }
        };

        const planOneClick = async () => {
            setError(null);
            setPlan(null);
            try {
                const p = await invoke('workroom-oneclick-plan', { businessDescription, selectedSources: sources });
                setPlan(p);
            } catch (e: any) {
                setError(e?.message || '生成失败');
            }
        };

        const applyOneClick = async () => {
            if (!plan) return;
            setApplying(true);
            setError(null);
            try {
                const r = await invoke('workroom-oneclick-apply', plan);
                setPlan((prev: any) => ({ ...(prev || {}), applyResult: r }));
                await load();
            } catch (e: any) {
                setError(e?.message || '应用失败');
            } finally {
                setApplying(false);
            }
        };

        const refreshMarketplace = async () => {
            try {
                const mp = await invoke('workroom-list-marketplace-skills');
                setMarketplace(mp?.result || null);
            } catch (e) {}
        };

        const updateSource = (id: string, patch: any) => {
            const sourcesList = Array.isArray(config?.sources) ? config.sources : [];
            setConfig({ ...(config || {}), sources: sourcesList.map((s: any) => (s && String(s.id) === String(id) ? { ...s, ...patch } : s)) });
        };

        const addSource = () => {
            const sourcesList = Array.isArray(config?.sources) ? [...config.sources] : [];
            const id = `github-${Date.now()}`;
            sourcesList.push({ id, type: 'github', label: 'GitHub Skills', owner: '', repo: '', branch: 'main', skillsPath: 'skills', enabled: false });
            setConfig({ ...(config || {}), sources: sourcesList });
            setRemoteSourceId(id);
        };

        const removeSource = (id: string) => {
            const sourcesList = Array.isArray(config?.sources) ? config.sources : [];
            const next = sourcesList.filter((s: any) => String(s?.id) !== String(id));
            setConfig({ ...(config || {}), sources: next });
            setRemoteSourceId((prev) => (String(prev) === String(id) ? (next[0]?.id ? String(next[0].id) : '') : prev));
        };

        const remoteRefreshIndex = async () => {
            if (!remoteSourceId) return;
            setRemoteBusy(true);
            setError(null);
            try {
                const r = await invoke('workroom-remote-refresh-index', { sourceId: remoteSourceId });
                if (!r?.success) throw new Error(r?.error || 'refresh_failed');
                setRemoteUpdatedAt(r?.cache?.updatedAt || null);
                setRemoteResults(Array.isArray(r?.cache?.skills) ? r.cache.skills.slice(0, 50) : []);
            } catch (e: any) {
                setError(e?.message || '刷新索引失败');
            } finally {
                setRemoteBusy(false);
            }
        };

        const remoteSearch = async () => {
            if (!remoteSourceId) return;
            setRemoteBusy(true);
            setError(null);
            try {
                const r = await invoke('workroom-remote-search', { sourceId: remoteSourceId, query: remoteQuery });
                if (!r?.success) throw new Error(r?.error || 'search_failed');
                setRemoteUpdatedAt(r?.updatedAt || null);
                setRemoteResults(Array.isArray(r?.skills) ? r.skills : []);
            } catch (e: any) {
                setError(e?.message || '检索失败');
            } finally {
                setRemoteBusy(false);
            }
        };

        const remoteInstall = async (skillId: string, originUrl?: string) => {
            if (!remoteSourceId || !skillId) return;
            setRemoteInstallBusy(skillId);
            setError(null);
            try {
                const r = await invoke('workroom-remote-install-skill', { sourceId: remoteSourceId, skillId, originUrl });
                if (!r?.success) throw new Error(r?.error || 'install_failed');
                await refreshMarketplace();
            } catch (e: any) {
                setError(e?.message || '安装失败');
            } finally {
                setRemoteInstallBusy(null);
            }
        };

        const promoteSkill = async (dir: string) => {
            if (!dir) return;
            setError(null);
            try {
                const r = await invoke('marketplace-skill-promote', dir);
                if (!r?.success) throw new Error(r?.error || 'promote_failed');
                await refreshMarketplace();
            } catch (e: any) {
                setError(e?.message || '上架失败');
            }
        };

        const deleteSkill = async (dir: string) => {
            if (!dir) return;
            setError(null);
            try {
                const r = await invoke('marketplace-skill-delete', dir);
                if (!r?.success) throw new Error(r?.error || 'delete_failed');
                await refreshMarketplace();
            } catch (e: any) {
                setError(e?.message || '删除失败');
            }
        };

        const auditSkill = async (dir: string) => {
            if (!dir) return;
            setError(null);
            try {
                const r = await invoke('workroom-audit-skill', { dir });
                if (!r?.success) throw new Error(r?.error || 'audit_failed');
                await refreshMarketplace();
            } catch (e: any) {
                setError(e?.message || '安全检查失败');
            }
        };

        const updateRole = (id: string, patch: any) => {
            const roles = Array.isArray(config?.roles) ? config.roles : [];
            setConfig({ ...(config || {}), roles: roles.map((r: any) => (r && r.id === id ? { ...r, ...patch } : r)) });
        };

        const addRole = () => {
            const roles = Array.isArray(config?.roles) ? [...config.roles] : [];
            const id = `role-${Date.now()}`;
            roles.push({ id, name: '新角色', kind: 'custom', description: '', defaultRoom: 'Custom', permissions: { network: 'deny', write: 'approval', publish: 'never' } });
            setConfig({ ...(config || {}), roles });
        };

        const removeRole = (id: string) => {
            const roles = Array.isArray(config?.roles) ? config.roles : [];
            const scenarios = Array.isArray(config?.scenarios) ? config.scenarios : [];
            const nextScenarios = scenarios.map((s: any) => ({ ...(s || {}), roles: Array.isArray(s?.roles) ? s.roles.filter((x: any) => String(x) !== String(id)) : [] }));
            setConfig({ ...(config || {}), roles: roles.filter((r: any) => String(r?.id) !== String(id)), scenarios: nextScenarios });
        };

        const updateScenario = (id: string, patch: any) => {
            const scenarios = Array.isArray(config?.scenarios) ? config.scenarios : [];
            setConfig({ ...(config || {}), scenarios: scenarios.map((s: any) => (s && s.id === id ? { ...s, ...patch } : s)) });
        };

        const addScenario = () => {
            const scenarios = Array.isArray(config?.scenarios) ? [...config.scenarios] : [];
            const id = `scene-${Date.now()}`;
            scenarios.push({ id, name: '新场景', description: '', requiredSources: { kb: false, projects: false, calendar: false }, roles: [], requiredSkills: [], risk: 'yellow' });
            setConfig({ ...(config || {}), scenarios });
        };

        const removeScenario = (id: string) => {
            const scenarios = Array.isArray(config?.scenarios) ? config.scenarios : [];
            setConfig({ ...(config || {}), scenarios: scenarios.filter((s: any) => String(s?.id) !== String(id)) });
        };

        const roleOptions = Array.isArray(config?.roles) ? config.roles : [];

        if (loading) return <div className="p-8 text-sm text-gray-500">加载中…</div>;
        if (!config) return <div className="p-8 text-sm text-red-600">配置加载失败</div>;

        return (
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-sm font-black text-slate-800">一键配置 · 工作间</div>
                        <div className="text-[11px] text-slate-400 font-medium">角色配置、场景编排、官方 Skills 管理，并同步到 OpenClaw</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={load} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 bg-white">刷新</button>
                        <button disabled={saving} onClick={save} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-black disabled:opacity-50">{saving ? '保存中' : '保存配置'}</button>
                    </div>
                </div>

                {error && <div className="p-3 rounded-xl bg-red-50 border border-red-100 text-xs text-red-700 font-bold">{error}</div>}

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
                        <div className="text-xs font-black text-slate-800">一键配置向导</div>
                        <textarea value={businessDescription} onChange={(e) => setBusinessDescription(e.target.value)} className="w-full h-28 p-3 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-indigo-100" placeholder="输入你的业务描述（用于匹配群内场景与角色）" />
                        <div className="flex flex-wrap gap-2 text-xs font-bold text-slate-600">
                            <label className="flex items-center gap-2"><input type="checkbox" checked={sources.kb} onChange={(e)=>setSources({ ...sources, kb: e.target.checked })} />知识库</label>
                            <label className="flex items-center gap-2"><input type="checkbox" checked={sources.projects} onChange={(e)=>setSources({ ...sources, projects: e.target.checked })} />项目台账</label>
                            <label className="flex items-center gap-2"><input type="checkbox" checked={sources.calendar} onChange={(e)=>setSources({ ...sources, calendar: e.target.checked })} />行动日历</label>
                        </div>
                        <div className="flex items-center gap-2">
                            <button onClick={planOneClick} className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-black">生成方案</button>
                            <button disabled={!plan || applying || plan?.canApply === false} onClick={applyOneClick} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-black disabled:opacity-50">{applying ? '应用中' : '应用到 OpenClaw'}</button>
                            {plan?.canApply === false && <span className="text-[11px] font-black text-red-600">存在红色风险，默认阻止</span>}
                        </div>
                        {plan && (
                            <div className="space-y-2 pt-2">
                                <div className="text-[11px] font-black text-slate-700">命中场景与技能推荐</div>
                                <div className="space-y-2">
                                    {(plan.enabledScenarios || []).map((s: any) => (
                                        <div key={s.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50 text-xs">
                                            <div className="flex items-center justify-between">
                                                <div className="font-black text-slate-800">{s.name}</div>
                                                <div className={`text-[10px] font-black ${s.risk === 'red' ? 'text-red-600' : s.risk === 'yellow' ? 'text-amber-600' : 'text-emerald-600'}`}>{String(s.risk || '').toUpperCase()}</div>
                                            </div>
                                            {s.description && <div className="text-[10px] text-slate-500 font-medium mt-1 mb-2">{s.description}</div>}
                                            {/* Show recommended community skills */}
                                            {s.recommendedCommunitySkills && s.recommendedCommunitySkills.length > 0 && (
                                                <div className="space-y-1">
                                                    <div className="text-[10px] font-bold text-indigo-600">OpenClaw 社区推荐技能 (Awesome List):</div>
                                                    {s.recommendedCommunitySkills.map((sk: any) => (
                                                        <div key={sk.id} className="flex items-center justify-between p-2 bg-white rounded-lg border border-indigo-50">
                                                            <div className="min-w-0 flex-1 mr-2">
                                                                <div className="font-bold text-slate-700 truncate">{sk.name}</div>
                                                                <div className="text-[10px] text-slate-400 truncate">{sk.description}</div>
                                                            </div>
                                                            <button 
                                                                onClick={()=>remoteInstall(sk.id, sk.originUrl)}
                                                                disabled={remoteInstallBusy === sk.id}
                                                                className="px-2 py-1 bg-indigo-50 text-indigo-600 text-[10px] font-black rounded border border-indigo-100 shrink-0"
                                                            >
                                                                {remoteInstallBusy === sk.id ? '安装中' : '获取'}
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                <div className="text-[11px] font-black text-slate-700">将安装默认 Skills</div>
                                <div className="flex flex-wrap gap-2">
                                    {(plan.required?.skillIds || []).map((id: string) => (
                                        <span key={id} className="px-2 py-1 rounded-lg bg-indigo-50 text-indigo-700 text-[10px] font-black border border-indigo-100">{id}</span>
                                    ))}
                                </div>
                                <div className="text-[11px] font-black text-slate-700">风险提示</div>
                                <div className="space-y-1">
                                    {(plan.risks || []).map((r: any, idx: number) => (
                                        <div key={`${r.id}-${idx}`} className={`p-2 rounded-xl text-[11px] font-bold border ${r.level === 'red' ? 'bg-red-50 border-red-100 text-red-700' : 'bg-amber-50 border-amber-100 text-amber-800'}`}>{r.name}: {r.reason}</div>
                                    ))}
                                    {(plan.risks || []).length === 0 && <div className="text-[11px] font-bold text-slate-400">无</div>}
                                </div>
                                {plan.applyResult && (
                                    <div className="pt-2 text-[11px] font-bold text-slate-600">
                                        应用结果：{plan.applyResult.success ? '成功' : '失败'}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="text-xs font-black text-slate-800">官方 Skills 仓库（已审计）</div>
                            <div className="text-[11px] text-slate-400 font-bold">同步后 OpenClaw 自动生效</div>
                        </div>
                        <div className="space-y-2">
                            {officialSkills.map((s: any) => (
                                <div key={s.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50">
                                    <div className="flex items-center justify-between">
                                        <div className="text-xs font-black text-slate-800">{s.name}</div>
                                        <div className={`text-[10px] font-black ${s.risk === 'red' ? 'text-red-600' : s.risk === 'yellow' ? 'text-amber-600' : 'text-emerald-600'}`}>{String(s.risk || '').toUpperCase()}</div>
                                    </div>
                                    <div className="text-[11px] text-slate-500 font-medium mt-1">{s.description}</div>
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {(s.capabilities || []).slice(0, 8).map((c: string) => (
                                            <span key={c} className="px-2 py-1 rounded-lg bg-white text-[10px] font-black text-slate-600 border border-slate-200">{c}</span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>

                        <div className="pt-4 border-t border-slate-200 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="text-xs font-black text-slate-800">GitHub Skills 仓库（检索+缓存）</div>
                                <button onClick={addSource} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-black text-slate-700 bg-white">新增仓库</button>
                            </div>
                            <div className="space-y-3">
                                {(Array.isArray(config.sources) ? config.sources : []).map((src: any) => (
                                    <div key={String(src?.id || '')} className="p-3 rounded-xl border border-slate-100 bg-slate-50 space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <input value={String(src?.label || '')} onChange={(e)=>updateSource(String(src.id), { label: e.target.value })} className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-black text-slate-800 outline-none bg-white" placeholder="仓库名称" />
                                            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
                                                <input type="checkbox" checked={!!src?.enabled} onChange={(e)=>updateSource(String(src.id), { enabled: e.target.checked })} />
                                                启用
                                            </label>
                                            <button onClick={()=>removeSource(String(src.id))} className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-xs font-black border border-red-100">删除</button>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <input value={String(src?.owner || '')} onChange={(e)=>updateSource(String(src.id), { owner: e.target.value })} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 outline-none bg-white" placeholder="owner" />
                                            <input value={String(src?.repo || '')} onChange={(e)=>updateSource(String(src.id), { repo: e.target.value })} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 outline-none bg-white" placeholder="repo" />
                                        </div>
                                        <div className="grid grid-cols-2 gap-2">
                                            <input value={String(src?.branch || 'main')} onChange={(e)=>updateSource(String(src.id), { branch: e.target.value })} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 outline-none bg-white" placeholder="branch" />
                                            <input value={String(src?.skillsPath || 'skills')} onChange={(e)=>updateSource(String(src.id), { skillsPath: e.target.value })} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 outline-none bg-white" placeholder="skillsPath" />
                                        </div>
                                        <div className="flex items-center justify-between gap-2">
                                            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
                                                <input type="radio" checked={remoteSourceId === String(src.id)} onChange={()=>setRemoteSourceId(String(src.id))} />
                                                设为当前检索源
                                            </label>
                                            <button disabled={remoteBusy || remoteSourceId !== String(src.id)} onClick={remoteRefreshIndex} className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-black disabled:opacity-50">{remoteBusy ? '刷新中' : '刷新索引'}</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2">
                                <div className="flex items-center justify-between">
                                    <div className="text-xs font-black text-slate-800">检索结果</div>
                                    <div className="text-[11px] text-slate-400 font-bold">{remoteUpdatedAt ? `索引：${remoteUpdatedAt}` : '未建立索引'}</div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <input value={remoteQuery} onChange={(e)=>setRemoteQuery(e.target.value)} className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 outline-none bg-white" placeholder="搜索 skillId / name / description" />
                                    <button disabled={remoteBusy || !remoteSourceId} onClick={remoteSearch} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-black disabled:opacity-50">{remoteBusy ? '检索中' : '检索'}</button>
                                </div>
                                <div className="space-y-2">
                                    {remoteResults.slice(0, 30).map((s: any) => (
                                        <div key={`${s.sourceId || ''}:${s.id}`} className="p-3 rounded-xl border border-slate-100 bg-slate-50">
                                            <div className="flex items-center justify-between gap-2">
                                                <div className="min-w-0">
                                                    <div className="text-xs font-black text-slate-800 truncate">{s.name || s.id}</div>
                                                    <div className="text-[11px] text-slate-500 font-medium truncate">{s.description || ''}</div>
                                                </div>
                                                <button disabled={remoteInstallBusy === String(s.id)} onClick={()=>remoteInstall(String(s.id))} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-black text-slate-700 disabled:opacity-50">{remoteInstallBusy === String(s.id) ? '安装中' : '安装到草稿'}</button>
                                            </div>
                                            <div className="text-[10px] text-slate-400 font-bold mt-1 truncate">{s.repo ? `${s.repo}@${s.branch}` : ''}</div>
                                        </div>
                                    ))}
                                    {remoteResults.length === 0 && <div className="text-[11px] font-bold text-slate-400">无结果</div>}
                                </div>
                            </div>
                        </div>

                        <div className="pt-4 border-t border-slate-200 space-y-3">
                            <div className="flex items-center justify-between">
                                <div className="text-xs font-black text-slate-800">Skills 管理（本地）</div>
                                <button onClick={refreshMarketplace} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-black text-slate-700 bg-white">刷新列表</button>
                            </div>
                            <div className="grid grid-cols-1 gap-4">
                                <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2">
                                    <div className="text-[11px] font-black text-slate-700">已上架（tools）</div>
                                    <div className="space-y-2">
                                        {(Array.isArray(marketplace?.tools) ? marketplace.tools : []).slice(0, 50).map((s: any) => (
                                            <div key={String(s?.dir || s?.id)} className="p-3 rounded-xl border border-slate-100 bg-slate-50">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <div className="text-xs font-black text-slate-800 truncate">{s.name || String(s.dir || '').split('/').pop() || 'skill'}</div>
                                                        <div className="text-[11px] text-slate-500 font-medium truncate">{s.description || ''}</div>
                                                    </div>
                                                <div className="flex items-center gap-2">
                                                    {s.audit?.risk && (
                                                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black border ${String(s.audit.risk) === 'red' ? 'bg-red-50 text-red-700 border-red-100' : String(s.audit.risk) === 'yellow' ? 'bg-amber-50 text-amber-800 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>{String(s.audit.risk).toUpperCase()}</span>
                                                    )}
                                                    <button onClick={()=>auditSkill(String(s.dir || ''))} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-black text-slate-700">安全检查</button>
                                                    <button onClick={()=>deleteSkill(String(s.dir || ''))} className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-xs font-black border border-red-100">删除</button>
                                                </div>
                                                </div>
                                            </div>
                                        ))}
                                        {(Array.isArray(marketplace?.tools) ? marketplace.tools : []).length === 0 && <div className="text-[11px] font-bold text-slate-400">无</div>}
                                    </div>
                                </div>
                                <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2">
                                    <div className="text-[11px] font-black text-slate-700">草稿（drafts / workspace）</div>
                                    <div className="space-y-2">
                                        {(Array.isArray(marketplace?.drafts) ? marketplace.drafts : []).slice(0, 50).map((s: any) => (
                                            <div key={String(s?.dir || s?.id)} className="p-3 rounded-xl border border-slate-100 bg-slate-50">
                                                <div className="flex items-center justify-between gap-2">
                                                    <div className="min-w-0">
                                                        <div className="text-xs font-black text-slate-800 truncate">{s.name || 'skill'}</div>
                                                        <div className="text-[11px] text-slate-500 font-medium truncate">{s.description || ''}</div>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                    {s.audit?.risk && (
                                                        <span className={`px-2 py-1 rounded-lg text-[10px] font-black border ${String(s.audit.risk) === 'red' ? 'bg-red-50 text-red-700 border-red-100' : String(s.audit.risk) === 'yellow' ? 'bg-amber-50 text-amber-800 border-amber-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>{String(s.audit.risk).toUpperCase()}</span>
                                                    )}
                                                    <button onClick={()=>auditSkill(String(s.dir || ''))} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-black text-slate-700">安全检查</button>
                                                        <button onClick={()=>promoteSkill(String(s.dir || ''))} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-black text-slate-700">上架</button>
                                                        <button onClick={()=>deleteSkill(String(s.dir || ''))} className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-xs font-black border border-red-100">删除</button>
                                                    </div>
                                                </div>
                                                <div className="text-[10px] text-slate-400 font-bold mt-1 truncate">{s.source || ''}</div>
                                            </div>
                                        ))}
                                        {(Array.isArray(marketplace?.drafts) ? marketplace.drafts : []).length === 0 && <div className="text-[11px] font-bold text-slate-400">无</div>}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="text-xs font-black text-slate-800">角色配置</div>
                            <button onClick={addRole} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-black text-slate-700 bg-white">新增角色</button>
                        </div>
                        <div className="space-y-3">
                            {roleOptions.map((r: any) => (
                                <div key={r.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50 space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <input value={r.name || ''} onChange={(e)=>updateRole(r.id, { name: e.target.value })} className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-black text-slate-800 outline-none bg-white" />
                                        <button onClick={()=>removeRole(r.id)} className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-xs font-black border border-red-100">删除</button>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2">
                                        <input value={r.kind || ''} onChange={(e)=>updateRole(r.id, { kind: e.target.value })} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 outline-none bg-white" placeholder="kind" />
                                        <select value={r.defaultRoom || 'Custom'} onChange={(e)=>updateRole(r.id, { defaultRoom: e.target.value })} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 outline-none bg-white">
                                            {ROOMS.filter(x=>x.id !== 'Config').map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
                                        </select>
                                    </div>
                                    <textarea value={r.description || ''} onChange={(e)=>updateRole(r.id, { description: e.target.value })} className="w-full h-20 p-3 rounded-xl border border-slate-200 text-xs outline-none bg-white" placeholder="角色说明" />
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
                        <div className="flex items-center justify-between">
                            <div className="text-xs font-black text-slate-800">场景编排</div>
                            <button onClick={addScenario} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-black text-slate-700 bg-white">新增场景</button>
                        </div>
                        <div className="space-y-3">
                            {(Array.isArray(config.scenarios) ? config.scenarios : []).map((s: any) => (
                                <div key={s.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50 space-y-2">
                                    <div className="flex items-center justify-between gap-2">
                                        <input value={s.name || ''} onChange={(e)=>updateScenario(s.id, { name: e.target.value })} className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-xs font-black text-slate-800 outline-none bg-white" />
                                        <select value={s.risk || 'yellow'} onChange={(e)=>updateScenario(s.id, { risk: e.target.value })} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-black text-slate-700 bg-white">
                                            <option value="green">GREEN</option>
                                            <option value="yellow">YELLOW</option>
                                            <option value="red">RED</option>
                                        </select>
                                        <button onClick={()=>removeScenario(s.id)} className="px-3 py-2 rounded-lg bg-red-50 text-red-700 text-xs font-black border border-red-100">删除</button>
                                    </div>
                                    <textarea value={s.description || ''} onChange={(e)=>updateScenario(s.id, { description: e.target.value })} className="w-full h-20 p-3 rounded-xl border border-slate-200 text-xs outline-none bg-white" placeholder="场景说明" />
                                    <div className="flex flex-wrap gap-2">
                                        {roleOptions.map((r: any) => {
                                            const checked = Array.isArray(s.roles) ? s.roles.includes(r.id) : false;
                                            return (
                                                <label key={`${s.id}-${r.id}`} className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
                                                    <input type="checkbox" checked={checked} onChange={(e)=>{
                                                        const roles = new Set(Array.isArray(s.roles) ? s.roles : []);
                                                        if (e.target.checked) roles.add(r.id); else roles.delete(r.id);
                                                        updateScenario(s.id, { roles: Array.from(roles) });
                                                    }} />
                                                    {r.name}
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    const getAgentRoom = (agent: TeamMember): AgentRoomType => {
        const text = `${agent.nickname} ${agent.role} ${agent.traits?.join(' ')}`.toLowerCase();
        for (const room of ROOMS) {
            if (room.id === 'Custom') continue;
            if (room.id === 'Config') continue;
            if (room.keywords.some(k => text.includes(k))) return room.id;
        }
        return 'Custom';
    };

    const tasksByRoom = useMemo(() => {
        const grouped: Record<AgentRoomType, any[]> = { Config: [], Writing: [], Design: [], Forms: [], Community: [], Custom: [] };
        projects.forEach(p => {
            if (p.status === 'Archived') return;
            (p.milestones || []).forEach(m => {
                const agent = teamMembers.find(tm => tm.nickname === m.chargePerson && tm.isAI);
                if (agent) { grouped[getAgentRoom(agent)].push({ projectId: p.id, projectTitle: p.title, task: m, agent: agent }); }
            });
        });
        return grouped;
    }, [projects, teamMembers]);

    const activeTaskData = useMemo(() => {
        if (!activeTaskId) return null;
        for (const p of projects) {
            const t = p.milestones?.find(m => m.id === activeTaskId);
            if (t) return { project: p, task: t };
        }
        return null;
    }, [projects, activeTaskId]);

    const projectCandidates = useMemo(() => {
        return projects
            .filter((p) => p.status !== 'Archived')
            .map((p) => {
                const corePlan = String(p.officialPlanContent || '').trim();
                return { id: p.id, title: p.title, available: !!corePlan };
            });
    }, [projects]);

    const sendDesignChat = () => {
        const text = String(designChatInput || '').trim();
        if (!text) return;
        setDesignChatMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: text }]);
        emitDesignCommand('chat', { content: text });
        setDesignChatInput('');
    };

    const RoomTaskPanel: React.FC<{ room: AgentRoomType }> = ({ room }) => {
        const list = (tasksByRoom as any)?.[room] || [];
        const agents = teamMembers.filter((m) => m.isAI && getAgentRoom(m) === room);
        const [status, setStatus] = useState('completed');
        const [evidence, setEvidence] = useState('');
        const [busy, setBusy] = useState(false);
        const [msg, setMsg] = useState<string | null>(null);

        const bridgeRequest = (payload: any) => (window as any).electronAPI?.openclaw?.bridgeRequest?.(payload || {});

        const applyUpdate = async () => {
            if (!activeTaskData) return;
            setBusy(true);
            setMsg(null);
            try {
                const body: any = {
                    projectId: String(activeTaskData.project.id),
                    milestoneId: String(activeTaskData.task.id),
                    patch: {
                        status: String(status || 'completed').trim()
                    }
                };
                const ev = String(evidence || '').trim();
                if (ev) body.patch.evidenceAdd = [ev];
                const r = await bridgeRequest({ path: '/skills/milestones/update', body });
                if (!r?.success && r?.error === 'approval_required') {
                    setMsg(`需要授权（approval_required）：${String(r.approvalId || '')}`.trim());
                } else if (!r?.success) {
                    setMsg(String(r?.error || '更新失败'));
                } else {
                    setMsg('更新成功');
                }
            } catch (e: any) {
                setMsg(e?.message || '更新失败');
            } finally {
                setBusy(false);
            }
        };

        return (
            <div className="flex-1 flex flex-col overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center justify-between">
                    <div className="min-w-0">
                        <div className="text-sm font-black text-slate-800">{ROOMS.find(r => r.id === room)?.label || '工位'}</div>
                        <div className="text-[11px] text-slate-400 font-medium">角色与任务面板</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={() => setActiveRoom('Config')} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-black">打开一键配置</button>
                    </div>
                </div>

                <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-0 overflow-hidden">
                    <div className="lg:col-span-1 border-r border-slate-200 bg-white overflow-y-auto p-4 space-y-4">
                        <div className="text-[11px] font-black text-slate-700">角色</div>
                        <div className="space-y-2">
                            {agents.map((a) => (
                                <div key={a.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50">
                                    <div className="text-xs font-black text-slate-800 truncate">{a.nickname}</div>
                                    <div className="text-[11px] text-slate-500 font-medium truncate">{a.role}</div>
                                </div>
                            ))}
                            {agents.length === 0 && <div className="text-[11px] font-bold text-slate-400">暂无角色</div>}
                        </div>

                        <div className="pt-2 text-[11px] font-black text-slate-700">任务</div>
                        <div className="space-y-2">
                            {list.map((x: any) => (
                                <button
                                    key={String(x?.task?.id || '')}
                                    onClick={() => setActiveTaskId(String(x.task.id))}
                                    className={`w-full text-left p-3 rounded-xl border transition-all ${activeTaskId === String(x?.task?.id || '') ? 'border-indigo-200 bg-indigo-50' : 'border-slate-100 bg-slate-50 hover:bg-slate-100'}`}
                                >
                                    <div className="text-xs font-black text-slate-800 truncate">{String(x.projectTitle || '')}</div>
                                    <div className="text-[11px] text-slate-500 font-medium truncate">{String(x?.task?.task || x?.task?.title || x?.task?.stage || '')}</div>
                                    <div className="text-[10px] text-slate-400 font-bold mt-1 truncate">{String(x?.agent?.nickname || '')}</div>
                                </button>
                            ))}
                            {list.length === 0 && <div className="text-[11px] font-bold text-slate-400">暂无任务</div>}
                        </div>
                    </div>

                    <div className="lg:col-span-2 overflow-y-auto p-6 bg-slate-50">
                        {!activeTaskData ? (
                            <div className="h-full flex items-center justify-center text-slate-300">
                                <div className="text-sm font-black text-slate-400">选择左侧任务查看详情</div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="p-4 rounded-2xl border border-slate-200 bg-white">
                                    <div className="text-xs font-black text-slate-800">{activeTaskData.project.title}</div>
                                    <div className="text-sm font-black text-slate-900 mt-1">{String((activeTaskData.task as any).task || (activeTaskData.task as any).title || '')}</div>
                                    <div className="text-[11px] text-slate-500 font-bold mt-2">里程碑ID：{activeTaskData.task.id}</div>
                                </div>

                                <div className="p-4 rounded-2xl border border-slate-200 bg-white space-y-3">
                                    <div className="text-xs font-black text-slate-800">更新状态与证据</div>
                                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
                                        <select value={status} onChange={(e)=>setStatus(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-black text-slate-700 bg-white outline-none">
                                            <option value="todo">TODO</option>
                                            <option value="doing">DOING</option>
                                            <option value="in_progress">IN_PROGRESS</option>
                                            <option value="completed">COMPLETED</option>
                                            <option value="cancelled">CANCELLED</option>
                                        </select>
                                        <input value={evidence} onChange={(e)=>setEvidence(e.target.value)} className="lg:col-span-2 px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 bg-white outline-none" placeholder="证据（飞书图片ID或链接，可选）" />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button disabled={busy} onClick={applyUpdate} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-black disabled:opacity-50">{busy ? '提交中' : '提交更新'}</button>
                                        {msg && <div className="text-[11px] font-bold text-slate-600">{msg}</div>}
                                    </div>
                                </div>

                                <div className="p-4 rounded-2xl border border-slate-200 bg-white">
                                    <div className="text-xs font-black text-slate-800">原始信息</div>
                                    <pre className="text-[11px] text-slate-600 font-mono whitespace-pre-wrap break-words mt-2">{JSON.stringify(activeTaskData.task, null, 2)}</pre>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="flex h-full bg-gray-50 overflow-hidden">
            <div className={`${isSidebarCollapsed ? 'w-16' : 'w-64'} bg-white border-r border-gray-200 flex flex-col shrink-0 z-10 shadow-sm transition-all duration-200`}>
                <div className={`border-b border-gray-100 ${isSidebarCollapsed ? 'px-2 py-3' : 'p-5'} flex items-center justify-between`}>
                    {!isSidebarCollapsed && <h3 className="font-bold text-gray-800 text-sm tracking-tight">AI 生产工位</h3>}
                    <button
                        onClick={() => setIsSidebarCollapsed((v) => !v)}
                        className={`p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:text-slate-800 hover:bg-slate-50 ${isSidebarCollapsed ? 'mx-auto' : ''}`}
                        title={isSidebarCollapsed ? '展开工位栏' : '收起工位栏'}
                    >
                        {isSidebarCollapsed ? (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                        ) : (
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
                        )}
                    </button>
                </div>
                <div className={`flex-1 overflow-y-auto ${isSidebarCollapsed ? 'p-1.5 space-y-1.5' : 'p-2 space-y-0.5'}`}>
                    {ROOMS.map(room => (
                        <button
                            key={room.id}
                            onClick={() => setActiveRoom(room.id)}
                            className={`${isSidebarCollapsed ? 'w-full p-2 rounded-xl transition-all border flex items-center justify-center' : 'w-full text-left p-2.5 rounded-xl transition-all border flex items-center gap-2.5'} ${activeRoom === room.id ? `${room.color} border-indigo-100 shadow-sm` : 'bg-white border-transparent text-gray-600 hover:bg-gray-50'}`}
                            title={room.label}
                        >
                            <div className="text-xl">{room.icon}</div>
                            {!isSidebarCollapsed && (
                                <div className="flex-1">
                                    <div className="font-bold text-[13px]">{room.label}</div>
                                    <div className="text-[10px] opacity-60 font-medium">{room.desc}</div>
                                </div>
                            )}
                        </button>
                    ))}
                    {!isSidebarCollapsed && activeRoom === 'Design' && (
                        <div className="mt-2 rounded-xl border border-slate-200 bg-slate-50 p-2.5 space-y-2">
                            <div className="flex items-start gap-2">
                                <div className="flex flex-col gap-1">
                                    <button
                                        onClick={() => {
                                            setDesignSourceMode('project_plan');
                                            emitDesignCommand('source_mode', { mode: 'project_plan' });
                                            setDesignProjectPickerOpen((v) => !v);
                                        }}
                                        className={`w-8 h-8 rounded-lg border flex items-center justify-center ${designSourceMode === 'project_plan' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}
                                        title="基于项目"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 7h18M3 12h18M3 17h18" /></svg>
                                    </button>
                                    <button
                                        onClick={() => {
                                            setDesignSourceMode('direct');
                                            emitDesignCommand('source_mode', { mode: 'direct' });
                                            emitDesignCommand('run_direct');
                                        }}
                                        className={`w-8 h-8 rounded-lg border flex items-center justify-center ${designSourceMode === 'direct' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200'}`}
                                        title="直接生图"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 4z" /></svg>
                                    </button>
                                </div>
                                <div className="flex-1 space-y-2">
                                    {designProjectPickerOpen && (
                                        <div className="max-h-28 overflow-y-auto rounded-lg border border-slate-200 bg-white p-1 space-y-1">
                                            {projectCandidates.map((item) => (
                                                <button
                                                    key={item.id}
                                                    disabled={!item.available}
                                                    onClick={() => {
                                                        emitDesignCommand('project_select', { projectId: item.id });
                                                        emitDesignCommand('run_project');
                                                        setDesignSourceMode('project_plan');
                                                    }}
                                                    className={`w-full text-left px-2 py-1.5 rounded text-[11px] font-bold ${item.available ? 'text-slate-700 hover:bg-slate-100' : 'text-slate-300 cursor-not-allowed'}`}
                                                >
                                                    {item.title}{!item.available ? '（无核心策划方案）' : ''}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                    <div className="max-h-24 overflow-y-auto rounded-lg border border-slate-200 bg-white p-2 space-y-1">
                                        {designChatMessages.slice(-6).map((msg) => (
                                            <div key={msg.id} className={`text-[11px] ${msg.role === 'user' ? 'text-indigo-700 font-bold' : 'text-slate-600 font-medium'}`}>{msg.content}</div>
                                        ))}
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <input
                                            value={designChatInput}
                                            onChange={(e) => {
                                                setDesignChatInput(e.target.value);
                                                emitDesignCommand('direct_input', { text: e.target.value });
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    e.preventDefault();
                                                    sendDesignChat();
                                                }
                                            }}
                                            className="flex-1 px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] bg-white outline-none"
                                            placeholder="视觉需求..."
                                        />
                                        <button onClick={sendDesignChat} className="px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] font-black">发</button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="flex-1 flex flex-col overflow-hidden bg-gray-50">
                {activeRoom === 'Config' ? (
                    <WorkroomConfigPanel />
                ) : activeRoom === 'Forms' ? (
                    <FormsAssistant teamMembers={teamMembers} warehousePath={warehousePath} />
                ) : activeRoom === 'Community' ? (
                    <CommunityManager />
                ) : activeRoom === 'Design' ? (
                    <DesignWorkshop
                        tasks={tasksByRoom.Design || []}
                        projects={projects}
                        activeTaskId={activeTaskId}
                        onSelectTask={setActiveTaskId}
                        warehousePath={warehousePath}
                    />
                ) : activeRoom === 'Writing' ? (
                    <WritingAssistant
                        projects={projects}
                        tasks={tasksByRoom.Writing || []}
                        activeTaskId={activeTaskId}
                        onSelectTask={setActiveTaskId}
                        onOpenConfig={() => setActiveRoom('Config')}
                    />
                ) : (
                    <RoomTaskPanel room={activeRoom} />
                )}
            </div>
        </div>
    );
};

export default AIAgentWorkspace;
