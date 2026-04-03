import { GoogleGenAI } from "@google/genai";
import { VisualProvider, VisualEngineConfig, PosterConfig } from '../types';
import { llmFactory } from './llm';
import { signVolcengineRequest } from '../utils/volcengineAuth';

// Helper to get Gemini Client (Specifically for Vision/Image tasks that require Google)
const getGeminiClient = async () => {
    const secure = (window as any).electronAPI?.secure;
    let key = '';
    
    // Try Visual Config Key first
    if (secure) {
        key = await secure.get('visual_api_key_Gemini');
    }
    if (!key) key = localStorage.getItem('visual_api_key_Gemini') || '';

    // Fallback to global Google key
    if (!key) {
        if (secure) key = await secure.get('user_api_key_google');
        if (!key) key = localStorage.getItem('user_api_key_google') || '';
    }

    // Final Legacy Fallback (optional)
    if (!key) key = localStorage.getItem('user_api_key') || '';

    return new GoogleGenAI({ apiKey: key });
};

const isGeminiAuthError = (msg: string) => {
    const upper = String(msg || '').toUpperCase();
    return upper.includes('API_KEY_INVALID')
        || upper.includes('API KEY EXPIRED')
        || upper.includes('INVALID_API_KEY')
        || upper.includes('INVALID_ARGUMENT');
};

const getGeminiApiKeyCandidates = async (preferredKey: string): Promise<string[]> => {
    const secure = (window as any).electronAPI?.secure;
    const values: string[] = [];
    const push = (v: any) => {
        const s = String(v || '').trim();
        if (s) values.push(s);
    };
    push(preferredKey);
    if (secure) push(await secure.get('visual_api_key_Gemini'));
    push(localStorage.getItem('visual_api_key_Gemini'));
    if (secure) push(await secure.get('user_api_key_google'));
    push(localStorage.getItem('user_api_key_google'));
    push(localStorage.getItem('user_api_key'));
    return [...new Set(values)];
};

// 1. Plan Analysis: Breakdown plan into milestone posters (Uses LLM Factory for provider agility)
export const analyzePlanForPosters = async (planMarkdown: string): Promise<any[]> => {
    const prompt = `
    你是一个专业的视觉传达专家。请分析以下公益项目策划方案，提炼出 3-5 个关键的传播节点（里程碑），并为每个节点构思一张海报的需求。
    
    【策划方案内容】
    ${planMarkdown.substring(0, 5000)}

    【输出要求】
    请返回一个 JSON 数组，每个对象包含以下字段：
    - id: string (唯一标识，如 "poster-1")
    - title: string (海报主题，如“项目启动官宣”)
    - purpose: string (传播重点和目的，如“利用数据引发共鸣，招募首批志愿者”)
    - recommendedStyle: string (推荐的视觉风格，如“温暖治愈插画风”或“极简摄影风”)
    - contentElements: string (建议包含的画面元素)

    只返回 JSON 数据，不要 Markdown 格式。
    `;

    try {
        const provider = llmFactory.getProvider();
        const response = await provider.generateContent({
            prompt: prompt,
            model: 'gemini-1.5-flash', // Hint model if supported, otherwise provider decides
            jsonMode: true
        });
        
        const text = (response.text || '[]').replace(/```json/gi, '').replace(/```/g, '').trim();
        return JSON.parse(text);
    } catch (e: any) {
        console.error("Plan Analysis Failed:", e);
        throw new Error(`方案分析失败: ${e.message || '未知错误'}`);
    }
};

