I will implement the "Deep Reading Mode" and "Knowledge Framework" system as follows:

### 1. Enhance "View Original" & Preview Experience
*   **Problem**: Current preview loses formatting.
*   **Solution**: 
    *   Modify the file preview modal in `KnowledgeBase.tsx`.
    *   Add a **"Open with System Default"** (使用本地应用打开) button to view the file in its original fidelity (Word, PDF, etc.).
    *   Add a **"Enter Deep Reading"** (进入深度阅读) button to trigger the new reading workflow.

### 2. Implement Deep Reading Workflow
*   **Entry Point**: Clicking "Enter Deep Reading" triggers the purpose setup.
*   **Purpose Setup**: Show `ReadingSessionModal` to capture the user's "Reading Purpose" (e.g., "Researching Elderly Care").
*   **Reader Launch**: Open `ReaderLayout` with the file and purpose.
    *   **PDF/DOCX**: Use specialized viewers (`PDFViewer`/`DocxViewer`) to preserve formatting.
    *   **Text/Markdown**: Render with markdown styling.
*   **Knowledge Cards**:
    *   Enforce "Select text to create card" behavior.
    *   **Auto-Tagging**: Use the "Reading Purpose" to drive AI tagging (already partially implemented, will refine).
    *   **Editing**: Ensure tags and notes are fully editable (Add/Delete/Modify).

### 3. Implement Reading Summary & Framework
*   **Summary Generation**:
    *   In `ReaderLayout`, implement the **"Generate Summary"** function.
    *   It will aggregate all knowledge cards from the session.
    *   Use LLM to generate a "Reading Conclusion" based on the cards and the initial "Reading Purpose".
    *   Save this summary as a meta-document linked to the file.
*   **Knowledge Framework (Multi-document Synthesis)**:
    *   Add a new **"Reading Space" (阅读空间)** tab in the Knowledge Base.
    *   **Folder/Project View**: Display "Reading Projects" (grouped by Purpose).
    *   **Synthesis**: Add a "Generate Framework" button for each project.
        *   LLM analyzes all files and cards within the project.
        *   Generates a structured framework/outline pointing to the Reading Purpose.

### 4. Technical Implementation Steps
1.  **Update `KnowledgeBase.tsx`**: Add "Reading Space" tab and integrate `ReaderLayout` entry points.
2.  **Update `ReaderLayout.tsx`**: Implement `handleGenerateSummary` and `handleFinishReading` logic using `electronAPI.knowledge.completion`.
3.  **Create `ReadingProjectList.tsx`**: A new component to visualize reading folders and trigger framework generation.
4.  **Backend Verification**: Ensure `readingMode` IPCs correctly store/retrieve project-level metadata.

This plan addresses all 5 points of your request:
1.  Better preview (System Default option).
2.  Reader with Purpose & Cards (Integrated `ReaderLayout`).
3.  Editable Tags (Verified in `KnowledgeCard`).
4.  Reading Summary (New implementation).
5.  Multi-doc Framework (New "Reading Space" view).