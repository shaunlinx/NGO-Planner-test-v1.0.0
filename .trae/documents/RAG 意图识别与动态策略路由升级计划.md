# 升级方案：基于“动态策略生成”的 Agentic RAG

## 1. 核心理念转变
从传统的 **“基于分类的意图识别” (Classification-based)** 转向 **“基于指令的策略生成” (Instruction-driven Strategy Generation)**。

我们不再预设“QA”、“Summary”、“Comparison”等有限的分类桶，因为用户的真实需求是无限可能的。相反，我们将利用 LLM 强大的理解能力，让它直接充当**“检索策略配置师”**，为每一个 Query 动态生成一套专属的检索参数配置（Retrieval Strategy Configuration）。

## 2. 技术架构设计

### A. 引入 `QueryStrategy` 协议
在 `analyzeQueryIntent` 阶段，LLM 将输出一个包含具体执行指令的 JSON 对象，而非简单的标签。

```javascript
// 示例：LLM 针对 "综述这三篇文章" 生成的策略
{
  "searchMode": "scan", // 扫描模式，而非搜索模式
  "retrievalScope": "file_centric", // 以文件为中心，而非以 Query 为中心
  "contextRequirement": "broad", // 需要广泛上下文 (Broad) vs 精准切片 (Precise)
  "keywords": [], // 综述类任务不需要关键词
  "rationale": "用户要求综述，关键词检索效率低，应直接提取文档核心段落。"
}
```

### B. 改造 `analyzeQueryIntent` (The Brain)
Prompt 将被重写，指示 LLM 分析用户需求并决定：
1.  **Search Mode**: 是需要去“搜”（Search）还是直接去“读”（Scan/Read）？
2.  **Granularity**: 是关注“细节”（Needle in haystack）还是“全貌”（Bird's eye view）？
3.  **Correction**: 是否需要改写查询词（例如把“综述”去掉，变成空查询以匹配所有内容）？

### C. 改造 `query` 引擎 (The Muscle)
`query` 方法将根据 `QueryStrategy` 动态调整流水线：

1.  **If `searchMode == 'scan'` (针对综述/分析类)**:
    *   **旁路向量搜索**：跳过 `vectorStore.search`，因为语义匹配在这里是噪音。
    *   **直接提取**：直接调用 `vectorStore` 获取目标文件的**代表性切片**（如 Top N 顺序切片，或基于 TextRank 的关键切片）。
    *   **上下文组装**：按文件结构组装，而非按相似度排序。

2.  **If `searchMode == 'search'` (针对 QA/检索类)**:
    *   执行现有的 PDR + MMR 流水线。
    *   根据 `contextRequirement` 动态调整 `topK` (e.g., broad -> topK=30, precise -> topK=10).

## 3. 具体实施步骤

### 步骤 1: 重构 `analyzeQueryIntent`
*   **Prompt 升级**：不再输出 `type`，而是输出 `strategy` 对象。
*   **逻辑增强**：让 LLM 判断是否应该忽略用户的 Query 文本（例如用户说“总结一下”，此时 Query 文本对检索无用，应被视为空）。

### 步骤 2: 实现“文件扫描” (File Scanning) 逻辑
*   在 `query` 中增加处理 `scan` 模式的分支。
*   实现一个 `fetchDocumentOverviews` 辅助函数：
    *   对于选定的每个文件，提取其前 2000 字符（Intro） + 后 1000 字符（Conclusion） + 随机/均匀采样的中间切片。
    *   这模拟了人类“快速翻阅”一本书的行为。

### 步骤 3: 对接与测试
*   验证“综述这三篇文章”是否触发 `scan` 模式。
*   验证“项目预算是多少”是否触发 `search` 模式。

## 4. 方案优势
*   **泛化能力强**：无需穷举所有问法，只要 LLM 能理解语义，就能配置出正确的参数。
*   **精准打击**：彻底解决“用‘综述’去匹配文档切片”的逻辑谬误。
*   **可扩展**：未来可以轻松增加新的策略参数（如 `timeRange`、`entityFocus`），而无需重写整个分类逻辑。
