
import { GoogleGenAI, Type } from "@google/genai";
import { createWorker } from 'tesseract.js';
import { Solar, Lunar, HolidayUtil } from 'lunar-javascript';
import { WELFARE_DAYS } from '../utils/welfareDays';
import { llmFactory } from './llm';
import { 
  CalendarEvent, 
  NgoDomain, 
  TeamMember, 
  GeneratedPlan, 
  PlanCustomization, 
  PosterConfig, 
  SearchConfig, 
  WebLeadResult, 
  MarketReport, 
  ProjectLeadSource, 
  Opportunity, 
  ProjectApplication, 
  PPTSlide,
  StructuredScheduleData,
  Project
} from '../types';

/**
 * 核心修复：环境桥接器
 */
const getAI = async () => {
    // 1. Try Secure Storage (Electron) - Prioritize Google specific key
    let key = await (window as any).electronAPI?.secure?.get('user_api_key_google');
    
    if (!key) {
        // Fallback to generic key (legacy)
        key = await (window as any).electronAPI?.secure?.get('user_api_key');
    }
    
    // 2. Try LocalStorage (Web fallback)
    if (!key) key = localStorage.getItem('user_api_key_google');
    if (!key) key = localStorage.getItem('user_api_key');

    // 3. Try Environment Variable (Vite)
    // @ts-ignore
    if (!key) key = import.meta.env?.VITE_GEMINI_API_KEY || import.meta.env?.GEMINI_API_KEY;

    if (!key || key.includes('PLACEHOLDER')) {
        console.warn("No valid API Key found. AI features will fail.");
        // We return an instance with empty key, which will likely throw on generation call
        // But better to let the UI handle the error from the callAI wrapper.
    }

    return new GoogleGenAI({ apiKey: key || '' });
};

const cleanJsonResponse = (text: string): string => {
    if (!text) return "";
    return text.replace(/```json/gi, "").replace(/```/g, "").trim();
};

const extractArrayFromAiJson = (text: string): any[] => {
    try {
        const cleaned = cleanJsonResponse(text);
        if (!cleaned) return [];
        const parsed = JSON.parse(cleaned);
        if (Array.isArray(parsed)) return parsed;
        if (typeof parsed === 'object' && parsed !== null) {
            const firstArray = Object.values(parsed).find(val => Array.isArray(val));
            if (firstArray) return firstArray as any[];
        }
        return [];
    } catch (e) {
        console.warn("[extractArrayFromAiJson] Parse failed:", e, "Text:", text);
        return [];
    }
};

export const callAI = async (params: {
    systemInstruction?: string;
    prompt: string;
    model?: string;
    jsonMode?: boolean;
    responseSchema?: any;
    temperature?: number;
}) => {
    const provider = llmFactory.getProvider();
    if (!await provider.isReady()) {
        throw new Error("AI 服务未连接：请在设置中配置 API Key。");
    }

    // Try to use the unified provider
    try {
        const response = await provider.generateContent({
            prompt: params.prompt,
            systemInstruction: params.systemInstruction,
            model: params.model,
            jsonMode: params.jsonMode,
            responseSchema: params.responseSchema,
            temperature: params.temperature
        });
        const text = (response && typeof response.text === 'string') ? response.text : '';
        if (!text.trim()) {
            throw new Error("AI 未返回内容");
        }
        return { text };
    } catch (e: any) {
        console.error("AI Generation Error:", e);
        throw new Error(`AI 生成失败: ${e.message}`);
    }
};

/**
 * 跨年自动同步引擎 (本地精确计算版)
 * 使用 lunar-javascript 替代 AI 猜测，确保节气、农历和节假日的准确性
 */
