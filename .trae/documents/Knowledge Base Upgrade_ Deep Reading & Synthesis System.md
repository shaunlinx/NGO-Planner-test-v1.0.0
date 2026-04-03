# Implementation Plan: Knowledge Base "Deep Reading" & Synthesis Upgrade

This is a comprehensive upgrade to transform the Knowledge Base from a file repository into a "Knowledge Production System".

## Phase 1: High-Fidelity Preview & Infrastructure (Immediate)
**Goal:** Solve the "formatting loss" issue and prepare the database.

1.  **Infrastructure & Dependencies**
    *   Install `react-pdf` for native-like PDF rendering in React.
    *   Update `electron/databaseManager.js` to initialize new SQLite tables:
        *   `reading_projects` (Clusters based on "Reading Purpose")
        *   `reading_sessions` (Link specific files to a project)
        *   `knowledge_cards` (The core "notes" with tags, original text, user comments)
        *   `reading_summaries` (Generated summaries)

2.  **Enhanced File Serving**
    *   Modify `electron/main.js` to expose a secure IPC handler (`fs-read-buffer`) that allows the frontend to receive binary data (for PDF/Images) or HTML (for Docx) instead of just raw text.

3.  **Upgrade Preview Pane (`KnowledgeBase.tsx`)**
    *   **PDF**: Replace text view with `<Document>` (react-pdf).
    *   **Word**: Use `mammoth` to convert `.docx` to HTML for preview (preserving headings/lists) instead of plain text.
    *   **Fallback**: Add a prominent "Open with System Default" button for all file types.

## Phase 2: "Deep Reading" Mode (The Core Feature)
**Goal:** Implement the Reader, Note-taking, and Auto-Tagging workflow.

1.  **New Component: `ReadingMode`**
    *   A focused, full-screen UI separate from the chat.
    *   **Entry Workflow**: User clicks "Read" -> Modal asks "What is your reading purpose?" (e.g., "Researching AI Ethics").
    *   **Layout**: Left 70% (Document Viewer), Right 30% (Knowledge Cards Sidebar).

2.  **Interactive Note-Taking**
    *   Implement text selection listeners in the PDF/HTML viewer.
    *   **Action**: On selection -> Show "Create Card" tooltip.
    *   **Card Creation**: Captures `selected_text`, `surrounding_context`, and allows user input.

3.  **AI Auto-Tagging System**
    *   **Trigger**: On card creation.
    *   **Logic**: Call LLM with `{selected_text, reading_purpose}`.
    *   **Output**: Generate multi-dimensional tags (Keywords, Relevance, Usage) and save to DB.
    *   **UI**: Allow users to edit/add/delete these tags in the sidebar.

## Phase 3: Knowledge Synthesis (Advanced)
**Goal:** From Cards to Framework.

1.  **Synthesis Engine**
    *   **Single Doc Summary**: Button to "Finish Reading". LLM aggregates all cards + purpose -> Generates a "Reading Note".
    *   **Folder Synthesis**: A new Dashboard view grouping files by "Reading Purpose".
    *   **Framework Generation**: LLM analyzes all summaries in a folder to create a hierarchical knowledge structure.

## Execution Strategy
I will start with **Phase 1 and Phase 2 (Reader UI)** immediately, as they directly address your biggest pain points (Preview Format & Note-taking). Phase 3 will follow once the data structure is populated.
