# Core Code Protection & Extensibility Strategy

This guide outlines how to protect your core intellectual property while maintaining an open ecosystem for community extensions.

## 1. Strategy Overview

| Component | Protection Method | Extensibility Method |
|-----------|-------------------|----------------------|
| **Core Logic (Node.js)** | V8 Bytecode Compilation (`bytenode`) | Plugin System (`plugins/` dir) |
| **AI/Data Logic (Python)** | Binary Compilation (`PyInstaller`) | Python Scripts (`scripts/` dir) |
| **Frontend (React)** | Minification + Obfuscation | UI Widgets / Workflow Nodes |

---

## 2. Implementing Code Protection

### A. Protecting Node.js (Electron Main Process)

Standard Electron apps ship with `app.asar` which contains readable JS code. To prevent this:

1.  **Install `bytenode`**:
    ```bash
    npm install --save-dev bytenode
    ```

2.  **Compile Main Process**:
    Create a build hook that compiles `main.js` and other critical files to `.jsc` (V8 bytecode).
    ```javascript
    // scripts/compile-main.js
    const bytenode = require('bytenode');
    bytenode.compileFile('electron/main.js', 'electron/main.jsc');
    ```

3.  **Update Entry Point**:
    Change your `package.json` main entry to a loader:
    ```json
    "main": "electron/loader.js"
    ```
    
    Create `electron/loader.js`:
    ```javascript
    require('bytenode');
    require('./main.jsc');
    ```

### B. Protecting Python (Privacy Guard)

Currently, `privacy_guard.py` is visible in resources. To protect it:

1.  **Install PyInstaller**:
    ```bash
    pip install pyinstaller
    ```

2.  **Compile to Binary**:
    ```bash
    pyinstaller --onefile --name privacy_guard electron/python/privacy_guard.py
    ```
    This creates a standalone executable in `dist/`.

3.  **Package with Electron**:
    Update `package.json` build config to copy the binary instead of source:
    ```json
    "extraResources": [
      {
        "from": "dist/privacy_guard", // Path to compiled binary
        "to": "bin/privacy_guard"
      }
    ]
    ```

4.  **Runtime Check**:
    The `PrivacyService.js` has already been updated to look for this binary first:
    ```javascript
    const binaryName = process.platform === 'win32' ? 'privacy_guard.exe' : 'privacy_guard';
    const possibleBinary = path.join(__dirname, '../bin', binaryName);
    ```

---

## 3. Implementing Extensibility

We have implemented a `PluginManager` that allows users to extend functionality without touching core code.

### A. Plugin Architecture

Plugins live in the User Data directory:
- Mac: `~/Library/Application Support/ngo-planner-desktop/plugins/`
- Windows: `%APPDATA%/ngo-planner-desktop/plugins/`

### B. Creating a Plugin

A plugin is a folder with a `manifest.json` and entry script.

**Example: `manifest.json`**
```json
{
  "id": "com.community.csv-importer",
  "name": "Advanced CSV Importer",
  "version": "1.0.0",
  "main": "index.js",
  "description": "Adds support for custom CSV formats"
}
```

**Example: `index.js`**
```javascript
module.exports = {
  activate: function(api) {
    api.log("CSV Importer Loaded!");
    
    api.registerCommand('import-custom-csv', async (file) => {
      // Custom logic here
    });
  }
};
```

### C. Future Expansions

1.  **Workflow Nodes**: Allow plugins to register new node types in the RAG workflow editor.
2.  **UI Widgets**: Use `BrowserView` or `<iframe>` to load plugin HTML safely.

## 4. Balancing Act

- **Core is Closed**: The compiled binary and bytecode prevent easy theft of your proprietary algorithms (e.g., your specific RAG tuning or privacy guard logic).
- **Edge is Open**: The `PluginManager` and exposed APIs allow the community to build tools *around* your core, increasing the ecosystem value without compromising your IP.
