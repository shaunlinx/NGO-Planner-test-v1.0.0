const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 配置目标日志文件路径
const LOG_FILE_PATH = path.join(__dirname, '../.trae/NGO_Planner_Desktop_Dev_Guide_v2.3.x.md');

// 获取提交信息
const commitMsg = process.argv[2] || 'Auto update';

try {
    // 1. 获取暂存区的文件列表
    const stagedFiles = execSync('git diff --cached --name-only').toString().trim().split('\n').filter(Boolean);
    
    // 如果没有文件变更（且不是因为仅修改了日志文件本身导致脚本运行，虽然后者不太可能），则退出
    if (stagedFiles.length === 0) {
        console.log('⚠️ 没有检测到暂存区文件变更，跳过日志更新。');
        process.exit(0);
    }

    // 2. 准备日志内容
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    
    // 简单的文件分类统计
    const categories = {
        '🔴 Core (Electron/Main)': [],
        '🔵 UI (Components)': [],
        '🟡 Services/Logic': [],
        '⚪ Config/Scripts': [],
        '🟣 Docs/Others': []
    };

    stagedFiles.forEach(file => {
        if (file.startsWith('electron/')) categories['🔴 Core (Electron/Main)'].push(file);
        else if (file.startsWith('components/')) categories['🔵 UI (Components)'].push(file);
        else if (file.startsWith('services/')) categories['🟡 Services/Logic'].push(file);
        else if (file.startsWith('scripts/') || file.includes('json') || file.includes('.env')) categories['⚪ Config/Scripts'].push(file);
        else categories['🟣 Docs/Others'].push(file);
    });

    let changesList = '';
    for (const [category, files] of Object.entries(categories)) {
        if (files.length > 0) {
            changesList += `- **${category}**:\n`;
            // 仅列出前5个文件，避免日志过长
            files.slice(0, 5).forEach(f => changesList += `  - \`${f}\`\n`);
            if (files.length > 5) changesList += `  - ... (共 ${files.length} 个文件)\n`;
        }
    }

    const newEntry = `
### 📅 ${date} ${time}
**提交信息**: ${commitMsg}

${changesList}
---
`;

    // 3. 读取现有文件
    let content = '';
    if (fs.existsSync(LOG_FILE_PATH)) {
        content = fs.readFileSync(LOG_FILE_PATH, 'utf-8');
    } else {
        console.error(`❌ 找不到日志文件: ${LOG_FILE_PATH}`);
        process.exit(1);
    }

    // 4. 插入新日志
    const HEADER = '## 7. 更新日志 (Changelog)';
    
    if (content.includes(HEADER)) {
        // 在 Header 后插入
        const parts = content.split(HEADER);
        content = parts[0] + HEADER + '\n' + newEntry + parts[1];
    } else {
        // 追加 Header 和日志
        content += '\n\n' + HEADER + '\n' + newEntry;
    }

    // 5. 写入文件
    fs.writeFileSync(LOG_FILE_PATH, content, 'utf-8');
    console.log(`✅ 开发日志已更新: ${LOG_FILE_PATH}`);

    // 6. 自动将更新后的日志文件加入暂存区 (以便包含在本次提交中)
    try {
        // 使用 -f 强制添加，因为 .trae 目录通常被 gitignore
        execSync(`git add -f "${LOG_FILE_PATH}"`);
        console.log(`➕ 已自动暂存: ${LOG_FILE_PATH}`);
    } catch (e) {
        console.warn('⚠️ 无法自动暂存日志文件，请手动添加。');
    }

} catch (error) {
    console.error('❌ 更新开发日志失败:', error);
    process.exit(1);
}
