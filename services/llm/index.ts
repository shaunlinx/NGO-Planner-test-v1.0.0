
import { LLMProvider, LLMRequest, LLMResponse } from './types';
import { GeminiProvider } from './GeminiProvider';
import { DeepSeekProvider } from './DeepSeekProvider';
import { CustomOpenAIProvider, CustomLLMConfig } from './CustomOpenAIProvider';

class SmartProvider implements LLMProvider {
    id = 'Smart';
    name = 'Smart Auto-Switch';
    
    private google: GeminiProvider;
    private deepseek: DeepSeekProvider;
    private custom: CustomOpenAIProvider | null = null;

    constructor() {
        this.google = new GeminiProvider();
        this.deepseek = new DeepSeekProvider();
        this.custom = this.getCustomProvider();
    }

    private normalizeChunk(chunk: any): string {
        if (typeof chunk === 'string') return chunk;
        if (chunk === null || chunk === undefined) return '';
        if (chunk instanceof Uint8Array) {
            try { return new TextDecoder('utf-8').decode(chunk); } catch (e) { return ''; }
        }
        if (Array.isArray(chunk)) {
            return chunk.map((p: any) => this.normalizeChunk(p)).join('');
        }
        if (typeof chunk === 'object') {
            if (typeof chunk.content === 'string') return chunk.content;
            if (typeof chunk.text === 'string') return chunk.text;
            if (Array.isArray((chunk as any).content)) return (chunk as any).content.map((p: any) => this.normalizeChunk(p)).join('');
        }
        return String(chunk);
    }

    private getCustomProvider(): CustomOpenAIProvider | null {
        try {
            const selectedId = localStorage.getItem('user_primary_custom_llm_id') || '';
            if (!selectedId) return null;
            const list: CustomLLMConfig[] = JSON.parse(localStorage.getItem('custom_llm_configs') || '[]');
            const cfg = list.find(c => c.id === selectedId);
            if (!cfg || !cfg.baseUrl || !cfg.modelId) return null;
            return new CustomOpenAIProvider(cfg);
        } catch {
            return null;
        }
    }

    async isReady(): Promise<boolean> {
        // Refresh custom provider in case of recent changes
        this.custom = this.getCustomProvider();
        const customStatus = localStorage.getItem('user_api_status_custom') || 'paused';
        const customReady = this.custom && customStatus === 'active';
        return (await this.deepseek.isReady()) || (await this.google.isReady()) || !!customReady;
    }

    async generateContent(request: LLMRequest): Promise<LLMResponse> {
        const dsStatus = localStorage.getItem('user_api_status_deepseek') || 'active';
        const gStatus = localStorage.getItem('user_api_status_google') || 'active';
        const cStatus = localStorage.getItem('user_api_status_custom') || 'paused';
        this.custom = this.getCustomProvider();

        // 1. Try DeepSeek First
        if (dsStatus === 'active' && await this.deepseek.isReady()) {
            try {
                const reqDS: LLMRequest = {
                    ...request,
                    model: (request.model && request.model.toLowerCase().includes('deepseek')) ? request.model : undefined
                };
                return await this.deepseek.generateContent(reqDS);
            } catch (e: any) {
                console.warn("[SmartProvider] DeepSeek failed, attempting fallback to Gemini...", e);
                // Fallback only if Gemini is active
                if (gStatus !== 'active' || !(await this.google.isReady())) {
                    throw e; // Re-throw if fallback not possible
                }
            }
        }

        // 2. Try Gemini (Fallback or Primary if DeepSeek disabled)
        if (gStatus === 'active' && await this.google.isReady()) {
            const reqG: LLMRequest = {
                ...request,
                model: (request.model && request.model.toLowerCase().startsWith('gemini')) ? request.model : undefined
            };
            return await this.google.generateContent(reqG);
        }

        // 3. Try Custom (User-selected primary)
        if (cStatus === 'active' && this.custom) {
            return await this.custom.generateContent(request);
        }

        throw new Error("No active and configured AI provider found. Please check your API settings.");
    }

    async *generateContentStream(request: LLMRequest): AsyncGenerator<string, void, unknown> {
        const dsStatus = localStorage.getItem('user_api_status_deepseek') || 'active';
        const gStatus = localStorage.getItem('user_api_status_google') || 'active';
        const cStatus = localStorage.getItem('user_api_status_custom') || 'paused';
        this.custom = this.getCustomProvider();

        // 1. Try DeepSeek Stream
        if (dsStatus === 'active' && await this.deepseek.isReady()) {
            try {
                // We need to catch errors during iteration, which is tricky with generators.
                // However, usually the initial connection throws immediately.
                const reqDS: LLMRequest = {
                    ...request,
                    model: (request.model && request.model.toLowerCase().includes('deepseek')) ? request.model : undefined
                };
                const stream = this.deepseek.generateContentStream(reqDS);
                for await (const chunk of stream) {
                    const txt = this.normalizeChunk(chunk);
                    if (txt) yield txt;
                }
                return;
            } catch (e) {
                console.warn("[SmartProvider] DeepSeek stream failed, attempting fallback...", e);
                if (gStatus !== 'active' || !(await this.google.isReady())) {
                    throw e;
                }
            }
        }

        // 2. Try Gemini Stream
        if (gStatus === 'active' && await this.google.isReady()) {
            const reqG: LLMRequest = {
                ...request,
                model: (request.model && request.model.toLowerCase().startsWith('gemini')) ? request.model : undefined
            };
            const stream = this.google.generateContentStream(reqG);
            for await (const chunk of stream) {
                const txt = this.normalizeChunk(chunk);
                if (txt) yield txt;
            }
            return;
        }

        // 3. Try Custom Stream
        if (cStatus === 'active' && this.custom && (this.custom as any).generateContentStream) {
            const stream = (this.custom as any).generateContentStream(request);
            for await (const chunk of stream) {
                const txt = this.normalizeChunk(chunk);
                if (txt) yield txt;
            }
            return;
        }

        throw new Error("No active and configured AI provider found. Please check your API settings.");
    }
}

class LLMFactory {
    private smartProvider = new SmartProvider();

    getProvider(providerName?: string): LLMProvider {
        // We ignore the requested providerName and always return the SmartProvider
        // which handles the logic internally based on configuration.
        return this.smartProvider;
    }
}

export const llmFactory = new LLMFactory();
