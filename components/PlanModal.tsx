
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import JSZip from 'jszip';
import { CalendarEvent, GeneratedPlan, NgoDomain, PlanCustomization, PosterConfig, Project, TeamMember, SOPDocument, EventPlanState, MilestoneItem, PosterSlot, PlannerEventContextConfig } from '../types';
import { generateCampaignPlan, generateToolkitContent, identifyAttachments, generateEventPoster, refinePlanWithChat } from '../services/geminiService';
import { BUDGET_TIERS, POSTER_STYLES, PLATFORM_OPTIONS, CONTENT_FORMAT_OPTIONS } from '../constants'; 

import VisualMaterialsManager from './VisualMaterialsManager';
import ExportMenu from './ExportMenu';
import PlanningContextModal from './PlanningContextModal';
import { buildPlannerAssistantContext, getPlannerEventContextConfig, getPlannerKbScopesForEvents } from '../services/plannerContextService';

interface PlanModalProps {
  event: CalendarEvent | null;
  onClose: () => void;
  isMinimized: boolean;
  onMinimize: () => void;
  onRestore: () => void;
  onStatusChange?: (status: { loading: boolean, step: 'draft' | 'confirmed', progressInfo?: string }) => void;
  
  preSelectedDomain: NgoDomain;
  onDomainChange: (domain: NgoDomain) => void;
  onCreateProject?: (project: Project) => void; 
  warehousePath?: string;
  teamMembers?: TeamMember[];
  currentUserRole?: string;
  allEvents?: CalendarEvent[];
  eventScopeIds?: string[];
  eventScopeSignature?: string;
  savedStates?: {
      Content?: EventPlanState;
      Event?: EventPlanState;
      TaskAnalysis?: EventPlanState;
  };
  onSavePlanState?: (state: EventPlanState) => void;
  onViewProject?: (projectId: string) => void;
  mainSidebarCollapsed?: boolean;
}

// --- Internal State Definition ---
interface TabState {
    plan: GeneratedPlan | null;
    isPlanConfirmed: boolean;
    toolkitList: string[];
    fileCache: Record<string, string>;
    chatHistory: {role: 'user'|'model', text: string}[];
    
    // Visuals
    posterConfig: PosterConfig;
    generatedPoster: string | null;
    visualPosters: PosterSlot[];
    
    // Inputs (Persist per tab)
    customization: {
        platforms: string[];
        contentFormat: string;
        eventType: '线上' | '线下' | '';
        eventCycle: string;
        eventScale: string;
        eventBudget: string;
        budgetStep: number;
        additionalRequirements: string;
        customDescription: string;
    };

    // Status
    isLoading: boolean;
    isChatting: boolean;
}

const DEFAULT_POSTER_CONFIG: PosterConfig = {
    aspectRatio: '3:4',
    style: '扁平插画 (Flat)',
    detailLevel: 'Minimalist',
    colorPaletteUrl: '',
    platform: ['小红书'],
    customText: '',
    colorTheme: '莫兰迪',
    selectedModel: 'Gemini'
};

const DEFAULT_CUSTOMIZATION = {
    platforms: [],
    contentFormat: '',
    eventType: '' as any,
    eventCycle: '2-3天 (周末集市/训练营)',
    eventScale: '小型',
    eventBudget: BUDGET_TIERS[3].value, // Default step 3
    budgetStep: 3,
    additionalRequirements: '',
    customDescription: ''
};

