import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PosterSlot, Project, VisualEngineConfig, VisualProvider } from '../types';
import VisualMaterialsManager from './VisualMaterialsManager';
import { analyzePlanForPosters, analyzeReferenceImageForSceneAndSubjects, generateStructuredPromptFromRequirement, generateVisualContent, constructPosterPrompt } from '../services/visualDesignService';
import { savePromptToLibrary } from '../services/promptLibraryService';
import { Stage, Layer, Rect, Circle, Image as KonvaImage, Transformer } from 'react-konva';
import Konva from 'konva';

type DesignMode = 'controlled' | 'auto';
type DesignContentType = 'image' | 'gif' | 'video';
type ControlledImageSourceMode = 'project_plan' | 'direct';

interface DesignTaskItem {
  projectId: string;
  projectTitle: string;
  task: any;
  agent?: any;
}

interface DesignModelConfig {
  id: string;
  name: string;
  type: 'image' | 'video' | 'gif' | 'workflow';
  endpoint: string;
  apiKeyMasked: string;
  enabled: boolean;
  isDefault?: boolean;
}

interface DesignChatMessage {
  id: string;
  role: 'assistant' | 'user';
  content: string;
  createdAt: number;
}

interface SubjectCard {
  id: string;
  name: string;
  sizeScore: number;
  centerScore: number;
  rankScore: number;
  x: number;
  y: number;
  scale: number;
}

interface SceneAnalysis {
  exists: boolean;
  reality: 'real' | 'virtual' | 'mixed' | 'unknown';
  sceneType?: string;
  overview?: string;
  perspective?: string;
  atmosphere?: string;
  brightness?: string;
  sharpness?: string;
  focusArea?: string;
  visualCenter?: string;
  gazeOrder?: string;
}

interface SceneTuningConfig {
  rotationX: number;
  rotationY: number;
  zoom: number;
  panX: number;
  panY: number;
  lightIntensity: number;
  depthBlur: number;
  focusStrength: number;
  temperature: number;
}

interface SceneDataTable {
  subjects: SubjectCard[];
  scene: SceneAnalysis | null;
  tuning: SceneTuningConfig;
  updatedAt: number;
}

type EditorLayerType = 'image' | 'rect' | 'circle';

interface EditorLayer {
  id: string;
  type: EditorLayerType;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  hidden: boolean;
  locked: boolean;
  src?: string;
  description?: string;
  zIndex: number;
}

interface DesignWorkshopProps {
  tasks: DesignTaskItem[];
  projects: Project[];
  activeTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  warehousePath?: string;
}

const MODEL_REGISTRY_KEY = 'design_model_registry_v1';
const MODEL_REGISTRY_SECURE_KEY = 'design_model_registry_v1_secure';

const defaultModelConfigs: DesignModelConfig[] = [
  {
    id: 'seeddance2.0',
    name: 'SeedDance 2.0',
    type: 'video',
    endpoint: '',
    apiKeyMasked: '',
    enabled: true,
    isDefault: true
  },
  {
    id: 'jimeng-image',
    name: '即梦图像',
    type: 'image',
    endpoint: '',
    apiKeyMasked: '',
    enabled: true
  }
];

const maskKey = (raw: string) => {
  const text = String(raw || '').trim();
  if (!text) return '';
  if (text.length <= 8) return `${text.slice(0, 2)}****${text.slice(-2)}`;
  return `${text.slice(0, 4)}****${text.slice(-4)}`;
};

const normalizeTaskSummary = (taskItem?: DesignTaskItem | null) => {
  if (!taskItem) return '';
  const rawTask = String(taskItem.task?.task || taskItem.task?.title || taskItem.task?.stage || '').trim();
  const agentName = String(taskItem.agent?.nickname || '').trim();
  const project = String(taskItem.projectTitle || '').trim();
  const evidence = Array.isArray(taskItem.task?.evidence)
    ? taskItem.task.evidence.map((x: any) => (x?.name ? `- ${x.name}` : '')).filter(Boolean).join('\n')
    : '';
  return [
    `项目：${project}`,
    `任务：${rawTask || '未命名任务'}`,
    agentName ? `负责人：${agentName}` : '',
    evidence ? `已有素材：\n${evidence}` : ''
  ].filter(Boolean).join('\n');
};

const buildPostersFromMilestones = (milestones: any[]): PosterSlot[] => {
  return (Array.isArray(milestones) ? milestones : []).map((m: any) => ({
    id: m.id || `poster-${Date.now()}-${Math.random()}`,
    title: m.title || '未命名海报',
    purpose: m.purpose || '',
    isGenerating: false,
    config: {
      aspectRatio: '3:4',
      style: m.recommendedStyle || 'Modern',
      customText: m.title || '',
      subTitle: '',
      purpose: m.purpose || '',
      refinements: {}
    }
  }));
};

