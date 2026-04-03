#!/bin/bash

echo "🔄 开始同步代码到 GitHub..."

# 0. 执行维护与安全检查 (包含清理、备份、安全扫描)
echo "🛠️  正在执行系统维护与安全检查..."
node scripts/maintenance.js --fix

if [ $? -ne 0 ]; then
    echo "❌ 维护脚本或安全检查失败，同步已中止。请修复问题后再试。"
    exit 1
fi

# 1. 添加所有更改 (包括维护脚本可能产生的日志更新或文件清理)
echo "📦 正在暂存文件..."
git add .

# 2. 检查是否有需要提交的更改
if ! git diff --cached --quiet; then
    # 获取提交信息
    if [ -z "$1" ]; then
        echo "📝 请输入提交信息 (直接回车默认使用: 'Auto sync update'):"
        read commit_msg
        if [ -z "$commit_msg" ]; then
            commit_msg="Auto sync update"
        fi
    else
        commit_msg="$1"
    fi

    # 通过环境变量传递提交信息给 pre-commit 钩子
    export COMMIT_MSG="$commit_msg"

    echo "💾 正在提交: $commit_msg"
    git commit -m "$commit_msg"
else
    echo "✨ 没有新的文件更改需要提交。"
fi

# 3. 推送
echo "🚀 正在推送到 GitHub..."
git push origin main

if [ $? -eq 0 ]; then
    echo "✅ 同步成功！GitHub 仓库已是最新状态。"
else
    echo "❌ 同步失败，请检查上面的错误信息。"
    exit 1
fi
