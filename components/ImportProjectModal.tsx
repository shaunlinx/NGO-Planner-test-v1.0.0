
import React, { useState, useRef, useEffect } from 'react';
import { Project, NgoDomain, ProjectStatus } from '../types';
import { DOMAINS } from '../constants';
import { analyzeProjectFile } from '../services/geminiService';
import * as mammoth from 'mammoth';
import * as pdfjsLib from 'pdfjs-dist';

// --- 引擎初始化修复 ---
const getLibrary = (lib: any) => lib?.default || lib;

const initPdfWorker = () => {
    try {
        const pdfClient = getLibrary(pdfjsLib);
        if (pdfClient && pdfClient.GlobalWorkerOptions) {
            // 同步使用 5.4.530 ESM Worker 路径
            pdfClient.GlobalWorkerOptions.workerSrc = 'https://esm.sh/pdfjs-dist@5.4.530/build/pdf.worker.mjs';
        }
    } catch (e) { console.error("PDF Worker Error:", e); }
};
initPdfWorker();

interface ImportProjectModalProps {
  onClose: () => void;
  onImport: (projects: Project[]) => void;
}

const CSV_TEMPLATE = `项目名称,领域,开始日期(YYYY-MM-DD),负责人,状态(Planning/Execution/Closing/Archived)
示例项目A,环保,2025-06-01,张三,Planning
示例项目B,儿童,2025-09-01,李四,Execution`;

