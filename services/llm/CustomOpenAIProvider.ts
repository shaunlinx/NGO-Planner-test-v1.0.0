
import { LLMProvider, LLMRequest, LLMResponse } from './types';

export interface CustomLLMConfig {
    id: string;
    name: string;
    provider: string; // 'DeepSeek' | 'OpenAI' | 'Moonshot' | etc.
    apiKey: string;
    baseUrl: string;
    modelId: string;
    isEnabled: boolean;
}

export class CustomOpenAIProvider implements LLMProvider {
    id: string;
    name: string;
    private config: CustomLLMConfig;

    constructor(config: CustomLLMConfig) {
        this.id = config.id;
        this.name = config.name;
        this.config = config;
    }

    async isReady(): Promise<boolean> {
        return !!this.config.baseUrl && !!this.config.modelId;
    }

    async generateContent(request: LLMRequest): Promise<LLMResponse> {
        let finalPrompt = request.prompt;
        if (request.jsonMode && !finalPrompt.toLowerCase().includes("json")) {
            finalPrompt += "\n\nCRITICAL: Return results in JSON.";
        }

        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (this.config.apiKey) headers['Authorization'] = `Bearer ${this.config.apiKey}`;

        const res = await fetch(`${this.config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: this.config.modelId,
                messages: [
                    ...(request.systemInstruction ? [{ role: 'system', content: request.systemInstruction }] : []),
                    { role: 'user', content: finalPrompt }
                ],
                response_format: request.jsonMode ? { type: 'json_object' } : undefined,
                temperature: request.temperature ?? 0.7,
                stream: false
            })
        });

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(`${this.name} Error: ${err.error?.message || res.statusText}`);
        }

        const data = await res.json();
        return { text: data.choices[0].message.content };
    }

    async *generateContentStream(request: LLMRequest): AsyncGenerator<string, void, unknown> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json'
        };
        if (this.config.apiKey) headers['Authorization'] = `Bearer ${this.config.apiKey}`;
        
        const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model: this.config.modelId,
                messages: [
                    ...(request.systemInstruction ? [{ role: 'system', content: request.systemInstruction }] : []),
                    { role: 'user', content: request.prompt }
                ],
                temperature: request.temperature ?? 0.7,
                stream: true
            })
        });

        if (!response.ok) throw new Error(`${this.name} Stream Error: ${response.statusText}`);
        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            
            buffer = lines.pop() || ""; 

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed === 'data: [DONE]') continue;
                if (trimmed.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(trimmed.slice(6));
                        const content = json.choices[0]?.delta?.content;
                        if (typeof content === 'string' && content) {
                            yield content;
                        } else if (Array.isArray(content)) {
                            const text = content.map((p: any) => typeof p?.text === 'string' ? p.text : '').join('');
                            if (text) yield text;
                        } else if (typeof json.choices?.[0]?.delta?.reasoning_content === 'string') {
                            const text = json.choices[0].delta.reasoning_content;
                            if (text) yield text;
                        }
                    } catch (e) {
                        // ignore parse errors for partial chunks
                    }
                }
            }
        }
    }
}
