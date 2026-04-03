The performance issue in "Knowledge Lifecycle Management (KLM)" is caused by an **N+1 query problem** in the frontend.

**Analysis:**
1.  **Frontend (`IndexManager.tsx`)**: The `loadStats` function first fetches the list of files (`getStats`), and then iterates through *every single file* to request its chunk count individually (`getChunks` with limit 1).
    *   If you have 100 files, this triggers 101 IPC calls (1 for list + 100 for counts).
    *   These calls run in parallel via `Promise.all`, which causes a massive spike in IPC traffic and database contention, freezing the UI.
2.  **Backend (`vectorStore.js`)**: There is no efficient way to get "all chunk counts" in a single query currently.

**Proposed Plan:**
1.  **Enhance `vectorStore.js`**: Add a new method `getChunkCounts()` that performs a single efficient query to retrieve all chunks (selecting only the `source` column) and aggregates the counts in memory. This replaces hundreds of DB queries with just one.
2.  **Optimize `main.js`**: Modify the `kb-get-stats` IPC handler to call this new `getChunkCounts()` method and merge the `chunk_count` directly into the file stats response.
3.  **Simplify `IndexManager.tsx`**: Remove the heavy `Promise.all` loop. The `getStats()` call will now return fully populated data, making the UI load instantly.

**Impact:**
-   **Startup Time**: drastically reduced (from O(N) calls to O(1) call).
-   **Responsiveness**: The UI will no longer freeze when opening the manager.

**Steps:**
1.  Modify `electron/services/rag/vectorStore.js` to add `getChunkCounts()`.
2.  Modify `electron/main.js` to merge chunk counts in `kb-get-stats`.
3.  Modify `components/IndexManager.tsx` to remove the client-side enrichment loop.