const ImportProjectModal: React.FC<ImportProjectModalProps> = ({ onClose, onImport }) => {
  const [activeTab, setActiveTab] = useState<'SMART' | 'CSV'>('SMART');
  const [importedProjects, setImportedProjects] = useState<Project[]>([]);
  const [error, setError] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisStep, setAnalysisStep] = useState('');
  const [smartPreview, setSmartPreview] = useState<{
      title: string; domain: NgoDomain; startDate: string; leader: string; markdownContent: string;
  } | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        if (file.name.endsWith('.json')) {
          const data = JSON.parse(content);
          setImportedProjects((Array.isArray(data) ? data : [data]).map((p: any): Project => ({ ...p, id: `import-${Date.now()}-${Math.random().toString(36).substr(2,5)}`, created_at: Date.now() })));
        } else if (file.name.endsWith('.csv')) {
          const rows = content.split('\n').filter(r => r.trim() !== '');
          const projects: Project[] = rows.slice(rows[0].includes('名称') ? 1 : 0).map((r, i): Project => {
             const cols = r.split(',');
             return { 
                id: `imp-${Date.now()}-${i}`, 
                title: cols[0]?.trim() || '', 
                domain: (DOMAINS.includes(cols[1]?.trim() as any) ? cols[1]?.trim() : '其他') as NgoDomain, 
                startDate: cols[2]?.trim() || new Date().toISOString().split('T')[0], 
                leader: cols[3]?.trim(), 
                status: 'Planning', 
                source: 'Upload', 
                planLocked: false, 
                financialsLocked: false, 
                executionLocked: false, 
                reportLocked: false, 
                pptLocked: false, 
                created_at: Date.now(), 
                expenses: [], 
                milestones: [] 
             };
          }).filter(p => p.title);
          setImportedProjects(projects);
        }
      } catch (e: any) { setError('解析失败: ' + e.message); }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const handleSmartFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setIsAnalyzing(true);
      setAnalysisStep('读取文档内容...');
      try {
          let text = '';
          const arrayBuffer = await file.arrayBuffer();
          if (file.name.endsWith('.docx')) {
              const res = await getLibrary(mammoth).extractRawText({ arrayBuffer });
              text = res.value;
          } else if (file.name.endsWith('.pdf')) {
              const pdf = await getLibrary(pdfjsLib).getDocument({ data: arrayBuffer }).promise;
              for (let i = 1; i <= Math.min(pdf.numPages, 10); i++) {
                  const page = await pdf.getPage(i);
                  text += (await page.getTextContent()).items.map((it: any) => it.str).join(' ') + '\n';
              }
          }
          setAnalysisStep('AI 结构化解析中...');
          const aiRes = await analyzeProjectFile(text, file.name);
          setSmartPreview({ title: aiRes.title || file.name, domain: aiRes.domain || '其他', startDate: aiRes.startDate || new Date().toISOString().split('T')[0], leader: aiRes.leader || '', markdownContent: aiRes.markdownContent || text });
      } catch (e: any) { setError(`智能解析失败: ${e.message}`); } finally { setIsAnalyzing(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-gray-100 flex justify-between items-center bg-gray-50">
                <h3 className="font-bold text-gray-800 flex items-center gap-2">📥 导入项目数据</h3>
                <button onClick={onClose} className="text-gray-400 text-2xl hover:text-red-500">&times;</button>
            </div>
            
            <div className="flex border-b border-gray-100">
                <button onClick={() => setActiveTab('SMART')} className={`flex-1 py-3 text-xs font-bold border-b-2 ${activeTab === 'SMART' ? 'border-ngo-teal text-ngo-teal bg-indigo-50/30' : 'border-transparent text-gray-500'}`}>智能导入 (PDF/Word)</button>
                <button onClick={() => setActiveTab('CSV')} className={`flex-1 py-3 text-xs font-bold border-b-2 ${activeTab === 'CSV' ? 'border-ngo-teal text-ngo-teal bg-indigo-50/30' : 'border-transparent text-gray-500'}`}>批量导入 (CSV/JSON)</button>
            </div>

            <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
                {activeTab === 'SMART' && (
                    <div className="space-y-6">
                        {!smartPreview && !isAnalyzing && (
                            <div className="border-2 border-dashed border-indigo-200 rounded-2xl p-12 text-center hover:bg-indigo-50 transition-all cursor-pointer relative bg-indigo-50/20">
                                <input type="file" accept=".pdf,.docx" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleSmartFileChange} />
                                <div className="text-5xl mb-4">📄</div>
                                <h4 className="font-bold text-indigo-900 text-lg">上传策划文档</h4>
                                <p className="text-xs text-indigo-400 mt-2">支持 Word 或 PDF，AI 将自动转为结构化台账</p>
                            </div>
                        )}
                        {isAnalyzing && (
                            <div className="flex flex-col items-center justify-center py-12 gap-4">
                                <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                                <p className="text-indigo-800 font-bold animate-pulse">{analysisStep}</p>
                            </div>
                        )}
                        {smartPreview && (
                            <div className="space-y-4 animate-fade-in">
                                <div className="grid grid-cols-2 gap-4">
                                    <div><label className="block text-[10px] font-bold text-gray-400 mb-1">项目名称</label><input value={smartPreview.title} onChange={e=>setSmartPreview({...smartPreview, title: e.target.value})} className="w-full border rounded p-2 text-sm font-bold" /></div>
                                    <div><label className="block text-[10px] font-bold text-gray-400 mb-1">所属领域</label><select value={smartPreview.domain} onChange={e=>setSmartPreview({...smartPreview, domain: e.target.value as any})} className="w-full border rounded p-2 text-sm bg-white">{DOMAINS.map(d=><option key={d} value={d}>{d}</option>)}</select></div>
                                    <div><label className="block text-[10px] font-bold text-gray-400 mb-1">开始日期</label><input type="date" value={smartPreview.startDate} onChange={e=>setSmartPreview({...smartPreview, startDate: e.target.value})} className="w-full border rounded p-2 text-sm" /></div>
                                    <div><label className="block text-[10px] font-bold text-gray-400 mb-1">负责人</label><input value={smartPreview.leader} onChange={e=>setSmartPreview({...smartPreview, leader: e.target.value})} className="w-full border rounded p-2 text-sm" /></div>
                                </div>
                                <div><label className="block text-[10px] font-bold text-gray-400 mb-1">解析出的方案内容</label><textarea value={smartPreview.markdownContent} onChange={e=>setSmartPreview({...smartPreview, markdownContent: e.target.value})} className="w-full h-32 border rounded p-2 text-xs font-mono bg-gray-50" /></div>
                            </div>
                        )}
                    </div>
                )}

                {activeTab === 'CSV' && (
                    <div className="space-y-6">
                        <div className="border-2 border-dashed border-gray-200 rounded-2xl p-8 text-center bg-gray-50 relative">
                            <input type="file" accept=".json,.csv" className="absolute inset-0 opacity-0 cursor-pointer" onChange={handleFileChange} />
                            <div className="text-4xl mb-2">📂</div>
                            <p className="text-sm font-bold text-gray-500">点击上传文件 (.csv / .json)</p>
                        </div>
                        {importedProjects.length > 0 && (
                            <div className="border rounded-xl overflow-hidden max-h-40 overflow-y-auto">
                                <table className="w-full text-[10px] text-left">
                                    <thead className="bg-gray-100"><tr><th className="p-2">名称</th><th className="p-2">领域</th><th className="p-2">日期</th></tr></thead>
                                    <tbody className="divide-y divide-gray-50">{importedProjects.map((p,i)=><tr key={i}><td className="p-2 font-bold">{p.title}</td><td className="p-2">{p.domain}</td><td className="p-2">{p.startDate}</td></tr>)}</tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}
                {error && <div className="mt-4 p-3 bg-red-50 text-red-500 text-xs rounded-lg border border-red-100">⚠️ {error}</div>}
            </div>

            <div className="p-4 border-t border-gray-100 bg-white flex justify-end gap-3">
                <button onClick={onClose} className="px-6 py-2 rounded-xl border text-gray-500 text-sm font-bold hover:bg-gray-50">取消</button>
                <button onClick={() => { 
                    if(smartPreview) { 
                        const newProject: Project = { 
                            id: `p-${Date.now()}`, 
                            title: smartPreview.title, 
                            domain: smartPreview.domain, 
                            startDate: smartPreview.startDate, 
                            leader: smartPreview.leader, 
                            status: 'Planning', 
                            source: 'Upload', 
                            originalPlan: { 
                                type: 'Content', 
                                markdown: smartPreview.markdownContent, 
                                content: { topics: [], toolkits: [], platforms: [], format: '', rationale: '', recommendedArticlesOrBooks: [] } 
                            }, 
                            planLocked: false, 
                            financialsLocked: false, 
                            executionLocked: false, 
                            reportLocked: false, 
                            pptLocked: false, 
                            created_at: Date.now(), 
                            expenses: [], 
                            milestones: [] 
                        };
                        onImport([newProject]); 
                    } else { 
                        onImport(importedProjects); 
                    } 
                }} disabled={!smartPreview && importedProjects.length === 0} className="px-6 py-2 rounded-xl bg-indigo-600 text-white text-sm font-bold hover:bg-indigo-700 disabled:opacity-50">确认导入</button>
            </div>
        </div>
    </div>
  );
};

export default ImportProjectModal;