// 2. Reverse Prompt Extraction (Image to Text)
export const extractPromptFromImage = async (base64Image: string): Promise<string> => {
    const client = await getGeminiClient();
    // Remove header if present
    const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');
    
    const prompt = `
    作为一名资深的 AI 绘画提示词工程师，请详细分析这张参考图的视觉风格。
    请提取出可以用于生成类似风格图片的 Prompt（提示词）。
    重点关注：
    1. 艺术风格（如：油画、3D渲染、极简矢量、胶片摄影等）
    2. 光影与色调（如：自然光、赛博朋克霓虹、低饱和度莫兰迪色等）
    3. 构图与视角
    4. 材质与纹理
    
    请直接输出一段英文 Prompt，单词之间用逗号分隔，不需要任何解释性语言。
    `;

    try {
        const response = await client.models.generateContent({
            model: 'gemini-3-flash-preview', // Multimodal
            contents: [
                { text: prompt },
                { inlineData: { mimeType: 'image/png', data: cleanBase64 } }
            ]
        });
        return response.text || '';
    } catch (e) {
        console.error("Prompt Extraction Failed:", e);
        throw new Error("无法从参考图中提取提示词，请检查网络或 API Key。");
    }
};

export const analyzeReferenceImageForSceneAndSubjects = async (base64Image: string): Promise<any> => {
    const client = await getGeminiClient();
    const cleanBase64 = base64Image.replace(/^data:image\/(png|jpeg|jpg|webp);base64,/, '');
    const prompt = `
    请分析这张图片，并严格返回 JSON，不要输出其它文本。字段要求：
    {
      "imageIntro":"图片简介",
      "aspectRatio":"1:1|3:4|4:3|16:9|9:16|unknown",
      "style":{
        "visualStyle":"视觉风格",
        "colorScheme":"配色方案",
        "composition":"构图",
        "decorations":"装饰",
        "typography":"字体效果",
        "mainTitle":"主标题",
        "subTitle":"副标题"
      },
      "reproduciblePrompt":"可复现该图核心风格和元素的英文prompt，无则空字符串",
      "subjects":[
        {"id":"subject-1","name":"主体名","sizeScore":0-1,"centerScore":0-1,"rankScore":0-1,"x":0-1,"y":0-1,"scale":0-1}
      ],
      "scene":{
        "exists":true/false,
        "reality":"real|virtual|mixed|unknown",
        "sceneType":"场景类型",
        "overview":"场景整体描述",
        "perspective":"平视/仰视/俯视/鸟瞰/鱼眼/微缩/超人等",
        "atmosphere":"冷暖氛围",
        "brightness":"亮度关系",
        "sharpness":"虚实关系",
        "focusArea":"视觉焦点",
        "visualCenter":"视觉中心",
        "gazeOrder":"9宫格视线顺序描述"
      }
    }
    约束：
    1) subjects 最多 5 个，按 rankScore 降序。
    2) 如字段无法识别可用空字符串或合理默认值，不要省略键。
    `;
    const response = await client.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: [
            { text: prompt },
            { inlineData: { mimeType: 'image/png', data: cleanBase64 } }
        ]
    });
    const raw = String(response.text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    return JSON.parse(raw);
};

export const generateStructuredPromptFromRequirement = async (requirement: string): Promise<string> => {
    const provider = llmFactory.getProvider();
    const prompt = `
    你是资深视觉提示词工程师。把用户需求转换为“高质量生图结构化Prompt”。
    输出格式：
    [Image Intro]:
    [Aspect Ratio]:
    [Visual Style]:
    [Color Scheme]:
    [Composition]:
    [Decorations]:
    [Typography]:
    [Main Title]:
    [Sub Title]:
    [Prompt]:
    用户需求：
    ${requirement}
    `;
    const response = await provider.generateContent({
        prompt,
        model: 'gemini-1.5-flash'
    });
    return String(response.text || '').trim();
};