export const fetchFutureYearEvents = async (year: number): Promise<CalendarEvent[]> => {
    // 1. 初始化结果数组
    const events: CalendarEvent[] = [];
    const processedKeys = new Set<string>(); // 用于去重

    // 辅助函数：添加事件
    const addEvent = (dateStr: string, title: string, category: 'SolarTerm' | 'Traditional' | 'InternationalDay' | 'PublicHoliday', description: string, isPublicHoliday: boolean = false) => {
        // 简单去重：同一天同一标题不重复
        const key = `${dateStr}-${title}`;
        if (processedKeys.has(key)) return;
        
        // 如果是法定节假日，可能需要覆盖之前的普通节日标记
        const existingIdx = events.findIndex(e => e.date === dateStr && e.title === title);
        if (existingIdx >= 0) {
            if (category === 'PublicHoliday') {
                events[existingIdx].category = category;
                events[existingIdx].isPublicHoliday = isPublicHoliday;
                events[existingIdx].description = description;
            }
            return;
        }

        events.push({
            id: `auto-${year}-${dateStr}-${events.length}-${Date.now()}`,
            title,
            date: dateStr,
            category,
            isPublicHoliday,
            description,
            relevantDomains: ['其他']
        });
        processedKeys.add(key);
    };

    // 2. 遍历当年每一天
    // 考虑到性能，JS 循环 366 次非常快，毫秒级
    const startDate = new Date(year, 0, 1);
    // 处理闰年，直接用日期对象递增最稳妥
    const current = new Date(startDate);
    
    while (current.getFullYear() === year) {
        const y = current.getFullYear();
        const m = current.getMonth() + 1;
        const d = current.getDate();
        const dateStr = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        
        const solar = Solar.fromYmd(y, m, d);
        const lunar = Lunar.fromSolar(solar);

        // A. 节气 (Solar Term)
        const jieQi = solar.getJieQi();
        if (jieQi) {
            addEvent(dateStr, jieQi, 'SolarTerm', `二十四节气之${jieQi}`);
        }

        // B. 农历节日 (Traditional)
        const lunarFestivals = lunar.getFestivals();
        lunarFestivals.forEach(f => {
            addEvent(dateStr, f, 'Traditional', `农历:${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`);
        });

        // C. 公历节日 (Traditional/Public)
        const solarFestivals = solar.getFestivals();
        solarFestivals.forEach(f => {
            // 标记一些常见的公历假日
            if (['元旦', '劳动节', '国庆节'].includes(f)) {
                 addEvent(dateStr, f, 'PublicHoliday', '公历节日', true);
            } else {
                 addEvent(dateStr, f, 'Traditional', '公历节日');
            }
        });

        // D. 法定节假日 (Public Holiday) - 基于库内置数据
        try {
            const holiday = HolidayUtil.getHoliday(y, m, d);
            if (holiday) {
                const name = holiday.getName();
                const isWork = holiday.isWork();
                
                if (!isWork) {
                    addEvent(dateStr, name, 'PublicHoliday', '法定节假日', true);
                } else {
                    addEvent(dateStr, `${name}调休`, 'PublicHoliday', '法定调休工作日', false);
                }
            }
        } catch (e) {
            // 忽略 HolidayUtil 可能的异常
        }

        // 下一天
        current.setDate(current.getDate() + 1);
    }

    // 3. 注入固定公益日 (InternationalDay)
    WELFARE_DAYS.forEach(wd => {
        const fullDate = `${year}-${wd.date}`;
        // 简单校验日期是否合法（比如平年2月29日）
        if (wd.date === '02-29' && !((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0)) {
            return;
        }
        addEvent(fullDate, wd.title, 'InternationalDay', wd.description || '公益纪念日');
    });

    return events.sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * Evolve a new project based on an existing one and user instructions.
 * This is the core of "Project Digital Twin" - allowing users to "Remix" past work.
 */
export const evolveProject = async (oldProject: any, instruction: string): Promise<any> => {
    const systemInstruction = `你是一个资深的公益项目架构师。你的任务是基于一个“旧项目”的数据，根据用户的“新指令”，进化出一个“新项目”的方案。
    
    核心原则。
    1. **继承精华**：保留旧项目中未被指令修改且合理的逻辑（如SOP、人员配置结构、物资清单类别）。
    2. **精准进化**：严格按照用户的指令（如修改时间、预算减半、改变主题）对项目进行改造。
    3. **逻辑自洽**：如果预算减少，应自动削减非必要开支；如果时间改变，应自动平移甘特图。
    
    输出要求：
    直接返回一个标准的 JSON 对象（不要Markdown标记），符合以下 TypeScript 接口：
    interface ProjectDraft {
      title: string; // 新项目标题
      domain: string; // 领域
      startDate: string; // YYYY-MM-DD
      endDate: string; // YYYY-MM-DD
      budget: number; // 新预算总额
      description: string; // 项目简介
      milestones: Array<{ date: string; title: string; status: 'Pending' }>;
      team: Array<{ name: string; role: string }>;
    }`;

    const prompt = `
    【旧项目数据】:
    标题: ${oldProject.title}
    领域: ${oldProject.domain}
    预算: ${oldProject.budget || '未设定'}
    描述: ${oldProject.description}
    时间: ${oldProject.startDate} 至 ${oldProject.endDate || '未设定'}
    里程碑: ${JSON.stringify(oldProject.milestones || [])}
    团队: ${JSON.stringify(oldProject.team || [])}

    【用户进化指令】:
    ${instruction}

    请生成新项目的 JSON 数据：`;

    try {
      const response = await callAI({
          model: 'gemini-3-flash-preview',
          systemInstruction,
          prompt,
          jsonMode: true
      });
      
      const cleaned = cleanJsonResponse(response.text || '{}');
      const data = JSON.parse(cleaned);
      
      return {
        ...data,
        id: Date.now(),
        status: 'Planning',
        source: 'Evolution',
        progress: 0,
        created_at: Date.now(),
        tags: [...(oldProject.tags || []), 'Evolved'],
        tasks: [],
        attachments: []
      };
    } catch (error) {
      console.error('Failed to evolve project:', error);
      throw new Error('无法基于旧项目生成新方案，请检查指令是否清晰。');
    }
};

/**
 * 核心：基于自然语言意图生成完整项目结构 (One-Sentence Project Initiation)
 */
export const generateProjectFromIntention = async (
  intention: string,
  team: TeamMember[]
): Promise<Partial<Project>> => {
  const teamContext = team.map(m => `${m.nickname}(${m.role})`).join(', ');
  
  const systemInstruction = `你是一个资深的公益项目架构师。你的任务是将用户的一句话立项意图，转化为一个结构完整、逻辑严密的项目数据对象。
  
  【团队背景】
  ${teamContext}

  【输出要求】
  返回一个符合以下 TypeScript 接口定义的 JSON 对象 (不要包含 markdown 代码块标记)：
  
  interface ProjectDraft {
    title: string; // 项目标题 (简练有力)
    domain: string; // 必须是以下之一: '儿童'|'妇女'|'老人'|'残障'|'青年'|'环保'|'医疗'|'可持续'|'教育'|'动物保护'|'社区发展'|'其他'
    startDate: string; // YYYY-MM-DD (根据当前日期 2026-01-12 推算)
    description: string; // 项目简介 (200字以内)
    leader: string; // 从团队成员中推荐最合适的负责人昵称
    milestones: {
      stage: string; // 阶段名 (如: 筹备期, 执行期)
      task: string; // 任务名
      chargePerson: string; // 推荐负责人
      completionDate: string; // YYYY-MM-DD
      status: 'Pending';
    }[];
    expenses: {
      category: string; // 科目
      item: string; // 明细
      budgetAmount: number; // 预估金额
      notes: string; // 测算依据
    }[];
  }
  
  请确保：
  1. 预算合理，符合公益行业标准。
  2. 任务分工匹配团队成员角色。
  3. 时间安排具有可行性。
  `;

  const prompt = `用户立项意图："${intention}"`;

  const response = await callAI({
    model: 'gemini-3-flash-preview',
    systemInstruction,
    prompt,
    jsonMode: true
  });

  try {
    const cleaned = cleanJsonResponse(response.text || '{}');
    const data = JSON.parse(cleaned);
    
    // Transform to fit Project interface
    return {
      title: data.title,
      domain: data.domain,
      startDate: data.startDate,
      leader: data.leader,
      status: 'Planning',
      source: 'Upload', // Marking as AI generated
      planLocked: false,
      financialsLocked: false,
      executionLocked: false,
      reportLocked: false,
      pptLocked: false,
      created_at: Date.now(),
      expenses: (data.expenses || []).map((e: any, idx: number) => ({
        id: `exp-ai-${Date.now()}-${idx}`,
        category: e.category,
        item: e.item,
        budgetAmount: e.budgetAmount,
        actualAmount: 0,
        attachments: [],
        notes: e.notes || ''
      })),
      milestones: (data.milestones || []).map((m: any, idx: number) => ({
        id: `ms-ai-${Date.now()}-${idx}`,
        stage: m.stage,
        task: m.task,
        chargePerson: m.chargePerson,
        status: 'Pending',
        completionDate: m.completionDate,
        evidence: []
      })),
      officialPlanContent: `# ${data.title}\n\n${data.description}\n\n*(此方案由 AI 基于意图自动生成)*`
    };
  } catch (e) {
    console.error("Failed to parse project intention", e);
    throw new Error("AI 生成项目结构失败，请重试");
  }
};

/**
 * 核心：智能单据识别 (Financial Audit Agent)
 */
export const analyzeReceipt = async (imageBase64: string): Promise<any> => {
  const ai = await getAI();
  const prompt = `你是一个专业的财务审计助手。请分析这张票据图片，提取关键信息并返回 JSON。
  
  【提取字段】
  - item: 费用名称 (如：高铁票、办公用品)
  - amount: 总金额 (数字)
  - date: 日期 (YYYY-MM-DD)
  - category: 建议归类 (差旅费/物资费/劳务费/其他)
  - merchant: 商家/收款方名称
  - notes: 备注信息 (包含发票号或特殊说明)

  只返回 JSON 对象，不要其他废话。`;

  try {
    // 移除 data:image/xxx;base64, 前缀
    const cleanBase64 = imageBase64.split(',')[1] || imageBase64;
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: [
        {
          parts: [
            { text: prompt },
            { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } }
          ]
        }
      ]
    });

    const text = response.text;
    const cleaned = cleanJsonResponse(text || '');
    return JSON.parse(cleaned);
  } catch (e: any) {
    console.error("Receipt Analysis Failed:", e);
    throw new Error("单据识别失败: " + e.message);
  }
};

