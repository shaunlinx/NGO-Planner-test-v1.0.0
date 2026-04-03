# RAG Implementation Analysis & Upgrade Plan

## 1. Current System Analysis (Current State)
*   **Architecture**: **Local-First Hybrid RAG**.
*   **Core Stack**: Electron (App) + LanceDB (Vector) + SQLite (Relational/Meta) + ONNX (Local AI).
*   **Pipeline**:
    *   **Ingestion**: Custom PDF Layout Recovery (High precision) + Agentic Summary (Context enrichment).
    *   **Retrieval**: Hybrid Search (Vector + Keyword) + Local Reranking (BGE-M3).
    *   **Generation**: Cloud LLM (DeepSeek/Gemini) via standard SDK.
*   **Verdict**: A highly optimized, privacy-focused solution for Desktop. It outperforms generic tutorials by handling real-world messy data (PDF layouts, PPT fragments) effectively.

## 2. Framework Comparison
| Feature | **Current Implementation** | **LangChain** | **Flowise** | **AutoGen** |
| :--- | :--- | :--- | :--- | :--- |
| **Nature** | Custom, Embedded Code | Python/JS SDK Library | Low-Code Visual Builder | Multi-Agent Conversation Framework |
| **Integration** | **Native** (Deeply integrated with UI/State) | Moderate (Requires adapters) | Low (Runs as separate service) | Low (Complex state management) |
| **Performance** | **High** (In-process, no overhead) | Medium (Abstraction layers) | Medium (HTTP overhead) | Low (Many LLM calls) |
| **Complexity** | Low (Direct control) | High (Learning curve, rapid breaking changes) | Medium (Deployment is easy, customization hard) | High (Hard to control loop) |
| **Suitability** | **Best for Desktop App** | Good for Python Backends | Good for Prototyping | Good for Complex "Teams" |

**Conclusion**: For a Desktop Electron app, the **Current Custom Implementation** is superior to adopting a heavy framework. It keeps the bundle size small (`lance-db` vs `langchain` bloat) and allows precise control over the "Layout Recovery" logic which frameworks often over-simplify.

## 3. Recommended Upgrade Directions (Safe, Efficient, Low-Config)

As a Product Manager, I recommend **3 Strategic Upgrades** that respect the "Desktop/Local" constraints:

### **Option A: Graph-Lite (Entity-Centric RAG) [Recommended]**
*   **Concept**: Don't just retrieve chunks; retrieve "Entities" (People, Projects, Events) connected to those chunks.
*   **Implementation**: Use the existing **SQLite** to map `File <-> Entity <-> Chunk`.
*   **Value**: When asking "What is Project A?", it retrieves the *Project Record* + *Related Docs*, not just text matches.
*   **Cost**: Low (SQL Joins). **Efficiency**: High.

### **Option B: Query Rewriting (HyDE Lite)**
*   **Concept**: Before searching, use a fast LLM (or the main one) to rewrite the user's query into a "Hypothetical Answer" or "Keyword List".
*   **Implementation**: Add a pre-processing step in `ragEngine.js`.
*   **Value**: Fixes "vague query" issues (e.g., user asks "money stuff" -> rewrites to "budget, expenses, finance").
*   **Cost**: 1 extra LLM call (Cheap).

### **Option C: Active Feedback Loop (RLHF-Lite)**
*   **Concept**: Add "Thumbs Up/Down" or "Edit Answer" in the UI.
*   **Implementation**: Store negative feedback. Next time, filter out chunks that contributed to bad answers.
*   **Value**: The system gets smarter as the NGO user uses it.

---

## **Proposed Next Step: Implement "Graph-Lite" Infrastructure**
I propose starting with **Option A (Graph-Lite)** as it aligns with the "NGO Planner" domain (managing Projects/People).

**Plan:**
1.  **Schema Update**: Create `entity_relationships` table in SQLite.
2.  **Ingestion Update**: When parsing files, use a lightweight NER (Named Entity Recognition) prompt to extract "Project Names" or "Person Names" and store links.
3.  **Retrieval Update**: When searching, if a query matches an Entity, boost related documents.

Do you want to proceed with this **Graph-Lite** upgrade, or would you prefer **Option B** (Query Rewriting)?