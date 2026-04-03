
/**
 * DataPersistenceService - 独立数据持久化观察者模块
 * 原则：不修改 UI，不阻塞 AI 生成，静默在本地 AppData 中按类归档。
 */
export class DataPersistenceService {
    
    /**
     * 静默保存 AI 结果
     * @param content 内容字符串
     * @param category 类别：'PLAN' | 'REPORT' | 'DATA'
     * @param metadata 附加元数据
     */
    static async saveResult(
        content: string, 
        category: 'PLAN' | 'REPORT' | 'DATA', 
        metadata: { projectId?: string; rawName: string }
    ) {
        if (!(window as any).electronAPI) {
            console.debug("[DataPersistenceService] Non-desktop environment, skipping silent persist.");
            return;
        }

        // 异步执行，不等待返回，不阻塞后续逻辑
        (window as any).electronAPI.storage.persist({
            projectId: metadata.projectId,
            content: content,
            category: category,
            fileName: metadata.rawName
        }).then((res: any) => {
            if (res.success) {
                // TODO: Future Cloud Upload (在此处预留云端同步逻辑)
                // console.log("Cloud upload placeholder called for:", res.path);
            }
        });
    }
}
