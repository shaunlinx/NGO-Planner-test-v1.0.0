I have analyzed the current implementation and have a plan to address all your requirements.

### 1. Refactor `OptimizationPanel` UI
I will transform the `OptimizationPanel` from a fixed sidebar into a **floating, draggable, and minimizable modal**.
- **Draggable Header**: Add a drag handle (header) to allow moving the window freely.
- **Minimize Logic**: Add a state to toggle between the full configuration panel and a minimized floating button/icon.
- **Compact Layout**: Adjust padding and layout to reduce the visual footprint while keeping all controls accessible.
- **Integration**: Update `KnowledgeBase.tsx` to handle the floating state and remove the fixed layout styles.

### 2. Export with Styles
I will upgrade `ExportMenu` and the IPC call logic to support styling.
- **Pass Style Config**: Update `ExportMenu` props to accept an optional `styleConfig` (the optimization settings).
- **IPC Update**: Since I cannot modify the backend Electron code (read-only restriction usually applies to backend unless I can see it, checking `electron/main.ts` or `ipc` handlers would be ideal but assuming I can only modify frontend), I will send the *styled HTML* instead of raw Markdown to the export function.
    - *Correction*: I should check if I can modify the Electron main process. If I can't, I have to rely on the frontend to generate the final HTML string with inline styles (font-family, line-height, etc.) and pass that as "content" to the existing PDF generator.
    - **Strategy**: I will pre-process the Markdown into HTML, apply the user's selected styles (font, size, spacing) as inline CSS to the wrapper, and then pass this rich content to the export function. This ensures the PDF/Word output mirrors the screen.

### 3. Local Fonts & Customization
- **Custom Font Input**: Since there is no native API to list all user fonts safely, I will add a **"Custom Font" text input field**.
    - Users can type the name of any font installed on their system (e.g., "Source Han Sans").
    - The preview will immediately attempt to apply this font string.
- **Unlock Customization**: I will fix the UI logic so that selecting a preset (like "Formal") sets the initial values but **does not lock** the sliders. Users will be able to click a preset and then tweak the size/spacing sliders freely.

### Execution Plan
1.  **Modify `ExportMenu.tsx`**: Add `styleConfig` prop and logic to wrap content in styles before exporting.
2.  **Update `KnowledgeBase.tsx`**:
    -   Rewrite `OptimizationPanel` rendering to be a draggable portal or absolute positioned element.
    -   Add "Minimize" state and UI.
    -   Add "Custom Font" input to the configuration panel.
    -   Pass the current `optimizationConfig` to `ExportMenu`.
3.  **Verify**: Ensure dragging works, minimizing works, and the export function receives the styled content.

I will start by creating the todo list.