const { v4: uuidv4 } = require('uuid');
const http = require('http');

const safeJsonParse = (v, fallback) => {
  try {
    if (v === null || v === undefined) return fallback;
    if (typeof v === 'object') return v;
    return JSON.parse(String(v));
  } catch (e) {
    return fallback;
  }
};

const nowTs = () => Date.now();
const SKILL_PACKS = {
  cn_social_basic: ['baidu-search', 'multi-search-engine', 'summarize'],
  cn_social_deep: ['tavily-search', 'firecrawl', 'github', 'arxiv-watcher'],
  link_parse: ['link-reader', 'summarize', 'multi-search-engine']
};

class InterconnectService {
  constructor(mainWindow, dbManager, openclawService, projectIntelService) {
    this.mainWindow = mainWindow;
    this.dbManager = dbManager;
    this.openclawService = openclawService;
    this.projectIntelService = projectIntelService;
    this.runningJobs = new Map();
  }

  _send(type, payload) {
    try {
      if (!this.mainWindow || this.mainWindow.isDestroyed()) return;
      this.mainWindow.webContents.send('interconnect:update', { type, ...(payload || {}) });
    } catch (e) {}
  }

  _templates() {
    return [
      {
        id: 'social_link_intel',
        name: '多平台链接智能解析',
        description: '输入公众号/小红书/抖音等链接，自动做结构化摘要与主题标签。',
        fields: [
          { key: 'taskName', label: '任务名称', type: 'text', placeholder: '例如：本周竞品内容跟踪' },
          { key: 'linksText', label: '链接列表', type: 'textarea', placeholder: '每行一个链接' },
          { key: 'analysisGoal', label: '分析目标', type: 'textarea', placeholder: '例如：提炼传播点、选题策略、风险点' },
          { key: 'extraSkills', label: '补充技能（逗号分隔）', type: 'text', placeholder: '例如：link-reader,summarize' }
        ]
      },
      {
        id: 'social_topic_monitor',
        name: '社媒话题监测（OpenClaw Skills）',
        description: '输入关键词，自动用 Skills 执行跨站检索并输出结构化简报。',
        fields: [
          { key: 'taskName', label: '任务名称', type: 'text', placeholder: '例如：AI Agent 行业监测' },
          { key: 'keyword', label: '关键词', type: 'text', placeholder: '例如：AI Agent' },
          { key: 'platformHints', label: '平台范围', type: 'text', placeholder: '例如：小红书、抖音、公众号' },
          { key: 'days', label: '时间窗（天）', type: 'number', placeholder: '7' },
          { key: 'extraSkills', label: '补充技能（逗号分隔）', type: 'text', placeholder: '例如：tavily-search,firecrawl' }
        ]
      },
      {
        id: 'structured_web_intel',
        name: '网页清单结构化采集',
        description: '输入网页清单与检索词，调用万物互联采集引擎执行并导出结果。',
        fields: [
          { key: 'taskName', label: '任务名称', type: 'text', placeholder: '例如：政策公告采集' },
          { key: 'urlsText', label: '网页清单', type: 'textarea', placeholder: '每行一个链接' },
          { key: 'keywordsText', label: '检索词', type: 'textarea', placeholder: '每行一个词' }
        ]
      }
    ];
  }

  listTemplates() {
    return { success: true, templates: this._templates() };
  }

  async createJob(params) {
    const templateId = String(params?.templateId || '').trim();
    const template = this._templates().find((t) => t.id === templateId);
    if (!template) return { success: false, error: 'Template not found' };
    const id = uuidv4();
    const title = String(params?.taskName || template.name).trim() || template.name;
    const row = await this.dbManager.createInterconnectJob({
      id,
      template_id: templateId,
      title,
      params: params || {},
      status: 'created',
      progress: 0,
      summary: {}
    });
    if (!row.success) return row;
    return { success: true, jobId: id };
  }

  async listJobs(limit) {
    const jobs = await this.dbManager.listInterconnectJobs(limit || 100);
    return { success: true, jobs };
  }

  async getJob(jobId) {
    const job = await this.dbManager.getInterconnectJob(jobId);
    if (!job) return { success: false, error: 'Job not found' };
    return { success: true, job };
  }

  async listSteps(jobId) {
    const steps = await this.dbManager.listInterconnectJobSteps(jobId);
    return { success: true, steps };
  }

  async deleteJob(jobId) {
    if (this.runningJobs.has(jobId)) return { success: false, error: 'Job is running' };
    return await this.dbManager.deleteInterconnectJob(jobId);
  }

  stopJob(jobId) {
    const ctrl = this.runningJobs.get(jobId);
    if (!ctrl) return { success: true };
    ctrl.stop = true;
    this._send('job_stopping', { jobId });
    return { success: true };
  }

