
export interface PromptLibraryItem {
    id: string;
    content: string;
    tags: string[];
    source: 'Jimeng' | 'Upload' | 'Generated' | 'Manual' | 'Crawler';
    createdAt: number;
    previewImage?: string; // Base64 thumbnail if available
    deletedAt?: number;
}

export type EventCategory = 'Western' | 'SolarTerm' | 'Traditional' | 'InternationalDay' | 'PublicHoliday' | 'Custom' | 'Personal';

export type NgoDomain = 
  | '儿童' 
  | '妇女' 
  | '老人' 
  | '残障' 
  | '青年' 
  | '环保' 
  | '医疗' 
  | '可持续' 
  | '教育' 
  | '动物保护'
  | '社区发展'
  | '其他';

export type AIProvider = 'Google' | 'DeepSeek';
export type AppTheme = 'Day' | 'Night';

export interface CalendarEvent {
  id: string;
  title: string;
  date: string; 
  category: EventCategory;
  isPublicHoliday?: boolean;
  description?: string; 
  isCustom?: boolean; 
  relevantDomains?: NgoDomain[]; 
  status?: 'Active' | 'Paused'; 
  locked?: boolean; 
  priority?: {
      isImportant: boolean;
      isUrgent: boolean;
  };
  suggestedLead?: string; 
  linkedScheduleId?: string; // 关联的排期方案ID
}

export interface ExtractionSession {
    id: string;
    status: 'idle' | 'processing' | 'ready' | 'error';
    files: { name: string; type: string; size: number; data?: string }[];
    inputText: string;
    results: Partial<CalendarEvent>[];
    isMinimized: boolean;
    error?: string;
    createdAt: number;
}

export interface EventPlanState {
    eventId: string;
    plan: GeneratedPlan;
    sops: SOPDocument[]; 
    isAdopted?: boolean; 
    linkedProjectId?: string; 
    updatedAt: number;
}

export type PlannerRelationType = 'depends_on' | 'blocks' | 'related';

export interface PlannerRelationEdge {
    fromEventId: string;
    toEventId: string;
    type: PlannerRelationType;
    note?: string;
}

export interface PlannerReferencePack {
    packId: string;
    folderPath: string;
    filePath: string;
    title: string;
    createdAt: number;
}

export interface PlannerEventContextConfig {
    includeEventMeta?: boolean;
    includeTimeline?: boolean;
    timelineWindowDays?: number;
    includeRelations?: boolean;
    relations?: PlannerRelationEdge[];
    includeKbSnippets?: boolean;
    kbTopK?: number;
    kbScopes?: string[];
    referencePacks?: PlannerReferencePack[];
    customNotes?: string;
}

export interface PlanCustomization {
  platforms?: string[];
  contentFormat?: string;
  eventType?: '线上' | '线下';
  eventCycle?: string;
  eventScale?: string;
  eventBudget?: string;
  additionalRequirements?: string;
}

export interface GeneratedPlan {
  type: 'Content' | 'Event' | 'TaskAnalysis';
  markdown: string; 
  content?: {
      topics?: string[];
      toolkits?: string[];
      platforms?: string[];
      format?: string;
      rationale?: string;
      recommendedArticlesOrBooks?: string[];
  };
  event?: {
      keyStages?: string[];
      toolkits?: string[];
      budgetBreakdown?: string;
  };
  visuals?: {
      posters: PosterSlot[];
  };
}

export type VisualProvider = 'Jimeng' | 'Doubao' | 'Nanobanana' | 'Gemini';

export interface VisualEngineConfig {
    provider: VisualProvider;
    apiKey: string; // For Gemini or generic single-key providers
    accessKeyId?: string; // For Volcengine (Jimeng/Doubao)
    secretAccessKey?: string; // For Volcengine (Jimeng/Doubao)
    isEnabled: boolean;
}

export interface PosterRefinement {
    background?: string;
    colorScheme?: string;
    textElements?: string;
    decorations?: string;
    layout?: string;
    custom?: string;
}

export interface PosterConfig {
    aspectRatio: '1:1' | '3:4' | '4:3' | '9:16' | '16:9';
    style: string;
    detailLevel?: string;
    colorPaletteUrl?: string;
    platform?: string[];
    customText?: string;
    subTitle?: string;
    logoData?: string; // Base64
    colorTheme?: string;
    selectedModel?: string;
    refinements?: PosterRefinement;
    referenceImagePrompt?: string; // Prompt extracted from reference image
    purpose?: string; // 传播重点和目的
}

