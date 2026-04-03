I have a clear plan to address both the citation rendering issues and the rigid "academic" structure in Deep Thinking mode.

### 1. Fix Citation Rendering & Navigation
The current regex for splitting citations `(\[[\^]?\d+\])` is too strict and might miss citations if the LLM generates them slightly differently (e.g., `[ 1 ]` or combined `[1][2]`). Also, the click handler relies on `document.getElementById` which might fail if the ID format doesn't match exactly.

**Solution:**
-   **Robust Regex**: Update the regex in `KnowledgeBase.tsx` to be more flexible: `/(\[[\^]?\s*\d+\s*\])/g`.
-   **Scroll Logic**: Add a fallback scrolling mechanism. If `scrollIntoView` fails (element not found), log a warning or try a broader selector.
-   **Streaming Stability**: Ensure the streaming chunks don't break the Markdown parser mid-tag. (ReactMarkdown usually handles this, but I'll double-check the wrapper div).

### 2. Adaptive "Deep Thinking" Framework (Reflective Planning)
The current "Deep Thinking" mode hardcodes an "Academic Researcher" persona, forcing every answer into a "Background -> Analysis -> Conclusion" structure, even for creative or business tasks.

**Solution: "Reflective Intent Analysis"**
Before generating the framework, I will add a **Reflection Step**:
1.  **Analyze User Intent**: Ask the LLM: "What kind of task is this? (Academic Research, Business Report, Creative Writing, Fact Check, etc.)"
2.  **Dynamic Persona**: Based on the intent, switch the system instruction for the Planner Agent.
    -   *Business*: "You are a McKinsey Consultant. Structure: Executive Summary -> Market Analysis -> Strategy."
    -   *Creative*: "You are a Creative Writer. Structure: Concept -> Plot -> Characters."
    -   *Academic*: (Keep existing) "Background -> Methodology -> Findings."
3.  **Adaptive Prompting**: Pass this "Intent Context" to the `generateAnswerFramework` function.

**Implementation Plan:**
1.  **Modify `geminiService.ts`**:
    -   Add `analyzeQueryIntent` function to classify the task type.
    -   Update `generateAnswerFramework` to accept `intentType` and adjust the system prompt dynamically.
2.  **Modify `KnowledgeBase.tsx`**:
    -   Update the regex for citation rendering.
    -   Update the "Deep Thinking" orchestration loop:
        -   Step 0: `updateSession` -> "Analyzing Intent..."
        -   Call `analyzeQueryIntent`.
        -   Step 1: Call `generateAnswerFramework` with the detected intent.

This will make the "Deep Thinking" mode truly intelligent and adaptive, not just a rigid template filler.