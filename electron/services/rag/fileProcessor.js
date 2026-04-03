const fs = require('fs');
const mammoth = require('mammoth');
const path = require('path');
// const textract = require('textract'); // Removed due to security vulnerabilities
const xlsx = require('xlsx');
const Tesseract = require('tesseract.js');
const OpenAI = require('openai');
const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');

// Polyfill DOMMatrix for Node.js environment (required by pdfjs-dist v4+)
if (!global.DOMMatrix) {
    global.DOMMatrix = class DOMMatrix {
        constructor(arg) {
            this.a = 1; this.b = 0; this.c = 0; this.d = 1; this.e = 0; this.f = 0;
            if (Array.isArray(arg)) {
                this.a = arg[0]; this.b = arg[1]; this.c = arg[2];
                this.d = arg[3]; this.e = arg[4]; this.f = arg[5];
            }
        }
        // Minimal methods required by PDF.js transform calculations
        multiply(other) { return this; }
        translate(x, y) { return this; }
        scale(x, y) { return this; }
        toString() { return `matrix(${this.a}, ${this.b}, ${this.c}, ${this.d}, ${this.e}, ${this.f})`; }
    };
}

// office-text-extractor is ESM only, use dynamic import

// PDF.js for Node (Standard, no external dependency)
// Update: pdfjs-dist v4 is ESM-only. To use in CommonJS Electron, we must dynamic import.
// Or we can try to use the legacy build if available, but v4 legacy build is also ESM (.mjs).
// Solution: Lazy load PDF.js using dynamic import() inside the processFile method when needed.
let pdfjsLib = null; // Will be loaded dynamically

