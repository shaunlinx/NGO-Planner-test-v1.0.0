const { dialog, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
const MarkdownIt = require('markdown-it');
const HTMLtoDOCX = require('html-to-docx');
const XLSX = require('xlsx');

const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: true
});

class ExportService {
    async exportFile(event, { content, type, format, defaultName }) {
        const win = BrowserWindow.fromWebContents(event.sender);
        
        // 1. Show Save Dialog
        const { filePath } = await dialog.showSaveDialog(win, {
            title: `导出为 ${format.toUpperCase()}`,
            defaultPath: defaultName || `export.${format}`,
            filters: [
                { name: format.toUpperCase(), extensions: [format] }
            ]
        });

        if (!filePath) return { success: false, message: 'User cancelled' };

        try {
            if (format === 'pdf') {
                await this.exportToPdf(content, filePath, type);
            } else if (format === 'docx') {
                await this.exportToDocx(content, filePath);
            } else if (format === 'xlsx') {
                await this.exportToExcel(content, filePath);
            }
            return { success: true, filePath };
        } catch (error) {
            console.error('Export failed:', error);
            return { success: false, error: error.message };
        }
    }

    async exportToPdf(content, filePath, type) {
        let htmlContent = '';
        
        if (type === 'markdown') {
            const body = md.render(content);
            // Wrap in a basic template with some CSS for better PDF look
            htmlContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <style>
                        body { font-family: "Helvetica Neue", Arial, sans-serif; line-height: 1.6; padding: 40px; max-width: 800px; margin: 0 auto; }
                        h1, h2, h3 { color: #333; }
                        code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; }
                        pre { background: #f4f4f4; padding: 15px; border-radius: 5px; overflow-x: auto; }
                        img { max-width: 100%; height: auto; display: block; margin: 20px 0; }
                        table { border-collapse: collapse; width: 100%; margin: 20px 0; }
                        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
                        th { background-color: #f2f2f2; }
                        blockquote { border-left: 4px solid #ddd; padding-left: 15px; color: #666; margin: 20px 0; }
                    </style>
                </head>
                <body>
                    ${body}
                </body>
                </html>
            `;
        } else {
            // Assume HTML or plain text if not MD? 
            // For now only MD is supported for PDF based on requirements
            htmlContent = content;
        }

        // Create a hidden window to render
        const printWin = new BrowserWindow({
            show: false,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        try {
            await printWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(htmlContent));
            
            // Wait for images to load? simplistic wait
            // Better: execute script to check document.readyState
            // Or just give it a small buffer if loadURL finishes
            
            const pdfData = await printWin.webContents.printToPDF({
                printBackground: true,
                pageSize: 'A4',
                margins: { top: 1, bottom: 1, left: 1, right: 1 } // inches
            });

            fs.writeFileSync(filePath, pdfData);
        } finally {
            printWin.close();
        }
    }

    async exportToDocx(content, filePath) {
        // html-to-docx expects HTML
        const html = md.render(content);
        
        // Basic HTML wrapper needed for html-to-docx? 
        // It accepts HTML string or body.
        // Let's create a buffer
        
        const fileBuffer = await HTMLtoDOCX(html, null, {
            table: { row: { cantSplit: true } },
            footer: true,
            pageNumber: true,
            font: 'Arial' // Basic font
        });

        fs.writeFileSync(filePath, fileBuffer);
    }

    async exportToExcel(csvContent, filePath) {
        // Read CSV string
        const workbook = XLSX.read(csvContent, { type: 'string' });
        XLSX.writeFile(workbook, filePath);
    }
}

module.exports = new ExportService();
