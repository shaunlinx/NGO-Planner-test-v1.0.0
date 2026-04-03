import React, { useMemo, useState, useEffect } from 'react';
import { CalendarEvent, PlannerEventContextConfig, PlannerRelationType, PlannerRelationEdge } from '../types';
import { upsertPlannerEventContextConfig } from '../services/plannerContextService';

interface PlanningContextModalProps {
    event: CalendarEvent;
    allEvents: CalendarEvent[];
    initialConfig: PlannerEventContextConfig;
    onClose: () => void;
    onSaved: (config: PlannerEventContextConfig) => void;
}

const REL_TYPES: { value: PlannerRelationType; label: string }[] = [
    { value: 'depends_on', label: '依赖' },
    { value: 'blocks', label: '阻塞' },
    { value: 'related', label: '关联' }
];

const PlanningContextModal: React.FC<PlanningContextModalProps> = ({ event, allEvents, initialConfig, onClose, onSaved }) => {
    const [draft, setDraft] = useState<PlannerEventContextConfig>(initialConfig || {});
    const [isSaving, setIsSaving] = useState(false);
    const [kbStats, setKbStats] = useState<any[]>([]);
    const [kbSearch, setKbSearch] = useState('');
    const [showKbPicker, setShowKbPicker] = useState(false);

    const [relOtherId, setRelOtherId] = useState('');
    const [relType, setRelType] = useState<PlannerRelationType>('related');
    const [relNote, setRelNote] = useState('');

    useEffect(() => {
        setDraft(initialConfig || {});
    }, [initialConfig]);

    const sortedEvents = useMemo(() => {
        return (allEvents || [])
            .filter(e => e && e.id && e.id !== event.id)
            .slice()
            .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    }, [allEvents, event.id]);

    const eventById = useMemo(() => {
        const m = new Map<string, CalendarEvent>();
        (allEvents || []).forEach(ev => {
            if (ev?.id) m.set(ev.id, ev);
        });
        return m;
    }, [allEvents]);

    const kbScopes = useMemo(() => (Array.isArray(draft.kbScopes) ? draft.kbScopes : []), [draft.kbScopes]);
    const relations = useMemo(() => (Array.isArray(draft.relations) ? draft.relations : []), [draft.relations]);
    const referencePacks = useMemo(() => (Array.isArray(draft.referencePacks) ? draft.referencePacks : []), [draft.referencePacks]);

    const filteredKbStats = useMemo(() => {
        const q = kbSearch.trim().toLowerCase();
        const list = Array.isArray(kbStats) ? kbStats : [];
        if (!q) return list.slice(0, 200);
        return list.filter(s => String(s.file_path || '').toLowerCase().includes(q)).slice(0, 200);
    }, [kbStats, kbSearch]);

    const toggleKbScope = (p: string) => {
        const next = new Set(kbScopes);
        if (next.has(p)) next.delete(p);
        else next.add(p);
        setDraft(prev => ({ ...prev, kbScopes: Array.from(next) }));
    };

    const removeKbScope = (p: string) => {
        setDraft(prev => ({ ...prev, kbScopes: kbScopes.filter(x => x !== p) }));
    };

    const addRelation = () => {
        if (!relOtherId) return;
        const edge: PlannerRelationEdge = {
            fromEventId: event.id,
            toEventId: relOtherId,
            type: relType,
            note: relNote.trim() ? relNote.trim() : undefined
        };
        setDraft(prev => ({ ...prev, relations: [...relations, edge] }));
        setRelOtherId('');
        setRelType('related');
        setRelNote('');
    };

    const removeRelation = (idx: number) => {
        const next = relations.slice();
        next.splice(idx, 1);
        setDraft(prev => ({ ...prev, relations: next }));
    };

    const loadKbStats = async () => {
        try {
            const api = (window as any)?.electronAPI?.knowledge;
            if (!api?.getStats) return;
            const stats = await api.getStats();
            setKbStats(Array.isArray(stats) ? stats : []);
            setShowKbPicker(true);
        } catch (e) {}
    };

    const handleSave = async () => {
        if (!event?.id) return;
        setIsSaving(true);
        try {
            const res = await upsertPlannerEventContextConfig(event.id, draft);
            if (res?.success === false) throw new Error(res?.error || '保存失败');
            onSaved(draft);
            onClose();
        } catch (e: any) {
            alert(`保存失败: ${e?.message || e}`);
        } finally {
            setIsSaving(false);
        }
    };

    const openPackFolder = async (folderPath: string) => {
        try {
            const shell = (window as any)?.electronAPI?.shell;
            if (shell?.openPath) await shell.openPath(folderPath);
        } catch (e) {}
    };

    return (
        <div className="fixed inset-0 z-[180] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-slate-50/60">
                    <div>
                        <div className="text-xs font-black text-slate-500 uppercase tracking-widest">策划助手上下文配置</div>
                        <div className="text-sm font-bold text-slate-900 mt-1">{event.date} · {event.title}</div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={onClose} className="px-4 py-2 rounded-xl border border-slate-200 text-slate-600 text-xs font-bold hover:bg-slate-50">关闭</button>
                        <button onClick={handleSave} disabled={isSaving} className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-black hover:bg-indigo-700 disabled:opacity-50">
                            {isSaving ? '保存中...' : '保存'}
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
                    <div className="grid grid-cols-2 gap-4">
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                            <input type="checkbox" checked={!!draft.includeEventMeta} onChange={e => setDraft(prev => ({ ...prev, includeEventMeta: e.target.checked }))} />
                            注入节点元数据（日期/标题/领域/优先级/描述）
                        </label>
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                            <input type="checkbox" checked={!!draft.includeKbSnippets} onChange={e => setDraft(prev => ({ ...prev, includeKbSnippets: e.target.checked }))} />
                            注入知识库片段（RAG）
                        </label>
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                            <input type="checkbox" checked={!!draft.includeTimeline} onChange={e => setDraft(prev => ({ ...prev, includeTimeline: e.target.checked }))} />
                            注入时间图谱（附近节点）
                        </label>
                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700">
                            <input type="checkbox" checked={!!draft.includeRelations} onChange={e => setDraft(prev => ({ ...prev, includeRelations: e.target.checked }))} />
                            注入关系图谱（节点依赖/阻塞/关联）
                        </label>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">时间图谱窗口</div>
                            <div className="mt-2 flex items-center gap-2">
                                <input
                                    type="number"
                                    min={1}
                                    max={180}
                                    value={Number(draft.timelineWindowDays || 21)}
                                    onChange={e => setDraft(prev => ({ ...prev, timelineWindowDays: Number(e.target.value) }))}
                                    className="w-24 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold"
                                />
                                <div className="text-xs text-slate-600">天（±）</div>
                            </div>
                        </div>
                        <div className="bg-slate-50 rounded-2xl p-4 border border-slate-100">
                            <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">知识库 TopK</div>
                            <div className="mt-2 flex items-center gap-2">
                                <input
                                    type="number"
                                    min={1}
                                    max={30}
                                    value={Number(draft.kbTopK || 8)}
                                    onChange={e => setDraft(prev => ({ ...prev, kbTopK: Number(e.target.value) }))}
                                    className="w-24 px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold"
                                />
                                <div className="text-xs text-slate-600">条片段</div>
                            </div>
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl p-4 border border-slate-100">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">用户补充背景</div>
                                <div className="text-xs text-slate-600 mt-1">用于补齐节点元数据之外的业务语境、目标、限制条件</div>
                            </div>
                        </div>
                        <textarea
                            value={draft.customNotes || ''}
                            onChange={e => setDraft(prev => ({ ...prev, customNotes: e.target.value }))}
                            className="mt-3 w-full h-28 rounded-2xl border border-slate-200 p-3 text-xs"
                            placeholder="例如：本节点对应年度品牌传播的关键里程碑；预算上限 3 万；必须与××机构联合发布..."
                        />
                    </div>

                    <div className="bg-white rounded-2xl p-4 border border-slate-100">
                        <div className="flex items-center justify-between">
                            <div>
                                <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">知识库检索范围（Scopes）</div>
                                <div className="text-xs text-slate-600 mt-1">可填文件或文件夹路径；作为 RAG 的硬范围过滤</div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button onClick={loadKbStats} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-[10px] font-black">从知识库选择</button>
                            </div>
                        </div>

                        <div className="mt-3 flex gap-2 flex-wrap">
                            {kbScopes.length === 0 ? (
                                <div className="text-xs text-slate-400 italic">未设置，将默认使用已挂载的知识库范围</div>
                            ) : kbScopes.map(p => (
                                <div key={p} className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-3 py-1">
                                    <div className="text-[10px] font-mono text-slate-700 max-w-[520px] truncate">{p}</div>
                                    <button onClick={() => removeKbScope(p)} className="text-slate-400 hover:text-red-500 text-xs font-black">×</button>
                                </div>
                            ))}
                        </div>

                        {showKbPicker && (
                            <div className="mt-4 border border-slate-200 rounded-2xl overflow-hidden">
                                <div className="p-3 bg-slate-50 flex items-center gap-2">
                                    <input
                                        value={kbSearch}
                                        onChange={e => setKbSearch(e.target.value)}
                                        className="flex-1 px-3 py-2 rounded-xl border border-slate-200 text-xs"
                                        placeholder="搜索 file_path..."
                                    />
                                    <button onClick={() => setShowKbPicker(false)} className="px-3 py-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600">收起</button>
                                </div>
                                <div className="max-h-64 overflow-y-auto custom-scrollbar divide-y">
                                    {filteredKbStats.map((s, idx) => {
                                        const p = String(s.file_path || '');
                                        const checked = kbScopes.includes(p);
                                        return (
                                            <div key={`${p}-${idx}`} className="p-3 flex items-center justify-between hover:bg-slate-50">
                                                <div className="min-w-0">
                                                    <div className="text-[10px] font-mono text-slate-700 truncate">{p}</div>
                                                    <div className="text-[10px] text-slate-400 mt-1">chunks: {Number(s.chunk_count || 0)} · ref: {Number(s.ref_count || 0)}</div>
                                                </div>
                                                <button onClick={() => toggleKbScope(p)} className={`px-3 py-1.5 rounded-xl text-[10px] font-black ${checked ? 'bg-green-600 text-white' : 'bg-slate-900 text-white'}`}>
                                                    {checked ? '已选' : '选择'}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>

                    <div className="bg-white rounded-2xl p-4 border border-slate-100">
                        <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">参考材料包（自动入库）</div>
                        <div className="text-xs text-slate-600 mt-1">来自“AI 排期提取”或后续扩展导入；将作为 RAG 范围的一部分</div>
                        <div className="mt-3 space-y-2">
                            {referencePacks.length === 0 ? (
                                <div className="text-xs text-slate-400 italic">暂无参考包</div>
                            ) : referencePacks.slice().reverse().map(p => (
                                <div key={p.packId} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
                                    <div className="min-w-0">
                                        <div className="text-xs font-bold text-slate-800 truncate">{p.title}</div>
                                        <div className="text-[10px] text-slate-500 font-mono truncate mt-1">{p.folderPath}</div>
                                    </div>
                                    <button onClick={() => openPackFolder(p.folderPath)} className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-slate-600 text-[10px] font-black hover:bg-slate-50">
                                        打开文件夹
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl p-4 border border-slate-100">
                        <div className="text-[10px] font-black text-slate-500 uppercase tracking-widest">关系图谱（手工维护）</div>
                        <div className="mt-3 grid grid-cols-4 gap-2">
                            <select value={relOtherId} onChange={e => setRelOtherId(e.target.value)} className="col-span-2 px-3 py-2 rounded-xl border border-slate-200 text-xs">
                                <option value="">选择关联节点...</option>
                                {sortedEvents.slice(0, 500).map(ev => (
                                    <option key={ev.id} value={ev.id}>{ev.date} · {ev.title}</option>
                                ))}
                            </select>
                            <select value={relType} onChange={e => setRelType(e.target.value as PlannerRelationType)} className="px-3 py-2 rounded-xl border border-slate-200 text-xs">
                                {REL_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                            </select>
                            <button onClick={addRelation} className="px-3 py-2 rounded-xl bg-slate-900 text-white text-xs font-black">添加</button>
                        </div>
                        <input
                            value={relNote}
                            onChange={e => setRelNote(e.target.value)}
                            className="mt-2 w-full px-3 py-2 rounded-xl border border-slate-200 text-xs"
                            placeholder="备注（可选）：例如“需先完成物料对齐”"
                        />
                        <div className="mt-4 space-y-2">
                            {relations.length === 0 ? (
                                <div className="text-xs text-slate-400 italic">暂无关系</div>
                            ) : relations.map((r, idx) => (
                                <div key={idx} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-2xl px-4 py-3">
                                    <div className="min-w-0">
                                        <div className="text-xs font-bold text-slate-800 truncate">
                                            {(eventById.get(r.fromEventId)?.date ? `${eventById.get(r.fromEventId)!.date} · ` : '')}{eventById.get(r.fromEventId)?.title || r.fromEventId}
                                            {' → '}
                                            {(eventById.get(r.toEventId)?.date ? `${eventById.get(r.toEventId)!.date} · ` : '')}{eventById.get(r.toEventId)?.title || r.toEventId}
                                            {' · '}
                                            {r.type}
                                        </div>
                                        {r.note && <div className="text-[10px] text-slate-500 mt-1 truncate">{r.note}</div>}
                                    </div>
                                    <button onClick={() => removeRelation(idx)} className="px-3 py-2 rounded-xl bg-white border border-slate-200 text-red-600 text-[10px] font-black hover:bg-red-50">
                                        删除
                                    </button>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PlanningContextModal;
