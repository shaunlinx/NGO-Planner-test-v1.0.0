
export interface LLMRequest {
    prompt: string;
    systemInstruction?: string;
    model?: string;
    jsonMode?: boolean;
    responseSchema?: any;
    temperature?: number;
    tools?: any[]; // For future tool use
}

export interface LLMResponse {
    text: string;
    usage?: {
        promptTokens: number;
        completionTokens: number;
    };
}

export interface LLMProvider {
    id: string;
    name: string;
    
    /**
     * Check if the provider is configured and ready
     */
    isReady(): Promise<boolean>;

    /**
     * Generate content (unary)
     */
    generateContent(request: LLMRequest): Promise<LLMResponse>;

    /**
     * Generate content stream (streaming)
     * Returns an async generator yielding chunks of text
     */
    generateContentStream(request: LLMRequest): AsyncGenerator<string, void, unknown>;
}
