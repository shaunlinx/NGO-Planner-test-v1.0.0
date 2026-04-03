把 Claude Code 可执行体放到这个目录，用于随应用一起打包（extraResources → process.resourcesPath/claude_code_runtime）。

默认查找路径：
- claude_code_runtime/claude
- claude_code_runtime/bin/claude

也可在开发/自定义环境通过环境变量指定：
- NGOPLANNER_CLAUDE_CODE_BIN=/absolute/path/to/claude

