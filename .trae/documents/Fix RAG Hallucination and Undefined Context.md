I have analyzed your feedback and the RAG system's output. The issue you encountered is a **"Citation Hallucination"** problem where the AI generated a report with citations `[1]-[68]` despite the actual retrieved context being empty or insufficient ("undefined").

### Root Cause Analysis
1.  **"Undefined" Context**: The user explicitly mentioned "missing content (displayed as 'undefined')". This strongly suggests that the retrieval step returned empty or malformed data, likely due to a failure in the retrieval API or context construction loop.
2.  **AI Hallucination**: When the AI (acting as a "Regional Economic Expert") received empty context but was forced to generate a "comprehensive report", it **hallucinated** a plausible-sounding analysis based on its internal training data (knowledge about Fengze and Jiaocheng districts) and invented citation numbers `[1]-[68]` to satisfy the "Strict Citation" rule.
3.  **Missing "No Context" Guardrail**: The current prompt instructs the AI to "Strictly cite [x]", but does not explicitly instruct it to **"STOP and report failure"** if the provided context is empty.

### Proposed Solution (Plan)

#### 1. Fix Retrieval & Context Construction (Frontend)
*   **Action**: In `KnowledgeBase.tsx`, add a rigorous check before the synthesis step.
*   **Logic**:
    *   Inspect `sectionContexts` and `allChunks`.
    *   If `allChunks` is empty, **abort** the synthesis and display a clear error message: "No relevant documents found. Please check your knowledge base or query."
    *   Ensure that the `fullContext` string passed to the LLM is never "undefined" or empty.

#### 2. Strengthen System Prompt (Backend)
*   **Action**: Update `generateDeepSynthesisStream` in `geminiService.ts`.
*   **Logic**: Add a "Negative Constraint":
    > "CRITICAL: If the provided Reference Materials are empty or insufficient, you MUST explicitly state 'Insufficient data' and REFUSE to generate a report. DO NOT invent citations or analysis."

#### 3. Debugging Support
*   **Action**: Add console logs in `KnowledgeBase.tsx` to print the exact `framework` and `searchResults` objects to verify if the retrieval API is actually returning data.

This plan addresses the immediate "undefined" error and prevents future hallucinations by enforcing strict data validation.