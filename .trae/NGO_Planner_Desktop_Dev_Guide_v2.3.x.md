# NGO Planner Desktop 开发日志与维护指南

**版本**: 2.3.x
**生成日期**: 2026-01-30
**适用对象**: 开发人员、维护人员
**文档定位**: 全局架构扫描与开发规范手册

---

## 1. 项目概览 (Overview)

本项目 **NGO Planner Desktop** 是一个基于 **Electron + React** 的现代化桌面端应用，专为公益人打造。它集成了本地优先 (Local-First) 的 RAG 知识库、项目管理台账、AI 辅助写作和多模态文件处理功能。

### 核心技术栈
*   **运行时**: Electron v28 (主进程), Node.js
*   **前端**: React v19, TypeScript, Vite, TailwindCSS
*   **AI/RAG**: 
    *   **向量库**: LanceDB (嵌入式文件型向量数据库)
    *   **模型**: Transformers.js (本地 ONNX 推理), OpenAI/Gemini/DeepSeek (云端可选)
*   **数据存储**: 
    *   **Better-SQLite3**: 存储结构化业务数据 (项目、设置、关系图谱)
    *   **LanceDB**: 存储非结构化文本切片与向量
*   **Python 扩展**: 
    *   `privacy_guard.py`: 隐私去敏服务 (PII Masking)
    *   `transcribe.py`: 离线语音转录 (Whisper)

---

## 2. 完整目录结构解析 (Directory Structure)

本项目采用 **扁平化源码结构**（无 `src` 目录），根目录即为源码入口。以下是全盘扫描（包含隐藏目录与运维目录）后的详细结构说明。

### 🔴 根目录运维层 (Operational Root)
这些目录对软件的**运行机制、数据存储和备份策略**至关重要：

| 目录 | 状态 | 说明 | 核心逻辑关联 |
| :--- | :--- | :--- | :--- |
| **`electron/`** | **核心** | Electron 主进程代码，包含应用生命周期、Node.js 服务、Python 脚本集成。 |
| **`components/`** | **UI** | React 组件库，按功能模块划分。 |
| **`services/`** | **前端服务** | 封装 API 调用、数据逻辑、LLM 接口。 |
| **`backups/`** | **活跃** | 存放自动生成的备份文件 (`.tar.gz`)。 | **数据安全**: 系统定期打包数据库和配置至此。 |
| **`rag_storage/`** | 预留 | 向量数据库的开发环境挂载点。 | **RAG**: 生产环境指向 `userData/lancedb_store`。 |
| **`models/`** | 预留 | 本地 AI 模型挂载点。 | **AI**: 实际模型存储在 `resources/models`。 |
| **`mock_userdata/`** | 测试 | 模拟用户数据目录。 | **测试**: 用于开发时不污染本机真实数据。 |
| **`logs/`** | 活跃 | 存放应用运行日志。 | **排错**: 记录系统异常与运行状态。 |
| **`dist/`** | 构建 | `npm run build` 生成的前端静态资源。 | **构建**: Vite 的输出目录。 |
| **`resources/`** | 资源 | 打包时复制到安装包内的资源 (PDF字体、模型)。 | **发布**: `electron-builder` 配置项。 |

### 🔵 源码层详解 (Source Code Deep Dive)

#### 📂 Electron 主进程 (`electron/`)
*   **`main.js`**: 应用入口，负责创建窗口、IPC 通信注册。
*   **`services/rag/`**: **[RAG 核心引擎]**
    *   `ragEngine.js`: 总控制器，协调摄入、检索与生成。
    *   `vectorStore.js`: 封装 LanceDB 操作 (增删改查)。
    *   `fileProcessor.js`: 多格式文件解析 (PDF, Docx, OCR)。
    *   `embedding.js`: 向量生成服务 (支持本地/云端切换)。
*   **`python/`**: **[Sidecar 脚本]**
    *   `privacy_guard.py`: 隐私沙箱服务 (常驻进程，通过 Stdin/Stdout 通信)。
    *   `transcribe.py`: 语音转录脚本 (一次性任务)。
*   **`databaseManager.js`**: **[SQLite 管理]** 定义了所有表结构 (`projects`, `kb_file_stats` 等)。

#### 📂 React 组件 (`components/`)
*   **`KnowledgeBase/`**: 知识库界面，包含文件上传、切片可视化。
*   **`ReadingMode/`**: 沉浸式阅读器与摘要编辑器。
*   **`MultidimensionalTable.tsx`**: **[性能核心]** 基于 `react-window` 的虚拟化表格，用于处理万级项目台账。

---

## 3. 数据存储架构 (Data Architecture)

