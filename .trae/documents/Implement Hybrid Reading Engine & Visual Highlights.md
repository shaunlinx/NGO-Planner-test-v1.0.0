I will implement the "Dual-Engine Hybrid Rendering" strategy to optimize the reading experience, ensuring high fidelity, performance, and interactivity.

1.  **Enhance Word/Docx Viewer (Flow Engine)**:
    *   Upgrade `DocxViewer.tsx` to use `mammoth` with custom style mapping for a professional "Reader Mode" look.
    *   Apply `Tailwind Typography` (`prose` classes) to ensure beautiful, readable typography (like Markdown/Safari Reader).
    *   This fulfills the "fluent text operation experience" for reflowable documents.

2.  **Enhance PDF Viewer (Fixed Layout Engine)**:
    *   Implement **Visual Highlights**: Modify `PDFViewer.tsx` to accept a list of highlights (from `cards`) and render distinct, semi-transparent overlays on top of the document.
    *   This fulfills the "overlay with accurate text content" vision, providing persistent visual feedback for notes.

3.  **Bi-directional Interaction**:
    *   Ensure clicking a card scrolls the document (already started, will refine).
    *   Ensure clicking a highlight in the document selects/scrolls the corresponding card in the sidebar.

This approach delivers the optimal balance of "Original Preview" (PDF) and "Fluent Text" (Word) without heavy file duplication.