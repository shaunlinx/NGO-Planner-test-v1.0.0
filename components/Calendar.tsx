
import React, { useState, useRef, useEffect, useMemo } from 'react';
import { CalendarEvent, EventCategory } from '../types';
import { getDaysInMonth, getFirstDayOfMonth, getLunarDateString, isWeekend } from '../utils/dateUtils';
import { CATEGORY_COLORS, CATEGORY_LABELS } from '../constants';

interface CalendarProps {
  year: number;
  month: number;
  events: CalendarEvent[];
  onEventClick: (event: CalendarEvent) => void;
  onDayClick: (date: Date, events: CalendarEvent[]) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onAddEvent?: (date?: Date) => void;
  onBatchManage?: () => void;
  onDeleteEvent?: (id: string) => void;
  onEventUpdate?: (event: CalendarEvent) => void;
  onDayFocus?: (date: Date) => void;
  onAnalyzeDay?: (date: Date) => void;
  visibleCategories?: Set<EventCategory>;
  onVisibleCategoriesChange?: (next: Set<EventCategory>) => void;
}

const Calendar: React.FC<CalendarProps> = ({ 
    year, 
    month, 
    events, 
    onEventClick, 
    onDayClick, 
    onPrevMonth, 
    onNextMonth,
    onAddEvent,
    onBatchManage,
    onDeleteEvent,
    onEventUpdate,
    onDayFocus,
    onAnalyzeDay,
    visibleCategories: controlledVisibleCategories,
    onVisibleCategoriesChange
}) => {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);
  
  const monthNames = ["1月", "2月", "3月", "4月", "5月", "6月", "7月", "8月", "9月", "10月", "11月", "12月"];
  const weekDays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

  // Filter State
  const [showFilter, setShowFilter] = useState(false);
  const [internalVisibleCategories, setInternalVisibleCategories] = useState<Set<EventCategory>>(new Set(Object.keys(CATEGORY_LABELS) as EventCategory[]));
  const filterRef = useRef<HTMLDivElement>(null);
  const visibleCategories = controlledVisibleCategories || internalVisibleCategories;
  const commitVisibleCategories = (next: Set<EventCategory>) => {
      if (onVisibleCategoriesChange) onVisibleCategoriesChange(next);
      else setInternalVisibleCategories(next);
  };

  // Drag & Drop State
  const [draggedEventId, setDraggedEventId] = useState<string | null>(null);

  const handleDragStart = (e: React.DragEvent, eventId: string) => {
      e.dataTransfer.setData("text/plain", eventId);
      setDraggedEventId(eventId);
      e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
  };

  const handleDrop = (e: React.DragEvent, dateStr: string) => {
      e.preventDefault();
      const eventId = e.dataTransfer.getData("text/plain");
      setDraggedEventId(null);
      
      if (eventId && onEventUpdate) {
          const eventToUpdate = events.find(ev => ev.id === eventId);
          if (eventToUpdate && eventToUpdate.date !== dateStr) {
              onEventUpdate({ ...eventToUpdate, date: dateStr });
          }
      }
  };

  // Context Menu State
  const [contextMenu, setContextMenu] = useState<{ x: number, y: number, date: Date } | null>(null);

  useEffect(() => {
      const handleClick = () => setContextMenu(null);
      document.addEventListener('click', handleClick);
      return () => document.removeEventListener('click', handleClick);
  }, []);

  const handleContextMenu = (e: React.MouseEvent, date: Date) => {
      e.preventDefault();
      setContextMenu({ x: e.clientX, y: e.clientY, date });
  };

  // Inline Editing State
  const [editingEventId, setEditingEventId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const handleStartEdit = (e: React.MouseEvent, event: CalendarEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (event.locked) return;
      setEditingEventId(event.id);
      setEditTitle(event.title);
  };

  const handleSaveEdit = () => {
      if (editingEventId && onEventUpdate) {
          const eventToUpdate = events.find(ev => ev.id === editingEventId);
          if (eventToUpdate && editTitle.trim() !== '' && editTitle !== eventToUpdate.title) {
              onEventUpdate({ ...eventToUpdate, title: editTitle.trim() });
          }
      }
      setEditingEventId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') handleSaveEdit();
      if (e.key === 'Escape') setEditingEventId(null);
  };

  // Click outside to close filter
  useEffect(() => {
      const handleClickOutside = (event: MouseEvent) => {
          if (filterRef.current && !filterRef.current.contains(event.target as Node)) {
              setShowFilter(false);
          }
      };
      if (showFilter) document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showFilter]);

  const toggleCategory = (cat: EventCategory) => {
      const next = new Set(visibleCategories);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      commitVisibleCategories(next);
  };

  const selectAllCategories = (select: boolean) => {
      if (select) commitVisibleCategories(new Set(Object.keys(CATEGORY_LABELS) as EventCategory[]));
      else commitVisibleCategories(new Set());
  };

  // Derived filtered events
  const filteredEvents = useMemo(() => {
      return events.filter(e => visibleCategories.has(e.category));
  }, [events, visibleCategories]);

  // Calculate needed rows
  const totalSlotsNeeded = firstDay + daysInMonth;
  const isSixRows = totalSlotsNeeded > 35;
  const totalSlots = isSixRows ? 42 : 35;

  // Helper to determine event style based on Priority Matrix
  const getEventStyle = (event: CalendarEvent) => {
      // 1. Check Priority Matrix first
      if (event.priority) {
          const { isImportant, isUrgent } = event.priority;
          if (isImportant && isUrgent) {
              return 'bg-red-100 text-red-900 border-red-400 border-l-4 font-bold shadow-sm'; // Q1: Fire!
          }
          if (isImportant && !isUrgent) {
              return 'bg-blue-100 text-blue-900 border-blue-300 border-l-4'; // Q2: Plan
          }
          if (!isImportant && isUrgent) {
              return 'bg-yellow-100 text-yellow-900 border-yellow-300 border-l-4'; // Q3: Delegate
          }
          // Q4: Default Custom Style
          return 'bg-purple-50 text-purple-700 border-purple-200 border-l-2'; 
      }

      // 2. Fallback to Standard Categories
      if (event.isCustom) return 'bg-purple-100 text-purple-700 border-purple-200';
      return CATEGORY_COLORS[event.category] || 'bg-gray-100 text-gray-600 border-gray-200';
  };

  const renderDays = () => {
    const days = [];
    
    // 1. Previous Month Filler
    for (let i = 0; i < firstDay; i++) {
      days.push(
        <div key={`prev-${i}`} className="bg-gray-50/50 border-b border-r border-gray-100 relative z-10"></div>
      );
    }

    // 2. Current Month Days
    for (let d = 1; d <= daysInMonth; d++) {
      const currentDateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const dateObj = new Date(year, month, d);
      const isWknd = isWeekend(dateObj);
      const isToday = new Date().toDateString() === dateObj.toDateString();
      const lunar = getLunarDateString(dateObj);
      
      const dayEvents = filteredEvents.filter(e => e.date === currentDateStr);
      const hasHoliday = dayEvents.some(e => e.isPublicHoliday);

      days.push(
        <div 
          key={`day-${d}`} 
          onClick={() => onDayClick(dateObj, dayEvents)}
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, currentDateStr)}
          onContextMenu={(e) => handleContextMenu(e, dateObj)}
          className={`
            border-b border-r border-gray-100 p-2 relative flex flex-col gap-1 cursor-pointer
            transition-colors duration-200 group h-full overflow-hidden z-10
            ${isWknd ? 'bg-gray-50/80' : 'bg-white/90'} 
            ${hasHoliday ? 'bg-ngo-pink/5' : ''}
            ${isToday ? 'ring-2 ring-inset ring-ngo-teal' : 'hover:bg-gray-50'}
            ${draggedEventId ? 'hover:bg-indigo-50 hover:ring-2 hover:ring-indigo-300' : ''}
          `}
        >
          {/* Heatmap Layer */}
          {dayEvents.length > 0 && (
              <div 
                  className={`absolute inset-0 z-0 pointer-events-none transition-all duration-500
                      ${dayEvents.length <= 2 ? 'bg-indigo-50/30' : 
                        dayEvents.length <= 4 ? 'bg-indigo-100/40' : 
                        'bg-indigo-200/50'}
                  `}
              />
          )}

          {/* Header Row: Date + Quick Add */}
          <div className="flex justify-between items-baseline shrink-0 relative group/header min-h-[24px] z-10">
            <div className="flex items-baseline gap-1">
                <span className={`text-lg font-semibold ${isWknd || hasHoliday ? 'text-ngo-pink' : 'text-gray-700'} ${isToday ? 'text-ngo-teal' : ''}`}>
                {d}
                </span>
                <span className="text-xs text-gray-400 font-serif opacity-80">{lunar}</span>
            </div>
            {/* Quick Add Button (Visible on hover of the cell) */}
            {onAddEvent && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onAddEvent(dateObj);
                    }}
                    className="hidden group-hover:flex absolute right-0 top-0 w-6 h-6 items-center justify-center bg-ngo-teal/10 hover:bg-ngo-teal text-ngo-teal hover:text-white rounded-full transition-all z-20"
                    title="在此日添加节点"
                >
                    <span className="text-lg leading-none pb-0.5">+</span>
                </button>
            )}
          </div>

          <div className="flex-1 flex flex-col gap-1 overflow-y-auto custom-scrollbar min-h-0 pb-1">
            {dayEvents.map(event => (
              <div key={event.id} className="relative group/evt">
                  {editingEventId === event.id ? (
                      <input
                          autoFocus
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onBlur={handleSaveEdit}
                          onKeyDown={handleKeyDown}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full text-[10px] sm:text-xs px-1.5 py-1 rounded border border-ngo-teal outline-none shadow-sm z-20 relative bg-white"
                      />
                  ) : (
                      <button
                        type="button"
                        draggable={!event.locked}
                        onDragStart={(e) => handleDragStart(e, event.id)}
                        onClick={(e) => {
                            e.stopPropagation(); // Prevent opening day modal
                            onEventClick(event);
                        }}
                        onDoubleClick={(e) => handleStartEdit(e, event)}
                        className={`w-full text-left text-[10px] sm:text-xs px-1.5 py-1 rounded border truncate transition-all hover:scale-[1.02] hover:shadow-sm shrink-0 pr-6 relative z-10
                            ${getEventStyle(event)}
                            ${draggedEventId === event.id ? 'opacity-50' : ''}
                            ${!event.locked ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}
                        `}
                        title={event.title}
                      >
                        {event.priority?.isImportant && event.priority?.isUrgent && '🔥 '}
                        {event.isCustom && !event.priority && '✨ '}
                        {event.category === 'Personal' && '👤 '}
                        {event.title}
                      </button>
                  )}
                  
                  {/* Delete Button on Hover - FIXED */}
                  {((event.isCustom || event.category === 'Personal') && !event.locked && onDeleteEvent && editingEventId !== event.id) && (
                      <div className="absolute right-0.5 top-1/2 -translate-y-1/2 flex items-center gap-1 z-50 opacity-0 group-hover/evt:opacity-100 transition-opacity">
                          <button
                              type="button"
                              onClick={(e) => handleStartEdit(e, event)}
                              className="w-4 h-4 flex items-center justify-center bg-indigo-500 text-white rounded-full text-[8px] hover:bg-indigo-600 shadow-md cursor-pointer hover:scale-110"
                              title="重命名"
                          >
                              ✎
                          </button>
                          <button
                              type="button"
                              onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onDeleteEvent(event.id);
                              }}
                              className="w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full text-[10px] hover:bg-red-600 shadow-md cursor-pointer hover:scale-110"
                              title="删除节点"
                          >
                              &times;
                          </button>
                      </div>
                  )}
              </div>
            ))}
          </div>
        </div>
      );
    }

    // 3. Next Month Filler
    const remainingSlots = totalSlots - (firstDay + daysInMonth);
    for (let i = 1; i <= remainingSlots; i++) {
        days.push(
            <div key={`next-${i}`} className="bg-gray-50/30 border-b border-r border-gray-100 flex p-2 text-gray-300 select-none relative z-10">
                {i}
            </div>
        );
    }

    return days;
  };

  return (
    <div className="bg-white h-full flex flex-col relative"> 
      {/* Calendar Header */}
      <div className="px-6 py-3 flex justify-between items-center bg-white border-b border-gray-100 shrink-0 z-20 relative">
        <div className="flex items-center gap-4">
          <h2 className="text-2xl font-bold text-gray-800 tracking-tight">{year}年 <span className="text-ngo-teal">{monthNames[month]}</span></h2>
          
          {/* Action Buttons */}
          <div className="flex items-center gap-2 ml-2">
              {/* Category Filter Dropdown */}
              <div className="relative" ref={filterRef}>
                  <button 
                      onClick={() => setShowFilter(!showFilter)}
                      className={`flex items-center gap-1 px-3 py-1.5 border rounded-lg text-xs font-bold transition-all ${showFilter || visibleCategories.size < Object.keys(CATEGORY_LABELS).length ? 'bg-indigo-50 border-indigo-200 text-indigo-600' : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'}`}
                      title="筛选节点类型"
                  >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" /></svg>
                      {visibleCategories.size < Object.keys(CATEGORY_LABELS).length ? `已选 ${visibleCategories.size}` : '筛选'}
                  </button>
                  
                  {showFilter && (
                      <div className="absolute top-full left-0 mt-2 w-48 bg-white rounded-xl shadow-xl border border-gray-100 p-2 z-50 animate-fade-in-down">
                          <div className="flex justify-between px-2 pb-2 mb-2 border-b border-gray-100">
                              <button onClick={() => selectAllCategories(true)} className="text-[10px] text-indigo-600 hover:underline">全选</button>
                              <button onClick={() => selectAllCategories(false)} className="text-[10px] text-gray-400 hover:text-gray-600 hover:underline">清空</button>
                          </div>
                          <div className="space-y-1 max-h-60 overflow-y-auto custom-scrollbar">
                              {(Object.entries(CATEGORY_LABELS) as [EventCategory, string][]).map(([key, label]) => (
                                  <label key={key} className="flex items-center gap-2 px-2 py-1.5 hover:bg-gray-50 rounded cursor-pointer text-xs">
                                      <input 
                                          type="checkbox" 
                                          checked={visibleCategories.has(key)}
                                          onChange={() => toggleCategory(key)}
                                          className="rounded text-ngo-teal focus:ring-ngo-teal cursor-pointer"
                                      />
                                      <span className={visibleCategories.has(key) ? 'text-gray-800 font-medium' : 'text-gray-500'}>
                                          {label}
                                      </span>
                                  </label>
                              ))}
                          </div>
                      </div>
                  )}
              </div>

              <div className="h-6 w-px bg-gray-200 mx-1 hidden md:block"></div>

              {onBatchManage && (
                  <button 
                      onClick={onBatchManage}
                      className="hidden md:flex items-center gap-1 px-3 py-1.5 bg-gray-50 border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-100 hover:text-ngo-teal transition-all text-xs font-bold"
                      title="批量管理自定义节点"
                  >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4"/></svg>
                      批量管理
                  </button>
              )}
              {onAddEvent && (
                  <button 
                      onClick={() => onAddEvent()}
                      className="flex items-center gap-1 px-3 py-1.5 bg-ngo-teal text-white rounded-lg shadow-sm hover:bg-ngo-teal-dark transition-all text-xs font-bold"
                      title="添加自定义节日"
                  >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                      </svg>
                      添加节点
                  </button>
              )}
          </div>
        </div>
        
        <div className="flex gap-2">
          <button onClick={onPrevMonth} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-ngo-teal transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" /></svg>
          </button>
          <button onClick={onNextMonth} className="p-2 hover:bg-gray-100 rounded-lg text-gray-500 hover:text-ngo-teal transition-colors">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" /></svg>
          </button>
        </div>
      </div>

      {/* Weekday Header */}
      <div className="grid grid-cols-7 bg-gray-50 text-center py-2 border-b border-gray-200 text-xs font-bold text-gray-500 uppercase tracking-wider shrink-0 z-20 relative">
        {weekDays.map((d, i) => (
          <div key={d} className={i === 0 || i === 6 ? 'text-ngo-pink' : ''}>{d}</div>
        ))}
      </div>

      {/* Grid - Dynamic Rows */}
      <div className={`grid grid-cols-7 flex-1 overflow-hidden ${isSixRows ? 'grid-rows-6' : 'grid-rows-5'} relative bg-white`}>
        {renderDays()}
      </div>

      {/* Context Menu */}
      {contextMenu && (
          <div 
              className="fixed bg-white rounded-lg shadow-xl border border-gray-100 py-1 z-50 animate-fade-in"
              style={{ top: contextMenu.y, left: contextMenu.x }}
          >
              <div className="px-3 py-1.5 border-b border-gray-50 text-[10px] text-gray-400 font-bold uppercase tracking-widest bg-gray-50/50">
                  {contextMenu.date.getMonth() + 1}月{contextMenu.date.getDate()}日 操作
              </div>
              {onAddEvent && (
                  <button 
                      onClick={() => onAddEvent(contextMenu.date)}
                      className="w-full text-left px-4 py-2 hover:bg-indigo-50 text-xs text-gray-700 flex items-center gap-2"
                  >
                      <span>➕</span> 新建节点
                  </button>
              )}
              {onDayFocus && (
                  <button 
                      onClick={() => onDayFocus(contextMenu.date)}
                      className="w-full text-left px-4 py-2 hover:bg-indigo-50 text-xs text-gray-700 flex items-center gap-2"
                  >
                      <span>👁️</span> 聚焦当日视图
                  </button>
              )}
              {onAnalyzeDay && (
                  <button 
                      onClick={() => onAnalyzeDay(contextMenu.date)}
                      className="w-full text-left px-4 py-2 hover:bg-purple-50 text-xs text-purple-700 flex items-center gap-2 border-t border-gray-50"
                  >
                      <span>✨</span> AI 智能分析
                  </button>
              )}
          </div>
      )}
    </div>
  );
};

export default Calendar;
