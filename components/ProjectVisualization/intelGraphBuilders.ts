import type { Edge, Node } from '@xyflow/react';
import type { VisualizationStyle } from './graphBuilders';

type IntelItem = {
    id: string;
    url?: string;
    title?: string;
    snippet?: string;
    created_at?: number;
};

type IntelHighlight = {
    id: string;
    url?: string;
    title?: string;
    selected_text?: string;
    tags?: string[];
    tags_json?: string;
    created_at?: number;
};

type IntelOcrFrame = {
    id: string;
    url?: string;
    title?: string;
    image_path?: string;
    ocr_text?: string;
    created_at?: number;
};

export type IntelGraphBuildInput = {
    items: IntelItem[];
    highlights: IntelHighlight[];
    frames: IntelOcrFrame[];
    style: VisualizationStyle;
};

export type BuiltIntelGraph = {
    nodes: Node[];
    edges: (Edge & { data?: { w?: number } })[];
};

const safeParseJson = <T,>(value: any, fallback: T): T => {
    try {
        if (value === null || value === undefined) return fallback;
        if (typeof value === 'object') return value as T;
        return JSON.parse(String(value)) as T;
    } catch {
        return fallback;
    }
};

const uniq = <T,>(arr: T[]) => [...new Set(arr)];

const edgeBase = (style: VisualizationStyle) => ({
    type: style.edgeType,
    style: { stroke: style.edgeColor, strokeWidth: style.edgeWidth, opacity: 0.7 },
});

const bubble = (id: string, size: number, fill: string, stroke: string, text: string, data: any): Node => ({
    id,
    type: 'bubble',
    position: { x: 0, y: 0 },
    data,
    style: { width: size, height: size },
    draggable: true,
});

const urlKey = (u?: string) => (typeof u === 'string' ? u.trim().toLowerCase() : '');

export const buildIntelGraph = (input: IntelGraphBuildInput): BuiltIntelGraph => {
    const edges: (Edge & { data?: { w?: number } })[] = [];
    const nodes: Node[] = [];
    const edgeIds = new Set<string>();

    const pushEdge = (id: string, source: string, target: string, w: number, extra?: Partial<Edge>) => {
        if (edgeIds.has(id)) return;
        edgeIds.add(id);
        edges.push({
            id,
            source,
            target,
            ...edgeBase(input.style),
            ...(extra || {}),
            data: { w },
            style: { ...(edgeBase(input.style).style as any), strokeWidth: Math.max(1, input.style.edgeWidth * (0.65 + Math.min(2, w) * 0.45)) },
        });
    };

    const itemByUrl = new Map<string, IntelItem>();
    input.items.forEach((it) => {
        const k = urlKey(it.url);
        if (!k) return;
        if (!itemByUrl.has(k)) itemByUrl.set(k, it);
    });

    const highlightsByUrl = new Map<string, IntelHighlight[]>();
    input.highlights.forEach((h) => {
        const k = urlKey(h.url);
        if (!k) return;
        if (!highlightsByUrl.has(k)) highlightsByUrl.set(k, []);
        highlightsByUrl.get(k)!.push(h);
    });

    const framesByUrl = new Map<string, IntelOcrFrame[]>();
    input.frames.forEach((f) => {
        const k = urlKey(f.url);
        if (!k) return;
        if (!framesByUrl.has(k)) framesByUrl.set(k, []);
        framesByUrl.get(k)!.push(f);
    });

    const tagWeight = new Map<string, number>();
    const tagByUrl = new Map<string, Map<string, number>>();

    highlightsByUrl.forEach((hs, u) => {
        const m = new Map<string, number>();
        hs.forEach((h) => {
            const tags = Array.isArray(h.tags) ? h.tags : safeParseJson<string[]>(h.tags_json, []);
            tags
                .filter((t) => typeof t === 'string')
                .map((t) => t.trim())
                .filter(Boolean)
                .slice(0, 18)
                .forEach((t) => {
                    m.set(t, (m.get(t) || 0) + 1);
                    tagWeight.set(t, (tagWeight.get(t) || 0) + 1);
                });
        });
        if (m.size > 0) tagByUrl.set(u, m);
    });

    const urls = uniq([
        ...input.items.map((x) => urlKey(x.url)).filter(Boolean),
        ...Array.from(highlightsByUrl.keys()),
        ...Array.from(framesByUrl.keys()),
    ]);

    const ensureItemNode = (u: string) => {
        const it = itemByUrl.get(u);
        const id = it ? `intel:item:${it.id}` : `intel:url:${u}`;
        const existing = nodes.find((n) => n.id === id);
        if (existing) return id;

        const highlightsCount = (highlightsByUrl.get(u) || []).length;
        const frameCount = (framesByUrl.get(u) || []).length;
        const title = (it?.title || '').trim() || '页面';
        const subtitle = (() => {
            try {
                const parsed = new URL(it?.url || u);
                return parsed.hostname;
            } catch {
                return '';
            }
        })();
        const badge = [highlightsCount ? `划线 ${highlightsCount}` : '', frameCount ? `OCR ${frameCount}` : ''].filter(Boolean).join(' · ');

        nodes.push(
            bubble(
                id,
                112,
                '#ffffff',
                input.style.palette.projectStroke,
                input.style.palette.neutralText,
                {
                    title,
                    subtitle,
                    badge,
                    fill: '#ffffff',
                    stroke: input.style.palette.projectStroke,
                    text: input.style.palette.neutralText,
                    kind: 'intel_item',
                    url: it?.url || u,
                    tooltip: it?.url || u,
                }
            )
        );
        return id;
    };

    const ensureTagNode = (tag: string) => {
        const id = `intel:tag:${tag}`;
        const existing = nodes.find((n) => n.id === id);
        if (existing) return id;
        const w = tagWeight.get(tag) || 1;
        const size = Math.max(68, Math.min(108, 68 + w * 6));
        nodes.push(
            bubble(id, size, input.style.palette.neutralFill, input.style.palette.ownerStroke, input.style.palette.neutralText, {
                title: tag,
                subtitle: `${w} 次`,
                fill: input.style.palette.neutralFill,
                stroke: input.style.palette.ownerStroke,
                text: input.style.palette.neutralText,
                kind: 'intel_tag',
                tooltip: `${tag} · ${w} 次`,
            })
        );
        return id;
    };

    urls.forEach((u) => {
        const itemNodeId = ensureItemNode(u);
        const tags = tagByUrl.get(u);
        if (!tags) return;
        tags.forEach((w, tag) => {
            const tagNodeId = ensureTagNode(tag);
            pushEdge(`e:${itemNodeId}->${tagNodeId}`, itemNodeId, tagNodeId, w);
        });
    });

    return { nodes, edges };
};

