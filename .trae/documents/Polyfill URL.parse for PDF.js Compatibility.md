I will fix the `TypeError: URL.parse is not a function` error, which is caused by a compatibility issue in `react-pdf` v10.x / `pdfjs-dist` v5.x assuming a newer Node.js/Browser API environment than what Electron/Chromium provides in this context.

1.  **Polyfill `URL.parse`**: I will add a polyfill for the static `URL.parse` method in `PDFViewer.tsx` (or a global init file) before the PDF components load. This method was added in Node.js 22 and recent browsers; if missing, it causes crashes in newer libraries.
2.  **Verify**: Ensure the polyfill correctly delegates to the `new URL()` constructor, which is standard and available.

This will resolve the crash and allow the PDF viewer to function correctly.