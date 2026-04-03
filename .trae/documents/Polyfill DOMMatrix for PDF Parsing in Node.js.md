I will fix the "DOMMatrix is not defined" error, which is caused by a missing web API in the backend Electron/Node.js environment when parsing PDFs.

1.  **Diagnose**: The error occurs in the **backend RAG process** (`fileProcessor.js` or `geminiService.ts`). `pdfjs-dist` v4+ relies on `DOMMatrix`, which is a browser API. In Node.js (Electron main process), this global is missing.
2.  **Fix**: I will polyfill `DOMMatrix` in `electron/services/rag/fileProcessor.js` before initializing `pdfjs-dist`.
3.  **Implementation**: I will import `DOMMatrix` from the `canvas` package (if available) or implement a minimal polyfill/mock, or better yet, simply assign the global `DOMMatrix` if it's missing, using a lightweight implementation since we only need basic matrix operations for PDF parsing. Since adding native deps like `canvas` can be tricky in Electron, I'll first check if `pdfjs-dist` provides a node-compatible build that we might be missing, or just add a simple polyfill class.
    *   Actually, a simpler fix for `pdfjs-dist` in Node is often just ensuring we use the `legacy` build or polyfilling the specific missing class.
    *   I'll check `fileProcessor.js` and add: `global.DOMMatrix = global.DOMMatrix || require('pdfjs-dist/build/pdf.worker.js').WorkerMessageHandler;` (Wait, no, that's wrong).
    *   Correct approach: I will add a minimal `DOMMatrix` polyfill class directly in `fileProcessor.js`.

This will allow the backend file parsing to succeed without crashing on the missing API.