const DesignWorkshop: React.FC<DesignWorkshopProps> = ({ tasks, projects, activeTaskId, onSelectTask, warehousePath }) => {
  const [mode, setMode] = useState<DesignMode>('controlled');
  const [contentType, setContentType] = useState<DesignContentType>('image');
  const [controlledImageSourceMode, setControlledImageSourceMode] = useState<ControlledImageSourceMode>('project_plan');
  const [planText, setPlanText] = useState('');
  const [planTitle, setPlanTitle] = useState('视觉生产方案');
  const [posters, setPosters] = useState<PosterSlot[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedPlanType, setSelectedPlanType] = useState<'official' | 'original'>('official');
  const [isProjectAnalyzing, setIsProjectAnalyzing] = useState(false);
  const [directRequirement, setDirectRequirement] = useState('');
  const [isStructuringRequirement, setIsStructuringRequirement] = useState(false);
  const [structuredPromptText, setStructuredPromptText] = useState('');
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [subjectCards, setSubjectCards] = useState<SubjectCard[]>([]);
  const [sceneAnalysis, setSceneAnalysis] = useState<SceneAnalysis | null>(null);
  const [initialSubjectCards, setInitialSubjectCards] = useState<SubjectCard[]>([]);
  const [initialSceneAnalysis, setInitialSceneAnalysis] = useState<SceneAnalysis | null>(null);
  const [sceneTuning, setSceneTuning] = useState<SceneTuningConfig>({
    rotationX: 12,
    rotationY: -18,
    zoom: 1,
    panX: 0,
    panY: 0,
    lightIntensity: 0.62,
    depthBlur: 0.38,
    focusStrength: 0.7,
    temperature: 0.5
  });
  const [isGeneratingFromInstruction, setIsGeneratingFromInstruction] = useState(false);
  const [previewViewMode, setPreviewViewMode] = useState<'edit' | 'preview'>('preview');
  const [previewGeneratedImage, setPreviewGeneratedImage] = useState<string | null>(null);
  const [activePreviewPanel, setActivePreviewPanel] = useState<'general' | 'reference'>('general');
  const [analysisPromptDraft, setAnalysisPromptDraft] = useState('');
  const [workshopViewMode, setWorkshopViewMode] = useState<'workspace' | 'library'>('workspace');
  const [settingsMode, setSettingsMode] = useState<'basic' | 'advanced'>('basic');
  const [basicSettings, setBasicSettings] = useState({
    style: '',
    colorScheme: '',
    composition: '',
    decorations: '',
    typography: '',
    background: ''
  });
  const [referenceImageData, setReferenceImageData] = useState<string>('');
  const [referenceImageNatural, setReferenceImageNatural] = useState({ width: 0, height: 0 });
  const [editUnit, setEditUnit] = useState<'px' | 'cm'>('px');
  const [editWidth, setEditWidth] = useState(0);
  const [editHeight, setEditHeight] = useState(0);
  const [editAspect, setEditAspect] = useState<'original' | '1:1' | '3:4' | '4:3' | '16:9' | '9:16'>('original');
  const [cropScale, setCropScale] = useState(1);
  const [cropX, setCropX] = useState(0.5);
  const [cropY, setCropY] = useState(0.5);
  const [editorLayers, setEditorLayers] = useState<EditorLayer[]>([]);
  const [selectedLayerId, setSelectedLayerId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; layerId: string | null; open: boolean }>({ x: 0, y: 0, layerId: null, open: false });
  const [layerDescDraft, setLayerDescDraft] = useState('');
  const [showLayerDescDialog, setShowLayerDescDialog] = useState(false);
  const [fusionPromptPreview, setFusionPromptPreview] = useState('');
  const [modelConfigs, setModelConfigs] = useState<DesignModelConfig[]>(defaultModelConfigs);

  const [workflowCards, setWorkflowCards] = useState([
    { id: 'upload', label: '多模态上传', enabled: true, value: '' },
    { id: 'nl2prompt', label: '自然语言转结构化 Prompt', enabled: true, value: '' },
    { id: 'loop', label: '异步循环', enabled: false, value: '2' },
    { id: 'parallel', label: '并行处理', enabled: false, value: '2' },
    { id: 'quality', label: '质量排查', enabled: true, value: '清晰度/构图/错字' },
    { id: 'hd', label: '高清增强', enabled: true, value: '' },
    { id: 'bg-remove', label: '去背景', enabled: false, value: '' },
    { id: 'ocr', label: '提取图片文字可编辑化', enabled: false, value: '' },
    { id: 'subject', label: '主体框选移动', enabled: false, value: '' },
    { id: 'alpha', label: '区域透明度调整', enabled: false, value: '' },
    { id: 'color', label: '整体调色', enabled: true, value: '柔和冷暖平衡' }
  ]);
  const [autoAttachments, setAutoAttachments] = useState<File[]>([]);
  const [autoPromptInput, setAutoPromptInput] = useState('');
  const [autoStructuredPrompt, setAutoStructuredPrompt] = useState('');
  const [autoRunResult, setAutoRunResult] = useState('');

  const [videoText, setVideoText] = useState('');
  const [videoPrompt, setVideoPrompt] = useState('');
  const [videoCoverImage, setVideoCoverImage] = useState<string>('');
  const [videoStartFrame, setVideoStartFrame] = useState<string>('');
  const [videoEndFrame, setVideoEndFrame] = useState<string>('');
  const [videoModelId, setVideoModelId] = useState('seeddance2.0');
  const [videoOutputInfo, setVideoOutputInfo] = useState('');

  const [gifSourceVideoHint, setGifSourceVideoHint] = useState('');
  const [gifLoop, setGifLoop] = useState('0');
  const [gifFps, setGifFps] = useState('12');
  const [gifResult, setGifResult] = useState('');

  const [newModel, setNewModel] = useState({
    id: '',
    name: '',
    type: 'video' as DesignModelConfig['type'],
    endpoint: '',
    apiKey: ''
  });
  const [showConfigMenu, setShowConfigMenu] = useState(false);
  const [chatCollapsed, setChatCollapsed] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [chatMessages, setChatMessages] = useState<DesignChatMessage[]>([
    {
      id: 'seed-assistant',
      role: 'assistant',
      content: '我是你的高级视觉设计师。你可以告诉我风格、情绪、构图、局部修改诉求，我会联动图片/视频/动图参数并给出高质量执行建议。',
      createdAt: Date.now()
    }
  ]);
  const configMenuRef = useRef<HTMLDivElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const editorDropRef = useRef<HTMLDivElement | null>(null);
  const transformerRef = useRef<Konva.Transformer | null>(null);
  const layerNodeRef = useRef<Record<string, Konva.Node | null>>({});
  const [stageSize, setStageSize] = useState({ width: 900, height: 620 });
  const [stageScale, setStageScale] = useState(1);
  const [stagePosition, setStagePosition] = useState({ x: 0, y: 0 });
  const [imageAssetMap, setImageAssetMap] = useState<Record<string, HTMLImageElement>>({});

  const activeTask = useMemo(
    () => tasks.find((item) => String(item?.task?.id || '') === String(activeTaskId || '')) || null,
    [tasks, activeTaskId]
  );

  const imageTaskStorageKey = useMemo(() => `design_workshop_posters_${activeTaskId || 'manual'}`, [activeTaskId]);
  const sceneDataStorageKey = useMemo(() => `design_workshop_scene_table_${activeTaskId || 'manual'}`, [activeTaskId]);

  const saveModelRegistry = useCallback(async (next: DesignModelConfig[]) => {
    setModelConfigs(next);
    const payload = JSON.stringify(next);
    localStorage.setItem(MODEL_REGISTRY_KEY, payload);
    const secure = (window as any).electronAPI?.secure;
    if (secure?.set) {
      await secure.set(MODEL_REGISTRY_SECURE_KEY, payload);
    }
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const secure = (window as any).electronAPI?.secure;
        const secureRaw = secure?.get ? await secure.get(MODEL_REGISTRY_SECURE_KEY) : '';
        const localRaw = localStorage.getItem(MODEL_REGISTRY_KEY) || '';
        const raw = String(secureRaw || localRaw || '').trim();
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (alive && Array.isArray(parsed) && parsed.length > 0) {
          setModelConfigs(parsed);
        }
      } catch {
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!activeTask) return;
    const normalizedTitle = String(activeTask.projectTitle || '').trim();
    const normalizedText = normalizeTaskSummary(activeTask);
    setPlanTitle(normalizedTitle ? `${normalizedTitle} · 视觉方案` : '视觉生产方案');
    setPlanText((prev) => (prev.trim() ? prev : normalizedText));
  }, [activeTask]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(imageTaskStorageKey);
      if (!raw) {
        setPosters([]);
        return;
      }
      const parsed = JSON.parse(raw);
      setPosters(Array.isArray(parsed) ? parsed : []);
    } catch {
      setPosters([]);
    }
  }, [imageTaskStorageKey]);

  const handleUpdatePosters = useCallback((next: PosterSlot[]) => {
    setPosters(next);
    localStorage.setItem(imageTaskStorageKey, JSON.stringify(next || []));
  }, [imageTaskStorageKey]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(sceneDataStorageKey);
      if (!raw) return;
      const parsed: SceneDataTable = JSON.parse(raw);
      if (Array.isArray(parsed?.subjects)) setSubjectCards(parsed.subjects);
      if (parsed?.scene) setSceneAnalysis(parsed.scene);
      if (parsed?.tuning) setSceneTuning(parsed.tuning);
    } catch {
    }
  }, [sceneDataStorageKey]);

  useEffect(() => {
    const payload: SceneDataTable = {
      subjects: subjectCards,
      scene: sceneAnalysis,
      tuning: sceneTuning,
      updatedAt: Date.now()
    };
    localStorage.setItem(sceneDataStorageKey, JSON.stringify(payload));
  }, [subjectCards, sceneAnalysis, sceneTuning, sceneDataStorageKey]);

  const loadVisualConfigs = useCallback(async (): Promise<Record<VisualProvider, VisualEngineConfig>> => {
    const secure = (window as any).electronAPI?.secure;
    const configs: Record<string, VisualEngineConfig> = {};
    for (const provider of ['Jimeng', 'Doubao', 'Nanobanana', 'Gemini'] as VisualProvider[]) {
      let apiKey = localStorage.getItem(`visual_api_key_${provider}`) || '';
      let ak = localStorage.getItem(`visual_api_ak_${provider}`) || '';
      let sk = localStorage.getItem(`visual_api_sk_${provider}`) || '';
      if (secure) {
        const k = await secure.get(`visual_api_key_${provider}`);
        if (k) apiKey = k;
        const kAk = await secure.get(`visual_api_ak_${provider}`);
        if (kAk) ak = kAk;
        const kSk = await secure.get(`visual_api_sk_${provider}`);
        if (kSk) sk = kSk;
      }
      const status = localStorage.getItem(`visual_api_status_${provider}`);
      configs[provider] = {
        provider,
        apiKey,
        accessKeyId: ak,
        secretAccessKey: sk,
        isEnabled: status ? status === 'active' : provider === 'Gemini'
      };
    }
    return configs as Record<VisualProvider, VisualEngineConfig>;
  }, []);

  const pipelineEnabledCount = useMemo(() => workflowCards.filter((x) => x.enabled).length, [workflowCards]);
  const videoModels = useMemo(
    () => modelConfigs.filter((m) => m.type === 'video' && m.enabled),
    [modelConfigs]
  );

  useEffect(() => {
    if (!showConfigMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!configMenuRef.current) return;
      if (!configMenuRef.current.contains(event.target as Node)) {
        setShowConfigMenu(false);
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [showConfigMenu]);

  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const renderPill = <T extends string>(value: T, onChange: (next: T) => void, options: Array<{ id: T; label: string }>) => (
    <div className="inline-flex p-1 rounded-full border border-slate-200 bg-white gap-1">
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          className={`px-4 py-1.5 rounded-full text-xs font-bold transition-all ${value === option.id ? 'bg-slate-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-700 hover:bg-slate-100'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );

  const onAddModel = async () => {
    const id = String(newModel.id || '').trim();
    const name = String(newModel.name || '').trim();
    if (!id || !name) return;
    const next = [
      ...modelConfigs.filter((item) => String(item.id) !== id),
      {
        id,
        name,
        type: newModel.type,
        endpoint: String(newModel.endpoint || '').trim(),
        apiKeyMasked: maskKey(newModel.apiKey),
        enabled: true
      }
    ];
    await saveModelRegistry(next);
    if (newModel.apiKey) {
      const secure = (window as any).electronAPI?.secure;
      if (secure?.set) {
        await secure.set(`design_model_api_key_${id}`, String(newModel.apiKey || '').trim());
      } else {
        localStorage.setItem(`design_model_api_key_${id}`, String(newModel.apiKey || '').trim());
      }
    }
    setNewModel({ id: '', name: '', type: 'video', endpoint: '', apiKey: '' });
  };

  const applyIntentToGeneration = (text: string) => {
    const normalized = String(text || '').toLowerCase();
    if (!normalized) return;

    if (normalized.includes('自动模式')) setMode('auto');
    if (normalized.includes('可控模式')) setMode('controlled');
    if (normalized.includes('视频')) setContentType('video');
    if (normalized.includes('动图') || normalized.includes('gif')) setContentType('gif');
    if (normalized.includes('图片') || normalized.includes('海报')) setContentType('image');

    if (contentType === 'video') {
      setVideoText((prev) => [prev, text].filter(Boolean).join('\n').slice(-1200));
    } else if (contentType === 'gif') {
      setGifSourceVideoHint((prev) => [prev, text].filter(Boolean).join('\n').slice(-1000));
    } else {
      setPlanText((prev) => [prev, text].filter(Boolean).join('\n').slice(-2000));
      if (posters.length > 0) {
        const firstPosterId = posters[0].id;
        handleUpdatePosters(
          posters.map((item) =>
            item.id === firstPosterId
              ? {
                  ...item,
                  config: {
                    ...item.config,
                    referenceImagePrompt: [item.config.referenceImagePrompt || item.config.style || '', text].filter(Boolean).join('；')
                  }
                }
              : item
          )
        );
      }
    }
  };

  const buildAssistantReply = (text: string) => {
    const topics: string[] = [];
    const normalized = String(text || '').toLowerCase();
    if (normalized.includes('视频')) topics.push('已切换视频导向，建议补充镜头运动和情绪节奏。');
    if (normalized.includes('动图') || normalized.includes('gif')) topics.push('已聚焦动图链路，可先生成视频再转 GIF。');
    if (normalized.includes('图片') || normalized.includes('海报')) topics.push('已聚焦图片链路，可继续描述光影、构图、主体和文字层级。');
    if (normalized.includes('局部') || normalized.includes('修改')) topics.push('我已记录局部修改意图，建议同时描述目标区域与预期变化幅度。');
    if (normalized.includes('高清') || normalized.includes('清晰')) topics.push('已加入清晰度优先建议，可在自动模式启用质量排查与高清增强。');
    if (topics.length === 0) {
      topics.push('我已吸收你的设计意图，下一步建议明确目标受众、情绪调性和主视觉层级。');
    }
    return `收到，我将以高级视觉设计师标准执行。\n${topics.map((item) => `- ${item}`).join('\n')}`;
  };

  const onSendChat = () => {
    const content = String(chatInput || '').trim();
    if (!content) return;
    const userMessage: DesignChatMessage = {
      id: `user-${Date.now()}`,
      role: 'user',
      content,
      createdAt: Date.now()
    };
    applyIntentToGeneration(content);
    const assistantMessage: DesignChatMessage = {
      id: `assistant-${Date.now() + 1}`,
      role: 'assistant',
      content: buildAssistantReply(content),
      createdAt: Date.now() + 1
    };
    setChatMessages((prev) => [...prev, userMessage, assistantMessage]);
    setChatInput('');
  };

  const projectOptions = useMemo(() => {
    return projects
      .filter((project) => project.status !== 'Archived')
      .map((project) => ({
        id: project.id,
        title: project.title,
        official: String(project.officialPlanContent || '').trim(),
        original: String(project.originalPlan?.markdown || '').trim()
      }))
      .filter((project) => project.official || project.original);
  }, [projects]);

  const selectedProjectOption = useMemo(
    () => projectOptions.find((item) => String(item.id) === String(selectedProjectId)),
    [projectOptions, selectedProjectId]
  );

  const selectedPlanMarkdown = useMemo(() => {
    if (!selectedProjectOption) return '';
    return selectedPlanType === 'official' ? selectedProjectOption.official : selectedProjectOption.original;
  }, [selectedProjectOption, selectedPlanType]);

  const handleAnalyzeSelectedPlan = async () => {
    if (!selectedProjectOption || !selectedPlanMarkdown) return;
    setIsProjectAnalyzing(true);
    try {
      const milestones = await analyzePlanForPosters(selectedPlanMarkdown);
      const nextPosters = buildPostersFromMilestones(milestones);
      setPlanTitle(`${selectedProjectOption.title} · 视觉方案`);
      setPlanText(selectedPlanMarkdown);
      handleUpdatePosters(nextPosters);
      setControlledImageSourceMode('project_plan');
      setContentType('image');
      setMode('controlled');
    } finally {
      setIsProjectAnalyzing(false);
    }
  };

  const handleStructureDirectRequirement = async () => {
    const text = String(directRequirement || '').trim();
    if (!text) return;
    setIsStructuringRequirement(true);
    try {
      const structured = await generateStructuredPromptFromRequirement(text);
      setStructuredPromptText(structured);
      setPlanText(structured);
      setPlanTitle('自由生图任务');
      const manualPoster: PosterSlot = {
        id: `poster-direct-${Date.now()}`,
        title: '自由生图任务',
        purpose: text,
        isGenerating: false,
        config: {
          aspectRatio: '3:4',
          style: 'Custom',
          customText: '',
          subTitle: '',
          purpose: text,
          refinements: {
            custom: structured
          },
          referenceImagePrompt: structured
        }
      };
      handleUpdatePosters([manualPoster]);
    } finally {
      setIsStructuringRequirement(false);
    }
  };

  const pxToCm = (px: number) => Number((px / 37.7952755906).toFixed(2));
  const cmToPx = (cm: number) => Math.max(1, Math.round(cm * 37.7952755906));

  const updateNaturalSizeFromData = (base64: string) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.max(1, Number(img.naturalWidth || 0));
      const h = Math.max(1, Number(img.naturalHeight || 0));
      setReferenceImageNatural({ width: w, height: h });
      setEditWidth(w);
      setEditHeight(h);
      setEditAspect('original');
      syncEditorReference(base64, w, h);
    };
    img.src = base64;
  };

  const makeBaseImageLayer = (base64: string, w: number, h: number): EditorLayer => ({
    id: `layer-image-${Date.now()}`,
    type: 'image',
    name: '参考图',
    x: 120,
    y: 80,
    width: Math.max(220, Math.min(820, w || 360)),
    height: Math.max(160, Math.min(620, h || 240)),
    rotation: 0,
    opacity: 1,
    hidden: false,
    locked: false,
    src: base64,
    description: '',
    zIndex: 1
  });

  const syncEditorReference = (base64: string, w: number, h: number) => {
    const layer = makeBaseImageLayer(base64, w, h);
    setEditorLayers([layer]);
    setSelectedLayerId(layer.id);
  };

  const addShapeLayer = (type: 'rect' | 'circle') => {
    const next: EditorLayer = {
      id: `layer-${type}-${Date.now()}`,
      type,
      name: type === 'rect' ? '方形图层' : '圆形图层',
      x: 200,
      y: 180,
      width: type === 'rect' ? 200 : 180,
      height: type === 'rect' ? 120 : 180,
      rotation: 0,
      opacity: 1,
      hidden: false,
      locked: false,
      description: '',
      zIndex: editorLayers.length + 1
    };
    setEditorLayers((prev) => [...prev, next]);
    setSelectedLayerId(next.id);
  };

  const addImageLayerByBase64 = (base64: string, name = '插图图层') => {
    const img = new Image();
    img.onload = () => {
      const next: EditorLayer = {
        id: `layer-image-${Date.now()}`,
        type: 'image',
        name,
        x: 220,
        y: 160,
        width: Math.max(120, Math.min(520, img.naturalWidth || 240)),
        height: Math.max(90, Math.min(420, img.naturalHeight || 180)),
        rotation: 0,
        opacity: 1,
        hidden: false,
        locked: false,
        description: '',
        src: base64,
        zIndex: editorLayers.length + 1
      };
      setEditorLayers((prev) => [...prev, next]);
      setSelectedLayerId(next.id);
    };
    img.src = base64;
  };

  const removeBackgroundLocal = async (base64: string) => {
    const img = new Image();
    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = base64;
    });
    if (!loaded) return base64;
    const canvas = document.createElement('canvas');
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return base64;
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = imageData.data;
    const pick = (x: number, y: number) => {
      const i = (y * canvas.width + x) * 4;
      return [d[i], d[i + 1], d[i + 2]];
    };
    const c1 = pick(0, 0);
    const c2 = pick(canvas.width - 1, 0);
    const c3 = pick(0, canvas.height - 1);
    const c4 = pick(canvas.width - 1, canvas.height - 1);
    const bg = [
      Math.round((c1[0] + c2[0] + c3[0] + c4[0]) / 4),
      Math.round((c1[1] + c2[1] + c3[1] + c4[1]) / 4),
      Math.round((c1[2] + c2[2] + c3[2] + c4[2]) / 4)
    ];
    for (let i = 0; i < d.length; i += 4) {
      const dist = Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]);
      if (dist < 64) d[i + 3] = 0;
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  };

  const applyAnalysisResult = (result: any) => {
    const subjectsRaw = Array.isArray(result?.subjects) ? result.subjects.slice(0, 5) : [];
    const subjects: SubjectCard[] = subjectsRaw.map((item: any, index: number) => ({
      id: String(item.id || `subject-${index + 1}`),
      name: String(item.name || `主体${index + 1}`),
      sizeScore: Number(item.sizeScore || 0.2),
      centerScore: Number(item.centerScore || 0.2),
      rankScore: Number(item.rankScore || 0.2),
      x: Number(item.x || 0.3 + index * 0.1),
      y: Number(item.y || 0.3 + index * 0.1),
      scale: Number(item.scale || 0.2)
    }));
    setSubjectCards(subjects);
    setInitialSubjectCards(subjects);
    const nextScene: SceneAnalysis = {
      exists: !!result?.scene?.exists,
      reality: result?.scene?.reality || 'unknown',
      sceneType: result?.scene?.sceneType || '',
      overview: result?.scene?.overview || '',
      perspective: result?.scene?.perspective || '',
      atmosphere: result?.scene?.atmosphere || '',
      brightness: result?.scene?.brightness || '',
      sharpness: result?.scene?.sharpness || '',
      focusArea: result?.scene?.focusArea || '',
      visualCenter: result?.scene?.visualCenter || '',
      gazeOrder: result?.scene?.gazeOrder || ''
    };
    setSceneAnalysis(nextScene);
    setInitialSceneAnalysis(nextScene);
    setSceneTuning({
      rotationX: nextScene.perspective?.includes('俯视') ? 28 : nextScene.perspective?.includes('仰视') ? -16 : 12,
      rotationY: -18,
      zoom: 1,
      panX: 0,
      panY: 0,
      lightIntensity: nextScene.brightness?.includes('高') ? 0.78 : 0.56,
      depthBlur: nextScene.sharpness?.includes('虚') ? 0.68 : 0.35,
      focusStrength: 0.72,
      temperature: nextScene.atmosphere?.includes('暖') ? 0.78 : 0.38
    });
    setBasicSettings({
      style: String(result?.style?.visualStyle || ''),
      colorScheme: String(result?.style?.colorScheme || ''),
      composition: String(result?.style?.composition || ''),
      decorations: String(result?.style?.decorations || ''),
      typography: String(result?.style?.typography || ''),
      background: String(result?.scene?.overview || '')
    });
    const generatedPrompt = String(result?.reproduciblePrompt || '').trim();
    if (generatedPrompt) setAnalysisPromptDraft(generatedPrompt);
  };

  const analyzeReferenceByBase64 = async (base64: string) => {
    if (!base64) return;
    setReferenceImageData(base64);
    updateNaturalSizeFromData(base64);
    setActivePreviewPanel('reference');
    setPreviewViewMode('preview');
    setAnalysisLoading(true);
    try {
      const result: any = await analyzeReferenceImageForSceneAndSubjects(base64);
      applyAnalysisResult(result);
    } finally {
      setAnalysisLoading(false);
    }
  };

  const handleReferenceImageAnalysis = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = String(event.target?.result || '');
      if (!base64) return;
      await analyzeReferenceByBase64(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleGenerateInstructionFromScene = () => {
    const zoneOrder = subjectCards
      .map((item) => {
        const col = Math.max(1, Math.min(3, Math.ceil(item.x * 3)));
        const row = Math.max(1, Math.min(3, Math.ceil(item.y * 3)));
        return {
          id: item.id,
          rank: item.rankScore,
          zone: `横${col}竖${row}`
        };
      })
      .sort((a, b) => b.rank - a.rank)
      .map((item) => item.zone)
      .join(' -> ');
    const subjectText = subjectCards
      .map((item, index) => `${index + 1}. ${item.name}（size:${item.sizeScore.toFixed(2)} center:${item.centerScore.toFixed(2)} rank:${item.rankScore.toFixed(2)} pos:${item.x.toFixed(2)},${item.y.toFixed(2)} scale:${item.scale.toFixed(2)}）`)
      .join('\n');
    const sceneText = sceneAnalysis
      ? [
          `scene_exists=${sceneAnalysis.exists}`,
          `scene_reality=${sceneAnalysis.reality}`,
          `scene_type=${sceneAnalysis.sceneType || ''}`,
          `perspective=${sceneAnalysis.perspective || ''}`,
          `atmosphere=${sceneAnalysis.atmosphere || ''}`,
          `brightness=${sceneAnalysis.brightness || ''}`,
          `sharpness=${sceneAnalysis.sharpness || ''}`,
          `focus=${sceneAnalysis.focusArea || ''}`,
          `center=${sceneAnalysis.visualCenter || ''}`,
          `gaze_order=${sceneAnalysis.gazeOrder || zoneOrder}`,
          `camera_rotation_x=${sceneTuning.rotationX.toFixed(2)}`,
          `camera_rotation_y=${sceneTuning.rotationY.toFixed(2)}`,
          `camera_zoom=${sceneTuning.zoom.toFixed(2)}`,
          `camera_pan_x=${sceneTuning.panX.toFixed(2)}`,
          `camera_pan_y=${sceneTuning.panY.toFixed(2)}`,
          `light_intensity=${sceneTuning.lightIntensity.toFixed(2)}`,
          `depth_blur=${sceneTuning.depthBlur.toFixed(2)}`,
          `focus_strength=${sceneTuning.focusStrength.toFixed(2)}`,
          `color_temperature=${sceneTuning.temperature.toFixed(2)}`
        ].join('\n')
      : '';
    const prompt = [analysisPromptDraft, subjectText, sceneText].filter(Boolean).join('\n');
    setAnalysisPromptDraft(prompt);
    if (posters.length > 0) {
      handleUpdatePosters(
        posters.map((item, index) => index === 0 ? { ...item, config: { ...item.config, referenceImagePrompt: prompt } } : item)
      );
    }
  };

  const handleGenerateNowFromInstruction = async () => {
    if (posters.length === 0) return;
    const fallbackPrompt = constructPosterPrompt(posters[0].config, posters[0].purpose || planTitle);
    const describedLayers = editorLayers.filter((layer) => String(layer.description || '').trim());
    const layerBrief = describedLayers
      .map((layer, index) => `${index + 1}. ${layer.type}:${layer.name} - ${String(layer.description || '').trim()}`)
      .join('\n');
    const hasAnyInput = !!String(directRequirement || '').trim()
      || !!String(analysisPromptDraft || '').trim()
      || Object.values(basicSettings).some((v) => String(v || '').trim().length > 0)
      || subjectCards.length > 0
      || !!referenceImageData
      || describedLayers.length > 0;
    if (!hasAnyInput) {
      alert('请先输入视觉需求或上传参考图');
      return;
    }
    const manualReferencePrompt = [
      basicSettings.style && `style=${basicSettings.style}`,
      basicSettings.colorScheme && `color_scheme=${basicSettings.colorScheme}`,
      basicSettings.composition && `composition=${basicSettings.composition}`,
      basicSettings.decorations && `decorations=${basicSettings.decorations}`,
      basicSettings.typography && `typography=${basicSettings.typography}`,
      basicSettings.background && `background=${basicSettings.background}`,
      analysisPromptDraft && `scene_prompt=${analysisPromptDraft}`,
      directRequirement && `requirement=${directRequirement}`,
      layerBrief && `layer_blend_requirements=\n${layerBrief}`
    ].filter(Boolean).join('\n');
    let fusionPrompt = '';
    if (layerBrief) {
      const fusionRequirement = [
        `视觉需求：${directRequirement || '未填写'}`,
        `参考解析：${analysisPromptDraft || '未填写'}`,
        `图层融合需求：`,
        layerBrief,
        `请输出可直接用于生图模型的高质量提示词`
      ].join('\n');
      fusionPrompt = await generateStructuredPromptFromRequirement(fusionRequirement);
      setFusionPromptPreview(fusionPrompt);
    }
    const prompt = String(fusionPrompt || analysisPromptDraft || '').trim() || manualReferencePrompt || fallbackPrompt;
    if (!String(prompt || '').trim()) {
      alert('请先输入视觉需求或上传参考图');
      return;
    }
    setIsGeneratingFromInstruction(true);
    try {
      const configs = await loadVisualConfigs();
      const aspectRatio = posters[0]?.config?.aspectRatio || '3:4';
      const image = await generateVisualContent(prompt, aspectRatio, configs);
      setPreviewGeneratedImage(image);
      setPreviewViewMode('preview');
      handleUpdatePosters(
        posters.map((item, index) =>
          index === 0
            ? {
                ...item,
                generatedImage: image,
                finalPrompt: prompt,
                config: {
                  ...item.config,
                  referenceImagePrompt: prompt
                }
              }
            : item
        )
      );
    } catch {
    } finally {
      setIsGeneratingFromInstruction(false);
    }
  };

  const handleSaveToWarehouse = async () => {
    if (!posters[0]) return;
    const content = String(analysisPromptDraft || posters[0]?.finalPrompt || posters[0]?.config?.referenceImagePrompt || posters[0]?.config?.style || '').trim();
    if (!content) return;
    await savePromptToLibrary(content, 'Generated', warehousePath || '', posters[0]?.generatedImage);
  };

  const buildEditedReferenceImage = async () => {
    if (!referenceImageData) return '';
    const img = new Image();
    const loaded = await new Promise<boolean>((resolve) => {
      img.onload = () => resolve(true);
      img.onerror = () => resolve(false);
      img.src = referenceImageData;
    });
    if (!loaded) return '';
    const widthPx = Math.max(1, editUnit === 'px' ? Math.round(editWidth) : cmToPx(editWidth));
    const heightPx = Math.max(1, editUnit === 'px' ? Math.round(editHeight) : cmToPx(editHeight));
    const srcW = Math.max(1, img.naturalWidth / Math.max(0.1, cropScale));
    const srcH = Math.max(1, img.naturalHeight / Math.max(0.1, cropScale));
    const srcX = Math.max(0, Math.min(img.naturalWidth - srcW, (img.naturalWidth - srcW) * cropX));
    const srcY = Math.max(0, Math.min(img.naturalHeight - srcH, (img.naturalHeight - srcH) * cropY));
    const canvas = document.createElement('canvas');
    canvas.width = widthPx;
    canvas.height = heightPx;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, srcX, srcY, srcW, srcH, 0, 0, widthPx, heightPx);
    return canvas.toDataURL('image/png');
  };

  const handleSaveEditedReferenceToDisk = async () => {
    const edited = await buildEditedReferenceImage();
    if (!edited) return;
    const folder = await (window as any).electronAPI?.fs?.selectFolder?.();
    if (!folder) return;
    const filePath = `${String(folder).replace(/\/$/, '')}/reference-edited-${Date.now()}.png`;
    const base64Body = edited.split(',')[1] || '';
    await (window as any).electronAPI?.fs?.writeFile?.(filePath, base64Body, { encoding: 'base64' });
    alert('已保存到本地');
  };

  const handleReplaceReferenceImage = async () => {
    const edited = await buildEditedReferenceImage();
    if (!edited) return;
    await analyzeReferenceByBase64(edited);
  };

  const updateLayer = (layerId: string, patch: Partial<EditorLayer>) => {
    setEditorLayers((prev) => prev.map((layer) => layer.id === layerId ? { ...layer, ...patch } : layer));
  };

  const reorderLayer = (layerId: string, direction: 'up' | 'down') => {
    setEditorLayers((prev) => {
      const sorted = [...prev].sort((a, b) => a.zIndex - b.zIndex);
      const idx = sorted.findIndex((x) => x.id === layerId);
      if (idx < 0) return prev;
      const targetIdx = direction === 'up' ? Math.min(sorted.length - 1, idx + 1) : Math.max(0, idx - 1);
      if (targetIdx === idx) return prev;
      const swap = sorted[targetIdx];
      const current = sorted[idx];
      const temp = current.zIndex;
      current.zIndex = swap.zIndex;
      swap.zIndex = temp;
      return [...sorted];
    });
  };

  const deleteLayer = (layerId: string) => {
    setEditorLayers((prev) => prev.filter((x) => x.id !== layerId));
    if (selectedLayerId === layerId) setSelectedLayerId(null);
  };

  const handleInsertLayerImage = async () => {
    const files = await (window as any).electronAPI?.fs?.openFile?.({ title: '选择图片', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }], properties: ['openFile'] });
    if (!files || !Array.isArray(files) || files.length === 0) return;
    const file = files[0];
    const content = await (window as any).electronAPI?.fs?.readFile?.(file, 'base64');
    if (!content?.success || !content?.data) return;
    const ext = String(file).split('.').pop()?.toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    addImageLayerByBase64(`data:${mime};base64,${content.data}`, '插入图像');
  };

  const handleRemoveBgForSelectedLayer = async () => {
    const layer = editorLayers.find((x) => x.id === selectedLayerId);
    if (!layer || layer.type !== 'image' || !layer.src) return;
    const cleaned = await removeBackgroundLocal(layer.src);
    updateLayer(layer.id, { src: cleaned });
  };

  const handleDetectSubjectForSelectedLayer = () => {
    const layer = editorLayers.find((x) => x.id === selectedLayerId);
    if (!layer) return;
    const mark: EditorLayer = {
      id: `layer-rect-${Date.now()}`,
      type: 'rect',
      name: '主体标注',
      x: layer.x + layer.width * 0.2,
      y: layer.y + layer.height * 0.2,
      width: layer.width * 0.6,
      height: layer.height * 0.6,
      rotation: 0,
      opacity: 0.8,
      hidden: false,
      locked: false,
      description: 'AI识别主体区域',
      zIndex: editorLayers.length + 1
    };
    setEditorLayers((prev) => [...prev, mark]);
    setSelectedLayerId(mark.id);
  };

  const openLayerDescriptionDialog = (layerId: string) => {
    const layer = editorLayers.find((x) => x.id === layerId);
    setSelectedLayerId(layerId);
    setLayerDescDraft(String(layer?.description || ''));
    setShowLayerDescDialog(true);
    setContextMenu((prev) => ({ ...prev, open: false }));
  };

  const applyLayerDescription = () => {
    if (!selectedLayerId) return;
    updateLayer(selectedLayerId, { description: layerDescDraft });
    setShowLayerDescDialog(false);
  };

  useEffect(() => {
    const closeMenu = () => setContextMenu((prev) => ({ ...prev, open: false }));
    window.addEventListener('click', closeMenu);
    return () => window.removeEventListener('click', closeMenu);
  }, []);

  useEffect(() => {
    const container = editorDropRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry?.contentRect) return;
      setStageSize({
        width: Math.max(420, Math.floor(entry.contentRect.width)),
        height: Math.max(320, Math.floor(entry.contentRect.height))
      });
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [previewViewMode, activePreviewPanel]);

  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;
    if (!selectedLayerId || !layerNodeRef.current[selectedLayerId]) {
      transformer.nodes([]);
      transformer.getLayer()?.batchDraw();
      return;
    }
    const node = layerNodeRef.current[selectedLayerId];
    if (!node) return;
    transformer.nodes([node]);
    transformer.getLayer()?.batchDraw();
  }, [selectedLayerId, editorLayers]);

  useEffect(() => {
    const imageLayers = editorLayers.filter((layer) => layer.type === 'image' && layer.src);
    imageLayers.forEach((layer) => {
      if (!layer.src || imageAssetMap[layer.id]) return;
      const img = new window.Image();
      img.onload = () => {
        setImageAssetMap((prev) => ({ ...prev, [layer.id]: img }));
      };
      img.src = layer.src;
    });
  }, [editorLayers, imageAssetMap]);

  useEffect(() => {
    const onCommand = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {};
      const type = String(detail?.type || '');
      const payload = detail?.payload || {};
      if (type === 'chat') {
        const text = String(payload?.content || '').trim();
        if (!text) return;
        applyIntentToGeneration(text);
        setChatMessages((prev) => [...prev, { id: `side-user-${Date.now()}`, role: 'user', content: text, createdAt: Date.now() }, { id: `side-assistant-${Date.now() + 1}`, role: 'assistant', content: buildAssistantReply(text), createdAt: Date.now() + 1 }]);
      }
      if (type === 'source_mode') setControlledImageSourceMode(payload?.mode === 'direct' ? 'direct' : 'project_plan');
      if (type === 'project_select') setSelectedProjectId(String(payload?.projectId || ''));
      if (type === 'run_project') void handleAnalyzeSelectedPlan();
      if (type === 'direct_input') setDirectRequirement(String(payload?.text || ''));
      if (type === 'run_direct') void handleStructureDirectRequirement();
      if (type === 'toggle_library') setWorkshopViewMode(payload?.open ? 'library' : 'workspace');
    };
    window.addEventListener('design-workshop-command', onCommand as EventListener);
    return () => window.removeEventListener('design-workshop-command', onCommand as EventListener);
  }, [handleAnalyzeSelectedPlan, handleStructureDirectRequirement]);

  const selectedLayer = useMemo(
    () => editorLayers.find((layer) => layer.id === selectedLayerId) || null,
    [editorLayers, selectedLayerId]
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">
      <div className="px-6 py-4 border-b border-slate-200 bg-white flex items-center justify-between gap-4 relative">
        <div className="min-w-0">
          <div className="text-sm font-black text-slate-800">设计工坊</div>
          <div className="text-[11px] text-slate-400 font-medium">集中管理视觉生产任务，覆盖图片、动态图、视频</div>
        </div>
        <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2">
          <div className="inline-flex p-1 rounded-full border border-slate-200 bg-white gap-1 shadow-sm">
            {[
              { id: 'image', label: '图片' },
              { id: 'gif', label: '动态图' },
              { id: 'video', label: '视频' }
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setContentType(item.id as DesignContentType)}
                className={`px-5 py-1.5 rounded-full text-xs font-bold transition-all ${contentType === item.id ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="relative flex items-center gap-2" ref={configMenuRef}>
          {renderPill(mode, setMode, [
            { id: 'controlled', label: '可控' },
            { id: 'auto', label: '自动' }
          ])}
          <button
            onClick={() => setWorkshopViewMode((v) => v === 'workspace' ? 'library' : 'workspace')}
            className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 bg-white inline-flex items-center gap-1.5 hover:bg-slate-50"
          >
            {workshopViewMode === 'workspace' ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 4h14v16H5z" /></svg>
            ) : (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7" /></svg>
            )}
            {workshopViewMode === 'workspace' ? '仓库' : '返回'}
          </button>
          <button
            onClick={() => setShowConfigMenu((v) => !v)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 bg-white inline-flex items-center gap-1.5 hover:bg-slate-50"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M7 12h10M10 18h4" /></svg>
            配置
          </button>
          {showConfigMenu && (
            <div className="absolute right-0 top-11 z-30 w-[360px] max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-xl p-3 space-y-3">
              <div className="text-xs font-black text-slate-800">模型配置</div>
              <div className="space-y-2">
                {modelConfigs.map((model) => (
                  <div key={model.id} className="p-3 rounded-xl border border-slate-100 bg-slate-50 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="text-xs font-black text-slate-800">{model.name}</div>
                        <div className="text-[10px] text-slate-400 font-bold">{model.id}{model.isDefault ? ' · 默认' : ''}</div>
                      </div>
                      <label className="flex items-center gap-2 text-[11px] font-bold text-slate-700">
                        <input
                          type="checkbox"
                          checked={!!model.enabled}
                          onChange={async (e) => {
                            const next = modelConfigs.map((item) => item.id === model.id ? { ...item, enabled: e.target.checked } : item);
                            await saveModelRegistry(next);
                          }}
                        />
                        启用
                      </label>
                    </div>
                    <input
                      value={model.endpoint}
                      onChange={(e) => setModelConfigs((prev) => prev.map((item) => item.id === model.id ? { ...item, endpoint: e.target.value } : item))}
                      onBlur={async () => { await saveModelRegistry([...modelConfigs]); }}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 bg-white outline-none"
                      placeholder="Endpoint（可选）"
                    />
                    <div className="text-[11px] text-slate-400">API：{model.apiKeyMasked || '未配置'}</div>
                  </div>
                ))}
              </div>
              <div className="p-3 rounded-xl border border-slate-200 bg-white space-y-2">
                <div className="text-xs font-black text-slate-800">添加自定义模型</div>
                <input value={newModel.id} onChange={(e) => setNewModel((prev) => ({ ...prev, id: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs" placeholder="模型 ID" />
                <input value={newModel.name} onChange={(e) => setNewModel((prev) => ({ ...prev, name: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs" placeholder="模型名称" />
                <select value={newModel.type} onChange={(e) => setNewModel((prev) => ({ ...prev, type: e.target.value as DesignModelConfig['type'] }))} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs">
                  <option value="image">image</option>
                  <option value="video">video</option>
                  <option value="gif">gif</option>
                  <option value="workflow">workflow</option>
                </select>
                <input value={newModel.endpoint} onChange={(e) => setNewModel((prev) => ({ ...prev, endpoint: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs" placeholder="Endpoint" />
                <input value={newModel.apiKey} onChange={(e) => setNewModel((prev) => ({ ...prev, apiKey: e.target.value }))} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs" placeholder="API Key（仅本地安全存储）" />
                <button onClick={onAddModel} className="px-3 py-2 rounded-lg bg-indigo-600 text-white text-xs font-black">添加模型</button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className={`flex-1 min-h-0 p-4 ${contentType === 'image' && mode === 'controlled' && workshopViewMode !== 'library' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
          {contentType === 'image' && mode === 'controlled' && workshopViewMode === 'library' && (
              <div className="h-full">
                <VisualMaterialsManager
                  planMarkdown={planText}
                  planTitle={planTitle}
                  posters={posters}
                  onUpdatePosters={handleUpdatePosters}
                  warehousePath={warehousePath || ''}
                  compact={false}
                  hideWorkbenchHeader={true}
                  externalViewMode="library"
                  onExternalViewModeChange={setWorkshopViewMode}
                />
              </div>
          )}
          {contentType === 'image' && mode === 'controlled' && workshopViewMode !== 'library' && (
            <div className="h-full grid grid-cols-1 xl:grid-cols-[1fr_2fr] gap-3">
                <div className="h-full flex flex-col gap-2.5 min-h-0">
                  <div onClick={() => setActivePreviewPanel('general')} className="flex-1 min-h-0">
                    <VisualMaterialsManager
                      planMarkdown={planText}
                      planTitle={planTitle}
                      posters={posters}
                      onUpdatePosters={handleUpdatePosters}
                      warehousePath={warehousePath || ''}
                      compact={true}
                      hideWorkbenchHeader={true}
                      leftPanelOnly={true}
                      externalViewMode={workshopViewMode}
                      onExternalViewModeChange={setWorkshopViewMode}
                      onReferenceImageUpload={(file) => { void handleReferenceImageAnalysis(file); }}
                      createButtonLabel="立即创作"
                      saveButtonLabel="存至仓库"
                      hideRefinementSection={true}
                    />
                  </div>
                  <div onClick={() => setActivePreviewPanel('reference')} className={`bg-white border rounded-2xl p-3 cursor-pointer transition-all min-h-0 flex-1 flex flex-col ${activePreviewPanel === 'reference' ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-slate-200'}`}>
                    <div className="shrink-0 flex justify-center pb-2">
                      {renderPill(settingsMode, setSettingsMode, [
                        { id: 'basic', label: '基础' },
                        { id: 'advanced', label: '高阶' }
                      ])}
                    </div>
                    <div className="space-y-2 overflow-y-auto min-h-0 flex-1">
                      <div className="flex items-center justify-between">
                        <div className="text-xs font-black text-slate-800">参考图解析与场景编辑</div>
                        <label className="px-3 py-1 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 bg-white hover:bg-slate-50 cursor-pointer">
                          上传参考图
                          <input type="file" accept="image/*" className="hidden" onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleReferenceImageAnalysis(file);
                          }} />
                        </label>
                      </div>
                      {analysisLoading && <div className="text-[11px] font-bold text-indigo-600">解析中，请稍候...</div>}
                      {settingsMode === 'basic' ? (
                        <>
                          <div className="grid grid-cols-2 gap-2 text-[11px]">
                            {[
                              { key: 'style', label: '风格' },
                              { key: 'colorScheme', label: '配色' },
                              { key: 'composition', label: '构图' },
                              { key: 'decorations', label: '装饰' },
                              { key: 'typography', label: '字效' },
                              { key: 'background', label: '背景' }
                            ].map((item) => (
                              <label key={item.key} className="space-y-1">
                                <div className="text-[10px] font-bold text-slate-500">{item.label}</div>
                                <input
                                  value={(basicSettings as any)[item.key]}
                                  onChange={(e) => setBasicSettings((prev) => ({ ...prev, [item.key]: e.target.value }))}
                                  className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-[11px] bg-white"
                                />
                              </label>
                            ))}
                          </div>
                          <textarea
                            value={analysisPromptDraft}
                            onChange={(e) => setAnalysisPromptDraft(e.target.value)}
                            className="w-full h-20 p-2.5 rounded-xl border border-slate-200 text-xs bg-slate-50 outline-none resize-none"
                            placeholder="补充生图指令（可选）"
                          />
                        </>
                      ) : (
                        <>
                          <div className="grid grid-cols-2 gap-1.5">
                            {[
                              { label: '旋转X', key: 'rotationX', min: -45, max: 45, step: 1 },
                              { label: '旋转Y', key: 'rotationY', min: -60, max: 60, step: 1 },
                              { label: '缩放', key: 'zoom', min: 0.7, max: 1.6, step: 0.01 },
                              { label: '明暗', key: 'lightIntensity', min: 0, max: 1, step: 0.01 },
                              { label: '虚实', key: 'depthBlur', min: 0, max: 1, step: 0.01 },
                              { label: '色温', key: 'temperature', min: 0, max: 1, step: 0.01 }
                            ].map((item) => (
                              <label key={item.key} className="text-[11px] font-bold text-slate-600 space-y-1">
                                <div>{item.label}</div>
                                <input type="range" min={item.min} max={item.max} step={item.step} value={(sceneTuning as any)[item.key]} onChange={(e) => setSceneTuning((prev) => ({ ...prev, [item.key]: Number(e.target.value) }))} className="w-full" />
                              </label>
                            ))}
                          </div>
                          <div className="space-y-2">
                            <div className="text-[11px] font-black text-slate-700">主体卡片（最多5个）</div>
                            <div className="space-y-2 max-h-36 overflow-y-auto">
                              {subjectCards.map((item) => (
                                <div key={item.id} className="p-2 rounded-lg border border-slate-100 bg-slate-50 text-[11px] text-slate-600 space-y-2">
                                  <div className="grid grid-cols-3 gap-1">
                                    <input value={item.name} onChange={(e) => setSubjectCards((prev) => prev.map((s) => s.id === item.id ? { ...s, name: e.target.value } : s))} className="px-2 py-1 rounded border border-slate-200 bg-white" />
                                    <input type="number" step="0.01" min="0" max="1" value={item.scale} onChange={(e) => setSubjectCards((prev) => prev.map((s) => s.id === item.id ? { ...s, scale: Number(e.target.value) } : s))} className="px-2 py-1 rounded border border-slate-200 bg-white" />
                                    <input type="number" step="0.01" min="0" max="1" value={item.rankScore} onChange={(e) => setSubjectCards((prev) => prev.map((s) => s.id === item.id ? { ...s, rankScore: Number(e.target.value) } : s))} className="px-2 py-1 rounded border border-slate-200 bg-white" />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl p-4 h-full min-h-0 flex flex-col relative">
                  <div className="flex items-center justify-center mb-2">
                    {renderPill(previewViewMode, (value) => {
                      setPreviewViewMode(value as 'preview' | 'edit');
                      if (value === 'edit') setActivePreviewPanel('reference');
                    }, [
                      { id: 'preview', label: '预览' },
                      { id: 'edit', label: '编辑' }
                    ])}
                  </div>
                  {activePreviewPanel === 'general' && previewViewMode === 'preview' && posters[0]?.generatedImage ? (
                    <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center">
                      <img src={posters[0]?.generatedImage} className="max-w-full max-h-full object-contain" />
                    </div>
                  ) : activePreviewPanel === 'reference' ? (
                    previewViewMode === 'preview' ? (
                      <div className="flex-1 rounded-xl border border-slate-200 bg-slate-50 overflow-hidden flex items-center justify-center">
                        {referenceImageData ? (
                          <img src={referenceImageData} className="max-w-full max-h-full object-contain" />
                        ) : (
                          <div className="text-[12px] text-slate-400 font-bold">请先上传参考图</div>
                        )}
                      </div>
                    ) : (
                      <div className="flex-1 min-h-0 grid grid-cols-[3fr_1fr] gap-2">
                        <div
                          ref={editorDropRef}
                          className="rounded-xl border border-slate-200 bg-slate-50 relative overflow-hidden"
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={async (e) => {
                            e.preventDefault();
                            const file = e.dataTransfer.files?.[0];
                            if (file && file.type.startsWith('image/')) {
                              const reader = new FileReader();
                              reader.onload = (ev) => addImageLayerByBase64(String(ev.target?.result || ''), '拖入图像');
                              reader.readAsDataURL(file);
                              return;
                            }
                            const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
                            if (uri && /^https?:|^data:image\//.test(uri)) addImageLayerByBase64(uri, '仓库拖入图像');
                          }}
                        >
                          <Stage
                            width={stageSize.width}
                            height={stageSize.height}
                            draggable={true}
                            scaleX={stageScale}
                            scaleY={stageScale}
                            x={stagePosition.x}
                            y={stagePosition.y}
                            onDragEnd={(e) => setStagePosition({ x: e.target.x(), y: e.target.y() })}
                            onWheel={(e) => {
                              e.evt.preventDefault();
                              const factor = e.evt.deltaY > 0 ? 0.92 : 1.08;
                              setStageScale((prev) => Math.max(0.2, Math.min(4, Number((prev * factor).toFixed(3)))));
                            }}
                            onMouseDown={(e) => {
                              if (e.target === e.target.getStage()) setSelectedLayerId(null);
                            }}
                            onContextMenu={(e) => {
                              e.evt.preventDefault();
                              setContextMenu({ x: e.evt.clientX, y: e.evt.clientY, layerId: null, open: true });
                            }}
                          >
                            <Layer>
                              <Rect x={0} y={0} width={2400} height={1600} fill="#f8fafc" />
                              {Array.from({ length: 120 }).map((_, ix) => Array.from({ length: 90 }).map((__, iy) => (
                                <Circle key={`dot-${ix}-${iy}`} x={ix * 20 + 10} y={iy * 20 + 10} radius={0.8} fill="#dbe4f2" />
                              )))}
                            </Layer>
                            <Layer>
                              {editorLayers.slice().sort((a, b) => a.zIndex - b.zIndex).map((layer) => (
                                !layer.hidden && (
                                  <React.Fragment key={layer.id}>
                                    {layer.type === 'image' ? (
                                      <KonvaImage
                                        ref={(node) => { layerNodeRef.current[layer.id] = node; }}
                                        x={layer.x}
                                        y={layer.y}
                                        width={layer.width}
                                        height={layer.height}
                                        rotation={layer.rotation}
                                        opacity={layer.opacity}
                                        image={imageAssetMap[layer.id]}
                                        draggable={!layer.locked}
                                        onClick={() => setSelectedLayerId(layer.id)}
                                        onTap={() => setSelectedLayerId(layer.id)}
                                        onContextMenu={(e) => {
                                          e.evt.preventDefault();
                                          setSelectedLayerId(layer.id);
                                          setContextMenu({ x: e.evt.clientX, y: e.evt.clientY, layerId: layer.id, open: true });
                                        }}
                                        onDragEnd={(e) => updateLayer(layer.id, { x: e.target.x(), y: e.target.y() })}
                                        onTransformEnd={(e) => {
                                          const node = e.target;
                                          const scaleX = node.scaleX();
                                          const scaleY = node.scaleY();
                                          node.scaleX(1);
                                          node.scaleY(1);
                                          updateLayer(layer.id, {
                                            x: node.x(),
                                            y: node.y(),
                                            rotation: node.rotation(),
                                            width: Math.max(20, node.width() * scaleX),
                                            height: Math.max(20, node.height() * scaleY)
                                          });
                                        }}
                                      />
                                    ) : (
                                      <Rect
                                        ref={(node) => { layerNodeRef.current[layer.id] = node; }}
                                        x={layer.x}
                                        y={layer.y}
                                        width={layer.width}
                                        height={layer.height}
                                        rotation={layer.rotation}
                                        opacity={layer.opacity}
                                        cornerRadius={layer.type === 'circle' ? Math.min(layer.width, layer.height) : 0}
                                        fill={layer.type === 'circle' ? 'rgba(52,211,153,0.25)' : 'rgba(99,102,241,0.25)'}
                                        stroke={layer.type === 'circle' ? '#10b981' : '#6366f1'}
                                        strokeWidth={1}
                                        draggable={!layer.locked}
                                        onClick={() => setSelectedLayerId(layer.id)}
                                        onTap={() => setSelectedLayerId(layer.id)}
                                        onContextMenu={(e) => {
                                          e.evt.preventDefault();
                                          setSelectedLayerId(layer.id);
                                          setContextMenu({ x: e.evt.clientX, y: e.evt.clientY, layerId: layer.id, open: true });
                                        }}
                                        onDragEnd={(e) => updateLayer(layer.id, { x: e.target.x(), y: e.target.y() })}
                                        onTransformEnd={(e) => {
                                          const node = e.target;
                                          const scaleX = node.scaleX();
                                          const scaleY = node.scaleY();
                                          node.scaleX(1);
                                          node.scaleY(1);
                                          updateLayer(layer.id, {
                                            x: node.x(),
                                            y: node.y(),
                                            rotation: node.rotation(),
                                            width: Math.max(20, node.width() * scaleX),
                                            height: Math.max(20, node.height() * scaleY)
                                          });
                                        }}
                                      />
                                    )}
                                  </React.Fragment>
                                )
                              ))}
                              <Transformer
                                ref={transformerRef}
                                rotateEnabled={true}
                                enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']}
                              />
                            </Layer>
                          </Stage>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-white p-2 min-h-0 flex flex-col gap-2">
                          <div className="grid grid-cols-2 gap-1">
                            <button onClick={() => addShapeLayer('rect')} className="px-2 py-1 rounded border border-slate-200 text-[10px] font-bold bg-white">方形</button>
                            <button onClick={() => addShapeLayer('circle')} className="px-2 py-1 rounded border border-slate-200 text-[10px] font-bold bg-white">圆形</button>
                            <button onClick={handleInsertLayerImage} className="px-2 py-1 rounded border border-slate-200 text-[10px] font-bold bg-white col-span-2">插入图像</button>
                            <button onClick={handleDetectSubjectForSelectedLayer} className="px-2 py-1 rounded border border-slate-200 text-[10px] font-bold bg-white">识别主体</button>
                            <button onClick={handleRemoveBgForSelectedLayer} className="px-2 py-1 rounded border border-slate-200 text-[10px] font-bold bg-white">去背景</button>
                          </div>
                          <div className="flex-1 min-h-0 overflow-y-auto space-y-1.5">
                            {editorLayers.sort((a, b) => b.zIndex - a.zIndex).map((layer) => (
                              <div key={layer.id} onClick={() => setSelectedLayerId(layer.id)} className={`p-1.5 rounded border text-[10px] ${selectedLayerId === layer.id ? 'border-indigo-300 bg-indigo-50' : 'border-slate-200 bg-white'}`}>
                                <div className="font-bold truncate">{layer.name}</div>
                                <div className="flex items-center gap-1 mt-1">
                                  <button onClick={(e) => { e.stopPropagation(); reorderLayer(layer.id, 'up'); }} className="px-1 py-0.5 rounded border border-slate-200">↑</button>
                                  <button onClick={(e) => { e.stopPropagation(); reorderLayer(layer.id, 'down'); }} className="px-1 py-0.5 rounded border border-slate-200">↓</button>
                                  <button onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { locked: !layer.locked }); }} className="px-1 py-0.5 rounded border border-slate-200">{layer.locked ? '解锁' : '锁定'}</button>
                                  <button onClick={(e) => { e.stopPropagation(); updateLayer(layer.id, { hidden: !layer.hidden }); }} className="px-1 py-0.5 rounded border border-slate-200">{layer.hidden ? '显示' : '隐藏'}</button>
                                </div>
                              </div>
                            ))}
                          </div>
                          {selectedLayer && (
                            <div className="space-y-1 text-[10px]">
                              <input type="number" value={Math.round(selectedLayer.width)} onChange={(e) => updateLayer(selectedLayer.id, { width: Math.max(10, Number(e.target.value)) })} className="w-full px-1.5 py-1 rounded border border-slate-200" placeholder="宽" />
                              <input type="number" value={Math.round(selectedLayer.height)} onChange={(e) => updateLayer(selectedLayer.id, { height: Math.max(10, Number(e.target.value)) })} className="w-full px-1.5 py-1 rounded border border-slate-200" placeholder="高" />
                              <input type="range" min="0.1" max="1" step="0.01" value={selectedLayer.opacity} onChange={(e) => updateLayer(selectedLayer.id, { opacity: Number(e.target.value) })} className="w-full" />
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  ) : (
                    <div className="flex-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center text-center text-slate-400">
                      <div>
                        <div className="text-sm font-black">预览为空</div>
                        <div className="text-[11px] mt-1">请先创作或上传参考图</div>
                      </div>
                    </div>
                  )}
                  {fusionPromptPreview && (
                    <div className="mt-2 p-2 rounded-lg border border-slate-200 bg-slate-50 text-[10px] text-slate-600 line-clamp-3">{fusionPromptPreview}</div>
                  )}
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    {previewViewMode === 'preview' ? (
                      <>
                        <button onClick={handleGenerateNowFromInstruction} disabled={isGeneratingFromInstruction || posters.length === 0} className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-black disabled:opacity-50">{isGeneratingFromInstruction ? '创作中' : '立即创作'}</button>
                        <button onClick={handleSaveToWarehouse} disabled={posters.length === 0} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 bg-white disabled:opacity-50">存至仓库</button>
                      </>
                    ) : (
                      <>
                        <button onClick={handleReplaceReferenceImage} className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-black">替换参考</button>
                        <button onClick={handleSaveEditedReferenceToDisk} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 bg-white">保存本地</button>
                      </>
                    )}
                  </div>
                  {contextMenu.open && (
                    <div className="fixed z-50 w-36 rounded-lg border border-slate-200 bg-white shadow-xl p-1.5 space-y-1" style={{ left: contextMenu.x, top: contextMenu.y }}>
                      <button onClick={() => contextMenu.layerId && openLayerDescriptionDialog(contextMenu.layerId)} className="w-full text-left px-2 py-1 rounded text-[11px] hover:bg-slate-50">添加描述</button>
                      <button onClick={async () => {
                        if (!contextMenu.layerId) return;
                        const layer = editorLayers.find((x) => x.id === contextMenu.layerId);
                        if (!layer || layer.type !== 'image') return;
                        const files = await (window as any).electronAPI?.fs?.openFile?.({ title: '替换图像', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }], properties: ['openFile'] });
                        if (!files || !files[0]) return;
                        const content = await (window as any).electronAPI?.fs?.readFile?.(files[0], 'base64');
                        if (!content?.success || !content?.data) return;
                        const ext = String(files[0]).split('.').pop()?.toLowerCase();
                        const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
                        updateLayer(layer.id, { src: `data:${mime};base64,${content.data}` });
                        setContextMenu((prev) => ({ ...prev, open: false }));
                      }} className="w-full text-left px-2 py-1 rounded text-[11px] hover:bg-slate-50">右键替换图像</button>
                      <button onClick={() => { if (contextMenu.layerId) deleteLayer(contextMenu.layerId); setContextMenu((prev) => ({ ...prev, open: false })); }} className="w-full text-left px-2 py-1 rounded text-[11px] text-rose-600 hover:bg-rose-50">删除图层</button>
                    </div>
                  )}
                  {showLayerDescDialog && (
                    <div className="fixed inset-0 z-50 bg-black/30 flex items-center justify-center">
                      <div className="w-[420px] bg-white rounded-xl border border-slate-200 p-3 space-y-2">
                        <div className="text-xs font-black text-slate-800">图层需求描述</div>
                        <textarea value={layerDescDraft} onChange={(e) => setLayerDescDraft(e.target.value)} className="w-full h-28 p-2 rounded-lg border border-slate-200 text-xs bg-slate-50 outline-none resize-none" placeholder="描述该图层在融合生图中的作用（可选）" />
                        <div className="grid grid-cols-2 gap-2">
                          <button onClick={applyLayerDescription} className="px-3 py-2 rounded-lg bg-slate-900 text-white text-xs font-black">保存描述</button>
                          <button onClick={() => setShowLayerDescDialog(false)} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 bg-white">取消</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
          )}

          {contentType === 'image' && mode === 'auto' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm font-black text-slate-800">自动图像流水线</div>
                  <div className="text-[11px] text-slate-400 font-medium">启用可编辑胶囊卡片，组合自动化视觉生成链路</div>
                </div>
                <div className="text-[11px] font-black text-indigo-600">已启用 {pipelineEnabledCount} 项</div>
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-700">输入意图</label>
                <textarea
                  value={autoPromptInput}
                  onChange={(e) => setAutoPromptInput(e.target.value)}
                  className="w-full h-28 p-3 rounded-xl border border-slate-200 text-xs bg-slate-50 outline-none resize-none"
                  placeholder="描述你要自动生产的视觉目标"
                />
              </div>

              <div className="space-y-2">
                <label className="text-[11px] font-black text-slate-700">上传多模态附件</label>
                <label className="w-full flex items-center justify-center gap-2 px-3 py-3 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-xs font-bold text-slate-600 cursor-pointer">
                  <span>上传图片 / 文本 / 视频</span>
                  <input
                    type="file"
                    className="hidden"
                    multiple
                    accept="image/*,video/*,.txt,.md,.csv"
                    onChange={(e) => setAutoAttachments(Array.from(e.target.files || []))}
                  />
                </label>
                {autoAttachments.length > 0 && (
                  <div className="text-[11px] text-slate-500 font-medium">{autoAttachments.length} 个附件已加入流程</div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {workflowCards.map((card) => (
                  <div key={card.id} className={`px-3 py-2 rounded-xl border text-xs flex items-center gap-2 ${card.enabled ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'bg-white border-slate-200 text-slate-500'}`}>
                    <button
                      onClick={() => setWorkflowCards((prev) => prev.map((x) => x.id === card.id ? { ...x, enabled: !x.enabled } : x))}
                      className={`w-4 h-4 rounded-full border ${card.enabled ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}
                    />
                    <span className="font-bold">{card.label}</span>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {workflowCards.filter((x) => x.enabled).map((card) => (
                  <input
                    key={card.id}
                    value={card.value}
                    onChange={(e) => setWorkflowCards((prev) => prev.map((x) => x.id === card.id ? { ...x, value: e.target.value } : x))}
                    className="px-3 py-2 rounded-lg border border-slate-200 text-xs bg-white outline-none"
                    placeholder={`${card.label}参数（可选）`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const enabled = workflowCards.filter((x) => x.enabled).map((x) => `${x.label}${x.value ? `(${x.value})` : ''}`);
                    const structured = [
                      `目标：${autoPromptInput || '未填写'}`,
                      `流程：${enabled.join(' -> ') || '未配置流程'}`,
                      `附件数：${autoAttachments.length}`
                    ].join('\n');
                    setAutoStructuredPrompt(structured);
                  }}
                  className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-black"
                >
                  生成结构化 Prompt
                </button>
                <button
                  onClick={() => {
                    const now = new Date();
                    setAutoRunResult(`已启动自动流程（${now.toLocaleString()}），并行:${workflowCards.find((x) => x.id === 'parallel')?.value || '1'}，循环:${workflowCards.find((x) => x.id === 'loop')?.value || '1'}`);
                  }}
                  className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-black"
                >
                  运行自动流水线
                </button>
              </div>

              <textarea
                value={autoStructuredPrompt}
                onChange={(e) => setAutoStructuredPrompt(e.target.value)}
                className="w-full h-32 p-3 rounded-xl border border-slate-200 text-xs bg-slate-50 outline-none resize-none"
                placeholder="结构化 Prompt 将显示在这里"
              />
              {autoRunResult && <div className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100 px-3 py-2 rounded-lg">{autoRunResult}</div>}
            </div>
          )}

          {contentType === 'video' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="text-sm font-black text-slate-800">视频生成</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="text-[11px] font-black text-slate-700">首帧图片</span>
                  <input type="file" accept="image/*" onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => setVideoStartFrame(String(ev.target?.result || ''));
                    reader.readAsDataURL(file);
                  }} className="w-full text-xs" />
                </label>
                <label className="space-y-1">
                  <span className="text-[11px] font-black text-slate-700">尾帧图片</span>
                  <input type="file" accept="image/*" onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = (ev) => setVideoEndFrame(String(ev.target?.result || ''));
                    reader.readAsDataURL(file);
                  }} className="w-full text-xs" />
                </label>
              </div>
              <label className="space-y-1 block">
                <span className="text-[11px] font-black text-slate-700">补充文本描述</span>
                <textarea
                  value={videoText}
                  onChange={(e) => setVideoText(e.target.value)}
                  className="w-full h-24 p-3 rounded-xl border border-slate-200 text-xs bg-slate-50 outline-none resize-none"
                  placeholder="输入镜头运动、情绪、节奏等描述"
                />
              </label>
              <div className="flex items-center gap-2">
                <label className="text-[11px] font-black text-slate-700">模型</label>
                <select value={videoModelId} onChange={(e) => setVideoModelId(e.target.value)} className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 bg-white">
                  {(videoModels.length > 0 ? videoModels : defaultModelConfigs.filter((x) => x.type === 'video')).map((m) => (
                    <option key={m.id} value={m.id}>{m.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => {
                    const generated = `请基于首尾帧连贯衔接，生成细腻镜头语言与光影变化。主题：${videoText || '无补充描述'}。要求：高质量、主体稳定、运动自然。`;
                    setVideoPrompt(generated);
                  }}
                  className="px-4 py-2 rounded-lg border border-slate-200 text-xs font-bold text-slate-700 bg-white"
                >
                  一键转换高质量提示词
                </button>
              </div>
              <textarea
                value={videoPrompt}
                onChange={(e) => setVideoPrompt(e.target.value)}
                className="w-full h-28 p-3 rounded-xl border border-slate-200 text-xs bg-slate-50 outline-none resize-none"
                placeholder="视频提示词"
              />
              <label className="space-y-1 block">
                <span className="text-[11px] font-black text-slate-700">封面图（可选）</span>
                <input type="file" accept="image/*" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => setVideoCoverImage(String(ev.target?.result || ''));
                  reader.readAsDataURL(file);
                }} className="w-full text-xs" />
              </label>
              <button
                onClick={() => {
                  const frameReady = !!videoStartFrame || !!videoEndFrame;
                  if (!frameReady && !videoText.trim()) {
                    setVideoOutputInfo('请先上传首尾帧或输入文本描述。');
                    return;
                  }
                  const now = new Date().toLocaleString();
                  setVideoOutputInfo(`已提交视频生成任务，模型：${videoModelId}，时间：${now}。${videoCoverImage ? '已附带封面图。' : ''}`);
                }}
                className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-black"
              >
                生成视频
              </button>
              {videoOutputInfo && <div className="text-[11px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-3 py-2 rounded-lg">{videoOutputInfo}</div>}
            </div>
          )}

          {contentType === 'gif' && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <div className="text-sm font-black text-slate-800">动态图（视频转 GIF）</div>
              <textarea
                value={gifSourceVideoHint}
                onChange={(e) => setGifSourceVideoHint(e.target.value)}
                className="w-full h-24 p-3 rounded-xl border border-slate-200 text-xs bg-slate-50 outline-none resize-none"
                placeholder="粘贴视频任务描述或文件路径备注"
              />
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1 block">
                  <span className="text-[11px] font-black text-slate-700">FPS</span>
                  <input value={gifFps} onChange={(e) => setGifFps(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs" />
                </label>
                <label className="space-y-1 block">
                  <span className="text-[11px] font-black text-slate-700">循环次数（0 为无限）</span>
                  <input value={gifLoop} onChange={(e) => setGifLoop(e.target.value)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-xs" />
                </label>
              </div>
              <button
                onClick={() => {
                  if (!gifSourceVideoHint.trim()) {
                    setGifResult('请先提供视频来源描述。');
                    return;
                  }
                  setGifResult(`已创建 GIF 转码任务：FPS ${gifFps || '12'}，循环 ${gifLoop || '0'}，来源：${gifSourceVideoHint.trim()}`);
                }}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-xs font-black"
              >
                转换为 GIF
              </button>
              {gifResult && <div className="text-[11px] font-bold text-slate-700 bg-slate-100 border border-slate-200 px-3 py-2 rounded-lg">{gifResult}</div>}
            </div>
          )}
      </div>
    </div>
  );
};

export default DesignWorkshop;
