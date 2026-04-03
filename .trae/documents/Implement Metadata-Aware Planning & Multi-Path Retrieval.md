I have analyzed your request and the current system architecture. The issue is that the **Planner Agent (Intent Recognition)** is currently "blind" to the knowledge base's actual content structure. It tries to plan a research strategy based solely on the user's question, without knowing what documents are actually available.

I will implement a **Metadata-Aware Multi-Path Retrieval** strategy as you suggested.

### Core Architecture Upgrade

#### 1. Metadata-Aware Planning (Knowledge Injection)
*   **Current**: `generateAnswerFramework(query)` -> Planner guesses what to search.
*   **New**: `generateAnswerFramework(query, fileMetadata)`
    *   I will inject a **"Knowledge Map"** (filenames, folders, tags) of the currently selected files into the Planner's prompt.
    *   **Benefit**: The AI will know *exactly* what resources are available (e.g., "Oh, the user has 'Q3_Financial_Report.pdf', so I should act as a Financial Analyst and specifically query for revenue figures").

#### 2. Multi-Path Parallel Retrieval (Robustness)
*   **Current**: Single linear path: Plan -> Search -> Synthesize. If the Plan misses the mark, the Search fails.
*   **New**: **Concurrent Hypothesis Testing**.
    *   The Planner will generate **multiple** distinct search directions (e.g., "Semantic Search", "Keyword Match", "Date-based Lookup").
    *   The system will execute these searches **in parallel** (locally, without extra API cost for vector search).
    *   **Ranking**: A new `rankSearchResults` function will evaluate the "Recall Density" (how many high-score chunks were found) to select the winning path.

### Implementation Plan

1.  **Update `geminiService.ts`**:
    *   Modify `generateAnswerFramework` to accept `fileMetadata` (list of filenames/paths).
    *   Update the System Prompt to use this metadata for better Role Definition and Query Generation.

2.  **Refactor `KnowledgeBase.tsx`**:
    *   **Step 1**: Extract metadata from `activeFiles` (filenames, folders).
    *   **Step 2**: Pass this metadata to the Planner.
    *   **Step 3 (Multi-Path)**: Instead of just searching for the generated queries, potentially augment them with broad keyword searches if the initial plan seems too narrow. (Note: For this iteration, I will focus on making the *single* plan much smarter via metadata injection first, as that's the highest ROI fix. True multi-path branching is a larger architectural change, so I will implement a **"Self-Correcting"** path where we try the smart query, and if it fails, fallback to broad search—which I already partially added in the previous turn, but now I'll make the Planner *aware* of it).

3.  **Optimization**:
    *   Ensure we don't dump *all* file content into the prompt. Only filenames and folder structures will be sent to keep tokens low.

This approach directly addresses your point: "Don't just throw indexes at the LLM, but give it context (metadata) to plan better."