软件采用了 **"混合存储" (Hybrid Storage)** 策略：

### A. 结构化数据 (SQLite)
*   **文件**: `ngo_data.db`
*   **位置**: `userData/database/` (开发时可能指向 `mock_userdata`)
*   **核心表**:
    *   `projects`: 项目台账主表。
    *   `kb_file_stats`: 文件状态（引用计数、标签、摘要）。
    *   `entity_relationships`: 实体关系图谱。
    *   `knowledge_cards`: 知识卡片。

### B. 向量数据 (LanceDB)
*   **引擎**: LanceDB
*   **位置**: `userData/lancedb_store`
*   **机制**: **Parent-Child 索引**。
    *   **Child Chunk**: 小切片，用于生成向量和检索 (高精准度)。
    *   **Parent Chunk**: 大切片，存储在 `context` 字段，用于喂给 LLM (高上下文)。

---

## 4. 核心功能逻辑 (Core Logic)

### 4.1 RAG 知识库与隐私沙箱
1.  **摄入**: 文件 -> `fileProcessor` -> 文本提取 -> 切分 (Parent-Child) -> Embedding -> LanceDB。
2.  **检索**: 用户提问 -> Embedding -> 向量搜索 (LanceDB) -> 获取 Parent Context。
3.  **隐私保护 (Privacy Sandbox)**:
    *   在发送给云端 LLM 前，Context 会通过 `privacy_guard.py`。
    *   **脱敏**: 识别 PII (人名、电话) 并替换为 `<PERSON_1>`。
    *   **还原**: LLM 返回答案后，本地自动将占位符还原为真实信息。
    *   **优势**: 云端模型从未接触真实敏感数据。

### 4.2 Python Sidecar 集成
Electron 通过 Node.js `child_process` 管理 Python 进程：
*   **一次性任务**: `spawn` 启动 -> 执行 -> 退出 (如音频转录)。
*   **常驻服务**: `spawn` 启动 -> 保持存活 -> 流式通信 (如隐私服务)，减少冷启动开销。

### 4.3 虚拟化表格 (Performance)
*   **组件**: `MultidimensionalTable.tsx`
*   **原理**: 仅渲染视口内的 DOM 节点。无论数据量多大，DOM 节点数量恒定，保证滚动流畅 (60fps)。

---

## 5. 命名规范 (Naming Conventions)

*   **React 组件文件**: `PascalCase` (e.g., `KnowledgeBase.tsx`)
*   **服务/工具/脚本**: `camelCase` (e.g., `ragEngine.js`, `dateUtils.ts`)
*   **目录**:
    *   组件目录: `PascalCase` (e.g., `components/FilePreview/`)
    *   逻辑目录: `camelCase` (e.g., `electron/services/`)
*   **Python 脚本**: `snake_case` (e.g., `privacy_guard.py`)
*   **常量**: `UPPER_SNAKE_CASE` (e.g., `MAX_RETRY_COUNT`)

---

## 6. 维护与扩展指南 (Maintenance)

### 路径处理 (Path Handling)
*   **严禁硬编码**: 禁止使用绝对路径。
*   **环境判断**:
    ```javascript
    const modelPath = isDev 
        ? path.resolve(__dirname, '../../../resources/models') // 开发环境
        : path.join(process.resourcesPath, 'models');          // 生产环境
    ```

### 添加新页面
1.  在 `components/` 下新建组件。
2.  在 `App.tsx` 添加路由。
3.  在 `SmartSidebarWrapper.tsx` 添加侧边栏入口。

### 常见陷阱
1.  **原生模块**: `better-sqlite3` 和 `lancedb` 依赖 C++ 编译。切换环境后需运行 `npm run postinstall` 或 `electron-rebuild`。
2.  **进程通信**: 渲染进程 (UI) 必须通过 `window.electronAPI` (IPC) 与主进程通信，不可直接操作数据库。


## 7. 更新日志 (Changelog)

### 📅 2026-03-30 13:40:49
**提交信息**: fix: handle spawn ENOENT in managed installers for packaged app

- **🔴 Core (Electron/Main)**:
  - `electron/services/claudeCodeInstaller.js`
  - `electron/services/openclawInstaller.js`

---


### 📅 2026-03-30 12:11:01
**提交信息**: chore: security audit fixes and latest sync

- **🔴 Core (Electron/Main)**:
  - `electron/databaseManager.js`
  - `electron/openclaw-extensions/ngo-planner-bridge/index.js`
  - `electron/openclaw-extensions/ngo-planner-bridge/openclaw.plugin.json`
  - `electron/preload.js`
  - `electron/services/interconnectService.js`
  - ... (共 7 个文件)
