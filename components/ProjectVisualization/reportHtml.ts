import type { Project, TeamMember } from '../../types';

export type ReportGranularity = {
    includeProjectName: boolean;
    includeTime: boolean;
    includeOwners: boolean;
    includeTaskDetails: boolean;
    includeProjectStatus: boolean;
    includeAttachments: boolean;
    includeNodeMeta: boolean;
};

export type ReportPalette = {
    bg: string;
    card: string;
    text: string;
    muted: string;
    primary: string;
    accent: string;
    border: string;
    pending: string;
    inProgress: string;
    done: string;
    urgent: string;
};

export type ReportNarrative = {
    title: string;
    intro: string;
    projectNotes: Record<string, string>;
};

type ReportTask = {
    id: string;
    stage?: string;
    title: string;
    status: string;
    deadline?: string;
    owners: string[];
    evidence: Array<{ name: string; path: string; type?: string }>;
    meta?: { importance?: 'High' | 'Medium' | 'Low'; urgent?: boolean; context?: string };
};

type ReportProject = {
    id: string;
    title: string;
    domain?: string;
    type?: string;
    status: string;
    startDate: string;
    endDate?: string;
    owners: string[];
    tasks: ReportTask[];
    meta?: { importance?: 'High' | 'Medium' | 'Low'; urgent?: boolean; context?: string };
};

export type HtmlReportData = {
    generatedAt: string;
    projects: ReportProject[];
    team: Array<{ nickname: string; role?: string; department?: string; isAI?: boolean }>;
};

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

const taskMeta = (task: { status: string; completionDate?: string; evidence?: any[]; stage?: string; chargePerson?: string }, project: Project) => {
    const now = new Date();
    const d = parseDate(task.completionDate);
    const isDone = task.status === 'Done';
    const urgent = !isDone && !!d && d.getTime() - now.getTime() >= 0 && d.getTime() - now.getTime() <= millisInDay;
    const days = d ? (d.getTime() - now.getTime()) / millisInDay : null;
    const missingEvidence = (task.evidence || []).length === 0;
    let score = 0;
    if (!isDone) score += 1;
    if (days !== null && days <= 3) score += 2;
    else if (days !== null && days <= 7) score += 1;
    if (missingEvidence) score += 1;
    if (urgent) score += 2;
    const importance: 'High' | 'Medium' | 'Low' = score >= 4 ? 'High' : score >= 2 ? 'Medium' : 'Low';
    const owners = parseOwners(task.chargePerson);
    const context = [
        project.title ? `项目：${project.title}` : '',
        project.domain ? `领域：${project.domain}` : '',
        task.stage ? `阶段：${task.stage}` : '',
        owners.length ? `负责人：${owners.join('、')}` : '',
        task.completionDate ? `节点：${task.completionDate}` : '',
    ]
        .filter(Boolean)
        .join(' • ');
    return { importance, urgent, context };
};

const projectMeta = (tasks: ReportTask[], project: Project) => {
    const urgentCount = tasks.filter((t) => t.meta?.urgent).length;
    const openCount = tasks.filter((t) => t.status !== 'Done').length;
    const importance: 'High' | 'Medium' | 'Low' = urgentCount >= 2 || openCount >= 8 ? 'High' : urgentCount >= 1 || openCount >= 4 ? 'Medium' : 'Low';
    const urgent = urgentCount > 0;
    const context = [
        project.domain ? `领域：${project.domain}` : '',
        project.type ? `类型：${project.type}` : '',
        `任务：${tasks.length}（未完成 ${openCount}）`,
        urgentCount ? `临期 ${urgentCount}` : '',
    ]
        .filter(Boolean)
        .join(' • ');
    return { importance, urgent, context };
};

const endDateOfProject = (p: Project) => {
    const dates = (p.milestones || []).map((m) => m.completionDate).filter((d): d is string => !!d).sort();
    return dates.length ? dates[dates.length - 1] : undefined;
};

const attachmentPath = (a: any) => {
    const raw = a?.markdownPath || a?.originalPath || a?.url || '';
    if (typeof raw !== 'string') return '';
    return raw.trim();
};

const attachmentName = (a: any) => {
    const p = attachmentPath(a);
    if (!p) return '';
    const parts = p.split(/[\\/]/);
    return parts[parts.length - 1] || p;
};

