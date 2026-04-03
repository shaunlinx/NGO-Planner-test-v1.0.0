import { ComparisonResult, MultiExploreResponse } from './types';
import { CustomLLMConfig } from '../../../services/llm/CustomOpenAIProvider';
import { createProviderInstance, ProviderOption } from './MultiExploreService';

export const selectPrimaryProviderId = (customLLMs: CustomLLMConfig[], available: ProviderOption[]): string | null => {
    const status = localStorage.getItem('user_api_status_custom') || 'paused';
    const primaryId = localStorage.getItem('user_primary_custom_llm_id') || '';
    if (status === 'active' && primaryId) return 'system-custom';
    const dsStatus = localStorage.getItem('user_api_status_deepseek') || 'active';
    const dsKey = localStorage.getItem('user_api_key_deepseek');
    if (dsStatus === 'active' && dsKey) return 'system-deepseek';
    const gStatus = localStorage.getItem('user_api_status_google') || 'active';
    const gKey = localStorage.getItem('user_api_key_google');
    if (gStatus === 'active' && gKey) return 'system-gemini';
    if (available.length > 0) return available[0].id;
    return null;
};

export const generateComparison = async (
    customLLMs: CustomLLMConfig[],
    availableProviders: ProviderOption[],
    userQuery: string,
    responses: MultiExploreResponse[],
    collectedTexts: string[] = []
): Promise<ComparisonResult> => {
    const primaryId = selectPrimaryProviderId(customLLMs, availableProviders);
    if (!primaryId) throw new Error('未找到可用的主力 LLM');
    const provider = createProviderInstance(primaryId, customLLMs);
    if (!provider) throw new Error('主力 LLM 初始化失败');

    const systemInstruction = [
        '你是一个擅长对多模型回答进行严谨比较分析的助手。',
        '输出必须为 JSON，且严格遵守字段结构，不得包含任何额外文本。',
        '请识别核心论点、共识与分歧、潜在矛盾，并构建模型-要点的关系矩阵。',
        '若无法判断矛盾，请将矩阵值标为 0 或 1，而非编造 2。'
    ].join('\n');

    const modelsBlock = responses.map((r, idx) => {
        const tag = `Model ${String.fromCharCode(65 + idx)}`;
        return `### ${tag}\n[id]: ${r.providerId}\n[name]: ${r.providerName}\n[content]:\n${r.content}`;
    }).join('\n\n');

    const collectedBlock = collectedTexts.length > 0 
        ? collectedTexts.map(t => `- ${t}`).join('\n')
        : '';

    const prompt = [
        '【用户问题】',
        userQuery,
        '【多模型回答】',
        modelsBlock,
        '【用户特别关注点（可选）】',
        collectedBlock || '（无）',
        '【输出格式要求】',
        JSON.stringify({
            models: [{ providerId: 'string', providerName: 'string', summary: 'string', keywords: ['string'] }],
            consensus: [{ text: 'string', support: ['providerId'] }],
            differences: [{ topic: 'string', statements: [{ providerId: 'string', text: 'string' }] }],
            contradictions: [{ a: { providerId: 'string', text: 'string' }, b: { providerId: 'string', text: 'string' }, severity: 'low|medium|high' }],
            matrix: { points: [{ id: 'string', text: 'string' }], values: [[0]] }
        })
    ].join('\n\n');

    const res = await provider.generateContent({ 
        prompt, 
        temperature: 0.2, 
        systemInstruction, 
        jsonMode: true 
    } as any);

    const text = res.text || '';
    const parsed = JSON.parse(text) as ComparisonResult;
    return parsed;
};