const PlanModal: React.FC<PlanModalProps> = ({ 
    event, 
    onClose, 
    isMinimized,
    onMinimize,
    onRestore,
    onStatusChange,
    preSelectedDomain, 
    onDomainChange, 
    onCreateProject, 
    warehousePath, 
    teamMembers = [], 
    currentUserRole,
    allEvents = [],
    eventScopeIds = [],
    eventScopeSignature = '',
    savedStates,
    onSavePlanState,
    onViewProject,
    mainSidebarCollapsed = false
}) => {
  const [domain, setDomain] = useState<NgoDomain>(preSelectedDomain);
  const [templateType, setTemplateType] = useState<'Content' | 'Event' | 'TaskAnalysis'>('TaskAnalysis');
  const [isInternalSidebarCollapsed, setIsInternalSidebarCollapsed] = useState(false);
  const [activeView, setActiveView] = useState<'text' | 'visuals'>('text');
  
  // --- Unified State Management ---
  const getInitialTabState = (type: 'Content' | 'Event' | 'TaskAnalysis'): TabState => {
      const saved = savedStates?.[type];
      
      const baseState: TabState = {
          plan: null,
          isPlanConfirmed: false,
          toolkitList: [],
          fileCache: {},
          chatHistory: [],
          posterConfig: { ...DEFAULT_POSTER_CONFIG, customText: event?.title || '' },
          generatedPoster: null,
          visualPosters: [],
          customization: { ...DEFAULT_CUSTOMIZATION, customDescription: event?.description || '' },
          isLoading: false,
          isChatting: false
      };

      if (saved) {
          baseState.plan = saved.plan;
          baseState.isPlanConfirmed = saved.isAdopted || false;
          
          if (saved.sops && saved.sops.length > 0) {
              const cache: Record<string, string> = {};
              const list: string[] = [];
              saved.sops.forEach(s => {
                  cache[s.title] = s.content;
                  list.push(s.title);
              });
              baseState.fileCache = cache;
              baseState.toolkitList = list;
          } else if (saved.isAdopted && saved.plan) {
              const defaultToolkits = saved.plan.content?.toolkits || saved.plan.event?.toolkits || [];
              baseState.toolkitList = defaultToolkits;
          }
      }
      return baseState;
  };

  // The Big State Object
  const [tabStates, setTabStates] = useState<{
      Content: TabState;
      Event: TabState;
      TaskAnalysis: TabState;
  }>({
      Content: getInitialTabState('Content'),
      Event: getInitialTabState('Event'),
      TaskAnalysis: getInitialTabState('TaskAnalysis')
  });

  // Derived Current State
  const currentTab = tabStates[templateType];
  const currentSavedState = savedStates?.[templateType];
  const isLocked = !!currentSavedState?.linkedProjectId; // This means it's in the Ledger

  // Transient Global State (UI only)
  const [activeGenerations, setActiveGenerations] = useState<Set<string>>(new Set()); 
  const [previewFile, setPreviewFile] = useState<{name: string, content: string} | null>(null); 
  const [isEditingFile, setIsEditingFile] = useState(false);
  const [editedFileContent, setEditedFileContent] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [analyzingAttachments, setAnalyzingAttachments] = useState<string | null>(null);
  const [isGeneratingPoster, setIsGeneratingPoster] = useState(false);
  const [isEditingPlan, setIsEditingPlan] = useState(false);
  // Default position: ~20px from top, ~30px from right.
  const [editBtnPos, setEditBtnPos] = useState({ top: 80, right: 40 });
  const [plannerContextConfig, setPlannerContextConfig] = useState<PlannerEventContextConfig | null>(null);
  const [plannerContextText, setPlannerContextText] = useState<string>('');
  const [isPlannerContextLoading, setIsPlannerContextLoading] = useState(false);
  const [showPlannerContextModal, setShowPlannerContextModal] = useState(false);

  // Refs
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const sidebarScrollRef = useRef<HTMLDivElement>(null);
  const sopSectionRef = useRef<HTMLDivElement>(null);
  
  // Dragging Refs
  const isDraggingBtn = useRef(false);
  const dragStartPos = useRef({ x: 0, y: 0 });
  const btnStartPos = useRef({ top: 0, right: 0 });

  useEffect(() => { setDomain(preSelectedDomain); }, [preSelectedDomain]);
  useEffect(() => { if (chatScrollRef.current) chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight; }, [currentTab.chatHistory, templateType]);
  useEffect(() => {
      if (!event) return;
      let isActive = true;
      (async () => {
          setIsPlannerContextLoading(true);
          try {
              const cfg = await getPlannerEventContextConfig(event.id);
              if (!isActive) return;
              setPlannerContextConfig(cfg);
              const globalKbScopes = await getPlannerKbScopesForEvents(eventScopeIds);
              if (!isActive) return;
              const ctx = await buildPlannerAssistantContext({ event, allEvents, config: cfg, globalKbScopes });
              if (!isActive) return;
              setPlannerContextText(ctx || '');
          } catch (e) {
              if (!isActive) return;
              setPlannerContextText('');
          } finally {
              if (!isActive) return;
              setIsPlannerContextLoading(false);
          }
      })();
      return () => { isActive = false; };
  }, [event?.id, allEvents.length, eventScopeSignature]);

  // Report status to parent
  useEffect(() => {
      if (onStatusChange) {
          const loading = Object.values(tabStates).some((s: TabState) => s.isLoading);
          // Show info for current tab preferably
          const filesCount = Object.keys(currentTab.fileCache).length;
          const totalFiles = (Array.isArray(currentTab.toolkitList) ? currentTab.toolkitList : []).length;
          let progress = '';
          if (currentTab.isPlanConfirmed) {
              progress = totalFiles > 0 ? `已生成 ${filesCount}/${totalFiles} 文档` : '定稿已就绪';
          }
          
          onStatusChange({
              loading: loading,
              step: currentTab.isPlanConfirmed ? 'confirmed' : 'draft',
              progressInfo: progress
          });
      }
  }, [tabStates, currentTab, onStatusChange]);

  // Helper to update specific tab state
  const updateTab = (type: 'Content'|'Event'|'TaskAnalysis', updates: Partial<TabState>) => {
      setTabStates(prev => ({
          ...prev,
          [type]: { ...prev[type], ...updates }
      }));
  };

  const updateCurrentTab = (updates: Partial<TabState>) => updateTab(templateType, updates);

  const updateCustomization = (updates: Partial<TabState['customization']>) => {
      setTabStates(prev => ({
          ...prev,
          [templateType]: { 
              ...prev[templateType], 
              customization: { ...prev[templateType].customization, ...updates }
          }
      }));
  };

  const togglePlatform = (p: string) => {
      const current = currentTab.customization.platforms || [];
      const updated = current.includes(p) ? current.filter(x => x !== p) : [...current, p];
      updateCustomization({ platforms: updated });
  };

  // Sync Changes to Parent (Auto-Save Plan State for ACTIVE Tab)
  useEffect(() => {
      const plan = currentTab.plan;
      if (onSavePlanState && event && plan) {
          const sops: SOPDocument[] = Object.entries(currentTab.fileCache as Record<string, string>).map(([title, content]) => ({
              id: `sop-${title}`,
              title,
              content: String(content || ''),
              type: title.endsWith('csv') ? 'csv' : 'markdown'
          }));

          onSavePlanState({
              eventId: event.id,
              plan: plan,
              sops: sops,
              isAdopted: currentTab.isPlanConfirmed,
              linkedProjectId: currentSavedState?.linkedProjectId, // Preserve link
              updatedAt: Date.now()
          });
      }
  }, [currentTab.plan, currentTab.fileCache, currentTab.isPlanConfirmed, currentSavedState?.linkedProjectId]); 

  // Auto-scroll logic for SOP section
  useEffect(() => {
      if (currentTab.isPlanConfirmed && sopSectionRef.current) {
          setTimeout(() => {
             sopSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }, 100);
      }
  }, [currentTab.isPlanConfirmed, templateType]); 

  if (!event) return null;

  // --- CORE ACTIONS ---

  const handleGenerate = async () => {
    const targetType = templateType; 
    const targetState = tabStates[targetType];

    if (isLocked) {
        if (!confirm("⚠️ 警告：此节点已关联到正在执行的台账项目。\n重新生成将覆盖当前的解析草稿。确定要重新生成吗？")) return;
    }

    updateTab(targetType, { 
        isLoading: true,
        plan: null, 
        isPlanConfirmed: false, 
        toolkitList: [], 
        chatHistory: [], 
        fileCache: {} 
    });
    
    try {
      const cust = targetState.customization;
      const customizationParams: PlanCustomization = {
        platforms: cust.platforms,
        contentFormat: cust.contentFormat,
        eventType: cust.eventType === '' ? undefined : cust.eventType,
        eventCycle: cust.eventCycle,
        eventScale: cust.eventScale,
        eventBudget: cust.eventBudget,
        additionalRequirements: cust.additionalRequirements
      };

      const eventForGen = { ...event };
      if (cust.customDescription) eventForGen.description = cust.customDescription;

      const result = await generateCampaignPlan(eventForGen, domain, targetType, customizationParams, teamMembers, currentUserRole, plannerContextText);
      
      updateTab(targetType, {
          plan: result,
          chatHistory: [{ role: 'model', text: targetType === 'TaskAnalysis' 
            ? '任务解析已完成！我为您分析了执行本任务的战略意义及落地步骤。\n\n💡 您可以继续追问特定细节，或点击【确认定稿】获取执行工具包建议。'
            : '方案已生成！您可以在右侧预览。\n\n💡 如果需要修改，请直接在下方对话框输入指令。\n✅ 确认无误后，点击左侧【确认定稿】以生成执行SOP。' 
          }]
      });

      if (onSavePlanState && event) {
          onSavePlanState({
              eventId: event.id,
              plan: result,
              sops: [],
              isAdopted: false,
              updatedAt: Date.now()
          });
      }

    } catch (error: any) {
      alert("生成失败: " + error.message);
    } finally {
      updateTab(targetType, { isLoading: false });
    }
  };

  const handleChatRefine = async () => {
      const targetType = templateType;
      const targetState = tabStates[targetType];

      if (!chatInput.trim() || !targetState.plan) return;
      
      if (targetState.isPlanConfirmed && !isLocked) {
          if (!confirm("⚠️ 已定稿内容。修改需要【撤销定稿】，这将清空已生成的配套文件。是否继续？")) return;
          updateTab(targetType, { isPlanConfirmed: false, toolkitList: [], fileCache: {} });
      } else if (isLocked) {
          alert("❌ 项目已立项，无法在此处修改。请前往【行动台账】进行变更。");
          return;
      }

      const userMsg = chatInput;
      const newHistory = [...targetState.chatHistory, {role: 'user', text: userMsg} as const];
      
      updateTab(targetType, { chatHistory: newHistory, isChatting: true });
      setChatInput('');
      
      try {
          const newMarkdown = await refinePlanWithChat(targetState.plan.markdown, userMsg, newHistory, plannerContextText);
          const updatedPlan = { ...targetState.plan!, markdown: newMarkdown };
          
          updateTab(targetType, {
              plan: updatedPlan,
              chatHistory: [...newHistory, {role: 'model', text: '✅ 已根据您的要求更新解析。\n如需生成新的配套文件，请点击【确认定稿】。'}]
          });

          if (onSavePlanState && event) {
                onSavePlanState({
                    eventId: event.id,
                    plan: updatedPlan,
                    sops: [], 
                    isAdopted: false,
                    updatedAt: Date.now()
                });
          }

      } catch (e: any) {
          updateTab(targetType, {
              chatHistory: [...newHistory, {role: 'model', text: `❌ 修改失败: ${e.message}`}]
          });
      } finally {
          updateTab(targetType, { isChatting: false });
      }
  };

  const handleConfirmPlan = async () => {
      const targetType = templateType;
      const targetState = tabStates[targetType];
      if (!targetState.plan) return;
      
      updateTab(targetType, { isPlanConfirmed: true });
      
      const defaultToolkits = targetState.plan.content?.toolkits || targetState.plan.event?.toolkits || [];
      const currentList = new Set([...targetState.toolkitList, ...defaultToolkits]);
      updateTab(targetType, { toolkitList: Array.from(currentList) });

      setAnalyzingAttachments("MAIN_PLAN"); 
      
      try {
          const suggestedAttachments = await identifyAttachments("解析内容.md", targetState.plan.markdown, event.title, domain);
          
          setTabStates(prev => {
              const current = prev[targetType];
              if (current.isPlanConfirmed) {
                  const validatedAttachments = Array.isArray(suggestedAttachments) ? suggestedAttachments : [];
                  return {
                      ...prev,
                      [targetType]: {
                          ...current,
                          toolkitList: Array.from(new Set([...current.toolkitList, ...validatedAttachments]))
                      }
                  };
              }
              return prev;
          });
      } catch (e) {
          console.warn("AI attachment analysis failed", e);
      } finally {
          setAnalyzingAttachments(null);
      }
  };

  const handleUnlockPlan = () => {
      const targetType = templateType;
      const targetState = tabStates[targetType];
      if (Object.keys(targetState.fileCache).length > 0) {
          if (!confirm("⚠️ 撤销定稿将【清空】当前已生成的配套文件。\n\n确定要返回草稿模式重新编辑吗？")) return;
      }
      updateTab(targetType, { 
          isPlanConfirmed: false,
          toolkitList: [],
          fileCache: {} 
      });
  };

  const generateSingleToolkit = async (filename: string) => {
      const targetType = templateType;
      const targetState = tabStates[targetType];

      if (targetState.fileCache[filename] || activeGenerations.has(filename)) return; 
      
      setActiveGenerations(prev => new Set(prev).add(filename));
      try {
          const cust = targetState.customization;
          const customizationParams: PlanCustomization = {
            platforms: cust.platforms,
            contentFormat: cust.contentFormat,
            eventType: cust.eventType === '' ? undefined : cust.eventType,
            eventCycle: cust.eventCycle,
            eventScale: cust.eventScale,
            eventBudget: cust.eventBudget,
            additionalRequirements: cust.additionalRequirements
          };

          const content = await generateToolkitContent(
              filename, 
              event.title, 
              domain, 
              targetState.plan?.markdown || "", 
              teamMembers,
              customizationParams
          );
          
          setTabStates(prev => ({
              ...prev,
              [targetType]: {
                  ...prev[targetType],
                  fileCache: {
                      ...prev[targetType].fileCache,
                      [filename]: content
                  }
              }
          }));

      } catch (e) {
          console.error(e);
          alert("SOP 生成失败，请重试");
      } finally {
          setActiveGenerations(prev => { const next = new Set(prev); next.delete(filename); return next; });
      }
  };

  const openFileEditor = (name: string) => {
      if (currentTab.fileCache[name]) {
          setPreviewFile({ name, content: currentTab.fileCache[name] });
          setEditedFileContent(currentTab.fileCache[name]);
          setIsEditingFile(false);
      }
  };

  const saveFileChanges = () => {
      if (!previewFile) return;
      updateCurrentTab({
          fileCache: { ...currentTab.fileCache, [previewFile.name]: editedFileContent }
      });
      setPreviewFile(prev => prev ? { ...prev, content: editedFileContent } : null);
      setIsEditingFile(false);
      alert("✅ 内容已更新 (暂存)");
  };

  const downloadFile = (name: string, content: string) => {
      const blob = new Blob(["\uFEFF" + content], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const handleExportPDF = async (name: string) => {
      if ((window as any).electronAPI?.printToPDF) {
          // Temporarily hide other elements using CSS media query logic or just print the whole window
          // Ideally we should open a new window with just the content, but printToPDF prints the current window.
          // For now, we rely on the user seeing the preview modal and printing that.
          await (window as any).electronAPI.printToPDF(name.replace(/\.[^/.]+$/, ""));
      } else {
          window.print();
      }
  };

  const handleExportWord = async (name: string, content: string) => {
      if ((window as any).electronAPI?.exportToWord) {
          // Convert Markdown to HTML
          const html = renderToStaticMarkup(
            <div style={{ fontFamily: 'Arial', lineHeight: '1.6' }}>
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            </div>
          );
          const fullHtml = `
            <!DOCTYPE html>
            <html>
            <head><meta charset="utf-8"></head>
            <body>${html}</body>
            </html>
          `;
          await (window as any).electronAPI.exportToWord(name.replace(/\.[^/.]+$/, ""), fullHtml);
      } else {
          alert("此功能仅在桌面版可用");
      }
  };

  const handleExportExcel = async (name: string, content: string) => {
      if ((window as any).electronAPI?.exportToExcel) {
          await (window as any).electronAPI.exportToExcel(name.replace(/\.[^/.]+$/, ""), content);
      } else {
          alert("此功能仅在桌面版可用");
      }
  };

  const handleDownloadPackage = async () => {
      if (!currentTab.plan) return;
      const zip = new JSZip();
      zip.file(`${event.title}_完整方案.md`, currentTab.plan.markdown);
      Object.entries(currentTab.fileCache).forEach(([name, content]) => {
          const prefix = name.endsWith('.csv') ? "\uFEFF" : "";
          zip.file(name, prefix + content);
      });
      if (currentTab.generatedPoster) {
          const imgData = currentTab.generatedPoster.split(',')[1];
          zip.file("活动海报.png", imgData, {base64: true});
      }
      const content = await zip.generateAsync({type:"blob"});
      const url = URL.createObjectURL(content);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${event.title}_${templateType}_资料包.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
  };

  const handleInitiateProject = async () => {
      if (!currentTab.plan || !onCreateProject) return;
      const projectTypeMap = { 'Content': '传播', 'Event': '活动', 'TaskAnalysis': '工作项' };
      const projectTitle = `${event.title} - ${domain}${projectTypeMap[templateType]}`;
      const sops: SOPDocument[] = [];
      for (const [filename, content] of Object.entries(currentTab.fileCache)) {
          sops.push({
              id: `sop-${Date.now()}-${filename}`,
              title: filename,
              content: String(content),
              type: filename.endsWith('csv') ? 'csv' : 'markdown'
          });
      }
      
      if (warehousePath && window.electronAPI) {
          const safeWarehouse = warehousePath.endsWith('/') || warehousePath.endsWith('\\') ? warehousePath : `${warehousePath}/`;
          const projectRoot = `${safeWarehouse}${projectTitle}/`;
          
          await window.electronAPI.fs.ensureDir(`${projectRoot}Docs/`);
          await window.electronAPI.fs.ensureDir(`${projectRoot}Images/`);
          await window.electronAPI.fs.writeFile(`${projectRoot}Docs/${projectTitle}_初始方案.md`, currentTab.plan.markdown);
          for (const sop of sops) {
              let finalContent = String(sop.content);
              if (sop.type === 'csv') finalContent = "\uFEFF" + finalContent;
              await window.electronAPI.fs.writeFile(`${projectRoot}Docs/${sop.title}`, finalContent);
          }
          await window.electronAPI.fs.ensureDir(`${projectRoot}Docs/PlanningContext/`);
          if (plannerContextText && plannerContextText.trim()) {
              await window.electronAPI.fs.writeFile(`${projectRoot}Docs/PlanningContext/项目背景_策划助手上下文.md`, plannerContextText);
          }
          const packs = Array.isArray(plannerContextConfig?.referencePacks) ? plannerContextConfig!.referencePacks : [];
          for (const p of packs) {
              if (!p?.folderPath || !p?.packId) continue;
              const dest = `${projectRoot}Docs/PlanningContext/${p.packId}`;
              await window.electronAPI.fs.copyFiles(p.folderPath, dest);
          }
          
          // --- Enhanced Visual Assets Persistence ---
          // 1. Prepare visual data
          let postersToSave = currentTab.visualPosters || [];
          
          // If legacy poster exists but no visual posters, create a synthetic one
          if (postersToSave.length === 0 && currentTab.generatedPoster) {
              postersToSave = [{
                  id: `legacy-${Date.now()}`,
                  title: '活动海报',
                  purpose: 'Main Poster',
                  isGenerating: false,
                  generatedImage: currentTab.generatedPoster,
                  config: currentTab.posterConfig,
                  finalPrompt: currentTab.posterConfig.customText
              }];
          }

          if (postersToSave.length > 0) {
             try {
                 // 2. Save all generated posters as files
                 for (const poster of postersToSave) {
                     if (poster.generatedImage) {
                         // Robust Base64 extraction
                         let imgData = poster.generatedImage;
                         if (imgData.includes(',')) {
                             imgData = imgData.split(',')[1];
                         }
                         
                         if (imgData) {
                             await window.electronAPI.fs.writeFile(`${projectRoot}Images/poster_${poster.id}.png`, imgData, {encoding: 'base64'});
                             console.log(`Saved poster: poster_${poster.id}.png`);
                         }
                     }
                 }
                 // 3. Save Visual Config
                 await window.electronAPI.fs.writeFile(
                     `${projectRoot}Docs/visual_config.json`, 
                     JSON.stringify(postersToSave, null, 2)
                 );
                 console.log("Saved visual_config.json");

                 // 4. Migrate Global Prompts to Project Local Library
                 const userDataPath = await window.electronAPI.getPath('userData');
                 const globalPromptsPath = `${userDataPath}/storage/DATA/Knowledge/Prompts`;
                 const projectPromptsPath = `${projectRoot}Knowledge/Prompts`;
                 
                 await window.electronAPI.fs.ensureDir(projectPromptsPath);
                 await window.electronAPI.fs.copyFiles(globalPromptsPath, projectPromptsPath);
                 
                 // Alert success with path
                 alert(`✅ 项目已立项！\n视觉物料已保存至：\n${projectRoot}Images/`);

             } catch (e) {
                 console.error("Failed to save visual assets", e);
                 alert("视觉素材保存失败，请检查日志");
             }
          }
      }

      const initialMilestones: MilestoneItem[] = (templateType === 'Event' && currentTab.plan.event?.keyStages) 
        ? currentTab.plan.event.keyStages.map((stage, idx) => ({ 
            id: `ms-${Date.now()}-${idx}`, 
            stage: '筹备执行', 
            task: stage, 
            status: 'Pending',
            evidence: []
          }))
        : []; 

      // Merge visual posters into the plan object before saving
      const finalPlan = {
          ...currentTab.plan,
          visuals: {
              posters: currentTab.visualPosters || []
          }
      };

      const newProject: Project = {
          id: `proj-${Date.now()}`,
          title: projectTitle,
          domain: domain,
          startDate: event.date,
          status: 'Planning',
          source: 'Calendar',
          type: templateType === 'Event' ? 'Event' : 'Content',
          originalEventId: event.id,
          originalPlan: finalPlan,
          sops: sops, 
          expenses: [],
          milestones: initialMilestones,
          created_at: Date.now(),
          planLocked: false,
          financialsLocked: false,
          executionLocked: false,
          reportLocked: false,
          pptLocked: false,
          warehousePath: warehousePath 
      };
      
      onCreateProject(newProject);
      onClose(); 
  };

  const handleGeneratePoster = async () => {
      if (!event) return;
      setIsGeneratingPoster(true);
      try {
          const config: PosterConfig = { ...currentTab.posterConfig, customText: currentTab.posterConfig.customText || event.title };
          const base64Image = await generateEventPoster(event, domain, config);
          updateCurrentTab({ generatedPoster: base64Image });
      } catch (e: any) {
          alert("海报生成失败: " + e.message);
      } finally {
          setIsGeneratingPoster(false);
      }
  };

  const handleUpdatePosters = (newPosters: PosterSlot[]) => {
      const targetType = templateType;
      
      setTabStates(prev => {
          const current = prev[targetType];
          // Also update the plan object to ensure persistence
          const updatedPlan = current.plan ? {
              ...current.plan,
              visuals: {
                  ...current.plan.visuals,
                  posters: newPosters
              }
          } : current.plan;

          return {
              ...prev,
              [targetType]: {
                  ...current,
                  visualPosters: newPosters,
                  plan: updatedPlan
              }
          };
      });
  };

  const handleBtnMouseDown = (e: React.MouseEvent) => {
      e.preventDefault();
      isDraggingBtn.current = true;
      dragStartPos.current = { x: e.clientX, y: e.clientY };
      btnStartPos.current = { ...editBtnPos };
      
      const handleMouseMove = (ev: MouseEvent) => {
          if (!isDraggingBtn.current) return;
          const deltaY = ev.clientY - dragStartPos.current.y; // Moving down = positive
          
          // Only update top (vertical movement)
          setEditBtnPos(prev => ({
              ...prev,
              top: btnStartPos.current.top + deltaY
          }));
      };
      
      const handleMouseUp = () => {
          isDraggingBtn.current = false;
          window.removeEventListener('mousemove', handleMouseMove);
          window.removeEventListener('mouseup', handleMouseUp);
      };
      
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
  };

  const renderFileEditorModal = () => {
      if (!previewFile) return null;
      const isCsv = previewFile.name.toLowerCase().endsWith('.csv') || (previewFile.name.toLowerCase().endsWith('.txt') && (previewFile.content as string).includes(',') && (previewFile.content as string).split('\n')[0].includes(','));
      
      const renderCsv = (content: string) => {
          const rows = content.trim().split('\n').map(r => r.split(','));
          return (
              <div className="overflow-auto border border-gray-200 rounded">
                  <table className="min-w-full text-sm">
                      <thead className="bg-gray-100"><tr>{rows[0]?.map((h,i)=><th key={i} className="px-4 py-2 border font-bold">{h.replace(/"/g,'')}</th>)}</tr></thead>
                      <tbody>{rows.slice(1).map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j} className="px-4 py-2 border">{c.replace(/"/g,'')}</td>)}</tr>)}</tbody>
                  </table>
              </div>
          );
      };

      return (
          <div className="fixed inset-0 z-[70] bg-black/70 flex items-center justify-center p-4" onClick={() => setPreviewFile(null)}>
              <div className="bg-white w-full max-w-4xl h-[85vh] rounded-xl flex flex-col shadow-2xl overflow-hidden animate-fade-in-up" onClick={e => e.stopPropagation()}>
                  <div className="flex justify-between items-center p-4 border-b border-gray-200 bg-gray-50">
                      <div className="flex items-center gap-3">
                          <div className="bg-blue-100 p-2 rounded text-xl">{isCsv ? '📊' : '📄'}</div>
                          <div><h3 className="font-bold text-gray-800">{previewFile.name}</h3><p className="text-xs text-gray-500">{isEditingFile ? '编辑模式' : (isCsv ? '表格预览' : '文档预览')}</p></div>
                      </div>
                      <div className="flex gap-2">
                          {isEditingFile ? (
                              <><button onClick={() => setIsEditingFile(false)} className="px-3 py-1.5 text-xs text-gray-600 border rounded">取消</button><button onClick={saveFileChanges} className="px-3 py-1.5 text-xs bg-green-600 text-white rounded font-bold">保存修改</button></>
                          ) : (
                              <>
                                  <button onClick={() => downloadFile(previewFile.name, previewFile.content)} className="px-3 py-1.5 text-xs border border-gray-300 rounded" title="下载原始文件">⬇️ 源码</button>
                                  <ExportMenu 
                                      content={previewFile.content} 
                                      type={isCsv ? 'csv' : 'markdown'} 
                                      fileName={previewFile.name} 
                                  />
                                  <button onClick={() => { setIsEditingFile(true); setEditedFileContent(previewFile.content); }} className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded">✏️ 编辑</button>
                              </>
                          )}
                          <button onClick={() => setPreviewFile(null)} className="ml-2 text-gray-400 hover:text-red-500 text-xl">&times;</button>
                      </div>
                  </div>
                  <div className="flex-1 bg-white overflow-hidden relative">
                      {isEditingFile ? (
                          <textarea value={editedFileContent} onChange={e => setEditedFileContent(e.target.value)} className="w-full h-full p-6 outline-none resize-none font-mono text-sm leading-relaxed" spellCheck={false}/>
                      ) : (
                          <div className="h-full overflow-auto p-8 bg-gray-50 custom-scrollbar">
                              {isCsv ? renderCsv(previewFile.content) : <div className="prose prose-sm max-w-none bg-white p-6 rounded shadow-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{previewFile.content}</ReactMarkdown></div>}
                          </div>
                      )}
                  </div>
              </div>
          </div>
      );
  };

  return (
    <div 
        className={`fixed z-50 flex flex-col transition-all duration-300 overflow-hidden rounded-2xl border border-slate-200 shadow-2xl bg-white ${isMinimized ? 'opacity-0 pointer-events-none translate-x-6' : 'opacity-100 translate-x-0'}`}
        style={{
            left: mainSidebarCollapsed ? 'calc(5rem + 1rem)' : 'calc(16rem + 1rem)',
            top: '1rem',
            right: '1rem',
            bottom: '1rem'
        }}
    >
      {renderFileEditorModal()}
      {showPlannerContextModal && event && (
          <PlanningContextModal
              event={event}
              allEvents={allEvents}
              initialConfig={plannerContextConfig || {}}
              onClose={() => setShowPlannerContextModal(false)}
              onSaved={(cfg) => {
                  setPlannerContextConfig(cfg);
                  (async () => {
                      try {
                          const globalKbScopes = await getPlannerKbScopesForEvents(eventScopeIds);
                          const ctx = await buildPlannerAssistantContext({ event, allEvents, config: cfg, globalKbScopes });
                          setPlannerContextText(ctx || '');
                      } catch (e) {
                          setPlannerContextText('');
                      }
                  })();
              }}
          />
      )}
      
      <div className={`w-full h-full flex flex-col overflow-hidden animate-fade-in-up`}>
        <div className="shrink-0 border-b border-slate-200 bg-white/95 backdrop-blur z-20 px-5 py-4">
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
                <div className="min-w-0 flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-ngo-teal shrink-0" />
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                            <div className="text-sm font-black text-slate-900 truncate">
                                {event.isCustom ? '✨' : '📅'} {event.title}
                            </div>
                            <div className="text-xs font-bold text-slate-400 shrink-0">| 策划助手</div>
                        </div>
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                            <span className="bg-slate-100 text-slate-700 text-[10px] px-2 py-0.5 rounded font-mono border border-slate-200">{event.date}</span>
                            {currentUserRole && <span className="bg-slate-100 text-slate-700 text-[10px] px-2 py-0.5 rounded border border-slate-200">👤 {currentUserRole} 视角</span>}
                            {isLocked && <span className="bg-orange-50 text-orange-700 text-[10px] px-2 py-0.5 rounded border border-orange-200 font-black">🔒 已立项</span>}
                        </div>
                    </div>
                </div>

                <div className="flex justify-center">
                    <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200">
                        {[
                            { id: 'TaskAnalysis', label: '📋 任务解析' },
                            { id: 'Content', label: '📢 内容传播' },
                            { id: 'Event', label: '📅 活动策划' }
                        ].map((type) => {
                            const typeLocked = !!savedStates?.[type.id as any]?.linkedProjectId;
                            const state = tabStates[type.id as any];
                            const hasPlan = !!state.plan;
                            const active = templateType === type.id;
                            return (
                                <button
                                    key={type.id}
                                    onClick={() => setTemplateType(type.id as any)}
                                    className={`px-3 py-1.5 rounded-lg text-xs font-black transition-all flex items-center gap-1.5 ${
                                        active
                                            ? 'bg-white text-slate-900 shadow-sm'
                                            : 'text-slate-500 hover:text-slate-800 hover:bg-white/60'
                                    }`}
                                >
                                    {type.label}
                                    {typeLocked && <span className="text-[9px] text-slate-400">🔒</span>}
                                    {!typeLocked && hasPlan && <span className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-ngo-teal' : 'bg-emerald-400'}`} />}
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="flex justify-end items-center gap-2">
                    <button onClick={onMinimize} className="text-slate-500 hover:text-slate-900 p-2 rounded-xl hover:bg-slate-100 transition-colors" title="最小化">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 13H5" /></svg>
                    </button>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-900 p-2 rounded-xl hover:bg-slate-100 transition-colors" title="关闭">
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
            </div>
        </div>

        <div className="flex-1 flex overflow-hidden relative">
            <div className={`${isInternalSidebarCollapsed ? 'w-0 opacity-0 overflow-hidden' : 'w-80 opacity-100'} border-r border-slate-200 bg-slate-50 flex flex-col shrink-0 transition-all duration-300 relative`}>
                <div className="px-4 pt-4 pb-3 flex items-center justify-between">
                    <div className="text-[10px] font-black tracking-widest text-slate-500 uppercase">功能栏</div>
                    <button
                        onClick={() => setIsInternalSidebarCollapsed(true)}
                        className="p-2 rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50 transition-colors"
                        title="收起功能栏"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                    </button>
                </div>
                <div className="px-4 pb-3">
                    <button
                        onClick={() => setShowPlannerContextModal(true)}
                        className="w-full px-3 py-2 rounded-2xl border border-slate-200 bg-white hover:bg-slate-50 transition-colors flex items-center justify-between"
                        title="上下文配置"
                    >
                        <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full bg-ngo-teal" />
                            <div className="text-xs font-black text-slate-900">上下文配置</div>
                        </div>
                        <div className="flex items-center gap-2">
                            {isPlannerContextLoading && <div className="text-[10px] text-slate-400 font-bold">加载中</div>}
                            {!isPlannerContextLoading && plannerContextText && <div className="text-[10px] text-emerald-600 font-black">已就绪</div>}
                            <svg className="w-4 h-4 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                        </div>
                    </button>
                </div>

                {/* Fixed Header for Confirmed State */}
                {currentTab.isPlanConfirmed && (
                    <div className="p-4 pb-0 space-y-4 shrink-0 z-20 bg-gray-50">
                        <div className="bg-green-50 border border-green-200 rounded-lg p-2 flex justify-between items-center">
                            <span className="text-xs font-bold text-green-800">🔒 已定稿内容</span>
                            {!isLocked && <button onClick={handleUnlockPlan} className="text-[10px] text-blue-600 hover:underline bg-white px-2 py-0.5 rounded border border-blue-100">修改解析</button>}
                        </div>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-4" ref={sidebarScrollRef}>
                    {isLocked && (
                        <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                            <h4 className="text-orange-800 text-xs font-bold mb-1">🔗 已流转至行动台账</h4>
                            <button onClick={() => onViewProject && currentSavedState?.linkedProjectId && onViewProject(currentSavedState.linkedProjectId)} className="w-full bg-orange-600 text-white text-xs font-bold py-1.5 rounded hover:bg-orange-700">🚀 跳转项目详情</button>
                        </div>
                    )}

                    {!currentTab.plan && !isLocked && (
                        <div className="bg-white p-3 rounded-lg border border-gray-200 shadow-sm transition-all duration-300">
                            {templateType === 'TaskAnalysis' ? (
                                <div className="space-y-3">
                                    <div className="text-xs text-indigo-600 font-bold bg-indigo-50 p-3 rounded-lg border border-indigo-100 mb-2">
                                        💡 <b>回退式解析：</b> AI 将先推算任务的战略必要性，再给出执行路径。适用于排期拆解出的具体工作项。
                                    </div>
                                    <div><label className="text-[10px] font-bold text-gray-500 block mb-1">执行重点/补充信息</label><textarea value={currentTab.customization.additionalRequirements} onChange={e=>updateCustomization({additionalRequirements: e.target.value})} className="w-full text-xs border rounded p-1.5 bg-gray-50 h-20 resize-none" placeholder="例如：本项目对资方透明度要求极高..."/></div>
                                </div>
                            ) : (
                                <div className="space-y-3">
                                    {templateType === 'Event' && (
                                        <>
                                            <div><label className="text-[10px] font-bold text-gray-500 block mb-1">活动形式</label><select value={currentTab.customization.eventType} onChange={e=>updateCustomization({eventType: e.target.value as any})} className="w-full text-xs border rounded p-1.5 bg-gray-50"><option value="">不限</option><option value="线上">线上</option><option value="线下">线下</option></select></div>
                                            <div><label className="text-[10px] font-bold text-gray-500 block mb-1">规模预估</label><select value={currentTab.customization.eventScale} onChange={e=>updateCustomization({eventScale: e.target.value})} className="w-full text-xs border rounded p-1.5 bg-gray-50"><option value="">不限</option><option value="小型">小型</option><option value="大型">大型</option></select></div>
                                        </>
                                    )}

                                    {templateType === 'Content' && (
                                        <>
                                            <div>
                                                <label className="text-[10px] font-bold text-gray-500 block mb-1">传播平台</label>
                                                <div className="grid grid-cols-2 gap-1.5">
                                                    {PLATFORM_OPTIONS.map(p => (
                                                        <label key={p} className={`flex items-center gap-1 px-2 py-1.5 rounded border text-[10px] cursor-pointer transition-all ${currentTab.customization.platforms.includes(p) ? 'bg-indigo-50 border-indigo-200 text-indigo-700 font-bold' : 'bg-white border-gray-200 text-gray-500 hover:bg-gray-50'}`}>
                                                            <input type="checkbox" className="hidden" checked={currentTab.customization.platforms.includes(p)} onChange={() => togglePlatform(p)} />
                                                            {p}
                                                        </label>
                                                    ))}
                                                </div>
                                            </div>
                                            <div><label className="text-[10px] font-bold text-gray-500 block mb-1 mt-2">形式</label><select value={currentTab.customization.contentFormat} onChange={e=>updateCustomization({contentFormat: e.target.value})} className="w-full text-xs border rounded p-1.5 bg-gray-50"><option value="">AI 自动推荐</option>{CONTENT_FORMAT_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}</select></div>
                                        </>
                                    )}
                                    <div><label className="text-[10px] font-bold text-gray-500 block mb-1">预算: <span className="text-ngo-teal">{BUDGET_TIERS[currentTab.customization.budgetStep].value}</span></label><input type="range" min="0" max="10" step="1" value={currentTab.customization.budgetStep} onChange={e=> { const step = parseInt(e.target.value); updateCustomization({ budgetStep: step, eventBudget: BUDGET_TIERS[step].value }) }} className="w-full h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-ngo-teal"/></div>
                                </div>
                            )}
                            <button onClick={handleGenerate} disabled={currentTab.isLoading} className={`w-full mt-3 bg-gradient-to-r text-white font-bold py-2 px-4 rounded-lg shadow-md hover:shadow-lg transition-all flex justify-center items-center gap-2 text-xs from-indigo-600 to-purple-600`}>
                                {currentTab.isLoading ? <span className="animate-spin">⏳</span> : '✨'}
                                {currentTab.isLoading ? 'AI 分析中...' : '开始解析任务'}
                            </button>
                        </div>
                    )}

                    {currentTab.plan && !currentTab.isPlanConfirmed && !isLocked && (
                        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 space-y-3 animate-fade-in">
                            <h4 className="text-yellow-800 font-bold text-xs">📝 草稿调整阶段</h4>
                            <button onClick={handleConfirmPlan} className="w-full bg-green-600 text-white font-bold py-2 rounded-lg shadow hover:bg-green-700 transition-colors text-sm">✅ 确认定稿并获取工具包</button>
                            <button onClick={handleGenerate} disabled={currentTab.isLoading} className="w-full bg-white border border-gray-300 text-gray-600 font-bold py-2 rounded-lg hover:bg-gray-50 text-xs">🔄 重新分析</button>
                        </div>
                    )}

                    {currentTab.isPlanConfirmed && (
                        <div className="space-y-4 animate-fade-in">
                            <div ref={sopSectionRef} className="bg-white border border-blue-200 rounded-lg overflow-hidden shadow-sm flex flex-col max-h-[300px]">
                                <div className="bg-blue-50 px-3 py-2 border-b border-blue-100 flex justify-between items-center shrink-0">
                                    <h4 className="font-bold text-blue-800 text-xs">🧰 配套执行工具</h4>
                                    <span className="text-[10px] text-blue-600">{Object.keys(currentTab.fileCache).length}/{(Array.isArray(currentTab.toolkitList) ? currentTab.toolkitList : []).length}</span>
                                </div>
                                <div className="p-2 space-y-1 overflow-y-auto custom-scrollbar flex-1">
                                    {analyzingAttachments === "MAIN_PLAN" && <div className="text-center text-xs py-2 text-blue-500 animate-pulse">AI 正在深度拆解配套工具...</div>}
                                    {(Array.isArray(currentTab.toolkitList) ? currentTab.toolkitList : []).map(filename => {
                                        const isCached = !!currentTab.fileCache[filename];
                                        const isGenerating = activeGenerations.has(filename);
                                        return (
                                            <div key={filename} className="flex items-center gap-2 p-2 rounded border border-gray-100 bg-gray-50 hover:bg-white transition-colors group">
                                                <span className="text-lg">{filename.endsWith('.csv') ? '📊' : '📄'}</span>
                                                <div className="flex-1 min-w-0"><div className="text-xs font-medium text-gray-700 truncate">{filename}</div></div>
                                                {isCached ? (<button onClick={() => openFileEditor(filename)} className="text-xs text-blue-600 font-bold px-1">查看</button>) : (<button onClick={() => generateSingleToolkit(filename)} disabled={isGenerating || isLocked} className="text-xs bg-white border border-blue-200 text-blue-600 px-2 py-0.5 rounded">{isGenerating ? '生成中' : '获取'}</button>)}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    )}
                    <div className="h-20"></div>
                </div>

                {currentTab.isPlanConfirmed && (
                    <div className="p-4 border-t border-gray-200 bg-white space-y-2 shrink-0 z-10 shadow-lg">
                        <button onClick={handleDownloadPackage} className="w-full border border-gray-300 text-gray-600 py-2 rounded-lg text-xs font-bold">📦 打包下载资料</button>
                        {!isLocked && <button onClick={handleInitiateProject} className="w-full bg-gray-800 text-white py-3 rounded-lg text-sm font-bold">🚀 正式立项执行</button>}
                    </div>
                )}

                {/* AI Chat Assistant (Moved from Right Sidebar) */}
                {currentTab.plan && !currentTab.isPlanConfirmed && !isLocked && (
                    <div className="border-t border-gray-200 bg-white p-3 shrink-0 shadow-inner z-10 flex flex-col gap-2">
                        {currentTab.chatHistory.length > 0 && (
                            <div className="max-h-48 overflow-y-auto space-y-2 p-2 bg-gray-50 rounded-lg text-xs custom-scrollbar" ref={chatScrollRef}>
                                {currentTab.chatHistory.map((msg, i) => (
                                    <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                        <div className={`max-w-[90%] px-2 py-1.5 rounded-lg ${msg.role === 'user' ? 'bg-indigo-100 text-indigo-900' : 'bg-white border border-gray-200 text-gray-700'}`}>
                                            <span className="font-bold mr-1">{msg.role === 'user' ? '我:' : 'AI:'}</span><span className="whitespace-pre-wrap">{msg.text}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                        <div className="relative flex items-center gap-2">
                            <input 
                                type="text" 
                                value={chatInput} 
                                onChange={e => setChatInput(e.target.value)} 
                                onKeyDown={e => e.key === 'Enter' && !currentTab.isChatting && handleChatRefine()} 
                                placeholder="输入修改指令..." 
                                className="w-full pl-3 pr-10 py-2 rounded-lg border border-gray-300 focus:border-ngo-teal outline-none text-xs" 
                                disabled={currentTab.isChatting || currentTab.isLoading} 
                            />
                            <button onClick={handleChatRefine} disabled={currentTab.isChatting || currentTab.isLoading || !chatInput.trim()} className="absolute right-1 top-1 p-1 bg-ngo-teal text-white rounded text-xs">
                                {currentTab.isChatting ? '...' : '➤'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {isInternalSidebarCollapsed && (
                <div className="absolute left-0 top-4 z-20 flex flex-col gap-2">
                    <button
                        onClick={() => setIsInternalSidebarCollapsed(false)}
                        className="bg-white border border-slate-200 shadow-md p-2 rounded-r-xl text-slate-500 hover:text-slate-900 hover:bg-slate-50 flex items-center justify-center transition-colors"
                        title="展开功能栏"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                    </button>
                    <button
                        onClick={() => setShowPlannerContextModal(true)}
                        className="bg-white border border-slate-200 shadow-md px-2 py-2 rounded-r-xl text-slate-500 hover:text-slate-900 hover:bg-slate-50 flex items-center justify-center transition-colors relative"
                        title="上下文配置"
                    >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 20h9" /><path strokeLinecap="round" strokeLinejoin="round" d="M12 4h9" /><path strokeLinecap="round" strokeLinejoin="round" d="M4 9h16" /><path strokeLinecap="round" strokeLinejoin="round" d="M4 15h16" /></svg>
                        {plannerContextText && <span className="absolute -right-1 -top-1 w-2 h-2 rounded-full bg-emerald-500" />}
                    </button>
                </div>
            )}

            <div className="flex-1 flex flex-col bg-white min-w-0 relative">
                {/* Tab Switcher (Visible when collapsed) */}
                {isInternalSidebarCollapsed && (
                    <div className="px-4 py-2 border-b border-gray-100 bg-white shadow-sm shrink-0 animate-fade-in-down z-10">
                        <div className="inline-flex p-1 rounded-full border border-slate-200 bg-slate-50 gap-1">
                            <button 
                                onClick={() => setActiveView('text')}
                                className={`px-4 py-1.5 text-xs font-bold rounded-full transition-all flex items-center gap-1.5 ${activeView === 'text' ? 'bg-white text-indigo-700 shadow-sm ring-1 ring-indigo-200' : 'text-gray-500 hover:bg-white'}`}
                            >
                                <span>📄</span> 方案正文
                            </button>
                            <button 
                                onClick={() => setActiveView('visuals')}
                                className={`px-4 py-1.5 text-xs font-bold rounded-full transition-all flex items-center gap-1.5 ${activeView === 'visuals' ? 'bg-white text-purple-700 shadow-sm ring-1 ring-purple-200' : 'text-gray-500 hover:bg-white'}`}
                            >
                                <span>🎨</span> 视觉物料工作台
                            </button>
                        </div>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto p-6 md:p-8 custom-scrollbar">
                    {currentTab.isLoading ? (
                        <div className="flex flex-col items-center justify-center h-full text-indigo-600">
                            <div className="w-16 h-16 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mb-4"></div>
                            <p className="font-bold animate-pulse">正在进行深度溯源与策略解析...</p>
                        </div>
                    ) : currentTab.plan ? (
                        <div className={`${isInternalSidebarCollapsed && activeView === 'visuals' ? 'max-w-[1400px]' : 'max-w-3xl'} mx-auto pb-20`}>
                            {/* Manual Edit Toolbar (Floating & Draggable - Vertical Only) */}
                            {!isLocked && (!isInternalSidebarCollapsed || activeView === 'text') && (
                                <div 
                                    className="absolute z-20 cursor-ns-resize transition-shadow hover:shadow-xl rounded-full"
                                    style={{ top: editBtnPos.top, right: editBtnPos.right }}
                                    onMouseDown={handleBtnMouseDown}
                                >
                                    <button 
                                        onClick={(e) => {
                                            // Prevent toggle if we just dragged
                                            if (Math.abs(editBtnPos.top - btnStartPos.current.top) > 5) return;
                                            setIsEditingPlan(!isEditingPlan);
                                        }}
                                        className={`px-3 py-1.5 text-xs font-bold rounded-full shadow-lg border transition-all flex items-center gap-1 ${isEditingPlan ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white/80 backdrop-blur text-slate-500 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'}`}
                                    >
                                        {isEditingPlan ? <span>💾 完成</span> : <span>✏️ 编辑</span>}
                                    </button>
                                </div>
                            )}

                            {(!isInternalSidebarCollapsed || activeView === 'text') && (
                                <>
                                    {isEditingPlan ? (
                                        <textarea 
                                            value={currentTab.plan.markdown} 
                                            onChange={e => {
                                                const newMd = e.target.value;
                                                setTabStates(prev => ({
                                                    ...prev,
                                                    [templateType]: {
                                                        ...prev[templateType],
                                                        plan: { ...prev[templateType].plan!, markdown: newMd }
                                                    }
                                                }));
                                            }}
                                            className="w-full h-[70vh] p-6 border border-slate-200 rounded-xl font-mono text-sm focus:ring-2 focus:ring-indigo-100 outline-none resize-none bg-slate-50 shadow-inner mt-4"
                                        />
                                    ) : (
                                        <div className="prose prose-sm md:prose-base max-w-none text-gray-800 mt-4 px-4">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentTab.plan.markdown}</ReactMarkdown>
                                        </div>
                                    )}
                                </>
                            )}
                            
                            {/* Visual Materials Manager (Available for all types) */}
                            {(!isInternalSidebarCollapsed || activeView === 'visuals') && (
                                <div className={!isInternalSidebarCollapsed ? "mt-12 pt-8 border-t border-slate-100" : "mt-4"}>
                                    <VisualMaterialsManager 
                                        planMarkdown={currentTab.plan.markdown}
                                        planTitle={event.title}
                                        posters={currentTab.visualPosters}
                                        onUpdatePosters={handleUpdatePosters}
                                        warehousePath={warehousePath || ''}
                                        compact={isInternalSidebarCollapsed && activeView === 'visuals'}
                                    />
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="flex flex-col items-center justify-center h-full text-gray-300">
                            <span className="text-6xl mb-4 opacity-20">📋</span>
                            <p className="font-bold">请点击左侧“生成方案/任务解析”</p>
                        </div>
                    )}
                </div>
                {/* Chat moved to Left Sidebar */}
            </div>
        </div>
      </div>
    </div>
  );
};

export default PlanModal;
