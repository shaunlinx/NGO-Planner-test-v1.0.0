
/**
 * StorageManager - 前端旁路持久化代理
 * 职责：镜像接收 AI 结果，静默发送至桌面物理层，不干扰 UI 渲染。
 */
export class StorageManager {
    
    /**
     * 旁路持久化数据
     * @param content 内容文本流
     * @param fileName 建议文件名
     * @param metadata 元数据 (项目ID, 类别)
     */
    static async persist(
        content: string, 
        fileName: string, 
        metadata: { projectId?: string; category: 'PLAN' | 'REPORT' | 'DATA' }
    ) {
        const api = (window as any).electronAPI;
        if (!api || !api.storage) {
            console.debug("[StorageManager] 非桌面环境或接口未就绪，跳过物理持久化。");
            return;
        }

        // 异步调用，立即返回，不阻塞前端
        api.storage.persist({
            content,
            fileName,
            projectId: metadata.projectId,
            category: metadata.category
        }).then((res: any) => {
            if (res.success) {
                console.log(`[StorageManager] 物理备份就绪: ${res.path}`);
            } else {
                console.warn(`[StorageManager] 备份失败: ${res.error}`);
            }
        });
    }
}
