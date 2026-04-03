import type { Project } from '../../types';

const millisInDay = 24 * 60 * 60 * 1000;

const parseDate = (raw?: string) => {
    if (!raw) return null;
    const s = raw.trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const d = new Date(`${s}T12:00:00`);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
};

const uniq = <T,>(arr: T[]) => [...new Set(arr)];

const parseOwners = (raw?: string): string[] => {
    if (!raw) return [];
    const s = raw
        .replace(/负责人[:：]/g, '')
        .replace(/协助[:：]/g, '')
        .replace(/[、，；;|/]/g, ',');
    return uniq(
        s
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
            .map((x) => x.replace(/\(协\)|协助|support/gi, '').trim())
            .filter(Boolean)
    );
};

type TaskLike = {
    projectId: string;
    projectTitle: string;
    taskId: string;
    title: string;
    status: string;
    deadline?: string;
    owners: string[];
    stage?: string;
};

export type OfflineInsights = {
    ownerConflicts: Array<{
        owner: string;
        windowDays: number;
        items: Array<{ projectTitle: string; title: string; deadline?: string; status: string }>;
    }>;
    projectConflicts: Array<{
        a: { projectId: string; title: string; window?: string };
        b: { projectId: string; title: string; window?: string };
        sharedOwners: string[];
        overlapScore: number;
    }>;
    tightClusters: Array<{
        summary: string;
        items: Array<{ projectTitle: string; title: string; deadline?: string; owners: string[]; status: string }>;
    }>;
};

