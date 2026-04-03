const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const xlsx = require('xlsx');
const pdfParseImport = require('pdf-parse');
const pdfParse = (typeof pdfParseImport === 'function')
    ? pdfParseImport
    : (pdfParseImport && (pdfParseImport.PDFParse || pdfParseImport.default));

const extractKeywords = (text) => {
    if (!text) return [];
    const stopWords = new Set([
        '的', '了', '和', '是', '就', '都', '而', '及', '与', '着',
        'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'in', 'on', 'at', 'to', 'for'
    ]);
    const words = text
        .toLowerCase()
        .replace(/[.,/#!$%^&*;:{}=\-_`~()。，！？、\[\]【】（）]/g, ' ')
        .split(/\s+/)
        .filter((w) => w && w.length > 1 && !stopWords.has(w));
    const freq = new Map();
    for (const w of words.slice(0, 5000)) {
        freq.set(w, (freq.get(w) || 0) + 1);
    }
    return Array.from(freq.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([w]) => w);
};

const firstNonEmptyLine = (text) => {
    if (!text) return null;
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return null;
    return lines[0].slice(0, 120);
};

const summarize = (text) => {
    if (!text) return null;
    const t = text.replace(/\s+/g, ' ').trim();
    if (!t) return null;
    return t.slice(0, 400);
};

const extractFileMetadata = async (filePath) => {
    if (!filePath || typeof filePath !== 'string') throw new Error('Invalid file path');
    if (!fs.existsSync(filePath)) throw new Error('File not found');

    const ext = path.extname(filePath).toLowerCase();
    let text = '';
    let title = null;
    let author = null;
    let published_time = null;

    if (ext === '.pdf') {
        const buffer = fs.readFileSync(filePath);
        const isV2Class = (typeof pdfParse === 'function' && pdfParse.prototype && typeof pdfParse.prototype.getText === 'function');

        if (isV2Class) {
            const parser = new pdfParse({ data: buffer });
            try {
                const infoRes = await parser.getInfo();
                const textRes = await parser.getText();
                text = textRes && typeof textRes.text === 'string' ? textRes.text : '';
                const info = infoRes ? infoRes.info : null;
                if (info) {
                    title = (info.Title || info.title || null) ? String(info.Title || info.title).trim() : null;
                    author = (info.Author || info.author || null) ? String(info.Author || info.author).trim() : null;
                }
            } finally {
                await parser.destroy();
            }
        } else {
            const data = await pdfParse(buffer);
            text = data.text || '';
            if (data.info) {
                title = (data.info.Title || data.info.title || null) ? String(data.info.Title || data.info.title).trim() : null;
                author = (data.info.Author || data.info.author || null) ? String(data.info.Author || data.info.author).trim() : null;
            }
        }
    } else if (ext === '.docx') {
        const result = await mammoth.extractRawText({ path: filePath });
        text = result.value || '';
    } else if (ext === '.pptx') {
        const officeParser = await import('office-text-extractor');
        text = await officeParser.getText(filePath);
    } else if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
        const workbook = xlsx.readFile(filePath);
        text = workbook.SheetNames.map((sheetName) => {
            const sheet = workbook.Sheets[sheetName];
            return xlsx.utils.sheet_to_csv(sheet);
        }).join('\n');
    } else if (ext === '.md' || ext === '.markdown' || ext === '.txt') {
        text = fs.readFileSync(filePath, { encoding: 'utf8' });
    } else {
        return {
            title: null,
            author: null,
            published_time: null,
            abstract: null,
            keywords: []
        };
    }

    if (!title) title = firstNonEmptyLine(text);
    const abstract = summarize(text);
    const keywords = extractKeywords(text);

    return {
        title: title || null,
        author: author || null,
        published_time: published_time || null,
        abstract: abstract || null,
        keywords
    };
};

module.exports = { extractFileMetadata };