class FileProcessor {
    async processFile(filePath, options = {}) {
        try {
            console.log(`[FileProcessor] Start processing: ${filePath}`);
            const ext = path.extname(filePath).toLowerCase();
            let text = "";
            let chunks = [];
            
            // ... Logic based on extension
            if (ext === '.pdf') {
                // Dynamically import PDF.js if not loaded
                if (!pdfjsLib) {
                    try {
                        // v5.x+ is ESM only. We must use dynamic import.
                        // Try standard 'pdfjs-dist' import first (package.json should resolve to mjs)
                        pdfjsLib = await import('pdfjs-dist');
                    } catch (e) {
                         console.error("Failed to load pdfjs-dist (standard import):", e);
                         try {
                             // Fallback to legacy build if available (though v5 might removed it, v4 had it)
                             pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
                         } catch (e2) {
                             console.error("Failed to load pdfjs-dist (legacy):", e2);
                             // Fallback to explicit build path
                             pdfjsLib = await import('pdfjs-dist/build/pdf.mjs');
                         }
                    }
                }

                // Use PDF.js instead of textract (which requires system binaries like pdftotext)
                const dataBuffer = new Uint8Array(fs.readFileSync(filePath));
                
                // Resolve paths for CMaps and Standard Fonts to support non-Latin chars (e.g. Chinese)
                // Robust path resolution for both Dev and Production (Packaged) environments
                let cMapUrl, standardFontDataUrl;

                const isPackaged = process.mainModule && process.mainModule.filename.includes('app.asar');
                
                if (isPackaged) {
                    // In production, resources are unpacked next to the app
                    const resourcesPath = process.resourcesPath; // Electron provides this global
                    cMapUrl = path.join(resourcesPath, 'pdfjs', 'cmaps') + path.sep;
                    standardFontDataUrl = path.join(resourcesPath, 'pdfjs', 'standard_fonts') + path.sep;
                } else {
                    // In development, use node_modules directly
                    const pdfjsDistPath = path.dirname(require.resolve('pdfjs-dist/package.json'));
                    cMapUrl = path.join(pdfjsDistPath, 'cmaps') + path.sep;
                    standardFontDataUrl = path.join(pdfjsDistPath, 'standard_fonts') + path.sep;
                }
                
                console.log(`[FileProcessor] PDF Configuration:
                    - CMap URL: ${cMapUrl}
                    - Standard Fonts: ${standardFontDataUrl}
                    - Is Packaged: ${isPackaged}`);

                // Disable font loading to avoid canvas dependency
                const loadingTask = pdfjsLib.getDocument({
                    data: dataBuffer,
                    cMapUrl: cMapUrl,
                    cMapPacked: true,
                    standardFontDataUrl: standardFontDataUrl,
                    useSystemFonts: false,
                    disableFontFace: true
                });
                
                const pdfDocument = await loadingTask.promise;
                const maxPages = pdfDocument.numPages;
                const allChunks = [];
                let fullText = ""; // Optional: keep full text if needed for simple search, but chunks are priority
                
                // Streaming + Smart Layout Recovery Logic
                // Process page by page to save memory
                for (let i = 1; i <= maxPages; i++) {
                    const page = await pdfDocument.getPage(i);
                    const textContent = await page.getTextContent();
                    
                    // 1. Sort items by Y (desc) then X (asc) to ensure reading order
                    // PDF coordinates: (0,0) is bottom-left. Higher Y means higher up on page.
                    const items = textContent.items.map(item => ({
                        str: item.str,
                        x: item.transform[4], // translation x
                        y: item.transform[5], // translation y
                        width: item.width,
                        height: item.height, // Font height/size
                        hasEOL: item.hasEOL
                    })).sort((a, b) => {
                        // Group by line (allow small variance in Y for same line)
                        if (Math.abs(a.y - b.y) > 5) {
                            return b.y - a.y; // Top to bottom
                        }
                        return a.x - b.x; // Left to right
                    });

                    // Calculate average font size for this page to detect headers
                    // Filter out very small text (artifacts)
                    const fontSizes = items.map(i => i.height).filter(h => h > 5);
                    let avgFontSize = 10;
                    if (fontSizes.length > 0) {
                        avgFontSize = fontSizes.reduce((a, b) => a + b, 0) / fontSizes.length;
                    }

                    // 2. Reconstruct Text with Layout Intelligence
                    let pageText = "";
                    let lastY = -1;
                    let lastX = -1;
                    let isHeader = false;
                    let tableRowCandidates = []; // Buffer for potential table row items

                    // Helper to flush table buffer
                    const flushTableBuffer = () => {
                        if (tableRowCandidates.length > 0) {
                            // Sort by X
                            tableRowCandidates.sort((a, b) => a.x - b.x);
                            // Simple heuristic: if items are spread out horizontally with gaps, likely a table row
                            // Insert '|' between items if gap > threshold
                            let rowStr = "| ";
                            let prevItemX = -1;
                            
                            for (const item of tableRowCandidates) {
                                if (prevItemX !== -1 && (item.x - prevItemX) > 20) {
                                    // Large gap, insert pipe
                                    rowStr += " | "; 
                                } else if (prevItemX !== -1) {
                                    rowStr += " "; // Small gap, just space
                                }
                                rowStr += item.str.trim();
                                prevItemX = item.x + item.width;
                            }
                            rowStr += " |";
                            
                            // If it looks like a table row (has pipes), use it. Else just join.
                            if (rowStr.includes(" | ") || tableRowCandidates.length > 2) {
                                pageText += rowStr;
                            } else {
                                // Fallback to normal joining
                                pageText += tableRowCandidates.map(i => i.str).join(" ");
                            }
                            tableRowCandidates = [];
                        }
                    };
                    
                    for (const item of items) {
                        if (lastY !== -1) {
                            // Detect new line
                            if (Math.abs(item.y - lastY) > 10) { // Threshold for line break
                                flushTableBuffer(); // End of previous line
                                pageText += "\n";
                                // Check if previous line was a header (based on last item height)
                                if (isHeader) pageText += "\n"; // Add extra spacing after header
                            } else {
                                // Same line: Add to table buffer instead of direct append
                                // Wait until line end to decide if it's a table
                            }
                        }
                        
                        // If it's a new line (or first item), we just started filling buffer
                        // But wait, the loop logic above handles "between lines". 
                        // The buffer logic needs to replace the direct `pageText += item.str` below.
                        
                        // Refined Logic:
                        // We accumulate items for the *current line*. When line breaks, we process the buffer.
                    }
                    
                    // Rewrite loop for line-by-line processing
                    // Group items by line first
                    const lines = [];
                    let currentLine = [];
                    let currentLineY = items.length > 0 ? items[0].y : 0;
                    
                    for (const item of items) {
                        if (Math.abs(item.y - currentLineY) > 8) { // New line threshold
                            lines.push({ y: currentLineY, items: currentLine });
                            currentLine = [];
                            currentLineY = item.y;
                        }
                        currentLine.push(item);
                    }
                    if (currentLine.length > 0) lines.push({ y: currentLineY, items: currentLine });

                    // Process lines
                    for (const line of lines) {
                        // Sort items X-wise
                        line.items.sort((a, b) => a.x - b.x);
                        
                        // Header Check
                        const maxFontSize = Math.max(...line.items.map(i => i.height));
                        if (maxFontSize > avgFontSize * 1.4) {
                            pageText += "# ";
                        }

                        // Table Detection:
                        // 1. More than 2 distinct items separated by gap > 20px
                        // 2. OR aligns with previous line's column structure (complex, skip for now)
                        let isTable = false;
                        let gaps = 0;
                        let lastItemEnd = -1;
                        
                        for (const item of line.items) {
                            if (lastItemEnd !== -1 && (item.x - lastItemEnd) > 20) {
                                gaps++;
                            }
                            lastItemEnd = item.x + item.width;
                        }
                        
                        if (gaps >= 2 || (gaps >= 1 && line.items.length >= 3)) {
                            isTable = true;
                        }

                        // Construct Line String
                        let lineStr = "";
                        if (isTable) lineStr += "| ";
                        
                        lastItemEnd = -1;
                        for (const item of line.items) {
                            if (lastItemEnd !== -1) {
                                const dist = item.x - lastItemEnd;
                                if (isTable && dist > 20) {
                                    lineStr += " | ";
                                } else {
                                    // Space logic (CJK/Eng)
                                    const isCJK = /[\u4e00-\u9fa5]/.test(item.str);
                                    const wasCJK = /[\u4e00-\u9fa5]/.test(lineStr.slice(-1).trim());
                                    
                                    if (dist > 2 && (!isCJK || !wasCJK)) {
                                        lineStr += " ";
                                    }
                                }
                            }
                            lineStr += item.str;
                            lastItemEnd = item.x + item.width;
                        }
                        
                        if (isTable) lineStr += " |";
                        pageText += lineStr + "\n";
                    }

                    /*
                    // OLD LOGIC REMOVED
                    // 2. Reconstruct Text with Layout Intelligence
                    let pageText = "";
                    let lastY = -1;
                    let lastX = -1;
                    let isHeader = false;
                    
                    for (const item of items) {
                        ...
                    }
                    */

                    fullText += pageText + "\n\n";

                    // 3. Immediate Chunking (Streaming)
                    // Chunk this page immediately to free memory context
                    const pageChunks = this.chunkText(pageText);
                    allChunks.push(...pageChunks);

                    // Explicitly release page resources
                    page.cleanup();
                }

                text = fullText;
                
                // Assign to finalChunks for downstream processing
                // Note: We skip the `this.chunkText(text)` call later by checking if chunks already exist
                var precomputedChunks = allChunks; 

            } else if (ext === '.docx') {
                // Fix: JSZip error "Can't find end of central directory" usually means file is corrupted or locked.
                // However, in this case, it might be due to mammoth reading file buffer vs path.
                // Mammoth 'extractRawText({ path })' is usually safe.
                // BUT if another process (like Word) has it open, or if it's 0 bytes, it fails.
                // Also check if we accidentally passed a non-docx file with .docx extension.
                try {
                    const result = await mammoth.extractRawText({ path: filePath });
                    text = result.value;
                } catch (mammothErr) {
                    console.error(`Mammoth failed for ${filePath}:`, mammothErr);
                    throw new Error(`DOCX 解析失败 (可能文件损坏或被占用): ${mammothErr.message}`);
                }
            } else if (ext === '.pptx') {
                // Dynamic import for ESM module
                const officeParser = await import('office-text-extractor');
                text = await officeParser.getText(filePath);
            } else if (ext === '.xlsx' || ext === '.xls' || ext === '.csv') {
                const workbook = xlsx.readFile(filePath);
                text = workbook.SheetNames.map(sheetName => {
                    const sheet = workbook.Sheets[sheetName];
                    return xlsx.utils.sheet_to_csv(sheet);
                }).join('\n');
            } else if (['.png', '.jpg', '.jpeg', '.bmp'].includes(ext)) {
                console.log(`Performing OCR on ${filePath}...`);
                const { data: { text: ocrText } } = await Tesseract.recognize(filePath, 'chi_sim+eng');
                
                // Add Image Description (Future: Use Vision LLM)
                // For now, OCR is the "Description"
                text = `[Image Content OCR]:\n${ocrText}`;
                
            } else if (['.mp3', '.wav', '.m4a', '.mp4', '.mpeg', '.mpga', '.webm', '.mov'].includes(ext)) {
                console.log(`[FileProcessor] Processing media file ${filePath} using local Python Whisper...`);
                
                // Path to python script
                // In production (asar), extraResources are at process.resourcesPath/python
                // In dev, they are at electron/python
                let scriptPath;
                // Fix: process.isPackaged is undefined in Worker threads sometimes, or check directly.
                // But usually available.
                const isDev = !process.isPackaged; 
                
                if (isDev) {
                    scriptPath = path.join(__dirname, '../../python/transcribe.py');
                } else {
                    scriptPath = path.join(process.resourcesPath, 'python', 'transcribe.py');
                }
                
                console.log(`[FileProcessor] Script Path: ${scriptPath}`);

                // Execute Python script
                text = await new Promise((resolve, reject) => {
                    // Try 'python3' first (macOS/Linux), then 'python'
                    // On some macOS systems, 'python3' might not be in PATH for Electron.
                    // We can try to use absolute path if needed, but let's try 'python3' first.
                    // IMPORTANT: Ensure PATH env is passed if needed.
                    const env = Object.assign({}, process.env);
                    // Add common paths to PATH just in case
                    if (process.platform === 'darwin') {
                        env.PATH = `/usr/local/bin:/opt/homebrew/bin:${env.PATH}`;
                    }
                    
                    const pythonProcess = spawn('python3', [scriptPath, filePath], { env });
                    
                    let stdoutData = '';
                    let stderrData = '';
                    
                    pythonProcess.stdout.on('data', (data) => {
                        stdoutData += data.toString();
                        // console.log(`[Python Stdout] ${data}`);
                    });
                    
                    pythonProcess.stderr.on('data', (data) => {
                        stderrData += data.toString();
                        console.error(`[Python Stderr] ${data}`);
                    });
                    
                    pythonProcess.on('close', (code) => {
                        if (code !== 0) {
                            console.error(`Python script failed with code ${code}`);
                            console.error(`Stderr: ${stderrData}`);
                            // Fallback hint
                            if (stderrData.includes("ModuleNotFoundError") || stderrData.includes("faster-whisper")) {
                                reject(new Error("Local transcription requires 'faster-whisper'. Run: pip install -r electron/python/requirements.txt"));
                            } else {
                                reject(new Error(`Transcription failed: ${stderrData}`));
                            }
                            return;
                        }
                        
                        try {
                            const result = JSON.parse(stdoutData);
                            if (result.error) {
                                reject(new Error(result.error));
                            } else {
                                resolve(result.text);
                            }
                        } catch (e) {
                            console.error("Failed to parse Python output:", stdoutData);
                            reject(new Error("Failed to parse transcription result"));
                        }
                    });
                    
                    pythonProcess.on('error', (err) => {
                        reject(new Error(`Failed to start python process: ${err.message}. Make sure python3 is installed.`));
                    });
                });
                
                console.log("Local Transcription complete.");
                
            } else if (['.txt', '.md', '.json', '.xml', '.html', '.js', '.ts', '.css'].includes(ext)) {
                text = fs.readFileSync(filePath, 'utf-8');
            } else {
                // Fallback for others
                console.warn(`[FileProcessor] Unsupported file type: ${ext}. Skipping text extraction.`);
                text = ""; // Return empty text for unsupported files
            }

            // Contextual Enrichment (Agentic Ingestion)
            // If embeddingService is provided, we generate context for each chunk
            let finalChunks = [];
            
            // Generate Path Context
            // e.g. "Category/SubFolder/Filename.ext"
            // We take the last 2 folders + filename to give AI spatial awareness
            const dir = path.dirname(filePath);
            const dirs = dir.split(path.sep);
            // Handle Windows/Mac separators, though path.sep should handle it.
            // On Electron, path.sep depends on OS.
            const relevantDirs = dirs.slice(-2).join('/'); 
            const filename = path.basename(filePath);
            const pathInfo = relevantDirs ? `${relevantDirs}/${filename}` : filename;
            const pathTag = `【Source: ${pathInfo}】`;

            const chunking = this.normalizeChunkingConfig(options.ragChunking);

            // If chunks were precomputed (e.g. PDF Streaming), use them
            // Otherwise, chunk the full text now
            if (typeof precomputedChunks !== 'undefined' && precomputedChunks.length > 0) {
                // Precomputed chunks are usually just strings from page-streaming.
                // We need to upgrade them to Parent-Child structure if possible, 
                // but page-streaming makes "Global Parent" hard.
                // For now, we treat page chunks as "Parents" and split them into children?
                // Or just keep them as simple chunks for PDF to save complexity.
                // User asked for "Parent-Child" specifically.
                // Let's try to apply Parent-Child to PDF too.
                // Treat each "Page Chunk" as a Parent, and split it into children.
                if (chunking.mode === 'parent_child') {
                    finalChunks = this.upgradeToParentChild(precomputedChunks, chunking);
                } else {
                    finalChunks = this.normalizeSimpleChunks(precomputedChunks, chunking);
                }
            } else {
                if (chunking.mode === 'parent_child') {
                    finalChunks = this.chunkTextParentChild(text, chunking);
                } else {
                    finalChunks = this.normalizeSimpleChunks(this.chunkText(text, chunking.chunkSize, chunking.overlap, chunking.separators), chunking);
                }
            }
            
            // --- HEURISTIC AUTO-SWITCH for Context Enrichment ---
            // Decide whether to enable slow-but-smart enrichment based on file characteristics
            const shouldEnrich = this.shouldEnableEnrichment(ext, text.length, finalChunks);
            
            if (shouldEnrich && options.embeddingService && typeof options.embeddingService.completion === 'function') {
                console.log(`[FileProcessor] 🧠 Auto-Enrichment ENABLED for ${path.basename(filePath)} (${finalChunks.length} chunks)`);
                
                // --- OPTIMIZATION START ---
                // 1. Concurrency Control: Process in batches to speed up but avoid rate limits
                const CONCURRENCY_LIMIT = 3; 
                const enriched = [];

                // Helper to process a single chunk
                const processChunk = async (chunk) => {
                    // Skip enrichment for Parents, they are just context containers
                    if (chunk.type === 'parent') {
                        return {
                            ...chunk,
                            vector_text: chunk.text, // Parents don't need enriched vector text usually, or just self
                            context: ""
                        };
                    }

                    const chunkText = chunk.text || chunk;
                    if (!chunkText.trim()) return null;

                    // 2. Cost Saving: Skip short chunks (likely headers/footers/noise)
                    if (chunkText.length < 50) { // Lower threshold for PPT bullets
                        return {
                            ...chunk, // Preserve id, parent_id, type
                            text: chunkText,
                            context: "", 
                            vector_text: `${pathTag}\n${chunkText}`
                        };
                    }

                    // 3. Prompt Engineering: Concise prompt to save token costs
                    const prompt = `Summarize this snippet's context in 1 brief sentence (Key entities/Timeframe/Topic). Text: "${chunkText.substring(0, 500)}..."`;
                    
                    let context = "";
                    try {
                        context = await options.embeddingService.completion(prompt);
                    } catch (e) {
                        console.warn("[FileProcessor] Context generation failed:", e.message);
                    }
                    
                    if (!context) context = "";
                    
                    return {
                        ...chunk, // Preserve id, parent_id, type
                        text: chunkText,
                        context: context,
                        // Inject Path Info + Context into Vector Text
                        vector_text: context ? `${pathTag}\n【Context: ${context}】\n${chunkText}` : `${pathTag}\n${chunkText}`
                    };
                };

                // Execute in batches
                // Safety Limit: If too many chunks, only enrich the first N to prevent hanging forever
                // For PPTs, usually chunks are few but critical. For PDFs, can be thousands.
                const MAX_CHUNKS_TO_ENRICH = 100; 
                const chunksToProcess = finalChunks.slice(0, MAX_CHUNKS_TO_ENRICH);
                const chunksSkipped = finalChunks.slice(MAX_CHUNKS_TO_ENRICH);

                if (finalChunks.length > MAX_CHUNKS_TO_ENRICH) {
                    console.warn(`[FileProcessor] File too large (${finalChunks.length} chunks). Only enriching first ${MAX_CHUNKS_TO_ENRICH}.`);
                }

                for (let i = 0; i < chunksToProcess.length; i += CONCURRENCY_LIMIT) {
                    const batch = chunksToProcess.slice(i, i + CONCURRENCY_LIMIT);
                    const batchResults = await Promise.all(batch.map(processChunk));
                    enriched.push(...batchResults.filter(r => r !== null));
                    
                    // Small delay between batches to be nice to APIs
                    if (i + CONCURRENCY_LIMIT < chunksToProcess.length) {
                        await new Promise(r => setTimeout(r, 200)); 
                    }
                }
                
                // Add skipped chunks as-is (but add path tag!)
                const normalizedSkipped = chunksSkipped.map(c => {
                    const txt = c.text || c;
                    return { 
                        ...((typeof c === 'object') ? c : {}), // Preserve id/type if object
                        text: txt, 
                        context: "", 
                        vector_text: `${pathTag}\n${txt}` 
                    };
                });
                
                finalChunks = [...enriched, ...normalizedSkipped];
                // --- OPTIMIZATION END ---
            } else {
                if (shouldEnrich && !options.embeddingService) {
                    console.log(`[FileProcessor] Auto-Enrichment wanted but no embedding service available.`);
                }
                // Legacy format normalization
                // Convert all strings to objects to ensure consistent schema downstream
                finalChunks = finalChunks.map(c => {
                    const txt = c.text || c;
                    return typeof c === 'string' ? { 
                        text: txt, 
                        context: "", 
                        vector_text: `${pathTag}\n${txt}` 
                    } : {
                        ...c,
                        vector_text: `${pathTag}\n${txt}` 
                    };
                });
            }

            return { text, chunks: finalChunks };
        } catch (e) {
            console.error(`Error processing file ${filePath}:`, e);
            throw e;
        }
    }