export interface PosterSlot {
  id: string;
  title: string;
  purpose: string;
  config: PosterConfig;
  generatedImage?: string; // Base64 数据
  isGenerating?: boolean;  // 运行时状态，不需要持久化
  finalPrompt?: string;    // 实际用于生成的完整提示词
}

export interface SearchConfig {
    keywords: string[];
    domains: NgoDomain[];
    matchCriteria: {
        region: string;
        fundingPreference: string;
    };
    frequency: 'Manual' | 'Daily' | 'Weekly';
    lastRun: number;
}

export interface WebLeadResult {
    id: string;
    title: string;
    snippet: string;
    url: string;
    source: string;
    matchScore: number;
    matchReason: string;
    isCollected: boolean;
    deadline?: string;
}

export interface MarketReport {
    summary: string;
    hotTopics: string[];
    generatedAt: number;
}

export interface PPTSlide {
    title: string;
    content: string[];
    visualSuggestion?: string;
    speakerNotes?: string;
}

export interface ReportVersion {
    id: string;
    title: string;
    audience: string;
    wordCount: string;
    content: string;
    createdAt: number;
    isFinalized: boolean;
    pptSlides?: PPTSlide[];
    pptUpdatedAt?: number;
}

export interface FileAttachment {
    id: string;
    name: string; 
    originalPath?: string;
    markdownPath?: string; 
    type: string; 
    category?: 'Finance' | 'Execution';
    uploadedAt: number;
    isLocked?: boolean;
    isMarkdownLocked?: boolean;
    url?: string;
    prompt?: string; // 图片生成提示词
}

export interface ExpenseItem {
  id: string;
  category: string; 
  item: string;
  budgetAmount: number;
  actualAmount: number;
  attachments: FileAttachment[]; 
  notes: string;
}

export interface MilestoneItem {
  id: string;
  stage: string;
  task: string;
  chargePerson?: string; 
  status: 'Pending' | 'In Progress' | 'Done';
  completionDate?: string;
  evidence: FileAttachment[];
}

export interface Project {
  id: string;
  title: string;
  domain: NgoDomain;
  startDate: string;
  status: ProjectStatus;
  warehousePath?: string; 
  source: 'Calendar' | 'Upload'; 
  type?: 'Event' | 'Content';
  leader?: string;
  expenses: ExpenseItem[];
  milestones: MilestoneItem[];
  officialPlanContent?: string;
  sops?: SOPDocument[];
  planLocked: boolean; 
  financialsLocked: boolean; 
  executionLocked: boolean; 
  reportLocked: boolean; 
  pptLocked: boolean;
  created_at: number;
  deletedAt?: number; // 新增：删除时间戳，存在则代表在回收站
  originalEventId?: string;
  originalPlan?: GeneratedPlan;
  reportVersions?: ReportVersion[];
}

export type ProjectStatus = 'Planning' | 'Execution' | 'Closing' | 'Archived';
export interface SOPDocument { id: string; title: string; content: string; type: 'markdown' | 'csv' | 'text'; }

export type TeamRole = '理事长' | '秘书长' | '总干事' | '项目官' | '传播官' | '财务' | '志愿者' | '实习生' | '相关方';
export type MainResponsibility = '统筹管理' | '项目执行' | '传播推广' | '后勤支持' | '外联募资' | '其他';
export type ScheduleType = 'Fixed' | 'Flexible';
export type MemberStatus = 'Active' | 'Inactive';

export interface UnavailablePeriod {
    id: string;
    start: string;
    end: string;
    reason?: string;
}

export interface TeamMember {
    id: string;
    nickname: string;
    role: TeamRole;
    responsibility: MainResponsibility;
    department: string;
    status: MemberStatus;
    isAI?: boolean;
    traits?: string[];
    scheduleType?: ScheduleType;
    unavailablePeriods?: UnavailablePeriod[];
    availableWeekdays?: number[];
}

export interface SavedSchedule {
    id: string;
    title: string;
    content: string; 
    isStructured?: boolean; 
    chatHistory?: any[]; 
    createdAt: number;
    rangeLabel: string;
    status?: 'Active' | 'Archived'; 
}