/**
 * 核心：智能记账通用分析 (Generic Smart Ledger)
 * 支持根据动态模版表头提取信息
 */
export const analyzeSmartLedger = async (imageBase64: string, headers: string[]): Promise<any> => {
    const ai = await getAI();
    const prompt = `你是一个专业的财务会计助手。请分析这张图片（发票/收据/合同），并严格根据以下列名提取对应信息。
    
    【目标列名 (Strict Headers)】
    ${JSON.stringify(headers)}
    
    【提取要求】
    1. **严格映射**：请仔细理解上述列名的语义（例如"金额"、"日期"、"摘要"、"备注"等），将图片中的信息准确填入对应的字段中。
    2. **禁止修改Key**：返回的 JSON 对象中的 Key 必须与上述【目标列名】完全一致，不要翻译或修改。
    3. **智能推断**：
       - 如果列名是"金额"或"Total"，提取总金额（纯数字）。
       - 如果列名是"日期"或"Date"，提取开票日期（YYYY-MM-DD）。
       - 如果列名是"摘要"或"Item"，提取主要商品或服务名称。
       - 如果无法在图片中找到对应信息，请留空字符串，不要编造。
    4. **格式规范**：只返回一个纯 JSON 对象。`;
  
    try {
      // 移除 data:image/xxx;base64, 前缀
      const cleanBase64 = imageBase64.split(',')[1] || imageBase64;
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: [
          {
            parts: [
              { text: prompt },
              { inlineData: { mimeType: 'image/jpeg', data: cleanBase64 } }
            ]
          }
        ]
      });
  
      const text = response.text;
      const cleaned = cleanJsonResponse(text || '');
      return JSON.parse(cleaned);
    } catch (e: any) {
      console.error("Smart Ledger Analysis Failed:", e);
      throw new Error("智能记账分析失败: " + e.message);
    }
  };

/**
 * 核心：分析 Excel 模版结构
 */
export const analyzeExcelTemplate = async (csvContent: string) => {
    const prompt = `你是一个数据结构分析师。请分析以下 Excel 模版的前几行数据（CSV格式），识别表头所在行以及数据填充的起始行。

    【模版数据片段】
    ${csvContent}

    【任务要求】
    1. 识别哪一行是“表头行”（包含具体列名，如日期、金额、摘要等）。
    2. 识别数据应该从哪一行开始填充（通常是表头行的下一行）。
    3. 提取所有有效的列名（Headers）。

    【返回格式】
    请返回 JSON 对象：
    {
        "headerRowIndex": number, // 表头所在行索引 (从 1 开始)
        "dataStartRowIndex": number, // 数据填充起始行索引 (从 1 开始)
        "headers": string[] // 提取的列名数组
    }`;

    const response = await callAI({
        model: 'gemini-3-flash-preview',
        prompt,
        jsonMode: true
    });

    return JSON.parse(cleanJsonResponse(response.text || '{}'));
};

/**
 * 核心：OCR + LLM 混合分析 (Robust Fallback)
 * 当 Gemini Vision API 不可用时，使用 Tesseract 本地 OCR 提取文本，再用 Text LLM (如 DeepSeek) 解析
 */
export const analyzeWithOCRAndLLM = async (imageBase64: string, headers: string[]): Promise<any> => {
    // 1. OCR Stage
    console.log("Starting Local OCR...");
    const worker = await createWorker('eng+chi_sim'); // Load English and Simplified Chinese
    const ret = await worker.recognize(imageBase64);
    const text = ret.data.text;
    await worker.terminate();
    console.log("OCR Result:", text.substring(0, 100) + "...");

    // 2. LLM Parsing Stage
    const prompt = `你是一个数据提取助手。请根据 OCR 识别到的文本内容，提取对应字段的信息。
    
    【OCR 原始文本】
    ${text}
    
    【目标字段 (JSON Key)】
    ${JSON.stringify(headers)}
    
    【提取要求】
    1. 根据上下文推断每个字段对应的值。
    2. 如果找不到，留空。
    3. 只返回 JSON 对象。`;

    // Uses the generic callAI, which supports whatever provider is configured (e.g. DeepSeek)
    const response = await callAI({
        model: 'gemini-3-flash-preview', // Fallback model name, but callAI uses provider's default usually if configured
        prompt,
        jsonMode: true
    });

    try {
        const cleaned = cleanJsonResponse(response.text || '{}');
        return JSON.parse(cleaned);
    } catch (e) {
        console.error("LLM Parse Failed:", e);
        return {};
    }
};

