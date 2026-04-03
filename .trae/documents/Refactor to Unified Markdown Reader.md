I will implement the **Unified Markdown Reader** strategy to replace the unstable PDF/Docx native previews. This involves leveraging the existing text extraction pipeline to deliver a consistent, high-performance reading experience.

1.  **Backend Enhancement (`fileProcessor.js`)**:
    *   Refine the extraction logic to ensure it outputs structured text (Markdown-like) rather than just a flat string, especially for PDFs (preserving headers/paragraphs).
    *   Ensure the `getPreviewContent` API returns this structured text/markdown.

2.  **Frontend Architecture Refactor**:
    *   Create a new `UniversalReader` component.
    *   Replace `PDFViewer` and `DocxViewer` in `ReaderLayout.tsx` with this unified component.
    *   Use `react-markdown` (or similar) with `Tailwind Typography` (`prose` classes) for a beautiful, book-like reading experience.

3.  **Interaction Implementation**:
    *   **Highlighting**: Implement standard DOM-based selection handling on the Markdown content. Since it's standard HTML, `window.getSelection()` works perfectly.
    *   **Card Sync**: Update the highlighting logic to map selections to/from Knowledge Cards based on text content matching (which is now robust since we control the rendering).

4.  **Fallback**:
    *   Add an "Open Original File" button in the header to allow users to view the raw PDF/Word file in their OS default app if strict formatting is needed.

This plan solves the root cause of instability by normalizing all content to a single, controllable format.