
import React, { useState, useEffect } from 'react';
import { CalendarEvent, NgoDomain } from '../types';
import { DOMAINS } from '../constants';
import { formatDate } from '../utils/dateUtils';

interface BatchEventManagerProps {
    customEvents: CalendarEvent[];
    onUpdateEvents: (events: CalendarEvent[]) => void;
    onClose: () => void;
    onOpenAiExtraction: () => void;
}

const BatchEventManager: React.FC<BatchEventManagerProps> = ({ customEvents, onUpdateEvents, onClose, onOpenAiExtraction }) => {
    // 关键：初始化时确保深拷贝
    const [localEvents, setLocalEvents] = useState<CalendarEvent[]>(() => JSON.parse(JSON.stringify(customEvents)));
    const [filterDomain, setFilterDomain] = useState<string>('All');

    // 监听 AI 提取结果并注入表格
    useEffect(() => {
        const handleAiResult = (e: any) => {
            const extracted = e.detail as CalendarEvent[];
            if (extracted && extracted.length > 0) {
                // 为提取到的节点补充必要字段，并确保 ID 格式统一
                const enriched = extracted.map((ev, idx) => ({
                    ...ev,
                    id: ev.id || `ai-ext-${Date.now()}-${idx}`,
                    category: 'Custom' as const,
                    isCustom: true,
                    status: 'Active' as const,
                    locked: false
                }));
                setLocalEvents(prev => [...enriched, ...prev]);
                alert(`✅ AI 已成功提取 ${enriched.length} 个节点并注入表格，请核对后点击下方保存。`);
            }
        };
        window.addEventListener('ai-extraction-complete', handleAiResult);
        return () => window.removeEventListener('ai-extraction-complete', handleAiResult);
    }, []);

    const handleFieldChange = (id: string, field: keyof CalendarEvent | 'priority.isImportant' | 'priority.isUrgent', value: any) => {
        setLocalEvents(prev => prev.map(ev => {
            if (ev.id === id) {
                if (field === 'priority.isImportant') return { ...ev, priority: { ...ev.priority!, isImportant: value } };
                if (field === 'priority.isUrgent') return { ...ev, priority: { ...ev.priority!, isUrgent: value } };
                return { ...ev, [field]: value };
            }
            return ev;
        }));
    };

    const handleAddRow = () => {
        const newEvent: CalendarEvent = {
            id: `custom-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
            title: '',
            date: new Date().toISOString().split('T')[0],
            category: 'Custom',
            isCustom: true,
            relevantDomains: ['其他'],
            priority: { isImportant: false, isUrgent: false },
            status: 'Active',
            description: '',
            locked: false
        };
        setLocalEvents([newEvent, ...localEvents]);
    };

    const handleExportTemplate = () => {
        const headers = ["日期(YYYY-MM-DD)", "标题", "领域(儿童/教育/环保等)", "描述", "重要(TRUE/FALSE)", "紧急(TRUE/FALSE)"];
        const example = ["2025-06-01", "社区邻里节活动", "社区发展", "年度大型社区互动", "TRUE", "FALSE"];
        const csvContent = "\uFEFF" + [headers, example].map(r => r.join(',')).join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = "自定义节点导入模版.csv";
        link.click();
    };

    const handleImportCsv = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const content = ev.target?.result as string;
            const rows = content.split('\n').filter(r => r.trim() !== '').slice(1);
            const imported: CalendarEvent[] = rows.map((r, i) => {
                const cols = r.split(',').map(c => c.trim());
                return {
                    id: `imp-${Date.now()}-${i}`,
                    date: cols[0] || formatDate(new Date()),
                    title: cols[1] || '未命名',
                    relevantDomains: [cols[2] as any || '其他'],
                    description: cols[3] || '',
                    priority: { isImportant: cols[4]?.toUpperCase() === 'TRUE', isUrgent: cols[5]?.toUpperCase() === 'TRUE' },
                    category: 'Custom',
                    isCustom: true,
                    status: 'Active',
                    locked: false
                };
            });
            setLocalEvents([...imported, ...localEvents]);
            alert(`成功导入 ${imported.length} 个节点`);
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    // 修复删除逻辑：确保 ID 正确匹配且停止冒泡
    const handleDelete = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (window.confirm("确定删除此节点吗？")) {
            setLocalEvents(prev => prev.filter(item => item.id !== id));
        }
    };

    const handleSave = () => {
        if (!localEvents.every(e => e.title && e.date)) {
            return alert("请确保所有节点都有标题和日期。");
        }
        onUpdateEvents(localEvents);
        onClose();
    };

    const filteredEvents = filterDomain === 'All' ? localEvents : localEvents.filter(e => e.relevantDomains?.includes(filterDomain as NgoDomain));

    return (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden animate-fade-in-up">
                
                <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50 shrink-0">
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">🛠️ 自定义节点批量管理</h2>
                        <p className="text-xs text-gray-500 mt-1">支持 AI 自动解析、文件导入及手动批量录入</p>
                    </div>
                    <div className="flex gap-2">
                        <button onClick={onOpenAiExtraction} className="bg-indigo-600 text-white px-4 py-1.5 rounded-lg text-xs font-bold hover:bg-indigo-700 shadow-md flex items-center gap-1.5 transition-all active:scale-95">✨ AI 智能提取排期</button>
                        <div className="h-6 w-[1px] bg-gray-300 mx-2"></div>
                        <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">&times;</button>
                    </div>
                </div>

                <div className="p-3 border-b border-gray-100 flex gap-4 items-center bg-white shrink-0">
                    <button onClick={handleAddRow} className="bg-indigo-50 text-indigo-600 px-4 py-2 rounded-lg text-xs font-bold hover:bg-indigo-100 border border-indigo-200">+ 添加一行</button>
                    <button onClick={handleExportTemplate} className="bg-white border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-xs font-bold hover:bg-gray-50">📥 下载模版</button>
                    <label className="bg-white border border-gray-200 text-gray-600 px-4 py-2 rounded-lg text-xs font-bold hover:bg-gray-50 cursor-pointer">
                        📤 导入文件
                        <input type="file" accept=".csv" className="hidden" onChange={handleImportCsv} />
                    </label>
                    <div className="h-6 w-px bg-gray-100 mx-2"></div>
                    <div className="flex items-center gap-2 text-xs text-gray-600">
                        <span>领域筛选:</span>
                        <select value={filterDomain} onChange={e => setFilterDomain(e.target.value)} className="border border-gray-300 rounded p-1 outline-none focus:border-ngo-teal">
                            <option value="All">全部领域</option>
                            {DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}
                        </select>
                    </div>
                    <div className="ml-auto text-xs text-gray-400 font-mono">COUNT: {filteredEvents.length}</div>
                </div>

                <div className="flex-1 overflow-auto bg-gray-50/50 p-4">
                    <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden min-w-[1000px]">
                        <table className="w-full text-xs text-left">
                            <thead className="bg-gray-100 text-gray-600 font-bold uppercase sticky top-0 z-10">
                                <tr>
                                    <th className="p-3 w-12 text-center">状态</th>
                                    <th className="p-3 w-32">日期</th>
                                    <th className="p-3 w-48">名称/标题</th>
                                    <th className="p-3 w-32">所属领域</th>
                                    <th className="p-3 w-40">优先级</th>
                                    <th className="p-3">描述/备注</th>
                                    <th className="p-3 w-20 text-center">操作</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-100">
                                {filteredEvents.length === 0 ? (
                                    <tr><td colSpan={7} className="p-8 text-center text-gray-400 italic">请点击上方“添加一行”或使用 AI 提取导入</td></tr>
                                ) : (
                                    filteredEvents.map(ev => (
                                        <tr key={ev.id} className={`hover:bg-slate-50 transition-colors ${ev.status === 'Paused' ? 'opacity-50 grayscale' : ''}`}>
                                            <td className="p-3 text-center">
                                                <button type="button" onClick={() => handleFieldChange(ev.id, 'status', ev.status === 'Paused' ? 'Active' : 'Paused')}>
                                                    {ev.status === 'Paused' ? '⏸️' : '✅'}
                                                </button>
                                            </td>
                                            <td className="p-3"><input type="date" value={ev.date} onChange={e => handleFieldChange(ev.id, 'date', e.target.value)} className="w-full border-none p-1 focus:ring-0 bg-transparent" /></td>
                                            <td className="p-3"><input type="text" value={ev.title} onChange={e => handleFieldChange(ev.id, 'title', e.target.value)} className="w-full border-none p-1 focus:ring-0 bg-transparent font-bold" /></td>
                                            <td className="p-3"><select value={ev.relevantDomains?.[0] || '其他'} onChange={e => handleFieldChange(ev.id, 'relevantDomains', [e.target.value])} className="w-full border-none p-1 focus:ring-0 bg-transparent">{DOMAINS.map(d => <option key={d} value={d}>{d}</option>)}</select></td>
                                            <td className="p-3">
                                                <div className="flex gap-2">
                                                    <label className={`px-2 py-0.5 rounded border text-[10px] cursor-pointer ${ev.priority?.isImportant ? 'bg-red-50 border-red-200 text-red-600' : 'bg-white border-gray-200 text-gray-400'}`}><input type="checkbox" checked={!!ev.priority?.isImportant} onChange={e => handleFieldChange(ev.id, 'priority.isImportant', e.target.checked)} className="hidden"/>重要</label>
                                                    <label className={`px-2 py-0.5 rounded border text-[10px] cursor-pointer ${ev.priority?.isUrgent ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-white border-gray-200 text-gray-400'}`}><input type="checkbox" checked={!!ev.priority?.isUrgent} onChange={e => handleFieldChange(ev.id, 'priority.isUrgent', e.target.checked)} className="hidden"/>紧急</label>
                                                </div>
                                            </td>
                                            <td className="p-3"><input type="text" value={ev.description || ''} onChange={e => handleFieldChange(ev.id, 'description', e.target.value)} className="w-full border-none p-1 focus:ring-0 bg-transparent text-gray-500" /></td>
                                            <td className="p-3 text-center">
                                                <button onClick={(e) => handleDelete(ev.id, e)} className="p-2 text-slate-300 hover:text-red-500 transition-colors" title="删除">
                                                    🗑️
                                                </button>
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="p-4 border-t border-gray-100 bg-white flex justify-end gap-3 shrink-0">
                    <button onClick={onClose} className="px-6 py-2 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors font-bold text-sm">取消</button>
                    <button onClick={handleSave} className="px-8 py-2 rounded-lg bg-ngo-teal text-white hover:bg-ngo-teal-dark transition-all font-bold text-sm shadow-lg shadow-ngo-teal/20">保存并同步至日历</button>
                </div>
            </div>
        </div>
    );
};

export default BatchEventManager;