/**
 * 核心：生成项目策划/任务解析方案
 */
export const generateCampaignPlan = async (
  event: CalendarEvent, 
  domain: NgoDomain, 
  type: string, 
  customization: PlanCustomization, 
  team: TeamMember[],
  userRole?: string,
  extraContext?: string
): Promise<GeneratedPlan> => {
  const teamContext = team.map(m => `${m.nickname}(${m.role}: ${m.responsibility})`).join(', ');
  
  let systemInstruction = "你是一个专业的公益项目专家。";
  let prompt = "";
  const contextBlock = extraContext && String(extraContext).trim()
    ? `\n\n【补充上下文（结构化参考，优先使用）】\n${String(extraContext).slice(0, 8000)}`
    : "";

  if (type === 'TaskAnalysis') {
      systemInstruction = `你是一个资深的公益项目执行顾问。你擅长解析复杂的、非标准的工作任务。
      【回退原则】在面对一个任务节点时，你必须按照以下逻辑思考：
      1. 溯源思考 (Why)：为什么这个节点被排期在这里？它在项目整体目标中承载了什么价值？如果不做会产生什么风险？
      2. 落地指导 (How)：具体该如何执行？分几个步骤？
      3. 交付物预测：完成此项任务应该产生什么结果或文档？
      4. 工具包预测：为了高质量完成任务，可能需要哪些 SOP 或表单工具？`;

      prompt = `请深度解析任务节点："${event.title}"。
      
      【节点背景】
      - 日期：${event.date}
      - 描述：${event.description || '暂无详细描述'}
      - 领域：${domain}
      - 负责人身份：${userRole || '项目负责人'}
      - 团队背景：${teamContext}
      - 附加要求：${customization.additionalRequirements || '无'}
      ${contextBlock}
      请以 Markdown 格式返回。内容必须包含上述“回退原则”中的四个版块。`;
  } else {
      prompt = `请为项目"${event.title}"（领域: ${domain}）生成一份具备极高落地价值的${type === 'Content' ? '传播' : '活动'}方案。
      
      【执行上下文】
      当前用户身份: ${userRole || '项目负责人'}
      团队成员: ${teamContext}
      项目基准日期: ${event.date}
      具体要求: ${JSON.stringify(customization)}
      ${contextBlock}

      【输出要求】
      1. 请使用 Markdown 格式。
      2. 方案需针对该项目特性深度定制，拒绝空泛。
      3. ⚠️ 时间规范：具体节点必须使用 [YYYY-MM-DD] 格式。`;
  }

  const response = await callAI({
    model: 'gemini-3-flash-preview',
    systemInstruction,
    prompt: prompt,
  });

  return { 
    type: type as any, 
    markdown: response.text || '',
    content: type === 'Content' ? { 
      platforms: customization.platforms || [], 
      topics: [], 
      format: customization.contentFormat || '', 
      recommendedArticlesOrBooks: [], 
      rationale: '', 
      toolkits: [] 
    } : undefined
  };
};

export const identifyAttachments = async (filename: string, content: string, title: string, domain: string): Promise<string[]> => {
  const prompt = `你是一个拥有极富实操经验的资深公益项目经理。
  请深度解析任务解析/方案《${title}》，识别出能够直接辅助执行团队“上手干活”的、且“不可或缺”的 SOP 工具包清单。
  请返回一个 JSON 格式的文件名数组。
  ${content.substring(0, 4000)}`;
  
  const response = await callAI({
    model: 'gemini-3-flash-preview',
    prompt: prompt,
    jsonMode: true,
    responseSchema: {
        type: Type.ARRAY,
        items: { type: Type.STRING }
    }
  });

  return extractArrayFromAiJson(response.text || '[]');
};

export const generateToolkitContent = async (
  filename: string, 
  title: string, 
  domain: string, 
  plan: string, 
  team: TeamMember[],
  customization: any
): Promise<string> => {
  const prompt = `你正在为项目/任务《${title}》的执行团队撰写一份名为：“${filename}”的实操工具包。
  任务背景参考: ${plan.substring(0, 3000)}`;

  const response = await callAI({
    model: 'gemini-3-flash-preview',
    prompt: prompt,
  });

  return response.text || '';
};

export const refinePlanWithChat = async (currentMarkdown: string, userMsg: string, history: any[], extraContext?: string): Promise<string> => {
  const ctx = Array.isArray(history) ? history : [];
  const ctxText = ctx.slice(-10).map((m: any) => `${m?.role === 'user' ? '用户' : '模型'}: ${String(m?.text || '')}`).join('\n');
  const contextBlock = extraContext && String(extraContext).trim()
    ? `\n\n【补充上下文（结构化参考，优先使用）】\n${String(extraContext).slice(0, 6000)}`
    : "";
  const prompt = `当前解析/方案内容:\n${currentMarkdown}\n\n最近对话:\n${ctxText}\n\n用户要求: ${userMsg}${contextBlock}\n请根据要求修改，返回完整的修改后 Markdown 文本。`;
  const response = await callAI({ model: 'gemini-3-flash-preview', prompt });
  return response.text || currentMarkdown;
};

export const refineProjectContent = async (currentMarkdown: string, userMsg: string, projectTitle: string): Promise<string> => {
    const prompt = `项目为“${projectTitle}”，内容：\n\n${currentMarkdown}\n\n修改要求：${userMsg}`;
    const response = await callAI({ model: 'gemini-3-flash-preview', prompt });
    return response.text || currentMarkdown;
};

export const generateEventPoster = async (event: CalendarEvent, domain: NgoDomain, config: PosterConfig): Promise<string> => {
  const ai = await getAI();
  const prompt = `为公益项目“${event.title}”设计海报。风格: ${config.style}, 比例: ${config.aspectRatio}。`;
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash-image',
    contents: { parts: [{ text: prompt }] },
    config: { imageConfig: { aspectRatio: config.aspectRatio as any } }
  });
  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
  }
  throw new Error("未能生成海报图片");
};

