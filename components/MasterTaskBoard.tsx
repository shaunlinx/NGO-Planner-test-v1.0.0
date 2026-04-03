import React, { useMemo, useState } from 'react';
import { Project, MilestoneItem, TeamMember } from '../types';
import ProjectVisualizationModal from './ProjectVisualization/ProjectVisualizationModal';

interface MasterTaskBoardProps {
    projects: Project[];
    teamMembers: TeamMember[];
    onViewProject: (projectId: string) => void;
}

type GroupBy = 'Date' | 'Project' | 'Owner';

const Icons = {
    Chart: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
    Search: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>,
    Chevron: (props: { className?: string }) => <svg className={props.className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>,
    Network: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 20l-5.447-2.724A2 2 0 013 15.382V8.618a2 2 0 011.105-1.788L9 4m0 16l6-3m-6 3V4m6 13l5.447-2.724A2 2 0 0021 12.382V5.618a2 2 0 00-1.105-1.788L15 1m0 16V1m0 16l-6-3" /></svg>
};

const MasterTaskBoard: React.FC<MasterTaskBoardProps> = ({ projects, teamMembers, onViewProject }) => {
    const [groupBy, setGroupBy] = useState<GroupBy>('Date');
    const [filterStatus, setFilterStatus] = useState<string>('All');
    const [filterOwner, setFilterOwner] = useState<string>('All');
    const [filterProject, setFilterProject] = useState<string>('All');
    const [searchQuery, setSearchQuery] = useState('');
    const [isVisualizationOpen, setIsVisualizationOpen] = useState(false);
    
    const [zoomLevel, setZoomLevel] = useState<number>(1.0);
    const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

    const allTasks = useMemo(() => {
        const tasks: { project: Project; task: MilestoneItem; id: string; date: string; }[] = [];
        projects.filter(p => p.status !== 'Archived').forEach(p => {
            (p.milestones || []).forEach(m => {
                tasks.push({ project: p, task: m, id: `${p.id}-${m.id}`, date: m.completionDate || '未定日期' });
            });
        });

        return tasks.filter(item => {
            const matchesSearch = item.task.task.toLowerCase().includes(searchQuery.toLowerCase());
            const matchesStatus = filterStatus === 'All' || item.task.status === filterStatus;
            const matchesOwner = filterOwner === 'All' || item.task.chargePerson === filterOwner;
            const matchesProject = filterProject === 'All' || item.project.id === filterProject;
            return matchesSearch && matchesStatus && matchesOwner && matchesProject;
        });
    }, [projects, searchQuery, filterStatus, filterOwner, filterProject]);

    const groupedData = useMemo(() => {
        const groups: Record<string, typeof allTasks> = {};
        allTasks.forEach(item => {
            let key = '';
            if (groupBy === 'Date') key = item.date;
            else if (groupBy === 'Project') key = item.project.title;
            else if (groupBy === 'Owner') key = item.task.chargePerson || '未分配';
            if (!groups[key]) groups[key] = [];
            groups[key].push(item);
        });
        return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]));
    }, [allTasks, groupBy]);

    const toggleGroupCollapse = (groupName: string) => {
        const next = new Set(collapsedGroups);
        if (next.has(groupName)) next.delete(groupName); else next.add(groupName);
        setCollapsedGroups(next);
    };

    const projectColors: Record<string, string> = useMemo(() => {
        const colors = ['border-l-indigo-500', 'border-l-emerald-500', 'border-l-orange-500', 'border-l-pink-500', 'border-l-sky-500', 'border-l-rose-500'];
        const map: Record<string, string> = {};
        projects.forEach((p, i) => { map[p.id] = colors[i % colors.length]; });
        return map;
    }, [projects]);

    return (
        <div className="h-full flex flex-col bg-[#f0f2f5] overflow-hidden font-sans relative">
            <div className="p-4 bg-white border-b border-gray-200 shadow-sm z-20 shrink-0">
                <div className="max-w-7xl mx-auto flex flex-col gap-4">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-4">
                            <h2 className="text-lg font-bold text-gray-800 flex items-center gap-2">
                                <span className="p-1.5 bg-indigo-600 rounded-lg text-white"><Icons.Chart /></span>
                                全局任务看板
                            </h2>
                            <div className="flex bg-gray-100 p-1 rounded-lg">
                                {(['Date', 'Project', 'Owner'] as GroupBy[]).map(type => (
                                    <button key={type} onClick={() => setGroupBy(type)} className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${groupBy === type ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}>
                                        {type === 'Date' ? '时间轴' : type === 'Project' ? '项目' : '负责人'}
                                    </button>
                                ))}
                            </div>
                            <button
                                onClick={() => setIsVisualizationOpen(true)}
                                className="flex items-center gap-2 px-3 py-2 rounded-full bg-indigo-50 text-indigo-700 border border-indigo-100 text-xs font-black hover:bg-indigo-100 transition-colors"
                            >
                                <Icons.Network />
                                项目可视化
                            </button>
                        </div>

                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-2 bg-gray-50 px-3 py-1.5 rounded-full border border-gray-200">
                                <span className="text-[10px] font-bold text-gray-400">缩放</span>
                                <input type="range" min="0.5" max="1.5" step="0.1" value={zoomLevel} onChange={e => setZoomLevel(parseFloat(e.target.value))} className="w-24 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600" />
                            </div>
                            <div className="relative">
                                <input type="text" placeholder="搜索任务..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} className="pl-9 pr-4 py-2 border rounded-full text-xs focus:border-indigo-500 outline-none w-48 bg-gray-50 focus:bg-white transition-all shadow-sm" />
                                <span className="absolute left-3 top-2.5 text-gray-400"><Icons.Search /></span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-1 overflow-x-auto overflow-y-hidden custom-scrollbar bg-[#f0f2f5] relative">
                <div className="h-full flex gap-6 p-10 min-w-max transition-all duration-300" style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top left' }}>
                    {groupedData.map(([groupName, tasks]) => {
                        const isCollapsed = collapsedGroups.has(groupName);
                        return (
                            <div key={groupName} className={`flex flex-col shrink-0 transition-all duration-300 ease-in-out ${isCollapsed ? 'w-16' : 'w-[20rem]'}`}>
                                <div className={`flex items-center justify-between mb-4 px-2 py-1.5 rounded-lg transition-colors group cursor-pointer ${isCollapsed ? 'bg-indigo-50 flex-col py-4 h-full' : 'bg-transparent'}`} onClick={() => isCollapsed && toggleGroupCollapse(groupName)}>
                                    <div className={`flex items-center gap-2 overflow-hidden ${isCollapsed ? 'flex-col' : ''}`}>
                                        <div className={`font-black text-xs truncate transition-all ${isCollapsed ? '[writing-mode:vertical-lr] rotate-180 py-4 text-indigo-600' : 'text-gray-500 uppercase tracking-widest'}`} title={groupName}>
                                            {groupName}
                                        </div>
                                        <span className={`bg-gray-200 text-gray-500 text-[10px] px-2 py-0.5 rounded-full font-bold shadow-inner ${isCollapsed ? 'mt-auto' : ''}`}>
                                            {tasks.length}
                                        </span>
                                    </div>
                                    <button onClick={(e) => { e.stopPropagation(); toggleGroupCollapse(groupName); }} className={`p-1 rounded hover:bg-white/50 text-gray-300 hover:text-indigo-600 transition-all ${isCollapsed ? 'mb-2 order-first' : 'opacity-0 group-hover:opacity-100'}`}>
                                        <Icons.Chevron className={`w-4 h-4 transform ${isCollapsed ? 'rotate-180' : 'rotate-90'}`} />
                                    </button>
                                </div>

                                {!isCollapsed && (
                                    <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-2 pb-10">
                                        {tasks.map(({ project, task, id }) => (
                                            <div key={id} onClick={() => onViewProject(project.id)} className={`bg-white rounded-2xl border border-gray-200 p-5 shadow-sm hover:shadow-xl hover:border-indigo-400 hover:translate-y-[-2px] transition-all cursor-pointer group border-l-8 ${projectColors[project.id]} animate-fade-in`}>
                                                <div className="flex justify-between items-start mb-3">
                                                    <div className="text-[9px] font-black text-indigo-400 uppercase tracking-tighter truncate max-w-[140px]">{project.title}</div>
                                                    <span className={`text-[9px] px-2 py-0.5 rounded-full font-black border uppercase tracking-wider ${task.status === 'Done' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-gray-100 text-gray-600'}`}>
                                                        {task.status}
                                                    </span>
                                                </div>
                                                <h4 className="font-bold text-gray-800 text-[13px] mb-3 leading-snug group-hover:text-indigo-600 transition-colors">{task.task}</h4>
                                                <div className="flex justify-between items-center pt-4 border-t border-gray-50">
                                                    <span className="text-[10px] font-bold text-gray-600">{task.chargePerson || '未指派'}</span>
                                                    <div className="text-[10px] font-mono font-black text-gray-300">{task.completionDate || '--.--'}</div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            <ProjectVisualizationModal
                isOpen={isVisualizationOpen}
                onClose={() => setIsVisualizationOpen(false)}
                projects={projects}
                teamMembers={teamMembers}
            />
        </div>
    );
};

export default MasterTaskBoard;
