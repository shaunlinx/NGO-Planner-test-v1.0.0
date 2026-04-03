
import React, { useState, useMemo, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CalendarEvent, TeamMember, SavedSchedule, StructuredScheduleData, ScheduleChatMessage, NgoDomain, EventCategory } from '../types';
import { generateScheduleDraft, generateScheduleRefinement } from '../services/geminiService';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../constants';
import { formatDate, addDays } from '../utils/dateUtils';

interface TimelineVisualProps {
  events: CalendarEvent[];
  selectedEventIds: Set<string>;
  onToggleEventSelection: (id: string) => void;
  onBatchEventSelection?: (ids: string[], action: 'select' | 'deselect') => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

type TimeRange = 'Week' | 'Month' | 'Quarter' | 'HalfYear' | 'Year';

const cleanJson = (str: string): string => {
    if (!str) return "";
    let cleaned = str.replace(/```json/gi, '').replace(/```/g, '');
    return cleaned.trim();
};

export const TimelineVisual: React.FC<TimelineVisualProps> = ({ 
    events, 
    selectedEventIds, 
    onToggleEventSelection,
    onBatchEventSelection,
    isCollapsed = false,
    onToggleCollapse
}) => {
  const [range, setRange] = useState<TimeRange>('Quarter');
  const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(new Set());
  const [visibleCategories, setVisibleCategories] = useState<Set<EventCategory>>(new Set(Object.keys(CATEGORY_LABELS) as EventCategory[]));
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const filterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
      const handleClickOutside = (e: MouseEvent) => {
          if (filterRef.current && !filterRef.current.contains(e.target as Node)) {
              setIsFilterOpen(false);
          }
      };
      if (isFilterOpen) document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isFilterOpen]);

  const filteredEvents = useMemo(() => {
      return (events || []).filter(e => visibleCategories.has(e.category));
  }, [events, visibleCategories]);

  const { slots, isDaily } = useMemo(() => {
      const now = new Date();
      const arr = [];
      let isDailyView = false;

      if (range === 'Week') {
          isDailyView = true;
          const day = now.getDay() || 7; 
          const start = new Date(now);
          start.setDate(now.getDate() - day + 1);
          for(let i=0; i<7; i++) {
              const d = new Date(start);
              d.setDate(start.getDate() + i);
              arr.push(d);
          }
      } else if (range === 'Month') {
          isDailyView = true; 
          const year = now.getFullYear();
          const month = now.getMonth();
          const daysInMonth = new Date(year, month + 1, 0).getDate();
          for(let i=1; i<=daysInMonth; i++) {
              arr.push(new Date(year, month, i));
          }
      } else {
          const start = new Date();
          start.setDate(1); 
          const end = new Date();
          end.setDate(1);

          if (range === 'Quarter') end.setMonth(start.getMonth() + 3);
          else if (range === 'HalfYear') end.setMonth(start.getMonth() + 6);
          else end.setMonth(start.getMonth() + 12);

          let curr = new Date(start);
          while (curr < end) {
              arr.push(new Date(curr));
              curr.setMonth(curr.getMonth() + 1);
          }
      }
      return { slots: arr, isDaily: range === 'Week' || range === 'Month' };
  }, [range]);

  const { slotData, maxCount } = useMemo(() => {
      let max = 0;
      const data = slots.map((dateObj) => {
          let keyStr = "";
          let displayLabel = "";
          let slotEvents = [];

          if (isDaily) {
              keyStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth()+1).padStart(2,'0')}-${String(dateObj.getDate()).padStart(2,'0')}`;
              displayLabel = `${dateObj.getMonth()+1}月${dateObj.getDate()}日`;
              slotEvents = filteredEvents.filter(e => e.date === keyStr);
          } else {
              keyStr = `${dateObj.getFullYear()}-${String(dateObj.getMonth()+1).padStart(2,'0')}`;
              displayLabel = `${dateObj.getFullYear()}年 ${dateObj.getMonth()+1}月`;
              slotEvents = filteredEvents.filter(e => e.date.startsWith(keyStr));
          }
          
          if (slotEvents.length > max) max = slotEvents.length;
          return { keyStr, displayLabel, slotEvents };
      });
      return { slotData: data, maxCount: max };
  }, [slots, isDaily, filteredEvents]);

  const toggleBucket = (key: string) => {
      const next = new Set(expandedBuckets);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      setExpandedBuckets(next);
  };

  const handleToggleSlotBatch = (slotEvents: CalendarEvent[]) => {
      if (!onBatchEventSelection || !slotEvents || slotEvents.length === 0) return;
      const ids = slotEvents.map(e => e.id);
      const allSelected = ids.every(id => selectedEventIds.has(id));
      onBatchEventSelection(ids, allSelected ? 'deselect' : 'select');
  };

  return (
    <div className={`flex flex-col bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden transition-all duration-300 ${isCollapsed ? 'h-14' : 'h-full'}`}>
        <div 
            className="px-4 h-14 border-b border-gray-100 grid grid-cols-[1fr_auto_1fr] items-center bg-white shrink-0 cursor-pointer hover:bg-gray-50 transition-colors gap-x-2"
            onClick={onToggleCollapse}
        >
            <div className="flex items-center gap-2 min-w-[100px]">
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isCollapsed ? 'bg-gray-100 text-gray-400' : 'bg-blue-50 text-blue-600'}`}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V19.875c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
                    </svg>
                </div>
                <h3 className="font-bold text-gray-800 text-xs sm:text-sm tracking-tight whitespace-nowrap">节点分布</h3>
            </div>

            <div className="flex justify-center" onClick={e => e.stopPropagation()}>
                {!isCollapsed && (
                    <select value={range} onChange={e => setRange(e.target.value as TimeRange)} className="text-[10px] font-black border border-gray-200 rounded-lg px-2 py-1 bg-white outline-none text-gray-600 shadow-sm">
                        <option value="Week">本周</option>
                        <option value="Month">本月</option>
                        <option value="Quarter">季度</option>
                        <option value="Year">全年</option>
                    </select>
                )}
            </div>

            <div className="flex justify-end min-w-[100px]">
                <span className={`text-gray-300 text-xs transform transition-transform duration-300 shrink-0 ${isCollapsed ? '-rotate-90' : ''}`}>▼</span>
            </div>
        </div>

        {!isCollapsed && (
            <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 custom-scrollbar bg-gray-50/30">
                {slotData.map(({ keyStr, displayLabel, slotEvents }) => {
                    const count = slotEvents ? slotEvents.length : 0;
                    const isExpanded = expandedBuckets.has(keyStr);
                    const barPercent = maxCount > 0 ? (count / maxCount) * 100 : 0;
                    
                    const selectedInSlotCount = slotEvents ? slotEvents.filter(e => selectedEventIds.has(e.id)).length : 0;
                    const isAllSelected = count > 0 && selectedInSlotCount === count;
                    const isIndeterminate = selectedInSlotCount > 0 && selectedInSlotCount < count;

                    return (
                        <div key={keyStr} className="border border-gray-200 rounded-lg bg-white overflow-hidden shadow-sm">
                            <div className="flex items-center justify-between px-3 py-2 bg-gray-50/50 hover:bg-gray-100 transition-colors cursor-pointer" onClick={() => toggleBucket(keyStr)}>
                                <div className="flex items-center gap-2 flex-1">
                                    <span className="text-gray-400 text-[10px]">{isExpanded ? '▼' : '▶'}</span>
                                    <span className="font-bold text-xs text-gray-700">{displayLabel}</span>
                                    <div className="flex-1 flex items-center gap-2 ml-2 max-w-[120px]">
                                        <div className="h-1.5 flex-1 bg-gray-200 rounded-full overflow-hidden">
                                            <div className="h-full bg-ngo-teal rounded-full" style={{ width: `${barPercent}%` }}></div>
                                        </div>
                                        <span className="text-[9px] font-mono text-gray-500">{count}</span>
                                    </div>
                                </div>
                                
                                {count > 0 && (
                                    <div 
                                        className="flex items-center pl-2 ml-1 border-l border-gray-200 h-6" 
                                        onClick={e => e.stopPropagation()}
                                        onPointerDown={e => e.stopPropagation()}
                                    >
                                        <input 
                                            type="checkbox"
                                            checked={isAllSelected}
                                            ref={el => { if (el) el.indeterminate = isIndeterminate; }}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                handleToggleSlotBatch(slotEvents);
                                            }}
                                            className="w-4 h-4 rounded text-indigo-600 border-gray-300 focus:ring-indigo-500 transition-all cursor-pointer"
                                            title={isAllSelected ? "取消全选" : "全选本期"}
                                        />
                                    </div>
                                )}
                            </div>
                            
                            {isExpanded && (
                                <div className="p-2 space-y-1 bg-white border-t border-gray-100">
                                    {(slotEvents || []).map(evt => (
                                        <div key={evt.id} onClick={() => onToggleEventSelection(evt.id)} className={`flex items-center gap-2 p-2 rounded border text-xs cursor-pointer transition-all ${selectedEventIds.has(evt.id) ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-100 hover:bg-gray-50'}`}>
                                            <input 
                                                type="checkbox" 
                                                checked={selectedEventIds.has(evt.id)} 
                                                onChange={(e) => e.stopPropagation()} 
                                                className="w-3.5 h-3.5 rounded text-ngo-teal border-gray-300 focus:ring-ngo-teal transition-all" 
                                            />
                                            <span className={`truncate flex-1 ${selectedEventIds.has(evt.id) ? 'font-bold text-indigo-700' : 'text-gray-600'}`}>{evt.title}</span>
                                            <span className="text-[9px] text-gray-400 font-mono">{evt.date.split('-').slice(1).join('/')}</span>
                                        </div>
                                    ))}
                                    {count === 0 && <div className="text-center py-4 text-[10px] text-gray-400 italic">该周期内无公益节点</div>}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        )}
    </div>
  );
};

interface ScheduleSession {
    id: string;
    title: string;
    isMinimized: boolean;
    existingSchedule?: SavedSchedule;
    isRefining?: boolean; 
}

interface AIScheduleManagerProps {
    events: CalendarEvent[];
    teamMembers: TeamMember[];
    domain: NgoDomain[]; 
    schedules: SavedSchedule[]; 
    onUpdateSchedules: (schedules: SavedSchedule[]) => void;
    onAddEvents: (newEvents: CalendarEvent[]) => void; 
    selectedEventIds: Set<string>;
    onToggleEventSelection: (id: string) => void;
    isCollapsed?: boolean;
    onToggleCollapse?: () => void;
}

export const AIScheduleManager: React.FC<AIScheduleManagerProps> = ({ 
    events, teamMembers, domain, schedules, onUpdateSchedules, onAddEvents, selectedEventIds, onToggleEventSelection, isCollapsed = false, onToggleCollapse
}) => {
    const [sessions, setSessions] = useState<ScheduleSession[]>([]);
    const [showHistory, setShowHistory] = useState(false);

    const handleCreateSession = (existing?: SavedSchedule, isRefining = false) => {
        const id = `session-${Date.now()}`;
        setSessions(prev => [...prev, { id, title: existing?.title || '新排期分析...', isMinimized: false, existingSchedule: existing, isRefining }]);
        if(isCollapsed && onToggleCollapse) onToggleCollapse();
    };

    const handleCloseSession = (id: string) => setSessions(prev => prev.filter(s => s.id !== id));
    const handleMinimizeSession = (id: string) => setSessions(prev => prev.map(s => s.id === id ? { ...s, isMinimized: true } : s));
    const handleRestoreSession = (id: string) => setSessions(prev => prev.map(s => s.id === id ? { ...s, isMinimized: false } : s));

    const handleSaveOrUpdate = (schedule: SavedSchedule) => {
        const exists = (schedules || []).find(s => s.id === schedule.id);
        const next = exists ? schedules.map(s => s.id === schedule.id ? schedule : s) : [schedule, ...(schedules || [])];
        onUpdateSchedules(next);

        if (schedule.isStructured && schedule.content) {
            try {
                const data: StructuredScheduleData = JSON.parse(schedule.content);
                const calendarEvents: CalendarEvent[] = (Array.isArray(data.tasks) ? data.tasks : []).map((t, i) => ({
                    id: `ai-task-${schedule.id}-${i}`,
                    title: `[${t.ownerName}] ${t.title}`,
                    date: t.date,
                    category: 'Custom',
                    isCustom: true,
                    description: `由排期方案“${schedule.title}”自动生成。角色：${t.role}`,
                    priority: { isImportant: t.priority === 'High', isUrgent: t.priority === 'High' },
                    suggestedLead: t.ownerName,
                    linkedScheduleId: schedule.id,
                    locked: false
                }));
                onAddEvents(calendarEvents);
            } catch (e) { console.error("Sync to calendar failed", e); }
        }
    };

    const handleDeleteSaved = (id: string, e?: React.MouseEvent) => {
        e?.stopPropagation();
        if (confirm('确定删除此排期方案吗？')) onUpdateSchedules((schedules || []).filter(s => s.id !== id));
    };

    const minimizedSessions = sessions.filter(s => s.isMinimized);

    return (
        <div className={`bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col overflow-hidden relative transition-all duration-300 ${isCollapsed ? 'h-14' : 'h-full'}`}>
            <div className="px-4 h-14 border-b border-gray-100 grid grid-cols-[1fr_auto_1fr] items-center bg-white shrink-0 cursor-pointer hover:bg-gray-50 transition-colors gap-x-2" onClick={onToggleCollapse}>
                <div className="flex items-center gap-2 min-w-[80px] sm:min-w-[100px]">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isCollapsed ? 'bg-gray-100 text-gray-400' : 'bg-purple-50 text-purple-600'}`}>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                        </svg>
                    </div>
                    <h3 className="font-bold text-gray-800 text-xs sm:text-sm tracking-tight whitespace-nowrap">智能排期</h3>
                </div>

                <div className="flex justify-center overflow-hidden" onClick={e => e.stopPropagation()}>
                    {!isCollapsed && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); setShowHistory(!showHistory); }} 
                            className="text-[10px] bg-indigo-50 text-indigo-600 px-3 py-1 rounded-lg font-black border border-indigo-100 hover:bg-indigo-100 transition-colors shadow-sm shrink-0 whitespace-nowrap"
                        >
                            历史
                        </button>
                    )}
                </div>

                <div className="flex items-center justify-end gap-2 min-w-[80px] sm:min-w-[100px]" onClick={e => e.stopPropagation()}>
                    {!isCollapsed && (
                        <button 
                            onClick={(e) => { e.stopPropagation(); handleCreateSession(); }} 
                            className="text-[10px] bg-indigo-600 text-white px-3 py-1 rounded-lg font-black hover:bg-indigo-700 shadow-md transition-all shrink-0 whitespace-nowrap"
                        >
                            + 新建
                        </button>
                    )}
                    <span className={`text-gray-300 text-xs transform transition-transform duration-300 shrink-0 ${isCollapsed ? '-rotate-90' : ''}`} onClick={onToggleCollapse}>▼</span>
                </div>
            </div>

            {showHistory && !isCollapsed && (
                <div className="absolute top-14 left-0 w-full bg-white z-20 border-b border-gray-200 p-2 space-y-1 animate-fade-in shadow-xl">
                    <div className="text-[10px] text-gray-400 font-bold px-1 mb-1">已保存方案 ({(schedules || []).length})</div>
                    {(schedules || []).map(sch => (
                        <div key={sch.id} onClick={() => { handleCreateSession(sch); setShowHistory(false); }} className="p-2 border rounded hover:bg-indigo-50 flex justify-between items-center cursor-pointer transition-colors border-gray-100">
                            <div className="min-w-0 flex-1"><div className="text-xs font-bold truncate text-gray-700">{sch.title}</div><div className="text-[9px] text-gray-400">{sch.rangeLabel}</div></div>
                            <button onClick={(e) => handleDeleteSaved(sch.id, e)} className="text-gray-300 hover:text-red-500 px-1 text-lg leading-none">&times;</button>
                        </div>
                    ))}
                    {(schedules || []).length === 0 && <div className="text-center py-6 text-xs text-gray-400">暂无排期记录</div>}
                    <button onClick={() => setShowHistory(false)} className="w-full text-center py-1 text-[10px] text-indigo-600 hover:bg-indigo-50 border-t border-gray-50 mt-1 font-black">收起 ▲</button>
                </div>
            )}

            {!isCollapsed && (
                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-gray-50/30">
                    {minimizedSessions.map(s => (
                        <div key={s.id} onClick={() => handleRestoreSession(s.id)} className="bg-white p-3 rounded-xl border border-indigo-100 flex justify-between items-center cursor-pointer hover:shadow-md transition-all group animate-fade-in">
                            <div className="flex items-center gap-3">
                                <div className="w-2 h-2 rounded-full bg-indigo-500 animate-pulse"></div>
                                <div>
                                    <div className="text-xs font-bold text-gray-700 truncate max-w-[150px]">{s.title}</div>
                                    <div className="text-[9px] text-gray-400">正在后台分析...</div>
                                </div>
                            </div>
                            <button onClick={(e) => { e.stopPropagation(); handleCloseSession(s.id); }} className="text-gray-300 hover:text-red-500 text-lg">&times;</button>
                        </div>
                    ))}
                    {minimizedSessions.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-gray-400 opacity-40">
                             <div className="text-5xl mb-4">🗓️</div>
                             <p className="text-xs font-bold">请选择上方“新建”开始 AI 规划</p>
                             <p className="text-[10px] mt-1">支持基于团队分工和节日节点的自动排期</p>
                        </div>
                    )}
                </div>
            )}

            {sessions.map(s => !s.isMinimized && (
                <ScheduleModal key={s.id} visible={true} onClose={() => handleCloseSession(s.id)} onMinimize={() => handleMinimizeSession(s.id)} 
                    events={events} selectedEventIds={selectedEventIds} teamMembers={teamMembers} domain={domain} 
                    existingSchedule={s.existingSchedule || null} onSave={handleSaveOrUpdate} onToggleEventSelection={onToggleEventSelection} />
            ))}
        </div>
    );
};

const ScheduleModal: React.FC<{
    visible: boolean; onClose: () => void; onMinimize: () => void;
    events: CalendarEvent[]; selectedEventIds: Set<string>; teamMembers: TeamMember[]; domain: NgoDomain[];
    existingSchedule: SavedSchedule | null; onSave: (s: SavedSchedule) => void; onToggleEventSelection: (id: string) => void;
}> = ({ visible, onClose, onMinimize, events, selectedEventIds, teamMembers, domain, existingSchedule, onSave, onToggleEventSelection }) => {
    const [step, setStep] = useState<'CONFIG' | 'DRAFT' | 'FINAL'>('CONFIG');
    
    const rollingRanges = useMemo(() => {
        return [
            { label: '未来 30 天 (月度滚动)', days: 30 },
            { label: '未来 90 天 (季度滚动)', days: 90 },
            { label: '未来 180 天 (半年度滚动)', days: 180 },
            { label: '未来 365 天 (年度滚动)', days: 365 },
        ];
    }, []);

    const [rangeIdx, setRangeIdx] = useState(1);
    const selectedRange = rollingRanges[rangeIdx];

    const [messages, setMessages] = useState<ScheduleChatMessage[]>(existingSchedule?.chatHistory || []);
    const [input, setInput] = useState('');
    const [loading, setLoading] = useState(false);
    const [structuredData, setStructuredData] = useState<StructuredScheduleData | null>(null);
    const [filePayload, setFilePayload] = useState<{ name: string, data: string, mimeType: string } | null>(null);
    const scrollRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (existingSchedule?.isStructured && existingSchedule.content) {
            try { setStructuredData(JSON.parse(existingSchedule.content)); setStep('FINAL'); } catch (e) { console.error(e); }
        } else if (existingSchedule) { setStep('DRAFT'); }
    }, [existingSchedule]);

    useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight; }, [messages]);

    const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            setFilePayload({ name: file.name, data: base64, mimeType: file.type });
        };
        reader.readAsDataURL(file);
    };

    const handleStartDraft = async () => {
        setLoading(true);
        setStep('DRAFT');
        try {
            const selEvents = (events || []).filter(e => selectedEventIds.has(e.id));
            const teamInfo = teamMembers.map(m => {
                const traits = (m.traits || []).join(', ') || '通用能力';
                const unavail = (m.unavailablePeriods || []).map(p => `${p.start}~${p.end}`).join('; ') || '无固定忙时';
                return `${m.nickname}(${m.role}: ${m.responsibility}) [能力: ${traits}] [忙时: ${unavail}]`;
            }).join('\n');

            const baseContext = `目标周期: ${selectedRange.label} (起止: ${formatDate(new Date())} ~ ${formatDate(addDays(new Date(), selectedRange.days))})
            团队背景: 
            ${teamInfo}
            选定节点 (Milestones):
            ${selEvents.map(e=> `- ${e.title} (${e.date}) [重要性: ${e.priority?.isImportant?'高':'普通'}]`).join('\n')}`;
            
            const responseText = await generateScheduleDraft(selEvents, domain, selectedRange.label, filePayload, baseContext);
            setMessages([{ id: `sys-${Date.now()}`, role: 'model', text: responseText, timestamp: Date.now() }]);
        } catch (e: any) { alert("草稿生成失败: " + e.message); setStep('CONFIG'); } finally { setLoading(false); }
    };

    const handleChatRefine = async () => {
        if (!input.trim() || loading) return;
        const userMsg: ScheduleChatMessage = { id: Date.now().toString(), role: 'user', text: input, timestamp: Date.now() };
        setMessages(prev => [...prev, userMsg]);
        const userCommand = input;
        setInput('');
        setLoading(true);

        try {
            const history = messages.map(m => `${m.role === 'user' ? '用户' : '助理'}: ${m.text}`).join('\n');
            const refinementPrompt = `【重要提示】你只能在“任务分配逻辑”、“各阶段时间长短”和“策略细节”上进行微调。
            ❌ 严禁修改以下导入的既定条件：
            - 目标周期 (${selectedRange.label})
            - 已选定的核心节点 (Milestones)
            - 团队成员构成
            
            历史对话:
            ${history}
            
            最新指令: ${userCommand}
            请返回优化后的排期大纲 Markdown 文本。`;

            const responseText = await generateScheduleDraft([], [], "", undefined, refinementPrompt);
            setMessages(prev => [...prev, { id: (Date.now()+1).toString(), role: 'model', text: responseText, timestamp: Date.now() }]);
        } catch (e: any) { alert("优化失败: " + e.message); } finally { setLoading(false); }
    };

    const handleFinalize = async () => {
        const lastModel = [...messages].reverse().find(m => m.role === 'model');
        if (!lastModel || loading) return;
        setLoading(true);
        try {
            const jsonStr = await generateScheduleRefinement(lastModel.text, teamMembers, selectedRange.label);
            const data: StructuredScheduleData = JSON.parse(cleanJson(jsonStr));
            setStructuredData(data);
            setStep('FINAL');
        } catch (e: any) { alert("结构化解析失败，建议重试或细化草稿描述: " + e.message); } finally { setLoading(false); }
    };

    const handleSave = () => {
        if (!structuredData) return;
        const next: SavedSchedule = {
            id: existingSchedule?.id || `sch-${Date.now()}`,
            title: `智能排期: ${selectedRange.label}`,
            content: JSON.stringify(structuredData),
            isStructured: true,
            chatHistory: messages,
            createdAt: Date.now(),
            rangeLabel: selectedRange.label,
            status: 'Active'
        };
        onSave(next);
        onClose();
    };

    if (!visible) return null;

    return (
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white rounded-[2.5rem] shadow-2xl w-full max-w-6xl h-[85vh] flex flex-col overflow-hidden animate-fade-in-up border border-white/20">
                <div className="bg-indigo-600 p-6 text-white shrink-0">
                    <div className="flex justify-between items-start mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center text-2xl shadow-inner">🤖</div>
                            <div>
                                <h3 className="font-black text-lg tracking-tight">AI 智能排期专家</h3>
                                <p className="text-[10px] text-indigo-200 font-bold uppercase tracking-widest mt-0.5">Active Coordination & Resource Planning</p>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <button onClick={onMinimize} className="px-4 py-1.5 hover:bg-white/10 rounded-xl transition-all text-xs font-bold border border-white/20">后台运行</button>
                            <button onClick={onClose} className="text-white text-3xl leading-none px-2 hover:text-white/70 transition-all">&times;</button>
                        </div>
                    </div>

                    <div className="flex items-center justify-between max-w-3xl mx-auto relative px-10">
                        <div className="absolute top-1/2 left-10 right-10 h-0.5 bg-white/20 -translate-y-1/2"></div>
                        {[
                            { id: 'CONFIG', label: '1. 配置背景', icon: '⚙️' },
                            { id: 'DRAFT', label: '2. 策略大纲', icon: '📝' },
                            { id: 'FINAL', label: '3. 任务同步', icon: '📅' }
                        ].map((s, idx) => {
                            const isActive = step === s.id;
                            const isPast = (step === 'DRAFT' && s.id === 'CONFIG') || (step === 'FINAL' && s.id !== 'FINAL');
                            return (
                                <div key={s.id} className="relative z-10 flex flex-col items-center gap-2">
                                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all border-4 ${isActive ? 'bg-white text-indigo-600 border-indigo-400 scale-110 shadow-lg' : isPast ? 'bg-indigo-400 text-white border-indigo-500' : 'bg-indigo-700 text-indigo-300 border-indigo-800'}`}>
                                        {isPast ? '✓' : idx + 1}
                                    </div>
                                    <span className={`text-[10px] font-black uppercase tracking-widest ${isActive ? 'text-white' : 'text-indigo-300'}`}>{s.label}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {step === 'CONFIG' && (
                        <div className="flex-1 overflow-y-auto custom-scrollbar p-10 bg-slate-50/50">
                            <div className="max-w-4xl mx-auto flex gap-10">
                                <div className="flex-1 space-y-6">
                                    <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm">
                                        <h4 className="text-sm font-black text-slate-800 mb-3 flex items-center gap-2">
                                            <span className="text-indigo-500">💡</span> 智能排期解决什么？
                                        </h4>
                                        <p className="text-xs text-slate-500 leading-relaxed font-bold">
                                            由于一个节点只是任务的终点，但往往需要根据目标的轻重缓急和周期内团队成员、节点密度等因素预留合适的档期保证实现该目标。因此：
                                            <br/><br/>
                                            1. 智能排期解决的是围绕多个节点，如何协调时间保障多个节点能够彼此不撞车或堆积的情况下顺利进行；
                                            <br/>
                                            2. 当节点出现变化，如新增或减少，通过重新建立排期即可智能调整。
                                        </p>
                                    </div>

                                    <div className="bg-indigo-50/50 p-6 rounded-3xl border border-indigo-100/50">
                                        <label className="block text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-3">目标周期 (基于当前时间滚动)</label>
                                        <div className="grid grid-cols-2 gap-3">
                                            {rollingRanges.map((r, i) => (
                                                <button 
                                                    key={i} 
                                                    onClick={() => setRangeIdx(i)}
                                                    className={`p-4 rounded-2xl border-2 text-left transition-all ${rangeIdx === i ? 'bg-white border-indigo-500 shadow-md ring-4 ring-indigo-50' : 'bg-white/50 border-white text-slate-400 hover:border-slate-200'}`}
                                                >
                                                    <div className={`text-xs font-black ${rangeIdx === i ? 'text-indigo-600' : ''}`}>{r.label}</div>
                                                    <div className="text-[10px] opacity-60 mt-1">预计截止: {formatDate(addDays(new Date(), r.days))}</div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>

                                <div className="w-96 space-y-6">
                                    <div className="bg-white p-6 rounded-3xl border border-slate-100 shadow-sm h-[400px] flex flex-col">
                                        <div className="flex justify-between items-center mb-4 shrink-0">
                                            <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest">确认参与节点 ({selectedEventIds.size})</label>
                                            <span className="text-[9px] bg-slate-100 px-2 py-0.5 rounded text-slate-500 font-bold">请在主页面勾选</span>
                                        </div>
                                        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2 pr-2">
                                            {(events || []).filter(e=>selectedEventIds.has(e.id)).map(e=>(
                                                <div key={e.id} className="bg-slate-50 p-3 rounded-xl border border-slate-100 group flex items-center justify-between">
                                                    <div className="min-w-0">
                                                        <div className="text-xs font-bold text-slate-700 truncate">{e.title}</div>
                                                        <div className="text-[9px] text-slate-400 font-mono mt-0.5">{e.date}</div>
                                                    </div>
                                                    <button onClick={()=>onToggleEventSelection(e.id)} className="text-slate-300 hover:text-red-500 transition-colors opacity-0 group-hover:opacity-100">&times;</button>
                                                </div>
                                            ))}
                                            {selectedEventIds.size === 0 && (
                                                <div className="h-full flex flex-col items-center justify-center text-slate-300 italic p-6 text-center">
                                                    <div className="text-4xl mb-3 opacity-20">📍</div>
                                                    <p className="text-[10px] leading-relaxed">当前未选中任何节点。AI 将为您生成通用的团队日常工作节奏建议。</p>
                                                </div>
                                            )}
                                        </div>
                                        
                                        <div 
                                            onClick={()=>fileInputRef.current?.click()}
                                            className="mt-4 border-2 border-dashed border-slate-200 rounded-2xl p-4 text-center hover:bg-indigo-50 hover:border-indigo-400 transition-all cursor-pointer bg-slate-50/50 shrink-0"
                                        >
                                            <input type="file" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
                                            {filePayload ? (
                                                <div className="flex items-center justify-center gap-2">
                                                    <span className="text-indigo-600 font-bold text-[10px]">📄 {filePayload.name}</span>
                                                    <button onClick={(e)=>{e.stopPropagation(); setFilePayload(null)}} className="text-red-400 text-sm">&times;</button>
                                                </div>
                                            ) : (
                                                <div className="text-[10px] text-slate-400 font-bold">🖇️ 挂载辅助排期文档 (可选)</div>
                                            )}
                                        </div>
                                    </div>

                                    <button 
                                        onClick={handleStartDraft}
                                        disabled={loading}
                                        className="w-full bg-slate-900 text-white py-5 rounded-[2rem] font-black text-sm shadow-xl shadow-slate-200 hover:bg-black transition-all transform active:scale-95 flex items-center justify-center gap-3"
                                    >
                                        {loading ? <span className="animate-spin text-lg">⏳</span> : '⚡'}
                                        {loading ? 'AI 正在深度思考规划中...' : '启动智能策略分析'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    {step === 'DRAFT' && (
                        <div className="flex-1 flex overflow-hidden">
                            <div className="flex-1 flex flex-col border-r border-slate-100 bg-white shadow-inner">
                                <div className="p-4 bg-slate-50 border-b border-slate-100 shrink-0 flex justify-between items-center px-8">
                                    <h4 className="font-black text-[10px] text-slate-400 uppercase tracking-widest flex items-center gap-2">
                                        <span className="w-2 h-2 bg-indigo-500 rounded-full animate-pulse"></span>
                                        排期策略对话调优
                                    </h4>
                                    <button onClick={()=>setStep('CONFIG')} className="text-[10px] font-black text-indigo-600 hover:underline">← 返回配置</button>
                                </div>
                                <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-white custom-scrollbar" ref={scrollRef}>
                                    {messages.map(m => (
                                        <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                            <div className={`max-w-[85%] px-6 py-4 rounded-[2rem] text-sm shadow-sm leading-relaxed ${m.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-slate-50 border border-slate-100 text-slate-700 rounded-tl-none'}`}>
                                                <div className="markdown-prose prose-sm prose-indigo">
                                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                    {loading && <div className="text-center py-4"><span className="animate-pulse text-[10px] text-indigo-500 font-black tracking-widest uppercase">Expert Advisor is thinking...</span></div>}
                                </div>
                                <div className="p-6 bg-white border-t border-slate-100">
                                    <div className="max-w-4xl mx-auto flex gap-3 relative">
                                        <input value={input} onChange={e=>setInput(e.target.value)} onKeyDown={e=>e.key==='Enter'&&handleChatRefine()} placeholder="输入优化指令，例如: '将第二阶段时间延长' 或 '减轻项目官在6月的压力'..." className="flex-1 border border-slate-200 rounded-full px-8 py-4 text-sm focus:ring-4 focus:ring-indigo-100 outline-none transition-all shadow-inner bg-slate-50/50" />
                                        <button onClick={handleChatRefine} disabled={loading||!input.trim()} className="bg-slate-900 text-white p-4 rounded-full hover:bg-black disabled:opacity-50 shadow-lg transform active:scale-90 transition-all flex items-center justify-center">
                                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" /></svg>
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div className="w-80 bg-slate-50 p-8 shrink-0 flex flex-col justify-center text-center space-y-6 animate-fade-in-right">
                                <div className="w-24 h-24 bg-white text-indigo-600 rounded-[2.5rem] flex items-center justify-center text-4xl mx-auto shadow-xl border border-white">🪄</div>
                                <h4 className="font-black text-slate-800 text-lg leading-tight uppercase tracking-tight">确认策略大纲？</h4>
                                <p className="text-xs text-slate-500 leading-relaxed font-bold italic">
                                    对生成的策略路径满意后，点击下方按钮，AI 将根据大纲为您解析具体的任务明细、建议执行日期及对应负责人。
                                </p>
                                <button 
                                    onClick={handleFinalize}
                                    disabled={loading || messages.length === 0}
                                    className="bg-indigo-600 text-white py-5 rounded-[2rem] font-black text-sm hover:bg-indigo-700 shadow-xl shadow-indigo-100 transition-all disabled:opacity-50"
                                >
                                    {loading ? '正在精细解析...' : '转化为日历任务 🚀'}
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 'FINAL' && structuredData && (
                        <div className="flex-1 flex flex-col bg-white overflow-hidden animate-fade-in-right">
                            <div className="p-6 border-b border-slate-100 flex justify-between items-center bg-white shrink-0 px-10">
                                <div>
                                    <h4 className="text-sm font-black text-slate-800 uppercase tracking-tight">📋 结构化任务看板预览</h4>
                                    <p className="text-[10px] text-slate-400 font-bold mt-0.5">即将同步：{(Array.isArray(structuredData.tasks) ? structuredData.tasks : []).length} 个子任务至日历</p>
                                </div>
                                <div className="flex gap-3">
                                    <button onClick={()=>setStep('DRAFT')} className="px-6 py-2 rounded-2xl border-2 border-slate-100 text-xs font-black text-slate-400 hover:bg-slate-50 transition-all">← 调整草稿</button>
                                    <button onClick={handleSave} className="bg-slate-900 text-white px-8 py-2 rounded-2xl text-xs font-black shadow-xl hover:bg-black transition-all flex items-center gap-2">确认并保存 💾</button>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-10 space-y-12 custom-scrollbar bg-slate-50/30">
                                <section>
                                    <h5 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4 flex items-center gap-2">
                                        <span className="w-1 h-3 bg-indigo-400 rounded-full"></span> 战略规划概览
                                    </h5>
                                    <div className="text-xs text-slate-600 leading-relaxed bg-white p-6 rounded-[2rem] border border-slate-100 shadow-sm font-bold prose prose-sm max-w-none">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{structuredData.overview}</ReactMarkdown>
                                    </div>
                                </section>

                                <section>
                                    <h5 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                                        <span className="w-1 h-3 bg-indigo-400 rounded-full"></span> 任务分配与日历对齐
                                    </h5>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {(Array.isArray(structuredData.tasks) ? structuredData.tasks : []).map((t, idx) => (
                                            <div key={idx} className="flex items-center gap-4 p-5 bg-white rounded-3xl border border-slate-100 group hover:border-indigo-400 hover:shadow-xl transition-all animate-fade-in-up">
                                                <div className={`w-2 h-10 rounded-full shrink-0 ${t.priority === 'High' ? 'bg-red-500' : 'bg-slate-200'}`}></div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center justify-between mb-1.5">
                                                        <span className="text-[10px] font-black text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-lg">{t.date}</span>
                                                        <span className={`text-[8px] px-2 py-0.5 rounded-full uppercase font-black ${t.type === 'Milestone' ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-400'}`}>
                                                            {t.type === 'Milestone' ? '里程碑' : '子任务'}
                                                        </span>
                                                    </div>
                                                    <div className="text-xs font-black text-slate-800 truncate mb-1">{t.title}</div>
                                                    <div className="text-[9px] text-slate-400 font-bold flex items-center gap-2">
                                                        👤 {t.ownerName} <span className="opacity-30">|</span> {t.role}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </section>

                                {Array.isArray(structuredData.roleGuidance) && (
                                    <section>
                                        <h5 className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-5 flex items-center gap-2">
                                            <span className="w-1 h-3 bg-indigo-400 rounded-full"></span> 团队协作关键建议
                                        </h5>
                                        <div className="space-y-4">
                                            {(structuredData.roleGuidance).map((g, idx) => (
                                                <div key={idx} className="bg-white border border-slate-100 rounded-[2rem] p-6 shadow-sm group hover:shadow-md transition-all">
                                                    <div className="text-xs font-black text-indigo-600 mb-2 flex items-center gap-2">【{g.role}】<span className="text-slate-300 font-normal">工作重点: {g.focus}</span></div>
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-2 mt-4">
                                                        {(Array.isArray(g.tips) ? g.tips : []).map((tip, ti) => (
                                                            <div key={ti} className="text-[10px] text-slate-500 flex gap-2 font-bold leading-relaxed">
                                                                <span className="text-indigo-300 font-black">•</span> {tip}
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </section>
                                )}
                                <div className="h-20"></div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
            <style>{`
                @keyframes fadeInRight { from { opacity: 0; transform: translateX(20px); } to { opacity: 1; transform: translateX(0); } }
                .animate-fade-in-right { animation: fadeInRight 0.4s ease-out forwards; }
                .custom-scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
                .custom-scrollbar::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 10px; }
            `}</style>
        </div>
    );
};
