import React, { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
// Fix: Added CalendarEvent to imports
import { TeamMember, TeamRole, MainResponsibility, Project, CalendarEvent } from '../types';

// --- 精致 1.8 线性图标库 ---
const AgentIcons = {
    Strategy: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
    Execution: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" /></svg>,
    Comms: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" /></svg>,
    Legal: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" /></svg>,
    Analysis: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
    User: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>,
    Plus: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>,
    Chevron: ({ className }: { className?: string }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>,
    Send: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
};

interface Message {
    id: string;
    role: 'user' | 'model';
    text: string;
    timestamp: number;
}

type AgentCategory = 'STRATEGY' | 'PROGRAM' | 'COMMS' | 'COMPLIANCE' | 'DIGITAL';

interface ExpertTemplate {
    id: string;
    category: AgentCategory;
    name: string;
    role: TeamRole;
    responsibility: MainResponsibility;
    traits: string[];
    desc: string;
    avatar: string;
    isCustom?: boolean;
}

const PRESET_TEMPLATES: ExpertTemplate[] = [
    // 战略与筹款 (Strategy & Funding)
    { id: 't-1', category: 'STRATEGY', name: '资策官', role: '秘书长', responsibility: '外联募资', traits: ['资方画像', '申报书润色', '筹资策略'], desc: '专注于公益项目申报书的逻辑严密性提升与资方喜好对标，协助制定年度筹资策略。', avatar: '💼' },
    { id: 't-2', category: 'STRATEGY', name: '战略向导', role: '理事长', responsibility: '统筹管理', traits: ['愿景拆解', '合规治理', '行业观察'], desc: '协助将宏大的社会愿景拆解为可操作的年度目标，并提供公益行业趋势分析。', avatar: '🧭' },
    
    // 执行与评估 (Operations & Impact)
    { id: 't-3', category: 'PROGRAM', name: '执行架构师', role: '项目官', responsibility: '项目执行', traits: ['SOP设计', '风险预案', '多方协作'], desc: '擅长将策划案转化为具体的执行SOP清单，预测项目落地中的潜在风险。', avatar: '🛠️' },
    { id: 't-4', category: 'PROGRAM', name: '成效分析官', role: '相关方', responsibility: '其他', traits: ['影响力建模', '定量分析', '评估报告'], desc: '为项目建立社会影响力评估模型，通过数据处理生成专业的成效报告。', avatar: '📊' },

    // 传播与品牌 (Comms & Brand)
    { id: 't-5', category: 'COMMS', name: '公益叙事者', role: '传播官', responsibility: '传播推广', traits: ['深度访谈', '情感共鸣', '多平台适配'], desc: '挖掘受益人故事，将冰冷的数据转化为触动人心的叙事文案。', avatar: '✍️' },
    { id: 't-6', category: 'COMMS', name: '视觉策划', role: '传播官', responsibility: '其他', traits: ['审美把控', '排版设计', '短视频分镜'], desc: '提供专业的视觉传达建议，协助规划传播海报与短视频的叙事逻辑。', avatar: '🎥' },

    // 合规与数字化 (Support & Tech)
    { id: 't-7', category: 'COMPLIANCE', name: '合规卫士', role: '财务', responsibility: '后勤支持', traits: ['财务审计', '法务审查', '风控底线'], desc: '审查资助协议中的法务风险，提供公益机构财务透明度管理建议。', avatar: '⚖️' },
    { id: 't-8', category: 'DIGITAL', name: '数字助推器', role: '志愿者', responsibility: '其他', traits: ['效率工具', '数据清洗', '社群自动化'], desc: '优化机构数字化工作流，协助处理海量报名信息清洗与社群常见问题回复。', avatar: '🤖' }
];

// Fix: Updated prop type to include projects and events as expected by parent component
const AIVolunteersManager: React.FC<{ 
    teamMembers: TeamMember[], 
    onAddMember: (m: TeamMember) => void,
    projects: Project[],
    events: CalendarEvent[]
}> = ({ teamMembers, onAddMember, projects, events }) => {
    const aiMembers = useMemo(() => teamMembers.filter(m => m.isAI), [teamMembers]);
    const [workroomRoles, setWorkroomRoles] = useState<any[]>([]);
    
    // UI 状态
    const [activeChatId, setActiveChatId] = useState<string | 'group' | null>(aiMembers.length > 0 ? 'group' : null);
    const [draftTemplate, setDraftTemplate] = useState<ExpertTemplate | null>(aiMembers.length === 0 ? PRESET_TEMPLATES[0] : null);
    const [isRecruitmentOpen, setIsRecruitmentOpen] = useState(aiMembers.length === 0);
    const [openCategories, setOpenCategories] = useState<Set<AgentCategory>>(new Set(['STRATEGY']));
    
    // 对话与草稿
    const [threads, setThreads] = useState<Record<string, Message[]>>({ 'group': [] });
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [newTrait, setNewTrait] = useState('');

    const chatScrollRef = useRef<HTMLDivElement>(null);
    useEffect(() => { if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight; }, [threads, activeChatId]);

    useEffect(() => {
        const invoke = (channel: string, ...args: any[]) => (window as any).electronAPI?.invoke?.(channel, ...args);
        (async () => {
            try {
                const cfg = await invoke('workroom-get-config');
                const roles = Array.isArray(cfg?.roles) ? cfg.roles : [];
                setWorkroomRoles(roles);
            } catch (e) {
                setWorkroomRoles([]);
            }
        })();
    }, []);

    const activeAgent = useMemo(() => aiMembers.find(m => m.id === activeChatId), [aiMembers, activeChatId]);

    const toggleCategory = (cat: AgentCategory) => {
        setOpenCategories(prev => {
            const next = new Set(prev);
            if (next.has(cat)) next.delete(cat); else next.add(cat);
            return next;
        });
    };

    const handleCreateCustom = () => {
        setDraftTemplate({
            id: `custom-tpl-${Date.now()}`,
            category: 'DIGITAL',
            name: '',
            role: '志愿者',
            responsibility: '其他',
            traits: [],
            desc: '',
            avatar: '👤',
            isCustom: true
        });
        setActiveChatId(null);
    };

    const handlePickWorkroomRole = (r: any) => {
        const name = String(r?.name || '').trim();
        if (!name) return;
        setDraftTemplate({
            id: String(r?.id || `workroom-${Date.now()}`),
            category: 'DIGITAL',
            name,
            role: '志愿者',
            responsibility: '其他',
            traits: [String(r?.kind || 'agent'), String(r?.defaultRoom || '')].filter(Boolean),
            desc: String(r?.description || ''),
            avatar: '🤖',
            isCustom: true
        });
        setActiveChatId(null);
    };

    const handleHire = () => {
        if (!draftTemplate || !draftTemplate.name) return alert("请为专家命名");
        const newAI: TeamMember = {
            id: `ai-${Date.now()}`,
            nickname: draftTemplate.name,
            role: draftTemplate.role,
            responsibility: draftTemplate.responsibility,
            department: 'AI专家协作组',
            traits: draftTemplate.traits,
            isAI: true,
            status: 'Active'
        };
        
        const isFirstAI = aiMembers.length === 0;
        onAddMember(newAI);
        setDraftTemplate(null);
        setActiveChatId(newAI.id);
        
        // 核心逻辑：首个添加后折叠招募库
        if (isFirstAI) setIsRecruitmentOpen(false);
    };

    const handleSendMessage = async () => {
        if (!input.trim() || !activeChatId) return;
        const msgId = `m-${Date.now()}`;
        const userMsg: Message = { id: msgId, role: 'user', text: input, timestamp: Date.now() };
        setThreads(prev => ({ ...prev, [activeChatId]: [...(prev[activeChatId] || []), userMsg] }));
        setInput('');
        setIsTyping(true);
        setTimeout(() => {
            const modelMsg: Message = { id: `ai-${Date.now()}`, role: 'model', text: `已收到指令。我是【${activeAgent?.nickname || '专家团'}】，正基于项目场景进行处理：\n\n1. **初步分析**：此环节的核心在于... \n2. **执行建议**：建议采取以下步骤... \n\n(演示占位反馈)`, timestamp: Date.now() };
            setThreads(prev => ({ ...prev, [activeChatId]: [...(prev[activeChatId] || []), modelMsg] }));
            setIsTyping(false);
        }, 800);
    };

    const renderMarketCategory = (category: AgentCategory, label: string, icon: React.ReactNode) => {
        const isOpen = openCategories.has(category);
        const filtered = PRESET_TEMPLATES.filter(t => t.category === category);
        return (
            <div className="space-y-1">
                <button 
                    onClick={() => toggleCategory(category)}
                    className="w-full flex items-center justify-between px-3 py-2 hover:bg-slate-200/50 rounded-lg transition-all group"
                >
                    <div className="flex items-center gap-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                        {icon} <span>{label}</span>
                    </div>
                    <AgentIcons.Chevron className={`w-3 h-3 text-slate-300 transition-transform ${isOpen ? 'rotate-0' : '-rotate-90'}`} />
                </button>
                {isOpen && (
                    <div className="pl-6 space-y-1 animate-fade-in">
                        {filtered.map(t => (
                            <button 
                                key={t.id} 
                                onClick={() => { setDraftTemplate(t); setActiveChatId(null); }} 
                                className={`w-full text-left px-3 py-2 rounded-xl transition-all flex items-center justify-between group ${draftTemplate?.id === t.id ? 'bg-indigo-600 text-white shadow-md' : 'hover:bg-indigo-50 text-slate-600'}`}
                            >
                                <span className="text-xs font-bold truncate">{t.name}</span>
                                {aiMembers.some(m => m.nickname === t.name) ? <span className="text-[8px] opacity-40 font-black">已在岗</span> : <AgentIcons.Plus />}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="h-full flex bg-[#f8fafc] font-sans overflow-hidden">
            {/* Sidebar */}
            <div className="w-72 bg-slate-100 border-r border-slate-200 flex flex-col shrink-0 transition-all duration-300">
                <div className="p-6 border-b border-slate-200 bg-white/50 flex justify-between items-center shrink-0">
                    <h2 className="font-black text-slate-800 text-sm flex items-center gap-2">专家协作中心</h2>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-6">
                    {/* Active Section */}
                    {aiMembers.length > 0 && (
                        <div className="space-y-1">
                            <div className="px-3 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">正在协作</div>
                            <button onClick={() => { setActiveChatId('group'); setDraftTemplate(null); }} className={`w-full text-left px-4 py-3 rounded-xl transition-all flex items-center gap-3 ${activeChatId === 'group' ? 'bg-indigo-600 text-white shadow-lg' : 'hover:bg-slate-200/50 text-slate-700'}`}><AgentIcons.Strategy /><span className="text-xs font-bold">全专家研讨室</span></button>
                            {aiMembers.map(m => (
                                <button key={m.id} onClick={() => { setActiveChatId(m.id); setDraftTemplate(null); }} className={`w-full text-left px-4 py-3 rounded-xl transition-all flex items-center gap-3 ${activeChatId === m.id ? 'bg-indigo-600 text-white shadow-lg' : 'bg-white border border-slate-200 text-slate-700 mt-1'}`}><AgentIcons.User /><span className="text-xs font-bold truncate">{m.nickname} ({m.role})</span></button>
                            ))}
                        </div>
                    )}

                    {/* Recruitment Section - Collapsible */}
                    <div className="space-y-4 pt-4 border-t border-slate-200">
                        <button 
                            onClick={() => setIsRecruitmentOpen(!isRecruitmentOpen)}
                            className="w-full flex items-center justify-between px-3 py-1 hover:bg-slate-200/50 rounded-lg transition-all group"
                        >
                            <div className="text-[10px] font-black text-indigo-600 uppercase tracking-widest flex items-center gap-2">
                                <span className={`w-1.5 h-1.5 rounded-full ${aiMembers.length === 0 ? 'bg-indigo-600 animate-pulse' : 'bg-indigo-300'}`}></span>
                                招募人才库
                            </div>
                            <AgentIcons.Chevron className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-300 ${isRecruitmentOpen ? 'rotate-0' : '-rotate-90'}`} />
                        </button>

                        {isRecruitmentOpen && (
                            <div className="space-y-4 animate-fade-in pb-10">
                                <button onClick={handleCreateCustom} className="w-full bg-white border-2 border-dashed border-slate-300 py-3 rounded-2xl text-[10px] font-black text-slate-400 hover:border-indigo-400 hover:text-indigo-600 transition-all flex items-center justify-center gap-2 shadow-sm">+ 创建自定义专家</button>
                                {workroomRoles.length > 0 && (
                                    <div className="space-y-1">
                                        <div className="px-3 py-2 text-[10px] font-black text-slate-400 uppercase tracking-widest">工作间角色</div>
                                        <div className="pl-1 space-y-1">
                                            {workroomRoles.map((r: any) => (
                                                <button
                                                    key={String(r?.id || r?.name)}
                                                    onClick={() => handlePickWorkroomRole(r)}
                                                    className={`w-full text-left px-3 py-2 rounded-xl transition-all flex items-center justify-between group ${draftTemplate?.id === String(r?.id || '') ? 'bg-indigo-600 text-white shadow-md' : 'hover:bg-indigo-50 text-slate-600'}`}
                                                >
                                                    <span className="text-xs font-bold truncate">{String(r?.name || '')}</span>
                                                    {aiMembers.some(m => m.nickname === String(r?.name || '')) ? <span className="text-[8px] opacity-40 font-black">已在岗</span> : <AgentIcons.Plus />}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {renderMarketCategory('STRATEGY', '管理与策略', <AgentIcons.Strategy />)}
                                {renderMarketCategory('PROGRAM', '执行与评估', <AgentIcons.Execution />)}
                                {renderMarketCategory('COMMS', '品牌与传播', <AgentIcons.Comms />)}
                                {renderMarketCategory('COMPLIANCE', '合规与专业', <AgentIcons.Legal />)}
                                {renderMarketCategory('DIGITAL', '数字助手', <AgentIcons.Analysis />)}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col min-w-0 bg-white">
                {draftTemplate ? (
                    /* Recruitment Detail / Configuration View */
                    <div className="flex-1 overflow-y-auto p-12 flex flex-col items-center animate-fade-in">
                        <div className="w-24 h-24 bg-indigo-50 rounded-[2.5rem] flex items-center justify-center text-5xl mb-6 shadow-inner border-2 border-indigo-100">{draftTemplate.avatar}</div>
                        <input 
                            value={draftTemplate.name} 
                            onChange={e=>setDraftTemplate({...draftTemplate, name: e.target.value})} 
                            placeholder="为该专家命名 (如: 方案润色助理)" 
                            className="text-2xl font-black text-center text-slate-800 bg-transparent border-b border-transparent focus:border-indigo-200 outline-none mb-2" 
                        />
                        <p className="text-indigo-600 font-bold text-xs uppercase tracking-widest">{draftTemplate.role} · {draftTemplate.category}</p>
                        
                        <div className="max-w-2xl w-full mt-10 space-y-8 pb-20">
                            <section>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">职能定义与工作守则</label>
                                <textarea 
                                    value={draftTemplate.desc} 
                                    onChange={e=>setDraftTemplate({...draftTemplate, desc: e.target.value})} 
                                    className="w-full bg-slate-50 p-4 rounded-2xl border border-slate-100 text-sm leading-relaxed h-32 outline-none focus:ring-2 focus:ring-indigo-100" 
                                    placeholder="请描述该专家在本项目中具体负责的线上工作流程..." 
                                />
                                <p className="text-[10px] text-slate-400 mt-2 italic">提示：详细的职责描述能显著提升 AI 生成方案的专业度。</p>
                            </section>

                            <section>
                                <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-2">能力标签 (Traits)</label>
                                <div className="flex flex-wrap gap-2 mb-3">
                                    {draftTemplate.traits.map((t, i) => (
                                        <span key={`${t}-${i}`} className="px-3 py-1.5 bg-indigo-50 text-indigo-700 text-[10px] font-bold rounded-lg border border-indigo-100 flex items-center gap-2">
                                            #{t} 
                                            <button onClick={()=>setDraftTemplate({...draftTemplate, traits: draftTemplate.traits.filter(i=>i!==t)})} className="hover:text-red-500 font-black">&times;</button>
                                        </span>
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    <input 
                                        value={newTrait} 
                                        onChange={e=>setNewTrait(e.target.value)} 
                                        onKeyDown={e=>e.key==='Enter'&&(setDraftTemplate({...draftTemplate, traits: [...draftTemplate.traits, newTrait]}), setNewTrait(''))} 
                                        placeholder="追加标签，如：资方视角、极致简洁..." 
                                        className="flex-1 text-[10px] border border-slate-200 rounded-xl px-4 py-2 outline-none focus:border-indigo-400" 
                                    />
                                    <button onClick={()=>{if(newTrait){setDraftTemplate({...draftTemplate, traits: [...draftTemplate.traits, newTrait]}); setNewTrait('');}}} className="px-4 bg-slate-100 text-slate-600 rounded-xl text-xs font-black">+</button>
                                </div>
                            </section>

                            <button onClick={handleHire} className="w-full bg-slate-900 text-white py-5 rounded-3xl font-black text-sm shadow-xl hover:bg-black transition-all flex items-center justify-center gap-3 transform active:scale-95">
                                确认招募并开启协作
                            </button>
                        </div>
                    </div>
                ) : activeChatId ? (
                    /* Chat View */
                    <>
                        <div className="px-8 py-5 border-b border-slate-100 flex justify-between items-center bg-white/80 backdrop-blur-md sticky top-0 z-10">
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-lg shadow-indigo-100">
                                    {activeChatId === 'group' ? <AgentIcons.Strategy /> : <AgentIcons.User />}
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-800 text-sm">{activeChatId === 'group' ? '全专家协同空间' : `${activeAgent?.nickname} · ${activeAgent?.role}`}</h3>
                                    <div className="flex items-center gap-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{activeAgent?.responsibility || '多领域协作分析'}</span>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-slate-50/30 custom-scrollbar" ref={chatScrollRef}>
                            {(threads[activeChatId] || []).length === 0 && (
                                <div className="h-full flex flex-col items-center justify-center opacity-30">
                                    <div className="text-5xl mb-4">💬</div>
                                    <p className="text-xs font-black uppercase tracking-widest text-slate-400">专家助手已就位，请下达具体工作任务</p>
                                </div>
                            )}
                            {(threads[activeChatId] || []).map(msg => (
                                <div key={msg.id} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'} animate-fade-in-up`}>
                                    <div className={`max-w-[85%] p-5 rounded-[2rem] shadow-sm text-sm leading-relaxed ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white text-slate-700 rounded-tl-none border border-slate-100'}`}>
                                        <div className="markdown-prose prose-sm prose-indigo">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.text}</ReactMarkdown>
                                        </div>
                                    </div>
                                    <div className="mt-1 text-[8px] font-bold text-slate-300 px-4 uppercase">{new Date(msg.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</div>
                                </div>
                            ))}
                            {isTyping && (
                                <div className="flex justify-start animate-pulse">
                                    <div className="bg-white border border-slate-100 rounded-2xl p-4 flex gap-2 items-center text-slate-300">
                                        <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce"></span>
                                        <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce delay-100"></span>
                                        <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce delay-200"></span>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="p-6 border-t border-slate-100 bg-white">
                            <div className="max-w-4xl mx-auto relative flex gap-3">
                                <textarea 
                                    rows={1}
                                    value={input} 
                                    onChange={e => setInput(e.target.value)} 
                                    onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSendMessage()} 
                                    placeholder="输入指令，例如：“帮我润色这份申报书的成效部分”..." 
                                    className="w-full pl-6 pr-16 py-4 rounded-3xl border border-slate-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-50 outline-none transition-all shadow-inner text-sm bg-slate-50/50 resize-none" 
                                />
                                <button 
                                    onClick={handleSendMessage} 
                                    disabled={!input.trim() || isTyping} 
                                    className="absolute right-2 top-2 p-2.5 bg-indigo-600 text-white rounded-2xl hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-lg"
                                >
                                    <AgentIcons.Send />
                                </button>
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-300">
                        <div className="text-6xl mb-4 opacity-20">🛋️</div>
                        <p className="font-black text-xs uppercase tracking-widest opacity-40">请在左侧选择一名专家或展开人才库进行招募</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AIVolunteersManager;
