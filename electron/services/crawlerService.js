const { BrowserWindow, ipcMain, app } = require('electron');
const path = require('path');

let crawlerWindow = null;
let isCrawling = false;

// Heuristic script to inject into the target page
const INJECT_SCRIPT = `
(function() {
    window.crawlerAPI = {
        // Find all detail page links from the list
        findLinks: () => {
            const links = Array.from(document.querySelectorAll('a'));
            // Filter for links that likely point to detail pages (contain images, have specific patterns)
            // For Jimeng, we look for links wrapping images in a grid
            const candidates = links.filter(a => {
                const hasImg = a.querySelector('img');
                const isInternal = a.href.includes(window.location.origin);
                const isDetail = a.href.includes('/detail') || a.href.includes('itemId=');
                return hasImg && isInternal; // Broad filter, refined by 'isDetail' if possible
            });
            
            // Deduplicate
            const unique = [...new Set(candidates.map(a => a.href))];
            return unique;
        },

        // Extract prompt from a detail page
        extractData: () => {
            // Strategy 1: Look for "Copy" buttons and grab text near them
            // Strategy 2: Look for long text blocks
            // Strategy 3: Look for specific class names (fragile)
            
            // Try to find the image first
            const mainImg = document.querySelector('img[class*="preview"], img[class*="detail"]');
            const imgSrc = mainImg ? mainImg.src : null;

            // Try to find prompt text
            // Heuristic: The prompt is usually the largest block of text, or labeled "Prompt" / "提示词"
            let prompt = "";
            
            // Search for typical prompt containers
            const textElements = Array.from(document.querySelectorAll('p, div, span, textarea'));
            const potentialPrompts = textElements.filter(el => {
                const text = el.innerText;
                // Prompts are usually long English or mixed text
                return text && text.length > 20 && (
                    text.includes(',') || text.includes(' ')
                );
            });

            // Sort by length (descending) - prompts are usually the longest description block
            potentialPrompts.sort((a, b) => b.innerText.length - a.innerText.length);
            
            if (potentialPrompts.length > 0) {
                prompt = potentialPrompts[0].innerText;
            }

            return {
                image: imgSrc,
                prompt: prompt,
                title: document.title,
                url: window.location.href
            };
        }
    };
})();
`;

class CrawlerService {
    constructor(mainWindow, dbManager) {
        this.mainWindow = mainWindow;
        this.dbManager = dbManager;
    }

    async startSession(url) {
        if (crawlerWindow) {
            crawlerWindow.focus();
            return;
        }

        crawlerWindow = new BrowserWindow({
            width: 1200,
            height: 800,
            title: "智能采集器 - 请先在此窗口登录",
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true,
                sandbox: false, // Allow some freedom for injection
                preload: path.join(__dirname, '../preload.js') // Reuse main preload for simplicity if compatible
            }
        });

        crawlerWindow.loadURL(url);

        crawlerWindow.on('closed', () => {
            crawlerWindow = null;
            isCrawling = false;
            this.sendUpdate('status', '采集器已关闭');
        });

        // Inject our helper tools when page loads
        crawlerWindow.webContents.on('did-finish-load', () => {
            crawlerWindow.webContents.executeJavaScript(INJECT_SCRIPT).catch(console.error);
        });
    }

    async startCrawlTask() {
        if (!crawlerWindow) return { success: false, message: "采集器窗口未打开" };
        if (isCrawling) return { success: false, message: "正在采集中..." };

        isCrawling = true;
        this.sendUpdate('status', '正在分析页面链接...');

        try {
            // 1. Get Links from current page
            // We scroll down first to trigger lazy load
            await crawlerWindow.webContents.executeJavaScript(`window.scrollTo(0, document.body.scrollHeight);`);
            await new Promise(r => setTimeout(r, 2000)); // Wait for load

            const links = await crawlerWindow.webContents.executeJavaScript(`window.crawlerAPI.findLinks()`);
            
            if (!links || links.length === 0) {
                isCrawling = false;
                return { success: false, message: "未找到有效的详情页链接，请确保在列表页" };
            }

            this.sendUpdate('status', `发现 ${links.length} 个潜在目标，准备开始采集...`);
            this.sendUpdate('total', links.length);

            // 2. Iterate
            let count = 0;
            for (const link of links) {
                if (!isCrawling) break; // Allow stop
                if (count >= 10) break; // Safety limit for now (Batch of 10)

                this.sendUpdate('status', `正在采集 (${count + 1}/${links.length}): ${link.substring(0, 30)}...`);
                
                // Navigate
                await crawlerWindow.loadURL(link);
                
                // Wait for content
                // A smart wait: wait for an image to appear
                try {
                    await this.waitForPageSettle();
                } catch (e) {
                    console.warn("Timeout waiting for page", e);
                }

                // Extract
                const data = await crawlerWindow.webContents.executeJavaScript(`window.crawlerAPI.extractData()`);
                
                if (data && data.prompt && data.prompt.length > 5) {
                    // Enhance: Download image to Base64 for offline availability
                    if (data.image && data.image.startsWith('http')) {
                        try {
                            const response = await fetch(data.image);
                            const arrayBuffer = await response.arrayBuffer();
                            const base64 = Buffer.from(arrayBuffer).toString('base64');
                            const mime = response.headers.get('content-type') || 'image/jpeg';
                            data.image = `data:${mime};base64,${base64}`;
                        } catch (e) {
                            console.warn("Image download failed, keeping URL:", e);
                        }
                    }

                    // Send to renderer to save (reusing existing logic)
                    this.mainWindow.webContents.send('crawler-data-found', data);
                    count++;
                }

                // Random delay to be nice
                await new Promise(r => setTimeout(r, 1500 + Math.random() * 1000));
            }

            // Go back to list or stay?
            // crawlerWindow.webContents.goBack(); 

            isCrawling = false;
            this.sendUpdate('status', `采集完成，共获取 ${count} 条数据`);
            return { success: true, count };

        } catch (e) {
            isCrawling = false;
            console.error("Crawl error:", e);
            return { success: false, error: e.message };
        }
    }

    stopCrawl() {
        isCrawling = false;
        this.sendUpdate('status', '采集已停止');
    }

    async waitForPageSettle() {
        // Poll for stability or specific element
        return new Promise((resolve, reject) => {
            let attempts = 0;
            const check = setInterval(async () => {
                attempts++;
                if (attempts > 20) { // 10 seconds timeout
                    clearInterval(check);
                    resolve(); // Resolve anyway to try scraping what we have
                    return;
                }

                try {
                    // Check if an image is loaded
                    const ready = await crawlerWindow.webContents.executeJavaScript(`document.querySelectorAll('img').length > 2`);
                    if (ready) {
                        clearInterval(check);
                        // Give it a bit more time for text
                        setTimeout(resolve, 1000); 
                    }
                } catch (e) {
                    // ignore
                }
            }, 500);
        });
    }

    sendUpdate(type, payload) {
        if (this.mainWindow) {
            this.mainWindow.webContents.send('crawler-update', { type, payload });
        }
    }
}

module.exports = CrawlerService;