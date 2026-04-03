I will implement the "Local Polish" feature and verify the "View Original" window fixes.

**1. Fix "View Original" Window Z-Index & Highlighting**
- **Status:** The Z-Index is already set to `z-[100]` (verified in `components/KnowledgeBase.tsx`), which is higher than the editor modal (`z-[80]`). The highlighting logic is also present (`handlePreview` accepts `highlightText` and passes it to the renderer).
- **Action:** No further changes needed for Z-Index. I will verify if the highlighting is effective during usage (the code logic is correct).

**2. Implement "Local Polish" Feature**
- **Status:** The UI elements (Toolbar buttons, Input box) are present, but the **`handlePolish` function definition is missing** and the state variables (`isPolishing`, `showPolishInput`) are not defined.
- **Action:**
    - Add state variables: `const [isPolishing, setIsPolishing] = useState(false);` and `const [showPolishInput, setShowPolishInput] = useState(false);`.
    - Implement `handlePolish` function:
        - Detect if text is selected in the `textarea` (using `textareaRef`).
        - If selected, polish only the selection; otherwise, polish the full text.
        - Construct a prompt based on the type ('auto' vs 'custom').
        - Call the LLM (using `window.electronAPI.knowledge.query` with empty context to bypass RAG).
        - Update the editor content with the polished text.

**File to Edit:** `components/KnowledgeBase.tsx`
