I will upgrade the "Deep Thinking" mode from a template-based approach to a fully **Generative Agentic RAG** system.

### Core Architecture Changes

#### 1. From "Fixed Roles" to "Dynamic Persona" (Planner Upgrade)
*   **Current**: Hardcoded switch-case (Academic/Business/Creative/Fact).
*   **New**: **Generative Planner**. The AI will analyze the user's specific question (e.g., "How to bake a cake?" vs "Analyze Q3 financial report") and **self-define** the most appropriate persona (e.g., "Michelin Pastry Chef" or "Senior Financial Analyst").
*   **Benefit**: The research framework will be custom-tailored to the exact nuance of the question, not forced into a generic template.

#### 2. "Context Organization" Step (Retrieval Upgrade)
*   **Current**: Raw chunks are fed directly to the LLM.
*   **New**: **In-Context Organization**. Before the final answer generation, the system will instruct the model to:
    1.  **Review** all retrieved chunks (`[1], [2], [3]...`).
    2.  **Filter** irrelevant noise.
    3.  **Group** related evidence by logical themes.
    4.  **Plan** the integration strategy.
*   This directly addresses your request to "organize recalled slices before integration."

#### 3. "Meta-Cognition" Loop (Synthesis Upgrade)
*   **Current**: Direct generation.
*   **New**: **Self-Reflection Protocol**. The synthesis prompt will be updated to include a "Thinking Process":
    *   "What is the user's true intent?"
    *   "Is the retrieved info sufficient?"
    *   "What structure best serves this answer?"
    *   *Then* generate the content.

### Implementation Steps

1.  **Refactor `generateAnswerFramework` in `geminiService.ts`**:
    *   Remove the `switch (intent)` logic.
    *   Implement a new prompt that generates `{ targetPersona, researchPlan }` dynamically.
2.  **Update `generateDeepSynthesisStream` in `geminiService.ts`**:
    *   Inject the `targetPersona` into the system instruction.
    *   Add the "Context Organization" and "Self-Reflection" instructions to the synthesis prompt.
3.  **Frontend Update in `KnowledgeBase.tsx`**:
    *   Display the "Dynamic Persona" (e.g., "Thinking as: Senior Architect...") to give you visibility into the AI's decision-making.

This approach balances "Intelligence" with "Speed" by avoiding excessive round-trip API calls, using the LLM's powerful reasoning capabilities within the existing steps.