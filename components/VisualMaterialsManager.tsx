import React, { useState, useEffect, useRef } from 'react';
import { 
  PosterConfig, PosterRefinement, VisualProvider, VisualEngineConfig, TeamMember, PosterSlot, PromptLibraryItem
} from '../types';
import { 
  analyzePlanForPosters, 
  extractPromptFromImage, 
  constructPosterPrompt, 
  generateVisualContent 
} from '../services/visualDesignService';
import { savePromptToLibrary, loadPromptsFromLibrary, updatePromptInLibrary, deletePromptFromLibrary } from '../services/promptLibraryService';

interface VisualMaterialsManagerProps {
  planMarkdown: string;
  planTitle: string;
  posters: PosterSlot[];
  onUpdatePosters: (posters: PosterSlot[]) => void;
  warehousePath?: string;
  compact?: boolean;
  externalViewMode?: ViewMode;
  onExternalViewModeChange?: (mode: ViewMode) => void;
  hideWorkbenchHeader?: boolean;
  leftPanelOnly?: boolean;
  onReferenceImageUpload?: (file: File) => void;
  createButtonLabel?: string;
  saveButtonLabel?: string;
  hideRefinementSection?: boolean;
}

type ViewMode = 'workspace' | 'library';

const VisualMaterialsManager: React.FC<VisualMaterialsManagerProps> = ({ 
  planMarkdown, planTitle, posters, onUpdatePosters, warehousePath, compact = false, externalViewMode, onExternalViewModeChange, hideWorkbenchHeader = false, leftPanelOnly = false, onReferenceImageUpload, createButtonLabel = '立即生成', saveButtonLabel = '保存', hideRefinementSection = false
}) => {
  // --- State ---
  const [viewMode, setViewMode] = useState<ViewMode>('workspace');
  const [activePosterId, setActivePosterId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [visualConfigs, setVisualConfigs] = useState<Record<VisualProvider, VisualEngineConfig> | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  
  // Library State
  const [savedPrompts, setSavedPrompts] = useState<PromptLibraryItem[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [showManualAdd, setShowManualAdd] = useState(false);
  const [manualPromptText, setManualPromptText] = useState('');
  const [manualPromptImage, setManualPromptImage] = useState<string | undefined>(undefined);
  const [warehouseViewMode, setWarehouseViewMode] = useState<'preview' | 'list'>('preview');
  const [editingPromptId, setEditingPromptId] = useState<string | null>(null);
  const [editingPromptText, setEditingPromptText] = useState('');
  const [showTaskPicker, setShowTaskPicker] = useState(false);
  const currentViewMode = externalViewMode || viewMode;
  const switchViewMode = (mode: ViewMode) => {
      if (onExternalViewModeChange) onExternalViewModeChange(mode);
      else setViewMode(mode);
  };

  const postersRef = useRef(posters);
  useEffect(() => { postersRef.current = posters; }, [posters]);

  useEffect(() => {
      if (posters.length > 0 && !activePosterId) {
          setActivePosterId(posters[0].id);
      }
  }, [posters.length]);

  // Load Library on Mount or Tab Change
  useEffect(() => {
      // Library auto-refresh when not empty
      if (currentViewMode === 'library') refreshLibrary();
  }, [currentViewMode, warehousePath]);

  const refreshLibrary = async () => {
      // Allow loading from global fallback if warehousePath is missing
      setIsLoadingLibrary(true);
      try {
        let path = warehousePath;
        if (!path && (window as any).electronAPI) {
             const userData = await (window as any).electronAPI.getPath('userData');
             path = `${userData}/storage/DATA`;
        }
        if (path) {
            const items = await loadPromptsFromLibrary(path);
            setSavedPrompts(items);
        }
      } catch (e) {
          console.error("Failed to load library", e);
      } finally {
          setIsLoadingLibrary(false);
      }
  };

  // --- Helpers ---
  const loadLatestConfigs = async (): Promise<Record<VisualProvider, VisualEngineConfig>> => {
       const secure = (window as any).electronAPI?.secure;
       const configs: Record<string, VisualEngineConfig> = {};
       for (const p of ['Jimeng', 'Doubao', 'Nanobanana', 'Gemini'] as VisualProvider[]) {
           let apiKey = localStorage.getItem(`visual_api_key_${p}`) || '';
           let ak = localStorage.getItem(`visual_api_ak_${p}`) || '';
           let sk = localStorage.getItem(`visual_api_sk_${p}`) || '';

           if (secure) {
               const k = await secure.get(`visual_api_key_${p}`);
               if (k) apiKey = k;
               
               const k_ak = await secure.get(`visual_api_ak_${p}`);
               if (k_ak) ak = k_ak;
               
               const k_sk = await secure.get(`visual_api_sk_${p}`);
               if (k_sk) sk = k_sk;
           }
           const status = localStorage.getItem(`visual_api_status_${p}`);
           configs[p] = {
               provider: p,
               apiKey,
               accessKeyId: ak,
               secretAccessKey: sk,
               isEnabled: status ? status === 'active' : (p === 'Gemini')
           };
       }
       return configs;
  };

  useEffect(() => {
    loadLatestConfigs().then(setVisualConfigs);
  }, []);

  // --- Actions ---

  const handleAnalyzePlan = async () => {
    setIsAnalyzing(true);
    try {
        const milestones = await analyzePlanForPosters(planMarkdown);
        const newPosters: PosterSlot[] = milestones.map((m: any) => ({
            id: m.id || `poster-${Date.now()}-${Math.random()}`,
            title: m.title || '未命名海报',
            purpose: m.purpose || '',
            isGenerating: false,
            config: {
                aspectRatio: '3:4', 
                style: m.recommendedStyle || 'Modern',
                customText: m.title || '',
                subTitle: '',
                purpose: m.purpose,
                refinements: {}
            }
        }));
        onUpdatePosters(newPosters);
        if (newPosters.length > 0) setActivePosterId(newPosters[0].id);
        else alert("未识别到有效的海报需求节点，请尝试手动添加。");
    } catch (e: any) {
        console.error(e);
        alert("分析失败: " + e.message);
    } finally {
        setIsAnalyzing(false);
    }
  };

  const [isExtractingPrompt, setIsExtractingPrompt] = useState(false);

  const handleExtractPrompt = async (posterId: string, file: File) => {
    setIsExtractingPrompt(true);
    const reader = new FileReader();
    reader.onload = async (e) => {
        const base64 = e.target?.result as string;
        updatePosterConfig(posterId, { logoData: undefined }); 
        const slot = posters.find(p => p.id === posterId);
        if(!slot) {
            setIsExtractingPrompt(false);
            return;
        }
        try {
            const extractedPrompt = await extractPromptFromImage(base64);
            updatePosterConfig(posterId, { referenceImagePrompt: extractedPrompt });
            alert("风格提取成功！提示词已更新。");
        } catch (err: any) {
            alert("提取失败: " + err.message);
        } finally {
            setIsExtractingPrompt(false);
        }
    };
    reader.readAsDataURL(file);
  };

  const handleGenerate = async (posterId: string) => {
      const slot = posters.find(p => p.id === posterId);
      if (!slot) return;
      const currentConfigs = await loadLatestConfigs();
      setVisualConfigs(currentConfigs);
      const enabledConfigs = Object.values(currentConfigs).filter(c => {
          if (!c.isEnabled) return false;
          if (c.provider === 'Gemini') return true;
          if (c.provider === 'Jimeng' || c.provider === 'Doubao') {
              return !!(String(c.accessKeyId || '').trim() && String(c.secretAccessKey || '').trim());
          }
          return !!String(c.apiKey || '').trim();
      });

      if (enabledConfigs.length === 0) {
          alert("未配置任何启用的视觉设计引擎。请前往系统设置启用。");
          return;
      }

      onUpdatePosters(postersRef.current.map(p => p.id === posterId ? { ...p, isGenerating: true } : p));
      try {
          const fullPrompt = constructPosterPrompt(slot.config, slot.purpose);
          const imageBase64 = await generateVisualContent(fullPrompt, slot.config.aspectRatio, currentConfigs);
          onUpdatePosters(postersRef.current.map(p => p.id === posterId ? { ...p, generatedImage: imageBase64, isGenerating: false, finalPrompt: fullPrompt } : p));
      } catch (e: any) {
          alert("生成失败: " + e.message);
          onUpdatePosters(postersRef.current.map(p => p.id === posterId ? { ...p, isGenerating: false } : p));
      }
  };

  const handleUseAsReference = async (id: string) => {
      const slot = posters.find(p => p.id === id);
      if (!slot?.generatedImage) return;
      if(!confirm("将从当前生成图中提取风格提示词，覆盖现有的参考图描述。是否继续？")) return;
      
      try {
          const prompt = await extractPromptFromImage(slot.generatedImage);
          updatePosterConfig(id, { referenceImagePrompt: prompt });
          alert("✅ 风格已提取！请在“参考图”区域查看或修改 Prompt。");
      } catch(e: any) {
          alert("提取失败: " + e.message);
      }
  };

  const updatePosterConfig = (id: string, updates: Partial<PosterConfig>) => {
      onUpdatePosters(posters.map(p => {
          if (p.id !== id) return p;
          return { ...p, config: { ...p.config, ...updates } };
      }));
  };

  const updateRefinement = (id: string, key: keyof PosterRefinement, value: string) => {
      const slot = posters.find(p => p.id === id);
      if (!slot) return;
      const newRefinements = { ...(slot.config.refinements || {}), [key]: value };
      updatePosterConfig(id, { refinements: newRefinements });
  };

  // --- Library Actions ---
  const handleSaveToLibrary = async (content: string, source: PromptLibraryItem['source'], image?: string, silent: boolean = false) => {
      // Allow service to handle fallback if warehousePath is missing
      try {
          // Pass empty string if undefined to let service handle fallback logic
          await savePromptToLibrary(content, source, warehousePath || '', image);
          if (!silent) {
              alert("✅ 已保存到视觉仓库");
          }
      if (currentViewMode === 'library') refreshLibrary();
      } catch (e: any) {
          if (!silent) alert("保存失败: " + e.message);
      }
  };

  const handleManualAdd = async () => {
      if (!manualPromptText.trim()) {
          alert("请输入提示词内容");
          return;
      }
      await handleSaveToLibrary(manualPromptText, 'Manual', manualPromptImage);
      setManualPromptText('');
      setManualPromptImage(undefined);
      setShowManualAdd(false);
  };

  const handleApplyPrompt = (content: string) => {
      if (!activePosterId) {
          alert("请先选择一个海报任务");
          return;
      }
      if (confirm("确定要将此 Prompt 应用到当前海报的“参考图风格”中吗？")) {
          updatePosterConfig(activePosterId, { referenceImagePrompt: content });
          switchViewMode('workspace');
      }
  };

  const startEditPrompt = (item: PromptLibraryItem) => {
      setEditingPromptId(item.id);
      setEditingPromptText(item.content);
  };

  const saveEditedPrompt = async (item: PromptLibraryItem) => {
      const nextItem = { ...item, content: editingPromptText };
      await updatePromptInLibrary(nextItem, warehousePath || '');
      setEditingPromptId(null);
      setEditingPromptText('');
      await refreshLibrary();
  };

  const removePrompt = async (item: PromptLibraryItem) => {
      await deletePromptFromLibrary(item, warehousePath || '');
      await refreshLibrary();
  };

  // --- Render ---
  const activePoster = posters.find(p => p.id === activePosterId);

  if (!visualConfigs) return <div>Loading Configs...</div>;

  return (
    <div className={`${leftPanelOnly ? 'bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-3 border border-slate-200 dark:border-slate-700 h-full min-h-0 flex flex-col' : compact ? 'bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 border border-slate-200 dark:border-slate-700 mt-2 min-h-[620px] flex flex-col' : 'bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-6 border border-slate-200 dark:border-slate-700 mt-8 min-h-[800px] flex flex-col'}`}>
      {!hideWorkbenchHeader && <div className={`${compact ? 'flex justify-between items-center mb-4 shrink-0 py-1' : 'flex justify-between items-center mb-8 shrink-0 py-2'}`}>
          <div className="flex items-center gap-4">
              <div className={`${compact ? 'w-10 h-10 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-xl flex items-center justify-center text-white text-xl shadow-lg shadow-purple-100' : 'w-12 h-12 bg-gradient-to-br from-purple-600 to-indigo-600 rounded-2xl flex items-center justify-center text-white text-2xl shadow-xl shadow-purple-200'}`}>
                  🎨
              </div>
              <div>
                  <h3 className={`${compact ? 'text-lg font-black text-slate-800 dark:text-white tracking-tight' : 'text-xl font-black text-slate-800 dark:text-white tracking-tight'}`}>视觉物料工作台</h3>
                  <p className="text-xs text-slate-500 font-medium mt-1">基于策划案自动拆解里程碑，多模型协同生成高品质海报</p>
              </div>
          </div>
          
          <div className={`${compact ? 'flex bg-slate-100 p-1 rounded-full border border-slate-200' : 'flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200'}`}>
              {[
                  { id: 'workspace', label: '🛠️ 创意空间' },
                  { id: 'library', label: '📚 视觉仓库' }
              ].map(tab => (
                  <button
                      key={tab.id}
                      onClick={() => switchViewMode(tab.id as ViewMode)}
                      className={`${compact ? 'px-4 py-2 rounded-full text-xs font-bold transition-all' : 'px-5 py-2.5 rounded-xl text-xs font-bold transition-all'} ${currentViewMode === tab.id ? 'bg-white text-purple-600 shadow-md transform scale-105' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-200/50'}`}
                  >
                      {tab.label}
                  </button>
              ))}
          </div>
      </div>}

      {/* Content Area */}
      <div className="flex-1 flex flex-col min-h-0 h-full">
          
          {/* VIEW: WORKSPACE */}
          {currentViewMode === 'workspace' && (
              <>
                {posters.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                        <button 
                            onClick={handleAnalyzePlan}
                            disabled={isAnalyzing}
                            className="px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-200 transition-all flex items-center gap-2"
                        >
                            {isAnalyzing ? (
                                <>
                                    <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    <span>智能拆解中...</span>
                                </>
                            ) : (
                                <><span>✨</span> 分析方案并创建生产区</>
                            )}
                        </button>
                    </div>
                ) : (
                    <div className="flex flex-col gap-6 h-full">
                        {/* Milestone Tabs */}
                        <div className={`flex overflow-visible custom-scrollbar shrink-0 px-1 ${leftPanelOnly ? 'gap-1.5 pb-1.5 items-center' : 'gap-4 pb-4'}`}>
                            {leftPanelOnly ? (
                                <div className="relative">
                                    <button
                                        onClick={() => setShowTaskPicker((prev) => !prev)}
                                        className="w-8 h-8 rounded-lg border border-slate-200 bg-white text-slate-600 hover:text-indigo-600 hover:border-indigo-300 flex items-center justify-center"
                                        title={activePoster ? `TASK：${activePoster.title || '未命名'}` : '选择TASK'}
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M5 7h14M5 12h14M5 17h14" /></svg>
                                    </button>
                                    {showTaskPicker && (
                                        <div className="absolute z-20 top-10 left-0 w-52 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl p-1.5 space-y-1">
                                            {posters.map((p) => (
                                                <button
                                                    key={p.id}
                                                    onClick={() => {
                                                        setActivePosterId(p.id);
                                                        setShowTaskPicker(false);
                                                    }}
                                                    className={`w-full px-2 py-1.5 rounded-lg text-left text-[11px] font-bold flex items-center justify-between ${activePosterId === p.id ? 'bg-indigo-50 text-indigo-700' : 'text-slate-600 hover:bg-slate-50'}`}
                                                    title={p.title}
                                                >
                                                    <span className="truncate">{p.title || '未命名任务'}</span>
                                                    <span className="text-[10px]">{p.generatedImage ? '✅' : '•'}</span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ) : posters.map(p => (
                                <button
                                    key={p.id}
                                    onClick={() => setActivePosterId(p.id)}
                                    className={`flex-shrink-0 relative group transition-all duration-300 ${activePosterId === p.id ? 'scale-105' : 'hover:scale-102'}`}
                                >
                                    <div className="w-32 p-3 rounded-xl border transition-all bg-white dark:bg-slate-800 border-slate-200 hover:border-purple-300 hover:shadow-sm">
                                        <div className="flex justify-between items-start mb-1.5">
                                            <span className={`text-[9px] px-1.5 py-0.5 font-bold rounded-full ${activePosterId === p.id ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-500'}`}>TASK</span>
                                            {p.generatedImage && <span className="text-[10px]">✅</span>}
                                        </div>
                                        <div className={`text-xs font-bold truncate mb-0.5 ${activePosterId === p.id ? 'text-slate-800' : 'text-slate-600'}`}>{p.title}</div>
                                        <div className="text-[9px] text-slate-400 truncate">{p.config.aspectRatio} · {p.config.style || '默认'}</div>
                                    </div>
                                </button>
                            ))}
                            <button 
                                onClick={() => {
                                    const newId = `poster-manual-${Date.now()}`;
                                    onUpdatePosters([...posters, {
                                        id: newId, title: '新海报', purpose: '', isGenerating: false,
                                        config: { aspectRatio: '3:4', style: '', refinements: {} }
                                    }]);
                                    setActivePosterId(newId);
                                    setShowTaskPicker(false);
                                }}
                                className={`flex-shrink-0 flex items-center justify-center border border-dashed border-slate-300 hover:border-purple-400 hover:bg-purple-50 text-slate-400 hover:text-purple-500 transition-all ${leftPanelOnly ? 'w-8 rounded-lg' : 'w-12 rounded-xl'}`}
                            >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                            </button>
                        </div>

                        {/* Workspace Body */}
                        {activePoster && (
                            <div className={`${compact ? 'flex flex-col xl:flex-row gap-4 animate-fade-in flex-1 h-full items-stretch overflow-hidden pb-2' : 'flex gap-6 animate-fade-in flex-1 h-full items-stretch overflow-hidden pb-2'}`}>
                                {/* Configuration */}
                                <div className={`${leftPanelOnly ? 'w-full flex-shrink-0 flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-1 pb-4 h-full' : compact ? 'xl:w-[320px] flex-shrink-0 flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-1 pb-4 h-full' : 'w-[340px] flex-shrink-0 flex flex-col gap-4 overflow-y-auto custom-scrollbar pr-1 pb-4 h-full'}`}>
                                    <div className="bg-white dark:bg-slate-800 p-4 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm space-y-3">
                                        <div className="flex justify-between items-center">
                                            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">图片简介</label>
                                            <div className="flex gap-1">
                                                {['1:1', '3:4', '4:3', '16:9'].map(r => (
                                                    <button 
                                                        key={r}
                                                        onClick={() => updatePosterConfig(activePoster.id, { aspectRatio: r as any })}
                                                        className={`px-1.5 py-0.5 text-[9px] font-bold rounded border ${activePoster.config.aspectRatio === r ? 'bg-purple-50 text-purple-600 border-purple-200' : 'bg-slate-50 text-slate-500 border-slate-200'}`}
                                                    >
                                                        {r}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <input value={activePoster.config.customText || ''} onChange={e => updatePosterConfig(activePoster.id, { customText: e.target.value })} className="w-full text-xs p-2 rounded border border-slate-200 bg-slate-50 focus:border-purple-500 outline-none font-bold" placeholder="主标题" />
                                        <input value={activePoster.config.subTitle || ''} onChange={e => updatePosterConfig(activePoster.id, { subTitle: e.target.value })} className="w-full text-xs p-2 rounded border border-slate-200 bg-slate-50 focus:border-purple-500 outline-none" placeholder="副标题" />
                                    </div>

                                    {!hideRefinementSection && <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-700 shadow-sm overflow-hidden flex-1 flex flex-col min-h-0">
                                        <div className="p-3 bg-slate-50/50 border-b border-slate-100 shrink-0">
                                            <span className="text-xs font-black text-slate-700">🎨 细节调优</span>
                                        </div>
                                        <div className="p-3 space-y-3 overflow-y-auto custom-scrollbar flex-1">
                                            <div>
                                                 <div className="flex justify-between items-center mb-1">
                                                     <label className="text-[10px] font-bold text-slate-400">参考图风格</label>
                                                     <div className="flex gap-2 items-center">
                                                         {isExtractingPrompt && (
                                                             <span className="text-[10px] text-purple-600 animate-pulse font-bold flex items-center gap-1">
                                                                 <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                                                 解析中...
                                                             </span>
                                                         )}
                                                         <label className={`p-1 rounded hover:bg-slate-100 text-indigo-500 cursor-pointer transition-colors ${isExtractingPrompt ? 'opacity-50 pointer-events-none' : ''}`} title="上传参考图">
                                                             <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                                                            <input type="file" className="hidden" accept="image/*" disabled={isExtractingPrompt} onChange={(e) => {
                                                                if (e.target.files?.[0]) {
                                                                    handleExtractPrompt(activePoster.id, e.target.files[0]);
                                                                    if (onReferenceImageUpload) onReferenceImageUpload(e.target.files[0]);
                                                                }
                                                             }}/>
                                                         </label>
                                                     </div>
                                                 </div>
                                                 <textarea 
                                                    value={activePoster.config.referenceImagePrompt || activePoster.config.style}
                                                    onChange={e => updatePosterConfig(activePoster.id, { referenceImagePrompt: e.target.value })}
                                                    className="w-full h-16 bg-slate-50 text-[10px] p-2 rounded-lg border border-slate-200 focus:border-purple-500 outline-none resize-none"
                                                    placeholder="风格描述 / 提取的 Prompt..."
                                                 />
                                            </div>
                                            {[
                                                { id: 'background', label: '背景', placeholder: '材质/颜色...' },
                                                { id: 'colorScheme', label: '配色', placeholder: '色系/参考...' },
                                                { id: 'textElements', label: '字效', placeholder: '字体/排版...' },
                                                { id: 'decorations', label: '装饰', placeholder: '元素/纹理...' },
                                                { id: 'layout', label: '构图', placeholder: '布局结构...' },
                                            ].map((field) => (
                                                <div key={field.id} className="flex gap-2 items-center">
                                                    <label className="w-8 text-[10px] font-bold text-slate-400 text-right">{field.label}</label>
                                                    <input 
                                                        value={(activePoster.config.refinements as any)?.[field.id] || ''}
                                                        onChange={e => updateRefinement(activePoster.id, field.id as any, e.target.value)}
                                                        className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-[10px] outline-none focus:border-purple-500"
                                                        placeholder={field.placeholder}
                                                    />
                                                </div>
                                            ))}
                                        </div>
                                    </div>}
                                </div>

                                {/* Preview */}
                                {!leftPanelOnly && <div className="flex-1 flex flex-col gap-4 min-w-0 self-stretch">
                                    <div className="flex-1 w-full bg-slate-100 dark:bg-slate-900 rounded-3xl border-2 border-dashed border-slate-200 dark:border-slate-700 flex items-center justify-center relative overflow-hidden group shadow-inner min-h-[400px]">
                                        {activePoster.generatedImage ? (
                                            <div className="relative w-full h-full flex items-center justify-center cursor-zoom-in p-8" onClick={() => setPreviewImage(activePoster.generatedImage || null)}>
                                                <img src={activePoster.generatedImage} className="max-w-full max-h-full object-contain shadow-2xl rounded-lg" />
                                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none"></div>
                                            </div>
                                        ) : (
                                            <div className="text-center text-slate-400 flex flex-col items-center">
                                                <div className="w-20 h-20 bg-slate-200 rounded-full flex items-center justify-center mb-4">
                                                    <svg className="w-10 h-10 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
                                                </div>
                                                <div className="text-sm font-bold text-slate-500">预览区域为空</div>
                                                <div className="text-[10px] mt-1 opacity-70">请在左侧配置完成后点击生成</div>
                                            </div>
                                        )}
                                        {activePoster.generatedImage && (
                                            <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                                                <button onClick={() => handleGenerate(activePoster.id)} className="p-2.5 bg-white/90 backdrop-blur rounded-xl text-indigo-600 hover:scale-105 transition-all shadow-lg border border-indigo-100" title="基于当前配置重新生成">
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                                </button>
                                                <button onClick={() => handleUseAsReference(activePoster.id)} className="p-2.5 bg-white/90 backdrop-blur rounded-xl text-purple-600 hover:scale-105 transition-all shadow-lg border border-purple-100" title="提取此风格">
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.387-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                                                </button>
                                                <a href={activePoster.generatedImage} download={`poster-${activePoster.title}.png`} className="p-2.5 bg-white/90 backdrop-blur rounded-xl text-slate-600 hover:scale-105 transition-all shadow-lg border border-slate-100" title="下载海报">
                                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/></svg>
                                                </a>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex flex-col gap-2 shrink-0">
                                        <button onClick={() => handleGenerate(activePoster.id)} disabled={activePoster.isGenerating} className={`w-full py-4 rounded-2xl text-base font-bold shadow-xl transition-all flex items-center justify-center gap-2 ${activePoster.isGenerating ? 'bg-slate-100 text-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 text-white hover:shadow-2xl hover:-translate-y-0.5 active:scale-[0.99]'}`}>
                                            {activePoster.isGenerating ? (
                                                <>
                                                    <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                                    <span>AI 绘制中...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                                                    <span>{createButtonLabel}</span>
                                                </>
                                            )}
                                        </button>
                                        
                                        {(activePoster.generatedImage || activePoster.config.referenceImagePrompt || activePoster.config.style) && (
                                            <button 
                                                onClick={() => handleSaveToLibrary(activePoster.config.referenceImagePrompt || activePoster.config.style || '', 'Generated', activePoster.generatedImage)}
                                                className="w-full py-4 rounded-2xl bg-white border-2 border-slate-200 text-slate-600 hover:border-green-400 hover:text-green-600 hover:bg-green-50 hover:shadow-xl transition-all text-base font-bold flex items-center justify-center gap-2"
                                            >
                                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" /></svg>
                                                {saveButtonLabel}
                                            </button>
                                        )}
                                    </div>
                                </div>
                                }
                            </div>
                        )}
                    </div>
                )}
              </>
          )}

          {/* VIEW: LIBRARY */}
          {currentViewMode === 'library' && (
              <div className="flex flex-col h-full relative">
                  <div className="flex justify-between items-center mb-4 px-1">
                      <div className="text-xs text-slate-400 font-bold uppercase tracking-wider">视觉仓库 {savedPrompts.length} 条</div>
                      <div className="flex items-center gap-2">
                        <div className="inline-flex p-1 rounded-full border border-slate-200 bg-white">
                          <button onClick={() => setWarehouseViewMode('preview')} className={`px-3 py-1 rounded-full text-[11px] font-bold ${warehouseViewMode === 'preview' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>完整预览</button>
                          <button onClick={() => setWarehouseViewMode('list')} className={`px-3 py-1 rounded-full text-[11px] font-bold ${warehouseViewMode === 'list' ? 'bg-slate-900 text-white' : 'text-slate-500'}`}>列表清单</button>
                        </div>
                        <button 
                          onClick={() => setShowManualAdd(true)}
                          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-lg shadow flex items-center gap-2"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"/></svg>
                            手动添加
                        </button>
                      </div>
                  </div>

                  {isLoadingLibrary ? (
                      <div className="flex-1 flex items-center justify-center text-slate-400">加载中...</div>
                  ) : savedPrompts.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
                          <span className="text-4xl mb-2">📚</span>
                          <p>词库暂空</p>
                      </div>
                  ) : warehouseViewMode === 'preview' ? (
                      <div className="space-y-4 overflow-y-auto custom-scrollbar pr-2 pb-4">
                          {savedPrompts.map(item => (
                              <div key={item.id} className="bg-white rounded-xl border border-slate-100 shadow-sm overflow-hidden">
                                  <div className="grid grid-cols-1 md:grid-cols-2">
                                      <div className="p-4 border-r border-slate-100">
                                          <div className="flex flex-wrap gap-1 mb-2">
                                              {item.tags.map((tag, i) => (
                                                  <span key={i} className="text-[9px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded">{tag}</span>
                                              ))}
                                          </div>
                                          {editingPromptId === item.id ? (
                                            <textarea value={editingPromptText} onChange={(e) => setEditingPromptText(e.target.value)} className="w-full h-40 p-3 rounded-lg border border-slate-200 text-xs bg-slate-50 outline-none resize-none" />
                                          ) : (
                                            <pre className="text-xs text-slate-600 whitespace-pre-wrap break-words">{item.content}</pre>
                                          )}
                                      </div>
                                      <div className="p-4 bg-slate-50 flex items-center justify-center">
                                          {item.previewImage ? <img src={item.previewImage} className="max-w-full max-h-48 object-contain rounded-lg" /> : <div className="text-xs text-slate-400">无图片</div>}
                                      </div>
                                  </div>
                                  <div className="px-4 py-2 border-t border-slate-100 flex items-center justify-between text-[10px] text-slate-400">
                                      <span>{new Date(item.createdAt).toLocaleDateString()} · {item.source}</span>
                                      <div className="flex items-center gap-3">
                                          <button onClick={() => handleApplyPrompt(item.content)} className="text-indigo-600 font-bold">使用</button>
                                          {editingPromptId === item.id ? (
                                            <button onClick={() => saveEditedPrompt(item)} className="text-emerald-600 font-bold">保存修改</button>
                                          ) : (
                                            <button onClick={() => startEditPrompt(item)} className="text-slate-600 font-bold">编辑</button>
                                          )}
                                          <button onClick={() => removePrompt(item)} className="text-red-600 font-bold">删除</button>
                                      </div>
                                  </div>
                              </div>
                          ))}
                      </div>
                  ) : (
                      <div className="overflow-y-auto custom-scrollbar pr-2 pb-4">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-slate-400 border-b border-slate-100">
                                <th className="text-left py-2">时间</th>
                                <th className="text-left py-2">来源</th>
                                <th className="text-left py-2">标签</th>
                                <th className="text-right py-2">操作</th>
                              </tr>
                            </thead>
                            <tbody>
                              {savedPrompts.map((item) => (
                                <tr key={item.id} className="border-b border-slate-50">
                                  <td className="py-2 text-slate-500">{new Date(item.createdAt).toLocaleDateString()}</td>
                                  <td className="py-2 text-slate-500">{item.source}</td>
                                  <td className="py-2 text-slate-500">{item.tags.join(' / ')}</td>
                                  <td className="py-2 text-right space-x-3">
                                    <button onClick={() => handleApplyPrompt(item.content)} className="text-indigo-600 font-bold">使用</button>
                                    <button onClick={() => startEditPrompt(item)} className="text-slate-600 font-bold">编辑</button>
                                    <button onClick={() => removePrompt(item)} className="text-red-600 font-bold">删除</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                      </div>
                  )}

                  {/* Manual Add Modal */}
                  {showManualAdd && (
                      <div className="absolute inset-0 bg-white/95 backdrop-blur z-10 flex flex-col p-6 animate-fade-in rounded-xl">
                          <div className="flex justify-between items-center mb-6">
                              <h3 className="text-lg font-bold text-slate-800">手动添加到视觉仓库</h3>
                              <button onClick={() => setShowManualAdd(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
                                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                              </button>
                          </div>
                          <div className="flex-1 flex flex-col gap-4">
                              <textarea 
                                  value={manualPromptText}
                                  onChange={e => setManualPromptText(e.target.value)}
                                  placeholder="在此输入或粘贴提示词内容..."
                                  className="flex-1 w-full p-4 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:border-indigo-500 outline-none resize-none text-sm"
                              />
                              <div className="flex items-center gap-4">
                                  <label className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer">
                                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"/></svg>
                                      {manualPromptImage ? '已选择图片' : '上传参考图 (可选)'}
                                      <input type="file" accept="image/*" className="hidden" onChange={e => {
                                          if (e.target.files?.[0]) {
                                              const reader = new FileReader();
                                              reader.onload = (ev) => setManualPromptImage(ev.target?.result as string);
                                              reader.readAsDataURL(e.target.files[0]);
                                          }
                                      }}/>
                                  </label>
                                  <div className="flex-1"></div>
                                  <button 
                                      onClick={handleManualAdd}
                                      className="px-8 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-bold shadow-lg"
                                  >
                                      保存到视觉仓库
                                  </button>
                              </div>
                          </div>
                      </div>
                  )}
              </div>
          )}
      </div>

      {/* Fullscreen Preview */}
      {previewImage && (
          <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-sm flex items-center justify-center p-8 animate-fade-in" onClick={() => setPreviewImage(null)}>
              <img src={previewImage} className="max-w-full max-h-full object-contain shadow-2xl" onClick={e => e.stopPropagation()} />
              <button className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors" onClick={() => setPreviewImage(null)}>
                  <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
              </button>
          </div>
      )}
    </div>
  );
};

export default VisualMaterialsManager;
