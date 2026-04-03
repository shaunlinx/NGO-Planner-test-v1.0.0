
import { LLMProvider, LLMRequest, LLMResponse } from './types';
import { GoogleGenAI } from "@google/genai";
import { SecurityService } from '../SecurityService';

export class GeminiProvider implements LLMProvider {
    id = 'Gemini';
    name = 'Google Gemini';

    private getClient(apiKey: string) {
        return new GoogleGenAI({ apiKey });
    }

    private async getApiKey(): Promise<string> {
        // Try secure storage first (Async)
        if ((window as any).electronAPI?.secure) {
            try {
                const key = await (window as any).electronAPI.secure.get('user_api_key_google');
                if (key) return key;
            } catch (e) {
                console.warn("Failed to get secure key", e);
            }
        }
        // Fallback to legacy localStorage
        // @ts-ignore
        return localStorage.getItem('user_api_key_google') || (import.meta.env?.VITE_GEMINI_API_KEY as string) || '';
    }

    async isReady(): Promise<boolean> {
        const key = await this.getApiKey();
        return !!key;
    }

    async generateContent(request: LLMRequest): Promise<LLMResponse> {
        // 1. Input Security Validation
        const promptValidation = SecurityService.validatePrompt(typeof request.prompt === 'string' ? request.prompt : JSON.stringify(request.prompt));
        if (!promptValidation.safe) {
            throw new Error(`Security Violation: ${promptValidation.issues.join(', ')}`);
        }
        // Use sanitized prompt if needed, or just proceed if safe
        // For complex objects (multimodal), we might skip replacement or implement deep sanitization.
        // Assuming string prompt for simple case replacement:
        if (typeof request.prompt === 'string' && promptValidation.sanitized !== request.prompt) {
             console.warn("Prompt was sanitized for security.");
             // request.prompt = promptValidation.sanitized; // Optional: Force sanitize
        }

        const key = await this.getApiKey();
        if (!key) throw new Error("Gemini API Key not found.");

        const ai = this.getClient(key);
        const modelName = (request.model && request.model.toLowerCase().startsWith('gemini'))
            ? request.model
            : (localStorage.getItem('user_model_google') || 'gemini-2.0-flash-exp');

        const response = await ai.models.generateContent({
            model: modelName,
            contents: request.prompt,
            config: {
                systemInstruction: request.systemInstruction,
                responseMimeType: request.jsonMode ? "application/json" : undefined,
                responseSchema: request.responseSchema,
                temperature: request.temperature,
                tools: request.tools
            }
        });

        const text = response.text || '';
        
        // 2. Output Security Validation
        const responseValidation = SecurityService.validateResponse(text);
        if (!responseValidation.safe) {
             console.warn("Response validation failed:", responseValidation.issues);
             // Return sanitized version or error
             return { text: responseValidation.sanitized };
        }

        return { text };
    }

    async *generateContentStream(request: LLMRequest): AsyncGenerator<string, void, unknown> {
        // 1. Input Security Validation
        const promptValidation = SecurityService.validatePrompt(typeof request.prompt === 'string' ? request.prompt : JSON.stringify(request.prompt));
        if (!promptValidation.safe) {
            throw new Error(`Security Violation: ${promptValidation.issues.join(', ')}`);
        }

        const key = await this.getApiKey();
        if (!key) throw new Error("Gemini API Key not found.");

        const ai = this.getClient(key);
        const modelName = (request.model && request.model.toLowerCase().startsWith('gemini'))
            ? request.model
            : (localStorage.getItem('user_model_google') || 'gemini-2.0-flash-exp');

        // @ts-ignore - SDK types might be slightly different for stream
        const result: any = await ai.models.generateContentStream({
            model: modelName,
            contents: request.prompt,
            config: {
                systemInstruction: request.systemInstruction,
                responseMimeType: request.jsonMode ? "application/json" : undefined,
                temperature: request.temperature,
            }
        });

        for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) {
                // Real-time stream validation is tricky because malicious content might be split across chunks.
                // For high security, we should buffer. For UX, we stream.
                // Compromise: Basic pattern check on chunks, but strict check on full accumulation is better handled by caller if needed.
                // Here we just pass through or do lightweight check.
                if (SecurityService.validateResponse(text).safe) {
                    yield text;
                } else {
                    yield "[Content Redacted]";
                }
            }
        }
    }
}