    /**
     * Get content optimized for preview (HTML for docx, etc)
     */
    async getPreviewContent(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        try {
            // For Docx, we still prefer HTML for better formatting if possible,
            // but for UniversalReader we might want Markdown. 
            // Actually, UniversalReader can render HTML inside Markdown or we can just stick to Markdown.
            // Let's stick to Text/Markdown for uniformity.
            
            // Re-use processFile to get the full text which includes some formatting preservation
            const { text } = await this.processFile(filePath);
            
            // Return type 'markdown' (or 'text' which is subset)
            return { type: 'markdown', data: text };
        } catch (e) {
            console.error("Preview extraction failed:", e);
            return { type: 'error', error: e.message };
        }
    }

    /**
     * Intelligent Heuristic to decide if Context Enrichment is needed.
     * Rule: Enable only for fragmented formats (PPT/Excel) or high-fragmentation text.
     */
    shouldEnableEnrichment(ext, textLength, chunks) {
        // 1. File Type Rules
        const FRAGMENTED_FORMATS = ['.pptx', '.ppt', '.xlsx', '.xls', '.csv'];
        if (FRAGMENTED_FORMATS.includes(ext)) {
            return true;
        }

        // 2. Length Rules
        // If file is very short (< 1000 chars), AI summary is cheap and helpful.
        if (textLength < 1000 && textLength > 50) {
            return true;
        }

        // 3. Fragmentation Rules
        // If average chunk length is very small (e.g. < 100 chars), it means text is likely bullets/slides
        // Note: This requires chunks to be pre-calculated
        if (chunks.length > 0) {
            const totalChunkLen = chunks.reduce((acc, c) => acc + c.length, 0);
            const avgLen = totalChunkLen / chunks.length;
            if (avgLen < 100) {
                return true; // Likely slides or bullet points
            }
        }

        // Default: Disable for standard Docs/PDFs to save time/cost
        return false;
    }

