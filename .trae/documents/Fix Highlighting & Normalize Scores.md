**Analysis of Issues**

1.  **View Original Highlighting Failure:**
    *   **Root Cause:** The current implementation uses simple string splitting: `previewFile.content.split(previewFile.highlight)`. This fails if the text in the preview window (read freshly from disk) differs even slightly from the text in the chunk (stored in DB/RAG output). Common causes are newline differences (`\r\n` vs `\n`), extra spaces, or markdown stripping during ingestion.
    *   **Proposed Fix:** Implement a robust "fuzzy find" mechanism in the frontend. We will normalize both the content and the highlight text (remove all whitespace) to find the start/end indices, and then map those indices back to the original content to wrap the correct span in a `<mark>` tag.

2.  **Relevance Score Calculation:**
    *   **Current Method:**
        *   **Hybrid Retrieval:** Combines Vector Search (Cosine Similarity via LanceDB) and Keyword Search (SQL LIKE).
        *   **Reranking:** Uses `Xenova/bge-reranker-base` (Cross-Encoder). The raw score from this model (logit) is used directly.
        *   **User Intervention:** Multiplied by a user-defined `weightFactor`.
        *   **Formula:** `Final Score = Reranker_Logit * User_Weight`.
    *   **Problem:** The raw logit from BGE Reranker is not a percentage (0-100%). It can be negative or greater than 1. Displaying it as a percentage (e.g., `score * 100`) leads to confusing results (e.g., negative percentages or >100%).
    *   **Proposed Improvement:**
        *   **Sigmoid Normalization:** Apply a Sigmoid function to the Reranker logit to map it to a 0-1 probability range. `P = 1 / (1 + exp(-score))`.
        *   **Industry Standard:** This is the standard way to convert logits to probabilities for relevance classification.
        *   **UI Update:** Display the normalized score as a percentage.

**Plan**

1.  **Modify `components/KnowledgeBase.tsx`:**
    *   Replace the `split` based highlighting with a new `renderHighlightedContent` function.
    *   This function will:
        *   Normalize target string (remove whitespace).
        *   Find the target in the normalized content.
        *   Map normalized indices back to original indices.
        *   Highlight the substring.
        *   Scroll the highlighted element into view automatically (`scrollIntoView`).

2.  **Modify `electron/services/rag/ragEngine.js`:**
    *   Update `query` method to normalize the Reranker score.
    *   Implement Sigmoid function: `1 / (1 + Math.exp(-output.score))`.
    *   Ensure the score sent to frontend is between 0 and 1.

3.  **Explanation to User:**
    *   Explain the shift from "Raw Logits" to "Normalized Probability" (Sigmoid).
    *   Cite that Cross-Encoders (like BGE) output unnormalized scores representing confidence, and Sigmoid is the standard mathematical transformation to convert this to a "Relevance Probability".

**Dependencies:** None. Pure logic updates.