export const buildHtmlReportData = (projects: Project[], teamMembers: TeamMember[], selectedProjectIds: string[]) => {
    const selected = new Set(selectedProjectIds);
    const chosen = projects.filter((p) => p.status !== 'Archived' && selected.has(p.id));
    const reportProjects: ReportProject[] = chosen.map((p) => {
        const tasks: ReportTask[] = (p.milestones || []).map((m) => {
            const owners = parseOwners(m.chargePerson);
            const evidence = (m.evidence || [])
                .map((a: any) => {
                    const path = attachmentPath(a);
                    const name = a?.name || attachmentName(a) || '附件';
                    if (!path) return null;
                    return { name, path, type: a?.type };
                })
                .filter(Boolean) as Array<{ name: string; path: string; type?: string }>;
            const meta = taskMeta(m as any, p);
            return {
                id: m.id,
                stage: m.stage,
                title: m.task,
                status: m.status,
                deadline: m.completionDate,
                owners,
                evidence,
                meta,
            };
        });
        const owners = uniq(tasks.flatMap((t) => t.owners));
        const meta = projectMeta(tasks, p);
        return {
            id: p.id,
            title: p.title,
            domain: p.domain,
            type: p.type,
            status: p.status,
            startDate: p.startDate,
            endDate: endDateOfProject(p),
            owners,
            tasks,
            meta,
        };
    });

    return {
        generatedAt: new Date().toISOString(),
        projects: reportProjects,
        team: teamMembers.map((m) => ({ nickname: m.nickname, role: m.role, department: m.department, isAI: m.isAI })),
    } satisfies HtmlReportData;
};

const escapeHtml = (s: string) =>
    s
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');

const sumBy = <T,>(items: T[], fn: (t: T) => number) => items.reduce((a, b) => a + fn(b), 0);

const statusLabel = (s: string) => (s === 'In Progress' ? '进行中' : s === 'Done' ? '已完成' : s === 'Pending' ? '未完成' : s);

const statusColorVar = (s: string) => (s === 'Done' ? '--done' : s === 'In Progress' ? '--inProgress' : '--pending');

const importanceLabel = (s?: string) => (s === 'High' ? '高' : s === 'Medium' ? '中' : '低');

const makeBars = (rows: Array<{ label: string; value: number; color: string }>) => {
    const max = Math.max(1, ...rows.map((r) => r.value));
    return rows
        .map((r) => {
            const pct = Math.max(6, Math.round((r.value / max) * 100));
            return `<div class="barRow">
  <div class="barLabel">${escapeHtml(r.label)}</div>
  <div class="barTrack"><div class="barFill" style="width:${pct}%; background:${r.color}"></div></div>
  <div class="barValue">${r.value}</div>
</div>`;
        })
        .join('\n');
};