export interface StructuredScheduleData {
    overview: string;
    phases: {
        name: string;
        timeRange: string;
        focus: string;
    }[];
    tasks: {
        title: string;
        ownerName: string;
        role: string;
        priority: 'High' | 'Normal' | 'Low';
        type: 'Task' | 'Milestone';
        phaseName: string;
        date: string; // 增加日期字段，必须是 YYYY-MM-DD
    }[];
    roleGuidance?: {
        role: string;
        focus: string;
        tips: string[];
    }[];
}

export interface ScheduleChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
    timestamp: number;
}

export interface ProjectLeadSource {
    id: string;
    name: string;
    type: 'URL' | 'File' | 'Text' | 'WebSearch';
    content: string;
    status: 'New' | 'Analyzed';
    addedAt: number;
    originalUrl?: string;
}

export interface Opportunity {
    id: string;
    sourceId: string;
    title: string;
    funder: string;
    deadline: string;
    fundingAmount: string;
    matchScore: number;
    matchReason: string;
    isIgnored: boolean;
}

export interface ProjectApplication {
    id: string;
    opportunityId: string;
    opportunity: Opportunity;
    proposalContent: string;
    status: 'Draft' | 'Submitted' | 'Interview' | 'Success' | 'Rejected';
    notes: string;
    lastUpdated: number;
}

export interface AgentKnowledgeItem {
    id: string;
    title: string;
    content: string;
    type: string;
}

export interface OrgProfile {
  name: string;
  description: string;
  focusAreas: string[];
}

export type ModuleType = 'Calendar' | 'Projects' | 'MasterBoard' | 'Leads' | 'Knowledge' | 'AIVolunteers' | 'AIWorkspace' | 'KnowledgeAssistant';

const RECYCLE_BIN_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30天 (毫秒)

