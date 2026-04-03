I will systematically fix the 5 reported issues in the Reading Mode.

1.  **Fix Card Analysis Stuck ("Analysis in progress")**:
    *   **Diagnosis**: The card generation logic in `KnowledgeBase.tsx` might not be correctly triggering the backend AI analysis or handling the response state.
    *   **Action**: I will debug the `handleTextSelect` -> `createCard` flow in `KnowledgeBase.tsx`. I'll ensure the `is_analyzing` state is properly toggled and the AI service call (`/api/cards/analyze` or similar) is actually firing.

2.  **Fix Card Click Highlight (Bidirectional Sync)**:
    *   **Diagnosis**: The `UniversalReader` receives `highlights` prop, but the text matching might be failing if the Markdown content differs slightly from the selected text (whitespace issues), or the highlight overlay logic needs refinement.
    *   **Action**: I will normalize text in `UniversalReader` (trim whitespace) before matching. I'll also add a `scrollToHighlight` function to ensure the highlighted text scrolls into view when a card is clicked.

3.  **Fix "Open Original File" Button**:
    *   **Diagnosis**: `window.electronAPI.shell.openPath` might be undefined or blocked in the renderer process context if context isolation is strict.
    *   **Action**: Check `preload.ts` to ensure `shell.openPath` is exposed. If it is, verify the `filePath` being passed is absolute and valid. I'll add error logging to the button click.

4.  **Fix Layout & Zoom**:
    *   **Diagnosis**: The `max-w-3xl` class in `UniversalReader` constrains the width.
    *   **Action**:
        *   Change `max-w-3xl` to `max-w-full` or dynamic based on a new `zoom` state.
        *   Add a **Zoom Toolbar** (+ / - buttons) in `UniversalReader` header that adjusts the `font-size` or `scale` of the prose container.
        *   Remove unnecessary padding to let it fill the area better.

5.  **Fix Title Bar Overlap**:
    *   **Diagnosis**: The header in `UniversalReader` lacks sufficient top padding/margin to account for the macOS traffic light buttons (window controls).
    *   **Action**: Add a "drag region" spacer (e.g., `pt-8` or `h-8`) at the top of the window/sidebar to push content down below the traffic lights.

I will tackle these in order, starting with the critical functionality (Analysis & Open File) then UI/UX.