export const recommendTeamLead = async (title: string, desc: string, members: TeamMember[], date: string) => {
  const prompt = `项目: ${title}，团队成员: ${JSON.stringify(members)}。请推荐负责人并返回 JSON: {"name": "姓名", "reason": "理由"}`;
  const response = await callAI({ model: 'gemini-3-flash-preview', prompt, jsonMode: true });
  try {
      const cleaned = cleanJsonResponse(response.text || '{}');
      return JSON.parse(cleaned);
  } catch (e) {
      return { name: '未知', reason: '解析失败' };
  }
};

export const extractBudgetFromPlan = async (title: string, plan: string) => {
  const systemInstruction = `你是一个专业的财务预算分析师。你的任务是从项目方案中提取或合理推算预算明细。
  
  【提取规则】
  1. **精准提取**：如果方案中包含明确的金额（如“场地费 5000元”），请直接提取。
  2. **合理估算**：如果方案中只提到了需求但未标明金额（如“需要购买少量办公用品”），请根据中国大陆市场行情进行合理的保守估算（例如 200-500元），并在 notes 中注明“AI估算”。
  3. **科目分类**：category 必须是以下之一：'活动执行', '物资采购', '差旅交通', '人力劳务', '宣传推广', '行政办公', '其他'。
  4. **结构化输出**：返回 JSON 数组，不要包含 Markdown 标记。`;

  const prompt = `请分析项目《${title}》的以下方案内容，生成预算表：
  
  ${plan}`;

  const response = await callAI({ 
    model: 'gemini-3-flash-preview', 
    systemInstruction,
    prompt, 
    jsonMode: true 
  });
  return extractArrayFromAiJson(response.text || '[]');
};

export const decomposePlanToMilestones = async (plan: string, team: TeamMember[], startDate: string) => {
  const teamContext = team.map(m => `${m.nickname}(${m.role})`).join(', ');
  
  const systemInstruction = `你是一个资深的项目管理专家 (PMP)。你的任务是将项目策划案拆解为可执行、可落地的里程碑任务清单。
  
  【拆解原则】
  1. **全生命周期**：覆盖筹备期、执行期、结项期三个阶段。
  2. **颗粒度适中**：任务应具体到“动作”，例如“设计海报”而不是“宣传工作”。
  3. **责任分配**：根据以下团队成员的角色和特长，合理分配负责人：[${teamContext}]。如果不确定，可标记为“待定”。
  4. **时间规划**：基于项目开始日期 (${startDate})，合理推算每个任务的截止日期 (completionDate)。
  
  【输出格式】
  返回 JSON 数组，每个对象包含：
  - stage: 阶段 (如：筹备期/执行期/结项期)
  - task: 任务名称
  - chargePerson: 负责人昵称
  - completionDate: YYYY-MM-DD
  - status: "Pending"`;

  const prompt = `请基于以下项目方案内容进行任务拆解：
  
  ${plan}`;

  const response = await callAI({ 
    model: 'gemini-3-flash-preview', 
    systemInstruction,
    prompt, 
    jsonMode: true 
  });
  return extractArrayFromAiJson(response.text || '[]');
};

export const generateClosingReport = async (title: string, domain: string, data: any) => {
  const response = await callAI({ model: 'gemini-3-pro-preview', prompt: `撰写项目“${title}”的结项报告。` });
  return response.text || '';
};

export const generatePPTScript = async (title: string, reportContent: string, params: any): Promise<PPTSlide[]> => {
  const response = await callAI({ model: 'gemini-3-flash-preview', prompt: `基于报告生成 PPT 数组 JSON。\n${reportContent}`, jsonMode: true });
  return extractArrayFromAiJson(response.text || '[]');
};

export const analyzeQueryIntent = async (query: string): Promise<'academic' | 'business' | 'creative' | 'fact'> => {
    // Legacy function kept for compatibility, but logic is now integrated into generateAnswerFramework
    return 'academic';
};

/**
 * Intelligent Context Pruning
 * Analyzes chat history and filters out messages irrelevant to the current query.
 * Strategy:
 * 1. Always keep the immediate previous turn (user + assistant) for continuity.
 * 2. For older messages, only keep them if they are semantically related or contain definitions.
 * 3. Token optimization: Convert large context into a concise summary if possible.
 */
const pruneContext = (history: any[], currentQuery: string): any[] => {
    if (!history || history.length === 0) return [];

    // Always keep the last 2 messages (User + Assistant) for immediate context
    const recentHistory = history.slice(-2);
    const olderHistory = history.slice(0, -2);

    if (olderHistory.length === 0) return recentHistory;

    // Lightweight Heuristic: Check for keyword overlap or topic continuity
    // (In a full implementation, we would use embeddings here, but to save latency/cost we use heuristics)
    const keywords = currentQuery.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    
    const relevantOlderMessages = olderHistory.filter(msg => {
        // Keep system messages or high-value definitions
        if (msg.role === 'system') return true;
        
        // Simple keyword matching for relevance
        const content = msg.text.toLowerCase();
        return keywords.some(kw => content.includes(kw));
    });

    return [...relevantOlderMessages, ...recentHistory];
};