    /**
     * Parent-Child Chunking Strategy
     * 1. Split text into Large Parent Chunks (context windows)
     * 2. Split Parents into Small Child Chunks (retrieval units)
     * 3. Return flat list of both (Children point to Parents)
     */
    chunkTextParentChild(text, config = {}) {
        const chunking = this.normalizeChunkingConfig(config);
        const parents = this.chunkText(text, chunking.parentSize, chunking.parentOverlap, chunking.separators);

        const maxChunksPerFile = this.toPositiveIntOrZero(chunking.maxChunksPerFile);
        const maxEmbeddingsPerFile = this.toPositiveIntOrZero(chunking.maxEmbeddingsPerFile);

        let totalChunks = 0;
        let embeddedChildren = 0;
        const allChunks = [];

        for (let idx = 0; idx < parents.length; idx++) {
            if (maxChunksPerFile > 0 && totalChunks >= maxChunksPerFile) break;

            const parentText = parents[idx];
            if (!parentText || !parentText.trim()) continue;

            const children = this.chunkText(parentText, chunking.childSize, chunking.childOverlap, chunking.separators);
            if (!children.length) continue;

            const remainingEmbeds = maxEmbeddingsPerFile > 0 ? Math.max(0, maxEmbeddingsPerFile - embeddedChildren) : children.length;
            const candidateChildren = children.slice(0, remainingEmbeds);
            if (candidateChildren.length === 0) break;

            const parentId = uuidv4();
            allChunks.push({
                id: parentId,
                text: parentText,
                type: 'parent',
                chunk_index: idx
            });
            totalChunks += 1;

            for (let cIdx = 0; cIdx < candidateChildren.length; cIdx++) {
                if (maxChunksPerFile > 0 && totalChunks >= maxChunksPerFile) break;
                if (maxEmbeddingsPerFile > 0 && embeddedChildren >= maxEmbeddingsPerFile) break;

                const childText = candidateChildren[cIdx];
                if (!childText || !childText.trim()) continue;

                allChunks.push({
                    id: uuidv4(),
                    text: childText,
                    type: 'child',
                    parent_id: parentId,
                    chunk_index: cIdx
                });
                totalChunks += 1;
                embeddedChildren += 1;
            }
        }

        return allChunks;
    }