// 3. Construct Complex Prompt
export const constructPosterPrompt = (config: PosterConfig, purpose: string): string => {
    const parts = [];

    // Base Style (Highest Priority)
    if (config.referenceImagePrompt) {
        parts.push(`[Art Style]: ${config.referenceImagePrompt}`);
    } else {
        parts.push(`[Art Style]: ${config.style}`);
    }

    // Content & Purpose
    parts.push(`[Subject]: ${purpose}`);
    if (config.customText) parts.push(`[Main Text]: "${config.customText}"`);
    if (config.subTitle) parts.push(`[Subtitle]: "${config.subTitle}"`);
    
    // Refinements
    if (config.refinements) {
        const r = config.refinements;
        if (r.background) parts.push(`[Background]: ${r.background}`);
        if (r.colorScheme) parts.push(`[Color Palette]: ${r.colorScheme}`);
        if (r.textElements) parts.push(`[Typography]: ${r.textElements}`);
        if (r.decorations) parts.push(`[Decorations]: ${r.decorations}`);
        if (r.layout) parts.push(`[Composition]: ${r.layout}`);
        if (r.custom) parts.push(`[Additional Details]: ${r.custom}`);
    }

    // Technical
    parts.push("High quality, professional design, visually impactful, masterpiece, 8k resolution.");

    return parts.join(", ");
};

// 4. Multi-Provider Generation Logic
export const generateVisualContent = async (
    prompt: string, 
    aspectRatio: string, 
    configs: Record<VisualProvider, VisualEngineConfig>
): Promise<string> => {
    const providers: VisualProvider[] = ['Jimeng', 'Doubao', 'Nanobanana', 'Gemini'];
    const providerImplemented: Record<VisualProvider, boolean> = {
        Jimeng: true,
        Doubao: true,
        Nanobanana: false,
        Gemini: true
    };
    
    // Filter enabled providers
    const enabledProviders = providers.filter(p => {
        const c = configs[p];
        if (!c?.isEnabled) return false;
        if (p === 'Gemini') return true;
        // Check for required keys based on provider type
        if (p === 'Jimeng' || p === 'Doubao') {
            return !!(c.accessKeyId && c.secretAccessKey);
        }
        return !!c.apiKey;
    });
    const runnableProviders = enabledProviders.filter((p) => providerImplemented[p]);
    const unsupportedEnabled = enabledProviders.filter((p) => !providerImplemented[p]);
    
    // Fallback to Gemini if no specific engine is enabled but Gemini might be available globally
    const attemptList = runnableProviders.length > 0 ? runnableProviders : (enabledProviders.length > 0 ? [] : ['Gemini']);
    if (attemptList.length === 0 && unsupportedEnabled.length > 0) {
        throw new Error(`已启用引擎暂未集成：${unsupportedEnabled.join('、')}。请启用 Jimeng/Doubao/Gemini 中至少一个可用引擎。`);
    }

    let lastError: any;
    const providerErrors: string[] = [];
    const normalizeErr = (e: any) => {
        const msg = String(e?.message || e || '');
        const compact = msg.length > 360 ? `${msg.slice(0, 360)}...` : msg;
        return compact || '未知错误';
    };
    const isGeminiKeyInvalid = (e: any) => {
        const msg = String(e?.message || e || '').toUpperCase();
        return msg.includes('API_KEY_INVALID') || msg.includes('API KEY EXPIRED') || msg.includes('INVALID_ARGUMENT');
    };

    for (const provider of attemptList) {
        try {
            console.log(`[VisualService] Attempting generation with ${provider}...`);
            const result = await callProvider(provider, configs[provider], prompt, aspectRatio);
            if (result) return result;
        } catch (e) {
            console.warn(`[VisualService] ${provider} failed:`, e);
            lastError = e;
            providerErrors.push(`${provider}: ${normalizeErr(e)}`);
            if (provider === 'Gemini' && isGeminiKeyInvalid(e)) {
                try {
                    localStorage.setItem('visual_api_status_Gemini', 'paused');
                } catch (err) {}
            }
            // Continue to next provider
        }
    }

    const tail = normalizeErr(lastError);
    const detail = providerErrors.length ? `；失败明细：${providerErrors.join(' | ')}` : '';
    const hints: string[] = [];
    if (providerErrors.some((s) => s.includes('InvalidCredential'))) {
        hints.push('Jimeng/Doubao 的 Access Key ID 或 Secret Access Key 无效');
    }
    if (providerErrors.some((s) => /API_KEY_INVALID|API key expired|invalid_api_key/i.test(s))) {
        hints.push('Gemini API Key 已过期或无效');
    }
    if (unsupportedEnabled.length > 0) {
        hints.push(`以下引擎尚未集成：${unsupportedEnabled.join('、')}`);
    }
    const hintText = hints.length ? `；排查建议：${hints.join('；')}` : '';
    throw new Error(`所有启用的生图引擎均调用失败。最后一次错误: ${tail}${detail}${hintText}`);
};

