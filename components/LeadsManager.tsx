
import React, { useState, useRef, useMemo, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ProjectLeadSource, Opportunity, ProjectApplication, TeamMember, NgoDomain, Project, SearchConfig, WebLeadResult, MarketReport } from '../types';
import { analyzeLeadSource, generateProposal, searchWebLeads, refineProjectContent } from '../services/geminiService';
import * as pdfjsLib from 'pdfjs-dist';
import { DOMAINS } from '../constants';

// --- 专业图标库 (Stroke 1.8) ---
const LeadIcons = {
    Compass: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9 9 0 100-18 9 9 0 000 18z" /><path strokeLinecap="round" strokeLinejoin="round" d="M14.828 9.172l-5.656 5.656m0 0L8 16l1.172-1.172m0 0l5.656-5.656M8 8l1.172 1.172m0 0L14.828 14.828" /></svg>,
    Search: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>,
    Collect: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>,
    Lightbulb: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" /></svg>,
    Write: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>,
    Settings: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
    ChevronRight: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="2"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>,
    Upload: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
};

const RECOMMENDED_KEYWORDS = [
    '乡村振兴', '社工服务', '妇女儿童', '社区治理', '公益大赛', '环保资助', '教育扶贫', '福彩金', '政府购买'
];

const getLibrary = (lib: any) => lib?.default || lib;

const extractPdfText = async (file: File): Promise<string> => {
    const pdfClient = getLibrary(pdfjsLib);
    if (pdfClient && pdfClient.GlobalWorkerOptions) {
        // 同步使用 5.4.530 版本，改用 ESM 后缀 .mjs
        pdfClient.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@5.4.530/build/pdf.worker.mjs';
    }
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfClient.getDocument({ data: arrayBuffer }).promise;
    let fullText = '';
    const maxPages = Math.min(pdf.numPages, 10);
    for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        fullText += (await page.getTextContent()).items.map((it: any) => it.str).join(' ') + '\n';
    }
    return fullText;
};

interface LeadsManagerProps {
    teamMembers: TeamMember[];
    preferredDomains: NgoDomain[];
    archivedProjects: Project[];
    leads: ProjectLeadSource[];
    onUpdateLeads: (leads: ProjectLeadSource[]) => void;
    opportunities: Opportunity[];
    onUpdateOpportunities: (opps: Opportunity[]) => void;
    applications: ProjectApplication[];
    onUpdateApplications: (apps: ProjectApplication[]) => void;
}

import { isDesktopApp } from '../utils/platformUtils';