    /**
     * Upgrade existing simple chunks (e.g. from PDF pages) to Parent-Child
     */
    upgradeToParentChild(simpleChunks, config = {}) {
        const chunking = this.normalizeChunkingConfig(config);
        const maxChunksPerFile = this.toPositiveIntOrZero(chunking.maxChunksPerFile);
        const maxEmbeddingsPerFile = this.toPositiveIntOrZero(chunking.maxEmbeddingsPerFile);

        let totalChunks = 0;
        let embeddedChildren = 0;
        const allChunks = [];

        for (let idx = 0; idx < simpleChunks.length; idx++) {
            if (maxChunksPerFile > 0 && totalChunks >= maxChunksPerFile) break;

            const chunk = simpleChunks[idx];
            const parentText = typeof chunk === 'string' ? chunk : chunk.text;
            if (!parentText || !parentText.trim()) continue;

            const children = this.chunkText(parentText, chunking.childSize, chunking.childOverlap, chunking.separators);
            if (!children.length) continue;

            const remainingEmbeds = maxEmbeddingsPerFile > 0 ? Math.max(0, maxEmbeddingsPerFile - embeddedChildren) : children.length;
            const candidateChildren = children.slice(0, remainingEmbeds);
            if (candidateChildren.length === 0) break;

            const parentId = uuidv4();
            allChunks.push({
                id: parentId,
                text: parentText,
                type: 'parent',
                chunk_index: idx
            });
            totalChunks += 1;

            for (let cIdx = 0; cIdx < candidateChildren.length; cIdx++) {
                if (maxChunksPerFile > 0 && totalChunks >= maxChunksPerFile) break;
                if (maxEmbeddingsPerFile > 0 && embeddedChildren >= maxEmbeddingsPerFile) break;

                const childText = candidateChildren[cIdx];
                if (!childText || !childText.trim()) continue;
                allChunks.push({
                    id: uuidv4(),
                    text: childText,
                    type: 'child',
                    parent_id: parentId,
                    chunk_index: cIdx
                });
                totalChunks += 1;
                embeddedChildren += 1;
            }
        }

        return allChunks;
    }