- **🔵 UI (Components)**:
  - `components/AIAgentWorkspace.tsx`
  - `components/ClaudeCodeTerminal.tsx`
  - `components/KnowledgeBase.tsx`
  - `components/OpenClawDashboardPanel.tsx`
  - `components/ProjectIntelWorkbench/InterconnectJobsPanel.tsx`
  - ... (共 8 个文件)
- **🟡 Services/Logic**:
  - `services/llm/CustomOpenAIProvider.ts`
  - `services/llm/DeepSeekProvider.ts`
  - `services/llm/index.ts`
- **🟣 Docs/Others**:
  - `App.tsx`
  - `index.css`

---


### 📅 2026-03-16 12:33:16
**提交信息**: Auto update

- **🟣 Docs/Others**:
  - `.husky/pre-commit`

---


### 📅 2026-03-06 12:53:43
**提交信息**: chore: fix duplicate changelog and enhance security check

- **⚪ Config/Scripts**:
  - `scripts/sync-github.sh`
- **🟣 Docs/Others**:
  - `.husky/pre-commit`
  - `.trae/NGO_Planner_Desktop_Dev_Guide_v2.3.x.md`

---


### 📅 2026-03-06 12:35:15
**提交信息**: Auto sync update

- **🔴 Core (Electron/Main)**:
  - `electron/databaseManager.js`
  - `electron/main.js`
  - `electron/preload.js`
  - `electron/services/openclawService.js`
  - `electron/services/pluginManager.js`
  - ... (共 6 个文件)
- **🔵 UI (Components)**:
  - `components/AIAgentWorkspace.tsx`
  - `components/ClaudeCodeTerminal.tsx`
  - `components/CommunityManager.tsx`
  - `components/DesignWorkshop.tsx`
  - `components/OpenClawWorkbench.tsx`
  - ... (共 9 个文件)
- **🟡 Services/Logic**:
  - `services/promptLibraryService.ts`
  - `services/visualDesignService.ts`
- **⚪ Config/Scripts**:
  - `docs/generated/capability-baseline.generated.json`
  - `docs/generated/capability-catalog.generated.json`
  - `docs/generated/capability-diff.generated.json`
  - `docs/generated/capability-review.generated.json`
  - `package-lock.json`
  - ... (共 7 个文件)
- **🟣 Docs/Others**:
  - `App.tsx`
  - `check_openclaw.js`
  - `debug_db.js`
  - `docs/assets/.gitkeep`
  - `"docs/generated/\350\203\275\345\212\233\347\233\256\345\275\225\345\267\256\345\274\202.generated.md"`
  - ... (共 7 个文件)

---


### 📅 2026-03-02 15:23:17
**提交信息**: Auto update

- **🔴 Core (Electron/Main)**:
  - `electron/databaseManager.js`
  - `electron/main.js`
  - `electron/services/openclawService.js`
  - `electron/services/social/socialmediamanager.js`
- **🔵 UI (Components)**:
  - `components/AIAgentWorkspace.tsx`
  - `components/CommunityManager.tsx`
- **⚪ Config/Scripts**:
  - `scripts/maintenance.js`
  - `scripts/security-scan.js`
  - `scripts/sync-github.sh`
- **🟣 Docs/Others**:
  - `.trae/NGO_Planner_Desktop_Dev_Guide_v2.3.x.md`
  - `check_openclaw.js`
  - `debug_db.js`

---


### 📅 2026-03-02 15:23:02
**提交信息**: chore: enhance security check workflow

- **🔴 Core (Electron/Main)**:
  - `electron/databaseManager.js`
  - `electron/main.js`
  - `electron/services/openclawService.js`
  - `electron/services/social/socialmediamanager.js`
- **🔵 UI (Components)**:
  - `components/AIAgentWorkspace.tsx`
  - `components/CommunityManager.tsx`
- **⚪ Config/Scripts**:
  - `scripts/maintenance.js`
  - `scripts/security-scan.js`
  - `scripts/sync-github.sh`
- **🟣 Docs/Others**:
  - `check_openclaw.js`
  - `debug_db.js`

---


### 📅 2026-03-02 12:30:24
**提交信息**: Auto update

- **🔴 Core (Electron/Main)**:
  - `electron/databaseManager.js`
  - `electron/main.js`
  - `electron/openclaw-extensions/ngo-planner-bridge/index.js`
  - `electron/openclaw-extensions/ngo-planner-bridge/openclaw.plugin.json`
  - `electron/openclaw-extensions/ngo-planner-bridge/package.json`
  - ... (共 27 个文件)
