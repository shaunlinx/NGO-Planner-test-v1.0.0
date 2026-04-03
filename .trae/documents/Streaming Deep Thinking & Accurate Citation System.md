I have analyzed the current codebase and your requirements. I will implement a unified streaming architecture that supports both Google Gemini and OpenAI-compatible providers (like DeepSeek).

### 1. Unified Streaming Architecture (Unified Streaming Architecture)
I will refactor the `llm` provider system to support a unified `generateStream` interface across different providers.

-   **Gemini Provider**: Leverage the existing `generateContentStream` from the Google GenAI SDK.
-   **OpenAI-Compatible Provider (DeepSeek)**: Implement a Server-Sent Events (SSE) parser to handle standard OpenAI-style streaming responses.
-   **Abstraction Layer**: The `SmartProvider` in `services/llm/index.ts` (implied or to be created if missing, based on `llmFactory` usage) will automatically route the streaming request to the active provider.

### 2. Implementation Details (Implementation Details)
-   **`services/llm/types.ts`**: Add `generateContentStream` to the `LLMProvider` interface.
-   **`services/llm/GeminiProvider.ts`**: Ensure `generateContentStream` is correctly implemented (it seems partially there, will verify/refine).
-   **`services/llm/DeepSeekProvider.ts`**: Ensure `generateContentStream` implements the SSE parsing logic (it seems present, will verify/refine).
-   **`services/geminiService.ts`**:
    -   Export `callAIStream` which wraps the provider's streaming method.
    -   Export `generateDeepSynthesisStream` which uses `callAIStream` for the "Deep Thinking" synthesis step.

### 3. Frontend Integration (Frontend Integration)
-   **`components/KnowledgeBase.tsx`**:
    -   Update the "Deep Thinking" logic to consume the async generator from `generateDeepSynthesisStream`.
    -   Implement a loop to append chunks to the UI state in real-time.
    -   Maintain the "Global Indexing" strategy: pre-assign citation indices to chunks *before* starting the stream, so the LLM generates accurate `[1]`, `[2]` markers that match the UI.

### 4. Citation Integrity (Citation Integrity)
-   The "Global Indexing" logic will be performed in the frontend (`KnowledgeBase.tsx`) or a helper in `geminiService.ts` *before* the stream starts. The prompt sent to the LLM will contain the indexed context, ensuring the streaming response references these fixed indices.

### Execution Plan
1.  **Refactor `services/llm/types.ts`**: Verify `generateContentStream` signature.
2.  **Update `services/llm/DeepSeekProvider.ts`**: Confirm SSE streaming logic is robust.
3.  **Update `services/llm/GeminiProvider.ts`**: Confirm streaming logic.
4.  **Update `services/llm/index.ts`**: Ensure `SmartProvider` delegates streaming correctly.
5.  **Update `services/geminiService.ts`**: Add `callAIStream` and `generateDeepSynthesisStream`.
6.  **Update `components/KnowledgeBase.tsx`**: Implement the streaming consumption loop for the "Deep Thinking" mode.

I will start by creating the todo list.