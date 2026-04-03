
import { LLMProvider, LLMRequest, LLMResponse } from './types';

export class DeepSeekProvider implements LLMProvider {
    id = 'DeepSeek';
    name = 'DeepSeek R1/V3';

    private getBaseUrl(): string {
        return localStorage.getItem('user_base_url') || 'https://api.deepseek.com';
    }

    private async getApiKey(): Promise<string> {
        // Try secure storage first
        if ((window as any).electronAPI?.secure) {
            try {
                const key = await (window as any).electronAPI.secure.get('user_api_key_deepseek');
                if (key) return key;
            } catch (e) {}
        }
        return localStorage.getItem('user_api_key_deepseek') || '';
    }

    async isReady(): Promise<boolean> {
        const key = await this.getApiKey();
        return !!key;
    }

    async generateContent(request: LLMRequest): Promise<LLMResponse> {
        const key = await this.getApiKey();
        if (!key) throw new Error("DeepSeek API Key not found.");

        const baseUrl = this.getBaseUrl();
        
        let finalPrompt = request.prompt;
        if (request.jsonMode && !finalPrompt.toLowerCase().includes("json")) {
            finalPrompt += "\n\nCRITICAL: Return results in JSON.";
        }

        const dsModel = (request.model && request.model.toLowerCase().includes('deepseek'))
            ? request.model
            : (localStorage.getItem('user_model_deepseek') || 'deepseek-chat');
        const res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`
            },
            body: JSON.stringify({
                model: dsModel,
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
            throw new Error(`DeepSeek API Error: ${err.error?.message || res.statusText}`);
        }

        const data = await res.json();
        return { text: data.choices[0].message.content };
    }

    async *generateContentStream(request: LLMRequest): AsyncGenerator<string, void, unknown> {
        const key = await this.getApiKey();
        if (!key) throw new Error("DeepSeek API Key not found.");

        const baseUrl = this.getBaseUrl();
        
        const dsModel = (request.model && request.model.toLowerCase().includes('deepseek'))
            ? request.model
            : (localStorage.getItem('user_model_deepseek') || 'deepseek-chat');
        const response = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${key}`
            },
            body: JSON.stringify({
                model: dsModel,
                messages: [
                    ...(request.systemInstruction ? [{ role: 'system', content: request.systemInstruction }] : []),
                    { role: 'user', content: request.prompt }
                ],
                temperature: request.temperature ?? 0.7,
                stream: true
            })
        });

        if (!response.ok) throw new Error(`DeepSeek Stream Error: ${response.statusText}`);
        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder("utf-8");
        let buffer = "";

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            
            // Process all complete lines
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
                        console.warn("DeepSeek stream parse error", e);
                    }
                }
            }
        }
    }
}