    /**
     * Recursive Character Text Splitter
     * Inspired by LangChain/LlamaIndex
     * Recursively tries to split by [Double Newline, Single Newline, Space, Character]
     */
    chunkText(text, chunkSize = 600, overlap = 100, separatorsOverride) {
        const separators = Array.isArray(separatorsOverride) && separatorsOverride.length > 0
            ? separatorsOverride
            : ["\n\n", "\n", "。", "！", "？", ".", "!", "?", "；", ";", " ", ""];
        const chunks = [];
        
        // Internal recursive splitter function
        const splitText = (currentText, separators) => {
            const finalChunks = [];
            let separator = separators[0];
            let newSeparators = separators.slice(1);
            
            let splits = [];
            if (separator === "") {
                // FIXED: Avoid Array.from(currentText) memory explosion on large strings
                // Instead of creating millions of single-char strings, we just slice it directly if needed
                // But since we are here, it means we ran out of separators.
                // We should just chunk it by hard limit.
                
                for (let i = 0; i < currentText.length; i += chunkSize) {
                    splits.push(currentText.slice(i, i + chunkSize));
                }
            } else {
                splits = currentText.split(separator);
            }

            let goodSplits = [];
            
            // Re-merge splits to fit chunk size
            let currentChunk = "";
            for (const s of splits) {
                // Restore separator if it's not empty string
                const sWithSep = (currentChunk ? separator : "") + s;
                
                if (currentChunk.length + sWithSep.length < chunkSize) {
                    currentChunk += sWithSep;
                } else {
                    if (currentChunk) {
                        goodSplits.push(currentChunk);
                    }
                    // If the segment itself is too big, recurse
                    if (sWithSep.length > chunkSize && newSeparators.length > 0) {
                        const subSplits = splitText(s, newSeparators); // Don't add sep to start of sub-split
                        goodSplits.push(...subSplits);
                        currentChunk = ""; 
                    } else {
                        currentChunk = s; // Start new chunk
                    }
                }
            }
            if (currentChunk) goodSplits.push(currentChunk);

            return goodSplits;
        };

        // First pass: logical split
        const logicalChunks = splitText(text, separators);

        // Second pass: apply overlap window
        // (Simple windowing on top of logical chunks)
        const safeChunkSize = Math.max(50, Number(chunkSize) || 600);
        const safeOverlap = Math.max(0, Math.min(Math.floor(Number(overlap) || 0), safeChunkSize - 1));
        let currentWindow = "";
        
        for (let i = 0; i < logicalChunks.length; i++) {
            const chunk = logicalChunks[i];
            
            // If adding this chunk exceeds size, save current window and slide
            if (currentWindow.length + chunk.length > safeChunkSize) {
                if (currentWindow) chunks.push(currentWindow);
                
                const overlapSeed = safeOverlap > 0 && currentWindow ? currentWindow.slice(-safeOverlap) : "";
                currentWindow = overlapSeed ? `${overlapSeed}\n${chunk}` : chunk;
            } else {
                currentWindow += (currentWindow ? "\n" : "") + chunk;
            }
        }
        if (currentWindow) chunks.push(currentWindow);

        // Filter empty
        return chunks.filter(c => c.trim().length > 0);
    }

