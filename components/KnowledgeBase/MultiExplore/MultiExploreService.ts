
import { CustomLLMConfig, CustomOpenAIProvider } from '../../../services/llm/CustomOpenAIProvider';
import { DeepSeekProvider } from '../../../services/llm/DeepSeekProvider';
import { GeminiProvider } from '../../../services/llm/GeminiProvider';
import { LLMRequest } from '../../../services/llm/types';

export interface ProviderOption {
    id: string;
    name: string;
    modelId: string;
    isSystem: boolean;
}

export const getAvailableProviders = (customLLMs: CustomLLMConfig[]): ProviderOption[] => {
    const options: ProviderOption[] = [];
    
    // System DeepSeek
    const dsStatus = localStorage.getItem('user_api_status_deepseek') || 'active';
    const dsKey = localStorage.getItem('user_api_key_deepseek');
    if (dsStatus === 'active' && dsKey) {
        const dsModel = localStorage.getItem('user_model_deepseek') || 'deepseek-chat';
        options.push({ id: 'system-deepseek', name: 'DeepSeek (System)', modelId: dsModel, isSystem: true });
    }

    // System Gemini
    const gStatus = localStorage.getItem('user_api_status_google') || 'active';
    const gKey = localStorage.getItem('user_api_key_google');
    if (gStatus === 'active' && gKey) {
        const gModel = localStorage.getItem('user_model_google') || 'gemini-pro';
        options.push({ id: 'system-gemini', name: 'Gemini (System)', modelId: gModel, isSystem: true });
    }
    
    // System Custom (User-selected)
    const cStatus = localStorage.getItem('user_api_status_custom') || 'paused';
    const selectedId = localStorage.getItem('user_primary_custom_llm_id') || '';
    if (cStatus === 'active' && selectedId) {
        const cfg = customLLMs.find(c => c.id === selectedId);
        if (cfg && cfg.apiKey) {
            options.push({ id: 'system-custom', name: `${cfg.name} (System)`, modelId: cfg.modelId, isSystem: true });
        }
    }

    // Custom LLMs
    customLLMs.forEach(c => {
        if (c.isEnabled && c.apiKey) {
            options.push({
                id: c.id,
                name: c.name,
                modelId: c.modelId,
                isSystem: false
            });
        }
    });

    return options;
};

export const createProviderInstance = (id: string, customLLMs: CustomLLMConfig[]) => {
    if (id === 'system-deepseek') return new DeepSeekProvider();
    if (id === 'system-gemini') return new GeminiProvider();
    if (id === 'system-custom') {
        const selectedId = localStorage.getItem('user_primary_custom_llm_id') || '';
        const cfg = customLLMs.find(c => c.id === selectedId);
        if (cfg) return new CustomOpenAIProvider(cfg);
        return null;
    }
    
    const config = customLLMs.find(c => c.id === id);
    if (config) return new CustomOpenAIProvider(config);
    
    return null;
};
