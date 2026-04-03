import { CalendarEvent, PlannerEventContextConfig, PlannerRelationEdge } from '../types';

const DEFAULT_CONFIG: Required<Pick<
    PlannerEventContextConfig,
    'includeEventMeta' | 'includeTimeline' | 'timelineWindowDays' | 'includeRelations' | 'includeKbSnippets' | 'kbTopK' | 'kbScopes' | 'relations' | 'referencePacks' | 'customNotes'
>> = {
    includeEventMeta: true,
    includeTimeline: true,
    timelineWindowDays: 21,
    includeRelations: true,
    includeKbSnippets: true,
    kbTopK: 8,
    kbScopes: [],
    relations: [],
    referencePacks: [],
    customNotes: ''
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

const dedupeStrings = (arr: string[]) => Array.from(new Set(arr.filter(Boolean)));

const normalizeConfig = (cfg: PlannerEventContextConfig | null | undefined): PlannerEventContextConfig => {
    const base = cfg && typeof cfg === 'object' ? cfg : {};
    return {
        ...DEFAULT_CONFIG,
        ...base,
        timelineWindowDays: clamp(Number(base.timelineWindowDays ?? DEFAULT_CONFIG.timelineWindowDays), 1, 180),
        kbTopK: clamp(Number(base.kbTopK ?? DEFAULT_CONFIG.kbTopK), 1, 30),
        kbScopes: dedupeStrings(Array.isArray(base.kbScopes) ? base.kbScopes : []),
        relations: Array.isArray(base.relations) ? base.relations : [],
        referencePacks: Array.isArray(base.referencePacks) ? base.referencePacks : [],
        customNotes: String(base.customNotes ?? '')
    };
};

const dateToTs = (dateStr?: string) => {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    const t = d.getTime();
    if (!Number.isFinite(t)) return null;
    return t;
};

const truncate = (s: string, maxLen: number) => {
    const text = String(s || '');
    if (text.length <= maxLen) return text;
    return text.slice(0, Math.max(0, maxLen - 1)) + '…';
};

const summarizeRelations = (eventId: string, relations: PlannerRelationEdge[], allEvents: CalendarEvent[]) => {
    const byId = new Map(allEvents.map(e => [e.id, e] as const));
    const connected = (relations || []).filter(r => r?.fromEventId === eventId || r?.toEventId === eventId);
    if (connected.length === 0) return '';

    const lines = connected.slice(0, 12).map(r => {
        const otherId = r.fromEventId === eventId ? r.toEventId : r.fromEventId;
        const other = byId.get(otherId);
        const otherLabel = other ? `${other.date} ${other.title}` : otherId;
        const dir = r.fromEventId === eventId ? '→' : '←';
        const type = r.type || 'related';
        const note = r.note ? ` | ${truncate(r.note, 60)}` : '';
        return `- ${dir} ${type} | ${otherLabel}${note}`;
    });
    return `【关系图谱】\n${lines.join('\n')}`;
};

const summarizeTimeline = (event: CalendarEvent, allEvents: CalendarEvent[], windowDays: number) => {
    const center = dateToTs(event.date);
    if (!center) return '';
    const start = center - windowDays * 86400_000;
    const end = center + windowDays * 86400_000;

    const rows = allEvents
        .filter(e => e.id !== event.id)
        .map(e => ({ e, t: dateToTs(e.date) }))
        .filter(x => x.t !== null && x.t! >= start && x.t! <= end)
        .sort((a, b) => (a.t! - b.t!))
        .slice(0, 40)
        .map(x => {
            const domains = Array.isArray(x.e.relevantDomains) ? x.e.relevantDomains.filter(Boolean) : [];
            const domainStr = domains.length > 0 ? domains[0] : '';
            const pr = x.e.priority ? `${x.e.priority.isImportant ? '重要' : ''}${x.e.priority.isUrgent ? '紧急' : ''}` : '';
            const meta = [domainStr, pr].filter(Boolean).join(' / ');
            return `- ${x.e.date} | ${truncate(x.e.title, 40)}${meta ? ` | ${meta}` : ''}`;
        });

    if (rows.length === 0) return '';
    return `【时间图谱（±${windowDays}天）】\n${rows.join('\n')}`;
};

export const getPlannerEventContextConfig = async (eventId: string): Promise<PlannerEventContextConfig> => {
    const api = (window as any)?.electronAPI?.plannerContext;
    if (!api) return normalizeConfig(null);
    const res = await api.get(eventId);
    return normalizeConfig(res?.config || res?.Config || res);
};

export const getPlannerKbScopesForEvents = async (eventIds: string[]): Promise<string[]> => {
    const api = (window as any)?.electronAPI?.plannerContext;
    if (!api?.get) return [];
    const ids = Array.isArray(eventIds) ? eventIds.filter(Boolean).slice(0, 200) : [];
    if (ids.length === 0) return [];

    const scopes = new Set<string>();
    const results = await Promise.all(ids.map(async (id) => {
        try {
            return await api.get(id);
        } catch (e) {
            return null;
        }
    }));

    for (const r of results) {
        const cfg = r?.config && typeof r.config === 'object' ? r.config : null;
        if (!cfg) continue;
        const kbScopes = Array.isArray(cfg.kbScopes) ? cfg.kbScopes : [];
        kbScopes.forEach((p: any) => { if (p) scopes.add(String(p)); });
        const packs = Array.isArray(cfg.referencePacks) ? cfg.referencePacks : [];
        packs.forEach((p: any) => { if (p?.folderPath) scopes.add(String(p.folderPath)); });
    }

    return Array.from(scopes);
};

export const upsertPlannerEventContextConfig = async (eventId: string, config: PlannerEventContextConfig) => {
    const api = (window as any)?.electronAPI?.plannerContext;
    if (!api) return { success: false, error: 'not_desktop' };
    return await api.upsert(eventId, config);
};

export const buildPlannerAssistantContext = async (params: {
    event: CalendarEvent;
    allEvents: CalendarEvent[];
    config: PlannerEventContextConfig;
    globalKbScopes?: string[];
}) => {
    const { event, allEvents } = params;
    const config = normalizeConfig(params.config);
    const globalKbScopes = dedupeStrings(Array.isArray(params.globalKbScopes) ? params.globalKbScopes : []);

    const blocks: string[] = [];

    if (config.customNotes?.trim()) {
        blocks.push(`【用户补充背景】\n${truncate(config.customNotes.trim(), 1200)}`);
    }

    if (config.includeEventMeta) {
        const domains = Array.isArray(event.relevantDomains) ? event.relevantDomains.filter(Boolean) : [];
        const domainStr = domains.length > 0 ? domains[0] : '';
        const pr = event.priority ? `${event.priority.isImportant ? '重要' : ''}${event.priority.isUrgent ? '紧急' : ''}` : '';
        blocks.push(
            `【节点元数据】\n- 日期：${event.date}\n- 标题：${truncate(event.title, 80)}\n- 领域：${domainStr || '未设置'}\n- 优先级：${pr || '未设置'}\n- 描述：${truncate(event.description || '暂无', 800)}`
        );
    }

    if (config.includeRelations) {
        const rel = summarizeRelations(event.id, config.relations || [], allEvents);
        if (rel) blocks.push(rel);
    }

    if (config.includeTimeline) {
        const tl = summarizeTimeline(event, allEvents, Number(config.timelineWindowDays || 21));
        if (tl) blocks.push(tl);
    }

    if (config.includeKbSnippets) {
        const explicitScopes = dedupeStrings(Array.isArray(config.kbScopes) ? config.kbScopes : []);
        const packScopes = dedupeStrings(((Array.isArray(config.referencePacks) ? config.referencePacks : []).map(p => p?.folderPath).filter(Boolean) as string[]));
        const kbScopes = explicitScopes.length > 0
            ? dedupeStrings([...explicitScopes, ...packScopes])
            : dedupeStrings([...globalKbScopes, ...packScopes]);

        const kb = (window as any)?.electronAPI?.knowledge;
        if (kb?.query) {
            const queryText = truncate(`${event.title}\n${event.description || ''}\n${config.customNotes || ''}`.trim(), 1800);
            const result = await kb.query({ text: queryText, topK: config.kbTopK || 8, activeFiles: kbScopes.length > 0 ? kbScopes : undefined });
            const chunks = Array.isArray(result?.chunks) ? result.chunks : [];
            const lines = chunks.slice(0, config.kbTopK || 8).map((c: any, idx: number) => {
                const src = c?.source ? String(c.source) : '';
                const score = typeof c?.score === 'number' ? c.score.toFixed(3) : '';
                const text = truncate(String(c?.text || ''), 360);
                const srcName = src ? src.split(/[\\/]/).pop() : '';
                return `- [${idx + 1}] ${srcName || '未知来源'}${score ? ` | ${score}` : ''} | ${text}`;
            });
            if (lines.length > 0) {
                blocks.push(`【知识库片段】\n${lines.join('\n')}`);
            }
        }
    }

    const finalText = blocks.filter(Boolean).join('\n\n');
    return truncate(finalText, 8000);
};
