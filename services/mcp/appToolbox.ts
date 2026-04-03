import { McpRecipe, McpToolContext, McpToolDefinition, McpModule } from './types';

const formatDateYYYYMMDD = (d: Date) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const safeParseDate = (value: any): Date | null => {
    if (!value) return null;
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return null;
    return d;
};

const getRecipesSetting = async (): Promise<McpRecipe[]> => {
    const api = (window as any)?.electronAPI?.db;
    if (!api?.getSetting) return [];
    const raw = await api.getSetting('mcp_recipes');
    if (!Array.isArray(raw)) return [];
    return raw.filter(Boolean);
};

const saveRecipesSetting = async (recipes: McpRecipe[]): Promise<void> => {
    const api = (window as any)?.electronAPI?.db;
    if (!api?.saveSetting) return;
    await api.saveSetting('mcp_recipes', recipes);
};

export const buildAppToolbox = (ctx: McpToolContext): McpToolDefinition[] => {
    const tools: McpToolDefinition[] = [
        {
            name: 'time_now',
            description: '获取当前日期与时间戳（以系统 currentDate 为准）',
            sideEffect: 'read',
            argsSchema: { type: 'object', properties: {}, additionalProperties: false },
            handler: async () => ({ date: formatDateYYYYMMDD(ctx.currentDate), timestamp: ctx.currentDate.getTime() })
        },
        {
            name: 'navigate',
            description: '跳转到指定模块页面',
            sideEffect: 'ui',
            argsSchema: {
                type: 'object',
                properties: {
                    module: { type: 'string', enum: ['Calendar', 'Projects', 'MasterBoard', 'Leads', 'Knowledge', 'AIVolunteers', 'AIWorkspace'] }
                },
                required: ['module'],
                additionalProperties: false
            },
            handler: async (args) => {
                ctx.navigate(args.module as McpModule);
                return { ok: true, module: args.module };
            }
        },
        {
            name: 'calendar_list_events',
            description: '按日期范围列出日历事件（支持 includePast）',
            sideEffect: 'read',
            argsSchema: {
                type: 'object',
                properties: {
                    from: { type: 'string', description: 'YYYY-MM-DD' },
                    to: { type: 'string', description: 'YYYY-MM-DD' },
                    limit: { type: 'number' },
                    includePast: { type: 'boolean' }
                },
                additionalProperties: false
            },
            handler: async (args) => {
                const from = safeParseDate(args.from) || new Date(ctx.currentDate);
                const to = safeParseDate(args.to) || new Date(new Date(ctx.currentDate).setDate(ctx.currentDate.getDate() + 90));
                const includePast = Boolean(args.includePast);
                const limitRaw = Number.isFinite(args.limit) ? Number(args.limit) : 50;
                const limit = Math.max(1, Math.min(200, limitRaw));
                const now = new Date(ctx.currentDate);
                const list = (ctx.events || [])
                    .filter(e => {
                        const d = new Date(e.date);
                        if (!includePast && d < now) return false;
                        if (d < from) return false;
                        if (d > to) return false;
                        return true;
                    })
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .slice(0, limit)
                    .map(e => ({ id: e.id, title: e.title, date: e.date, category: e.category, status: (e as any).status, owner: (e as any).ownerName }));
                return { from: formatDateYYYYMMDD(from), to: formatDateYYYYMMDD(to), events: list };
            }
        },
        {
            name: 'calendar_get_event',
            description: '按 id 获取单个日历事件',
            sideEffect: 'read',
            argsSchema: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
                additionalProperties: false
            },
            handler: async (args) => {
                const id = String(args.id || '').trim();
                const found = (ctx.events || []).find(e => e.id === id);
                return found || null;
            }
        },
        {
            name: 'calendar_open_event',
            description: '打开一个日历事件（会跳转到日历并弹出详情）',
            sideEffect: 'ui',
            argsSchema: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
                additionalProperties: false
            },
            handler: async (args) => {
                const id = String(args.id || '').trim();
                const found = (ctx.events || []).find(e => e.id === id);
                if (!found) return { ok: false, error: 'event_not_found' };
                ctx.navigate('Calendar');
                ctx.openEvent(found);
                return { ok: true };
            }
        },
        {
            name: 'projects_list',
            description: '列出项目台账（默认不含 Archived）',
            sideEffect: 'read',
            argsSchema: {
                type: 'object',
                properties: { includeArchived: { type: 'boolean' } },
                additionalProperties: false
            },
            handler: async (args) => {
                const includeArchived = Boolean(args.includeArchived);
                const list = (ctx.projects || [])
                    .filter(p => includeArchived ? true : p.status !== 'Archived')
                    .map(p => ({ id: p.id, title: p.title, status: p.status, leader: p.leader, startDate: (p as any).startDate, endDate: (p as any).endDate }));
                return list;
            }
        },
        {
            name: 'projects_get',
            description: '按 id 或标题获取项目',
            sideEffect: 'read',
            argsSchema: {
                type: 'object',
                properties: { idOrTitle: { type: 'string' } },
                required: ['idOrTitle'],
                additionalProperties: false
            },
            handler: async (args) => {
                const idOrTitle = String(args.idOrTitle || '').trim();
                const found = (ctx.projects || []).find(p => p.id === idOrTitle) || (ctx.projects || []).find(p => p.title === idOrTitle);
                return found || null;
            }
        },
        {
            name: 'projects_open',
            description: '打开项目（会跳转到项目台账并选中项目）',
            sideEffect: 'ui',
            argsSchema: {
                type: 'object',
                properties: { idOrTitle: { type: 'string' } },
                required: ['idOrTitle'],
                additionalProperties: false
            },
            handler: async (args) => {
                const idOrTitle = String(args.idOrTitle || '').trim();
                const found = (ctx.projects || []).find(p => p.id === idOrTitle) || (ctx.projects || []).find(p => p.title === idOrTitle);
                if (!found) return { ok: false, error: 'project_not_found' };
                ctx.openProject(found.id);
                return { ok: true, projectId: found.id };
            }
        },
        {
            name: 'master_list_tasks',
            description: '列出全局任务看板任务（从项目 milestones 汇总）',
            sideEffect: 'read',
            argsSchema: {
                type: 'object',
                properties: {
                    status: { type: 'string' },
                    owner: { type: 'string' },
                    projectId: { type: 'string' },
                    from: { type: 'string', description: 'YYYY-MM-DD' },
                    to: { type: 'string', description: 'YYYY-MM-DD' },
                    limit: { type: 'number' }
                },
                additionalProperties: false
            },
            handler: async (args) => {
                const from = safeParseDate(args.from);
                const to = safeParseDate(args.to);
                const limitRaw = Number.isFinite(args.limit) ? Number(args.limit) : 200;
                const limit = Math.max(1, Math.min(500, limitRaw));
                const list: any[] = [];
                (ctx.projects || []).filter(p => p.status !== 'Archived').forEach(p => {
                    (p.milestones || []).forEach((m: any) => {
                        const date = m.completionDate || null;
                        const dateObj = date ? safeParseDate(date) : null;
                        if (args.projectId && p.id !== args.projectId) return;
                        if (args.status && m.status !== args.status) return;
                        if (args.owner && m.chargePerson !== args.owner) return;
                        if (from && dateObj && dateObj < from) return;
                        if (to && dateObj && dateObj > to) return;
                        list.push({
                            id: `${p.id}-${m.id}`,
                            projectId: p.id,
                            projectTitle: p.title,
                            task: m.task,
                            status: m.status,
                            owner: m.chargePerson,
                            date: date || '未定日期'
                        });
                    });
                });
                return list.sort((a, b) => String(a.date).localeCompare(String(b.date))).slice(0, limit);
            }
        },
        {
            name: 'team_list',
            description: '列出团队成员',
            sideEffect: 'read',
            argsSchema: { type: 'object', properties: {}, additionalProperties: false },
            handler: async () => (ctx.teamMembers || []).map(m => ({ id: m.id, name: m.nickname, role: m.role, department: m.department, status: m.status }))
        },
        {
            name: 'kb_list_ingested_files',
            description: '列出已入库/已索引的知识库文件路径列表',
            sideEffect: 'read',
            argsSchema: { type: 'object', properties: {}, additionalProperties: false },
            handler: async () => {
                const api = (window as any)?.electronAPI?.db;
                if (!api?.getSetting) return [];
                const ingested = await api.getSetting('kb_ingested_files');
                return Array.isArray(ingested) ? ingested : [];
            }
        },
        {
            name: 'kb_query',
            description: '对知识库进行检索（RAG），返回 context 与 sources',
            sideEffect: 'read',
            argsSchema: {
                type: 'object',
                properties: {
                    text: { type: 'string' },
                    topK: { type: 'number' },
                    activeFiles: { type: 'array', items: { type: 'string' } },
                    weight: { type: 'number' }
                },
                required: ['text'],
                additionalProperties: false
            },
            handler: async (args) => {
                const api = (window as any)?.electronAPI?.knowledge;
                if (!api?.query) return { ok: false, error: 'kb_api_unavailable' };
                return await api.query({
                    text: String(args.text),
                    topK: Number.isFinite(args.topK) ? Number(args.topK) : 5,
                    activeFiles: Array.isArray(args.activeFiles) ? args.activeFiles : undefined,
                    weight: Number.isFinite(args.weight) ? Number(args.weight) : undefined
                });
            }
        },
        {
            name: 'kb_get_stats',
            description: '获取知识库索引统计信息',
            sideEffect: 'read',
            argsSchema: { type: 'object', properties: {}, additionalProperties: false },
            handler: async () => {
                const api = (window as any)?.electronAPI?.knowledge;
                if (!api?.getStats) return { ok: false, error: 'kb_api_unavailable' };
                return await api.getStats();
            }
        },
        {
            name: 'kb_get_file_metadata',
            description: '获取知识库文件元数据（路径、标签、状态等）',
            sideEffect: 'read',
            argsSchema: {
                type: 'object',
                properties: { filePath: { type: 'string' } },
                required: ['filePath'],
                additionalProperties: false
            },
            handler: async (args) => {
                const invoke = (window as any)?.electronAPI?.invoke;
                if (!invoke) return { ok: false, error: 'electron_invoke_unavailable' };
                return await invoke('kb-get-file-metadata', String(args.filePath));
            }
        },
        {
            name: 'kb_get_folder_meta',
            description: '获取知识库文件夹元数据（用于挂载目录/本地库目录）',
            sideEffect: 'read',
            argsSchema: {
                type: 'object',
                properties: { folderId: { type: 'string' } },
                required: ['folderId'],
                additionalProperties: false
            },
            handler: async (args) => {
                const invoke = (window as any)?.electronAPI?.invoke;
                if (!invoke) return { ok: false, error: 'electron_invoke_unavailable' };
                return await invoke('kb-get-folder-meta', String(args.folderId));
            }
        },
        {
            name: 'kb_get_file_chunks',
            description: '获取某个知识库文件的切片（支持 offset/limit/keyword）',
            sideEffect: 'read',
            argsSchema: {
                type: 'object',
                properties: {
                    filePath: { type: 'string' },
                    limit: { type: 'number' },
                    offset: { type: 'number' },
                    keyword: { type: 'string' }
                },
                required: ['filePath'],
                additionalProperties: false
            },
            handler: async (args) => {
                const invoke = (window as any)?.electronAPI?.invoke;
                if (!invoke) return { ok: false, error: 'electron_invoke_unavailable' };
                return await invoke('kb-get-file-chunks', {
                    filePath: String(args.filePath),
                    limit: Number.isFinite(args.limit) ? Number(args.limit) : 50,
                    offset: Number.isFinite(args.offset) ? Number(args.offset) : 0,
                    keyword: args.keyword ? String(args.keyword) : undefined
                });
            }
        },
        {
            name: 'kb_search_mounted_files',
            description: '在挂载根目录中搜索文件（非切片检索）',
            sideEffect: 'read',
            argsSchema: {
                type: 'object',
                properties: {
                    query: { type: 'string' },
                    roots: { type: 'array', items: { type: 'string' } },
                    limit: { type: 'number' },
                    fileTypeFilter: { type: 'string' }
                },
                required: ['query'],
                additionalProperties: false
            },
            handler: async (args) => {
                const invoke = (window as any)?.electronAPI?.invoke;
                if (!invoke) return { ok: false, error: 'electron_invoke_unavailable' };
                return await invoke('kb-search-mounted-files', {
                    query: String(args.query),
                    roots: Array.isArray(args.roots) ? args.roots : undefined,
                    limit: Number.isFinite(args.limit) ? Number(args.limit) : 50,
                    fileTypeFilter: args.fileTypeFilter ? String(args.fileTypeFilter) : undefined
                });
            }
        },
        {
            name: 'recipe_list',
            description: '列出可复用的调度方案（recipes）',
            sideEffect: 'read',
            argsSchema: { type: 'object', properties: {}, additionalProperties: false },
            handler: async () => await getRecipesSetting()
        },
        {
            name: 'recipe_save',
            description: '新增或更新一个调度方案（recipes）',
            sideEffect: 'write',
            argsSchema: {
                type: 'object',
                properties: {
                    id: { type: 'string' },
                    name: { type: 'string' },
                    description: { type: 'string' },
                    steps: { type: 'array', items: { type: 'object' } }
                },
                required: ['name', 'steps'],
                additionalProperties: false
            },
            handler: async (args) => {
                const now = Date.now();
                const recipes = await getRecipesSetting();
                const id = args.id ? String(args.id) : `recipe-${now}`;
                const next: McpRecipe = {
                    id,
                    name: String(args.name),
                    description: args.description ? String(args.description) : undefined,
                    steps: Array.isArray(args.steps) ? args.steps : [],
                    createdAt: recipes.find(r => r.id === id)?.createdAt || now,
                    updatedAt: now
                };
                const merged = recipes.filter(r => r.id !== id);
                merged.unshift(next);
                await saveRecipesSetting(merged);
                return next;
            }
        },
        {
            name: 'recipe_delete',
            description: '删除一个调度方案（recipes）',
            sideEffect: 'write',
            argsSchema: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
                additionalProperties: false
            },
            handler: async (args) => {
                const id = String(args.id || '').trim();
                const recipes = await getRecipesSetting();
                const next = recipes.filter(r => r.id !== id);
                await saveRecipesSetting(next);
                return { ok: true, deleted: id };
            }
        },
        {
            name: 'recipe_run',
            description: '执行一个调度方案（按 steps 顺序调用工具）',
            sideEffect: 'ui',
            argsSchema: {
                type: 'object',
                properties: { id: { type: 'string' } },
                required: ['id'],
                additionalProperties: false
            },
            handler: async (args) => {
                const id = String(args.id || '').trim();
                const recipes = await getRecipesSetting();
                const recipe = recipes.find(r => r.id === id);
                if (!recipe) return { ok: false, error: 'recipe_not_found' };
                const toolbox = buildAppToolbox(ctx);
                const toolByName = new Map(toolbox.map(t => [t.name, t]));
                const results: any[] = [];
                for (const step of recipe.steps || []) {
                    const toolName = step?.tool ? String(step.tool) : '';
                    if (!toolName) {
                        results.push({ ok: false, error: 'invalid_step', step });
                        continue;
                    }
                    if (toolName.startsWith('recipe_')) {
                        results.push({ ok: false, error: 'nested_recipe_disallowed', tool: toolName });
                        continue;
                    }
                    const tool = toolByName.get(toolName);
                    if (!tool) {
                        results.push({ ok: false, error: 'tool_not_found', tool: toolName });
                        continue;
                    }
                    try {
                        const out = await tool.handler(step.args || {}, ctx);
                        results.push({ ok: true, tool: toolName, result: out });
                    } catch (e: any) {
                        results.push({ ok: false, tool: toolName, error: e?.message || String(e) });
                    }
                }
                return { ok: true, recipe: { id: recipe.id, name: recipe.name }, results };
            }
        }
    ];

    return tools;
};

export const toolboxPromptText = (tools: McpToolDefinition[]) => {
    const items = tools
        .map(t => `- ${t.name}: ${t.description} | sideEffect=${t.sideEffect} | argsSchema=${JSON.stringify(t.argsSchema)}`)
        .join('\n');
    return items;
};

export const executeTool = async (tools: McpToolDefinition[], toolName: string | null, args: any, ctx: McpToolContext) => {
    if (!toolName) return { tool: null, result: null };
    const found = tools.find(t => t.name === toolName);
    if (!found) return { tool: toolName, result: { ok: false, error: 'tool_not_found' } };
    const result = await found.handler(args || {}, ctx);
    return { tool: toolName, result, sideEffect: found.sideEffect };
};
