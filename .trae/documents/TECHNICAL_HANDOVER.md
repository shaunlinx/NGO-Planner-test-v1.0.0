# 公益人年历 (NGO Planner) - 技术交接文档

## 1. 项目概览

**公益人年历** 是一个专为公益从业者设计的桌面端 AI 辅助工作台。它结合了日历管理、项目策划、任务拆解和资料库管理功能，利用 LLM (Gemini/DeepSeek) 辅助生成方案和工具包。

### 技术栈
- **前端**: React 19, TypeScript, Vite, TailwindCSS
- **桌面壳**: Electron 28
- **数据库**: SQLite (better-sqlite3) - 本地存储
- **AI 服务**: Google Gemini API (主要), DeepSeek (备选)
- **构建工具**: electron-builder

---

## 2. 核心架构与现状

### 2.1 数据存储 (Local First)
目前项目采用**完全本地化**的数据策略，数据存储在用户本地设备中。
- **结构化数据**: 存储在 SQLite 数据库中 (`[UserData]/database/ngo_data.db`)。
  - 主要表: `projects` (项目详情), `files_registry` (文件索引), `settings` (配置)。
- **非结构化数据**: 生成的方案文档 (Markdown/Docx) 存储在文件系统 (`[UserData]/NGO_Manager/data/documents/`)。
- **IPC 通信**: 前端通过 `electronAPI` 与主进程通信，主进程负责所有文件和数据库操作。

### 2.2 AI 服务集成
- **Gemini**: 使用 `@google/genai` SDK，目前主要依赖此模型进行方案生成、海报绘制。
- **DeepSeek**: 通过 `fetch` 调用 REST API 手动实现，目前作为备选方案。
- **Key 管理**: 目前依赖用户在前端设置中输入 Key (存储在 `localStorage`)，或通过环境变量注入。

### 2.3 后端服务 (Server)
- 目录 `server/` 下存在一个 Express 服务，但**目前仅作为开发演示或 Mock 使用**。
- **现状**: 用户系统是基于内存的 (`const users = []`)，重启即丢失。
- **结论**: 桌面端目前并不依赖此 Server 运行，所有业务逻辑闭环在 Electron 主进程中。

---

## 3. 待开发需求与技术支持点 (致技术志愿者)

以下是目前急需解决的技术债和功能缺失，请根据优先级进行排期：

### 🔴 优先级：高 (High Priority)

#### 1. 节假日数据源修正 (✅ 已初步完成)
- **现状**: 已移除不稳定的 AI 猜测逻辑，改用 `lunar-javascript` 本地库计算。
- **已完成**: 
  - 节气、农历节日、固定公历节日：已通过天文算法实现 100% 准确。
  - 公益日：已建立 `utils/welfareDays.ts` 静态字典库。
- **剩余工作**: `lunar-javascript` 的法定节假日（调休）数据依赖 npm 包版本更新。若需获取未来一年最新的国务院调休安排（通常每年 11 月发布），建议后续接入实时 API (如 `timor.tech/api/holiday`) 作为双重保障。

#### 2. AI 配置与密钥安全 (✅ 已完成)
- **现状**: 已完成重构。
- **已完成**:
  - **LLMProvider**: 在 `services/llm` 下实现了统一的 Provider 接口，支持 Gemini 和 DeepSeek 切换。
  - **DeepSeek Streaming**: `DeepSeekProvider` 已实现完整的流式输出解析 (Server-Sent Events)。
  - **Secure Storage**: 
    - 主进程 (`electron/main.js`) 接入 `safeStorage` 加密 API。
    - 渲染进程通过 `electronAPI.secure.set/get` 存取密钥，不再明文存入 localStorage。
    - 自动登录逻辑已移至 `App.tsx`，启动时自动从加密存储中读取 Key。

### 🟡 优先级：中 (Medium Priority)

#### 3. 云端同步 (Cloud Sync)
- **现状**: `electron/storageManager.js` 中保留了 `CloudStorageProvider` 的占位符，但未实现。
- **需求**: 如果需要多端同步，需接入对象存储 (S3/OSS) 或数据库同步机制。如果定位为纯单机软件，可忽略此项。

#### 4. 知识库增强 (RAG) (✅ 重构为 Node.js 混合架构)
- **现状**: 
  - 移除了 Python 依赖，全面转向 Node.js + Electron 主进程直接集成。
  - **向量库**: LanceDB (本地文件存储，极速且无需独立服务)。
  - **Embedding**: 使用 Cloud API (支持 MiniMax/Tencent/OpenAI 协议)，需在设置中配置 Key。
  - **优势**: 
    - 内存占用极低 (无需运行 Python 进程或加载本地大模型)。
    - 维护简单 (纯 JS 技术栈)。
- **代码位置**: `electron/services/rag/`
- **下一步行动**:
  - 在前端设置页添加 `RAG API Key` 和 `Base URL` 的输入框。
  - 测试 PDF/Word 文件上传流程。

### ⚪ 优先级：低 (Low Priority) / 优化

#### 5. 服务端决策
- **现状**: `server/index.js` 处于半废弃状态。
- **需求**: 与产品负责人确认，如果不需要网页版，建议直接移除 `server` 目录，避免混淆。如果需要网页版，则需重写 Auth 模块，对接真实数据库 (MySQL/PostgreSQL)。

---

## 4. 如何开始开发

1. **环境准备**:
   - Node.js (v18+)
   - Python (构建 SQLite 依赖需要)

2. **安装依赖**:
   ```bash
   npm install
   # 遇到 electron-rebuild 问题时运行:
   npm run postinstall
   ```

3. **启动调试**:
   ```bash
   # 终端 1: 启动 React 开发服务器
   npm run dev
   
   # 终端 2: 启动 Electron 窗口 (等待 React 启动后)
   npm run electron:dev
   ```

4. **关键文件路径**:
   - 数据库逻辑: `electron/databaseManager.js`
   - AI 核心逻辑: `services/geminiService.ts`
   - IPC 桥接: `electron/preload.js`

---

**文档生成时间**: 2026-01-08