export const generateAnswerFramework = async (query: string, chatHistory: any[] = [], fileMetadata: string[] = []) => {
  // Apply Intelligent Context Pruning
  const prunedHistory = pruneContext(chatHistory, query);
  
  const historyText = prunedHistory.map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.text}`).join('\n');
  
  // Format file metadata for context
  const fileContext = fileMetadata.length > 0 
    ? `【可用知识库文件】\n${fileMetadata.map(f => `- ${f}`).join('\n')}`
    : '【可用知识库文件】\n(用户未指定特定文件，需进行广泛检索)';

  const systemInstruction = `你是一个拥有元认知能力的“超级研究规划师”。你的任务不是回答问题，而是根据用户的问题和**可用的知识库文件**，动态定义最佳的专家角色，并制定一份深度的研究大纲。

  【工作流程】
  1. **意图识别与角色定义**：
     - 分析用户问题的隐含意图。
     - 结合【可用知识库文件】的标题，推断用户可能需要哪些领域的知识。
     - 定义一个最适合解决该问题的“专家角色”（Target Persona）。

  2. **任务拆解 (Chain of Thought)**：
     - 思考：为了以该专家的身份完美回答这个问题，我需要从这些文件中搜集哪些信息？
     - 如果用户指定了具体文件（如“分析财报”），请优先针对该文件生成搜索词。

  3. **生成大纲**：
     - 将思考转化为结构化的章节。
     - 为每个章节生成**专门用于向量检索**的搜索关键词 (Queries)。关键词应包含文件中的可能术语。

  【输出格式】
  返回一个 JSON 对象：
  {
    "targetPersona": "定义的专家角色名称",
    "intentAnalysis": "简短的意图分析",
    "sections": [
      { "title": "章节标题", "queries": ["搜索关键词1", "搜索关键词2"] }
    ]
  }`;

  const prompt = `
  ${fileContext}

  【历史对话】
  ${historyText || '无'}
  
  【用户问题】
  ${query}
  
  请生成专家角色定义和研究大纲（JSON）：`;

  const response = await callAI({
    model: 'gemini-3-pro-preview', 
    systemInstruction,
    prompt,
    jsonMode: true
  });

  try {
    const cleaned = cleanJsonResponse(response.text || '{}');
    return JSON.parse(cleaned);
  } catch (e) {
    console.error("Framework Generation Failed:", e);
    // Fallback
    return {
      targetPersona: "智能助手",
      intentAnalysis: "解析失败，使用默认模式",
      sections: [
        { title: "关键信息提取", queries: [query] },
        { title: "详细分析", queries: [query + " 细节"] }
      ]
    };
  }
};

export const callAIStream = async function* (params: {
    systemInstruction?: string;
    prompt: string;
    model?: string;
    jsonMode?: boolean;
    temperature?: number;
}) {
    const provider = llmFactory.getProvider();
    if (!await provider.isReady()) {
        throw new Error("AI 服务未连接：请在设置中配置 API Key。");
    }

    try {
        const stream = provider.generateContentStream({
            prompt: params.prompt,
            systemInstruction: params.systemInstruction,
            model: params.model,
            jsonMode: params.jsonMode,
            temperature: params.temperature
        });

        for await (const chunk of stream) {
            yield chunk;
        }
    } catch (e: any) {
        console.error("AI Streaming Error:", e);
        throw new Error(`AI 流式生成失败: ${e.message}`);
    }
};

export const generateDeepSynthesisStream = async function* (query: string, framework: any, sectionContexts: Record<string, string>) {
  const persona = framework.targetPersona || "资深研究员";
  const intent = framework.intentAnalysis || "深度分析";

  const systemInstruction = `你现在的身份是：**${persona}**。
  
  【任务背景】
  用户意图：${intent}
  你已经完成了前期的研究规划和资料搜集，现在需要撰写最终的深度回答。

  【思维链 (Chain of Thought) - 必须严格执行】
  在开始输出正文之前，请先进行深度的上下文组织和自我反思（Hidden Thought Process）：
  1. **资料审视**：快速浏览所有检索到的资料，剔除无关噪音。
  2. **逻辑构建**：思考如何将碎片化的信息串联成一个有说服力的故事或论证。
  3. **自我反思**：检索到的信息是否足以支撑结论？如果不足，应在回答中诚实指出局限性。

  【撰写准则】
  1. **风格一致性**：必须时刻保持“${persona}”的语气、词汇和视角（例如：如果是咨询顾问，使用专业商业术语；如果是小说家，注重叙事性）。
  2. **深度融合**：禁止机械拼凑。你需要将不同来源的信息打碎重组，形成新的洞见。
  3. **严格引用 (CRITICAL)**：
     - 每一个事实性陈述必须标注来源 [x]。
     - [x] 必须对应【参考资料】中已有的标号（例如：[1], [2], [3]...）。
     - **禁止使用上标**：请使用标准方括号格式 [1]，不要使用 [^1] 或其他变体，确保前端能正确解析。
     - **严禁编造**：如果【参考资料】中没有包含足够的信息来回答用户问题，你必须明确指出“资料不足”，并拒绝回答。
     - **禁止幻觉**：严禁引用 [1]-[68] 这种超出实际资料范围的数字。如果资料只有 3 条，你的引用最大只能到 [3]。
     - **严禁拼接**：不同来源（SOURCE_FILENAME）的内容必须严格区分，禁止将不同文件的内容混淆在一起陈述，除非你明确说明是在进行“比较”。
  4. **结构化输出**：直接输出 Markdown 正文。
  `;

  // Build context string
  let fullContext = "";
  framework.sections.forEach((sec: any) => {
    fullContext += `\n### 章节：${sec.title}\n${sectionContexts[sec.title] || '(该章节未找到相关资料)'}\n`;
  });

  const prompt = `
  【用户问题】
  ${query}
  
  【参考资料 (已索引)】
  ${fullContext}
  
  请以 ${persona} 的身份，开始撰写回答：`;

  // Using callAIStream instead of unary call
  const stream = callAIStream({
      model: 'gemini-3-pro-preview', 
      systemInstruction,
      prompt,
      // jsonMode: false // Stream raw markdown
  });

  for await (const chunk of stream) {
      yield chunk;
  }
};