export const computeOfflineInsights = (tasks: TaskLike[], projects?: Project[]): OfflineInsights => {
    const active = tasks.filter((t) => t.status !== 'Done');

    const byOwner = new Map<string, TaskLike[]>();
    active.forEach((t) => {
        (t.owners || []).forEach((o) => {
            if (!byOwner.has(o)) byOwner.set(o, []);
            byOwner.get(o)!.push(t);
        });
    });

    const ownerConflicts: OfflineInsights['ownerConflicts'] = [];
    byOwner.forEach((items, owner) => {
        const sorted = items
            .map((t) => ({ t, d: parseDate(t.deadline) }))
            .filter((x) => x.d)
            .sort((a, b) => a.d!.getTime() - b.d!.getTime());

        const groups: TaskLike[][] = [];
        let cur: TaskLike[] = [];
        for (let i = 0; i < sorted.length; i++) {
            const prev = sorted[i - 1];
            const curr = sorted[i];
            if (!prev) {
                cur = [curr.t];
                continue;
            }
            const gapDays = (curr.d!.getTime() - prev.d!.getTime()) / millisInDay;
            if (gapDays <= 2.2) cur.push(curr.t);
            else {
                if (cur.length >= 2) groups.push(cur);
                cur = [curr.t];
            }
        }
        if (cur.length >= 2) groups.push(cur);

        groups.forEach((g) => {
            ownerConflicts.push({
                owner,
                windowDays: 2,
                items: g
                    .slice(0, 8)
                    .map((x) => ({ projectTitle: x.projectTitle, title: x.title, deadline: x.deadline, status: x.status })),
            });
        });
    });

    const projectWindows = new Map<string, { title: string; start?: Date | null; end?: Date | null; owners: string[] }>();
    if (projects && projects.length) {
        projects
            .filter((p) => p.status !== 'Archived')
            .forEach((p) => {
                const end = (p.milestones || []).map((m) => parseDate(m.completionDate)).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime()).slice(-1)[0] || null;
                const start = parseDate(p.startDate);
                const owners = uniq((p.milestones || []).flatMap((m) => parseOwners(m.chargePerson)));
                projectWindows.set(p.id, { title: p.title, start, end, owners });
            });
    } else {
        const byProject = new Map<string, TaskLike[]>();
        active.forEach((t) => {
            if (!byProject.has(t.projectId)) byProject.set(t.projectId, []);
            byProject.get(t.projectId)!.push(t);
        });
        byProject.forEach((items, projectId) => {
            const title = items[0]?.projectTitle || projectId;
            const dates = items.map((t) => parseDate(t.deadline)).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime());
            projectWindows.set(projectId, { title, start: null, end: dates.slice(-1)[0] || null, owners: uniq(items.flatMap((t) => t.owners || [])) });
        });
    }

    const projectIds = [...projectWindows.keys()];
    const projectConflicts: OfflineInsights['projectConflicts'] = [];
    for (let i = 0; i < projectIds.length; i++) {
        for (let j = i + 1; j < projectIds.length; j++) {
            const a = projectWindows.get(projectIds[i])!;
            const b = projectWindows.get(projectIds[j])!;
            const sharedOwners = a.owners.filter((o) => b.owners.includes(o));
            if (sharedOwners.length === 0) continue;
            const ae = a.end?.getTime() ?? 0;
            const be = b.end?.getTime() ?? 0;
            if (!ae || !be) continue;
            const dtDays = Math.abs(ae - be) / millisInDay;
            const overlapScore = Math.exp(-dtDays / 10);
            if (overlapScore < 0.35) continue;
            projectConflicts.push({
                a: { projectId: projectIds[i], title: a.title, window: a.end ? a.end.toISOString().slice(0, 10) : undefined },
                b: { projectId: projectIds[j], title: b.title, window: b.end ? b.end.toISOString().slice(0, 10) : undefined },
                sharedOwners,
                overlapScore: Number(overlapScore.toFixed(2)),
            });
        }
    }

    const n = active.length;
    const parent = new Array(n).fill(0).map((_, i) => i);
    const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    const union = (a: number, b: number) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent[rb] = ra;
    };

    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            const ti = timeAffinity(active[i].deadline, active[j].deadline);
            const oi = jaccard(active[i].owners || [], active[j].owners || []);
            const w = 0.65 * ti + 0.85 * oi + (active[i].projectId === active[j].projectId ? 0.15 : 0);
            if (w >= 0.62) union(i, j);
        }
    }

    const groups = new Map<number, TaskLike[]>();
    for (let i = 0; i < n; i++) {
        const r = find(i);
        if (!groups.has(r)) groups.set(r, []);
        groups.get(r)!.push(active[i]);
    }

    const tightClusters: OfflineInsights['tightClusters'] = [...groups.values()]
        .filter((g) => g.length >= 3)
        .sort((a, b) => b.length - a.length)
        .slice(0, 6)
        .map((g) => {
            const owners = uniq(g.flatMap((x) => x.owners || []));
            const dates = g.map((x) => parseDate(x.deadline)).filter(Boolean).sort((a, b) => a!.getTime() - b!.getTime());
            const span = dates.length ? (dates[dates.length - 1]!.getTime() - dates[0]!.getTime()) / millisInDay : 0;
            return {
                summary: `规模 ${g.length} • 负责人 ${owners.length} • 时间跨度 ${span ? `${Math.round(span)} 天` : '未知'}`,
                items: g
                    .slice(0, 10)
                    .map((x) => ({ projectTitle: x.projectTitle, title: x.title, deadline: x.deadline, owners: x.owners || [], status: x.status })),
            };
        });

    return { ownerConflicts, projectConflicts, tightClusters };
};

const timeAffinity = (a?: string, b?: string) => {
    const da = parseDate(a);
    const db = parseDate(b);
    if (!da || !db) return 0;
    const dtDays = Math.abs(da.getTime() - db.getTime()) / millisInDay;
    return Math.exp(-dtDays / 7);
};

const jaccard = (a: string[], b: string[]) => {
    if (a.length === 0 || b.length === 0) return 0;
    const sa = new Set(a);
    const sb = new Set(b);
    let inter = 0;
    sa.forEach((x) => {
        if (sb.has(x)) inter++;
    });
    const union = sa.size + sb.size - inter;
    return union === 0 ? 0 : inter / union;
};