  _parseLines(text) {
    return String(text || '')
      .split('\n')
      .map((x) => x.trim())
      .filter(Boolean);
  }

  async _bridgeRequest(path, body) {
    await this.openclawService.ensureRunning();
    await this.openclawService.startBridge();
    const token = await this.openclawService.getBridgeToken();
    const port = Number(this.openclawService.bridgePort || 0);
    const postBody = JSON.stringify(body || {});
    const url = `http://127.0.0.1:${port}${path}`;
    return await new Promise((resolve) => {
      const req = http.request(
        url,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postBody),
            Authorization: `Bearer ${token}`
          }
        },
        (res) => {
          let raw = '';
          res.on('data', (c) => {
            raw += String(c || '');
            if (raw.length > 4_000_000) res.destroy();
          });
          res.on('end', () => {
            const parsed = safeJsonParse(raw, null);
            resolve(parsed || { success: false, error: 'invalid_json', raw });
          });
        }
      );
      req.on('error', (e) => resolve({ success: false, error: e.message }));
      req.write(postBody);
      req.end();
    });
  }

  _buildSteps(job) {
    const p = safeJsonParse(job.params_json, {});
    if (job.template_id === 'social_link_intel') {
      const links = this._parseLines(p.linksText).slice(0, 60);
      const goal = String(p.analysisGoal || '').trim();
      const customSkills = String(p.extraSkills || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const skillsToInstall = Array.from(new Set([...SKILL_PACKS.link_parse, ...customSkills]));
      const message = [
        '你是内容情报分析执行器。',
        `必须优先尝试这些技能（若已安装）：${skillsToInstall.join(', ')}`,
        '每个链接都要处理，不要只处理前几个。',
        '输入链接如下：',
        ...links.map((x) => `- ${x}`),
        '',
        `分析目标：${goal || '提炼核心观点、传播手法、风险点'}`,
        '输出必须是严格 JSON 对象，结构：',
        '{"task":"", "entries":[{"platform":"","url":"","title":"","summary":"","tags":[],"risk":""}], "overall_insights":[""], "actions":[""]}'
      ].join('\n');
      return [
        { name: 'OpenClaw 能力探测', type: 'bridge_request', request: { path: '/skills/capabilities/catalog', body: {} } },
        { name: '安装技能包（链接解析）', type: 'skills_install', request: { skills: skillsToInstall } },
        { name: '多平台链接解析', type: 'agent_message', request: { message } }
      ];
    }
    if (job.template_id === 'social_topic_monitor') {
      const keyword = String(p.keyword || '').trim();
      const days = Math.max(1, Math.min(Number(p.days || 7), 30));
      const platforms = String(p.platformHints || '小红书、抖音、公众号').trim();
      const customSkills = String(p.extraSkills || '')
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean);
      const skillsToInstall = Array.from(new Set([...SKILL_PACKS.cn_social_basic, ...SKILL_PACKS.cn_social_deep, ...customSkills]));
      const message = [
        '你是社媒情报监测执行器。',
        `关键词：${keyword}`,
        `平台范围：${platforms}`,
        `时间窗：最近 ${days} 天`,
        `必须优先尝试这些技能（若已安装）：${skillsToInstall.join(', ')}`,
        '优先抓取与中文平台相关的一手内容；注意去重和时间窗过滤。',
        '输出严格 JSON：',
        '{"keyword":"","window_days":0,"records":[{"platform":"","title":"","url":"","publish_time":"","summary":"","heat_signal":""}],"brief":{"trend":"","risks":[],"opportunities":[]}}'
      ].join('\n');
      return [
        { name: 'OpenClaw 能力探测', type: 'bridge_request', request: { path: '/skills/capabilities/catalog', body: {} } },
        { name: '安装技能包（社媒监测）', type: 'skills_install', request: { skills: skillsToInstall } },
        { name: '话题监测执行', type: 'agent_message', request: { message } }
      ];
    }
    if (job.template_id === 'structured_web_intel') {
      const urls = this._parseLines(p.urlsText).slice(0, 80);
      const keywords = this._parseLines(p.keywordsText).slice(0, 30);
      return [
        { name: '创建结构化采集 Run', type: 'project_intel_create', request: { urls, keywords, taskName: String(p.taskName || '') } },
        { name: '执行采集 Run', type: 'project_intel_start', request: {} },
        { name: '导出采集结果', type: 'project_intel_export', request: {} }
      ];
    }
    return [];
  }

  async runJob(jobId) {
    const job = await this.dbManager.getInterconnectJob(jobId);
    if (!job) return { success: false, error: 'Job not found' };
    if (this.runningJobs.has(jobId)) return { success: false, error: 'Job is running' };

    const control = { stop: false, relatedRunId: null };
    this.runningJobs.set(jobId, control);

    const steps = this._buildSteps(job);
    if (!steps.length) {
      this.runningJobs.delete(jobId);
      return { success: false, error: 'Template steps are empty' };
    }

    await this.dbManager.updateInterconnectJob(jobId, {
      status: 'running',
      progress: 0,
      error: null,
      started_at: nowTs(),
      finished_at: null
    });
    this._send('job_started', { jobId });

    const outputs = [];
    try {
      for (let i = 0; i < steps.length; i += 1) {
        if (control.stop) throw new Error('Job stopped');
        const s = steps[i];
        const stepId = uuidv4();
        await this.dbManager.addInterconnectJobStep({
          id: stepId,
          job_id: jobId,
          step_index: i + 1,
          step_name: s.name,
          step_type: s.type,
          status: 'running',
          request: s.request || {}
        });
        this._send('step_running', { jobId, stepId, index: i + 1, total: steps.length, name: s.name });

        let result = null;
        if (s.type === 'bridge_request') {
          result = await this._bridgeRequest(s.request.path, s.request.body || {});
        } else if (s.type === 'skills_install') {
          result = await this.openclawService.installUtilitySkills({ skills: Array.isArray(s.request.skills) ? s.request.skills : [] });
          if (result && result.success === false) {
            const installedCount = Array.isArray(result.installed) ? result.installed.length : 0;
            if (installedCount > 0) {
              result = { ...result, success: true, warning: '部分技能安装失败，已安装可用子集' };
            }
          }
        } else if (s.type === 'agent_message') {
          result = await this.openclawService.runAgentMessage(String(s.request.message || ''));
        } else if (s.type === 'project_intel_create') {
          const r = await this.projectIntelService.createRun({
            mode: 'web_list',
            userQuery: s.request.taskName || '',
            urls: s.request.urls || [],
            keywords: s.request.keywords || [],
            plan: {}
          });
          if (r && r.success && r.runId) control.relatedRunId = r.runId;
          result = r;
        } else if (s.type === 'project_intel_start') {
          if (!control.relatedRunId) throw new Error('Missing related run');
          result = await this.projectIntelService.startRun(control.relatedRunId, { takeScreenshot: true });
        } else if (s.type === 'project_intel_export') {
          if (!control.relatedRunId) throw new Error('Missing related run');
          result = await this.projectIntelService.exportRun(control.relatedRunId);
        } else {
          throw new Error(`Unsupported step type: ${s.type}`);
        }

        outputs.push({ step: s.name, type: s.type, result });
        const stepOk = result && result.success !== false;
        if (!stepOk) {
          const err = String(result?.error || 'Step failed');
          await this.dbManager.updateInterconnectJobStep(stepId, { status: 'failed', response: result || {}, error: err });
          throw new Error(err);
        }
        await this.dbManager.updateInterconnectJobStep(stepId, { status: 'completed', response: result || {} });
        await this.dbManager.updateInterconnectJob(jobId, {
          progress: Math.round(((i + 1) / steps.length) * 100),
          related_run_id: control.relatedRunId || null
        });
        this._send('step_done', { jobId, stepId, index: i + 1, total: steps.length, name: s.name });
      }

      await this.dbManager.updateInterconnectJob(jobId, {
        status: 'completed',
        progress: 100,
        summary: { outputs, relatedRunId: control.relatedRunId || null },
        related_run_id: control.relatedRunId || null,
        finished_at: nowTs()
      });
      this._send('job_finished', { jobId, status: 'completed' });
      return { success: true };
    } catch (e) {
      const message = String(e.message || 'Job failed');
      await this.dbManager.updateInterconnectJob(jobId, {
        status: control.stop ? 'stopped' : 'failed',
        error: message,
        summary: { outputs, relatedRunId: control.relatedRunId || null },
        related_run_id: control.relatedRunId || null,
        finished_at: nowTs()
      });
      this._send('job_finished', { jobId, status: control.stop ? 'stopped' : 'failed', error: message });
      return { success: false, error: message };
    } finally {
      this.runningJobs.delete(jobId);
    }
  }

  async runJobAsync(jobId) {
    const j = await this.dbManager.getInterconnectJob(jobId);
    if (!j) return { success: false, error: 'Job not found' };
    if (this.runningJobs.has(jobId)) return { success: false, error: 'Job is running' };
    this.runJob(jobId).catch(() => {});
    return { success: true, accepted: true, jobId };
  }
}

module.exports = InterconnectService;