- **🔵 UI (Components)**:
  - `components/AIAgentWorkspace.tsx`
  - `components/AIVolunteersManager.tsx`
  - `components/AuthModal.tsx`
  - `components/ClaudeCodeTerminal.tsx`
  - `components/IndexManager.tsx`
  - ... (共 10 个文件)
- **🟡 Services/Logic**:
  - `services/mcp/types.ts`
- **⚪ Config/Scripts**:
  - `package-lock.json`
  - `package.json`
  - `resources/official_skills/index.json`
  - `resources/plugins/openclaw-console/manifest.json`
  - `sample_plugins/openclaw-console/manifest.json`
  - ... (共 8 个文件)
- **🟣 Docs/Others**:
  - `.trae/NGO_Planner_Desktop_Dev_Guide_v2.3.x.md`
  - `App.tsx`
  - `resources/bundled_plugins/wechat-ingestor/.gitkeep`
  - `resources/claude_code_runtime/README.md`
  - `resources/official-skills/skills/ngo-designer/.gitkeep`
  - ... (共 23 个文件)

---


### 📅 2026-03-02 12:30:16
**提交信息**: feat: integrate OpenClaw, Claude Code and Plugin system

- **🔴 Core (Electron/Main)**:
  - `electron/databaseManager.js`
  - `electron/main.js`
  - `electron/openclaw-extensions/ngo-planner-bridge/index.js`
  - `electron/openclaw-extensions/ngo-planner-bridge/openclaw.plugin.json`
  - `electron/openclaw-extensions/ngo-planner-bridge/package.json`
  - ... (共 27 个文件)
- **🔵 UI (Components)**:
  - `components/AIAgentWorkspace.tsx`
  - `components/AIVolunteersManager.tsx`
  - `components/AuthModal.tsx`
  - `components/ClaudeCodeTerminal.tsx`
  - `components/IndexManager.tsx`
  - ... (共 10 个文件)
- **🟡 Services/Logic**:
  - `services/mcp/types.ts`
- **⚪ Config/Scripts**:
  - `package-lock.json`
  - `package.json`
  - `resources/official_skills/index.json`
  - `resources/plugins/openclaw-console/manifest.json`
  - `sample_plugins/openclaw-console/manifest.json`
  - ... (共 8 个文件)
- **🟣 Docs/Others**:
  - `.trae/NGO_Planner_Desktop_Dev_Guide_v2.3.x.md`
  - `App.tsx`
  - `resources/bundled_plugins/wechat-ingestor/.gitkeep`
  - `resources/claude_code_runtime/README.md`
  - `resources/official-skills/skills/ngo-designer/.gitkeep`
  - ... (共 23 个文件)

---


### 📅 2026-03-02 12:20:43
**提交信息**: feat: integrate OpenClaw, Claude Code and Plugin system

- **🔴 Core (Electron/Main)**:
  - `electron/databaseManager.js`
  - `electron/main.js`
  - `electron/openclaw-extensions/ngo-planner-bridge/index.js`
  - `electron/openclaw-extensions/ngo-planner-bridge/openclaw.plugin.json`
  - `electron/openclaw-extensions/ngo-planner-bridge/package.json`
  - ... (共 27 个文件)
- **🔵 UI (Components)**:
  - `components/AIAgentWorkspace.tsx`
  - `components/AIVolunteersManager.tsx`
  - `components/AuthModal.tsx`
  - `components/ClaudeCodeTerminal.tsx`
  - `components/IndexManager.tsx`
  - ... (共 10 个文件)
- **🟡 Services/Logic**:
  - `services/mcp/types.ts`
- **⚪ Config/Scripts**:
  - `package-lock.json`
  - `package.json`
  - `resources/official_skills/index.json`
  - `resources/plugins/openclaw-console/manifest.json`
  - `sample_plugins/openclaw-console/manifest.json`
  - ... (共 6 个文件)
- **🟣 Docs/Others**:
  - `.trae/NGO_Planner_Desktop_Dev_Guide_v2.3.x.md`
  - `App.tsx`
  - `resources/bundled_plugins/wechat-ingestor/.gitkeep`
  - `resources/claude_code_runtime/README.md`
  - `resources/official-skills/skills/ngo-designer/.gitkeep`
  - ... (共 23 个文件)

---


### 📅 2026-03-02 12:16:21
**提交信息**: feat: integrate OpenClaw, Claude Code and Plugin system

- **🔴 Core (Electron/Main)**:
  - `electron/databaseManager.js`
  - `electron/main.js`
  - `electron/openclaw-extensions/ngo-planner-bridge/index.js`
  - `electron/openclaw-extensions/ngo-planner-bridge/openclaw.plugin.json`
  - `electron/openclaw-extensions/ngo-planner-bridge/package.json`
  - ... (共 27 个文件)