export const chatWithKnowledgeBase = async (query: string, context: string, chatHistory: any[] = []) => {
  const systemInstruction = `你是一个基于知识库的智能助手，服务于公益项目团队。
  
  【核心指令】
  你必须严格基于【参考资料】回答用户问题。
  
  【输出格式要求 - JSON Mode】
  请不要直接返回 Markdown 文本。必须返回一个 JSON 对象，包含一个 "answer_segments" 数组。
  每个 segment 代表一个逻辑段落，包含：
  - "text": 段落文本内容。⚠️严禁在 text 中包含 [1] [2] 这种引用标记，引用标记只能放在 citation_indices 数组中。
  - "citation_indices": 该段落引用的【参考资料】索引数字数组（例如 [1, 3]）。如果该段落没有引用，则为空数组。
  
  【回答原则】
  1. **事实导向**：所有事实性陈述必须有引用支持。
  2. **严谨引用**：严禁编造引用索引。索引必须对应【参考资料】中标记的 [x]。
  3. **逻辑连贯**：将回答拆分为多个自然的逻辑段落，确保阅读流畅。
  4. **来源一致**：确保引用的内容确实来自对应的源文件 (Source: ...)。
  
  【JSON 示例】
  {
    "answer_segments": [
      { "text": "根据项目预算表，总支出预计为 50 万元。", "citation_indices": [1] },
      { "text": "这一数据在年度报告中也得到了确认，重点用于物资采购。", "citation_indices": [2, 4] }
    ]
  }`;

  // Construct history text
  const historyText = chatHistory.map(m => `${m.role === 'user' ? '用户' : '助手'}: ${m.text}`).join('\n');
  
  const prompt = `
  【历史对话】
  ${historyText || '无'}
  
  【参考资料】
  ${context}
  
  【用户问题】
  ${query}
  
  请返回 JSON 格式答案：`;

  try {
      const response = await callAI({ 
          model: 'gemini-3-pro-preview', 
          systemInstruction,
          prompt,
          jsonMode: true 
      });

      // Post-processing: Convert JSON back to Markdown with citations
      const cleaned = cleanJsonResponse(response.text || '{}');
      const data = JSON.parse(cleaned);
      
      let markdownOutput = "";
      if (data.answer_segments && Array.isArray(data.answer_segments)) {
          markdownOutput = data.answer_segments.map((seg: any) => {
              // 1. 索引去重 (Deduplicate indices)
              const uniqueIndices = Array.from(new Set((seg.citation_indices || []).filter((idx: any) => typeof idx === 'number')));
              
              // 2. 构建引用字符串
              const citations = uniqueIndices
                  .map((idx: any) => `[${idx}]`)
                  .join('');

              // 3. 清洗文本：移除可能残留的 [1] [2] 标记，防止双重引用
              let cleanText = seg.text || '';
              cleanText = cleanText.replace(/\[\s*\d+\s*\]/g, '').trim();

              // 4. 拼接
              return `${cleanText} ${citations}`;
          }).join('\n\n');
      } else {
          // Fallback if structure is wrong
          markdownOutput = response.text || '';
      }
      
      return markdownOutput;
  } catch (e) {
      console.error("Knowledge Chat JSON Error:", e);
      // Fallback to text mode if JSON fails (rare)
      return "抱歉，生成回答时遇到格式错误，请重试。";
  }
};

export const generateScheduleDraft = async (events: any[], domains: NgoDomain[], range: string, file: any, context: string) => {
  const systemInstruction = `你是一个资深的公益项目统筹专家。
  【核心理念】一个节点（Milestone）只是任务的终点，你需要根据目标的轻重缓急、周期内团队成员的综合画像（角色/职责/特质/忙闲时）、以及节点分布密度，预留合适的“执行档期”。
  【任务目标】围绕用户选定的多个节点，协调时间，生成一份策略大纲。
  【约束条件】
  1. 必须优先保障“重要且紧急”节点的资源。
  2. 避免任务在特定日期堆积，确保团队负载平衡。
  3. 输出内容应包含：阶段划分、核心策略、资源预警。
  4. 领域参考：${domains.join(', ')}。
  5. 禁止修改用户提供的基础输入：周期、核心节点、团队成员。`;

  const response = await callAI({ 
    model: 'gemini-3-flash-preview', 
    systemInstruction,
    prompt: context 
  });
  return response.text || '';
};

export const generateScheduleRefinement = async (draftText: string, team: TeamMember[], range: string) => {
  const systemInstruction = `你是一个结构化数据专家。请将排期大纲解析为标准的 JSON 格式，以便同步到日历系统。
  
  【字段规范】
  - overview: 战略概览
  - phases: 阶段数组 { name, timeRange, focus }
  - tasks: 任务数组 { title, ownerName (必须是团队成员之一), role, priority (High/Normal/Low), type (Task/Milestone), phaseName, date (格式 YYYY-MM-DD, 必须根据阶段时间推算具体执行日) }
  - roleGuidance: 角色建议数组 { role, focus, tips }
  
  【团队成员参考】
  ${team.map(m => m.nickname).join(', ')}`;

  const response = await callAI({ 
    model: 'gemini-3-flash-preview', 
    systemInstruction,
    prompt: `解析以下排期大纲并返回 JSON，目标周期为 ${range}：\n${draftText}`, 
    jsonMode: true 
  });
  return cleanJsonResponse(response.text || '{}');
};

/**
 * 强化后的 AI 智能排期提取 - 严格领域界定与标题描述分离逻辑
 */
export const parseEventsFromMixedContent = async (parts: any[]) => {
  const systemPrompt = `你是一个专业的公益项目协调员，擅长从杂乱的项目文档中精准提取排期节点。
  
  【领域识别优先级 (严格准则)】
  1. 显性声明：若文档明确写明“所属领域”、“领域：环保”等，以此为准。
  2. 隐含判定：若无显性说明，根据面向人群（如：小学生->教育/儿童）或活动主题（如：植树->环保）判定。
  3. 综合推测：基于全文语义逻辑进行界定。
  ⚠️ 注意：输出的 domain 必须属于以下列表，严禁自定义新词：
  [儿童, 妇女, 老人, 残障, 青年, 环保, 医疗, 可持续, 教育, 动物保护, 社区发展, 其他]
  
  【核心指令】
  1. 区分标题与描述：title 只能是 15 字以内的短句（如“项目启动会”），禁止将长段描述放入 title。
  2. description：包含地点、具体要求、人员分工等详细信息。
  3. 日期标准化：必须为 YYYY-MM-DD 格式。若只有月日，推测为 2026 年。
  
  【结构化要求】
  返回 JSON 数组，每个对象必须包含：
  - title: 字符串 (短标题)
  - date: 字符串 (YYYY-MM-DD)
  - domain: 字符串 (必须是上述 12 个领域之一)
  - priority: { isImportant: boolean, isUrgent: boolean }
  - description: 字符串 (详细描述)`;

  const response = await callAI({ 
    model: 'gemini-3-flash-preview', 
    systemInstruction: systemPrompt,
    prompt: `请解析以下混合内容并提取排期节点（请按上述规则进行领域界定和字段分离）：\n${JSON.stringify(parts)}`, 
    jsonMode: true 
  });
  
  return extractArrayFromAiJson(response.text || '[]');
};

