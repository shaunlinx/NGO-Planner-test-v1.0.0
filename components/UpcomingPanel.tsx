
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { CalendarEvent, TeamMember, SavedSchedule, StructuredScheduleData } from '../types';
import { formatDate, addDays } from '../utils/dateUtils';

interface UpcomingPanelProps {
  currentDate: Date;
  events: CalendarEvent[];
  teamMembers: TeamMember[];
  savedSchedules: SavedSchedule[]; // Active AI schedules
  onEventClick: (event: CalendarEvent) => void;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
  focusedDate?: Date | null;
}

interface EnrichedTaskItem {
    id: string;
    type: 'Task' | 'Event';
    date: string;
    title: string;
    description?: string;
    role?: string;
    phase?: string;
    priority?: string;
    originalEvent?: CalendarEvent;
}

const UpcomingPanel: React.FC<UpcomingPanelProps> = ({ 
    currentDate, 
    events, 
    teamMembers, 
    savedSchedules, 
    onEventClick,
    isCollapsed = false,
    onToggleCollapse,
    focusedDate
}) => {
  const [viewRange, setViewRange] = useState<7 | 30>(7);
  const [selectedRole, setSelectedRole] = useState<string>(''); // Empty means "Team View" (All)
  const [expandedTask, setExpandedTask] = useState<string | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
      if (focusedDate) {
          const dateStr = formatDate(focusedDate);
          // Find the first item with this date
          const targetId = displayItems.find(i => i.date === dateStr)?.id;
          if (targetId && itemRefs.current[targetId]) {
              itemRefs.current[targetId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              // Expand it for better visibility
              setExpandedTask(targetId);
          }
      }
  }, [focusedDate]);

  const startDate = formatDate(currentDate);
  const endDate = formatDate(addDays(currentDate, viewRange));

  const aiTasks = useMemo(() => {
      if (!selectedRole || savedSchedules.length === 0) return [];
      const tasks: EnrichedTaskItem[] = [];
      savedSchedules.filter(s => s.status === 'Active' && s.isStructured).forEach(schedule => {
          try {
              const data: StructuredScheduleData = JSON.parse(schedule.content);
              if (!data.tasks || !Array.isArray(data.tasks)) return;
              const userTasks = data.tasks.filter(t => (t.ownerName || '').includes(selectedRole) || selectedRole.includes(t.ownerName || ''));
              userTasks.forEach(t => {
                  const matchedEvent = events.find(e => 
                      (e.title.includes(t.title) || t.title.includes(e.title)) &&
                      e.date >= startDate && e.date <= endDate
                  );
                  if (matchedEvent) {
                      const phaseInfo = data.phases?.find(p => p.name === t.phaseName);
                      tasks.push({
                          id: `ai-task-${t.title}-${Math.random()}`,
                          type: 'Task',
                          date: matchedEvent.date,
                          title: t.title,
                          description: `[${t.phaseName}] ${t.title} - 目标: ${schedule.rangeLabel}`,
                          role: t.role,
                          phase: phaseInfo?.timeRange || '未知周期',
                          priority: t.priority,
                          originalEvent: matchedEvent
                      });
                  }
              });
          } catch (e) { console.error("Error parsing schedule for tasks", e); }
      });
      return tasks;
  }, [selectedRole, savedSchedules, events, startDate, endDate]);

  const standardEvents = useMemo(() => {
      return events
        .filter(e => e.date >= startDate && e.date <= endDate)
        .map(e => ({
            id: e.id,
            type: 'Event' as const,
            date: e.date,
            title: e.title,
            description: e.category === 'Custom' ? '自定义节点' : '公共/公益节点',
            priority: e.priority?.isImportant && e.priority?.isUrgent ? 'High' : 'Normal',
            originalEvent: e
        }));
  }, [events, startDate, endDate]);

  const displayItems = useMemo(() => {
      let items: EnrichedTaskItem[] = [];
      if (selectedRole) {
          items = [...aiTasks];
          const assignedEvents = standardEvents.filter(e => (e.originalEvent?.suggestedLead || '').includes(selectedRole));
          const aiEventIds = new Set(aiTasks.map(t => t.originalEvent?.id));
          assignedEvents.forEach(e => { if (!aiEventIds.has(e.originalEvent?.id)) items.push({ ...e, description: '👤 被指派的负责人' }); });
      } else { items = standardEvents; }
      return items.sort((a, b) => a.date.localeCompare(b.date));
  }, [selectedRole, aiTasks, standardEvents]);

  const getCategoryLabel = (cat: string) => {
    switch(cat) {
        case 'InternationalDay': return '公益日';
        case 'Traditional': return '传统';
        case 'SolarTerm': return '节气';
        case 'PublicHoliday': return '假日';
        case 'Custom': return '自定义';
        default: return '其他';
    }
  };

  return (
    <div className={`bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col transition-all duration-300 ${isCollapsed ? 'h-14' : 'h-full'}`}>
      {/* 三段式对称页眉布局 - 优化最小宽度以保护标题 */}
      <div 
        className="px-4 h-14 border-b border-gray-100 bg-white rounded-t-xl shrink-0 grid grid-cols-[minmax(100px,_1fr)_auto_minmax(100px,_1fr)] items-center cursor-pointer hover:bg-gray-50/50 transition-colors gap-x-2"
        onClick={onToggleCollapse}
      >
        {/* 左侧：图标与标题 */}
        <div className="flex items-center gap-2 min-w-[100px]">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isCollapsed ? 'bg-gray-100 text-gray-400' : 'bg-ngo-teal/10 text-ngo-teal'}`}>
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                </svg>
            </div>
            <h3 className="font-bold text-gray-800 text-xs sm:text-sm tracking-tight whitespace-nowrap">
                近期任务
            </h3>
        </div>
        
        {/* 中间：核心切换组件 (绝对居中) */}
        <div className="flex justify-center" onClick={e => e.stopPropagation()}>
            {!isCollapsed && (
                <div className="flex bg-gray-100 p-0.5 rounded-lg shrink-0 border border-gray-200/50">
                    <button onClick={() => setViewRange(7)} className={`px-2.5 py-1 text-[10px] font-black rounded-md transition-all ${viewRange === 7 ? 'bg-white text-ngo-teal shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>7天</button>
                    <button onClick={() => setViewRange(30)} className={`px-2.5 py-1 text-[10px] font-black rounded-md transition-all ${viewRange === 30 ? 'bg-white text-ngo-teal shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>30天</button>
                </div>
            )}
        </div>

        {/* 右侧：次要组件与折叠箭头 */}
        <div className="flex items-center justify-end gap-1 sm:gap-2 min-w-[100px]">
            {!isCollapsed && (
                <div className="relative group shrink-0" onClick={e => e.stopPropagation()}>
                    <select
                        value={selectedRole}
                        onChange={(e) => setSelectedRole(e.target.value)}
                        className="appearance-none bg-transparent pl-1 pr-4 py-1 text-[10px] font-black text-gray-500 focus:outline-none cursor-pointer hover:text-ngo-teal text-right w-[60px] sm:w-[80px] truncate"
                        style={{ direction: 'rtl' }}
                    >
                        <option value="">👤 全员</option>
                        {teamMembers.map(m => <option key={m.id} value={m.nickname}>{m.nickname}</option>)}
                    </select>
                    <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[8px] text-gray-400 pointer-events-none group-hover:text-ngo-teal opacity-50">▼</span>
                </div>
            )}
            <span className={`text-gray-300 text-xs transform transition-transform duration-300 shrink-0 ${isCollapsed ? '-rotate-90' : ''}`}>▼</span>
        </div>
      </div>
      
      {!isCollapsed && (
          <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar bg-gray-50/30">
            {displayItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-400">
                 <span className="text-4xl mb-2 opacity-30 grayscale">☕</span>
                 <p className="text-xs font-bold uppercase tracking-widest">暂无安排</p>
              </div>
            ) : (
              displayItems.map(item => {
                const isPriority = item.priority === 'High';
                const isActive = expandedTask === item.id;
                const isFocused = focusedDate && item.date === formatDate(focusedDate);

                return (
                    <div 
                      key={item.id} 
                      ref={el => {
                        itemRefs.current[item.id] = el;
                      }}
                      onClick={() => setExpandedTask(isActive ? null : item.id)}
                      className={`group border rounded-xl transition-all cursor-pointer relative bg-white ${
                          isActive || isFocused ? 'shadow-md border-ngo-teal/30 ring-1 ring-ngo-teal/10' : 'border-gray-100 hover:border-indigo-100 hover:shadow-sm'
                      } ${isPriority ? 'border-l-4 border-l-red-400' : ''} ${isFocused ? 'bg-indigo-50/30' : ''}`}
                    >
                      <div className="p-3">
                          <div className="flex justify-between items-center mb-1.5">
                            <span className="text-[10px] font-mono font-black text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded-md">{item.date.split('-').slice(1).join('/')}</span>
                            <span className={`text-[8px] px-1.5 py-0.5 rounded-full font-black uppercase ${
                              item.originalEvent?.category === 'InternationalDay' ? 'text-indigo-600 bg-indigo-50' : 
                              item.originalEvent?.category === 'Custom' ? 'text-purple-600 bg-purple-50' : 'text-gray-400 bg-gray-100'
                            }`}>
                              {getCategoryLabel(item.originalEvent?.category || '')}
                            </span>
                          </div>
                          <h4 className="font-bold text-gray-800 text-sm truncate flex items-center leading-tight">
                              {item.title}
                              {isPriority && <span className="text-red-500 ml-1 text-[10px]">🔥</span>}
                          </h4>
                          {selectedRole && item.type === 'Task' && (
                              <div className="text-[9px] font-bold text-indigo-500 mt-2 flex items-center gap-1.5 bg-indigo-50/50 p-1.5 rounded-lg border border-indigo-100/30">
                                  <span className="w-1 h-1 bg-indigo-400 rounded-full shrink-0"></span>
                                  <span className="truncate">任务: {item.title}</span>
                              </div>
                          )}
                      </div>
                      {isActive && (
                          <div className="px-3 pb-3 pt-0 animate-fade-in">
                              <div className="h-px bg-gray-100 mb-2"></div>
                              {item.phase && (
                                  <div className="text-[10px] text-gray-500 mb-2 flex items-center gap-1">
                                      <span className="font-black text-[8px] uppercase tracking-tighter">⏳ 周期:</span>
                                      <span className="font-mono bg-gray-50 px-1.5 py-0.5 rounded text-gray-700">{item.phase}</span>
                                  </div>
                              )}
                              <div className="flex justify-end">
                                  <button onClick={(e) => { e.stopPropagation(); onEventClick(item.originalEvent!); }} className="text-[10px] flex items-center gap-1.5 text-white bg-slate-900 hover:bg-black px-4 py-1.5 rounded-full shadow-sm font-black transition-colors"><span>🚀 策划方案</span></button>
                              </div>
                          </div>
                      )}
                    </div>
                );
              })
            )}
          </div>
      )}
    </div>
  );
};

export default UpcomingPanel;
