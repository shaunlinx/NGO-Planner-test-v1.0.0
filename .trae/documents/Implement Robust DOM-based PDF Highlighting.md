I will implement a **DOM-based Text Highlighting** strategy that is robust against PDF text fragmentation. Instead of modifying the render stream, I will process the rendered Text Layer as a whole.

1.  **Clean Up**: Remove the fragile `customTextRenderer` which caused type errors and missed cross-span text.
2.  **Implement `onRenderTextLayerSuccess`**: Use `react-pdf`'s native callback which fires exactly when the text layer DOM is ready.
3.  **Develop `highlightPageText` Utility**:
    *   This function will traverse the `TextLayer` DOM nodes.
    *   It will construct a full text map to handle cases where a highlighted phrase spans multiple PDF text elements (e.g., "Note" + "book" = "Notebook").
    *   It will create DOM Ranges for matches and wrap them in a styled `<span>`.
    *   This mimics how the browser's "Find in Page" works, guaranteeing that if the user can select it, we can highlight it.

This approach ensures:
*   **Robustness**: Works even if PDF splits text weirdly.
*   **Fluency**: Highlights appear naturally as pages load.
*   **Feasibility**: Uses standard DOM APIs without complex coordinate math.