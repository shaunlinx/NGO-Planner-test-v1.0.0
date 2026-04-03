
import React from 'react';
import { CalendarEvent } from '../types';
import { CATEGORY_COLORS } from '../constants';
import { getLunarDateString } from '../utils/dateUtils';

interface DayDetailModalProps {
  date: Date;
  events: CalendarEvent[];
  onClose: () => void;
  onEventClick: (event: CalendarEvent) => void;
  onAddEvent: () => void;
  onDeleteEvent?: (id: string) => void;
}

const DayDetailModal: React.FC<DayDetailModalProps> = ({ date, events, onClose, onEventClick, onAddEvent, onDeleteEvent }) => {
  const y = date.getFullYear();
  const m = date.getMonth() + 1;
  const d = date.getDate();
  const weekDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  const week = weekDays[date.getDay()];
  const lunar = getLunarDateString(date);

  const getPriorityBadge = (priority?: {isImportant: boolean, isUrgent: boolean}) => {
      if (!priority) return null;
      if (priority.isImportant && priority.isUrgent) return <span className="text-[10px] bg-red-100 text-red-600 px-1.5 py-0.5 rounded ml-2 border border-red-200 shrink-0">🔥 重要紧急</span>;
      if (priority.isImportant) return <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded ml-2 border border-blue-200 shrink-0">📅 重要</span>;
      if (priority.isUrgent) return <span className="text-[10px] bg-yellow-100 text-yellow-700 px-1.5 py-0.5 rounded ml-2 border border-yellow-200 shrink-0">⚡ 紧急</span>;
      return null;
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[70] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in" onClick={onClose}>
      <div 
        className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden relative animate-fade-in-up"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="bg-ngo-teal p-5 text-white flex justify-between items-start">
          <div>
            <div className="flex items-baseline gap-2">
                <h2 className="text-3xl font-bold">{d}</h2>
                <span className="text-lg opacity-90">{m}月</span>
                <span className="text-sm bg-white/20 px-2 py-0.5 rounded ml-1">{week}</span>
            </div>
            <p className="text-sm text-ngo-cream mt-1 font-serif opacity-90">农历 {lunar}</p>
          </div>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        
        {/* Content */}
        <div className="p-5 max-h-[60vh] overflow-y-auto">
          {events.length > 0 ? (
            <div className="space-y-3">
               <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider">当日节点 ({events.length})</h3>
               {events.map(event => {
                 const isPersonal = event.category === 'Personal';
                 return (
                    <div key={event.id} className="relative group flex items-start gap-2">
                        <button
                            type="button"
                            onClick={() => {
                                onEventClick(event);
                                onClose(); 
                            }}
                            className={`flex-1 text-left p-3 rounded-lg border transition-all hover:scale-[1.01] shadow-sm flex flex-col gap-1
                                ${isPersonal
                                    ? 'bg-orange-50 border-orange-200 hover:bg-orange-100 text-orange-900'
                                    : event.isCustom 
                                        ? (event.priority?.isImportant && event.priority?.isUrgent ? 'bg-red-50 border-red-200 hover:bg-red-100' : 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100')
                                        : (CATEGORY_COLORS[event.category]?.replace('bg-', 'hover:bg-').replace('text-', 'hover:text-') || 'bg-white border-gray-200 hover:bg-gray-50')
                                }
                                ${!event.isCustom && !isPersonal && 'bg-white text-gray-700 border-gray-200'} 
                            `}
                        >
                            <div className="flex justify-between items-center w-full">
                                <span className="font-bold text-sm truncate flex-1 flex items-center">
                                    {isPersonal ? '👤 ' : (event.isCustom ? '✨ ' : '')}
                                    {event.title}
                                    {getPriorityBadge(event.priority)}
                                    {event.locked && <span className="ml-2 text-[10px]" title="已锁定">🔒</span>}
                                </span>
                                <span className={`text-xs px-2 py-1 rounded-full border border-black/5 transition-colors ${isPersonal ? 'bg-white/50 text-orange-700' : 'bg-white/50 text-black/50 group-hover:bg-ngo-teal group-hover:text-white'}`}>
                                    {isPersonal ? '私人助手' : 'AI 策划'} &rarr;
                                </span>
                            </div>
                            {event.suggestedLead && !isPersonal && (
                                <div className="text-xs opacity-70 flex items-center gap-1">
                                    👤 建议负责人: <span className="font-bold">{event.suggestedLead}</span>
                                </div>
                            )}
                        </button>
                        
                        {/* Delete Button for Day Detail */}
                        {((event.isCustom || isPersonal) && !event.locked && onDeleteEvent) && (
                            <button
                                type="button"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onDeleteEvent(event.id);
                                }}
                                className="w-8 h-8 flex shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-400 hover:bg-red-100 hover:text-red-500 transition-colors mt-2"
                                title="删除"
                            >
                                &times;
                            </button>
                        )}
                    </div>
                 );
               })}
            </div>
          ) : (
            <div className="text-center py-8 text-gray-400">
                <p className="text-4xl mb-2">📅</p>
                <p className="text-sm">本日暂无记录</p>
            </div>
          )}
        </div>

        {/* Footer Action */}
        <div className="p-4 border-t border-gray-100 bg-gray-50 flex gap-2">
            <button 
                type="button"
                onClick={() => {
                    onAddEvent();
                    onClose();
                }}
                className="flex-1 py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 font-bold text-sm hover:border-ngo-teal hover:text-ngo-teal hover:bg-ngo-teal/5 transition-all flex items-center justify-center gap-2"
            >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                </svg>
                添加节点
            </button>
        </div>
      </div>
    </div>
  );
};

export default DayDetailModal;
