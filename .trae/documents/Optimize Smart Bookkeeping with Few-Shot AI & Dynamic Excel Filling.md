I will optimize the data extraction and filling process by leveraging the user-selected example data as "Few-Shot" learning context for the AI, and implementing dynamic row handling in the Excel export.

### **Optimization Plan**

1.  **Enhance AI Extraction (Few-Shot Prompting)**
    *   **Goal:** Use the manually selected "example data" (from the second row of the user's selection) to teach the AI *exactly* how to map the raw evidence content to the target columns.
    *   **Action:** Update `analyzeSmartLedger` and `analyzeWithOCRAndLLM` in `geminiService.ts` to accept an optional `examples` parameter.
    *   **Prompt Strategy:**
        *   "Here are the target headers: [Date, Amount, Category...]"
        *   "Here is a **Golden Example** of how to extract data for these headers: { Date: '2023-01-01', Amount: '500', ... }"
        *   "Please follow this example's format and logic strictly when analyzing the new image."

2.  **Refine Data Filling Logic (Dynamic Rows)**
    *   **Goal:** Handle cases where the extracted data rows exceed the pre-formatted area in the template.
    *   **Action:** Update `handleExport` in `SmartBookkeepingModal.tsx`.
    *   **Logic:**
        *   Calculate the number of rows in the user's selection (`selectionSize`).
        *   Calculate the number of extracted data rows (`dataSize`).
        *   If `dataSize > selectionSize`:
            *   Insert `(dataSize - selectionSize)` new rows *after* the last row of the selection.
            *   **Crucial:** Copy styles from the "Example Data Row" to these new rows to maintain template fidelity.
        *   If `dataSize <= selectionSize`:
            *   Simply fill the existing rows and clear any remaining placeholder data if necessary.

3.  **UI Integration**
    *   Pass the `examples` captured in the `SmartBookkeepingModal` state to the service functions during the "Start Processing" step.

### **Why this is better?**
*   **Accuracy:** The AI no longer guesses what "Column C" means; it *sees* an example (e.g., "Oh, Column C is for tax-inclusive amount, not pre-tax").
*   **Flexibility:** The dynamic row insertion ensures the final Excel file looks professional and formatted, regardless of how many receipts are processed.

I will now execute these changes.