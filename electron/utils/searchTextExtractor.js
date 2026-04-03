const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const xlsx = require('xlsx');
const pdfParseImport = require('pdf-parse');
const pdfParse = (typeof pdfParseImport === 'function')
    ? pdfParseImport
    : (pdfParseImport && (pdfParseImport.PDFParse || pdfParseImport.default));

const safeReadUtf8 = (filePath, maxChars) => {
    const fd = fs.openSync(filePath, 'r');
    try {
        const buf = Buffer.alloc(Math.min(maxChars * 2, 1024 * 1024));
        const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
        return buf.slice(0, bytes).toString('utf8').slice(0, maxChars);
    } finally {
        fs.closeSync(fd);
    }
};

const extractTextForSearch = async (filePath, options = {}) => {
    const maxChars = Math.max(1000, Math.min(Number(options.maxChars) || 20000, 200000));
    const maxBytes = Math.max(1024 * 64, Math.min(Number(options.maxBytes) || 50 * 1024 * 1024, 500 * 1024 * 1024));

    if (!filePath || typeof filePath !== 'string') throw new Error('Invalid file path');
    if (!fs.existsSync(filePath)) throw new Error('File not found');

    const st = fs.statSync(filePath);
    if (!st.isFile()) throw new Error('Not a file');
    if (st.size > maxBytes) return '';

    const ext = path.extname(filePath).toLowerCase();

    try {
        if (ext === '.md' || ext === '.markdown' || ext === '.txt' || ext === '.csv' || ext === '.json' || ext === '.log') {
            return safeReadUtf8(filePath, maxChars);
        }

        if (ext === '.pdf') {
            const buffer = fs.readFileSync(filePath);
            const isV2Class = (typeof pdfParse === 'function' && pdfParse.prototype && typeof pdfParse.prototype.getText === 'function');

            if (isV2Class) {
                const parser = new pdfParse({ data: buffer });
                try {
                    const textRes = await parser.getText();
                    const text = String(textRes && textRes.text ? textRes.text : '').replace(/\s+/g, ' ').trim();
                    return text.slice(0, maxChars);
                } finally {
                    await parser.destroy();
                }
            }

            const data = await pdfParse(buffer);
            const text = (data.text || '').replace(/\s+/g, ' ').trim();
            return text.slice(0, maxChars);
        }

        if (ext === '.docx') {
            const result = await mammoth.extractRawText({ path: filePath });
            const text = (result.value || '').replace(/\s+/g, ' ').trim();
            return text.slice(0, maxChars);
        }

        if (ext === '.pptx' || ext === '.ppt') {
            const officeParser = await import('office-text-extractor');
            const text = String(await officeParser.getText(filePath) || '').replace(/\s+/g, ' ').trim();
            return text.slice(0, maxChars);
        }

        if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
            const workbook = xlsx.readFile(filePath);
            const combined = workbook.SheetNames.map((sheetName) => {
                const sheet = workbook.Sheets[sheetName];
                return xlsx.utils.sheet_to_csv(sheet);
            }).join('\n');
            const text = combined.replace(/\s+/g, ' ').trim();
            return text.slice(0, maxChars);
        }
    } catch (e) {
        return '';
    }

    return '';
};

module.exports = { extractTextForSearch };