const LeadsManager: React.FC<LeadsManagerProps> = ({
    teamMembers, preferredDomains, archivedProjects, leads, onUpdateLeads, opportunities, onUpdateOpportunities, applications, onUpdateApplications
}) => {
    const [activeTab, setActiveTab] = useState<'DISCOVERY' | 'COLLECTIONS' | 'OPPORTUNITIES' | 'APPLICATIONS'>('DISCOVERY');

    useEffect(() => {
        // Set worker globally for PDF.js
        if (typeof window !== 'undefined') {
            // Local worker from public folder (packaged with app)
            // In Electron production, files in 'public' are at root relative to index.html
            // In Vite dev, they are at root '/'
            pdfjsLib.GlobalWorkerOptions.workerSrc = isDesktopApp() 
                ? 'pdf.worker.min.js' 
                : '/pdf.worker.min.js';
        }
    }, []);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isAnalyzing, setIsAnalyzing] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState<string | null>(null);
    const [isEditingProposal, setIsEditingProposal] = useState(false);
    const [aiPrompt, setAiPrompt] = useState('');
    const [isRefining, setIsRefining] = useState(false);
    const [selectedAppId, setSelectedAppId] = useState<string | null>(null);

    const [searchConfig, setSearchConfig] = useState<SearchConfig>({
        keywords: ['申请指南', '公益创投'],
        domains: preferredDomains.length > 0 ? preferredDomains : ['儿童'],
        matchCriteria: { region: '全国', fundingPreference: '不限' },
        frequency: 'Manual',
        lastRun: 0
    });
    const [searchResults, setSearchResults] = useState<WebLeadResult[]>([]);
    const [marketReport, setMarketReport] = useState<MarketReport | null>(null);
    const [isSearching, setIsSearching] = useState(false);
    const [newKeyword, setNewKeyword] = useState('');
    const [isAutoPilot, setIsAutoPilot] = useState(false);

    useEffect(() => {
        let interval: any;
        if (isAutoPilot) {
            if (!isSearching && searchResults.length === 0) executeSearch(searchConfig);
            interval = setInterval(() => {
                if (!isSearching) {
                    executeSearch(searchConfig);
                }
            }, 30000);
        }
        return () => clearInterval(interval);
    }, [isAutoPilot, isSearching, searchConfig]);

    const executeSearch = async (config: SearchConfig) => {
        if (config.domains.length === 0) return alert("请选择至少一个关注领域");
        setIsSearching(true);
        try {
            const res = await searchWebLeads(config);
            setSearchResults(res.results);
            setMarketReport(res.marketReport);
            setSearchConfig(prev => ({ ...prev, lastRun: Date.now() }));
        } catch (e: any) { alert(`检索失败: ${e.message}`); } finally { setIsSearching(false); }
    };

    const handleCollectWebResult = (result: WebLeadResult) => {
        if (leads.some(l => l.originalUrl === result.url)) return alert("已在收藏夹中");
        const newLead: ProjectLeadSource = { id: `lead-web-${Date.now()}`, name: result.title, type: 'WebSearch', content: result.snippet, originalUrl: result.url, status: 'New', addedAt: Date.now() };
        onUpdateLeads([newLead, ...leads]);
        setSearchResults(prev => prev.map(r => r.id === result.id ? { ...r, isCollected: true } : r));
    };

    const handleAnalyzeLead = async (lead: ProjectLeadSource) => {
        setIsAnalyzing(lead.id);
        try {
            const opps = await analyzeLeadSource(lead, { domains: preferredDomains, team: teamMembers, history: archivedProjects.map(p => p.title).join(', ') });
            if (opps?.length) {
                onUpdateOpportunities([...opportunities, ...opps.map((o, i) => ({ ...o, id: `opp-${Date.now()}-${i}`, sourceId: lead.id, isIgnored: false }))]);
                onUpdateLeads(leads.map(l => l.id === lead.id ? { ...l, status: 'Analyzed' } : l));
            }
        } catch (e: any) { alert(`分析失败: ${e.message}`); } finally { setIsAnalyzing(lead.id === isAnalyzing ? null : isAnalyzing); setIsAnalyzing(null); }
    };

    const handleCreateApplication = async (opp: Opportunity) => {
        setIsGenerating(opp.id);
        try {
            const proposal = await generateProposal(opp, teamMembers, `Focus: ${preferredDomains.join(',')}`);
            const newApp: ProjectApplication = { id: `app-${Date.now()}`, opportunityId: opp.id, opportunity: opp, proposalContent: proposal, status: 'Draft', notes: '', lastUpdated: Date.now() };
            onUpdateApplications([newApp, ...applications]);
            setSelectedAppId(newApp.id);
            setActiveTab('APPLICATIONS');
        } catch (e: any) { alert(`生成失败: ${e.message}`); } finally { setIsGenerating(null); }
    };

    // Fix: Implemented handleRefineProposal to use the AI refine project content service
    const handleRefineProposal = async () => {
        const selectedApp = applications.find(a => a.id === selectedAppId);
        if (!selectedApp || !aiPrompt.trim() || isRefining) return;
        
        setIsRefining(true);
        try {
            const refined = await refineProjectContent(selectedApp.proposalContent, aiPrompt, selectedApp.opportunity.title);
            onUpdateApplications(applications.map(a => a.id === selectedAppId ? { ...a, proposalContent: refined, lastUpdated: Date.now() } : a));
            setAiPrompt('');
        } catch (e: any) {
            alert(`优化失败: ${e.message}`);
        } finally {
            setIsRefining(false);
        }
    };

    const sortedOpportunities = useMemo(() => opportunities.filter(o => !o.isIgnored).sort((a, b) => b.matchScore - a.matchScore), [opportunities]);
    const selectedApp = applications.find(a => a.id === selectedAppId);

    return (
        <div className="h-full flex flex-col bg-slate-50 font-sans">
            {/* Immersive Header */}
            <div className="bg-white border-b border-slate-200 px-8 py-5 flex justify-between items-center shrink-0 shadow-sm z-20">
                <div className="flex items-center gap-4">
                    <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center text-white shadow-xl shadow-indigo-100"><LeadIcons.Compass /></div>
                    <div>
                        <h2 className="text-xl font-black text-slate-800 tracking-tight uppercase">项目情报与申报工作台</h2>
                        <div className="flex items-center gap-2 mt-1">
                            <span className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 uppercase tracking-widest bg-slate-100 px-2 py-0.5 rounded">
                                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse"></span>
                                实时监控中
                            </span>
                        </div>
                    </div>
                </div>
                <div className="flex bg-slate-100/80 p-1.5 rounded-2xl border border-slate-200 shadow-inner">
                    {[
                        { id: 'DISCOVERY', label: '智能发现', icon: <LeadIcons.Search /> },
                        { id: 'COLLECTIONS', label: '线索库', icon: <LeadIcons.Collect /> },
                        { id: 'OPPORTUNITIES', label: '智选机会', icon: <LeadIcons.Lightbulb /> },
                        { id: 'APPLICATIONS', label: '申报管理', icon: <LeadIcons.Write /> }
                    ].map(t => (
                        <button key={t.id} onClick={() => setActiveTab(t.id as any)} className={`flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-black transition-all ${activeTab === t.id ? 'bg-white text-indigo-600 shadow-md scale-105' : 'text-slate-500 hover:text-slate-700'}`}>
                            {t.icon} {t.label}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-hidden p-6 lg:p-8">
                {activeTab === 'DISCOVERY' && (
                    <div className="h-full flex gap-8">
                        {/* Control Panel */}
                        <div className="w-80 bg-white rounded-[2rem] border border-slate-200 p-6 flex flex-col shadow-sm shrink-0">
                            <h3 className="font-black text-slate-800 text-sm mb-6 flex items-center justify-between">
                                <span className="flex items-center gap-2">情报检索参数 <LeadIcons.Settings /></span>
                                <div className="flex items-center gap-2 bg-slate-100 rounded-full p-1 pl-3 border border-slate-200" title="开启后，AI 将在后台持续寻找新线索">
                                    <span className={`text-[9px] font-black uppercase tracking-wider ${isAutoPilot ? 'text-green-600' : 'text-slate-400'}`}>Auto-Pilot</span>
                                    <button 
                                        onClick={() => setIsAutoPilot(!isAutoPilot)}
                                        className={`w-8 h-4 rounded-full transition-all relative ${isAutoPilot ? 'bg-green-500' : 'bg-slate-300'}`}
                                    >
                                        <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all shadow-sm`} style={{ left: isAutoPilot ? '18px' : '2px' }} />
                                    </button>
                                </div>
                            </h3>
                            <div className="flex-1 overflow-y-auto custom-scrollbar space-y-8 pr-2">
                                <section>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3">地域与规模</label>
                                    <div className="space-y-3">
                                        <input value={searchConfig.matchCriteria.region} onChange={e=>setSearchConfig({...searchConfig, matchCriteria: {...searchConfig.matchCriteria, region: e.target.value}})} className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-100" placeholder="检索范围 (如: 华东地区)" />
                                        <select value={searchConfig.matchCriteria.fundingPreference} onChange={e=>setSearchConfig({...searchConfig, matchCriteria: {...searchConfig.matchCriteria, fundingPreference: e.target.value}})} className="w-full bg-slate-50 border border-slate-100 rounded-xl p-3 text-xs font-bold bg-white">
                                            <option>不限金额</option>
                                            <option>小额 (10万以下)</option>
                                            <option>中大型 (50万以上)</option>
                                        </select>
                                    </div>
                                </section>
                                <section>
                                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest block mb-3">关注领域</label>
                                    <div className="flex flex-wrap gap-2">
                                        {DOMAINS.map(d => (
                                            <button key={d} onClick={() => setSearchConfig({...searchConfig, domains: searchConfig.domains.includes(d) ? searchConfig.domains.filter(i=>i!==d) : [...searchConfig.domains, d]})} className={`text-[10px] px-3 py-1.5 rounded-lg font-black border transition-all ${searchConfig.domains.includes(d) ? 'bg-indigo-600 text-white border-indigo-600 shadow-lg' : 'bg-white text-slate-500 border-slate-200'}`}>
                                                {d}
                                            </button>
                                        ))}
                                    </div>
                                </section>
                            </div>
                            <button onClick={()=>executeSearch(searchConfig)} disabled={isSearching} className="mt-8 w-full bg-slate-900 text-white py-4 rounded-2xl font-black text-sm shadow-xl shadow-slate-200 hover:bg-black transition-all flex items-center justify-center gap-3 active:scale-95 disabled:opacity-50">
                                {isSearching ? <span className="animate-spin text-lg">⏳</span> : <LeadIcons.Search />}
                                {isSearching ? '深度检索情报中...' : '启动智能发现'}
                            </button>
                        </div>

                        {/* Intelligence Feed */}
                        <div className="flex-1 flex flex-col gap-6 overflow-hidden">
                            {marketReport && (
                                <div className="bg-gradient-to-br from-indigo-900 to-slate-900 rounded-[2rem] p-6 text-white shadow-2xl relative overflow-hidden shrink-0">
                                    <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/20 rounded-full -translate-y-1/2 translate-x-1/2 blur-3xl"></div>
                                    <h4 className="text-[10px] font-black text-indigo-300 uppercase tracking-widest mb-3 flex items-center gap-2">
                                        <span className="w-2 h-2 bg-indigo-400 rounded-full"></span> 行业动态简报
                                    </h4>
                                    <div className="text-sm leading-relaxed opacity-90 prose-invert max-w-none"><ReactMarkdown>{marketReport.summary}</ReactMarkdown></div>
                                </div>
                            )}
                            <div className="flex-1 overflow-y-auto custom-scrollbar">
                                {searchResults.length === 0 ? (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-300 opacity-60">
                                        <div className="text-6xl mb-4">🛸</div>
                                        <p className="font-black uppercase tracking-widest text-xs">等待下达搜索指令...</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 pb-10">
                                        {searchResults.map(res => (
                                            <div key={res.id} className="bg-white rounded-[2rem] border border-slate-200 p-6 hover:shadow-2xl hover:shadow-indigo-100 hover:border-indigo-400 transition-all group flex flex-col">
                                                <div className="flex justify-between items-start mb-4">
                                                    <div className={`px-3 py-1 rounded-full text-[10px] font-black border ${res.matchScore >= 80 ? 'bg-green-50 text-green-600 border-green-200' : 'bg-amber-50 text-amber-600 border-amber-200'}`}>
                                                        AI 评分: {res.matchScore}
                                                    </div>
                                                </div>
                                                <h4 className="font-bold text-slate-800 mb-2 leading-snug text-base group-hover:text-indigo-600 transition-colors">{res.title}</h4>
                                                <div className="text-[10px] text-slate-400 font-bold mb-4 uppercase tracking-tighter flex gap-3">
                                                    <span>🏦 {res.source}</span>
                                                    {res.deadline && <span>⌛ 截止: {res.deadline}</span>}
                                                </div>
                                                <p className="text-xs text-slate-500 line-clamp-3 mb-6 flex-1 bg-slate-50 p-3 rounded-xl border border-slate-100 italic">{res.snippet}</p>
                                                <div className="flex gap-2">
                                                    <a href={res.url} target="_blank" className="flex-1 bg-slate-100 text-slate-700 py-2 rounded-xl text-[10px] font-black text-center hover:bg-slate-200">查看原文</a>
                                                    <button onClick={()=>handleCollectWebResult(res)} disabled={res.isCollected} className={`flex-1 py-2 rounded-xl text-[10px] font-black transition-all ${res.isCollected ? 'bg-green-50 text-green-600' : 'bg-indigo-600 text-white shadow-lg shadow-indigo-100 hover:bg-indigo-700'}`}>
                                                        {res.isCollected ? '已收藏' : '⭐ 收藏线索'}
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'COLLECTIONS' && (
                    <div className="max-w-4xl mx-auto h-full flex flex-col gap-6">
                        <div className="bg-white p-8 rounded-[2.5rem] border border-slate-200 shadow-sm flex flex-col items-center">
                            <h3 className="text-lg font-black text-slate-800 mb-6 uppercase tracking-tight">线索快速采集坞</h3>
                            <div className="grid grid-cols-2 gap-8 w-full">
                                <div onClick={()=>fileInputRef.current?.click()} className="border-2 border-dashed border-slate-200 rounded-3xl p-8 text-center cursor-pointer hover:bg-indigo-50/50 hover:border-indigo-400 transition-all group">
                                    <input type="file" ref={fileInputRef} className="hidden" />
                                    <div className="text-4xl mb-4 group-hover:scale-110 transition-transform">📄</div>
                                    <p className="text-sm font-black text-slate-700">上传策划案/公告</p>
                                    <p className="text-[10px] text-slate-400 mt-1 uppercase font-bold tracking-widest">PDF / JPG / PNG</p>
                                </div>
                                <div className="space-y-3">
                                    <textarea className="w-full h-32 border border-slate-200 rounded-3xl p-4 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-100 resize-none bg-slate-50" placeholder="粘贴外部链接或手动输入申报描述..." />
                                    <button className="w-full bg-slate-900 text-white py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-black transition-all">添加文字线索</button>
                                </div>
                            </div>
                        </div>
                        <div className="flex-1 overflow-y-auto space-y-4">
                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">已采集的线索 ({leads.length})</h4>
                            {leads.map(l => (
                                <div key={l.id} className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between group hover:border-indigo-400 hover:shadow-md transition-all">
                                    <div className="flex items-center gap-4">
                                        <div className="w-10 h-10 rounded-xl bg-slate-100 flex items-center justify-center text-xl">{l.type==='WebSearch'?'🌐':l.type==='File'?'📄':'🔗'}</div>
                                        <div>
                                            <div className="font-bold text-slate-800 text-sm">{l.name}</div>
                                            <div className="text-[10px] text-slate-400 font-bold uppercase">{new Date(l.addedAt).toLocaleDateString()} · {l.status==='Analyzed'?'已解析':'待处理'}</div>
                                        </div>
                                    </div>
                                    <button onClick={()=>handleAnalyzeLead(l)} disabled={isAnalyzing===l.id} className={`px-5 py-2 rounded-xl text-[10px] font-black transition-all ${isAnalyzing===l.id?'bg-amber-100 text-amber-600 animate-pulse':'bg-indigo-50 text-indigo-600 hover:bg-indigo-100'}`}>
                                        {isAnalyzing===l.id ? '情报分析中...' : '🤖 提取申报机会'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {activeTab === 'OPPORTUNITIES' && (
                    <div className="max-w-5xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-6 overflow-y-auto h-full pb-10">
                        {sortedOpportunities.map(opp => (
                            <div key={opp.id} className="bg-white rounded-[2.5rem] border border-slate-200 p-8 flex flex-col hover:shadow-2xl hover:border-indigo-500 transition-all group relative overflow-hidden">
                                <div className="absolute top-0 right-0 bg-indigo-600 text-white px-6 py-2 rounded-bl-3xl font-black text-sm shadow-xl">{opp.matchScore}% 匹配</div>
                                <h3 className="font-black text-slate-800 text-lg mb-2 pr-20">{opp.title}</h3>
                                <div className="flex gap-4 text-[10px] font-black text-slate-400 uppercase tracking-widest mb-6">
                                    <span>🏢 {opp.funder}</span>
                                    <span>💰 {opp.fundingAmount}</span>
                                </div>
                                <div className="bg-indigo-50/50 rounded-3xl p-5 mb-8 border border-indigo-100 flex-1">
                                    <div className="text-[10px] font-black text-indigo-600 uppercase mb-2">💡 专家推荐建议</div>
                                    <p className="text-xs text-indigo-800 leading-relaxed font-bold italic">{opp.matchReason}</p>
                                </div>
                                <div className="flex gap-3">
                                    <button onClick={()=>onUpdateOpportunities(opportunities.map(o=>o.id===opp.id?{...o,isIgnored:true}:o))} className="flex-1 py-3 rounded-2xl text-[10px] font-black text-slate-400 border border-slate-200 hover:bg-slate-50">忽略</button>
                                    <button onClick={()=>handleCreateApplication(opp)} disabled={isGenerating===opp.id} className="flex-[2] bg-slate-900 text-white py-3 rounded-2xl text-[10px] font-black uppercase tracking-widest shadow-xl shadow-slate-200 hover:bg-black transition-all disabled:opacity-50">
                                        {isGenerating===opp.id?'正在撰写中...':'✍️ 一键生成申报书'}
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}

                {activeTab === 'APPLICATIONS' && (
                    <div className="h-full flex gap-8">
                        <div className="w-80 bg-white rounded-[2.5rem] border border-slate-200 overflow-hidden flex flex-col shadow-sm shrink-0">
                            <div className="p-5 border-b border-slate-100 bg-slate-50 font-black text-[10px] text-slate-400 uppercase tracking-widest">我的申报进程</div>
                            <div className="flex-1 overflow-y-auto custom-scrollbar">
                                {applications.map(app => (
                                    <div key={app.id} onClick={()=>setSelectedAppId(app.id)} className={`p-5 border-b border-slate-100 cursor-pointer transition-all ${selectedAppId===app.id?'bg-indigo-600 text-white shadow-lg':'hover:bg-slate-50'}`}>
                                        <div className="font-bold text-sm mb-1 line-clamp-1">{app.opportunity.title}</div>
                                        <div className="flex justify-between items-center opacity-80">
                                            <span className="text-[9px] font-black uppercase bg-white/20 px-2 py-0.5 rounded">{app.status}</span>
                                            <span className="text-[9px] font-mono">{new Date(app.lastUpdated).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="flex-1 bg-white rounded-[2.5rem] border border-slate-200 flex flex-col overflow-hidden shadow-2xl relative">
                            {selectedApp ? (
                                <>
                                    <div className="px-8 py-5 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
                                        <div className="flex items-center gap-4">
                                            <h4 className="font-black text-slate-800 text-sm uppercase">申报书编辑台</h4>
                                            <div className="flex bg-slate-200 p-1 rounded-xl shadow-inner">
                                                <button onClick={()=>setIsEditingProposal(false)} className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${!isEditingProposal?'bg-white text-indigo-600 shadow-sm':'text-slate-500'}`}>预览</button>
                                                <button onClick={()=>setIsEditingProposal(true)} className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${isEditingProposal?'bg-white text-indigo-600 shadow-sm':'text-slate-500'}`}>编辑</button>
                                            </div>
                                        </div>
                                        <select value={selectedApp.status} onChange={e=>onUpdateApplications(applications.map(a=>a.id===selectedApp.id?{...a,status:e.target.value as any}:a))} className="bg-white border border-slate-200 rounded-xl px-4 py-1.5 text-[10px] font-black text-indigo-600 uppercase shadow-sm outline-none">
                                            <option value="Draft">草稿</option><option value="Submitted">已提交</option><option value="Success">成功立项</option>
                                        </select>
                                    </div>
                                    <div className="flex-1 overflow-y-auto p-10 custom-scrollbar">
                                        {isEditingProposal ? (
                                            <textarea value={selectedApp.proposalContent} onChange={e=>onUpdateApplications(applications.map(a=>a.id===selectedApp.id?{...a,proposalContent:e.target.value}:a))} className="w-full h-full outline-none resize-none font-mono text-sm leading-relaxed text-slate-700 bg-transparent" />
                                        ) : (
                                            <div className="prose prose-indigo max-w-none prose-sm font-medium text-slate-700"><ReactMarkdown remarkPlugins={[remarkGfm]}>{selectedApp.proposalContent}</ReactMarkdown></div>
                                        )}
                                    </div>
                                    <div className="p-6 border-t border-slate-100 bg-slate-50/50">
                                        <div className="max-w-4xl mx-auto relative flex items-center">
                                            <div className="absolute left-5 text-indigo-600"><LeadIcons.Lightbulb /></div>
                                            <input value={aiPrompt} onChange={e=>setAiPrompt(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleRefineProposal()} placeholder="在此下达 AI 调优指令 (例如: '扩充项目反思部分' 或 '将语气调整得更严谨')..." className="w-full pl-14 pr-16 py-4 rounded-2xl border border-slate-200 focus:ring-4 focus:ring-indigo-100 outline-none text-xs font-bold shadow-inner bg-white" />
                                            <button onClick={handleRefineProposal} disabled={isRefining||!aiPrompt.trim()} className="absolute right-3 p-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-lg shadow-indigo-100">
                                                {isRefining ? <span className="animate-spin block">⏳</span> : <LeadIcons.ChevronRight />}
                                            </button>
                                        </div>
                                    </div>
                                </>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center opacity-30">
                                    <div className="text-6xl mb-4">✍️</div>
                                    <p className="font-black uppercase tracking-[0.2em] text-xs text-slate-400">选择左侧项目开始撰写</p>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
            <style>{`
                .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 10px; }
                .animate-fade-in-up { animation: fadeInUp 0.4s ease-out forwards; }
                @keyframes fadeInUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
            `}</style>
        </div>
    );
};

export default LeadsManager;