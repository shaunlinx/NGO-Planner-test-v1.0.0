# Phase 4: Robust "Simulated Browsing" Upgrade

To address the issue of incomplete scraping (missing details/comments) and ensure high-quality data collection, I will upgrade the `ResearchEngine` to use a "Visible Simulated Browsing" approach.

## 1. Core Principles
*   **Visible Execution**: The browser window will be visible (`show: true`) so you can verify access and handle Login/Captcha manually if needed.
*   **Session Persistence**: Use a persistent session (`persist:research`) to save your login state (Cookies/LocalStorage) across restarts.
*   **Human-like Behavior**: Slower scrolling, random pauses, and "wait for element" logic to ensure comments are fully loaded before scraping.

## 2. Technical Implementation
### A. Update `ResearchEngine.js`
1.  **Window Configuration**:
    *   Set `show: true`.
    *   Set `webPreferences: { partition: 'persist:research' }`.
    *   Add a "Check Login" step: If the scraper detects a login page, it will pause and alert the user (or wait until you log in manually).
2.  **Enhanced Scraping Logic**:
    *   **Wait Mechanism**: Replace fixed `setTimeout` with a polling mechanism that waits for specific elements (like the comment section) to appear.
    *   **Comment Loading**: Implement a "scroll-to-bottom" loop specifically for the comment container to trigger lazy loading.
    *   **Robust Selectors**: Update CSS selectors to match current Xiaohongshu web structure (handling potential class name obfuscation).

### B. IPC & Feedback
*   Add real-time progress events via IPC (e.g., "Navigating...", "Waiting for Login...", "Scraping item 1/10...") so the frontend shows exactly what's happening.

## 3. Workflow
1.  User clicks "Start Fieldwork".
2.  A separate browser window opens.
3.  **If not logged in**: The window stays on the login page. User scans QR code to login.
4.  **Once logged in**: The script automatically continues to browse, scroll, and collect data.
5.  Window closes (or stays open for inspection) upon completion.