export const analyzeProjectFile = async (text: string, filename: string) => {
  const response = await callAI({ model: 'gemini-3-flash-preview', prompt: `提取项目信息 JSON 格式。内容：\n${text}`, jsonMode: true });
  try { return JSON.parse(cleanJsonResponse(response.text || '{}')); } catch (e) { return {}; }
};

export const analyzeLeadSource = async (lead: ProjectLeadSource, orgContext: any) => {
  const response = await callAI({ model: 'gemini-3-flash-preview', prompt: `分析线索并返回机会数组 JSON。内容：\n${lead.content}`, jsonMode: true });
  return extractArrayFromAiJson(response.text || '[]');
};

export const generateProposal = async (opp: Opportunity, team: TeamMember[], context: string) => {
  const response = await callAI({ model: 'gemini-3-pro-preview', prompt: `生成申报书草稿。机会：${JSON.stringify(opp)}` });
  return response.text || '';
};

export const searchWebLeads = async (config: SearchConfig) => {
  const ai = await getAI();
  const query = `寻找 ${config.domains.join(', ')} 领域的资助机会。地点: ${config.matchCriteria.region}`;
  const response = await ai.models.generateContent({ model: 'gemini-3-pro-image-preview', contents: query, config: { tools: [{ googleSearch: {} }] } });
  const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
  const results: WebLeadResult[] = (chunks || []).map((c: any, i: number) => ({ id: `web-${i}`, title: c.web?.title || '发现', snippet: response.text?.slice(0, 200) || '', url: c.web?.uri || '', source: '网络检索', matchScore: 85, matchReason: '匹配领域', isCollected: false }));
  return { results, marketReport: { summary: response.text || '', hotTopics: config.keywords, generatedAt: Date.now() } };
};

export const authLogin = async (u: string, p: string) => ({ token: 'mock', username: u, isActive: true });
export const authRegister = async (u: string, p: string) => ({});
export const activateMembership = async (c: string) => ({});

/**
 * 战略规划引擎：分析意图复杂度
 */
export const analyzeProjectComplexity = async (intention: string) => {
    const prompt = `你是一个战略咨询顾问。请分析用户输入的以下项目意图，评估其复杂度、可行性和所需资源。
    
    用户意图："${intention}"
    
    请返回 JSON 格式：
    {
        "complexity": "Low" | "Medium" | "High", // 复杂度
        "feasibility": "High" | "Medium" | "Low", // 可行性
        "reasoning": "简短的分析理由 (50字以内)",
        "estimatedDuration": "预计周期 (如: 2周, 3个月)",
        "coreUser": "核心用户群体",
        "stakeholders": ["利益相关方1", "利益相关方2"]
    }`;

    const response = await callAI({
        model: 'gemini-3-flash-preview',
        prompt,
        jsonMode: true
    });

    try {
        return JSON.parse(cleanJsonResponse(response.text || '{}'));
    } catch (e) {
        return { complexity: 'Medium', feasibility: 'High', reasoning: '无法自动评估', estimatedDuration: '1个月' };
    }
};

/**
 * 战略规划引擎：生成战略方案 (The Why & The How)
 */
export const generateStrategicPlan = async (intention: string, complexityAnalysis: any, team: TeamMember[]) => {
    const teamContext = team.map(m => `${m.nickname}(${m.role})`).join(', ');
    
    const systemInstruction = `你是一个顶尖的战略咨询顾问（麦肯锡/波士顿咨询风格）。你的任务是将用户的简单意图转化为一份具有深度、前瞻性和落地性的战略方案。
    
    【思考框架】
    1. **Why (为何做)**：
       - 从用户视角出发，挖掘核心痛点。
       - 结合最新的时代趋势、行业前沿或研究成果。
       - 明确核心价值和影响力。
       - 必须具有可行性，拒绝陈词滥调。
    2. **How (如何做)**：
       - 大颗粒度的时间安排。
       - 关键里程碑 (Milestones)。
       - 如何卷入利益相关方。
    
    【团队资源】
    ${teamContext}
    
    【输入信息】
    用户意图：${intention}
    AI预判：${JSON.stringify(complexityAnalysis)}
    `;

    const prompt = `请生成一份战略方案。
    
    【输出格式】
    请返回 JSON 对象：
    {
        "title": "极具吸引力的项目名称",
        "strategicValue": "Markdown格式的战略价值阐述 (Why)",
        "implementationPath": "Markdown格式的实施路径 (How)",
        "milestones": [
            { "name": "里程碑1", "description": "简述", "estimatedDate": "YYYY-MM-DD" },
            { "name": "里程碑2", "description": "简述", "estimatedDate": "YYYY-MM-DD" }
        ],
        "stakeholderStrategy": "利益相关方联动策略"
    }`;

    const response = await callAI({
        model: 'gemini-3-pro-preview', // Use Pro for better reasoning
        systemInstruction,
        prompt,
        jsonMode: true
    });

    try {
        return JSON.parse(cleanJsonResponse(response.text || '{}'));
    } catch (e) {
        console.error("Failed to generate strategic plan", e);
        throw new Error("战略方案生成失败");
    }
};

/**
 * 战略规划引擎：拆解执行任务
 */
export const breakdownPlanToTasks = async (plan: any, startDate: string, team: TeamMember[]) => {
    const teamContext = team.map(m => `${m.nickname}(${m.role})`).join(', ');

    const prompt = `你是一个高效的项目执行经理。请将以下战略方案中的里程碑拆解为具体的、可执行的每日任务清单。
    
    【输入方案】
    ${JSON.stringify(plan)}
    
    【团队成员】
    ${teamContext}
    
    【开始日期】
    ${startDate}
    
    【输出要求】
    返回 JSON 数组，格式符合 CalendarEvent 接口 (部分字段)：
    [
        {
            "title": "任务标题",
            "date": "YYYY-MM-DD", // 必须根据里程碑时间合理推算
            "category": "Project",
            "description": "任务描述",
            "priority": { "isImportant": true/false, "isUrgent": true/false },
            "assignee": "负责人昵称" // 从团队中选择
        }
    ]
    `;

    const response = await callAI({
        model: 'gemini-3-flash-preview',
        prompt,
        jsonMode: true
    });

    return extractArrayFromAiJson(response.text || '[]');
};
