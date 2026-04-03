import React, { useState, useRef, useEffect } from 'react';
import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';
import * as pdfjsLib from 'pdfjs-dist';
import { analyzeSmartLedger, analyzeWithOCRAndLLM, analyzeExcelTemplate } from '../services/geminiService';
import { ExpenseItem } from '../types';

// Set PDF worker source
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.js';

interface SmartBookkeepingModalProps {
    onClose: () => void;
    projectTitle: string;
    onSaveToProject?: (expenses: ExpenseItem[]) => void;
}

interface ProcessedRow {
    id: string;
    [key: string]: any; // Dynamic columns
    _evidenceFile?: File; 
    _evidenceFileName?: string; 
    _status: 'pending' | 'success' | 'error';
}

const SmartBookkeepingModal: React.FC<SmartBookkeepingModalProps> = ({ onClose, projectTitle, onSaveToProject }) => {
    const [step, setStep] = useState<1 | 2 | 3>(1);
    
    // Template State
    const [templateFile, setTemplateFile] = useState<File | null>(null);
    const [templateBuffer, setTemplateBuffer] = useState<ArrayBuffer | null>(null);
    const [templateWorkbook, setTemplateWorkbook] = useState<ExcelJS.Workbook | null>(null);
    const [templateStructure, setTemplateStructure] = useState<{
        headerRowIndex: number;
        dataStartRowIndex: number;
        headers: string[];
    } | null>(null);

    // Evidence State
    const [evidenceFiles, setEvidenceFiles] = useState<File[]>([]);
    const [filePreviews, setFilePreviews] = useState<Record<string, string>>({});
    const [hoveredFile, setHoveredFile] = useState<File | null>(null);
    const [hoverPosition, setHoverPosition] = useState<{x: number, y: number} | null>(null);

    // Processing State
    const [processedData, setProcessedData] = useState<ProcessedRow[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [processLog, setProcessLog] = useState<string[]>([]);
    const [apiKeyConfigured, setApiKeyConfigured] = useState(false);
    const [useLocalOCR, setUseLocalOCR] = useState(false);
    const [errorMsg, setErrorMsg] = useState<string | null>(null);

    // Check API Key
    useEffect(() => {
        const checkKeys = async () => {
             const dsKey = localStorage.getItem('user_api_key_deepseek');
             const gKey = localStorage.getItem('user_api_key_google');
             const secure = (window as any).electronAPI?.secure;
             let hasKey = !!dsKey || !!gKey;
             if (!hasKey && secure) {
                 const k1 = await secure.get('user_api_key_deepseek');
                 const k2 = await secure.get('user_api_key_google');
                 hasKey = !!k1 || !!k2;
             }
             setApiKeyConfigured(hasKey);
        };
        checkKeys();
    }, []);

    const addLog = (msg: string) => setProcessLog(prev => [...prev, msg]);

    // --- Template Handling ---

    const handleHeaderRowSelect = (rowIndex: number) => {
        if (!templateWorkbook) return;
        const ws = templateWorkbook.worksheets[0];
        const row = ws.getRow(rowIndex);
        const headers: string[] = [];
        
        row.eachCell((cell) => {
            if (cell.value) {
                const val = cell.value.toString().trim();
                if (val) headers.push(val);
            }
        });

        if (headers.length > 0) {
            setTemplateStructure({
                headerRowIndex: rowIndex,
                dataStartRowIndex: rowIndex + 1,
                headers
            });
            addLog(`👆 用户手动指定表头: 第 ${rowIndex} 行`);
            addLog(`📋 识别列名: ${headers.join(', ')}`);
        }
    };

    const handleTemplateUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const arrayBuffer = await file.arrayBuffer();
            setTemplateBuffer(arrayBuffer);
            setTemplateFile(file);

            // 1. Parse with ExcelJS
            const wb = new ExcelJS.Workbook();
            await wb.xlsx.load(arrayBuffer);
            setTemplateWorkbook(wb);
            
            const ws = wb.worksheets[0];
            if (!ws) throw new Error("Excel 文件为空");

            // 2. Render Preview (Now handled by reactive component)
            // const html = renderExcelPreview(ws);
            // setTemplateHtml(html);

            // 3. AI Analysis for Structure
            addLog("🤖 正在分析模版结构...");
            
            // Extract CSV-like text for AI
            let csvContent = '';
            for(let r=1; r<=10; r++) {
                const rowValues = [];
                const row = ws.getRow(r);
                for(let c=1; c<=ws.columnCount; c++) {
                    rowValues.push(row.getCell(c).value || '');
                }
                csvContent += rowValues.join(',') + '\n';
            }

            const analysis = await analyzeExcelTemplate(csvContent);
            if (analysis.headers && analysis.headers.length > 0) {
                setTemplateStructure({
                    headerRowIndex: analysis.headerRowIndex,
                    dataStartRowIndex: analysis.dataStartRowIndex,
                    headers: analysis.headers
                });
                addLog(`✅ 模版识别成功：表头在第 ${analysis.headerRowIndex} 行，数据从第 ${analysis.dataStartRowIndex} 行开始`);
                addLog(`📋 识别列名：${analysis.headers.join(', ')}`);
                setStep(2);
            } else {
                throw new Error("AI 无法识别有效的表头");
            }

        } catch (err: any) {
            console.error(err);
            alert("模版解析失败: " + err.message);
        }
    };

    // --- Evidence Handling ---

    const generateFilePreview = async (file: File): Promise<string> => {
        try {
            if (file.type.startsWith('image/')) {
                return new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onload = (e) => resolve(e.target?.result as string);
                    reader.readAsDataURL(file);
                });
            } else if (file.type === 'application/pdf') {
                const arrayBuffer = await file.arrayBuffer();
                const loadingTask = pdfjsLib.getDocument(arrayBuffer);
                const pdf = await loadingTask.promise;
                const page = await pdf.getPage(1);
                const viewport = page.getViewport({ scale: 1.5 });
                const canvas = document.createElement('canvas');
                const context = canvas.getContext('2d');
                if (!context) return '';
                
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                
                await page.render({ canvasContext: context, viewport, canvas }).promise;
                return canvas.toDataURL('image/jpeg');
            }
        } catch (e) {
            console.error("Preview generation failed", e);
        }
        return '';
    };

    const handleEvidenceUpload = async (e: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
        let files: File[] = [];
        if ('dataTransfer' in e) {
            e.preventDefault();
            e.stopPropagation();
            if (e.dataTransfer.files) files = Array.from(e.dataTransfer.files);
        } else if (e.target.files) {
            files = Array.from(e.target.files);
        }
        
        const validFiles = files.filter(f => f.type.startsWith('image/') || f.type === 'application/pdf');
        if (validFiles.length > 0) {
            setEvidenceFiles(prev => [...prev, ...validFiles]);
            addLog(`📥 已添加 ${validFiles.length} 个文件`);

            // Generate previews in background
            for (const file of validFiles) {
                generateFilePreview(file).then(base64 => {
                    setFilePreviews(prev => ({ ...prev, [file.name]: base64 }));
                });
            }
        }
    };

    // --- Processing Logic ---

    const startProcessing = async () => {
        if (evidenceFiles.length === 0 || !templateStructure) return;
        setIsProcessing(true);
        setStep(3);
        const results: ProcessedRow[] = [];

        for (const file of evidenceFiles) {
            const rowId = `row-${Date.now()}-${Math.random().toString(36).substr(2,9)}`;
            addLog(`🔄 分析凭证: ${file.name}...`);
            
            try {
                // Use cached preview (which is guaranteed image base64) or generate it if missing
                let base64 = filePreviews[file.name];
                if (!base64) {
                    base64 = await generateFilePreview(file);
                    setFilePreviews(prev => ({ ...prev, [file.name]: base64 }));
                }

                if (!base64) throw new Error("无法读取文件或生成预览");

                let extractedData = {};

                if (useLocalOCR) {
                    addLog(`🧠 OCR 模式分析中...`);
                    extractedData = await analyzeWithOCRAndLLM(base64, templateStructure.headers);
                } else {
                    try {
                         extractedData = await analyzeSmartLedger(base64, templateStructure.headers);
                    } catch (err: any) {
                         const errMsg = err.message || '';
                         if (errMsg.includes('403') || errMsg.includes('suspended') || errMsg.includes('PERMISSION_DENIED')) {
                             addLog(`⚠️ API 受限，自动降级至 OCR 模式...`);
                             extractedData = await analyzeWithOCRAndLLM(base64, templateStructure.headers);
                         } else {
                             throw err;
                         }
                    }
                }

                results.push({
                    id: rowId,
                    ...extractedData,
                    _evidenceFile: file,
                    _evidenceFileName: file.name,
                    _status: 'success'
                });
                addLog(`✅ 完成: ${file.name}`);

            } catch (e: any) {
                console.error(e);
                addLog(`❌ 失败: ${file.name} - ${e.message}`);
                results.push({
                    id: rowId,
                    _evidenceFile: file,
                    _evidenceFileName: file.name,
                    _status: 'error'
                });
            }
        }
        setProcessedData(results);
        setIsProcessing(false);
    };

    // --- Export Logic ---

    const handleExport = async (mode: 'xlsx' | 'package') => {
        if (!processedData.length || !templateBuffer || !templateStructure) return;

        try {
            // Load original template
            const wb = new ExcelJS.Workbook();
            await wb.xlsx.load(templateBuffer);
            const ws = wb.worksheets[0];

            // Fill data starting from dataStartRowIndex
            let currentRow = templateStructure.dataStartRowIndex;
            
            // Map headers to column indices (simple matching for now)
            // Ideally we should find which column index matches which header name in headerRowIndex
            const headerRow = ws.getRow(templateStructure.headerRowIndex);
            const colMap: Record<string, number> = {};
            
            headerRow.eachCell((cell, colNumber) => {
                const val = cell.value ? cell.value.toString().trim() : '';
                if (templateStructure.headers.includes(val)) {
                    colMap[val] = colNumber;
                }
            });

            // Fallback: if map is empty (maybe headers didn't match exactly), use order
            const useOrderFallback = Object.keys(colMap).length === 0;

            processedData.forEach((data, idx) => {
                // Insert new row if needed (or use existing empty rows?)
                // Inserting rows in ExcelJS pushes existing rows down
                // But template might have pre-formatted empty rows.
                // Let's try to overwrite if row is empty, otherwise insert?
                // Simplest strategy: Insert new row at currentRow, copying styles from previous row if possible?
                // ExcelJS insertRow copies style from row above? No.
                // Best bet: If template has styles, we assume user provided enough empty rows OR we insert and copy style.
                // Let's just set values for now. If we go beyond existing rows, ExcelJS adds new ones.
                
                const row = ws.getRow(currentRow + idx);
                
                templateStructure.headers.forEach((header, hIdx) => {
                    const colIdx = useOrderFallback ? hIdx + 1 : colMap[header];
                    if (colIdx) {
                        const cell = row.getCell(colIdx);
                        cell.value = data[header] || '';
                        // Copy style from data start row if new row created?
                        if (idx > 0) {
                            // Copy style from the first data row
                            const firstDataRowCell = ws.getRow(templateStructure.dataStartRowIndex).getCell(colIdx);
                            cell.style = firstDataRowCell.style;
                        }
                    }
                });
                row.commit();
            });

            const buffer = await wb.xlsx.writeBuffer();

            if (mode === 'xlsx') {
                const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${projectTitle}_智能记账_${new Date().toLocaleDateString()}.xlsx`;
                a.click();
            } else {
                const zip = new JSZip();
                zip.file("记账明细表.xlsx", buffer);
                const evidenceFolder = zip.folder("原始凭证");
                
                processedData.forEach((row, idx) => {
                    if (row._evidenceFile) {
                        const ext = row._evidenceFileName?.split('.').pop() || 'jpg';
                        const newName = `${String(idx + 1).padStart(3, '0')}_${row._evidenceFileName}`;
                        evidenceFolder?.file(newName, row._evidenceFile);
                    }
                });
                
                const content = await zip.generateAsync({ type: "blob" });
                const url = URL.createObjectURL(content);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${projectTitle}_智能记账包.zip`;
                a.click();
            }

        } catch (e: any) {
            console.error("Export failed", e);
            alert("导出失败: " + e.message);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
            <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-7xl h-[90vh] flex flex-col shadow-2xl overflow-hidden border border-slate-200 dark:border-slate-800">
                {/* Header */}
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-white dark:bg-slate-900 shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-600 text-white rounded-xl shadow-lg shadow-indigo-200 dark:shadow-none">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" /></svg>
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-slate-800 dark:text-white">智能记账助手</h2>
                            <p className="text-xs text-slate-500 dark:text-slate-400">模版样式预览 & 智能填报</p>
                        </div>
                    </div>
                    {errorMsg && (
                        <div className="bg-red-50 text-red-600 px-4 py-2 rounded-lg text-xs font-bold border border-red-100 flex items-center gap-2 animate-pulse">
                            ⚠️ {errorMsg}
                        </div>
                    )}
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg></button>
                </div>

                <div className="flex-1 flex overflow-hidden">
                    {/* Left Sidebar */}
                    <div className="w-80 bg-slate-50 dark:bg-slate-800/50 border-r border-slate-200 dark:border-slate-800 p-6 flex flex-col gap-6 overflow-y-auto shrink-0 z-10">
                        
                        {/* Step 1: Template */}
                        <div className={`transition-all ${step >= 1 ? 'opacity-100' : 'opacity-50'}`}>
                            <h3 className="text-sm font-black text-slate-800 dark:text-white mb-3 flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs">1</span>
                                上传记账模版
                            </h3>
                            <div className="relative group">
                                <input type="file" accept=".xlsx" onChange={handleTemplateUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10" />
                                <div className="border-2 border-dashed border-slate-300 rounded-xl p-4 text-center bg-white hover:border-indigo-400 hover:bg-indigo-50 transition-all">
                                    {templateFile ? (
                                        <div className="flex items-center gap-2 justify-center text-green-600">
                                            <span className="text-xs font-bold truncate">{templateFile.name}</span>
                                        </div>
                                    ) : (
                                        <span className="text-xs text-slate-500">点击上传 .xlsx</span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Step 2: Evidence */}
                        <div className={`transition-all ${step >= 2 ? 'opacity-100' : 'opacity-50 grayscale'}`}>
                            <h3 className="text-sm font-black text-slate-800 dark:text-white mb-3 flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-600 flex items-center justify-center text-xs">2</span>
                                拖入原始凭证
                            </h3>
                            <div 
                                className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center bg-white hover:border-indigo-400 hover:bg-indigo-50 transition-all relative"
                                onDragOver={e => e.preventDefault()}
                                onDrop={(e) => handleEvidenceUpload(e as any)}
                            >
                                <input type="file" multiple accept="image/*,.pdf" onChange={handleEvidenceUpload} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" />
                                <div className="text-2xl mb-2">📸</div>
                                <p className="text-xs text-slate-500">支持批量拖入</p>
                            </div>
                            
                            {/* File List with Hover Preview */}
                            <div className="mt-2 space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                                {evidenceFiles.map((f, i) => (
                                    <div 
                                        key={i} 
                                        className="px-2 py-1.5 bg-white border border-slate-200 rounded-lg text-xs text-slate-600 truncate cursor-help hover:bg-indigo-50 hover:text-indigo-600 transition-colors flex justify-between items-center group"
                                        onMouseEnter={(e) => {
                                            setHoveredFile(f);
                                            setHoverPosition({ x: e.clientX + 20, y: e.clientY });
                                        }}
                                        onMouseLeave={() => setHoveredFile(null)}
                                    >
                                        <span className="truncate flex-1">{f.name}</span>
                                        {processedData.find(r => r._evidenceFileName === f.name)?._status === 'success' && <span className="text-green-500">✓</span>}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* Step 3: Action */}
                        <div className={`mt-auto pt-4 border-t border-slate-200 ${step >= 2 ? 'opacity-100' : 'opacity-50'}`}>
                            <div className="flex items-center gap-2 mb-4 px-1">
                                <input type="checkbox" checked={useLocalOCR} onChange={e => setUseLocalOCR(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500" />
                                <span className="text-xs text-slate-600 font-bold">强制使用 OCR + LLM</span>
                            </div>
                            <button 
                                onClick={startProcessing}
                                disabled={isProcessing || step < 2 || evidenceFiles.length === 0}
                                className="w-full py-3 bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-xl font-black text-sm shadow-lg hover:shadow-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                            >
                                {isProcessing ? <span className="animate-spin">⏳</span> : <span>✨</span>}
                                {isProcessing ? '智能填表中...' : '开始智能填报'}
                            </button>
                        </div>
                    </div>

                    {/* Right Content: Excel Preview & Results */}
                    <div className="flex-1 flex flex-col bg-slate-50 dark:bg-slate-900/50 min-w-0 relative">
                        {/* Status Bar */}
                        {isProcessing && (
                            <div className="bg-slate-800 text-green-400 px-4 py-2 text-xs font-mono border-b border-slate-700 flex items-center justify-between">
                                <span>{processLog[processLog.length - 1] || '处理中...'}</span>
                                <span className="animate-pulse">_</span>
                            </div>
                        )}

                        {/* Excel Grid Preview */}
                        <div className="flex-1 overflow-auto p-8 relative">
                            {templateWorkbook ? (
                                <div className="bg-white shadow-xl p-8 min-h-[800px] w-full max-w-[1200px] mx-auto relative excel-preview-container">
                                    {/* Tip */}
                                    <div className="mb-4 flex items-center gap-2 text-xs text-slate-500 bg-slate-50 p-2 rounded-lg border border-slate-100">
                                        <span className="text-indigo-500 font-bold">💡 提示:</span>
                                        <span>如果不准确，您可以直接点击表格中的某一行将其设为表头。</span>
                                    </div>

                                    {/* Interactive Template Render */}
                                    <div className="overflow-auto relative z-0">
                                        <table className="w-full border-collapse text-xs font-mono" style={{ fontFamily: 'Arial, sans-serif' }}>
                                            <tbody>
                                                {(() => {
                                                    const ws = templateWorkbook.worksheets[0];
                                                    const maxRows = Math.min(ws.rowCount, 50); // Increase limit for better view
                                                    const maxCols = Math.min(ws.columnCount, 20);
                                                    const rows = [];
                                                    
                                                    // Pre-calculate merges for faster lookup
                                                    // Map<MasterAddress, {rowSpan, colSpan}>
                                                    const mergeMap = new Map();
                                                    const mergedCells = new Set(); // Set of all slave cell addresses

                                                    if (ws.model.merges) {
                                                        ws.model.merges.forEach((rangeStr: string) => {
                                                            // rangeStr like "A1:B2"
                                                            const [start, end] = rangeStr.split(':');
                                                            if (!start || !end) return;
                                                            
                                                            // We need to convert A1 to row/col indices to calc span
                                                            // ExcelJS has utils but we might not have access to internal ones easily.
                                                            // Use cell refs from worksheet to get indices
                                                            const startCell = ws.getCell(start);
                                                            const endCell = ws.getCell(end);
                                                            
                                                            const rowSpan = Number(endCell.row) - Number(startCell.row) + 1;
                                                            const colSpan = Number(endCell.col) - Number(startCell.col) + 1;
                                                            
                                                            mergeMap.set(startCell.address, { rowSpan, colSpan });
                                                            
                                                            // Mark slaves
                                                            for(let r = Number(startCell.row); r <= Number(endCell.row); r++) {
                                                                for(let c = Number(startCell.col); c <= Number(endCell.col); c++) {
                                                                    if (r === Number(startCell.row) && c === Number(startCell.col)) continue;
                                                                    // Get address for r,c
                                                                    const slaveAddr = ws.getRow(r).getCell(c).address;
                                                                    mergedCells.add(slaveAddr);
                                                                }
                                                            }
                                                        });
                                                    }

                                                    for (let r = 1; r <= maxRows; r++) {
                                                        const row = ws.getRow(r);
                                                        const isHeader = templateStructure?.headerRowIndex === r;
                                                        
                                                        const cells = [];
                                                        for (let c = 1; c <= maxCols; c++) {
                                                            const cell = row.getCell(c);
                                                            
                                                            // Skip if slave cell
                                                            if (mergedCells.has(cell.address)) continue;

                                                            let style: React.CSSProperties = {
                                                                border: '1px solid #e2e8f0',
                                                                padding: '4px',
                                                                position: 'relative',
                                                                backgroundColor: isHeader ? '#eff6ff' : undefined, // Blue tint for header
                                                            };

                                                            // Apply Excel Styles
                                                            if (cell.fill && cell.fill.type === 'pattern' && cell.fill.fgColor) {
                                                                const color = cell.fill.fgColor.argb?.substring(2) || '';
                                                                if (color && !isHeader) style.backgroundColor = `#${color}`;
                                                            }
                                                            if (cell.font && cell.font.bold) style.fontWeight = 'bold';
                                                            if (cell.alignment) {
                                                                if (cell.alignment.horizontal) style.textAlign = cell.alignment.horizontal as any;
                                                                if (cell.alignment.vertical) style.verticalAlign = cell.alignment.vertical as any;
                                                            }

                                                            // Value
                                                            let value = cell.value ? cell.value.toString() : '';
                                                            if (cell.value && typeof cell.value === 'object' && 'richText' in cell.value) {
                                                                value = (cell.value as any).richText.map((t: any) => t.text).join('');
                                                            }

                                                            // Check merge master
                                                            const mergeInfo = mergeMap.get(cell.address);
                                                            
                                                            cells.push(
                                                                <td 
                                                                    key={c} 
                                                                    style={style} 
                                                                    className="whitespace-pre-wrap max-w-[200px] overflow-hidden"
                                                                    rowSpan={mergeInfo?.rowSpan}
                                                                    colSpan={mergeInfo?.colSpan}
                                                                >
                                                                    {value}
                                                                </td>
                                                            );
                                                        }

                                                        rows.push(
                                                            <tr 
                                                                key={r} 
                                                                onClick={() => handleHeaderRowSelect(r)}
                                                                className={`cursor-pointer transition-colors group relative ${isHeader ? 'bg-indigo-50 border-2 border-indigo-500 z-10' : 'hover:bg-slate-100'}`}
                                                                title="点击设置为表头行"
                                                            >   
                                                                {/* Row Header Indicator */}
                                                                <td className="w-8 text-center text-slate-400 bg-slate-50 border border-slate-200 select-none text-[10px]">
                                                                    {isHeader ? <span className="text-indigo-600 font-black">★</span> : r}
                                                                </td>
                                                                {cells}
                                                            </tr>
                                                        );
                                                    }
                                                    return rows;
                                                })()}
                                            </tbody>
                                        </table>
                                    </div>
                                    
                                    {/* Overlay Processed Data (Simplified Visualization) */}
                                    {processedData.length > 0 && templateStructure && (
                                        <div className="mt-8 border-t-2 border-dashed border-indigo-200 pt-8">
                                            <h4 className="text-sm font-bold text-indigo-600 mb-4">✨ AI 填报预览</h4>
                                            <table className="w-full text-xs border-collapse shadow-sm">
                                                <thead>
                                                    <tr className="bg-indigo-50 border-b border-indigo-100">
                                                        {templateStructure.headers.map((h, i) => (
                                                            <th key={i} className="p-2 text-left text-indigo-800 font-bold border-r border-indigo-100 last:border-0">{h}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {processedData.map((row, idx) => (
                                                        <tr key={idx} className="bg-white hover:bg-yellow-50 transition-colors border-b border-slate-100">
                                                            {templateStructure.headers.map(h => (
                                                                <td key={h} className="p-2 border-r border-slate-100 text-slate-700 font-mono last:border-0">
                                                                    {row[h]}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center text-slate-300">
                                    <div className="text-6xl mb-4 opacity-50">📊</div>
                                    <p className="font-bold text-sm">请上传 Excel 模版以预览样式</p>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="p-4 border-t border-slate-200 bg-white flex justify-between items-center">
                            <span className="text-xs text-slate-500">共 {processedData.length} 条记录</span>
                            <div className="flex gap-3">
                                <button onClick={() => handleExport('xlsx')} disabled={!processedData.length} className="px-4 py-2 border rounded-xl text-xs font-bold hover:bg-slate-50">仅导出表格</button>
                                <button onClick={() => handleExport('package')} disabled={!processedData.length} className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold hover:bg-indigo-700 shadow-lg">打包导出 (含附件)</button>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Hover Preview Portal */}
            {hoveredFile && hoverPosition && (
                <div 
                    className="fixed z-[300] bg-white p-2 rounded-xl shadow-2xl border border-slate-200 pointer-events-none animate-fade-in-up"
                    style={{ left: hoverPosition.x, top: Math.min(hoverPosition.y, window.innerHeight - 300) }}
                >
                    {filePreviews[hoveredFile.name] ? (
                        <img src={filePreviews[hoveredFile.name]} className="max-w-[200px] max-h-[300px] rounded-lg object-contain bg-slate-100" alt="Preview" />
                    ) : hoveredFile.type.startsWith('image/') ? (
                        <img src={URL.createObjectURL(hoveredFile)} className="max-w-[200px] max-h-[300px] rounded-lg object-contain bg-slate-100" alt="Preview" />
                    ) : (
                        <div className="w-[200px] h-[100px] flex items-center justify-center bg-slate-100 rounded-lg text-slate-400 text-xs">
                            <span className="animate-pulse">正在生成预览...</span>
                        </div>
                    )}
                    <div className="mt-2 text-[10px] font-bold text-slate-600 text-center truncate w-[200px]">{hoveredFile.name}</div>
                </div>
            )}
        </div>
    );
};

export default SmartBookkeepingModal;
