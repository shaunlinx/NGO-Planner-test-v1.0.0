I will implement the "Manual Header Selection" feature by making the Excel preview interactive, allowing you to click specific rows to define them as headers. This will directly guide the AI extraction process.

### **Implementation Plan**

1.  **Refactor Excel Preview to Interactive Component**
    *   **Current State:** The preview is a static HTML string (`dangerouslySetInnerHTML`), which makes interaction impossible.
    *   **Change:** Refactor the rendering logic to use native React JSX loops.
    *   **New Feature:** Render the `ExcelJS.Workbook` data directly into a React `<table>`. This allows attaching `onClick` events to each `<tr>`.

2.  **Implement "Click-to-Set-Header" Logic**
    *   **Interaction:** When you hover over a row in the preview, it will highlight. Clicking it will designate it as the **Header Row**.
    *   **Logic:**
        *   On click, read the cell values of that row.
        *   Update the `templateStructure` state (Header Index, Data Start Index, and Field Names) with these values.
        *   Override the AI's auto-detected structure.

3.  **Visual Feedback & UI Updates**
    *   **Styling:** The manually selected row will have a distinct "Header" badge and border style.
    *   **Confirmation:** A toast/log message will confirm: "Header row set to Row X. Fields: [Name, Date, Amount...]".

4.  **Connect to AI Extraction**
    *   The existing `startProcessing` function already relies on `templateStructure`. By updating this state via your manual click, the AI (LLM/OCR) will automatically use your *exact* selected fields for extraction, ensuring perfect alignment with your intent.

### **User Workflow**
1.  Upload Excel Template.
2.  **Preview appears.** If AI auto-detection is wrong, simply **click the correct header row** in the preview.
3.  The system updates the target fields immediately.
4.  Drag in files and click "Start Processing" to auto-fill based on your selection.