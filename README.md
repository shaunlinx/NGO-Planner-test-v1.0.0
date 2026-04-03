# 公益人年历 (NGO Planner Desktop)

专为公益人打造的 AI 策划与项目台账工作台。这是一个集成了 AI 辅助、知识库管理、项目管理和社交媒体运营的现代化AI原生桌面应用程序。

## ✨ 核心功能

### 🧠 智能知识库 (Knowledge Base RAG)

本项目采用**本地优先 (Local-First)** 的 RAG 架构，旨在为公益组织提供安全、高效且具备深度理解能力的文档管理方案。

#### 🏗️ 核心架构
- **混合检索 (Hybrid Search)**: 结合 **LanceDB** 的向量检索与 SQL 关键词匹配，并通过本地 `bge-reranker` 模型进行重排序 (Reranking)，显著提升召回准确率。
- **高性能 Worker**: 将 Embedding 生成、重排序及文件解析等计算密集型任务完全卸载至独立 Worker 线程 (`ragWorker.js`)，确保 UI 始终流畅 (60fps)。
- **父子索引策略 (Parent-Child Indexing)**: 仅对小块文本 (Child Chunk) 生成向量以节省计算资源，检索时自动回溯大块上下文 (Parent Chunk)，兼顾检索速度与上下文完整性。

#### 🛡️ 隐私沙箱 (Privacy Sandbox)
独创的隐私保护机制，确保在使用云端 LLM 时不泄露敏感数据：
- **本地拦截**: 通过 Python Sidecar (`privacy_guard.py`) 拦截所有 RAG 出站请求。
- **PII 脱敏**: 自动识别并替换人名、电话、邮箱等敏感实体 (Anonymization)。
- **透明还原**: LLM 返回结果后在本地自动还原实体信息 (De-anonymization)，云端模型从未接触真实数据。
- **文件夹级控制**: 支持对特定机密文件夹启用严格的隐私保护模式。

#### 📄 全能文档解析 (Universal Parser)
- **PDF 智能重排**: 采用流式解析 (Streaming) 与自定义布局恢复算法，完美还原多栏排版与表格结构，优于传统线性提取。
- **Office 增强**: 针对 PPT/Excel 等碎片化内容，自动通过 AI 生成**上下文摘要 (Context Enrichment)** 后再入库，提高检索相关性。
- **多媒体支持**: 内置本地 OCR (`tesseract.js`) 与离线语音转文字 (`faster-whisper`)，支持图片与音视频内容的检索。

#### 🔍 多维探索与深度阅读
- **Multi-Explore**: 支持同时向多个模型 (DeepSeek, Gemini, OpenAI) 发起查询，并根据**召回率**与**用户采纳率**自动评分，帮助用户优选最佳答案。
- **深度阅读模式**: 内置 Universal Reader，支持划词生成**知识卡片**，AI 自动分析上下文并生成语义标签，构建个人知识图谱。

### 📅 项目与任务管理
- **高性能多维表格**: 采用 `react-window` 实现虚拟滚动，轻松处理万级数据流畅渲染。
- **可视化看板**: 支持甘特图 (Gantt)、看板 (Kanban) 视图，直观管理项目进度与依赖关系。
- **智能台账**: 自动化的财务与物资管理功能，支持 Excel 导入导出。

### 🌐 社交媒体与调研
- **社媒矩阵管理**: 集成多平台发布与内容管理。
- **AI 调研助手**: 自动化的网络调研工具，支持信息收集与自动摘要。

## 🛠️ 技术栈

- **Core**: [Electron](https://www.electronjs.org/) (多进程架构), [React](https://react.dev/), [TypeScript](https://www.typescriptlang.org/)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Data & AI**:
    - **Vector DB**: [LanceDB](https://lancedb.com/) (本地嵌入式向量数据库)
    - **Models**: Transformers.js (本地推理), OpenAI/Gemini/DeepSeek API
    - **Parsing**: pdfjs-dist, mammoth, office-text-extractor, tesseract.js
- **Python Sidecar**: 独立 Python 进程，用于隐私计算 (`privacy_guard.py`) 与离线语音识别 (`transcribe.py`)。

## 🚀 快速开始

### 前置要求
- Node.js (推荐 v18+)
- Python 3.x (用于隐私沙箱与后台服务)

### 安装依赖

```bash
npm install
```

### 开发模式运行

启动开发服务器与 Electron 主进程：

```bash
npm run electron:dev
```

### 构建发布

构建 macOS 应用 (支持 x64 与 arm64)：

```bash
npm run dist
```

## 🔒 安全说明

本项目包含自动化的安全扫描脚本，运行以下命令进行安全检查：

```bash
npm run security:scan
```

---
Copyright © 2025 NGO Planner Team
