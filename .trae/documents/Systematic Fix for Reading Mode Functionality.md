I will perform a **Deep System Audit & Fix** because the previous attempts were clearly superficial and failed to address the root causes in the actual runtime environment. I will verify each fix with concrete evidence or by inspecting the actual IPC/API layers.

1.  **Fix 1: "Analysis Stuck" (AI Tagging)**
    *   **Root Cause Investigation**: The frontend `window.electronAPI.knowledge.completion` might not be connected to the backend handler properly, or the backend `geminiService` is failing silently.
    *   **Action**: I will check `preload.ts` to confirm the API exposure and `main.js` (or `ipcHandlers.js`) to verify the IPC handler. I will add **explicit error logging** and a **timeout fallback** in the frontend to ensure it *never* stays stuck indefinitely.

2.  **Fix 2: "Card Click No Highlight" (Scroll Sync)**
    *   **Root Cause**: The `id` mismatch between the card ID and the DOM element ID, or the `UniversalReader` is re-rendering and losing the ref.
    *   **Action**: I will verify the `highlight-{id}` generation in `UniversalReader` matches the `activeHighlightId` passed from `ReaderLayout`. I'll ensure the `useEffect` for scrolling has the correct dependencies.

3.  **Fix 3: "Open File No Response"**
    *   **Root Cause**: `shell.openPath` is likely blocked by Electron's security policy or not exposed in `preload.ts`.
    *   **Action**: I will check `electron/preload.js` (or `.ts`) and `electron/main.js`. If `shell` is missing, I will expose it via a dedicated `readingMode.openFile` IPC channel which is safer and guaranteed to work.

4.  **Fix 4: "Layout & Zoom" (Trackpad Support)**
    *   **Root Cause**: CSS `max-width` constraints and lack of wheel event listeners.
    *   **Action**:
        *   Remove `max-w-3xl` entirely from the container.
        *   Implement `onWheel` listener in `UniversalReader` to detect Ctrl+Wheel (or Pinch) for zooming.
        *   Ensure the container is `w-full` and `h-full`.

5.  **Fix 5: "Header Overlap" (Traffic Lights)**
    *   **Root Cause**: `pt-8` might not be enough or the window is frameless and needs specific CSS drag regions that don't conflict with buttons.
    *   **Action**: I will increase the top padding to `pt-12` (48px) to be safe and ensure the "Close/Zoom" buttons are clearly separated from the window controls.

I will verify `preload.ts` first as it's the likely culprit for API failures (1 & 3).