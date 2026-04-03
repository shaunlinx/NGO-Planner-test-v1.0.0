# 修复与优化计划：全域助手球 "process is not defined" 错误

## 1. 问题诊断
- **错误原因**：`components/GlobalAIAssistant.tsx` 组件中直接使用了 `process.env.API_KEY` 来初始化 Google GenAI 客户端。在浏览器或 Electron 渲染进程（Vite 构建环境）中，`process` 全局对象通常不可用，导致运行时崩溃。
- **涉及文件**：
  - `components/GlobalAIAssistant.tsx` (主要错误点)
  - `services/llm/GeminiProvider.ts` (潜在风险点)

## 2. 修复方案
我们将通过**复用现有的安全服务层**来修复此问题，而不是在组件中打补丁。

### 步骤 1：增强 `geminiService.ts`
- **操作**：导出 `callAI` 核心函数。
- **目的**：`geminiService` 已经实现了完善的 API Key 获取逻辑（支持 Electron 安全存储、LocalStorage 和环境变量），直接复用它可以一劳永逸地解决 Key 获取和客户端初始化问题。

### 步骤 2：重构 `GlobalAIAssistant.tsx`
- **操作**：移除直接的 `new GoogleGenAI(...)` 实例化代码。
- **操作**：改用 `callAI` 函数来执行意图识别（Intent Routing）。
- **优化**：将原本硬编码的 AI 调用逻辑替换为统一的服务调用，提升代码可维护性。

### 步骤 3：加固 `GeminiProvider.ts`
- **操作**：将该文件中残留的 `process.env.API_KEY` 替换为 Vite 标准的 `import.meta.env.VITE_GEMINI_API_KEY`，防止在其他 fallback 场景下触发同样的错误。

## 3. 功能优化建议 (将在修复后实施)
针对您提到的“结合已有功能和未来需求进行优化”，我将在修复 Bug 后同步落实以下优化：
1.  **上下文感知路由**：目前的意图识别是单轮的。我将在路由请求中加入最近 3 条对话历史，使助手能理解“它目前的进度如何？”这类指代性问题。
2.  **统一模型配置**：确保助手球使用的是配置中心指定的模型（如 `gemini-2.0-flash-exp`），而不是硬编码在组件内，便于全局切换。

确认后，我将立即执行修复。