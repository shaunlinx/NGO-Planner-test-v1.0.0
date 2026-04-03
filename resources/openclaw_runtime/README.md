本目录用于“产品级”托管安装 OpenClaw 的离线资源（随安装包一起分发）。

建议结构：

- node/
  - darwin-arm64/  （解压后的 Node 运行时目录，包含 bin/node 与 bin/npm）
  - darwin-x64/
  - win-x64/
  - win-arm64/
  - linux-x64/
  - linux-arm64/
- openclaw/
  - openclaw.tgz   （可选：openclaw 的 npm 包 tarball，用于完全离线安装）

运行时行为：
- 若检测到 node/<platform>/，将优先使用离线 Node，不联网下载
- 若检测到 openclaw/openclaw.tgz，将离线安装 openclaw；否则回退到 npm registry 安装

