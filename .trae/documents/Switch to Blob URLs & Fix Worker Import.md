I will fix the "ArrayBuffer detached" crash and "Fake worker" warning by changing how we handle PDF data and the worker script.

1.  **Fix ArrayBuffer Crash (Robustness)**:
    *   Switch from passing raw `Uint8Array` data to using **Blob URLs**.
    *   In `PDFViewer.tsx`, I will convert the loaded buffer into a `Blob`, generate a URL with `URL.createObjectURL()`, and pass this URL to `react-pdf`.
    *   **Why**: Blobs are immutable and safe. Passing a URL prevents `react-pdf` from "detaching" (stealing) the underlying memory of our state variable, eliminating the crash completely regardless of re-renders.

2.  **Fix Fake Worker Warning**:
    *   Update the worker configuration to use the modern Vite import syntax: `new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()`.
    *   **Why**: This allows Vite to correctly resolve, bundle, and serve the worker file with the correct MIME type, preventing the fallback to the slow "fake worker".

This approach is the standard best practice for `react-pdf` + Vite + Electron to ensure stability and performance.