declare global {
  interface Window {
    electronAPI?: {
      isDesktop: boolean;
      fs: {
        ensureDir: (path: string) => Promise<boolean>;
        writeFile: (filePath: string, content: string, options?: { encoding?: string }) => Promise<{ success: boolean; error?: string }>;
        readFile: (filePath: string) => Promise<{ success: boolean; data?: string; error?: string }>;
        readFilePreview: (filePath: string) => Promise<{ success: boolean; type?: 'text'|'image'; data?: string; error?: string }>;
        exists: (filePath: string) => Promise<boolean>;
        deleteFile: (filePath: string) => Promise<{ success: boolean; error?: string }>;
        deleteDirectory?: (dirPath: string) => Promise<{ success: boolean; error?: string }>; // 预留物理删除目录
        selectFile: (options?: { filters?: { name: string; extensions: string[] }[] }) => Promise<{ name: string; data: string; path: string } | null>;
        selectFolder: () => Promise<string | null>;
        openPath: (path: string) => Promise<void>;
        locateInExplorer: (path: string) => Promise<void>;
        readDir: (dirPath: string) => Promise<{ name: string; path: string; isDirectory: boolean; size: number; mtime: Date }[]>;
        copyFiles: (src: string, dest: string) => Promise<{ success: boolean; count?: number; error?: string }>;
      };
      db: {
          getProjects: () => Promise<any[]>;
          saveProject: (project: any) => Promise<{ success: boolean }>;
          deleteProject: (id: string) => Promise<{ success: boolean }>;
          getSetting: (key: string) => Promise<any>;
          saveSetting: (key: string, value: any) => Promise<{ success: boolean }>;
      };
      storage: {
          persist: (data: any) => Promise<{ success: boolean; path: string; error?: string }>;
      };
      readingMode: {
          createProject: (id: string, purpose: string) => Promise<any>;
          getProjects: () => Promise<any[]>;
          createSession: (id: string, projectId: string, filePath: string) => Promise<any>;
          getSessions: (projectId: string) => Promise<any[]>;
          createCard: (card: any) => Promise<any>;
          getCards: (sessionId: string) => Promise<any[]>;
          updateCard: (id: string, updates: any) => Promise<any>;
          deleteCard: (id: string) => Promise<any>;
          saveSummary: (summary: any) => Promise<any>;
          getSummary: (targetId: string) => Promise<any>;
      };
      llm: {
          openaiListModels: (params: { baseUrl: string; apiKey?: string }) => Promise<{ success: boolean; models: string[]; error?: string }>;
          openaiTest: (params: { baseUrl: string; apiKey?: string; modelId: string }) => Promise<{ success: boolean; latencyMs?: number; text?: string; error?: string }>;
      };
      knowledge: {
          query: (params: { text: string; topK: number; activeFiles?: string[]; weight?: number }) => Promise<{ context: string; sources: any[]; chunks: any[] }>;
          upload: (fileData: { name: string; path?: string; data?: string; saveProcessedAsMd?: boolean }) => Promise<{ success: boolean; status?: 'queued' | 'processing' | 'completed' | 'failed'; error?: string }>;
          resetIndex: () => Promise<{ success: boolean; error?: string }>;
          completion: (params: { prompt: string }) => Promise<{ success: boolean; text?: string; error?: string }>;
          proposeStructure: (params: any) => Promise<any>;
          onIngestProgress: (callback: (data: { total: number; processed: number; pending: number; currentFile: string | null; status: 'idle' | 'processing' | 'completed' | 'failed'; error?: string }) => void) => () => void;
          onFileMetadataUpdated: (callback: (data: { filePath: string; meta: { title: string | null; author: string | null; published_time: string | null; abstract: string | null; keywords: string[] } }) => void) => () => void;
          togglePrivacy: (enabled: boolean) => Promise<{ success: boolean; error?: string }>;
          getPrivacyStatus: () => Promise<{ success: boolean; enabled: boolean; error?: string }>;
          getPrivacyFolders: () => Promise<{ success: boolean; folders: string[]; error?: string }>;
          addPrivacyFolder: (path: string) => Promise<{ success: boolean; error?: string }>;
          removePrivacyFolder: (path: string) => Promise<{ success: boolean; error?: string }>;
          // Reading Stats & Metadata
          updateReadingStats: (params: { filePath: string; duration: number; progress?: number; totalPages?: number }) => Promise<{ success: boolean; error?: string }>;
          getFileTopTags: (filePaths: string[], limit?: number) => Promise<{[path: string]: string[]}>;
          getExtendedStats: () => Promise<any[]>;
          scanStaleReadingHistory: (options?: { limit?: number; timeoutMs?: number; delete?: boolean }) => Promise<{ success: boolean; stalePaths: string[]; deleted: number; error?: string }>;
          deleteReadingHistory: (filePath: string) => Promise<{ success: boolean; error?: string }>;
          chat: {
              saveMessage: (msg: { assistant_id: string; role: 'user' | 'model'; content: string; sources?: string[]; entities?: Array<{ name: string; type: string }>; timestamp?: number }) => Promise<{ success: boolean; id?: string; error?: string }>;
              getHistory: (assistantId: string) => Promise<Array<{ role: 'user' | 'model'; text: string; timestamp: number; sources?: string[]; entities?: Array<{ name: string; type: string }> }>>;
              clearHistory: (assistantId: string) => Promise<{ success: boolean; error?: string }>;
              clearAllHistory: () => Promise<{ success: boolean; error?: string }>;
          };
      };
      update: {
          getVersion: () => Promise<string>;
      };
      getPath: (name: string) => Promise<string>;
      skillOrchestrator: {
          runAnalysis: () => Promise<{ success: boolean; context?: any; matchedSkills?: any[]; error?: string }>;
      };
      secure: {
        set: (key: string, value: string) => Promise<{ success: boolean; error?: string }>;
        get: (key: string) => Promise<string | null>;
      };
      clipboard: {
        readText: () => Promise<string>;
        writeText: (text: string) => Promise<boolean>;
      };
      crawler: {
        open: (url: string) => Promise<boolean>;
        start: () => Promise<{ success: boolean; count?: number; error?: string }>;
        stop: () => Promise<void>;
        onUpdate: (callback: (data: { type: string; payload: any }) => void) => void;
        onDataFound: (callback: (data: { image: string; prompt: string; url: string }) => void) => void;
        offUpdate: () => void;
        offDataFound: () => void;
      };
      exportLogs: () => Promise<{ success: boolean; logs?: any[]; savePath?: string; error?: string }>;
    }
  }
}

export {};