export const renderReportHtml = (data: HtmlReportData, granularity: ReportGranularity, palette: ReportPalette, narrative: ReportNarrative) => {
    const projects = data.projects;
    const allTasks = projects.flatMap((p) => p.tasks.map((t) => ({ ...t, projectId: p.id, projectTitle: p.title })));
    const pending = allTasks.filter((t) => t.status !== 'Done').length;
    const urgent = allTasks.filter((t) => t.meta?.urgent).length;
    const done = allTasks.filter((t) => t.status === 'Done').length;

    const owners = uniq(allTasks.flatMap((t) => t.owners || [])).sort((a, b) => a.localeCompare(b));
    const ownerWork = owners
        .map((o) => ({
            owner: o,
            open: allTasks.filter((t) => t.status !== 'Done' && (t.owners || []).includes(o)).length,
            urgent: allTasks.filter((t) => t.status !== 'Done' && t.meta?.urgent && (t.owners || []).includes(o)).length,
        }))
        .filter((x) => x.open > 0 || x.urgent > 0)
        .sort((a, b) => b.urgent - a.urgent || b.open - a.open)
        .slice(0, 10);

    const statusBars = makeBars([
        { label: '未完成', value: pending, color: 'var(--pending)' },
        { label: '临期', value: urgent, color: 'var(--urgent)' },
        { label: '已完成', value: done, color: 'var(--done)' },
    ]);

    const ownerBars = makeBars(
        ownerWork.map((x) => ({
            label: x.owner,
            value: x.open + x.urgent,
            color: x.urgent > 0 ? 'var(--urgent)' : 'var(--primary)',
        }))
    );

    const overviewSlides = `
<section class="slide" data-slide-index="0">
  <div class="slideHeader">
    <div>
      <div class="kicker">NGO Planner · 项目同步汇报</div>
      <div class="h1">${escapeHtml(narrative.title || '项目情况同步')}</div>
      <div class="subtitle">${escapeHtml(narrative.intro || '')}</div>
    </div>
    <div class="badgeCol">
      <div class="pill">生成时间：${escapeHtml(new Date(data.generatedAt).toLocaleString())}</div>
      <div class="pill">项目：${projects.length}</div>
      <div class="pill">任务：${allTasks.length}</div>
      <div class="pill">未完成：${pending}</div>
      <div class="pill">临期：${urgent}</div>
    </div>
  </div>

  <div class="grid">
    <div class="card" data-expand="slide">
      <div class="cardTitle">进度概览</div>
      <div class="bars">${statusBars}</div>
    </div>
    <div class="card" data-expand="slide">
      <div class="cardTitle">负责人负荷（Top 10）</div>
      <div class="bars">${ownerBars || '<div class="muted">暂无负责人数据</div>'}</div>
    </div>
    <div class="card" data-expand="slide">
      <div class="cardTitle">项目列表</div>
      <div class="list">
        ${projects
            .slice(0, 10)
            .map((p) => {
                const open = p.tasks.filter((t) => t.status !== 'Done').length;
                const u = p.tasks.filter((t) => t.meta?.urgent).length;
                const imp = p.meta?.importance || 'Low';
                return `<div class="listRow">
  <div class="listMain">
    <div class="listTitle">${escapeHtml(p.title)}</div>
    <div class="listMeta">${escapeHtml([granularity.includeTime ? `${p.startDate}${p.endDate ? ` → ${p.endDate}` : ''}` : '', granularity.includeOwners ? (p.owners.length ? `负责人：${p.owners.slice(0, 4).join('、')}${p.owners.length > 4 ? '…' : ''}` : '负责人：未设置') : '']
                    .filter(Boolean)
                    .join(' · '))}</div>
  </div>
  <div class="listBadges">
    <span class="chip">${escapeHtml(granularity.includeProjectStatus ? statusLabel(p.status) : '项目')}</span>
    <span class="chip">${open} 未完成</span>
    ${u ? `<span class="chip chipUrgent">${u} 临期</span>` : ''}
    ${granularity.includeNodeMeta ? `<span class="chip chipImp">${importanceLabel(imp)}</span>` : ''}
  </div>
</div>`;
            })
            .join('')}
      </div>
    </div>
  </div>
</section>`;

    const projectSlides = projects
        .map((p, i) => {
            const slideIndex = i + 1;
            const open = p.tasks.filter((t) => t.status !== 'Done').length;
            const doneCount = p.tasks.filter((t) => t.status === 'Done').length;
            const urgentCount = p.tasks.filter((t) => t.meta?.urgent).length;
            const note = narrative.projectNotes?.[p.id] || '';
            const tasksByStatus = {
                Pending: p.tasks.filter((t) => t.status === 'Pending').length,
                InProgress: p.tasks.filter((t) => t.status === 'In Progress').length,
                Done: p.tasks.filter((t) => t.status === 'Done').length,
            };
            const bars = makeBars([
                { label: '未完成', value: tasksByStatus.Pending, color: 'var(--pending)' },
                { label: '进行中', value: tasksByStatus.InProgress, color: 'var(--inProgress)' },
                { label: '已完成', value: tasksByStatus.Done, color: 'var(--done)' },
            ]);

            const attachments = uniq(p.tasks.flatMap((t) => (t.evidence || []).map((e) => `${e.name}|||${e.path}|||${e.type || ''}`)))
                .map((raw) => {
                    const [name, path] = raw.split('|||');
                    return { name, path };
                })
                .filter((x) => x.path);

            const tasksTable = granularity.includeTaskDetails
                ? `<div class="tableWrap" data-expand="slide">
  <div class="cardTitle">任务明细</div>
  <table class="table">
    <thead><tr>
      <th>任务</th>
      ${granularity.includeOwners ? '<th>负责人</th>' : ''}
      ${granularity.includeTime ? '<th>节点</th>' : ''}
      <th>状态</th>
      ${granularity.includeNodeMeta ? '<th>元数据</th>' : ''}
    </tr></thead>
    <tbody>
      ${p.tasks
          .slice(0, 18)
          .map((t) => {
              const imp = t.meta?.importance;
              const urgentTag = t.meta?.urgent ? '临期' : '';
              const meta = granularity.includeNodeMeta ? [urgentTag, imp ? `重要性:${importanceLabel(imp)}` : '', t.meta?.context ? `上下文:${t.meta.context}` : ''].filter(Boolean).join('；') : '';
              return `<tr>
  <td>
    <div class="tTitle">${escapeHtml(t.title)}</div>
    ${t.stage ? `<div class="tSub muted">${escapeHtml(t.stage)}</div>` : ''}
  </td>
  ${granularity.includeOwners ? `<td class="muted">${escapeHtml((t.owners || []).length ? (t.owners || []).join('、') : '未设置')}</td>` : ''}
  ${granularity.includeTime ? `<td class="muted">${escapeHtml(t.deadline || '-')}</td>` : ''}
  <td><span class="chip" style="background:color-mix(in srgb, var(${statusColorVar(t.status)}) 18%, transparent); border-color:color-mix(in srgb, var(${statusColorVar(t.status)}) 55%, var(--border)); color:var(--text)">${escapeHtml(statusLabel(t.status))}${t.meta?.urgent ? ' · 临期' : ''}</span></td>
  ${granularity.includeNodeMeta ? `<td class="muted">${escapeHtml(meta || '-')}</td>` : ''}
</tr>`;
          })
          .join('')}
    </tbody>
  </table>
  ${p.tasks.length > 18 ? `<div class="muted small">仅展示前 18 条任务，导出可在配置中调整或后续迭代支持分页。</div>` : ''}
</div>`
                : '';

            const attachmentsCard = granularity.includeAttachments
                ? `<div class="card" data-expand="slide">
  <div class="cardTitle">相关附件</div>
  ${
      attachments.length
          ? `<div class="attachments">
      ${attachments
          .slice(0, 14)
          .map((a) => `<button class="attachment" data-copy="${escapeHtml(a.path)}" title="${escapeHtml(a.path)}">📎 ${escapeHtml(a.name)}</button>`)
          .join('')}
      ${attachments.length > 14 ? `<div class="muted small">仅展示前 14 个附件</div>` : ''}
    </div>`
          : `<div class="muted">暂无附件</div>`
  }
</div>`
                : '';

            const imp = p.meta?.importance;
            return `<section class="slide" data-slide-index="${slideIndex}">
  <div class="slideHeader">
    <div>
      <div class="kicker">项目 ${slideIndex}/${projects.length}</div>
      <div class="h1">${escapeHtml(granularity.includeProjectName ? p.title : '项目')}</div>
      <div class="subtitle">${escapeHtml(note || '')}</div>
    </div>
    <div class="badgeCol">
      ${granularity.includeProjectStatus ? `<div class="pill">${escapeHtml(statusLabel(p.status))}</div>` : ''}
      ${granularity.includeTime ? `<div class="pill">${escapeHtml(p.startDate)}${p.endDate ? ` → ${escapeHtml(p.endDate)}` : ''}</div>` : ''}
      <div class="pill">未完成：${open}</div>
      <div class="pill">已完成：${doneCount}</div>
      ${urgentCount ? `<div class="pill pillUrgent">临期：${urgentCount}</div>` : ''}
      ${granularity.includeNodeMeta ? `<div class="pill">${imp ? `重要性：${escapeHtml(importanceLabel(imp))}` : '重要性：-'}</div>` : ''}
    </div>
  </div>

  <div class="grid grid2">
    <div class="card" data-expand="slide">
      <div class="cardTitle">进度分布</div>
      <div class="bars">${bars}</div>
      <div class="muted small">点击模块可放大为 PPT 页面。方向键可翻页。</div>
    </div>
    ${attachmentsCard}
  </div>
  ${tasksTable}
</section>`;
        })
        .join('\n');

    const slides = overviewSlides + '\n' + projectSlides;

    const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(narrative.title || '项目同步汇报')}</title>
  <style>
    :root{
      --bg:${palette.bg};
      --card:${palette.card};
      --text:${palette.text};
      --muted:${palette.muted};
      --primary:${palette.primary};
      --accent:${palette.accent};
      --border:${palette.border};
      --pending:${palette.pending};
      --inProgress:${palette.inProgress};
      --done:${palette.done};
      --urgent:${palette.urgent};
      --pptW:960px;
      --pptH:540px;
      --radius:22px;
    }
    *{box-sizing:border-box}
    body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang SC","Noto Sans CJK SC","Microsoft YaHei",system-ui,Segoe UI,Roboto,Arial,sans-serif;background:var(--bg);color:var(--text)}
    .app{min-height:100vh;display:flex;flex-direction:column}
    .topbar{position:sticky;top:0;z-index:10;background:color-mix(in srgb, var(--bg) 92%, #fff);backdrop-filter:blur(10px);border-bottom:1px solid color-mix(in srgb, var(--border) 70%, transparent)}
    .topbarInner{max-width:1200px;margin:0 auto;padding:14px 18px;display:flex;gap:12px;align-items:center;justify-content:space-between}
    .brand{display:flex;gap:10px;align-items:center}
    .logo{width:36px;height:36px;border-radius:12px;background:linear-gradient(135deg,var(--primary),color-mix(in srgb,var(--accent) 65%, var(--primary)));display:flex;align-items:center;justify-content:center;color:#fff;font-weight:900}
    .brandText .t{font-weight:900;font-size:14px}
    .brandText .s{font-size:11px;color:var(--muted);margin-top:2px}
    .btnRow{display:flex;gap:8px;align-items:center}
    .btn{border:1px solid var(--border);background:color-mix(in srgb, var(--card) 92%, transparent);color:var(--text);padding:8px 12px;border-radius:999px;font-weight:800;font-size:12px;cursor:pointer}
    .btn.primary{background:color-mix(in srgb, var(--primary) 14%, var(--card));border-color:color-mix(in srgb, var(--primary) 45%, var(--border))}
    .btn:active{transform:translateY(1px)}
    .hint{font-size:11px;color:var(--muted)}
    .deck{flex:1;display:flex;align-items:center;justify-content:center;padding:18px}
    .slide{width:var(--pptW);height:var(--pptH);background:var(--card);border:1px solid var(--border);border-radius:var(--radius);box-shadow:0 18px 50px rgba(15,23,42,.12);padding:22px;display:none;overflow:hidden}
    .slide.active{display:block}
    .slideHeader{display:flex;gap:16px;align-items:flex-start;justify-content:space-between;margin-bottom:14px}
    .kicker{font-size:11px;font-weight:900;color:color-mix(in srgb, var(--primary) 85%, var(--muted));letter-spacing:.08em;text-transform:uppercase}
    .h1{font-size:24px;font-weight:950;line-height:1.1;margin-top:6px}
    .subtitle{margin-top:8px;font-size:12px;color:var(--muted);line-height:1.45;max-width:560px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
    .badgeCol{display:flex;flex-direction:column;gap:8px;align-items:flex-end}
    .pill{font-size:11px;font-weight:900;color:var(--text);border:1px solid var(--border);background:color-mix(in srgb,var(--bg) 55%, var(--card));padding:6px 10px;border-radius:999px;white-space:nowrap}
    .pillUrgent{border-color:color-mix(in srgb, var(--urgent) 55%, var(--border));background:color-mix(in srgb, var(--urgent) 14%, var(--card))}
    .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px}
    .grid2{grid-template-columns:1.2fr .8fr}
    .card{border:1px solid var(--border);background:color-mix(in srgb, var(--card) 92%, transparent);border-radius:18px;padding:14px;cursor:zoom-in}
    .cardTitle{font-weight:950;font-size:12px;margin-bottom:10px}
    .muted{color:var(--muted)}
    .small{font-size:10px}
    .bars{display:flex;flex-direction:column;gap:8px}
    .barRow{display:grid;grid-template-columns:110px 1fr 44px;gap:10px;align-items:center}
    .barLabel{font-size:11px;font-weight:900;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .barTrack{height:10px;border-radius:999px;background:color-mix(in srgb,var(--bg) 65%, var(--card));border:1px solid color-mix(in srgb,var(--border) 60%, transparent);overflow:hidden}
    .barFill{height:100%;border-radius:999px}
    .barValue{font-size:11px;font-weight:950;text-align:right}
    .list{display:flex;flex-direction:column;gap:8px}
    .listRow{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;border:1px solid color-mix(in srgb,var(--border) 65%, transparent);background:color-mix(in srgb,var(--bg) 55%, var(--card));padding:10px;border-radius:14px}
    .listTitle{font-size:12px;font-weight:950;max-width:240px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .listMeta{font-size:10px;color:var(--muted);margin-top:4px;max-width:280px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .listBadges{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
    .chip{font-size:10px;font-weight:950;border-radius:999px;border:1px solid var(--border);padding:4px 8px;background:color-mix(in srgb,var(--card) 80%, transparent)}
    .chipUrgent{border-color:color-mix(in srgb, var(--urgent) 55%, var(--border));background:color-mix(in srgb, var(--urgent) 15%, var(--card))}
    .chipImp{border-color:color-mix(in srgb, var(--primary) 55%, var(--border));background:color-mix(in srgb, var(--primary) 12%, var(--card))}
    .tableWrap{margin-top:12px;border:1px solid var(--border);background:color-mix(in srgb, var(--card) 92%, transparent);border-radius:18px;padding:14px;cursor:zoom-in}
    .table{width:100%;border-collapse:collapse;font-size:11px}
    th,td{padding:8px 8px;border-bottom:1px solid color-mix(in srgb,var(--border) 60%, transparent);vertical-align:top}
    th{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);text-align:left}
    .tTitle{font-weight:950}
    .tSub{margin-top:3px;font-size:10px}
    .attachments{display:flex;flex-direction:column;gap:8px}
    .attachment{border:1px dashed color-mix(in srgb,var(--border) 70%, transparent);background:color-mix(in srgb,var(--bg) 55%, var(--card));border-radius:14px;padding:10px;font-size:11px;font-weight:900;text-align:left;color:var(--text);cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:rgba(15,23,42,.92);color:#fff;font-size:12px;font-weight:800;padding:10px 14px;border-radius:999px;opacity:0;pointer-events:none;transition:opacity .15s ease}
    .toast.show{opacity:1}
    .overlay{position:fixed;inset:0;background:rgba(2,6,23,.62);backdrop-filter:blur(10px);display:none;align-items:center;justify-content:center;z-index:50;padding:18px}
    .overlay.show{display:flex}
    .pptFrame{width:var(--pptW);height:var(--pptH);background:var(--card);border:1px solid color-mix(in srgb,var(--border) 70%, transparent);border-radius:var(--radius);box-shadow:0 24px 80px rgba(0,0,0,.35);overflow:hidden}
    .pptTop{display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-bottom:1px solid color-mix(in srgb,var(--border) 65%, transparent);background:color-mix(in srgb,var(--bg) 60%, var(--card))}
    .pptTop .t{font-size:11px;font-weight:950}
    .pptBtns{display:flex;gap:8px}
    .pptBtn{border:1px solid var(--border);background:color-mix(in srgb,var(--card) 90%, transparent);color:var(--text);padding:6px 10px;border-radius:999px;font-size:11px;font-weight:950;cursor:pointer}
    .pptBody{height:calc(var(--pptH) - 44px);overflow:hidden}
    .pptBodyInner{transform-origin:top left}
    @media (max-width: 980px){
      :root{--pptW:92vw;--pptH:52vw}
      .grid{grid-template-columns:1fr}
      .grid2{grid-template-columns:1fr}
      .barRow{grid-template-columns:90px 1fr 38px}
      .badgeCol{display:none}
    }
  </style>
</head>
<body>
  <div class="app">
    <div class="topbar">
      <div class="topbarInner">
        <div class="brand">
          <div class="logo">⦿</div>
          <div class="brandText">
            <div class="t">${escapeHtml(narrative.title || '项目同步汇报')}</div>
            <div class="s">离线可打开 · 可交互 · PPT 页面放大</div>
          </div>
        </div>
        <div class="btnRow">
          <button class="btn" id="btnPrev">上一页</button>
          <button class="btn primary" id="btnNext">下一页</button>
          <button class="btn" id="btnPpt">放大当前页</button>
        </div>
      </div>
    </div>

    <div class="deck" id="deck">
      ${slides}
    </div>
  </div>

  <div class="overlay" id="overlay">
    <div class="pptFrame" role="dialog" aria-modal="true">
      <div class="pptTop">
        <div class="t" id="pptTitle">PPT 页面</div>
        <div class="pptBtns">
          <button class="pptBtn" id="pptPrev">上一页</button>
          <button class="pptBtn" id="pptNext">下一页</button>
          <button class="pptBtn" id="pptClose">退出</button>
        </div>
      </div>
      <div class="pptBody">
        <div class="pptBodyInner" id="pptInner"></div>
      </div>
    </div>
  </div>

  <div class="toast" id="toast"></div>

  <script>
    (function(){
      const slides = Array.from(document.querySelectorAll('.slide'));
      const btnPrev = document.getElementById('btnPrev');
      const btnNext = document.getElementById('btnNext');
      const btnPpt = document.getElementById('btnPpt');
      const overlay = document.getElementById('overlay');
      const pptInner = document.getElementById('pptInner');
      const pptTitle = document.getElementById('pptTitle');
      const pptPrev = document.getElementById('pptPrev');
      const pptNext = document.getElementById('pptNext');
      const pptClose = document.getElementById('pptClose');
      const toast = document.getElementById('toast');

      let index = 0;
      function show(i){
        index = Math.max(0, Math.min(slides.length - 1, i));
        slides.forEach((s, k) => s.classList.toggle('active', k === index));
      }
      function next(){ show(index + 1); }
      function prev(){ show(index - 1); }

      function showToast(text){
        toast.textContent = text;
        toast.classList.add('show');
        clearTimeout(showToast._t);
        showToast._t = setTimeout(() => toast.classList.remove('show'), 1200);
      }

      function openPpt(){
        const active = slides[index];
        if(!active) return;
        pptInner.innerHTML = '';
        const clone = active.cloneNode(true);
        clone.classList.add('active');
        clone.style.display = 'block';
        clone.style.width = 'var(--pptW)';
        clone.style.height = 'var(--pptH)';
        clone.style.boxShadow = 'none';
        clone.style.border = 'none';
        clone.style.borderRadius = '0';
        clone.style.padding = '22px';
        pptInner.appendChild(clone);
        const title = clone.querySelector('.h1') ? clone.querySelector('.h1').textContent : '';
        pptTitle.textContent = title ? ('PPT 页面 · ' + title) : 'PPT 页面';
        overlay.classList.add('show');
      }
      function closePpt(){
        overlay.classList.remove('show');
        pptInner.innerHTML = '';
      }

      btnPrev && btnPrev.addEventListener('click', prev);
      btnNext && btnNext.addEventListener('click', next);
      btnPpt && btnPpt.addEventListener('click', openPpt);
      pptPrev && pptPrev.addEventListener('click', () => { prev(); openPpt(); });
      pptNext && pptNext.addEventListener('click', () => { next(); openPpt(); });
      pptClose && pptClose.addEventListener('click', closePpt);
      overlay && overlay.addEventListener('click', (e) => { if(e.target === overlay) closePpt(); });

      document.addEventListener('keydown', (e) => {
        if (overlay.classList.contains('show')) {
          if (e.key === 'Escape') { closePpt(); }
          if (e.key === 'ArrowRight') { next(); openPpt(); }
          if (e.key === 'ArrowLeft') { prev(); openPpt(); }
          return;
        }
        if (e.key === 'ArrowRight' || e.key === 'PageDown') next();
        if (e.key === 'ArrowLeft' || e.key === 'PageUp') prev();
        if (e.key === 'Enter') openPpt();
      });

      document.addEventListener('click', (e) => {
        const t = e.target;
        const btn = t && t.closest ? t.closest('[data-copy]') : null;
        if(btn){
          const path = btn.getAttribute('data-copy') || '';
          if (!path) return;
          navigator.clipboard && navigator.clipboard.writeText(path).then(() => showToast('已复制路径')).catch(() => showToast('复制失败'));
          return;
        }
        const expand = t && t.closest ? t.closest('[data-expand="slide"]') : null;
        if(expand){
          openPpt();
        }
      });

      show(0);
    })();
  </script>
</body>
</html>`;

    return html;
};

