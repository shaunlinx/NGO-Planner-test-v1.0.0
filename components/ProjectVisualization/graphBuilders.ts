import type { Edge, Node } from '@xyflow/react';
import type { Project, TeamMember } from '../../types';

export type VisualizationView = 'people' | 'projects' | 'relations' | 'resources';

export type VisualizationStyle = {
    edgeType: 'straight' | 'smoothstep';
    edgeColor: string;
    edgeWidth: number;
    palette: {
        pending: string;
        inProgress: string;
        done: string;
        urgent: string;
        financeOk: string;
        financeBad: string;
        financeUnknown: string;
        ownerStroke: string;
        projectStroke: string;
        docStroke: string;
        neutralStroke: string;
        neutralFill: string;
        neutralText: string;
    };
};

export type GraphBuildInput = {
    projects: Project[];
    teamMembers: TeamMember[];
    style: VisualizationStyle;
    expandedDocs?: Record<string, boolean>;
    docChunks?: Record<string, { status: 'idle' | 'loading' | 'ready' | 'error'; filePath: string; chunks: any[] }>;
};

export type BuiltGraph = {
    nodes: Node[];
    edges: (Edge & { data?: { w?: number } })[];
    model: {
        tasks: Array<{
            projectId: string;
            projectTitle: string;
            taskId: string;
            title: string;
            status: string;
            deadline?: string;
            owners: string[];
            stage?: string;
        }>;
    };
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

const parseDeadline = (raw?: string): Date | null => {
    if (!raw) return null;
    const s = raw.trim();
    if (!s) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
        const d = new Date(`${s}T23:59:59`);
        return Number.isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
};

const millisInDay = 24 * 60 * 60 * 1000;

const timeAffinity = (a?: string, b?: string) => {
    const da = parseDeadline(a);
    const db = parseDeadline(b);
    if (!da || !db) return 0;
    const dtDays = Math.abs(da.getTime() - db.getTime()) / millisInDay;
    const sigma = 7;
    return Math.exp(-dtDays / sigma);
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

const getAttachmentOpenPath = (a: any): string | null => {
    const raw = a?.markdownPath || a?.originalPath || a?.url || '';
    if (typeof raw !== 'string') return null;
    const s = raw.trim();
    return s ? s : null;
};

const getFileNameFromPath = (p: string) => {
    const parts = p.split(/[\\/]/);
    return parts[parts.length - 1] || p;
};

const computeProjectEndDate = (p: Project) => {
    const dates = (p.milestones || []).map((m) => m.completionDate).filter((d): d is string => !!d);
    if (dates.length === 0) return null;
    return dates.sort().slice(-1)[0];
};

const taskColor = (status: string, deadlineRaw: string | undefined, now: Date, style: VisualizationStyle) => {
    if (status === 'Done') return style.palette.done;
    const deadline = parseDeadline(deadlineRaw);
    if (deadline) {
        const diff = deadline.getTime() - now.getTime();
        if (diff >= 0 && diff <= millisInDay) return style.palette.urgent;
    }
    if (status === 'In Progress') return style.palette.inProgress;
    return style.palette.pending;
};

const financeColor = (p: Project, style: VisualizationStyle) => {
    const budget = (p.expenses || []).reduce((sum, x) => sum + (Number(x.budgetAmount) || 0), 0);
    const actual = (p.expenses || []).reduce((sum, x) => sum + (Number(x.actualAmount) || 0), 0);
    if (budget === 0 || actual === 0) return style.palette.financeUnknown;
    if (actual > budget) return style.palette.financeBad;
    return style.palette.financeOk;
};

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

export const buildGraph = (view: VisualizationView, input: GraphBuildInput): BuiltGraph => {
    const now = new Date();
    const activeProjects = input.projects.filter((p) => p.status !== 'Archived');
    const edges: (Edge & { data?: { w?: number } })[] = [];
    const nodes: Node[] = [];
    const edgeIds = new Set<string>();
    const modelTasks: BuiltGraph['model']['tasks'] = [];

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
            style: { ...(edgeBase(input.style).style as any), strokeWidth: Math.max(1, input.style.edgeWidth * (0.65 + Math.min(1.6, w) * 0.45)) },
        });
    };

    if (view === 'people' || view === 'projects') {
        const ownerAI = new Set(input.teamMembers.filter((m) => m.isAI).map((m) => m.nickname));
        const ownerNodeId = (name: string) => `owner:${name}`;
        const ownerNodes = new Set<string>();

        const ensureOwner = (name: string) => {
            const id = ownerNodeId(name);
            if (ownerNodes.has(id)) return id;
            ownerNodes.add(id);
            const isAI = ownerAI.has(name);
            nodes.push(
                bubble(
                    id,
                    108,
                    '#ffffff',
                    input.style.palette.ownerStroke,
                    input.style.palette.neutralText,
                    {
                        title: `${isAI ? '🤖' : '👤'} ${name}`,
                        fill: '#ffffff',
                        stroke: input.style.palette.ownerStroke,
                        text: input.style.palette.neutralText,
                        kind: 'owner',
                        tooltip: name,
                    }
                )
            );
            return id;
        };

        if (view === 'people') {
            const milestoneNodes = new Set<string>();
            const taskNodes = new Set<string>();

            const ensureMilestone = (projectId: string, stage: string, dateLabel?: string) => {
                const id = `milestone:${projectId}:${stage}`;
                if (milestoneNodes.has(id)) return id;
                milestoneNodes.add(id);
                nodes.push(
                    bubble(id, 84, '#eef2ff', '#a5b4fc', input.style.palette.neutralText, {
                        title: stage,
                        subtitle: dateLabel || '',
                        fill: '#eef2ff',
                        stroke: '#a5b4fc',
                        text: input.style.palette.neutralText,
                        kind: 'milestone',
                        tooltip: `${stage}${dateLabel ? ` • ${dateLabel}` : ''}`,
                    })
                );
                return id;
            };

            const ensureTask = (projectId: string, taskId: string, title: string, status: string, deadlineRaw?: string, ownerLabel?: string) => {
                const id = `task:${projectId}:${taskId}`;
                if (taskNodes.has(id)) return id;
                taskNodes.add(id);
                const fill = taskColor(status, deadlineRaw, now, input.style);
                nodes.push(
                    bubble(id, 56, fill, input.style.palette.neutralStroke, input.style.palette.neutralText, {
                        title,
                        subtitle: deadlineRaw || '',
                        badge: ownerLabel || '',
                        fill,
                        stroke: input.style.palette.neutralStroke,
                        text: input.style.palette.neutralText,
                        kind: 'task',
                        tooltip: `${title}${deadlineRaw ? ` • ${deadlineRaw}` : ''}${ownerLabel ? ` • ${ownerLabel}` : ''}`,
                    })
                );
                return id;
            };

            const stageMinDeadline = new Map<string, string | undefined>();
            activeProjects.forEach((p) => {
                (p.milestones || []).forEach((t) => {
                    const stage = t.stage || '里程碑';
                    const key = `${p.id}::${stage}`;
                    const candidate = t.completionDate;
                    if (!candidate) return;
                    const current = stageMinDeadline.get(key);
                    if (!current || candidate < current) stageMinDeadline.set(key, candidate);
                });
            });

            const tasksForAffinity: Array<{ id: string; deadline?: string; owners: string[]; projectId: string; stage?: string; title: string }> = [];

            activeProjects.forEach((p) => {
                (p.milestones || []).forEach((t) => {
                    const owners = parseOwners(t.chargePerson);
                    if (owners.length === 0) return;
                    const stage = t.stage || '里程碑';
                    const milestoneId = ensureMilestone(p.id, stage, stageMinDeadline.get(`${p.id}::${stage}`));
                    const taskId = ensureTask(p.id, t.id, t.task || '任务', t.status, t.completionDate, owners.join('、'));
                    pushEdge(`milestone-to-task:${milestoneId}:${taskId}`, milestoneId, taskId, 1.1);
                    owners.forEach((o) => {
                        const ownerId = ensureOwner(o);
                        pushEdge(`owner-to-milestone:${ownerId}:${milestoneId}`, ownerId, milestoneId, 1.5);
                        pushEdge(`owner-to-task:${ownerId}:${taskId}`, ownerId, taskId, 2.2);
                    });

                    tasksForAffinity.push({ id: taskId, deadline: t.completionDate, owners, projectId: p.id, stage, title: t.task || '任务' });
                    modelTasks.push({
                        projectId: p.id,
                        projectTitle: p.title,
                        taskId: t.id,
                        title: t.task,
                        status: t.status,
                        deadline: t.completionDate,
                        owners,
                        stage,
                    });
                });
            });

            for (let i = 0; i < tasksForAffinity.length; i++) {
                for (let j = i + 1; j < tasksForAffinity.length; j++) {
                    const a = tasksForAffinity[i];
                    const b = tasksForAffinity[j];
                    const tAff = timeAffinity(a.deadline, b.deadline);
                    const oAff = jaccard(a.owners, b.owners);
                    const pAff = a.projectId === b.projectId ? 0.4 : 0;
                    const sAff = a.stage && b.stage && a.stage === b.stage ? 0.25 : 0;
                    const w = 2.1 * tAff + 2.2 * oAff + pAff + sAff;
                    if (w < 0.9) continue;
                    pushEdge(`task-aff:${a.id}:${b.id}`, a.id, b.id, Math.min(4.2, w), { animated: w > 2.8 });
                }
            }
        }

        if (view === 'projects') {
            const projectNodes = new Set<string>();
            const personNodes = new Set<string>();
            const taskNodes = new Set<string>();

            const ensureProject = (p: Project) => {
                const id = `project:${p.id}`;
                if (projectNodes.has(id)) return id;
                projectNodes.add(id);
                nodes.push(
                    bubble(id, 120, '#ffffff', input.style.palette.projectStroke, input.style.palette.neutralText, {
                        title: `🏗️ ${p.title}`,
                        subtitle: p.startDate,
                        fill: '#ffffff',
                        stroke: input.style.palette.projectStroke,
                        text: input.style.palette.neutralText,
                        kind: 'project',
                        tooltip: p.title,
                    })
                );
                return id;
            };

            const ensurePerson = (projectId: string, name: string) => {
                const id = `person:${projectId}:${name}`;
                if (personNodes.has(id)) return id;
                personNodes.add(id);
                const isAI = ownerAI.has(name);
                nodes.push(
                    bubble(id, 86, '#f8fafc', input.style.palette.neutralStroke, input.style.palette.neutralText, {
                        title: `${isAI ? '🤖' : '👤'} ${name}`,
                        fill: '#f8fafc',
                        stroke: input.style.palette.neutralStroke,
                        text: input.style.palette.neutralText,
                        kind: 'person',
                        tooltip: name,
                    })
                );
                return id;
            };

            const ensureTask = (projectId: string, ownerName: string, taskId: string, title: string, status: string, deadline?: string, isLead?: boolean) => {
                const id = `task:${projectId}:${ownerName}:${taskId}`;
                if (taskNodes.has(id)) return id;
                taskNodes.add(id);
                const fill = taskColor(status, deadline, now, input.style);
                nodes.push(
                    bubble(id, 54, fill, isLead ? '#0f172a' : input.style.palette.neutralStroke, input.style.palette.neutralText, {
                        title,
                        subtitle: deadline || '',
                        fill,
                        stroke: isLead ? '#0f172a' : input.style.palette.neutralStroke,
                        text: input.style.palette.neutralText,
                        kind: 'task',
                        tooltip: `${title}${deadline ? ` • ${deadline}` : ''}`,
                    })
                );
                return id;
            };

            const projectWindows = new Map<string, { start?: string; end?: string; owners: string[] }>();

            activeProjects.forEach((p) => {
                const projectId = ensureProject(p);
                const owners = uniq(
                    (p.milestones || [])
                        .flatMap((t) => parseOwners(t.chargePerson))
                        .filter(Boolean)
                );
                const dates = (p.milestones || []).map((m) => m.completionDate).filter((d): d is string => !!d).sort();
                projectWindows.set(p.id, { start: p.startDate, end: dates[dates.length - 1], owners });

                owners.forEach((name) => {
                    const personId = ensurePerson(p.id, name);
                    pushEdge(`project-to-person:${projectId}:${personId}`, projectId, personId, 1.4);
                });

                (p.milestones || []).forEach((t) => {
                    const ownersOfTask = parseOwners(t.chargePerson);
                    ownersOfTask.forEach((name) => {
                        const personId = ensurePerson(p.id, name);
                        const taskNodeId = ensureTask(p.id, name, t.id, t.task, t.status, t.completionDate, true);
                        pushEdge(`person-to-task:${personId}:${taskNodeId}`, personId, taskNodeId, 2.4, { animated: t.status !== 'Done' });
                    });
                    modelTasks.push({
                        projectId: p.id,
                        projectTitle: p.title,
                        taskId: t.id,
                        title: t.task,
                        status: t.status,
                        deadline: t.completionDate,
                        owners: ownersOfTask,
                        stage: t.stage,
                    });
                });
            });

            const keys = [...projectWindows.keys()];
            for (let i = 0; i < keys.length; i++) {
                for (let j = i + 1; j < keys.length; j++) {
                    const a = projectWindows.get(keys[i])!;
                    const b = projectWindows.get(keys[j])!;
                    const time = timeAffinity(a.end, b.end);
                    const people = jaccard(a.owners, b.owners);
                    const w = 2.3 * time + 2.4 * people;
                    if (w < 1.1) continue;
                    pushEdge(`project-aff:${keys[i]}:${keys[j]}`, `project:${keys[i]}`, `project:${keys[j]}`, Math.min(4.5, w), { animated: w > 2.6 });
                }
            }
        }
    }

    if (view === 'resources') {
        activeProjects.forEach((p) => {
            const projId = `project:${p.id}`;
            nodes.push(
                bubble(projId, 120, '#ffffff', input.style.palette.projectStroke, input.style.palette.neutralText, {
                    title: p.title,
                    subtitle: computeProjectEndDate(p) ? `${p.startDate} → ${computeProjectEndDate(p)}` : p.startDate,
                    fill: '#ffffff',
                    stroke: input.style.palette.projectStroke,
                    text: input.style.palette.neutralText,
                    kind: 'project',
                    tooltip: p.title,
                })
            );

            const fill = financeColor(p, input.style);
            const stageMin = new Map<string, string | undefined>();
            (p.milestones || []).forEach((t) => {
                const stage = t.stage || '里程碑';
                const current = stageMin.get(stage);
                const candidate = t.completionDate;
                if (!candidate) return;
                if (!current || candidate < current) stageMin.set(stage, candidate);
            });

            (p.milestones || []).forEach((t) => {
                const stage = t.stage || '里程碑';
                const milestoneId = `milestone:${p.id}:${stage}`;
                if (!nodes.some((n) => n.id === milestoneId)) {
                    nodes.push(
                        bubble(milestoneId, 86, input.style.palette.neutralFill, input.style.palette.neutralStroke, input.style.palette.neutralText, {
                            title: stage,
                            subtitle: stageMin.get(stage) || '',
                            fill: input.style.palette.neutralFill,
                            stroke: input.style.palette.neutralStroke,
                            text: input.style.palette.neutralText,
                            kind: 'milestone',
                        })
                    );
                }
                pushEdge(`project-to-milestone:${projId}:${milestoneId}`, projId, milestoneId, 1.2);

                const owners = parseOwners(t.chargePerson);
                const taskNodeId = `taskres:${p.id}:${t.id}`;
                nodes.push(
                    bubble(taskNodeId, 72, fill, input.style.palette.neutralStroke, input.style.palette.neutralText, {
                        title: t.task,
                        subtitle: t.completionDate || '',
                        badge: owners.join('、'),
                        fill,
                        stroke: input.style.palette.neutralStroke,
                        text: input.style.palette.neutralText,
                        kind: 'task',
                        tooltip: `${t.task}${t.completionDate ? ` • ${t.completionDate}` : ''}${owners.length ? ` • ${owners.join('、')}` : ''}`,
                    })
                );
                pushEdge(`milestone-to-taskres:${milestoneId}:${taskNodeId}`, milestoneId, taskNodeId, 2.2);

                (t.evidence || []).forEach((a: any) => {
                    const filePath = getAttachmentOpenPath(a);
                    if (!filePath) return;
                    const docId = `doc:${filePath}`;
                    if (!nodes.some((n) => n.id === docId)) {
                        nodes.push(
                            bubble(docId, 66, '#ffffff', input.style.palette.docStroke, input.style.palette.neutralText, {
                                title: `📄 ${getFileNameFromPath(filePath)}`,
                                fill: '#ffffff',
                                stroke: input.style.palette.docStroke,
                                text: input.style.palette.neutralText,
                                kind: 'doc-open',
                                filePath,
                                tooltip: filePath,
                            })
                        );
                    }
                    pushEdge(`taskres-to-doc:${taskNodeId}:${docId}`, taskNodeId, docId, 1.5);
                });

                modelTasks.push({
                    projectId: p.id,
                    projectTitle: p.title,
                    taskId: t.id,
                    title: t.task,
                    status: t.status,
                    deadline: t.completionDate,
                    owners,
                    stage: t.stage,
                });
            });
        });
    }

    if (view === 'relations') {
        const ownerAI = new Set(input.teamMembers.filter((m) => m.isAI).map((m) => m.nickname));
        const personNode = (name: string) => `person:${name}`;
        const added = new Set<string>();
        const tasksForAffinity: Array<{ id: string; deadline?: string; owners: string[]; projectId: string; stage?: string }> = [];

        const ensurePerson = (name: string) => {
            const id = personNode(name);
            if (added.has(id)) return id;
            added.add(id);
            const isAI = ownerAI.has(name);
            nodes.push(
                bubble(id, 92, '#f8fafc', input.style.palette.neutralStroke, input.style.palette.neutralText, {
                    title: `${isAI ? '🤖' : '👤'} ${name}`,
                    fill: '#f8fafc',
                    stroke: input.style.palette.neutralStroke,
                    text: input.style.palette.neutralText,
                    kind: 'person',
                    tooltip: name,
                })
            );
            return id;
        };

        const ensureDoc = (filePath: string) => {
            const id = `doc:${filePath}`;
            if (added.has(id)) return id;
            added.add(id);
            const expanded = !!input.expandedDocs?.[id];
            const state = input.docChunks?.[id];
            const badge =
                state?.status === 'loading'
                    ? '⏳'
                    : state?.status === 'ready'
                      ? `🧩${Math.min(8, state.chunks?.length || 0)}`
                      : state?.status === 'error'
                        ? '⚠️'
                        : expanded
                          ? '▾'
                          : '▸';
            nodes.push(
                bubble(id, 78, '#ffffff', expanded ? '#0ea5e9' : input.style.palette.docStroke, input.style.palette.neutralText, {
                    title: `📄 ${getFileNameFromPath(filePath)}`,
                    subtitle: badge,
                    fill: '#ffffff',
                    stroke: expanded ? '#0ea5e9' : input.style.palette.docStroke,
                    text: input.style.palette.neutralText,
                    kind: 'doc-toggle',
                    filePath,
                    tooltip: filePath,
                })
            );
            return id;
        };

        activeProjects.forEach((p) => {
            const projectId = `project:${p.id}`;
            nodes.push(
                bubble(projectId, 128, '#ffffff', input.style.palette.projectStroke, input.style.palette.neutralText, {
                    title: `🏗️ ${p.title}`,
                    subtitle: computeProjectEndDate(p) ? `${p.startDate} → ${computeProjectEndDate(p)}` : p.startDate,
                    fill: '#ffffff',
                    stroke: input.style.palette.projectStroke,
                    text: input.style.palette.neutralText,
                    kind: 'project',
                    tooltip: p.title,
                })
            );

            (p.milestones || []).forEach((t) => {
                const owners = parseOwners(t.chargePerson);
                const taskId = `task:${p.id}:${t.id}`;
                if (!added.has(taskId)) {
                    added.add(taskId);
                    const fill = taskColor(t.status, t.completionDate, now, input.style);
                    nodes.push(
                        bubble(taskId, 60, fill, input.style.palette.neutralStroke, input.style.palette.neutralText, {
                            title: t.task,
                            subtitle: t.completionDate || '',
                            fill,
                            stroke: input.style.palette.neutralStroke,
                            text: input.style.palette.neutralText,
                            kind: 'task',
                            tooltip: `${t.task}${t.completionDate ? ` • ${t.completionDate}` : ''}`,
                        })
                    );
                }
                pushEdge(`project-to-task:${projectId}:${taskId}`, projectId, taskId, 1.3);

                owners.forEach((o) => {
                    const personId = ensurePerson(o);
                    pushEdge(`project-to-person:${projectId}:${personId}`, projectId, personId, 1.1);
                    pushEdge(`person-to-task:${personId}:${taskId}`, personId, taskId, 2.1, { animated: t.status !== 'Done' });
                });

                (t.evidence || []).forEach((a: any) => {
                    const filePath = getAttachmentOpenPath(a);
                    if (!filePath) return;
                    const docId = ensureDoc(filePath);
                    pushEdge(`task-to-doc:${taskId}:${docId}`, taskId, docId, 1.5);
                    if (input.expandedDocs?.[docId] && input.docChunks?.[docId]?.status === 'ready') {
                        (input.docChunks?.[docId]?.chunks || []).forEach((c: any, idx: number) => {
                            const chunkId = `chunk:${docId}:${c.id || c.chunk_index || idx}`;
                            if (!added.has(chunkId)) {
                                added.add(chunkId);
                                nodes.push(
                                    bubble(chunkId, 44, '#f1f5f9', input.style.palette.neutralStroke, input.style.palette.neutralText, {
                                        title: `切片 ${typeof c.chunk_index === 'number' ? c.chunk_index : idx + 1}`,
                                        fill: '#f1f5f9',
                                        stroke: input.style.palette.neutralStroke,
                                        text: input.style.palette.neutralText,
                                        kind: 'chunk',
                                    })
                                );
                            }
                            pushEdge(`doc-to-chunk:${docId}:${chunkId}`, docId, chunkId, 1.25);
                        });
                    }
                });

                modelTasks.push({
                    projectId: p.id,
                    projectTitle: p.title,
                    taskId: t.id,
                    title: t.task,
                    status: t.status,
                    deadline: t.completionDate,
                    owners,
                    stage: t.stage,
                });

                tasksForAffinity.push({ id: taskId, deadline: t.completionDate, owners, projectId: p.id, stage: t.stage });
            });
        });

        for (let i = 0; i < tasksForAffinity.length; i++) {
            for (let j = i + 1; j < tasksForAffinity.length; j++) {
                const a = tasksForAffinity[i];
                const b = tasksForAffinity[j];
                const tAff = timeAffinity(a.deadline, b.deadline);
                const oAff = jaccard(a.owners, b.owners);
                const pAff = a.projectId === b.projectId ? 0.35 : 0;
                const sAff = a.stage && b.stage && a.stage === b.stage ? 0.2 : 0;
                const w = 2.4 * tAff + 2.6 * oAff + pAff + sAff;
                if (w < 1.25) continue;
                pushEdge(`task-aff:${a.id}:${b.id}`, a.id, b.id, Math.min(4.8, w), { animated: w > 2.9 });
            }
        }
    }

    return { nodes, edges, model: { tasks: modelTasks } };
};
