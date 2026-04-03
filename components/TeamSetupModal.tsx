import React, { useState } from 'react';
import { TeamMember, TeamRole, MainResponsibility, ScheduleType } from '../types';

interface TeamSetupModalProps {
  teamMembers: TeamMember[];
  onUpdateTeam: (members: TeamMember[]) => void;
  onConfirm: () => void;
  onSkip: () => void;
}

const PRESET_TRAIT_OBJECTS = [
    { label: "创意脑洞", icon: "💡" },
    { label: "执行力强", icon: "⚡" },
    { label: "文案高手", icon: "✍️" },
    { label: "视觉审美", icon: "🎨" },
    { label: "社牛属性", icon: "🤝" },
    { label: "数据分析", icon: "📊" },
    { label: "细致耐心", icon: "🧘" },
    { label: "逻辑严密", icon: "🧠" },
    { label: "演讲表达", icon: "🎤" },
    { label: "资源丰富", icon: "💰" },
    { label: "摄影摄像", icon: "📷" },
    { label: "技术支持", icon: "💻" }
];

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const TeamSetupModal: React.FC<TeamSetupModalProps> = ({ teamMembers, onUpdateTeam, onConfirm, onSkip }) => {
  const [editingMemberId, setEditingMemberId] = useState<string | null>(teamMembers.length > 0 ? teamMembers[0].id : null);
  const [newTrait, setNewTrait] = useState('');

  const addMember = () => {
    const newMember: TeamMember = {
      id: `tm-${Date.now()}`,
      nickname: '新成员',
      department: '项目部',
      role: '项目官',
      responsibility: '项目执行',
      traits: [],
      status: 'Active',
      scheduleType: 'Fixed',
      unavailablePeriods: [],
      availableWeekdays: [1,2,3,4,5]
    };
    onUpdateTeam([...teamMembers, newMember]);
    setEditingMemberId(newMember.id);
  };

  const updateMember = (id: string, updates: Partial<TeamMember>) => {
    onUpdateTeam(teamMembers.map(m => m.id === id ? { ...m, ...updates } : m));
  };

  const removeMember = (id: string) => {
    if (confirm("确定移除该成员吗？")) {
        const nextMembers = teamMembers.filter(m => m.id !== id);
        onUpdateTeam(nextMembers);
        if (editingMemberId === id) {
            setEditingMemberId(nextMembers.length > 0 ? nextMembers[0].id : null);
        }
    }
  };

  const toggleTrait = (id: string, trait: string) => {
    const member = teamMembers.find(m => m.id === id);
    if (member) {
        const traits = member.traits || [];
        const nextTraits = traits.includes(trait) 
            ? traits.filter(t => t !== trait)
            : [...traits, trait];
        updateMember(id, { traits: nextTraits });
    }
  };

  const handleAddCustomTrait = (id: string) => {
    if (!newTrait.trim()) return;
    const member = teamMembers.find(m => m.id === id);
    if (member) {
        updateMember(id, { traits: Array.from(new Set([...(member.traits || []), newTrait.trim()])) });
        setNewTrait('');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[80] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      {/* Standardized Split Container: 1100px x 640px */}
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1100px] h-[640px] flex overflow-hidden animate-fade-in-up border border-white/50">
        
        {/* Left Side: Decorative Sidebar + Member List */}
        <div className="w-[320px] bg-gradient-to-br from-indigo-900 to-indigo-800 border-r border-indigo-800/50 flex flex-col shrink-0 relative overflow-hidden">
             {/* Decorative Background Elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-purple-500/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2 pointer-events-none"></div>
            <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] pointer-events-none"></div>

            {/* Header Area */}
            <div className="p-6 pb-2 text-white relative z-10 shrink-0">
                <div className="flex items-center gap-3 mb-4">
                    <div className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center font-bold backdrop-blur-sm text-white text-lg">4</div>
                    <span className="font-bold text-lg tracking-wide opacity-90">Team</span>
                </div>
                
                <div className="mb-4">
                     <div className="inline-flex items-center gap-2 px-2.5 py-0.5 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 text-[10px] font-bold text-indigo-100">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
                        Step 4 / 4
                     </div>
                     <h2 className="text-xl font-black mt-2 leading-tight tracking-tight text-white">
                         团队成员配置
                     </h2>
                </div>
            </div>

            {/* List Area - Integrated into Sidebar */}
            <div className="flex-1 flex flex-col min-h-0 relative z-10">
                <div className="flex justify-between items-center px-6 py-2">
                    <h3 className="font-bold text-indigo-200 text-[10px] uppercase tracking-widest">成员列表 ({teamMembers.length})</h3>
                    <button onClick={addMember} className="p-1.5 bg-white/20 text-white rounded-lg hover:bg-white/30 shadow-sm transition-all transform active:scale-95 border border-white/10">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4" /></svg>
                    </button>
                </div>
                <div className="flex-1 overflow-y-auto space-y-2 p-4 pt-0 custom-scrollbar-dark">
                    {teamMembers.map(m => (
                        <div 
                            key={m.id} 
                            onClick={() => setEditingMemberId(m.id)}
                            className={`p-3 rounded-xl border cursor-pointer transition-all group relative overflow-hidden backdrop-blur-sm ${editingMemberId === m.id ? 'bg-white text-indigo-900 border-white shadow-lg' : 'bg-white/5 border-white/10 text-indigo-100 hover:bg-white/10'}`}
                        >
                            <div className="flex justify-between items-center mb-1">
                                <span className="font-bold text-sm truncate">{m.nickname}</span>
                                <span className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${editingMemberId === m.id ? 'bg-indigo-100 text-indigo-600' : 'bg-black/20 text-indigo-200'}`}>{m.status === 'Active' ? '在岗' : '离岗'}</span>
                            </div>
                            <div className={`text-[10px] font-medium truncate flex items-center gap-1 ${editingMemberId === m.id ? 'text-indigo-500' : 'text-indigo-300'}`}>
                                <span>{m.role}</span>
                                <span className="w-0.5 h-0.5 rounded-full bg-current opacity-50"></span>
                                <span>{m.department}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>

        {/* Right Side: Edit Area - Compact & No Scroll */}
        <div className="flex-1 bg-white flex flex-col overflow-hidden">
             {/* Edit Content */}
            <div className="flex-1 p-8 overflow-hidden flex flex-col">
                {editingMemberId ? (
                    <div className="max-w-3xl mx-auto h-full flex flex-col w-full">
                        {(() => {
                            const m = teamMembers.find(item => item.id === editingMemberId);
                            if (!m) return null;
                            return (
                                <>
                                    <div className="flex justify-between items-center border-b border-gray-100 pb-4 mb-4 shrink-0">
                                        <div className="flex items-center gap-4">
                                            <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-2xl shadow-inner border border-indigo-100">
                                                {m.isAI ? '🤖' : '👤'}
                                            </div>
                                            <div>
                                                <h4 className="text-lg font-black text-slate-800 tracking-tight">{m.nickname}</h4>
                                                <div className="flex items-center gap-2 mt-0.5">
                                                    <span className="text-[9px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded font-bold uppercase tracking-wide">{m.isAI ? 'AI 专家' : '人类成员'}</span>
                                                    <span className="text-[9px] text-slate-400 font-bold">ID: {m.id.slice(-4)}</span>
                                                </div>
                                            </div>
                                        </div>
                                        <button onClick={() => removeMember(m.id)} className="text-xs font-bold text-red-400 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg transition-all">移除成员</button>
                                    </div>
                                    
                                    <div className="grid grid-cols-4 gap-4 mb-6 shrink-0">
                                        <div className="col-span-1">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase mb-1.5 block tracking-wider">昵称</label>
                                            <input value={m.nickname} onChange={e => updateMember(m.id, { nickname: e.target.value })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all" />
                                        </div>
                                        <div className="col-span-1">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase mb-1.5 block tracking-wider">职级角色</label>
                                            <select value={m.role} onChange={e => updateMember(m.id, { role: e.target.value as TeamRole })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500"><option>理事长</option><option>秘书长</option><option>总干事</option><option>项目官</option><option>传播官</option><option>财务</option><option>志愿者</option><option>实习生</option></select>
                                        </div>
                                        <div className="col-span-1">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase mb-1.5 block tracking-wider">核心职责</label>
                                            <select value={m.responsibility} onChange={e => updateMember(m.id, { responsibility: e.target.value as MainResponsibility })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500"><option>统筹管理</option><option>项目执行</option><option>传播推广</option><option>后勤支持</option><option>外联募资</option><option>其他</option></select>
                                        </div>
                                        <div className="col-span-1">
                                            <label className="text-[10px] font-bold text-gray-400 uppercase mb-1.5 block tracking-wider">当前状态</label>
                                            <select value={m.status} onChange={e => updateMember(m.id, { status: e.target.value as any })} className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-bold outline-none focus:border-indigo-500"><option value="Active">🟢 在岗 Active</option><option value="Inactive">⚪️ 离岗 Inactive</option></select>
                                        </div>
                                    </div>

                                    <div className="flex-1 min-h-0 flex flex-col bg-slate-50 rounded-2xl p-4 border border-slate-100">
                                        <label className="text-[10px] font-bold text-gray-400 uppercase mb-3 block shrink-0 tracking-wider">核心能力画像 (Traits)</label>
                                        <div className="flex-1 overflow-y-auto custom-scrollbar pr-2">
                                            <div className="grid grid-cols-6 gap-2">
                                                {PRESET_TRAIT_OBJECTS.map(t => {
                                                    const isSelected = (m.traits || []).includes(t.label);
                                                    return (
                                                        <button 
                                                            key={t.label}
                                                            onClick={() => toggleTrait(m.id, t.label)}
                                                            className={`p-2 rounded-lg border transition-all flex flex-col items-center gap-1 shadow-sm group active:scale-95 ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white shadow-indigo-200 ring-2 ring-indigo-100' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300 hover:shadow-md'}`}
                                                        >
                                                            <span className={`text-lg transition-transform group-hover:scale-110 ${isSelected ? 'scale-105' : ''}`}>{t.icon}</span>
                                                            <span className="text-[9px] font-bold tracking-tight">{t.label}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                            <div className="flex gap-2 mt-4">
                                                <input placeholder="输入自定义标签..." value={newTrait} onChange={e => setNewTrait(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleAddCustomTrait(m.id)} className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2 text-xs font-bold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/10 transition-all" />
                                                <button onClick={() => handleAddCustomTrait(m.id)} className="px-4 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-md hover:bg-indigo-700 active:scale-95 transition-all">+</button>
                                            </div>
                                            <div className="flex flex-wrap gap-2 mt-3 pb-2">{(m.traits || []).filter(t => !PRESET_TRAIT_OBJECTS.find(p=>p.label===t)).map((t, i) => (<span key={`${t}-${i}`} className="px-2 py-1 bg-white text-indigo-700 text-[10px] font-bold rounded-lg border border-indigo-100 flex items-center gap-1 shadow-sm">#{t}<button onClick={() => toggleTrait(m.id, t)} className="hover:text-red-500 font-black px-1">&times;</button></span>))}</div>
                                        </div>
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                ) : (
                    <div className="h-full flex flex-col items-center justify-center text-slate-200 italic">
                        <div className="w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center text-4xl mb-4 shadow-inner animate-pulse">🛋️</div>
                        <p className="text-xs font-bold uppercase tracking-[0.2em] text-slate-300">请在左侧列表选择成员进行编辑</p>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="px-8 py-4 border-t border-slate-100 bg-white flex justify-end items-center gap-4 shrink-0">
                 <div className="text-[10px] text-slate-400 font-bold mr-auto flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400"></span>
                    配置完成后，系统将为您生成专属的排期建议
                 </div>
                 <button 
                    onClick={onSkip}
                    className="px-5 py-2.5 rounded-xl text-slate-400 font-bold text-xs hover:bg-slate-50 transition-colors"
                >
                    跳过
                </button>
                 <button 
                    onClick={onConfirm}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-8 rounded-xl shadow-lg shadow-indigo-200 transition-all flex items-center gap-2 text-xs transform active:scale-[0.98]"
                >
                    <span>完成设置</span>
                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                </button>
            </div>
        </div>
      </div>
    </div>
  );
};

export default TeamSetupModal;