    normalizeSimpleChunks(chunks, config = {}) {
        const chunking = this.normalizeChunkingConfig(config);
        const maxChunksPerFile = this.toPositiveIntOrZero(chunking.maxChunksPerFile);
        const maxEmbeddingsPerFile = this.toPositiveIntOrZero(chunking.maxEmbeddingsPerFile);
        const limit = maxChunksPerFile > 0 ? maxChunksPerFile : (maxEmbeddingsPerFile > 0 ? maxEmbeddingsPerFile : 0);

        const normalized = [];
        const src = Array.isArray(chunks) ? chunks : [];
        const takeN = limit > 0 ? Math.min(limit, src.length) : src.length;

        for (let i = 0; i < takeN; i++) {
            const c = src[i];
            const txt = typeof c === 'string' ? c : c?.text;
            if (!txt || !String(txt).trim()) continue;
            normalized.push({
                id: uuidv4(),
                text: txt,
                type: 'child',
                parent_id: null,
                chunk_index: i
            });
        }
        return normalized;
    }

    normalizeChunkingConfig(config = {}) {
        const separators = Array.isArray(config.separators) ? config.separators.filter(s => typeof s === 'string') : null;
        return {
            mode: config.mode === 'simple' ? 'simple' : 'parent_child',
            parentSize: Number(config.parentSize) || 2000,
            parentOverlap: Number(config.parentOverlap) || 200,
            childSize: Number(config.childSize) || 500,
            childOverlap: Number(config.childOverlap) || 50,
            chunkSize: Number(config.chunkSize) || 600,
            overlap: Number(config.overlap) || 100,
            separators: separators && separators.length > 0 ? separators : ["\n\n", "\n", "。", "！", "？", ".", "!", "?", "；", ";", " ", ""],
            maxChunksPerFile: config.maxChunksPerFile === undefined ? 0 : Number(config.maxChunksPerFile),
            maxEmbeddingsPerFile: config.maxEmbeddingsPerFile === undefined ? 0 : Number(config.maxEmbeddingsPerFile)
        };
    }

    toPositiveIntOrZero(value) {
        const n = Math.floor(Number(value) || 0);
        if (!Number.isFinite(n) || n <= 0) return 0;
        return n;
    }
}

module.exports = new FileProcessor();
