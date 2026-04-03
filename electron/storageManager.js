

const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const dbManager = require('./databaseManager');
const { v4: uuidv4 } = require('uuid');

/**
 * 接口契约概念 (IStorageProvider)
 * 1. saveFile(content, fileName, subDir)
 * 2. getFilePath(fileName)
 */

class LocalStorageProvider {
    constructor() {
        // 统一使用 [UserData]/storage 目录，与 main.js 初始化逻辑保持一致
        this.baseDir = path.join(app.getPath('userData'), 'storage');
        this.ensureBaseDir();
    }

    ensureBaseDir() {
        if (!fs.existsSync(this.baseDir)) {
            fs.mkdirSync(this.baseDir, { recursive: true });
        }
    }

    async saveFile(content, fileName, category = 'PLAN') {
        try {
            const subFolder = path.join(this.baseDir, category);
            if (!fs.existsSync(subFolder)) fs.mkdirSync(subFolder, { recursive: true });

            const finalFileName = fileName.endsWith('.docx') || fileName.endsWith('.pdf') || fileName.endsWith('.csv') || fileName.endsWith('.md')
                ? fileName 
                : `${fileName}.docx`; // 默认后缀，视情况可改为 .md

            const fullPath = path.join(subFolder, finalFileName);
            
            // 使用 Promise 版本的 writeFile 以避免阻塞主线程
            await fs.promises.writeFile(fullPath, content, 'utf-8');
            return fullPath;
        } catch (err) {
            if (err.code === 'ENOSPC') throw new Error("DiskFull");
            if (err.code === 'EACCES') throw new Error("PermissionError");
            throw err;
        }
    }
}

/**
 * 云端预留架构 (CloudStorageProvider)
 */
class CloudStorageProvider {
    constructor(config = {}) {
        this.apiKey = config.apiKey || '';
        this.bucketName = config.bucketName || '';
    }
    // TODO: Future Cloud Upload 实现
    async saveFile(content, fileName) { 
        console.log("[CloudStorage] Future implementation placeholder");
        return null; 
    }
}

class StorageManager {
    constructor() {
        this.localProvider = new LocalStorageProvider();
        this.cloudProvider = new CloudStorageProvider(); // 预留
    }

    async persist(data) {
        const { content, fileName, projectId, category } = data;
        let absolutePath = '';
        
        try {
            // 1. 调用本地 Provider 执行物理存储
            absolutePath = await this.localProvider.saveFile(content, fileName, category);

            // 2. 数据库旁路记录 (非阻塞)
            if (absolutePath) {
                await dbManager.registerFile({
                    id: `file-${Date.now()}-${Math.random().toString(36).substr(2,5)}`,
                    projectId: projectId,
                    fileName: path.basename(absolutePath),
                    absolutePath: absolutePath,
                    storageType: 'local',
                    category: category
                });
            }

            // TODO: Future Cloud Upload (在此处链式调用 cloudProvider)
            
            return { success: true, path: absolutePath };
        } catch (err) {
            // 健壮性：静默记录错误，不中断 UI
            console.error(`[StorageManager Error] ${err.message}`);
            return { success: false, error: err.message };
        }
    }
}

module.exports = new StorageManager();