- **🔵 UI (Components)**:
  - `components/AIAgentWorkspace.tsx`
  - `components/AIVolunteersManager.tsx`
  - `components/AuthModal.tsx`
  - `components/ClaudeCodeTerminal.tsx`
  - `components/IndexManager.tsx`
  - ... (共 10 个文件)
- **🟡 Services/Logic**:
  - `services/mcp/types.ts`
- **⚪ Config/Scripts**:
  - `package-lock.json`
  - `package.json`
  - `resources/official_skills/index.json`
  - `resources/plugins/openclaw-console/manifest.json`
  - `sample_plugins/openclaw-console/manifest.json`
  - ... (共 6 个文件)
- **🟣 Docs/Others**:
  - `App.tsx`
  - `resources/bundled_plugins/wechat-ingestor/.gitkeep`
  - `resources/claude_code_runtime/README.md`
  - `resources/official-skills/skills/ngo-designer/.gitkeep`
  - `resources/official-skills/skills/ngo-finance/.gitkeep`
  - ... (共 22 个文件)

---


### 📅 2026-02-08 18:56:09
**提交信息**: Auto update

- **🔴 Core (Electron/Main)**:
  - `electron/databaseManager.js`
  - `electron/main.js`
  - `electron/preload.js`
  - `electron/services/projectIntel/ocrQueue.js`
  - `electron/services/projectIntel/ocrWorker.js`
  - ... (共 13 个文件)
- **🔵 UI (Components)**:
  - `components/AIVolunteersManager.tsx`
  - `components/FilePreview/PDFViewer.tsx`
  - `components/GlobalAIAssistant.tsx`
  - `components/IndexManager.tsx`
  - `components/KnowledgeBase.tsx`
  - ... (共 21 个文件)
- **🟡 Services/Logic**:
  - `services/llm/CustomOpenAIProvider.ts`
  - `services/llm/index.ts`
  - `services/mcp/appToolbox.ts`
  - `services/mcp/security.ts`
  - `services/mcp/types.ts`
- **⚪ Config/Scripts**:
  - `package.json`
  - `scripts/clean-build.sh`
- **🟣 Docs/Others**:
  - `.github/workflows/build.yml`
  - `.trae/NGO_Planner_Desktop_Dev_Guide_v2.3.x.md`
  - `App.tsx`
  - `chi_sim.traineddata`
  - `types.ts`

---


### 📅 2026-02-08 18:56:02
**提交信息**: feat: update project visualization and intelligence features

- **🔴 Core (Electron/Main)**:
  - `electron/databaseManager.js`
  - `electron/main.js`
  - `electron/preload.js`
  - `electron/services/projectIntel/ocrQueue.js`
  - `electron/services/projectIntel/ocrWorker.js`
  - ... (共 13 个文件)
- **🔵 UI (Components)**:
  - `components/AIVolunteersManager.tsx`
  - `components/FilePreview/PDFViewer.tsx`
  - `components/GlobalAIAssistant.tsx`
  - `components/IndexManager.tsx`
  - `components/KnowledgeBase.tsx`
  - ... (共 21 个文件)
- **🟡 Services/Logic**:
  - `services/llm/CustomOpenAIProvider.ts`
  - `services/llm/index.ts`
  - `services/mcp/appToolbox.ts`
  - `services/mcp/security.ts`
  - `services/mcp/types.ts`
- **⚪ Config/Scripts**:
  - `package.json`
  - `scripts/clean-build.sh`
- **🟣 Docs/Others**:
  - `.github/workflows/build.yml`
  - `.trae/NGO_Planner_Desktop_Dev_Guide_v2.3.x.md`
  - `App.tsx`
  - `chi_sim.traineddata`
  - `types.ts`

---


### 📅 2026-02-03 13:31:35
**提交信息**: Auto update

- **🔴 Core (Electron/Main)**:
  - `electron/databaseManager.js`
  - `electron/main.js`
  - `electron/preload.js`
  - `electron/services/rag/ragEngine.js`
  - `electron/utils/searchTextExtractor.js`
- **🔵 UI (Components)**:
  - `components/Calendar.tsx`
  - `components/ExtractionModal.tsx`
  - `components/KnowledgeBase.tsx`
  - `components/PlanModal.tsx`
  - `components/PlanningContextModal.tsx`
- **🟡 Services/Logic**:
  - `services/geminiService.ts`
  - `services/plannerContextService.ts`
- **⚪ Config/Scripts**:
  - `package.json`
  - `scripts/feature-nav.js`
