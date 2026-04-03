I have analyzed the issues you reported and identified the root causes. Here is the repair plan:

### 1. 🛡️ Critical Safety Fix: Prevent Physical Deletion of Mounted Folders
**Problem:** The current "Physical Delete" logic in the UI blindly executes a file system deletion, even for mounted external folders like "Desktop".
**Solution:**
- Modify `KnowledgeBase.tsx` to check if the target folder is a **Mounted Folder**.
- If it is mounted: **Block physical deletion**. Show a warning and only perform "Unmount" (remove from list).
- If it is an internal project folder: Retain the current physical deletion logic (with confirmation).

### 2. 🧹 Fix "Unmount" to Clear Index (Solve Stale Index Issue)
**Problem:** Unmounting a folder currently only removes it from the UI list, but leaves the index in the database. When re-mounted, the system skips re-indexing because it thinks the files are already there.
**Solution:**
- Create/Update the "Unmount" logic to trigger a **Database Cleanup**.
- When a folder is unmounted, find all indexed files belonging to that path and remove them from `VectorStore` (index) and `DBManager` (stats).
- This ensures that re-mounting triggers a fresh re-indexing/re-embedding process.

### 3. 🎥 Fix Audio/Video & Image Queue Rejection
**Problem:** `ProjectWatcher.js` has a hardcoded whitelist of file extensions that excludes media files.
**Solution:**
- Add `.mp3`, `.mp4`, `.wav`, `.png`, `.jpg`, etc., to the allowed extension list in `ProjectWatcher.js`.
- This will allow the `FileProcessor` (which already has Python/OCR logic) to receive and process these files.

### 4. 📄 Fix Word (.docx) "Zip Error"
**Problem:** The `mammoth` library is failing to read `.docx` files directly from path, likely due to file locking or path handling issues (`jszip` error).
**Solution:**
- Modify `fileProcessor.js` to read the file into a **Buffer** first using `fs.readFileSync`, and then pass the buffer to `mammoth`. This is a more robust method that bypasses many file system lock issues.

### 5. 🐍 Verification of Multimodal Processing
- I will ensure `transcribe.py` is correctly invoked now that the watcher barrier is removed.
- I will verify the Python environment assumption (that `python3` is available as per your previous installation).

I will proceed with these changes safely.
