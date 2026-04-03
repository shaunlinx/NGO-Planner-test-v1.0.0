I have refined the plan based on your suggestions to enhance UX and functionality.

### 1. Enhanced Citation Highlighting (Refined)
- **Smart Toggle & Clear**:
  - **Toggle**: Clicking the same citation `[N]` again will **turn off** the highlight.
  - **Auto-Clear**: Clicking anywhere outside the citation or reference panel will clear the highlight.
- **Advanced Matching Algorithm**:
  - Instead of simple keyword matching, I will implement a **Weighted Matching Strategy**:
    1.  **Exact Phrase Match**: Prioritize matching the longest consecutive substring from the answer sentence.
    2.  **Keyword Fallback**: If no long phrases are found, match significant keywords (filtering out stop words like "the", "is").
  - This ensures "sentences/phrases" are highlighted accurately without cluttering the text with common word matches.

### 2. "Optimization" Mode Upgrade (Refined)
- **Expanded Presets**:
  1.  **Formal (正式)**: Standard business/academic styling.
  2.  **Viral (传播)**: Mobile-friendly, high contrast, larger text.
  3.  **Note (笔记)**: Compact line height, smaller font, optimized for information density.
  4.  **Print (打印)**: Black & white, high contrast, serif font, removed background colors.
- **Template Management System**:
  - **Save/Load**: Persist custom templates to LocalStorage.
  - **Manage**: Add ability to **Rename** and **Delete** saved templates.
- **Real-time Preview**:
  - Add a **Mini-Preview Box** inside the configuration panel.
  - As you adjust sliders (font size, spacing), the mini-preview updates instantly to show the effect before applying it to the main content.
- **Responsive Design**:
  - The configuration panel will use a responsive layout (collapsible on smaller screens) to ensure it works well on different devices.

### 3. Technical Implementation
- **Style Caching**: Use `useMemo` to cache generated style objects, preventing unnecessary re-renders when switching modes.
- **Component Structure**:
  - Create a `OptimizationPanel` component for the settings.
  - Create a `ChunkTextHighlighter` component for the smart text matching.

### Execution Steps
1.  **State**: Add `citationHighlight`, `optimizationMode` states.
2.  **Citation**: Update `ReactMarkdown` click handlers with toggle logic and context extraction.
3.  **Highlighter**: Implement the `ChunkTextHighlighter` with the weighted matching algorithm.
4.  **Optimization UI**: Build the robust configuration panel with presets, preview, and template management.
