import type { Edge, Node } from '@xyflow/react';

export type ForceLayoutOptions = {
    width: number;
    height: number;
    iterations?: number;
    repulsion?: number;
    spring?: number;
    gravity?: number;
    maxStep?: number;
    padding?: number;
};

type Vec = { x: number; y: number };

const hashSeed = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return h >>> 0;
};

const seeded01 = (seed: number) => {
    let t = seed + 0x6d2b79f5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return r;
};

export const applyForceLayout = (nodes: Node[], edges: (Edge & { data?: any })[], opts: ForceLayoutOptions) => {
    const width = Math.max(300, opts.width);
    const height = Math.max(220, opts.height);
    const iterations = Math.max(50, opts.iterations ?? 260);
    const repulsion = opts.repulsion ?? 4200;
    const spring = opts.spring ?? 0.06;
    const gravity = opts.gravity ?? 0.015;
    const maxStep = opts.maxStep ?? 12;
    const padding = opts.padding ?? 24;

    const indexById = new Map<string, number>();
    nodes.forEach((n, i) => indexById.set(n.id, i));

    const pos: Vec[] = nodes.map((n) => {
        const seed = hashSeed(n.id);
        const jitterX = (seeded01(seed) - 0.5) * 0.5;
        const jitterY = (seeded01(seed ^ 0x9e3779b9) - 0.5) * 0.5;
        const x0 = typeof n.position?.x === 'number' ? n.position.x : (seeded01(seed ^ 0xa5a5a5a5) * width);
        const y0 = typeof n.position?.y === 'number' ? n.position.y : (seeded01(seed ^ 0x5a5a5a5a) * height);
        return { x: x0 + jitterX * 120, y: y0 + jitterY * 120 };
    });

    const vel: Vec[] = nodes.map(() => ({ x: 0, y: 0 }));

    const getSize = (n: Node) => {
        const w = typeof (n.style as any)?.width === 'number' ? ((n.style as any).width as number) : 64;
        const h = typeof (n.style as any)?.height === 'number' ? ((n.style as any).height as number) : 64;
        return { w, h, r: Math.max(w, h) / 2 };
    };

    const sizes = nodes.map(getSize);

    const adj: { a: number; b: number; w: number }[] = [];
    edges.forEach((e) => {
        const a = indexById.get(e.source);
        const b = indexById.get(e.target);
        if (a === undefined || b === undefined) return;
        const w = typeof (e.data as any)?.w === 'number' ? (e.data as any).w : 1;
        adj.push({ a, b, w: Math.max(0.05, Math.min(5, w)) });
    });

    const cx = width / 2;
    const cy = height / 2;

    for (let iter = 0; iter < iterations; iter++) {
        const fx: number[] = new Array(nodes.length).fill(0);
        const fy: number[] = new Array(nodes.length).fill(0);

        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const dx = pos[j].x - pos[i].x;
                const dy = pos[j].y - pos[i].y;
                const dist2 = dx * dx + dy * dy + 1e-6;
                const dist = Math.sqrt(dist2);
                const minDist = (sizes[i].r + sizes[j].r) * 0.95;
                const k = repulsion / dist2;
                const overlapBoost = dist < minDist ? (minDist - dist) * 0.9 : 0;
                const f = k + overlapBoost;
                const ux = dx / dist;
                const uy = dy / dist;
                fx[i] -= ux * f;
                fy[i] -= uy * f;
                fx[j] += ux * f;
                fy[j] += uy * f;
            }
        }

        for (const e of adj) {
            const dx = pos[e.b].x - pos[e.a].x;
            const dy = pos[e.b].y - pos[e.a].y;
            const dist = Math.sqrt(dx * dx + dy * dy) + 1e-6;
            const ux = dx / dist;
            const uy = dy / dist;
            const ideal = (sizes[e.a].r + sizes[e.b].r) * (2.05 - Math.min(1.0, (e.w - 0.1) / 2.0));
            const delta = dist - ideal;
            const f = spring * e.w * delta;
            fx[e.a] += ux * f;
            fy[e.a] += uy * f;
            fx[e.b] -= ux * f;
            fy[e.b] -= uy * f;
        }

        for (let i = 0; i < nodes.length; i++) {
            fx[i] += (cx - pos[i].x) * gravity;
            fy[i] += (cy - pos[i].y) * gravity;
        }

        for (let i = 0; i < nodes.length; i++) {
            vel[i].x = (vel[i].x + fx[i]) * 0.78;
            vel[i].y = (vel[i].y + fy[i]) * 0.78;
            const stepX = Math.max(-maxStep, Math.min(maxStep, vel[i].x));
            const stepY = Math.max(-maxStep, Math.min(maxStep, vel[i].y));
            pos[i].x += stepX;
            pos[i].y += stepY;
        }
    }

    for (let i = 0; i < nodes.length; i++) {
        pos[i].x = Math.max(padding, Math.min(width - padding, pos[i].x));
        pos[i].y = Math.max(padding, Math.min(height - padding, pos[i].y));
    }

    return nodes.map((n, i) => ({ ...n, position: { x: pos[i].x, y: pos[i].y } }));
};

