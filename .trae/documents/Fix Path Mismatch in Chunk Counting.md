The user reports that after the optimization, all files show as "Unindexed" (0 chunks). This indicates that the aggregation logic in `getChunkCounts` is failing to match the source paths correctly.

**Problem Analysis:**
1.  **Path Normalization Issue**: The `vectorStore.js` uses `lancedb` which might be storing paths with mixed separators (Windows `\` vs POSIX `/`) depending on how they were ingested.
2.  **Aggregation Key Mismatch**: In `getChunkCounts`, we are aggregating raw `source` strings from the DB.
    *   If the DB stores `C:\Users\File.pdf` but the frontend/main process expects `C:/Users/File.pdf`, the keys in the `counts` object won't match the `file_path` in the stats list.
    *   The `kb-get-stats` handler in `main.js` does a direct lookup: `chunkCounts[s.file_path]`. If the strings differ even by a slash style, the lookup returns `undefined` (defaulting to 0).

**Solution Plan:**
1.  **Normalize Paths in `getChunkCounts`**: When aggregating, we should normalize the keys to a standard format (e.g., replace backslashes with forward slashes) to ensure consistency.
2.  **Normalize Lookup in `main.js`**: Similarly, when looking up the count in `main.js`, we should normalize the file path from the stats DB to ensure it matches the normalized key from the vector store.
3.  **Debug Logging**: Add temporary logging to `main.js` to print a few sample paths from both `stats` and `chunkCounts` to verify the mismatch and the fix.

**Revised Steps:**
1.  Modify `electron/services/rag/vectorStore.js`: Update `getChunkCounts` to normalize paths (replace `\` with `/`) before counting.
2.  Modify `electron/main.js`: Update `kb-get-stats` to normalize the `file_path` before looking it up in the counts map.

**Why this won't cause slow loading:**
-   Path string manipulation in memory (Node.js) is extremely fast (microsecond scale).
-   We are still doing a single DB query.
-   The overhead of `replace(/\\/g, '/')` on 100k strings is negligible compared to IPC overhead.

**Verification:**
-   After applying, we expect the `chunk_count` to be correctly populated because the keys will now match regardless of OS-specific separators.