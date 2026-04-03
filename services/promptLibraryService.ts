import { PromptLibraryItem } from '../types';
import { llmFactory } from './llm';

const PROMPTS_DIR_NAME = 'Prompts';

const resolveBasePath = async (basePath: string): Promise<string> => {
    if (basePath) return basePath;
    if (window.electronAPI) {
        const userData = await window.electronAPI.getPath('userData');
        return `${userData}/storage/DATA`;
    }
    return '';
};

// Get Prompts Directory Path (Async via IPC)
const getPromptsPath = async (): Promise<string> => {
    // We assume the main process created 'storage/DATA/Prompts' in userData
    // We can't easily get the absolute path of userData in renderer without IPC
    // So we will rely on a relative path concept or use a specific IPC to get it.
    // However, existing `fs` API in preload expects absolute paths for `readDir`.
    // Let's assume we can construct it if we knew the root.
    // Better approach: Use `window.electronAPI.fs.ensureDir` with a known base if possible.
    // OR: Just ask Main process where the prompts are? No, that's overengineering.
    
    // Hack: We can use the `storage` manager's path or `dialog` to find it? No.
    // Let's try to deduce it or use a specific "App Data" folder if exposed.
    // `window.electronAPI.fs.readDir` takes an absolute path.
    
    // Workaround: We will use `window.electronAPI.storage.persist` logic which saves to `storage/DATA`
    // but that API handles writing, not listing.
    
    // Let's add a helper in Main to "get storage path" or just hardcode if we can get Home dir.
    // Actually, `window.electronAPI.fs.selectFolder` is manual.
    
    // Let's use a trick: Try to read a known path or ask the user? No.
    // Re-check preload: `ipcRenderer.invoke('app-get-path', 'userData')`? Not exposed.
    
    // OK, I will modify `preload.js` and `main.js` to expose `getAppPath`.
    // BUT, I can't modify them easily without restarting the thought loop.
    
    // Wait, I can use `window.electronAPI.db.getSetting('prompts_path')`?
    // Or I can use the existing `storageManager` on the main process side?
    
    // Let's just assume I can write to a folder relative to the "Project Warehouse" if available?
    // The user said "Knowledge Base independent folder".
    // If `warehousePath` is set (in PlanModal), we can use `${warehousePath}/Knowledge/Prompts`.
    // This is better! It keeps data with the user's data.
    
    return ''; // Placeholder
};

export const savePromptToLibrary = async (
    content: string, 
    source: PromptLibraryItem['source'],
    basePath: string, // Passed from component (warehousePath or default)
    previewImage?: string
): Promise<PromptLibraryItem> => {
    if (!content.trim()) throw new Error("提示词为空");
    
    // 1. Generate Tags
    let tags: string[] = [];
    try {
        tags = await generateTagsForPrompt(content);
    } catch (e) {
        console.warn("Tag generation failed", e);
        tags = ['Uncategorized'];
    }

    const item: PromptLibraryItem = {
        id: `prompt-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        content,
        tags,
        source,
        createdAt: Date.now(),
        previewImage
    };

    const fileName = `${item.id}.json`;
    
    // Fallback logic for Global Library if no project basePath provided
    let finalBasePath = '';
    try {
        finalBasePath = await resolveBasePath(basePath);
    } catch (e) {
        console.warn("Failed to resolve base path", e);
    }

    const fullDir = `${finalBasePath}/Knowledge/Prompts`;
    const fullPath = `${fullDir}/${fileName}`;

    if (window.electronAPI) {
        await window.electronAPI.fs.ensureDir(fullDir);
        await window.electronAPI.fs.writeFile(fullPath, JSON.stringify(item, null, 2));
    }

    return item;
};

export const loadPromptsFromLibrary = async (basePath: string): Promise<PromptLibraryItem[]> => {
    try {
        basePath = await resolveBasePath(basePath);
    } catch (e) {
        return [];
    }

    const fullDir = `${basePath}/Knowledge/Prompts`;
    if (!window.electronAPI) return [];

    try {
        if (!await window.electronAPI.fs.exists(fullDir)) return [];
        
        const files = await window.electronAPI.fs.readDir(fullDir);
        const prompts: PromptLibraryItem[] = [];

        for (const file of files) {
            if (file.name.endsWith('.json')) {
                const res = await window.electronAPI.fs.readFile(file.path);
                if (res.success && res.data) {
                    try {
                        const parsed = JSON.parse(res.data);
                        if (!parsed.deletedAt) prompts.push(parsed);
                    } catch (e) {
                        console.error(`Error parsing prompt ${file.name}`, e);
                    }
                }
            }
        }
        return prompts.sort((a, b) => b.createdAt - a.createdAt);
    } catch (e) {
        console.error("Failed to load prompts", e);
        return [];
    }
};

export const updatePromptInLibrary = async (item: PromptLibraryItem, basePath: string): Promise<void> => {
    if (!window.electronAPI) return;
    const resolved = await resolveBasePath(basePath);
    const fullDir = `${resolved}/Knowledge/Prompts`;
    const fullPath = `${fullDir}/${item.id}.json`;
    await window.electronAPI.fs.ensureDir(fullDir);
    await window.electronAPI.fs.writeFile(fullPath, JSON.stringify(item, null, 2));
};

export const deletePromptFromLibrary = async (item: PromptLibraryItem, basePath: string): Promise<void> => {
    if (!window.electronAPI) return;
    const resolved = await resolveBasePath(basePath);
    const fullPath = `${resolved}/Knowledge/Prompts/${item.id}.json`;
    const res = await window.electronAPI.fs.deleteFile(fullPath);
    if (!res?.success) {
        const deletedItem: PromptLibraryItem = { ...item, deletedAt: Date.now() };
        await updatePromptInLibrary(deletedItem, basePath);
    }
};

const generateTagsForPrompt = async (prompt: string): Promise<string[]> => {
    const provider = llmFactory.getProvider();
    const promptText = `
    Analyze this image generation prompt and extract 3-5 concise tags (keywords) that describe the style, subject, and mood.
    Output only the tags separated by commas. No other text.
    
    Prompt: "${prompt}"
    `;

    const response = await provider.generateContent({
        prompt: promptText,
        model: 'gemini-1.5-flash' 
    });

    const text = response.text || '';
    return text.split(/,|，/).map(t => t.trim()).filter(t => t.length > 0 && t.length < 15).slice(0, 5);
};