- **🟣 Docs/Others**:
  - `.trae/NGO_Planner_Desktop_Dev_Guide_v2.3.x.md`
  - `App.tsx`
  - `types.ts`

---


### 📅 2026-02-03 13:31:30
**提交信息**: feat: add PlanningContextModal and plannerContextService

- **🔴 Core (Electron/Main)**:
  - `electron/databaseManager.js`
  - `electron/main.js`
  - `electron/preload.js`
  - `electron/services/rag/ragEngine.js`
  - `electron/utils/searchTextExtractor.js`
- **🔵 UI (Components)**:
  - `components/Calendar.tsx`
  - `components/ExtractionModal.tsx`
  - `components/KnowledgeBase.tsx`
  - `components/PlanModal.tsx`
  - `components/PlanningContextModal.tsx`
- **🟡 Services/Logic**:
  - `services/geminiService.ts`
  - `services/plannerContextService.ts`
- **⚪ Config/Scripts**:
  - `package.json`
  - `scripts/feature-nav.js`
- **🟣 Docs/Others**:
  - `App.tsx`
  - `types.ts`

---


### 📅 2026-02-01 23:22:12
**提交信息**: Auto update

- **🔴 Core (Electron/Main)**:
  - `electron/databaseManager.js`
  - `electron/main.js`
  - `electron/preload.js`
  - `electron/services/cloudSync/adapters/jianguoyunAdapter.js`
  - `electron/services/cloudSync/cloudFolderSync.js`
  - ... (共 10 个文件)
- **🔵 UI (Components)**:
  - `components/FileTree.tsx`
  - `components/KnowledgeActionBridge/.gitkeep`
  - `components/KnowledgeBase.tsx`
  - `components/KnowledgeBase/CloudSync/CloudSyncConfigModal.tsx`
  - `components/KnowledgeBase/CloudSync/CloudSyncStatus.tsx`
  - ... (共 13 个文件)
- **🟡 Services/Logic**:
  - `services/actionToKnowledge/.gitkeep`
  - `services/geminiService.ts`
  - `services/knowledgeToAction/.gitkeep`
- **⚪ Config/Scripts**:
  - `package-lock.json`
  - `package.json`
  - `scripts/maintenance.js`
  - `scripts/sync-github.sh`
  - `scripts/update-changelog.js`
- **🟣 Docs/Others**:
  - `.husky/pre-commit`
  - `.trae/NGO_Planner_Desktop_Dev_Guide_v2.3.x.md`
  - `resources/templates/.gitkeep`

---


### 📅 2026-02-01 23:22:04
**提交信息**: chore: integrate maintenance script into sync pipeline

- **🔴 Core (Electron/Main)**:
  - `electron/databaseManager.js`
  - `electron/main.js`
  - `electron/preload.js`
  - `electron/services/cloudSync/adapters/jianguoyunAdapter.js`
  - `electron/services/cloudSync/cloudFolderSync.js`
  - ... (共 10 个文件)
- **🔵 UI (Components)**:
  - `components/FileTree.tsx`
  - `components/KnowledgeActionBridge/.gitkeep`
  - `components/KnowledgeBase.tsx`
  - `components/KnowledgeBase/CloudSync/CloudSyncConfigModal.tsx`
  - `components/KnowledgeBase/CloudSync/CloudSyncStatus.tsx`
  - ... (共 13 个文件)
- **🟡 Services/Logic**:
  - `services/actionToKnowledge/.gitkeep`
  - `services/geminiService.ts`
  - `services/knowledgeToAction/.gitkeep`
- **⚪ Config/Scripts**:
  - `package-lock.json`
  - `package.json`
  - `scripts/maintenance.js`
  - `scripts/sync-github.sh`
  - `scripts/update-changelog.js`
- **🟣 Docs/Others**:
  - `.husky/pre-commit`
  - `resources/templates/.gitkeep`

---


### 📅 2026-01-31 02:58:03
**提交信息**: 您的提交信息

- **🔴 Core (Electron/Main)**:
  - `electron/databaseManager.js`
  - `electron/main.js`
  - `electron/preload.js`
- **🔵 UI (Components)**:
  - `components/AuthModal.tsx`
  - `components/FileTree.tsx`
  - `components/KnowledgeBase.tsx`
  - `components/KnowledgeBase/MessageItem.tsx`
  - `components/KnowledgeBase/MultiExplore/MultiExploreService.ts`
  - ... (共 10 个文件)
- **🟡 Services/Logic**:
  - `services/llm/DeepSeekProvider.ts`
  - `services/llm/GeminiProvider.ts`
  - `services/llm/index.ts`
- **🟣 Docs/Others**:
  - `types.ts`

