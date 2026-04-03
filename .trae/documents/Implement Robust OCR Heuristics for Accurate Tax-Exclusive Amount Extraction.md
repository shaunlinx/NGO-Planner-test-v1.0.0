I will implement a robust "OCR + Heuristic" fallback strategy to accurately extract tax-exclusive amounts when the LLM is unreliable.

### **Analysis of the Problem**
1.  **LLM Failure:** The current LLM might be struggling with visual precision or number extraction in complex receipt layouts.
2.  **OCR Limitation:** Standard OCR returns raw text without semantic meaning (it doesn't know which number is the "Total" vs. "Tax").
3.  **Visual Clue:** You mentioned "Amount is often the largest/boldest text".
4.  **Semantic Clue:** Receipts often label amounts with "Tax" (税额), "Total" (合计), "Subtotal" (金额/税前).

### **Implementation Plan**

1.  **Enhance `analyzeWithOCRAndLLM` in `geminiService.ts`**
    *   **Step 1: Get OCR Data with Coordinates:** Instead of just getting text, I will request OCR data *with bounding boxes and confidence scores* (if the library supports it) or at least parse the text line-by-line.
    *   **Step 2: Implement "Amount Candidate" Heuristics:**
        *   Regex search for all currency-like patterns (e.g., `¥100.00`, `100.00`).
        *   **Context Keyword Search:** Look for keywords *preceding* or *near* the numbers: "金额" (Amount/Pre-tax), "税额" (Tax), "价税合计" (Total).
        *   **Magnitude Logic:** If multiple numbers are found, usually: `Total > Pre-tax Amount > Tax`.
    *   **Step 3: "Largest Font" Simulation (Text Logic):** Since we might not get font size from basic OCR, we will rely on the *keywords* strongly. If explicit keywords like "金额" (specifically distinct from "价税合计") are found, we prioritize the number associated with them.

2.  **Refine Extraction Logic:**
    *   If the user selects "Amount" (金额), the system will specifically look for the **Pre-tax Amount** first (often labeled "金额" in Chinese VAT invoices).
    *   If "Amount" is not found, it falls back to the largest number (Total) but flags it.
    *   **Constraint:** The user specifically asked for "Pre-tax" (税前). I will add logic to calculate it if only Total and Tax are found (`Total - Tax`).

3.  **UI Feedback:**
    *   In the "Smart Bookkeeping" log, I will output which specific logic was used (e.g., "Found 'Pre-tax Amount' keyword", "Calculated from Total - Tax").

### **Why this works?**
*   It reduces reliance on the LLM's "intelligence" and uses deterministic rules for the most critical field (Money).
*   It addresses the specific "Pre-tax vs Post-tax" ambiguity by searching for standard invoice labels.

I will now execute this plan.