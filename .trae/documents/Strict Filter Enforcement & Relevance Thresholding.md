**Analysis**

1.  **Unchecked Materials Being Used:**
    *   **Root Cause Investigation:** The current `_buildSourceFilter` logic in `vectorStore.js` generates SQL conditions (`source = '...' OR source LIKE '...%'`). However, the `ragEngine.js` has a "Hybrid Search" mechanism that combines Vector Search and Keyword Search. If the keyword search (using `LIKE %keyword%`) returns results that *accidentally* bypass the source filter due to logic errors or if the `filterSources` array is empty/null when it shouldn't be, unchecked files appear.
    *   **Crucial Find:** In `ragEngine.js`, the `_resolvePathIntent` method attempts to "infer" folders from natural language (e.g., "in the reports folder"). If this inference triggers, it *overrides* or *supplements* the user's manual checkboxes. If the user didn't check anything but asked a question, the system might be auto-selecting folders based on NLP intent, which confuses the user who expects strict adherence to checkboxes.
    *   **Fix Plan:**
        *   **Strict Mode:** Enforce that if `activeFiles` (checkboxes) are provided by the UI, they act as a **Hard Constraint**. The NLP intent should only *narrow* the search within the checked files, never *expand* it beyond them unless explicitly requested (e.g., "Search everything").
        *   **Logic Update:** In `ragEngine.query`, intersect the `filterSources` (checkboxes) with `inferredFolder` instead of replacing them. If checkboxes are present, they are the "Universe".

2.  **Citation Quantity & Quality Logic:**
    *   **Current Logic:**
        *   **Quantity:** Hardcoded `topK` parameter (default 15).
        *   **Quality:**
            1.  **Hybrid Retrieval:** Vector Similarity (Semantic) + Keyword Match (Exact).
            2.  **Reranking:** `BGE-Reranker` scores the candidates.
            3.  **Threshold:** No strict threshold cut-off currently; it just takes the top K sorted results.
    *   **Best Practice (State of the Art):**
        *   **Dynamic K:** Don't return fixed 15 chunks. Return "all chunks with Relevance > 70%".
        *   **Context Window Optimization:** Pack as many high-quality chunks as fit in the LLM's context window (e.g., 8k tokens), rather than a fixed number of chunks.
        *   **Diversity:** Ensure chunks aren't all from the same document (unless necessary).
    *   **Optimization Plan:**
        *   **Score Threshold:** Introduce a `minScore` parameter (e.g., 0.4 after Sigmoid normalization). Discard chunks below this relevance.
        *   **Adaptive K:** Fetch more (e.g., 30), rerank, filter by threshold, then take top N that fit token budget (or simple max count like 10 highly relevant ones).
        *   **Explanation to User:** Explain that we currently use a "Top-N" approach but will move to a "Threshold-based" approach to ensure only high-quality context is used.

**Implementation Plan**

1.  **Fix "Unchecked Files" Leakage:**
    *   Modify `electron/services/rag/ragEngine.js`.
    *   In `query` method, verify how `filterSources` is handled.
    *   **Constraint:** If `activeFiles` (passed from UI) is non-empty, ensure `filterSources` respects it. The `_resolvePathIntent` should only operate *within* the scope of `activeFiles`.

2.  **Optimize Citation Quality (Thresholding):**
    *   Modify `electron/services/rag/ragEngine.js`.
    *   Add a `minScore` filter after Reranking.
    *   Default `minScore` to 0.35 (adjustable).
    *   Filter `finalResults` to exclude low-confidence items.

3.  **Documentation/Explanation:**
    *   Explain the "Hard Constraint" logic update.
    *   Explain the "Relevance Threshold" introduction.

**File to Edit:** `electron/services/rag/ragEngine.js`