---


### 📅 2026-01-30 12:40:28
**提交信息**: chore: remove test file

- **⚪ Config/Scripts**:
  - `scripts/test_changelog_trigger.txt`

---


### 📅 2026-01-30 12:40:04
**提交信息**: chore: test automatic changelog

- **⚪ Config/Scripts**:
  - `scripts/maintenance.js`

---


### 📅 2026-01-30 12:39:27
**提交信息**: chore: test automatic changelog

- **⚪ Config/Scripts**:
  - `scripts/test_changelog_trigger.txt`
- **🟣 Docs/Others**:
  - `MAINTENANCE_LOG.md`

---


### 📅 2026-01-30 12:36:56
**提交信息**: feat: add automatic changelog generation script

- **⚪ Config/Scripts**:
  - `scripts/maintenance.js`
  - `scripts/sync-github.sh`
  - `scripts/update-changelog.js`
- **🟣 Docs/Others**:
  - `MAINTENANCE_LOG.md`

---

## 8. 本次功能升级：全息智能中枢（MCP 工具箱化 + 安全策略）

本节用于记录 2026-02-07 的一次关键升级：把右下角「全息智能中枢」从“固定 if/else 的系统查询”升级为**可扩展的工具箱/调度器（MCP 风格）**，并补齐“权限确认 / 隐私脱敏 / 审计日志 / 超时保护”等生产化能力，便于后续继续迭代更多“深入到子功能”的智能操作。

### 8.1 变更动机与目标

- **解决现存问题**
  - 无法回到初始界面：对话一旦产生无法快速“复位”。
  - 系统回答时间窗偏置：System 分支原先固定“未来10条”，会造成“回答像锁在某个时间段”的体感。
- **面向未来扩展**
  - 目标不是“多写几个 if”，而是把“识别意图 → 选择工具 → 执行工具 → 回填结果 → 复用为 recipe”固化为通用框架。
  - 支持“打开项目/打开事件/跳转模块”等 **UI Side Effect** 的可控执行（默认先确认）。

### 8.2 关键文件与职责

- `components/GlobalAIAssistant.tsx`
  - 智能中枢 UI：右下角小球 + 面板
  - Router：决定 target（assistant/system/general/navigation）
  - System 分支：对接 MCP 工具箱，执行工具并生成回答
  - 安全策略：UI/写入确认、路径脱敏、审计与超时
- `services/mcp/types.ts`
  - MCP 工具、上下文、recipe 的类型定义（ToolDefinition/ToolContext/Recipe）
- `services/mcp/appToolbox.ts`
  - 工具箱注册：集中定义工具列表（name/description/sideEffect/argsSchema/handler）
  - 工具执行器：`executeTool(...)`
  - 工具目录文本：`toolboxPromptText(...)`（用于喂给模型做 tool selection）
- `services/mcp/security.ts`
  - `sanitizeForModel(...)`：对发送给模型的数据做脱敏/裁剪（默认隐藏本机绝对路径）
  - `appendAuditLog(...)`：审计日志写入（db setting）
  - `withTimeout(...)`：工具执行超时保护
- `App.tsx`
  - 给智能中枢补充 `currentDate` 注入：保证“今天日期”一致
  - 增加 `onOpenProject`：支持从智能中枢打开项目并选中
- `components/ProjectManager.tsx`
  - 支持 `initialSelectedId` 变化时同步选中项目（便于外部深链）

### 8.3 UI 能力升级（回到初始界面）

- 在智能中枢面板右上角新增「回到初始界面」按钮：
  - 清空 messages，恢复欢迎语与快捷入口
  - 同时清理输入框与状态（routingStatus/settings）

### 8.4 System 分支：从固定查询升级为 MCP 工具调度

#### A. 旧逻辑（问题点）

- System 分支只有固定三类工具：项目、团队、近期事件，并且事件固定为“未来 10 条”。
- 不支持“打开事件/打开项目”等 UI 动作，也不支持“跨模块子功能”的深入操作。

#### B. 新逻辑（核心流程）

1. 构造 `toolCtx`（ToolContext）
   - 包含：`projects/events/teamMembers/currentDate`
   - UI 动作：`navigate/openEvent/openProject`
2. 构造工具箱 `toolbox = buildAppToolbox(toolCtx)`
3. 把工具目录文本喂给模型，让模型返回 JSON：`{ tool, args }`
4. 本地执行工具：`executeTool(toolbox, tool, args, toolCtx)`
5. 将（脱敏后的）tool result 回填给模型生成最终回答

### 8.5 工具目录（当前已落地）

> 工具是“可扩展能力面”，后续新增深入子功能时，优先新增工具而非继续堆分支。

