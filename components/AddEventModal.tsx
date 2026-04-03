
import React, { useState, useEffect } from 'react';
import { NgoDomain, TeamMember } from '../types';
import { DOMAINS } from '../constants';
import { recommendTeamLead } from '../services/geminiService';

interface AddEventModalProps {
  onClose: () => void;
  onAdd: (event: { title: string; date: string; domain: NgoDomain; description: string, priority?: {isImportant: boolean, isUrgent: boolean}, suggestedLead?: string }) => void;
  teamMembers?: TeamMember[];
  prefillDate?: string;
}

const AddEventModal: React.FC<AddEventModalProps> = ({ onClose, onAdd, teamMembers = [], prefillDate = '' }) => {
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(prefillDate);
  const [domain, setDomain] = useState<NgoDomain>('其他');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  
  // Priority State
  const [isImportant, setIsImportant] = useState(false);
  const [isUrgent, setIsUrgent] = useState(false);

  // AI Matching State
  const [matching, setMatching] = useState(false);
  const [suggestedLead, setSuggestedLead] = useState<{name: string, reason: string} | null>(null);

  useEffect(() => {
      if (prefillDate) setDate(prefillDate);
  }, [prefillDate]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return; // Prevent double submit
    if (title && date) {
      setSubmitting(true);
      onAdd({ 
          title, 
          date, 
          domain, 
          description,
          priority: { isImportant, isUrgent },
          suggestedLead: suggestedLead?.name
      });
      // Delay closing slightly to allow parent state update to settle if needed, but mainly disable button
      setTimeout(() => {
          onClose();
          setSubmitting(false);
      }, 50);
    }
  };

  const handleAIMatch = async () => {
      if (!title) return alert("请先填写节点名称");
      setMatching(true);
      try {
          const result = await recommendTeamLead(title, description, teamMembers, date);
          setSuggestedLead(result);
      } catch (e: any) {
          alert("AI 匹配失败: " + e.message);
      } finally {
          setMatching(false);
      }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[60] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden relative animate-fade-in-up">
        <div className="bg-gradient-to-r from-ngo-teal to-ngo-teal-dark p-5 text-white flex justify-between items-center">
          <h2 className="text-lg font-bold flex items-center gap-2">
            ✨ 添加自定义节日/节点
          </h2>
          <button onClick={onClose} className="text-white/80 hover:text-white text-2xl leading-none">&times;</button>
        </div>
        
        <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">节日/节点名称</label>
            <input 
              type="text" 
              value={title}
              onChange={e => setTitle(e.target.value)}
              className="w-full p-2.5 rounded-lg border border-gray-200 focus:border-ngo-teal outline-none text-sm"
              placeholder="例如：社区邻里节、关爱流浪动物日..."
              required
              autoFocus
            />
          </div>
          
          <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-500 uppercase mb-1">日期</label>
                <input 
                  type="date" 
                  value={date}
                  onChange={e => setDate(e.target.value)}
                  className="w-full p-2.5 rounded-lg border border-gray-200 focus:border-ngo-teal outline-none text-sm"
                  required
                />
              </div>

              <div>
                 <label className="block text-xs font-bold text-gray-500 uppercase mb-1">所属领域</label>
                 <select 
                    value={domain}
                    onChange={e => setDomain(e.target.value as NgoDomain)}
                    className="w-full p-2.5 rounded-lg border border-gray-200 focus:border-ngo-teal outline-none text-sm bg-white"
                 >
                    {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
                 </select>
              </div>
          </div>

          {/* Priority Matrix */}
          <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
              <label className="block text-xs font-bold text-gray-500 uppercase mb-2">优先级矩阵 (Eisenhower Matrix)</label>
              <div className="flex gap-4">
                  <label className={`flex-1 flex items-center justify-center gap-2 p-2 rounded cursor-pointer border transition-all ${isImportant ? 'bg-red-50 border-red-200 text-red-700 font-bold' : 'bg-white border-gray-200 text-gray-500'}`}>
                      <input type="checkbox" checked={isImportant} onChange={e => setIsImportant(e.target.checked)} className="rounded text-red-500 focus:ring-red-500" />
                      重要
                  </label>
                  <label className={`flex-1 flex items-center justify-center gap-2 p-2 rounded cursor-pointer border transition-all ${isUrgent ? 'bg-orange-50 border-orange-200 text-orange-700 font-bold' : 'bg-white border-gray-200 text-gray-500'}`}>
                      <input type="checkbox" checked={isUrgent} onChange={e => setIsUrgent(e.target.checked)} className="rounded text-orange-500 focus:ring-orange-500" />
                      紧急
                  </label>
              </div>
              <div className="text-xs text-center mt-2 text-gray-400">
                  {isImportant && isUrgent && "🔥 高优先级：建议立即着手策划"}
                  {isImportant && !isUrgent && "📅 规划级：建议列入日程表"}
                  {!isImportant && isUrgent && "⚡ 速办级：建议快速处理或授权"}
                  {!isImportant && !isUrgent && "☕ 待办级：稍后处理"}
              </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                背景描述 & AI 分工 
            </label>
            <textarea 
              value={description}
              onChange={e => setDescription(e.target.value)}
              className="w-full p-2.5 rounded-lg border border-gray-200 focus:border-ngo-teal outline-none text-sm h-20 resize-none mb-2"
              placeholder="简要描述活动背景，AI 将据此推荐团队中最合适的人选..."
            />
            
            {/* AI Team Matching Section */}
            <div className="flex items-start gap-2">
                <button 
                    type="button"
                    onClick={handleAIMatch}
                    disabled={matching || teamMembers.length === 0}
                    className="shrink-0 bg-indigo-50 text-indigo-600 hover:bg-indigo-100 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1 border border-indigo-200"
                >
                    {matching ? '分析中...' : '🤖 AI 推荐负责人'}
                </button>
                
                {suggestedLead && (
                    <div className="flex-1 bg-indigo-50 border border-indigo-100 rounded-lg p-2 text-xs">
                        <div className="font-bold text-indigo-800">推荐：{suggestedLead.name}</div>
                        <div className="text-indigo-600 mt-0.5 leading-snug">{suggestedLead.reason}</div>
                    </div>
                )}
            </div>
          </div>

          <div className="pt-2">
            <button 
                type="submit" 
                disabled={submitting}
                className={`w-full bg-ngo-teal hover:bg-ngo-teal-dark text-white font-bold py-3 rounded-lg shadow-lg shadow-ngo-teal/30 transition-all ${submitting ? 'opacity-70 cursor-wait' : ''}`}
            >
                {submitting ? '正在添加...' : '保存并添加到年历'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddEventModal;