// Internal: Provider Adapters
const callProvider = async (provider: string, config: VisualEngineConfig, prompt: string, aspectRatio: string): Promise<string> => {
    switch (provider) {
        case 'Gemini':
            return callGeminiImage(config?.apiKey || '', prompt, aspectRatio);
        case 'Jimeng':
        case 'Doubao':
            return callVolcengineImage(config, prompt, aspectRatio);
        case 'Nanobanana':
            // Placeholder for 3rd party APIs
            if (config?.apiKey === 'mock-success') {
                return generateMockImage(provider); 
            }
            throw new Error(`${provider} API 暂未集成。请使用 Jimeng/Doubao (已集成) 或 Gemini。`);
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
};

const callVolcengineImage = async (config: VisualEngineConfig, prompt: string, aspectRatio: string): Promise<string> => {
    if (!config.accessKeyId || !config.secretAccessKey) {
        throw new Error("Missing Access Key ID or Secret Access Key for Volcengine");
    }

    // Map aspectRatio to Width/Height
    // Default 1328*1328 (1:1)
    let width = 1328;
    let height = 1328;
    
    // Jimeng recommendations:
    // 1:1 -> 1328*1328
    // 4:3 -> 1472*1104
    // 3:4 -> 1104*1472 (Inferred)
    // 16:9 -> 1664*936
    // 9:16 -> 936*1664 (Inferred)
    switch(aspectRatio) {
        case '1:1': width = 1328; height = 1328; break;
        case '4:3': width = 1472; height = 1104; break;
        case '3:4': width = 1104; height = 1472; break;
        case '16:9': width = 1664; height = 936; break;
        case '9:16': width = 936; height = 1664; break;
        default: width = 1328; height = 1328;
    }

    const host = "visual.volcengineapi.com";
    const region = "cn-north-1";
    const service = "cv";
    
    // 1. Submit Task
    const submitPath = "/";
    const submitQuery = { Action: "CVSync2AsyncSubmitTask", Version: "2022-08-31" };
    const submitBody = JSON.stringify({
        req_key: "jimeng_t2i_v31", // Fixed key for Jimeng
        prompt: prompt,
        width,
        height,
        seed: -1,
        use_pre_llm: true // Enable prompt enhancement
    });

    const submitSign = await signVolcengineRequest({
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        service,
        region,
        method: "POST",
        path: submitPath,
        query: submitQuery,
        headers: { Host: host },
        body: submitBody
    });

    const submitUrl = `https://${host}${submitPath}?Action=CVSync2AsyncSubmitTask&Version=2022-08-31`;
    
    // Use Proxy Request to bypass CORS
    const submitRes = await (window as any).electronAPI.proxyRequest(submitUrl, {
        method: "POST",
        headers: submitSign.headers,
        body: submitBody
    });

    if (!submitRes.ok) {
        throw new Error(`Volcengine Submit Failed: ${submitRes.status} ${submitRes.data}`);
    }

    const submitData = JSON.parse(submitRes.data);
    if (submitData.code !== 10000 || !submitData.data?.task_id) {
        throw new Error(`Volcengine Task Error: ${submitData.message || 'Unknown error'}`);
    }

    const taskId = submitData.data.task_id;
    console.log(`[Volcengine] Task Submitted: ${taskId}`);

    // 2. Poll Result
    const pollPath = "/";
    const pollQuery = { Action: "CVSync2AsyncGetResult", Version: "2022-08-31" };
    const pollBody = JSON.stringify({
        req_key: "jimeng_t2i_v31",
        task_id: taskId
    });

    const maxRetries = 30; // 30 * 2s = 60s max wait
    for (let i = 0; i < maxRetries; i++) {
        await new Promise(r => setTimeout(r, 2000)); // Wait 2s

        const pollSign = await signVolcengineRequest({
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            service,
            region,
            method: "POST",
            path: pollPath,
            query: pollQuery,
            headers: { Host: host },
            body: pollBody
        });

        const pollUrl = `https://${host}${pollPath}?Action=CVSync2AsyncGetResult&Version=2022-08-31`;
        
        const pollRes = await (window as any).electronAPI.proxyRequest(pollUrl, {
            method: "POST",
            headers: pollSign.headers,
            body: pollBody
        });

        if (!pollRes.ok) continue; // Network error, retry

        const pollData = JSON.parse(pollRes.data);
        if (pollData.code !== 10000) {
             throw new Error(`Volcengine Poll Error: ${pollData.message}`);
        }

        const status = pollData.data.status;
        if (status === 'done') {
            const imageUrls = pollData.data.image_urls;
            const base64s = pollData.data.binary_data_base64;
            
            if (base64s && base64s.length > 0) {
                return `data:image/jpeg;base64,${base64s[0]}`;
            }
            if (imageUrls && imageUrls.length > 0) {
                // Fetch image through proxy
                try {
                    const imgRes = await (window as any).electronAPI.proxyRequest(imageUrls[0], { method: 'GET' });
                    if (imgRes.ok && imgRes.headers['x-is-binary']) {
                        return `data:image/jpeg;base64,${imgRes.data}`;
                    }
                    return imageUrls[0];
                } catch (e) {
                    console.warn("Failed to fetch image URL, returning URL directly", e);
                    return imageUrls[0];
                }
            }
            throw new Error("Volcengine returned 'done' but no images found.");
        } else if (status === 'fail' || status === 'error') {
            throw new Error("Volcengine Task Failed");
        }
        // status === 'in_queue' or 'generating', continue loop
    }

    throw new Error("Volcengine Task Timeout");
};

const callGeminiImage = async (apiKey: string, prompt: string, aspectRatio: string): Promise<string> => {
    const keyCandidates = await getGeminiApiKeyCandidates(apiKey);
    if (keyCandidates.length === 0) {
        throw new Error("Gemini 未配置可用 API Key（可在视觉引擎或全局 Google Gemini 中配置）");
    }
    let lastError: any = null;
    for (const key of keyCandidates) {
        try {
            const client = new GoogleGenAI({ apiKey: key });
            const response = await client.models.generateContent({
                model: 'gemini-2.5-flash-image',
                contents: { parts: [{ text: prompt }] },
                config: { imageConfig: { aspectRatio: aspectRatio as any } }
            });
            for (const part of response.candidates?.[0]?.content?.parts || []) {
                if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
            }
            throw new Error("Gemini 未返回图片数据");
        } catch (e: any) {
            lastError = e;
            if (isGeminiAuthError(String(e?.message || e || ''))) continue;
            throw e;
        }
    }
    const tail = String(lastError?.message || lastError || '未知错误');
    throw new Error(`Gemini 鉴权失败：已尝试 ${keyCandidates.length} 个 Key。最后错误: ${tail.slice(0, 240)}`);
};

const generateMockImage = (text: string) => {
    // Generate a placeholder SVG
    const svg = `
    <svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">
        <rect width="100%" height="100%" fill="#eee"/>
        <text x="50%" y="50%" font-family="Arial" font-size="24" fill="#666" text-anchor="middle" dominant-baseline="middle">
            Generated by ${text}
        </text>
    </svg>`;
    return `data:image/svg+xml;base64,${btoa(svg)}`;
};