- **通用/导航**
  - `time_now`：以 currentDate 为准返回日期与时间戳
  - `navigate`（sideEffect=ui）：跳转到模块（Calendar/Projects/MasterBoard/Leads/Knowledge/AIVolunteers/AIWorkspace）
- **日历**
  - `calendar_list_events`：支持 from/to/limit/includePast
  - `calendar_get_event`
  - `calendar_open_event`（sideEffect=ui）：跳转到 Calendar 并打开事件详情
- **项目**
  - `projects_list`
  - `projects_get`
  - `projects_open`（sideEffect=ui）：跳转到 Projects 并选中项目
- **全局任务看板**
  - `master_list_tasks`：从 projects.milestones 汇总任务（支持 status/owner/projectId/from/to/limit）
- **知识库（IPC 通道封装）**
  - `kb_list_ingested_files`：读取 `kb_ingested_files`
  - `kb_query`：RAG 检索（Electron Knowledge API）
  - `kb_get_stats`
  - `kb_get_file_metadata`：通过 `window.electronAPI.invoke('kb-get-file-metadata', ...)`
  - `kb_get_folder_meta`
  - `kb_get_file_chunks`
  - `kb_search_mounted_files`
- **Recipes（复用调度方案）**
  - `recipe_list`
  - `recipe_save`（sideEffect=write）
  - `recipe_delete`（sideEffect=write）
  - `recipe_run`（sideEffect=ui）：按 steps 顺序执行（禁止嵌套 recipe_*，防止递归）

### 8.6 安全策略（权限、隐私、审计、稳定性）

#### A. 权限确认（默认启用）

- 任何 `sideEffect=ui` 工具执行前可弹窗确认（mcp_policy.confirmUi）
- 任何 `sideEffect=write` 工具执行前可弹窗确认（mcp_policy.confirmWrite）
- UI 开关入口：智能中枢面板「设置 → 安全与权限」

#### B. 隐私脱敏（默认启用）

- 在把 Tool Result 回填给云端模型之前，对内容做脱敏与裁剪：
  - 隐藏本机绝对路径（例如 `/Users/.../xxx` 会被截断为 `…/last/segments`）
  - 限制字符串长度、对象深度与数组长度，避免把过多本地数据直接喂给模型
- 开关：mcp_policy.redactPaths

#### C. 审计日志（默认启用）

- 每次工具调用会记录：用户问题、tool、sideEffect、脱敏后的 args/result、时间戳
- 存储位置：db setting `mcp_audit_log`（最多保留 300 条，可在代码中调整）
- 开关：mcp_policy.audit

#### D. 超时保护（默认启用）

- 工具执行默认超时 15s（mcp_policy.toolTimeoutMs）
- 目的：防止 IPC/知识库查询等在异常状态下卡死 UI 流程

### 8.7 配置与数据（Settings Keys）

这些 key 通过 `window.electronAPI.db.getSetting/saveSetting` 持久化：

- `mcp_policy`：安全策略与开关（confirmUi/confirmWrite/redactPaths/audit/toolTimeoutMs）
- `mcp_recipes`：调度方案列表（Recipe：id/name/steps/createdAt/updatedAt）
- `mcp_audit_log`：审计日志（最近 N 条）

### 8.8 如何新增一个工具（推荐流程）

1. 在 `services/mcp/appToolbox.ts` 中添加一个 `McpToolDefinition`
   - 明确 sideEffect：`read` / `ui` / `write`
   - 设计 argsSchema（越严格越好）
   - handler 内只做本工具职责，不要混杂路由/对话逻辑
2. 如果工具需要 UI 动作：
   - 优先通过 ToolContext 暴露的 `navigate/openEvent/openProject` 等能力
   - 或在 App 层新增一个明确的 “openXxx” callback（再透传到 GlobalAIAssistant）
3. 如新增了 write 工具：
   - 默认会受到 confirmWrite 与审计策略约束

### 8.9 常见排错点

- **“AI 说要执行工具，但没有反应”**
  - 检查是否被权限确认弹窗拒绝（返回 user_denied）
  - 检查 toolName 是否存在于 toolbox（tool_not_found）
- **“打开项目不生效”**
  - 确认 `App.tsx` 透传了 `onOpenProject`，且 `ProjectManager` 支持 `initialSelectedId` 同步
- **“知识库工具报 electron_invoke_unavailable/kb_api_unavailable”**
  - 说明当前运行环境缺少 `window.electronAPI`（通常是非 Electron 或 preload 未注入）
  - 或对应 IPC handler 未注册/被移除（需检查 `electron/main.js` 与 preload 白名单）
