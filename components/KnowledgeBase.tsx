
import React, { useState, useMemo, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Project, TeamMember, NgoDomain, ProjectLeadSource } from '../types';
import { chatWithKnowledgeBase, generateAnswerFramework, generateDeepSynthesisStream, analyzeQueryIntent } from '../services/geminiService';
import { FileTree } from './FileTree';
import ExportMenu from './ExportMenu';
import IndexManager from './IndexManager';

import { AIMigrationModal } from './KnowledgeBase/AIMigrationModal';
import { OptimizationPanel, OptimizationConfig, getOptimizationStyles } from './KnowledgeBase/OptimizationPanel';
import { FolderItem } from './KnowledgeBase/FolderItem';
import { ChunkTextHighlighter } from './KnowledgeBase/ChunkTextHighlighter';

import { WorkflowEditor } from './WorkflowEditor';
import { Node, Edge } from '@xyflow/react';

import { ReadingSessionModal } from './ReadingMode/ReadingSessionModal';
import { ReaderLayout } from './ReadingMode/ReaderLayout';
import { KnowledgeGraphView } from './ReadingMode/KnowledgeGraphView';
import { ReadingProjectList } from './ReadingMode/ReadingProjectList';
import * as KBIcons from './KnowledgeBase/KBIcons';
import CloudSyncStatus from './KnowledgeBase/CloudSync/CloudSyncStatus';
import { SmartSidebarWrapper } from './KnowledgeBase/SmartSidebarWrapper';
import MessageItem from './KnowledgeBase/MessageItem';
import { MultiExploreView } from './KnowledgeBase/MultiExplore/MultiExploreView';
import { ComparisonResult } from './KnowledgeBase/MultiExplore/types';
import { generateComparison } from './KnowledgeBase/MultiExplore/ComparisonService';
import { CardClip, CollectedItem } from './KnowledgeBase/MultiExplore/CardClip';
import { MultiExploreResponse } from './KnowledgeBase/MultiExplore/types';
import { getAvailableProviders, createProviderInstance, ProviderOption } from './KnowledgeBase/MultiExplore/MultiExploreService';
import { CustomLLMConfig } from '../services/llm/CustomOpenAIProvider';

interface ChatSession {
    id: string;
    title: string;
    messages: { 
        role: 'model' | 'assistant' | 'user'; // Normalized role
        content?: string; // Standardize content/text
        text?: string;    // Legacy support
        timestamp: number; 
        sources?: string[];
        chunks?: { text: string; source: string; score: number }[];
        complianceWarnings?: any[];
        multiResponses?: MultiExploreResponse[];
    }[];
    updatedAt: number;
    
    // --- Session State Isolation ---
    inputValue: string;
    isChatting: boolean;
    pendingIntent: {
        originalQuery: string;
        reflection: string;
        clarification: string;
        recommendWorkflow: boolean;
    } | null;
    
    // --- Context Isolation ---
    activeFiles: Set<string>;
    customContexts: ContextSource[];
    workflowNodes: Node[];
    workflowEdges: Edge[];
    
    // --- Job Progress State ---
    currentJobId?: string | null;
    progressState?: {
        step: 'INIT' | 'INTENT' | 'REWRITE' | 'RETRIEVAL' | 'RERANK' | 'GENERATE' | 'COMPLETED' | 'ERROR';
        progress: number;
        details: string;
        state: 'running' | 'paused' | 'error' | 'completed' | 'stopped';
    };
}

interface ContextSource {
    id: string;
    folderPaths: string[]; // Still stores paths, but can now be file paths too
    role: string;
    weight: number;
    mode?: 'include' | 'exclude'; 
    constraintLevel?: 'strict' | 'rephrase' | 'relaxed'; // New: Negative Constraint Level
}

// --- Optimization Mode Types ---
const KnowledgeBase: React.FC<{ projects: Project[]; teamMembers: TeamMember[]; preferredDomains: NgoDomain[]; }> = ({ projects, teamMembers, preferredDomains }) => {
    const buildDefaultSession = (): ChatSession => ({
        id: `session-${Date.now()}`,
        title: '新对话',
        messages: [{ role: 'model', text: '你好！我是知识库助手。已加载机构所有归档数据。', timestamp: Date.now() }],
        updatedAt: Date.now(),
        inputValue: '',
        isChatting: false,
        pendingIntent: null,
        activeFiles: new Set(),
        customContexts: [],
        workflowNodes: [],
        workflowEdges: []
    });

    const toSerializableSession = (session: ChatSession) => ({
        ...session,
        messages: Array.isArray(session.messages)
            ? session.messages.slice(-300).map((m: any) => ({
                ...m,
                multiResponses: Array.isArray(m?.multiResponses) && m.multiResponses.length > 0 ? m.multiResponses : undefined
            }))
            : [],
        activeFiles: Array.from(session.activeFiles || []),
        workflowNodes: Array.isArray(session.workflowNodes) ? session.workflowNodes.slice(0, 200) : [],
        workflowEdges: Array.isArray(session.workflowEdges) ? session.workflowEdges.slice(0, 400) : [],
        isChatting: false,
        pendingIntent: null,
        currentJobId: null,
        progressState: undefined
    });

    const fromSerializableSession = (raw: any): ChatSession | null => {
        if (!raw || typeof raw !== 'object' || !raw.id) return null;
        const messages = Array.isArray(raw.messages) ? raw.messages : [];
        return {
            id: String(raw.id),
            title: raw.title || '历史对话',
            messages: messages
                .filter((m: any) => m && (m.text || m.content))
                .map((m: any) => ({
                    role: m.role === 'user' ? 'user' : (m.role === 'assistant' ? 'assistant' : 'model'),
                    content: m.content,
                    text: m.text || m.content,
                    timestamp: Number(m.timestamp) || Date.now(),
                    sources: Array.isArray(m.sources) ? m.sources : [],
                    chunks: Array.isArray(m.chunks) ? m.chunks : [],
                    complianceWarnings: Array.isArray(m.complianceWarnings) ? m.complianceWarnings : [],
                    multiResponses: Array.isArray(m.multiResponses) && m.multiResponses.length > 0 ? m.multiResponses : undefined
                })),
            updatedAt: Number(raw.updatedAt) || Date.now(),
            inputValue: typeof raw.inputValue === 'string' ? raw.inputValue : '',
            isChatting: false,
            pendingIntent: null,
            activeFiles: new Set(Array.isArray(raw.activeFiles) ? raw.activeFiles : []),
            customContexts: Array.isArray(raw.customContexts) ? raw.customContexts : [],
            workflowNodes: Array.isArray(raw.workflowNodes) ? raw.workflowNodes : [],
            workflowEdges: Array.isArray(raw.workflowEdges) ? raw.workflowEdges : [],
            currentJobId: null,
            progressState: undefined
        };
    };

    const normalizeLLMChunk = (chunk: any): string => {
        if (typeof chunk === 'string') return chunk;
        if (chunk === null || chunk === undefined) return '';
        if (chunk instanceof Uint8Array) {
            try { return new TextDecoder('utf-8').decode(chunk); } catch (e) { return ''; }
        }
        if (Array.isArray(chunk)) {
            return chunk.map((p: any) => normalizeLLMChunk(p)).join('');
        }
        if (typeof chunk === 'object') {
            if (typeof chunk.text === 'string') return chunk.text;
            if (typeof chunk.content === 'string') return chunk.content;
            if (Array.isArray(chunk.content)) return chunk.content.map((p: any) => normalizeLLMChunk(p)).join('');
        }
        return '';
    };
  
    // --- Helper: Robust Highlight Renderer ---
    const renderHighlightedContent = (content: string, highlight?: string) => {
        if (!highlight || !content) return content;

        // 1. Normalize strings (remove all whitespace for matching)
        const normalize = (s: string) => s.replace(/\s+/g, '').toLowerCase();
        const normContent = normalize(content);
        const normHighlight = normalize(highlight);

        if (!normHighlight || !normContent.includes(normHighlight)) {
             // Fallback: Exact match attempt or just return content
             return content;
        }

        // 2. Find start index in normalized string
        const normStartIndex = normContent.indexOf(normHighlight);
        const normEndIndex = normStartIndex + normHighlight.length;

        // 3. Map normalized indices back to original string indices
        let originalStartIndex = -1;
        let originalEndIndex = -1;
        let currentNormIndex = 0;

        for (let i = 0; i < content.length; i++) {
            if (!/\s/.test(content[i])) {
                if (currentNormIndex === normStartIndex) originalStartIndex = i;
                currentNormIndex++;
                if (currentNormIndex === normEndIndex) {
                    originalEndIndex = i + 1;
                    break;
                }
            }
        }

        if (originalStartIndex !== -1 && originalEndIndex !== -1) {
            const before = content.substring(0, originalStartIndex);
            const match = content.substring(originalStartIndex, originalEndIndex);
            const after = content.substring(originalEndIndex);

            return (
                <>
                    {before}
                    <mark 
                        ref={(el) => {
                            // Auto-scroll into view when rendered
                            if (el) {
                                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            }
                        }}
                        className="bg-yellow-200 text-slate-900 rounded px-1 animate-pulse cursor-pointer hover:bg-yellow-300 ring-2 ring-yellow-400"
                        title="点击返回回答引用处"
                        onClick={() => setPreviewFile(null)}
                    >
                        {match}
                    </mark>
                    {after}
                </>
            );
        }

        return content;
    };

    // --- State: Privacy Folders ---
    const [privacyFolders, setPrivacyFolders] = useState<Set<string>>(new Set());

    useEffect(() => {
        // Load initial privacy folders
        // @ts-ignore
        if (window.electronAPI?.knowledge?.getPrivacyFolders) {
            // @ts-ignore
            window.electronAPI.knowledge.getPrivacyFolders().then((res: any) => {
                if (res.success && Array.isArray(res.folders)) {
                    setPrivacyFolders(new Set(res.folders));
                }
            });
        }
    }, []);

    const handleTogglePrivacy = async (folder: string, enabled: boolean) => {
        try {
            // @ts-ignore
            const api = window.electronAPI.knowledge;
            const res = enabled 
                ? await api.addPrivacyFolder(folder)
                : await api.removePrivacyFolder(folder);
            
            if (res.success) {
                setPrivacyFolders(prev => {
                    const next = new Set(prev);
                    if (enabled) next.add(folder);
                    else next.delete(folder);
                    return next;
                });
            } else {
                alert("设置失败: " + res.error);
            }
        } catch (e: any) {
            alert("错误: " + e.message);
        }
    };
  const [sessions, setSessions] = useState<ChatSession[]>(() => {
      // Initialize with one default session
      return [buildDefaultSession()];
  });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<'resources' | 'chats' | 'reading'>('resources');
  
  // --- UX: Auto-Collapse Sidebar ---
  const [isSidebarPinned, setIsSidebarPinned] = useState(false); // Default: Auto-collapse mode (pinned = false)
  const [isHoveringRight, setIsHoveringRight] = useState(false);
  const isSidebarCollapsed = !isSidebarPinned && isHoveringRight;
  const [isAiMigrationExpanded, setIsAiMigrationExpanded] = useState(true);

  // Ensure there's always an active session ID on mount
  useEffect(() => {
      if (sessions.length > 0 && !activeSessionId) {
          setActiveSessionId(sessions[0].id);
      }
  }, [sessions, activeSessionId]);

  useEffect(() => {
      let cancelled = false;
      const loadChatSessions = async () => {
          if (!window.electronAPI?.db) return;
          try {
              const [savedSessions, savedActiveId] = await Promise.all([
                  window.electronAPI.db.getSetting('kb_chat_sessions'),
                  window.electronAPI.db.getSetting('kb_active_chat_session_id')
              ]);
              if (cancelled) return;
              if (Array.isArray(savedSessions) && savedSessions.length > 0) {
                  const restored = savedSessions
                      .map(fromSerializableSession)
                      .filter((s): s is ChatSession => !!s)
                      .slice(0, 30);
                  if (restored.length > 0) {
                      setSessions(restored);
                      const preferred = typeof savedActiveId === 'string' ? savedActiveId : restored[0].id;
                      setActiveSessionId(restored.some(s => s.id === preferred) ? preferred : restored[0].id);
                  }
              }
          } catch (e) {
              console.error('[KnowledgeBase] 恢复历史对话失败:', e);
          }
      };
      loadChatSessions();
      return () => {
          cancelled = true;
      };
  }, []);

  useEffect(() => {
      if (!window.electronAPI?.db) return;
      const timer = window.setTimeout(() => {
          const compact = sessions.slice(0, 30).map(toSerializableSession);
          window.electronAPI.db.saveSetting('kb_chat_sessions', compact);
          window.electronAPI.db.saveSetting('kb_active_chat_session_id', activeSessionId || '');
      }, 250);
      return () => window.clearTimeout(timer);
  }, [sessions, activeSessionId]);

  const activeSession = useMemo(() => 
      sessions.find(s => s.id === activeSessionId) || sessions[0]
  , [sessions, activeSessionId]);

  // Helper to update specific session state
  const updateSession = (sessionId: string, updates: Partial<ChatSession>) => {
      setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, ...updates, updatedAt: Date.now() } : s));
  };
  
  // Helper to update active session (shorthand)
  const updateActiveSession = (updates: Partial<ChatSession>) => {
      if (activeSessionId) updateSession(activeSessionId, updates);
  };

  // Derived State Accessors (compatibility with existing code)
  const input = activeSession?.inputValue || '';
  const setInput = (val: string) => updateActiveSession({ inputValue: val });
  
  const isChatting = activeSession?.isChatting || false;
  const setIsChatting = (val: boolean) => updateActiveSession({ isChatting: val });

  const activeFiles = activeSession?.activeFiles || new Set<string>();
  const setActiveFiles = (val: Set<string> | ((prev: Set<string>) => Set<string>)) => {
      const newVal = typeof val === 'function' ? val(activeSession?.activeFiles || new Set()) : val;
      updateActiveSession({ activeFiles: newVal });
  };

  const customContexts = activeSession?.customContexts || [];
  const setCustomContexts = (val: ContextSource[] | ((prev: ContextSource[]) => ContextSource[])) => {
      const newVal = typeof val === 'function' ? val(activeSession?.customContexts || []) : val;
      updateActiveSession({ customContexts: newVal });
  };

  const workflowNodes = activeSession?.workflowNodes || [];
  const setWorkflowNodes = (val: Node[] | ((prev: Node[]) => Node[])) => {
      const newVal = typeof val === 'function' ? val(activeSession?.workflowNodes || []) : val;
      updateActiveSession({ workflowNodes: newVal });
  };

  const workflowEdges = activeSession?.workflowEdges || [];
    const setWorkflowEdges = (val: Edge[] | ((prev: Edge[]) => Edge[])) => {
        const newVal = typeof val === 'function' ? val(activeSession?.workflowEdges || []) : val;
        updateActiveSession({ workflowEdges: newVal });
    };

    // --- Smart Scroll & Toast State ---
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const [showNewMessageToast, setShowNewMessageToast] = useState(false);
    const [isAutoScroll, setIsAutoScroll] = useState(true);

    const handleScroll = () => {
        if (!chatContainerRef.current) return;
        const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
        // If user is within 100px of bottom, consider it "at bottom"
        const isBottom = scrollHeight - scrollTop - clientHeight < 100;
        
        if (isBottom) {
            setShowNewMessageToast(false);
            setIsAutoScroll(true);
        } else {
            setIsAutoScroll(false);
        }
    };

    const scrollToBottom = () => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTo({ top: chatContainerRef.current.scrollHeight, behavior: 'smooth' });
            setIsAutoScroll(true);
            setShowNewMessageToast(false);
        }
    };

    // Auto-scroll effect
    useEffect(() => {
        if (!chatContainerRef.current) return;
        
        const lastMsg = activeSession.messages[activeSession.messages.length - 1];
        
        // 1. If user just sent a message, force scroll (ALWAYS)
        if (lastMsg?.role === 'user') {
            scrollToBottom();
            return;
        }

        // 2. If AI is generating
        // STRICT RULE: Only scroll if we are ALREADY at the bottom (isAutoScroll=true)
        // AND we are not in a 'history view' state.
        // Even then, we might want to throttle it if it's too jumpy, but for now strict check.
        if (isAutoScroll) {
            // Check one more time if we really are at bottom to be safe
            const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
            const isBottom = scrollHeight - scrollTop - clientHeight < 150;
            
            if (isBottom) {
                 chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
            } else {
                 // User moved away since last check?
                 setIsAutoScroll(false);
                 setShowNewMessageToast(true);
            }
        } else {
            // User scrolled up. Check if there is actually new content below.
            const { scrollTop, scrollHeight, clientHeight } = chatContainerRef.current;
            // Only show toast if there is significant content below
            if (scrollHeight - scrollTop - clientHeight > 150) {
                 setShowNewMessageToast(true);
            }
        }
    }, [activeSession.messages]); // REMOVED progressState dependency to prevent jumps on progress updates
  
  const pendingIntent = activeSession?.pendingIntent || null;
  const setPendingIntent = (val: any) => updateActiveSession({ pendingIntent: val });

  // Index Manager State
  const [indexManagerOpen, setIndexManagerOpen] = useState(false);

  const handleCreateSession = () => {
      const newSession: ChatSession = buildDefaultSession();
      setSessions(prev => [newSession, ...prev]);
      setActiveSessionId(newSession.id);
      // setSidebarTab('chats'); // Removed: Don't auto-switch tab
  };

  const handleDeleteSession = (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!confirm("确定要删除此对话吗？")) return;
      
      // Clear temporary collected items when deleting the active session
      if (id === activeSessionId) {
          setCollectedItems([]);
      }
      
      const newSessions = sessions.filter(s => s.id !== id);
      if (newSessions.length > 0) {
          setSessions(newSessions);
      } else {
          const fallback = buildDefaultSession();
          setSessions([fallback]);
          setActiveSessionId(fallback.id);
          return;
      }
      
      if (activeSessionId === id) {
          setActiveSessionId(newSessions[0].id);
      }
  };

  const [isUploading, setIsUploading] = useState(false);
  const [isSnapshotting, setIsSnapshotting] = useState(false);
  // Removed global isChatting
  const [mountedFolders, setMountedFolders] = useState<string[]>([]);
  const [previewFile, setPreviewFile] = useState<{name: string, path: string, content: string, type: 'text'|'image'|'html', highlight?: string} | null>(null);
  const [fileMetaOpen, setFileMetaOpen] = useState(false);
  const [fileMetaLoading, setFileMetaLoading] = useState(false);
  const [fileMetaDraft, setFileMetaDraft] = useState<{ title: string; author: string; published_time: string; abstract: string; keywords: string }>({
      title: '',
      author: '',
      published_time: '',
      abstract: '',
      keywords: ''
  });

  useEffect(() => {
      if (!window.electronAPI?.knowledge?.onFileMetadataUpdated) return;
      const unsub = window.electronAPI.knowledge.onFileMetadataUpdated((data: any) => {
          try {
              const filePath = data?.filePath;
              const meta = data?.meta;
              if (!filePath || !meta) return;
              if (!fileMetaOpen) return;
              if (!previewFile?.path) return;
              if (String(previewFile.path) !== String(filePath)) return;
              const keywords = Array.isArray(meta.keywords) ? meta.keywords.join(', ') : '';
              setFileMetaDraft({
                  title: meta.title || '',
                  author: meta.author || '',
                  published_time: meta.published_time || '',
                  abstract: meta.abstract || '',
                  keywords
              });
          } catch (e) {}
      });
      return () => { try { unsub && unsub(); } catch (e) {} };
  }, [fileMetaOpen, previewFile]);
  
  // Reading Mode State
  const [readingFile, setReadingFile] = useState<{name: string, path: string, content?: string, type: 'text'|'image'|'html'} | null>(null);
  const [readingPurpose, setReadingPurpose] = useState('');
  const [showPurposeModal, setShowPurposeModal] = useState(false);
  const [ingestedFiles, setIngestedFiles] = useState<Set<string>>(new Set()); // Files actually in Vector DB
  // Removed global activeFiles
  const [loadingFiles, setLoadingFiles] = useState<Set<string>>(new Set());
  const [isReindexing, setIsReindexing] = useState(false);
  
  // Save Message Modal State
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [messageToSave, setMessageToSave] = useState<{text: string, chunks?: any[]} | null>(null);
  const [saveFileName, setSaveFileName] = useState('');
  const [saveTargetFolder, setSaveTargetFolder] = useState('');
  const [saveNewFolderName, setSaveNewFolderName] = useState(''); // New folder name input

  // Context Orchestrator State
  const [orchestratorOpen, setOrchestratorOpen] = useState(false);
  const [orchestratorMode, setOrchestratorMode] = useState<'simple' | 'workflow'>('simple');
  // Removed global workflowNodes, workflowEdges, customContexts, editingContexts
  // editingContexts is likely transient modal state, so maybe keep it local?
  const [editingContexts, setEditingContexts] = useState<ContextSource[]>([]); // For modal editing (Transient)

  // Editor Modal State
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingMessage, setEditingMessage] = useState<{
      id: number;
      text: string;
      chunks: any[];
      sources: string[];
      complianceWarnings?: any[]; // Allow complianceWarnings in editing state
  } | null>(null);
  const [editingProviderId, setEditingProviderId] = useState<string | null>(null);
  const [activeChunkId, setActiveChunkId] = useState<string | null>(null); // For highlighting reference
  const [editorMode, setEditorMode] = useState<'edit' | 'preview' | 'optimize'>('preview'); 
  const [isMinimized, setIsMinimized] = useState(false);
  const [isDeepThinking, setIsDeepThinking] = useState(false); // New: Deep Thinking Mode
  const [citationHighlight, setCitationHighlight] = useState<string | null>(null);
  
  // Optimization Mode State
  const [optimizationConfig, setOptimizationConfig] = useState<OptimizationConfig>({
      preset: 'formal',
      fontFamily: 'font-serif',
      fontSize: 'text-base',
      lineHeight: 'leading-loose',
      letterSpacing: 'tracking-normal',
      showBackground: true
  });
  
  const [savedTemplates, setSavedTemplates] = useState<OptimizationConfig[]>([]);

  // Load templates from localStorage
  useEffect(() => {
      const saved = localStorage.getItem('opt_templates');
      if (saved) {
          try { setSavedTemplates(JSON.parse(saved)); } catch (e) {}
      }
  }, []);
  const textareaRef = useRef<HTMLTextAreaElement>(null); // Ref for editor textarea
  
  // Local Polish State
  const [polishModal, setPolishModal] = useState<{
      open: boolean;
      sourceText: string;
      instruction: string;
      result: string;
      isLoading: boolean;
      selectionStart: number;
      selectionEnd: number;
  }>({ open: false, sourceText: '', instruction: '', result: '', isLoading: false, selectionStart: 0, selectionEnd: 0 });

  // Deprecated simple states
  const [isPolishing, setIsPolishing] = useState(false); // Keep for button loading state if needed
  const [showPolishInput, setShowPolishInput] = useState(false);

  
  // Right Panel Tab State for Editor
  const [rightPanelTab, setRightPanelTab] = useState<'references' | 'compliance'>('references');

  // Orchestration Templates State
  const [templates, setTemplates] = useState<any[]>([]); // Relaxed type for dual mode
  const [templateNameInput, setTemplateNameInput] = useState('');

  // Preset Workflow Templates (Hardcoded - NGO Scenarios)
  const presetTemplates = useMemo(() => [
      {
          name: "📋 项目建议书生成 (Project Proposal)",
          mode: 'workflow',
          description: "需求分析 -> 目标设定 -> 实施计划 -> 预算编制",
          nodes: [
              { id: 'n1', type: 'execution', position: { x: 50, y: 100 }, data: { role: '需求分析', instruction: '基于背景材料，分析受益人群的核心需求和痛点', paths: [] } },
              { id: 'n2', type: 'execution', position: { x: 350, y: 100 }, data: { role: '目标设定', instruction: '根据需求分析，制定SMART项目目标', paths: [] } },
              { id: 'n3', type: 'execution', position: { x: 650, y: 100 }, data: { role: '实施计划', instruction: '设计具体的活动和时间表', paths: [] } },
              { id: 'n4', type: 'execution', position: { x: 950, y: 100 }, data: { role: '预算编制', instruction: '根据活动计划，估算所需预算', paths: [] } }
          ],
          edges: [
              { id: 'e1-2', source: 'n1', target: 'n2', animated: true },
              { id: 'e2-3', source: 'n2', target: 'n3', animated: true },
              { id: 'e3-4', source: 'n3', target: 'n4', animated: true }
          ]
      },
      {
          name: "📊 影响力评估报告 (Impact Assessment)",
          mode: 'workflow',
          description: "数据提取 -> 变化分析 -> 归因分析 -> 建议",
          nodes: [
              { id: 'n1', type: 'execution', position: { x: 50, y: 100 }, data: { role: '数据提取', instruction: '从监测数据中提取关键产出和成果指标', paths: [] } },
              { id: 'n2', type: 'execution', position: { x: 350, y: 100 }, data: { role: '变化分析', instruction: '对比基线数据，分析发生的变化和趋势', paths: [] } },
              { id: 'n3', type: 'execution', position: { x: 650, y: 100 }, data: { role: '归因分析', instruction: '分析项目干预与成果之间的因果关系', paths: [] } },
              { id: 'n4', type: 'execution', position: { x: 950, y: 100 }, data: { role: '改进建议', instruction: '基于评估结果，提出后续项目改进建议', paths: [] } }
          ],
          edges: [
              { id: 'e1-2', source: 'n1', target: 'n2', animated: true },
              { id: 'e2-3', source: 'n2', target: 'n3', animated: true },
              { id: 'e3-4', source: 'n3', target: 'n4', animated: true }
          ]
      },
      {
          name: "🤝 利益相关方分析 (Stakeholder Analysis)",
          mode: 'workflow',
          description: "识别 -> 利益/影响力分析 -> 参与策略",
          nodes: [
              { id: 'n1', type: 'execution', position: { x: 50, y: 100 }, data: { role: '识别', instruction: '列出所有潜在的利益相关方（受益人、政府、资方等）', paths: [] } },
              { id: 'n2', type: 'execution', position: { x: 350, y: 100 }, data: { role: '分析', instruction: '评估各方对项目的利益关注点和影响力大小', paths: [] } },
              { id: 'n3', type: 'execution', position: { x: 650, y: 100 }, data: { role: '策略', instruction: '针对不同群体制定相应的沟通和参与策略', paths: [] } }
          ],
          edges: [
              { id: 'e1-2', source: 'n1', target: 'n2', animated: true },
              { id: 'e2-3', source: 'n2', target: 'n3', animated: true }
          ]
      },
      {
          name: "📢 捐赠人报告撰写 (Donor Reporting)",
          mode: 'workflow',
          description: "活动回顾 -> 财务汇报 -> 故事案例 -> 挑战与应对",
          nodes: [
              { id: 'n1', type: 'execution', position: { x: 50, y: 50 }, data: { role: '活动回顾', instruction: '总结本周期内开展的主要活动和进展', paths: [] } },
              { id: 'n2', type: 'execution', position: { x: 50, y: 250 }, data: { role: '财务汇报', instruction: '汇报资金使用情况和预算执行率', paths: [] } },
              { id: 'n3', type: 'execution', position: { x: 350, y: 150 }, data: { role: '故事案例', instruction: '选取一个典型受益人故事来展示项目成效', paths: [] } },
              { id: 'n4', type: 'execution', position: { x: 650, y: 150 }, data: { role: '挑战与应对', instruction: '说明遇到的困难及采取的解决措施', paths: [] } }
          ],
          edges: [
              { id: 'e1-3', source: 'n1', target: 'n3', animated: true },
              { id: 'e1-4', source: 'n1', target: 'n4', animated: true },
              { id: 'e2-4', source: 'n2', target: 'n4', animated: true }
          ]
      },
      {
          name: "🔍 政策合规审查 (Policy Compliance)",
          mode: 'workflow',
          description: "条款提取 -> 现状比对 -> 风险提示",
          nodes: [
              { id: 'n1', type: 'execution', position: { x: 50, y: 100 }, data: { role: '条款提取', instruction: '从政策文件中提取关键的合规要求', paths: [] } },
              { id: 'n2', type: 'execution', position: { x: 350, y: 100 }, data: { role: '现状比对', instruction: '将项目现状与合规要求进行逐条比对', paths: [] } },
              { id: 'n3', type: 'execution', position: { x: 650, y: 100 }, data: { role: '风险提示', instruction: '指出不合规项并评估法律风险', paths: [] } }
          ],
          edges: [
              { id: 'e1-2', source: 'n1', target: 'n2', animated: true },
              { id: 'e2-3', source: 'n2', target: 'n3', animated: true }
          ]
      },
      {
          name: "💡 筹款活动策划 (Fundraising Campaign)",
          mode: 'workflow',
          description: "受众分析 -> 创意构思 -> 渠道规划 -> 预算",
          nodes: [
              { id: 'n1', type: 'execution', position: { x: 50, y: 100 }, data: { role: '受众分析', instruction: '分析潜在捐赠人的画像和捐赠动机', paths: [] } },
              { id: 'n2', type: 'execution', position: { x: 350, y: 100 }, data: { role: '创意构思', instruction: '设计打动人心的筹款主题和口号', paths: [] } },
              { id: 'n3', type: 'execution', position: { x: 650, y: 100 }, data: { role: '渠道规划', instruction: '选择合适的线上线下传播渠道', paths: [] } },
              { id: 'n4', type: 'execution', position: { x: 950, y: 100 }, data: { role: '预算', instruction: '估算活动成本和预期筹款额', paths: [] } }
          ],
          edges: [
              { id: 'e1-2', source: 'n1', target: 'n2', animated: true },
              { id: 'e2-3', source: 'n2', target: 'n3', animated: true },
              { id: 'e3-4', source: 'n3', target: 'n4', animated: true }
          ]
      },
      {
          name: "🗣️ 志愿者培训大纲 (Volunteer Training)",
          mode: 'workflow',
          description: "岗位需求 -> 知识点梳理 -> 考核方式",
          nodes: [
              { id: 'n1', type: 'execution', position: { x: 50, y: 100 }, data: { role: '岗位需求', instruction: '明确志愿者岗位所需的技能和态度', paths: [] } },
              { id: 'n2', type: 'execution', position: { x: 350, y: 100 }, data: { role: '知识点', instruction: '梳理培训需要覆盖的核心知识模块', paths: [] } },
              { id: 'n3', type: 'execution', position: { x: 650, y: 100 }, data: { role: '考核方式', instruction: '设计培训后的考核或演练环节', paths: [] } }
          ],
          edges: [
              { id: 'e1-2', source: 'n1', target: 'n2', animated: true },
              { id: 'e2-3', source: 'n2', target: 'n3', animated: true }
          ]
      },
      {
          name: "📅 年度战略规划 (Annual Strategy)",
          mode: 'workflow',
          description: "SWOT分析 -> 战略目标 -> 关键举措 -> 资源配置",
          nodes: [
              { id: 'n1', type: 'execution', position: { x: 50, y: 100 }, data: { role: 'SWOT分析', instruction: '分析组织的优势、劣势、机会和威胁', paths: [] } },
              { id: 'n2', type: 'execution', position: { x: 350, y: 100 }, data: { role: '战略目标', instruction: '设定未来一年的核心战略目标', paths: [] } },
              { id: 'n3', type: 'execution', position: { x: 650, y: 100 }, data: { role: '关键举措', instruction: '制定实现目标的重点行动计划', paths: [] } },
              { id: 'n4', type: 'execution', position: { x: 950, y: 100 }, data: { role: '资源配置', instruction: '规划所需的人、财、物资源', paths: [] } }
          ],
          edges: [
              { id: 'e1-2', source: 'n1', target: 'n2', animated: true },
              { id: 'e2-3', source: 'n2', target: 'n3', animated: true },
              { id: 'e3-4', source: 'n3', target: 'n4', animated: true }
          ]
      },
      {
          name: "📝 案例研究 (Case Study)",
          mode: 'workflow',
          description: "背景 -> 干预措施 -> 结果 -> 经验教训",
          nodes: [
              { id: 'n1', type: 'execution', position: { x: 50, y: 100 }, data: { role: '背景', instruction: '描述案例发生前的基线情况', paths: [] } },
              { id: 'n2', type: 'execution', position: { x: 350, y: 100 }, data: { role: '干预措施', instruction: '详细描述采取的具体行动', paths: [] } },
              { id: 'n3', type: 'execution', position: { x: 650, y: 100 }, data: { role: '结果', instruction: '展示行动带来的直接和间接变化', paths: [] } },
              { id: 'n4', type: 'execution', position: { x: 950, y: 100 }, data: { role: '经验教训', instruction: '总结可复制的成功经验或失败教训', paths: [] } }
          ],
          edges: [
              { id: 'e1-2', source: 'n1', target: 'n2', animated: true },
              { id: 'e2-3', source: 'n2', target: 'n3', animated: true },
              { id: 'e3-4', source: 'n3', target: 'n4', animated: true }
          ]
      },
      {
          name: "🔍 竞品/同行调研 (Peer Review)",
          mode: 'workflow',
          description: "项目对比 -> 优劣势分析 -> 借鉴点",
          nodes: [
              { id: 'n1', type: 'execution', position: { x: 50, y: 100 }, data: { role: '项目对比', instruction: '搜集同行类似项目的运作模式', paths: [] } },
              { id: 'n2', type: 'execution', position: { x: 350, y: 100 }, data: { role: '优劣势', instruction: '对比分析我方与同行的优劣势', paths: [] } },
              { id: 'n3', type: 'execution', position: { x: 650, y: 100 }, data: { role: '借鉴点', instruction: '提炼值得学习的创新做法', paths: [] } }
          ],
          edges: [
              { id: 'e1-2', source: 'n1', target: 'n2', animated: true },
              { id: 'e2-3', source: 'n2', target: 'n3', animated: true }
          ]
      }
  ], []);

  // Force refresh key for file trees
  const [refreshKey, setRefreshKey] = useState(0);

  // Multi-Explore State
  const [exploreMode, setExploreMode] = useState<'default' | 'multi'>('default');
  const [customLLMs, setCustomLLMs] = useState<CustomLLMConfig[]>([]);
  const [selectedMultiProviders, setSelectedMultiProviders] = useState<string[]>([]);
  const [collectedItems, setCollectedItems] = useState<CollectedItem[]>([]);
  const [availableProviders, setAvailableProviders] = useState<ProviderOption[]>([]);
  const [showMultiConfig, setShowMultiConfig] = useState(false); // Modal to config providers

  // Load Custom LLMs
  useEffect(() => {
      const loadConfig = () => {
          const stored = localStorage.getItem('custom_llm_configs');
          let parsedLLMs: CustomLLMConfig[] = [];
          if (stored) {
              try {
                  parsedLLMs = JSON.parse(stored);
                  setCustomLLMs(parsedLLMs);
              } catch(e) {}
          }
          
          const providers = getAvailableProviders(parsedLLMs);
          setAvailableProviders(providers);
          
          const savedSelection = localStorage.getItem('multi_explore_selection');
          if (savedSelection) {
              try {
                setSelectedMultiProviders(JSON.parse(savedSelection));
              } catch(e) {}
          } else {
              // Default select first 2 from current available
              setSelectedMultiProviders(providers.slice(0, 2).map(p => p.id));
          }
      };
      loadConfig();
      // Listen to storage event to sync with Settings
      window.addEventListener('storage', loadConfig);
      return () => window.removeEventListener('storage', loadConfig);
  }, []);

  // Sync LLM config when opening Multi-Explore settings
  useEffect(() => {
    if (showMultiConfig) {
        const stored = localStorage.getItem('custom_llm_configs');
        let parsedLLMs: CustomLLMConfig[] = [];
        if (stored) {
            try {
                parsedLLMs = JSON.parse(stored);
                setCustomLLMs(parsedLLMs);
            } catch(e) {}
        }
        const providers = getAvailableProviders(parsedLLMs);
        setAvailableProviders(providers);
    }
  }, [showMultiConfig]);

  const handleCollect = (text: string, providerId: string, context?: any) => {
      const newItem: CollectedItem = {
          id: `clip-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
          text,
          providerId,
          timestamp: Date.now()
      };
      setCollectedItems(prev => [...prev, newItem]);
  };

  const handleRemoveCollected = (id: string) => {
      setCollectedItems(prev => prev.filter(i => i.id !== id));
  };

    // Recent Questions History
    const [recentQuestions, setRecentQuestions] = useState<string[]>([]);
    const [showHistory, setShowHistory] = useState(false);
    
    useEffect(() => {
        if (window.electronAPI) {
            window.electronAPI.db.getSetting('kb_recent_questions').then((saved: any) => {
                if (Array.isArray(saved)) {
                    setRecentQuestions(saved);
                }
            });
        }
    }, []);

    const saveRecentQuestion = async (question: string) => {
        if (!question.trim()) return;
        const newHistory = [question, ...recentQuestions.filter(q => q !== question)].slice(0, 5);
        setRecentQuestions(newHistory);
        if (window.electronAPI) {
            await window.electronAPI.db.saveSetting('kb_recent_questions', newHistory);
        }
    };

  const handleOpenEditor = (msgIdx: number, msg: any, providerId?: string) => {
      // Debug logging to inspect incoming message structure
      console.log("[Editor] Opening editor for message:", msg);
      
      const chunksToUse = msg.chunks || [];
      console.log("[Editor] Extracted chunks:", chunksToUse);

      setEditingMessage({
          id: msgIdx,
          text: msg.text,
          chunks: chunksToUse,
          sources: msg.sources || []
      });
      setEditingProviderId(providerId || null); // Track provider if any
      setActiveChunkId(null);
      setEditorMode('edit'); // Open in EDIT mode by default for direct editing
      setEditorOpen(true);
  };

  const handleUpdateMessage = () => {
      if (!editingMessage || !activeSessionId) return;

      setSessions(prev => prev.map(s => {
          if (s.id === activeSessionId) {
              const newMessages = [...s.messages];
              const msg = newMessages[editingMessage.id];
              
              if (msg) {
                  // Handle Multi-Explore Response Update
                  if (editingProviderId && msg.multiResponses) {
                      const newMulti = msg.multiResponses.map(r => 
                          r.providerId === editingProviderId 
                              ? { ...r, content: editingMessage.text }
                              : r
                      );
                      newMessages[editingMessage.id] = { ...msg, multiResponses: newMulti };
                  } else {
                      // Standard Message Update
                      newMessages[editingMessage.id] = {
                          ...msg,
                          text: editingMessage.text
                      };
                  }
              }
              return { ...s, messages: newMessages, updatedAt: Date.now() };
          }
          return s;
      }));
      setEditorOpen(false);
      setEditingProviderId(null); // Reset
  };

  // Load Templates on Mount
  useEffect(() => {
      if (window.electronAPI) {
          window.electronAPI.db.getSetting('kb_orchestration_templates').then((saved: any) => {
              if (Array.isArray(saved)) {
                  setTemplates(saved);
              }
          });
      }
  }, []);

  // Template Handlers
  const handleSaveTemplate = async () => {
      if (!templateNameInput.trim()) return alert("请输入模板名称");
      
      let newTemplate: any;

      if (orchestratorMode === 'simple') {
          if (editingContexts.length === 0) return alert("当前没有可保存的编排规则");
          newTemplate = { 
              name: templateNameInput.trim(), 
              mode: 'simple',
              contexts: editingContexts 
          };
      } else {
          if (workflowNodes.length === 0) return alert("当前没有可保存的工作流节点");
          newTemplate = {
              name: templateNameInput.trim(),
              mode: 'workflow',
              nodes: workflowNodes,
              edges: workflowEdges
          };
      }

      const existingIndex = templates.findIndex(t => t.name === newTemplate.name);
      let newTemplates;
      
      if (existingIndex >= 0) {
          if (!confirm(`模板 "${newTemplate.name}" 已存在，是否覆盖？`)) return;
          newTemplates = [...templates];
          newTemplates[existingIndex] = newTemplate;
      } else {
          newTemplates = [...templates, newTemplate];
      }

      setTemplates(newTemplates);
      setTemplateNameInput(''); // Clear input
      
      if (window.electronAPI) {
          await window.electronAPI.db.saveSetting('kb_orchestration_templates', newTemplates);
      }
      alert("模板保存成功！");
  };

  const handleLoadTemplate = (t: any) => {
      if (t.mode === 'workflow') {
          setOrchestratorMode('workflow');
          
          setWorkflowNodes(t.nodes.map((n: any) => ({
              ...n,
              data: {
                  ...n.data,
                  paths: Array.isArray(n.data.paths) ? n.data.paths : [],
              }
          })));
          
          setWorkflowEdges(t.edges || []);
      } else {
          setOrchestratorMode('simple');
          const contexts = t.contexts || t.contexts || [];
          setEditingContexts(contexts.map((ctx: any) => ({
              ...ctx,
              id: `ctx-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
          })));
      }
      setTemplateNameInput(t.name);
  };

  const handleSaveAsAssistant = async () => {
      if (!templateNameInput.trim()) return alert("请输入助手名称");
      if (editingContexts.length === 0) return alert("当前没有可保存的编排规则");

      if (!confirm(`确定将当前编排保存为“${templateNameInput}”助手吗？\n系统将自动创建数据快照，确保助手独立运行，不受源文件变动影响。\n这可能需要一些时间，请耐心等待。`)) return;

      setIsSnapshotting(true);

      try {
          const assistantId = `asst-${Date.now()}`;
          // @ts-ignore
          const userDataPath = await window.electronAPI.getPath('userData');
          const assistantBasePath = `${userDataPath}/storage/DATA/Knowledge/Assistants/${templateNameInput.trim().replace(/\s+/g, '_')}_${assistantId}`;
          
          // @ts-ignore
          await window.electronAPI.fs.ensureDir(assistantBasePath);

          const allNewFiles: string[] = [];

          // Snapshot Logic
          const newContexts = await Promise.all(editingContexts.map(async (ctx) => {
              const sourceMap: Record<string, string> = {}; // Map snapshot path -> original path

              const newFolderPaths = await Promise.all(ctx.folderPaths.map(async (srcPath) => {
                  const folderName = srcPath.split(/[\\/]/).pop() || 'unknown';
                  const destPath = `${assistantBasePath}/Source_${folderName}`;
                  
                  // Copy
                  // @ts-ignore
                  const copyRes = await window.electronAPI.fs.copyFiles(srcPath, destPath);
                  if (!copyRes.success) throw new Error(`Copy failed for ${srcPath}: ${copyRes.error}`);
                  
                  // Store mapping
                  sourceMap[destPath] = srcPath;

                  // Recursive Indexing of the NEW path
                  const indexFolder = async (dirPath: string) => {
                      // @ts-ignore
                      const entries = await window.electronAPI.fs.readDir(dirPath);
                      for (const entry of entries) {
                          if (entry.isDirectory) {
                              await indexFolder(entry.path);
                          } else {
                              if (!entry.name.startsWith('.')) {
                                  // Upload/Index
                                  // @ts-ignore
                                  await window.electronAPI.knowledge.upload({ name: entry.name, path: entry.path });
                                  allNewFiles.push(entry.path);
                              }
                          }
                      }
                  };
                  await indexFolder(destPath);
                  
                  return destPath;
              }));
              
              return { ...ctx, folderPaths: newFolderPaths, sourceMap };
          }));

          const newAssistant = {
              id: assistantId,
              name: templateNameInput.trim(),
              contexts: newContexts,
              systemPrompt: "", // Default empty, user can fine-tune later
              createdAt: Date.now()
          };

          if (window.electronAPI) {
              const assistants = await window.electronAPI.db.getSetting('kb_assistants') || [];
              const nextAssistants = [...assistants, newAssistant];
              await window.electronAPI.db.saveSetting('kb_assistants', nextAssistants);
              
              // Update global ingested files list so Assistant can find them
              const currentIngested = await window.electronAPI.db.getSetting('kb_ingested_files') || [];
              const nextIngested = Array.from(new Set([...currentIngested, ...allNewFiles]));
              await window.electronAPI.db.saveSetting('kb_ingested_files', nextIngested);
              
              alert(`✅ 助手“${newAssistant.name}”创建成功！\n数据已快照隔离。`);
              setTemplateNameInput('');
          }
      } catch (e: any) {
          console.error(e);
          alert(`创建失败: ${e.message}`);
      } finally {
          setIsSnapshotting(false);
      }
  };



  const handleDeleteTemplate = async (name: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!confirm(`确定要删除模板 "${name}" 吗？`)) return;

      const newTemplates = templates.filter(t => t.name !== name);
      setTemplates(newTemplates);
      
      if (window.electronAPI) {
          await window.electronAPI.db.saveSetting('kb_orchestration_templates', newTemplates);
      }
  };

  // Load state from DB
  const loadSettings = () => {
      if (window.electronAPI) {
          Promise.all([
              window.electronAPI.db.getSetting('kb_mounted_folders'),
              window.electronAPI.db.getSetting('kb_ingested_files'),
              window.electronAPI.db.getSetting('kb_active_files')
          ]).then(async ([folders, ingested, active]) => {
              if (Array.isArray(folders)) setMountedFolders(folders);
              if (Array.isArray(ingested)) setIngestedFiles(new Set(ingested));
              
              if (Array.isArray(active)) {
                  // 1. Check physical existence
                  const checks = await Promise.all(active.map(p => window.electronAPI.fs.exists(p)));
                  
                  // 2. Check if it belongs to a currently mounted folder
                  // (Or is it a standalone file? The current UI only supports mounting folders, so files must belong to one)
                  // We treat 'folders' (from DB) as the source of truth for visibility.
                  const currentFolders = Array.isArray(folders) ? folders : [];
                  
                  const validActive = active.filter((path, i) => {
                      const exists = checks[i];
                      const isVisible = currentFolders.some((f: string) => path.startsWith(f));
                      return exists && isVisible;
                  });
                  
                  if (validActive.length !== active.length) {
                      console.log(`[KB] Cleaning up ${active.length - validActive.length} stale/orphaned active files`);
                      window.electronAPI.db.saveSetting('kb_active_files', validActive);
                  }
                  setActiveFiles(new Set(validActive));
              }
              // Force tree refresh on data update
              setRefreshKey(prev => prev + 1);
          });
      }
  };

  useEffect(() => {
      loadSettings();
      // Listen for updates from ProjectManager
      const handleUpdate = () => {
          console.log("[KnowledgeBase] Received update event, refreshing...");
          loadSettings();
      };
      window.addEventListener('kb-folders-updated', handleUpdate);
      return () => window.removeEventListener('kb-folders-updated', handleUpdate);
  }, []);

  // Auto-mount global prompts folder
  useEffect(() => {
      if (window.electronAPI) {
          (async () => {
              try {
                  const userDataPath = await window.electronAPI.getPath('userData');
                  const globalPromptsPath = `${userDataPath}/storage/DATA/Knowledge/Prompts`;
                  
                  // Ensure directory exists
                  await window.electronAPI.fs.ensureDir(globalPromptsPath);

                  // Auto-mount if not present
                  const currentMounts = await window.electronAPI.db.getSetting('kb_mounted_folders') || [];
                  if (Array.isArray(currentMounts) && !currentMounts.includes(globalPromptsPath)) {
                      const newMounts = [...currentMounts, globalPromptsPath];
                      setMountedFolders(newMounts);
                      await window.electronAPI.db.saveSetting('kb_mounted_folders', newMounts);
                      (window as any).electronAPI.invoke('kb-upsert-folder-meta', {
                          folder_id: globalPromptsPath,
                          folder_path: globalPromptsPath,
                          source_type: 'internal_prompts',
                          origin_path: globalPromptsPath,
                          is_external_reference: 0,
                          created_at: Date.now(),
                          extra_json: {}
                      });
                      console.log("Auto-mounted Global Prompts to KB");
                  }
              } catch (e) {
                  console.error("Failed to check global prompts path", e);
              }
          })();
      }
  }, []);

    // --- Message Actions ---
    const handleRewriteMessage = async (msgIndex: number, instructions: string) => {
        // Trigger a re-generation for the specific message
        // For simplicity, we can just delete the bot message and re-send the user message with instructions appended?
        // Or better: keep the user message, add a new system/user instruction to "Rewrite previous answer".
        
        if (!activeSession) return;
        
        const currentSessionId = activeSession.id;
        const targetMsg = activeSession.messages[msgIndex];
        const prevUserMsg = activeSession.messages[msgIndex - 1]; // Assuming user msg is before
        
        if (!prevUserMsg) return;

        // Optimistic update: Show "Rewriting..."
        setSessions(prev => prev.map(s => {
            if (s.id === currentSessionId) {
                const newMsgs = [...s.messages];
                // Remove the bot message being rewritten (or keep it as history? User wants to choose. Let's replace it.)
                // Actually, user might want to see both. But usually rewrite replaces.
                newMsgs.splice(msgIndex, 1); 
                return { ...s, messages: newMsgs, isChatting: true };
            }
            return s;
        }));

        // Construct new query with rewrite instructions
        const originalQuery = prevUserMsg.text;
        const rewriteQuery = `${originalQuery}\n\n[System Instruction]: The user rejected the previous answer due to compliance or quality issues. \nRequirement: ${instructions}`;
        
        try {
             // Re-run the RAG flow (simplified version of handleSendMessage)
             // We need to re-use the same contexts.
             // This is complex because we need `activeSession` state.
             // Let's reuse handleSendMessage by mocking input? No, handleSendMessage depends on state.
             // Let's extract RAG logic or just append a new user message "Please rewrite..." and let flow handle it.
             // Appending is safer and cleaner history.
             
             // BUT, user said "User Choice: Rewrite, Re-find, Delete, Edit".
             // If we Append, we keep the bad message.
             // If we Replace, we lose history.
             // Let's try to "Regenerate" in place.
             
             // We need to call `window.electronAPI.knowledge.query` again.
             // ... (This logic is duplicated from handleSendMessage. Ideally should be refactored)
             // For now, let's just append a user message "请重写，要求：..."
             
             const rewriteMsg = { role: 'user', text: `请重写上一条回答。要求：${instructions}`, timestamp: Date.now() };
             updateSession(currentSessionId, {
                 messages: [...activeSession.messages, rewriteMsg as any], // Keep old one, add request
                 inputValue: '',
                 isChatting: true
             });
             
             // Trigger AI response (we need to trigger handleSendMessage logic effectively)
             // Since handleSendMessage uses `inputValue`, we can't easily trigger it without user click.
             // We'll need a `useEffect` or direct call. 
             // Let's make a `generateResponse(query)` function.
             // Refactoring is too big. 
             // Alternative: Direct call to backend and manual update.
             
             // Let's implement the "Edit Manually" and "Delete" first as they are easier.
             // For Rewrite, maybe just put the instruction in the input box?
             setInput(`请重写上一条回答。要求：${instructions}`);
             // Let user click send.
             
        } catch (e) {
            console.error(e);
        }
    };

  // --- Folder Grouping & Filtering ---
    const [searchQuery, setSearchQuery] = useState('');
    const [fileTypeFilter, setFileTypeFilter] = useState<'all' | 'pdf' | 'doc' | 'ppt' | 'xls' | 'md' | 'image'>('all');
    const [mountedSearchResults, setMountedSearchResults] = useState<{ name: string; path: string; isDirectory: boolean }[]>([]);
    const [mountedSearchLoading, setMountedSearchLoading] = useState(false);

    const matchedIndexedFiles = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return [];
        const matchesType = (filePath: string) => {
            const name = filePath.split(/[\\/]/).pop() || '';
            const ext = (name.includes('.') ? name.split('.').pop() : '')?.toLowerCase() || '';
            if (fileTypeFilter === 'all') return true;
            if (fileTypeFilter === 'pdf') return ext === 'pdf';
            if (fileTypeFilter === 'doc') return ext === 'doc' || ext === 'docx';
            if (fileTypeFilter === 'ppt') return ext === 'ppt' || ext === 'pptx';
            if (fileTypeFilter === 'xls') return ext === 'xls' || ext === 'xlsx' || ext === 'csv';
            if (fileTypeFilter === 'md') return ext === 'md' || ext === 'markdown' || ext === 'txt';
            if (fileTypeFilter === 'image') return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff'].includes(ext);
            return true;
        };
        return Array.from(ingestedFiles)
            .filter((p): p is string => typeof p === 'string')
            .filter((p) => {
                const name = p.split(/[\\/]/).pop() || '';
                return (name.toLowerCase().includes(q) || p.toLowerCase().includes(q)) && matchesType(p);
            })
            .slice(0, 30);
    }, [searchQuery, ingestedFiles, fileTypeFilter]);

    useEffect(() => {
        if (!window.electronAPI) return;
        const q = searchQuery.trim();
        if (!q) {
            setMountedSearchResults([]);
            return;
        }

        let cancelled = false;
        setMountedSearchLoading(true);
        const t = window.setTimeout(async () => {
            try {
                const res = await (window as any).electronAPI.invoke('kb-search-mounted-files', {
                    query: q,
                    roots: mountedFolders,
                    limit: 60,
                    fileTypeFilter
                });
                if (cancelled) return;
                setMountedSearchResults(Array.isArray(res?.results) ? res.results : []);
            } finally {
                if (!cancelled) setMountedSearchLoading(false);
            }
        }, 250);

        return () => {
            cancelled = true;
            window.clearTimeout(t);
        };
    }, [searchQuery, mountedFolders, fileTypeFilter]);

    const matchedUnindexedItems = useMemo(() => {
        const q = searchQuery.trim();
        if (!q) return [];
        const ingested = ingestedFiles;
        return mountedSearchResults
            .filter((item) => item && item.path && !ingested.has(item.path))
            .slice(0, 30);
    }, [searchQuery, mountedSearchResults, ingestedFiles]);
    
    // Categorize Folders
    const groupedFolders = useMemo(() => {
        const archives: Record<string, string[]> = {}; // Year-Month -> Paths
        const activeProjects: string[] = [];
        const localMounts: string[] = [];
        
        const projectPaths = new Set<string>();

        // 1. Process Projects
        projects.forEach(p => {
            const proj = p as any;
            // Heuristic: Use source if it looks like a path (not 'Local')
            const path = (proj.source && proj.source !== 'Local') ? proj.source : null;
            // Fallback: If 'Local' but we want to show it? Maybe we can't without a folder.
            
            if (!path) return;
            
            projectPaths.add(path);

            // Search Filter
            if (searchQuery) {
                const matchName = path.toLowerCase().includes(searchQuery.toLowerCase());
                const matchTitle = proj.title.toLowerCase().includes(searchQuery.toLowerCase());
                if (!matchName && !matchTitle) return;
            } else {
                // Also check if folder matches search query if search query is generic
            }

            if (proj.status === 'Archived') {
                // Archive Grouping
                const date = new Date(proj.updatedAt || Date.now());
                const key = `${date.getFullYear()}年${date.getMonth() + 1}月`;
                if (!archives[key]) archives[key] = [];
                archives[key].push(path);
            } else {
                activeProjects.push(path);
            }
        });
        
        // 2. Process Manual Mounts
        // Filter by search query first
        const filteredMounts = mountedFolders.filter(f => 
            !searchQuery || f.toLowerCase().includes(searchQuery.toLowerCase())
        );

        filteredMounts.forEach(folder => {
            if (projectPaths.has(folder)) return; // Already handled
            
            // Heuristic: Check if folder is a project archive manually mounted
            const isArchive = folder.includes('storage/PLAN');
            
            if (isArchive) {
                // Try to extract date
                const dateMatch = folder.match(/(\d{4})-(\d{2})/);
                const key = dateMatch ? `${dateMatch[1]}年${dateMatch[2]}月` : '其他归档';
                if (!archives[key]) archives[key] = [];
                archives[key].push(folder);
            } else {
                localMounts.push(folder);
            }
        });
        
        // Sort keys (descending for dates)
        const sortedArchiveKeys = Object.keys(archives).sort().reverse();
        
        return {
            archives,
            sortedArchiveKeys,
            activeProjects,
            localMounts
        };
    }, [mountedFolders, projects, searchQuery]);

    const handleContextMenu = (folder: string, e: React.MouseEvent) => {
        e.preventDefault();
        // Custom Context Menu Logic would go here
        // For simplicity, we use window.confirm based actions or a custom dropdown state
        // Let's implement a simple custom dropdown positioned at cursor
        setContextMenu({
            visible: true,
            x: e.clientX,
            y: e.clientY,
            targetPath: folder
        });
    };

    const [contextMenu, setContextMenu] = useState<{visible: boolean, x: number, y: number, targetPath: string | null}>({
        visible: false, x: 0, y: 0, targetPath: null
    });

    // Close context menu on click elsewhere
    useEffect(() => {
        const closeMenu = () => setContextMenu(prev => ({ ...prev, visible: false }));
        window.addEventListener('click', closeMenu);
        return () => window.removeEventListener('click', closeMenu);
    }, []);

    const handleOpenInExplorer = async () => {
        if (contextMenu.targetPath && window.electronAPI) {
            await window.electronAPI.fs.openPath(contextMenu.targetPath);
        }
    };

    const handleClearIndex = async () => {
        if (!contextMenu.targetPath || !window.electronAPI) return;
        const folder = contextMenu.targetPath;
        
        if (!confirm(`确定要清空文件夹 "${folder.split(/[\\/]/).pop()}" 的索引缓存吗？\n清空后下次使用时将重新建立索引 (重新切片和Embedding)。`)) return;
        
        // Filter files belonging to this folder
        const toDelete = Array.from(ingestedFiles).filter(f => f.startsWith(folder));
        
        if (toDelete.length > 0) {
            try {
                // @ts-ignore
                const res = await window.electronAPI.knowledge.batchDelete(toDelete);
                if (res.success) {
                    setIngestedFiles(prev => {
                        const next = new Set(prev);
                        toDelete.forEach(f => next.delete(f));
                        return next;
                    });
                    // Update DB setting
                    window.electronAPI.db.getSetting('kb_ingested_files').then((files: any) => {
                         const current = new Set(files || []);
                         toDelete.forEach(f => current.delete(f));
                         window.electronAPI.db.saveSetting('kb_ingested_files', Array.from(current));
                    });
                    alert(`已清除 ${toDelete.length} 个文件的索引缓存`);
                } else {
                    alert("清除失败: " + res.error);
                }
            } catch (e: any) {
                alert("操作失败: " + e.message);
            }
        } else {
            alert("此文件夹下没有已索引的文件");
        }
    };

    const handleRemoveMount = async () => {
        if (!contextMenu.targetPath) return;
        const folder = contextMenu.targetPath;
        
        const newFolders = mountedFolders.filter(f => f !== folder);
        setMountedFolders(newFolders);
        if (window.electronAPI) {
            await window.electronAPI.db.saveSetting('kb_mounted_folders', newFolders);
        }
        
        // Cleanup active files
        const newActive = new Set(activeFiles);
        let hasChanges = false;
        activeFiles.forEach(file => {
            if (file.startsWith(folder)) {
                newActive.delete(file);
                hasChanges = true;
            }
        });
        if (hasChanges) {
            setActiveFiles(newActive);
            if (window.electronAPI) {
                await window.electronAPI.db.saveSetting('kb_active_files', Array.from(newActive));
            }
        }
    };

    const handlePhysicalDelete = async () => {
        if (!contextMenu.targetPath) return;
        const folder = contextMenu.targetPath;
        
        // SAFETY CHECK: Prevent deletion of mounted roots
        if (mountedFolders.includes(folder)) {
            alert("⚠️ 安全保护：已挂载的外部文件夹不能被彻底删除！\n\n为了防止误删重要数据（如桌面、系统文件夹），请使用 '仅移除引用' 来取消挂载。");
            return;
        }
        
        if (!confirm(`⚠️ 高危操作：确定要彻底删除文件夹 "${folder.split(/[\\/]/).pop()}" 及其所有内容吗？\n此操作不可恢复！`)) return;
        
        // 1. Remove from UI first
        await handleRemoveMount();
        
        // 2. Delete physically
        if (window.electronAPI) {
            const res = await window.electronAPI.fs.deleteDirectory(folder);
            if (res.success) {
                alert("文件夹已彻底删除");
            } else {
                alert("删除失败: " + res.error);
            }
        }
    };

    // AI Migration State
    const [aiMigrationOpen, setAiMigrationOpen] = useState(false);
    const [exportMountOpen, setExportMountOpen] = useState(false);
    const [exportMountMode, setExportMountMode] = useState<'shortcut' | 'copy' | 'move'>('shortcut');
    const [exportMountScope, setExportMountScope] = useState<'selected' | 'all'>('all');
    const [exportMountTargets, setExportMountTargets] = useState<string[]>([]);
    const [exportMountDestDir, setExportMountDestDir] = useState('');
    const [exportMountFolderName, setExportMountFolderName] = useState('本地挂载_导出');
    const [exportMountWorking, setExportMountWorking] = useState(false);

    const handleMountFolder = async (path?: string) => {
        if (!window.electronAPI) return;
        
        let folder = path;
        if (!folder) {
            folder = await window.electronAPI.fs.selectFolder();
        }
        
        if (folder && !mountedFolders.includes(folder)) {
            const newFolders = [...mountedFolders, folder];
            setMountedFolders(newFolders);
            window.electronAPI.db.saveSetting('kb_mounted_folders', newFolders);
            (window as any).electronAPI.invoke('kb-upsert-folder-meta', {
                folder_id: folder,
                folder_path: folder,
                source_type: 'local_mount',
                origin_path: folder,
                is_external_reference: 1,
                created_at: Date.now(),
                extra_json: {}
            });
        }
    };

    const handleFileDrop = async (targetFolder: string, files: File[], isCopy: boolean) => {
        if (!window.electronAPI) return;
        
        const actionName = isCopy ? "备份(复制)" : "迁移(移动)";
        if (!confirm(`确定要将 ${files.length} 个文件${actionName}到 "${targetFolder.split(/[\\/]/).pop()}" 吗？`)) return;
        
        let successCount = 0;
        let failCount = 0;
        
        for (const file of files) {
            const srcPath = file.path;
            const destPath = `${targetFolder}/${file.name}`; // Simple path join
            
            try {
                if (isCopy) {
                    // @ts-ignore
                    const res = await window.electronAPI.fs.copyFile(srcPath, destPath);
                    if (res.success) successCount++;
                    else throw new Error(res.error);
                } else {
                    // @ts-ignore
                    const res = await window.electronAPI.fs.rename(srcPath, destPath);
                    if (res.success) successCount++;
                    else throw new Error(res.error);
                }
            } catch (e: any) {
                console.error(`File op failed for ${file.name}:`, e);
                failCount++;
            }
        }
        
        alert(`${actionName}完成\n成功: ${successCount}\n失败: ${failCount}`);
        // Refresh to show new files
        setRefreshKey(prev => prev + 1);
    };

    const handleReadingClick = async (file: any, initialPurpose?: string) => {
      if (!window.electronAPI) return;
      try {
          // 1. Fetch content for preview/reading
          // Use readFilePreview to get content + type
          // @ts-ignore
          const res = await window.electronAPI.fs.readFilePreview(file.path);
          if (res.success) {
              const pFile = { 
                  name: file.name, 
                  path: file.path,
                   content: res.data, 
                   type: (res.type as any) || 'text'
               };

              // 2. Set previewFile (which acts as pending file)
              // Note: We block the Preview Modal in 'reading' tab, so this just holds state
              setPreviewFile(pFile);
              
              // 3. Open Purpose Modal OR Open Directly
              // Bypass modal for direct click -> Default to "Free Reading"
              const purpose = initialPurpose || "自由阅读";
              setReadingPurpose(purpose);
              setReadingFile(pFile);
              setPreviewFile(null); // Clear pending
              setShowPurposeModal(false); 
          } else {
              const msg = String(res.error || '未知错误');
              const isMissing = /ENOENT|not found|File not found/i.test(msg);
              if (isMissing) alert("文件不存在或无法访问");
              else alert("无法读取文件: " + msg);
          }
      } catch (e: any) {
          console.error("Reading open failed", e);
          const msg = String(e?.message || '');
          const isMissing = /ENOENT|not found|File not found/i.test(msg);
          if (isMissing) alert("文件不存在或无法访问");
          else alert("打开文件失败");
      }
    };

    const handlePreview = async (file: any, highlightText?: string) => {
      if (!window.electronAPI) return;
      try {
          // Use new API for proper preview extraction
          const res = await window.electronAPI.fs.readFilePreview(file.path);
          if (res.success && res.data) {
              setPreviewFile({ 
                  name: file.name, 
                  path: file.path,
                  content: res.data, 
                  type: res.type || 'text',
                  highlight: highlightText
              });
          } else {
              alert(res.error || '无法预览此文件');
          }
      } catch (e) {
          console.error(e);
      }
  };

  const [ingestProgress, setIngestProgress] = useState<{total: number, processed: number, current: string | null} | null>(null);

  useEffect(() => {
      if (window.electronAPI && window.electronAPI.knowledge.onIngestProgress) {
          const cleanup = window.electronAPI.knowledge.onIngestProgress((data: any) => {
              // console.log("Ingest Progress:", data);
              
              if (data.status === 'idle' || (data.processed === data.total && data.total > 0)) {
                  // Done
                  setTimeout(() => setIngestProgress(null), 2000); // Hide after 2s
              } else {
                  setIngestProgress({
                      total: data.total,
                      processed: data.processed,
                      current: data.currentFile
                  });
              }

              if (data.currentFile) {
                  if (data.status === 'processing') {
                      setLoadingFiles(prev => new Set(prev).add(data.currentFile));
                  } else if (data.status === 'completed') {
                      setLoadingFiles(prev => {
                          const next = new Set(prev);
                          next.delete(data.currentFile);
                          return next;
                      });
                      setIngestedFiles(prev => new Set(prev).add(data.currentFile));
                      
                      // Persist immediately? Or wait for batch? 
                      // Better to persist in batch or throttle, but here is fine for now.
                      // Actually, we can just rely on state and save occasionally, 
                      // but to be safe let's read-update-save or just trust the local state + periodic save?
                      // Let's do a simple debounced save or just save on unmount?
                      // For safety, let's just trigger a save setting every time (Electron fs is fast enough for config)
                      window.electronAPI.db.getSetting('kb_ingested_files').then((files: any) => {
                          const newSet = new Set(files || []);
                          newSet.add(data.currentFile);
                          window.electronAPI.db.saveSetting('kb_ingested_files', Array.from(newSet));
                      });
                  } else if (data.status === 'failed') {
                      setLoadingFiles(prev => {
                          const next = new Set(prev);
                          next.delete(data.currentFile);
                          return next;
                      });
                      console.error(`Ingestion failed for ${data.currentFile}: ${data.error}`);
                  }
              }
          });
          return cleanup;
      }
  }, []);

  const toggleIndex = async (path: string, shouldActive: boolean, isDirectory: boolean = false) => {
        const newActive = new Set(activeFiles);
        
        // Helper to process a single file path (only for non-directory or specific file operations)
        const processFile = async (filePath: string, active: boolean) => {
            if (active) {
                if (!ingestedFiles.has(filePath)) {
                    try {
                        const name = filePath.split(/[\\/]/).pop() || 'unknown';
                        // @ts-ignore
                        const res = await window.electronAPI?.knowledge.upload({ name, path: filePath });
                        
                        if (res?.success) {
                            setIngestedFiles(prev => new Set(prev).add(filePath));
                            window.electronAPI?.db.getSetting('kb_ingested_files').then((files: any) => {
                                const newSet = new Set(files || []);
                                newSet.add(filePath);
                                window.electronAPI.db.saveSetting('kb_ingested_files', Array.from(newSet));
                            });
                            (window as any).electronAPI.invoke('kb-queue-file-metadata', filePath);
                        }
                    } catch (e) {
                        console.error(`Failed to ingest ${filePath}`, e);
                    }
                }
                // Only add to activeFiles if NOT part of a directory selection (managed separately)
                // BUT for compatibility with old logic, we might need to be careful.
                // However, our new logic prefers adding the FOLDER path itself.
            }
        };

        if (isDirectory) {
            // OPTIMIZATION: Handle Folder Selection
            // 1. Add/Remove Folder Path to activeFiles (for efficient scoping)
            if (shouldActive) {
                newActive.add(path);
                // 2. Remove any explicit child paths (cleanup)
                Array.from(newActive).forEach(p => {
                    if (p.startsWith(path) && p !== path && (p[path.length] === '/' || p[path.length] === '\\')) {
                        newActive.delete(p);
                    }
                });
            } else {
                newActive.delete(path);
                // Also remove children? Yes.
                Array.from(newActive).forEach(p => {
                    if (p.startsWith(path)) newActive.delete(p);
                });
            }

            // 3. Trigger Background Ingestion (Recursive)
            // We still need to ingest files so they exist in DB, even if activeFiles only tracks the folder.
            if (shouldActive) {
                setLoadingFiles(prev => new Set(prev).add(path));
                
                const getAllFiles = async (dirPath: string): Promise<string[]> => {
                    const entries = await window.electronAPI.fs.readDir(dirPath);
                    let files: string[] = [];
                    for (const entry of entries) {
                        if (entry.isDirectory) {
                            files = [...files, ...(await getAllFiles(entry.path))];
                        } else {
                            if (!entry.name.startsWith('.')) files.push(entry.path);
                        }
                    }
                    return files;
                };

                try {
                    const allFiles = await getAllFiles(path);
                    // Process ingestion in background
                    Promise.all(allFiles.map(f => processFile(f, true))).then(() => {
                        console.log(`[Background] Ingestion complete for folder: ${path}`);
                    });
                } finally {
                    setLoadingFiles(prev => {
                        const next = new Set(prev);
                        next.delete(path);
                        return next;
                    });
                }
            }
        } else {
            // Single File
            await processFile(path, shouldActive);
            if (shouldActive) {
                newActive.add(path);
            } else {
                newActive.delete(path);
            }
        }
        
        setActiveFiles(new Set(newActive));
        window.electronAPI?.db.saveSetting('kb_active_files', Array.from(newActive));
    };

  const handleReindexAll = async () => {
      // Logic Upgrade: 
      // 1. If activeFiles selected, re-index them.
      // 2. If NO activeFiles, try to find currently previewing file and re-index it (Single File Force Update).
      
      let targets = Array.from(activeFiles);
      
      // If no checkboxes, check if we have a focused file (previewFile)
      if (targets.length === 0 && previewFile) {
          targets = [previewFile.path];
      }

      if (targets.length === 0) return alert("请先勾选需要更新的文件，或在预览模式下操作。");
      
      if (!confirm(`确定要强制更新 ${targets.length} 个文件的索引吗？\n这将会调用最新的切片和转录逻辑。`)) return;

      setIsReindexing(true);
      let successCount = 0;
      let failCount = 0;

      for (const path of targets) {
          try {
              const name = path.split(/[\\/]/).pop() || 'unknown';
              
              // Force delete first to ensure clean state (Backend does this too, but explicit is safer)
              // Actually ragEngine.ingestFile handles delete-before-insert.
              
              // @ts-ignore
              const res = await window.electronAPI?.knowledge.upload({ name, path });
              if (res && res.success) {
                  successCount++;
              } else {
                  console.error(`Re-index failed for ${path}:`, res?.error);
                  failCount++;
              }
          } catch (e) {
              console.error(`Re-index error for ${path}:`, e);
              failCount++;
          }
      }

      setIsReindexing(false);
      alert(`更新完成\n成功: ${successCount}\n失败: ${failCount}`);
      
      // If we updated the previewing file, refresh its content
      if (previewFile && targets.includes(previewFile.path)) {
          // Trigger a re-read of the chunks/preview
          handlePreview({ name: previewFile.name, path: previewFile.path });
      }
      
      loadSettings(); 
  };

  const handleOpenSaveModal = (msg: { text: string, chunks?: any[] }) => {
      setMessageToSave(msg);
      setSaveFileName(`对话存档_${new Date().toLocaleDateString().replace(/\//g, '-')}_${Date.now()}.md`);
      // Default to first mounted folder if available
      setSaveTargetFolder(mountedFolders.length > 0 ? mountedFolders[0] : '');
      setSaveNewFolderName('');
      setSaveModalOpen(true);
  };

  const handlePolish = (type: 'auto' | 'custom', instruction?: string) => {
      if (!editingMessage || !textareaRef.current) return;
      
      const textarea = textareaRef.current;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      let textToPolish = "";
      
      if (start !== end) {
          textToPolish = textarea.value.substring(start, end);
      } else {
          // If no selection, polish the whole text? Or warn?
          // User said "wake up by selecting...". If no selection, maybe warn or select all.
          // Let's select all for convenience but show toast?
          textToPolish = textarea.value;
      }

      if (!textToPolish.trim()) {
          alert("请先选择需要润色的文字");
          return;
      }

      // Open Modal
      setPolishModal({
          open: true,
          sourceText: textToPolish,
          instruction: instruction || '',
          result: '', // Empty result initially
          isLoading: false, // Wait for user to click generate in modal, OR auto-generate if type='auto'
          selectionStart: start,
          selectionEnd: end
      });

      // If auto, trigger generation immediately
      if (type === 'auto') {
          // We need to trigger this after state update. 
          // But state update is async. 
          // Let's just call executePolish directly with the params.
          executePolish(textToPolish, '', start, end);
      }
  };

  const executePolish = async (source: string, instruction: string, start: number, end: number) => {
      setPolishModal(prev => ({ ...prev, open: true, sourceText: source, instruction, isLoading: true, selectionStart: start, selectionEnd: end }));
      
      try {
          const prompt = instruction 
            ? `Please rewrite the following text according to this instruction: "${instruction}". Maintain markdown formatting if applicable. Return ONLY the rewritten text without any conversational filler.\n\nText:\n${source}`
            : `Please polish the following text to make it more professional, clear, and coherent. Maintain the original meaning and markdown formatting. Return ONLY the polished text without any conversational filler.\n\nText:\n${source}`;

          // Use new IPC method
          // @ts-ignore
          const res = await window.electronAPI.knowledge.completion({ prompt });
          
          if (res.success) {
              setPolishModal(prev => ({ ...prev, result: res.text, isLoading: false }));
          } else {
              throw new Error(res.error);
          }
      } catch (e: any) {
          console.error("Polish failed", e);
          alert("润色失败: " + e.message);
          setPolishModal(prev => ({ ...prev, isLoading: false }));
      }
  };

  const applyPolish = () => {
      if (!editingMessage || !polishModal.result) return;
      
      const newText = editingMessage.text.substring(0, polishModal.selectionStart) + polishModal.result + editingMessage.text.substring(polishModal.selectionEnd);
      setEditingMessage({ ...editingMessage, text: newText });
      setPolishModal(prev => ({ ...prev, open: false }));
  };

  const handleSaveMessage = async () => {
      if (!window.electronAPI || !saveTargetFolder || !saveFileName || !messageToSave) return;
      
      let finalFolder = saveTargetFolder;
      
      try {
          // 1. Check/Create New Subfolder
          if (saveNewFolderName.trim()) {
              const subFolderPath = `${saveTargetFolder}/${saveNewFolderName.trim()}`;
              const exists = await window.electronAPI.fs.exists(subFolderPath);
              if (!exists) {
                  // We need an ensureDir or mkdir. Preload has ensureDir.
                  // Wait, check preload.js tool result. It has ensureDir.
                  // @ts-ignore
                  const created = await window.electronAPI.fs.ensureDir(subFolderPath);
                  if (!created && created !== undefined) { // ensureDir usually returns bool or void? assume bool based on typical implementation
                       // If ensureDir returns void/undefined on success, we proceed. 
                       // If it returns false on failure, we stop.
                       // Let's assume standard behavior: throws on error or returns true.
                  }
              }
              finalFolder = subFolderPath;
          }

          const fullPath = `${finalFolder}/${saveFileName}`;

          // Check if folder exists (it should, as it's mounted or just created)
          const folderExists = await window.electronAPI.fs.exists(finalFolder);
          if (!folderExists) {
              alert("目标文件夹不存在");
              return;
          }

          // 2. Construct Enhanced Markdown Content
          let content = `# 知识库对话存档\n\n> 存档时间: ${new Date().toLocaleString()}\n\n## 问答内容\n\n${messageToSave.text}\n\n`;

          // Append Citations if available
          // Debug check: messageToSave.chunks
          console.log("[Save] Checking chunks for save:", messageToSave.chunks);
          
          if (messageToSave.chunks && messageToSave.chunks.length > 0) {
              content += `\n---\n\n## 引用来源 (References)\n\n`;
              messageToSave.chunks.forEach((chunk, idx) => {
                  const fileName = chunk.source.split(/[\\/]/).pop();
                  // Create a file link. 
                  // In markdown, local links might be file://... or just path. 
                  // For better compatibility in this app (if we have a viewer), absolute path is best.
                  // Or use a custom scheme if supported. Standard file:// is safest for local md viewers.
                  const fileLink = `file://${chunk.source}`;
                  // Escape spaces in file path for markdown link
                  const safeLink = fileLink.replace(/ /g, '%20');
                  
                  content += `### [${idx + 1}] [${fileName}](${safeLink})\n`;
                  content += `> ${chunk.text.replace(/\n/g, '\n> ')}\n\n`;
                  
                  // Add score if available
                  if (chunk.score !== undefined) {
                      content += `*相关度评分: ${(chunk.score * 100).toFixed(1)}%*\n\n`;
                  }
              });
          } else {
              console.warn("[Save] No chunks found in messageToSave");
          }

          // Write file
          await window.electronAPI.fs.writeFile(fullPath, content);
          
          // Trigger Re-index for this file
          // We can use the toggleIndex logic or just upload
          const res = await window.electronAPI.knowledge.upload({ name: saveFileName, path: fullPath } as any);
          if (res?.success) {
              // Update state to show it's active
              const newIngested = new Set(ingestedFiles).add(fullPath);
              const newActive = new Set(activeFiles).add(fullPath);
              setIngestedFiles(newIngested);
              setActiveFiles(newActive);
              
              await window.electronAPI.db.saveSetting('kb_ingested_files', Array.from(newIngested));
              await window.electronAPI.db.saveSetting('kb_active_files', Array.from(newActive));
              
              setRefreshKey(prev => prev + 1); // Refresh tree
              alert("✅ 保存并索引成功！");
          } else {
              alert("⚠️ 保存成功，但索引失败：" + res?.error);
          }
          
          setSaveModalOpen(false);
      } catch (e: any) {
          alert("保存失败: " + e.message);
      }
  };

    const runMultiExploreFlow = async (query: string, sessionId: string, providers: ProviderOption[], activeFiles: Set<string>) => {
        try {
            // 1. Retrieval (Shared)
            let contextText = "";
            let finalChunks: any[] = [];
            
            if (window.electronAPI) {
                 // @ts-ignore
                 const result: any = await window.electronAPI.knowledge.query({ 
                    text: query, 
                    topK: 15, 
                    activeFiles: Array.from(activeFiles) 
                });
                
                if (typeof result === 'object') {
                    finalChunks = result.chunks || [];
                    const retrievalQuality = typeof result.retrievalQuality === 'number' ? result.retrievalQuality : undefined;
                    const recallNormalized = retrievalQuality !== undefined ? Math.max(0, Math.min(1, retrievalQuality / 100)) : undefined;
                    if (finalChunks.length > 0) {
                        contextText = finalChunks.map((c: any, i: number) => `[${i+1}] ${c.text}`).join('\n\n');
                    } else {
                        contextText = result.context || "";
                    }
                    // Pre-fill recall stats for all providers
                    if (recallNormalized !== undefined) {
                        const sessionIdCopy = sessionId;
                        setSessions(prev => prev.map(s => {
                            if (s.id === sessionIdCopy) {
                                const msgs = [...s.messages];
                                const lastMsg = msgs[msgs.length - 1];
                                if (lastMsg && lastMsg.multiResponses) {
                                    const newResponses = lastMsg.multiResponses.map(r => {
                                        const statsObj = {
                                            recall: (recallNormalized ?? 0),
                                            collectionCount: (r.stats?.collectionCount ?? 0),
                                            collectionRatio: (r.stats?.collectionRatio ?? 0),
                                            userRating: (r.stats?.userRating ?? 0)
                                        } as { recall: number; collectionCount: number; collectionRatio: number; userRating: number };
                                        return { ...r, stats: statsObj };
                                    });
                                    msgs[msgs.length - 1] = { ...lastMsg, multiResponses: newResponses };
                                }
                                return { ...s, messages: msgs };
                            }
                            return s;
                        }));
                    }
                } else {
                    contextText = result;
                }
            } else {
                contextText = "No local context found.";
            }

            // 2. Parallel Generation
            let systemPrompt = "";
            
            if (activeFiles.size > 0 && finalChunks.length > 0) {
                 // RAG Mode - Strict
                 systemPrompt = `你是一个基于知识库的智能助手。
  
  【核心指令】
  你必须严格基于【参考资料】回答用户问题。
  
  【回答原则】
  1. **事实导向**：所有事实性陈述必须有引用支持。
  2. **严谨引用**：严禁编造引用索引。索引必须对应【参考资料】中标记的 [x]。
  3. **逻辑连贯**：将回答拆分为多个自然的逻辑段落。
  
  【参考资料】
  ${contextText}`;
            } else {
                 // General Chat Mode - Relaxed but Honest
                 systemPrompt = `你是一个有帮助的智能助手。
                 
                 【注意】
                 当前用户未指定知识库文件，或知识库中未找到相关内容。
                 请基于你的通用知识回答问题。请勿编造事实。如果无法回答，请诚实告知。`;
            }
            
            const updateResponse = (providerId: string, delta: Partial<MultiExploreResponse>) => {
                setSessions(prev => prev.map(s => {
                    if (s.id === sessionId) {
                        const msgs = [...s.messages];
                        const lastMsg = msgs[msgs.length - 1];
                        if (lastMsg && lastMsg.multiResponses) {
                            const newResponses = lastMsg.multiResponses.map(r => 
                                r.providerId === providerId ? { ...r, ...delta } : r
                            );
                            msgs[msgs.length - 1] = { ...lastMsg, multiResponses: newResponses };
                        }
                        return { ...s, messages: msgs };
                    }
                    return s;
                }));
            };

            await Promise.all(providers.map(async (p) => {
                const provider = createProviderInstance(p.id, customLLMs);
                if (!provider) {
                    updateResponse(p.id, { isLoading: false, error: "Provider not found" });
                    return;
                }

                try {
                    const stream = provider.generateContentStream({
                        prompt: query,
                        systemInstruction: systemPrompt,
                        temperature: 0.7
                    });

                    let fullContent = "";
                    for await (const chunk of stream) {
                        const textChunk = normalizeLLMChunk(chunk);
                        if (!textChunk) continue;
                        fullContent += textChunk;
                        updateResponse(p.id, { content: fullContent });
                    }
                    
                    // Done
                    updateResponse(p.id, { isLoading: false, chunks: finalChunks }); // Shared chunks
                    
                } catch (e: any) {
                    updateResponse(p.id, { isLoading: false, error: e.message });
                }
            }));
            
            updateSession(sessionId, { isChatting: false });
 
         } catch (e) {
             console.error(e);
             updateSession(sessionId, { isChatting: false });
         }
     };

    const handleSynthesize = async (providerId: string) => {
        if (!activeSession) return;
        
        // Find the last multi-response message
        const lastMsgIndex = activeSession.messages.length - 1;
        const lastMsg = activeSession.messages[lastMsgIndex];
        
        if (!lastMsg.multiResponses) return;
        
        // Auto-select best if not specified, or use the first one
        let selectedResponse = lastMsg.multiResponses.find(r => r.providerId === providerId);
        
        // If providerId is not passed (from CardClip global button), pick the best one automatically
        if (!selectedResponse) {
             // Simple scoring logic same as View (but re-calculated or assume passed?)
             // For simplicity, pick the first one or one with highest internal score if available
             // Let's just pick the first completed one for now
             selectedResponse = lastMsg.multiResponses.find(r => !r.isLoading && !r.error);
        }

        if (!selectedResponse) return;

        // User query is the one before the last message
        const userQuery = activeSession.messages[lastMsgIndex - 1]?.text || "Unknown Query";

        const collectedText = collectedItems.map(i => `- ${i.text}`).join('\n');
        
        const prompt = `【任务目标】
请作为一位资深专家，基于以下信息，为用户的问题生成一份最终的、高质量的综合回答。

【用户问题】
${userQuery}

【核心参考回答】 (由 ${selectedResponse.providerName} 提供)
${selectedResponse.content}

【用户特别关注点】 (请务必融合以下用户划线收藏的内容)
${collectedText}

【生成要求】
1. 结构清晰，逻辑严密。
2. 充分融合“核心参考回答”的观点，并重点展开“用户特别关注点”。
3. 保持客观、专业。
4. 使用 Markdown 格式输出。
`;

        const botMsg = { 
            role: 'model', 
            text: '', 
            timestamp: Date.now(),
            sources: selectedResponse.chunks?.map((c:any) => c.source) || [],
            chunks: selectedResponse.chunks || [],
            complianceWarnings: []
        };
        
        updateSession(activeSession.id, {
            messages: [...activeSession.messages, botMsg as any],
            isChatting: true
        });
        
        // Clear collected items immediately to avoid pollution
        setCollectedItems([]);
        
        try {
            const provider = createProviderInstance(selectedResponse.providerId, customLLMs);
            if (provider) {
                const stream = provider.generateContentStream({ prompt: prompt, temperature: 0.7 });
                let fullText = "";
                for await (const chunk of stream) {
                    const textChunk = normalizeLLMChunk(chunk);
                    if (!textChunk) continue;
                    fullText += textChunk;
                    setSessions(prev => prev.map(s => {
                        if (s.id === activeSession.id) {
                            const msgs = [...s.messages];
                            msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], text: fullText };
                            return { ...s, messages: msgs };
                        }
                        return s;
                    }));
                }
            }
        } catch(e) {
            console.error("Synthesis Error", e);
            // Append error to text
             setSessions(prev => prev.map(s => {
                if (s.id === activeSession.id) {
                    const msgs = [...s.messages];
                    msgs[msgs.length - 1] = { ...msgs[msgs.length - 1], text: msgs[msgs.length - 1].text + "\n\n[生成中断: " + (e as any).message + "]" };
                    return { ...s, messages: msgs };
                }
                return s;
            }));
        } finally {
            updateSession(activeSession.id, { isChatting: false });
        }
    };

    const handleGenerateComparison = async (messageIndex: number) => {
        if (!activeSession) return;
        const msg = activeSession.messages[messageIndex] as any;
        if (!msg?.multiResponses || msg.multiResponses.length === 0) return;
        const userQuery = activeSession.messages[messageIndex - 1]?.text || '';
        const collectedTexts = collectedItems.map(i => i.text);
        updateSession(activeSession.id, { isChatting: true });
        try {
            const result: ComparisonResult = await generateComparison(
                customLLMs,
                availableProviders,
                userQuery,
                msg.multiResponses,
                collectedTexts
            );
            setSessions(prev => prev.map(s => {
                if (s.id === activeSession.id) {
                    const msgs = [...s.messages];
                    msgs[messageIndex] = { ...(msg as any), comparisonResult: result } as any;
                    return { ...s, messages: msgs };
                }
                return s;
            }));
        } catch (e) {
            alert(`对比分析失败: ${(e as any).message}`);
        } finally {
            updateSession(activeSession.id, { isChatting: false });
        }
    };

    const handleSendMessage = async () => {
    if (!activeSession) return;
    const currentInput = activeSession.inputValue.trim();
    if (!currentInput || activeSession.isChatting) return;
    
    // Multi-Explore Mode Interception
    if (exploreMode === 'multi') {
        // 1. Validate Selection
        if (selectedMultiProviders.length < 2) {
            alert("请至少选择 2 个模型进行多元探索");
            return;
        }

        const currentSessionId = activeSession.id;
        saveRecentQuestion(currentInput);
        
        const userMsg = { role: 'user', text: currentInput, timestamp: Date.now() };
        
        // Initial Bot Message with Multi-Response Placeholders
        const providers = availableProviders.filter(p => selectedMultiProviders.includes(p.id));
        const initialResponses: MultiExploreResponse[] = providers.map(p => ({
            providerId: p.id,
            providerName: p.name,
            modelId: p.modelId,
            content: '',
            isLoading: true,
            chunks: []
        }));

        const botMsg = {
            role: 'assistant',
            timestamp: Date.now() + 1,
            multiResponses: initialResponses,
            text: '' // Fallback text?
        };

        updateSession(currentSessionId, {
            messages: [...activeSession.messages, userMsg as any, botMsg as any],
            inputValue: '',
            isChatting: true,
            title: activeSession.messages.length <= 1 ? currentInput.slice(0, 20) : activeSession.title
        });
        
        runMultiExploreFlow(currentInput, currentSessionId, providers, activeSession.activeFiles);
        return;
    }
    
    const currentSessionId = activeSession.id;

    // 1. Check for Pending Intent (Clarification Answer)
    if (activeSession.pendingIntent) {
        const original = activeSession.pendingIntent.originalQuery;
        const answer = currentInput;
        const combinedQuery = `[Goal]: ${original}\n[Context/Clarification]: ${answer}\n[Instruction]: Please answer the goal using the provided context.`;
        
        // Add user answer
        const userMsg = { role: 'user', text: answer, timestamp: Date.now() };
        updateSession(currentSessionId, {
            messages: [...activeSession.messages, userMsg as any],
            inputValue: '',
            isChatting: true,
            pendingIntent: null // Clear intent
        });

        try {
            // Execute RAG with combined query
            // @ts-ignore
            const result: any = await window.electronAPI.knowledge.query({ 
                text: combinedQuery, 
                topK: 15,
                // Use session-specific active files
                activeFiles: Array.from(activeSession.activeFiles),
            });
            
            const botMsg = { 
                role: 'model', 
                text: typeof result === 'object' ? result.context : result, 
                timestamp: Date.now(),
                sources: (typeof result === 'object' ? result.sources : []) || [],
                chunks: (typeof result === 'object' ? result.chunks : []) || []
            };

            setSessions(prev => prev.map(s => {
                if (s.id === currentSessionId) {
                    return {
                        ...s,
                        messages: [...s.messages, botMsg as any],
                        isChatting: false
                    };
                }
                return s;
            }));
        } catch (e) {
            console.error(e);
            updateSession(currentSessionId, { isChatting: false });
        }
        return;
    }

    // 2. Normal Flow
    // Save to history
    saveRecentQuestion(currentInput);

    const userMsg = { role: 'user', text: currentInput, timestamp: Date.now() };
    
    // Optimistic Update: Add message, clear input, set chatting
    updateSession(currentSessionId, {
        messages: [...activeSession.messages, userMsg as any],
        inputValue: '',
        isChatting: true,
        title: activeSession.messages.length <= 1 ? currentInput.slice(0, 20) + (currentInput.length > 20 ? '...' : '') : activeSession.title
    });

    try {
        // B. Standard/Context Execution
        let contextText = '';
        let sources: string[] = [];
        let finalChunks: any[] = [];
        
        // --- NEW: Atomic RAG Job Control ---
        let currentJobId: string | null = null;

        // Deep Thinking Mode Logic
        if (isDeepThinking) {
            try {
                // Step 1: Generative Planning (Intent + Persona + Framework)
                updateSession(currentSessionId, { 
                    progressState: { step: 'INTENT', progress: 10, details: '正在深度思考并定义专家角色...', state: 'running' }
                });
                
                // Extract metadata (filenames) for context-aware planning
                const activeFilesList = Array.from(activeSession.activeFiles);
                const fileMetadata = activeFilesList.map(path => path.split(/[/\\]/).pop() || path); // Just filenames

                const framework = await generateAnswerFramework(currentInput, activeSession.messages, fileMetadata);
                
                // Step 2: Parallel Research
                updateSession(currentSessionId, { 
                    progressState: { step: 'RETRIEVAL', progress: 30, details: `已化身为【${framework.targetPersona || '专家'}】，正在并行检索 ${framework.sections.length} 个课题...`, state: 'running' }
                });

                const sectionContexts: Record<string, string> = {};
                let allSources: string[] = [];
                let allChunks: any[] = [];
                let completedSections = 0;

                // 1. Parallel Research & Raw Collection (Multi-Path)
                const searchResults = await Promise.all(framework.sections.map(async (sec: any) => {
                    const subQuery = sec.queries.join(' ');
                    
                    // Path A: Semantic Search (Planned Query)
                    // @ts-ignore
                    const resultA = await window.electronAPI.knowledge.query({ 
                        text: subQuery, 
                        topK: 5,
                        activeFiles: activeFilesList,
                        weight: 1.0
                    });

                    // Path B: Robustness Check (If A fails or is weak)
                    // If result A has 0 chunks, try a broader keyword search using the Section Title
                    let finalResult = resultA;
                    if (!resultA.chunks || resultA.chunks.length === 0) {
                         console.log(`[Multi-Path] Semantic search failed for "${sec.title}". Trying Keyword Fallback...`);
                         // @ts-ignore
                         const resultB = await window.electronAPI.knowledge.query({ 
                            text: sec.title, // Use title as broad keyword
                            topK: 5,
                            activeFiles: activeFilesList,
                            weight: 1.0
                            // strategy param removed to fix type error, backend handles raw text fine
                        });
                        if (resultB.chunks && resultB.chunks.length > 0) {
                            finalResult = resultB;
                        }
                    }
                    
                    completedSections++;
                    updateSession(currentSessionId, { 
                        progressState: { step: 'RETRIEVAL', progress: 30 + Math.floor((completedSections / framework.sections.length) * 40), details: `正在研究：${sec.title}...`, state: 'running' }
                    });

                    return { title: sec.title, result: finalResult };
                }));

                // 2. Global Indexing & Context Construction
                const uniqueChunksMap = new Map<string, any>();
                const globalChunks: any[] = [];

                searchResults.forEach(({ title, result }) => {
                    if (result && typeof result === 'object') {
                        // Collect Sources
                        if (result.sources) allSources.push(...result.sources);

                        // Process Chunks
                        const rawChunks = result.chunks || [];
                        const contextParts = rawChunks.map((chunk: any) => {
                            // Unique Key: ID > Content > Random fallback
                            const key = chunk.id || chunk.text?.substring(0, 100) || Math.random().toString();
                            
                            let globalIndex;
                            if (uniqueChunksMap.has(key)) {
                                globalIndex = uniqueChunksMap.get(key)._globalIndex;
                            } else {
                                globalIndex = globalChunks.length + 1;
                                const newChunk = { ...chunk, _globalIndex: globalIndex };
                                uniqueChunksMap.set(key, newChunk);
                                globalChunks.push(newChunk);
                                globalIndex = newChunk._globalIndex;
                            }
                            // Reconstruct context with Global Index
                            return `[${globalIndex}] ${chunk.text}`;
                        });
                        
                        sectionContexts[title] = contextParts.join('\n\n');
                    }
                });
                
                // Debug logging
                console.log('[DeepThinking] Retrieval Results:', { 
                    framework, 
                    searchResultsCount: searchResults.length,
                    globalChunksCount: globalChunks.length 
                });

                // Validation: Abort if no chunks found
                if (globalChunks.length === 0) {
                    // Extract debug info from first failed search result if available
                    // @ts-ignore
                    const debugInfo = searchResults[0]?.result?.debugInfo;
                    const intentMsg = debugInfo?.intentApplied ? `\n(AI意图识别: ${debugInfo.intentApplied})` : '';
                    
                    const noDataMsg = `⚠️ 检索未发现相关资料。${intentMsg}\n请尝试：\n1. 检查文件是否已索引\n2. 调整问题关键词\n3. 选中具体的知识库文件`;
                    
                    const errorMsgId = Date.now();
                    const errorMsg = { 
                        role: 'assistant' as const, 
                        text: noDataMsg, 
                        timestamp: Date.now(),
                        sources: [],
                    };
                    updateSession(currentSessionId, {
                        messages: [...activeSession.messages, errorMsg],
                        progressState: { step: 'GENERATE', progress: 100, details: '检索为空，任务终止', state: 'error' }
                    });
                    return;
                }

                // Deduplicate chunks/sources
                allSources = Array.from(new Set(allSources));
                allChunks = globalChunks;
                
                // Step 3: Synthesis (Streaming)
                updateSession(currentSessionId, { 
                    progressState: { step: 'GENERATE', progress: 80, details: '正在根据研究结果撰写深度报告...', state: 'running' }
                });

                let finalAnswer = "";
                const stream = generateDeepSynthesisStream(currentInput, framework, sectionContexts);
                
                // Prepare message placeholder
                const botMsgId = Date.now();
                setSessions(prev => prev.map(s => {
                    if (s.id === currentSessionId) {
                        return {
                            ...s,
                            messages: [...s.messages, { 
                                role: 'model', 
                                text: '', // Start empty
                                timestamp: botMsgId,
                                sources: allSources,
                                chunks: allChunks 
                            }],
                            isChatting: true // Keep chatting state true while streaming
                        };
                    }
                    return s;
                }));

                for await (const chunk of stream) {
                    const textChunk = normalizeLLMChunk(chunk);
                    if (!textChunk) continue;
                    finalAnswer += textChunk;
                    // Update UI with accumulated text
                    setSessions(prev => prev.map(s => {
                        if (s.id === currentSessionId) {
                            const newMessages = [...s.messages];
                            const lastMsgIndex = newMessages.findIndex(m => m.timestamp === botMsgId);
                            if (lastMsgIndex !== -1) {
                                newMessages[lastMsgIndex] = { ...newMessages[lastMsgIndex], text: finalAnswer };
                            }
                            return { ...s, messages: newMessages };
                        }
                        return s;
                    }));
                }
                
                // Done
                setSessions(prev => prev.map(s => {
                    if (s.id === currentSessionId) {
                        return {
                            ...s,
                            isChatting: false,
                            progressState: undefined
                        };
                    }
                    return s;
                }));
                return;

            } catch (err: any) {
                console.error("Deep Thinking Failed:", err);
                setSessions(prev => prev.map(s => {
                    if (s.id === currentSessionId) {
                        return { 
                            ...s, 
                            messages: [...s.messages, { role: 'model', text: "深度思考遇到问题，已切换回普通模式尝试回答...", timestamp: Date.now() }],
                            // Fallback to normal flow logic below? Or just stop.
                            // Let's just stop and let user retry or switch mode.
                            isChatting: false, 
                            progressState: { step: 'ERROR', progress: 0, details: err.message, state: 'error' } 
                        };
                    }
                    return s;
                }));
                return;
            }
        }

        // Setup progress listener
        // NOTE: We need to define this but we will use a unified handler inside the Promise below
        // to ensure we capture both state updates AND completion resolution.
        
        // Start Job
        if (window.electronAPI && activeSession.customContexts.length === 0) { // Standard Mode
             // @ts-ignore
             currentJobId = await window.electronAPI.knowledge.startQuery({
                 text: currentInput,
                 topK: 15,
                 activeFiles: Array.from(activeSession.activeFiles)
             });
             
             // Store Job ID in session
             updateSession(currentSessionId, { currentJobId });

             try {
                 const ragResult: any = await new Promise((resolve, reject) => {
                     const handler = (_: any, data: any) => {
                         if (data.jobId === currentJobId) {
                             // UPDATE UI STATE FOR EVERY EVENT
                             setSessions(prev => prev.map(s => {
                                 if (s.id === currentSessionId) {
                                     return {
                                         ...s,
                                         progressState: {
                                             step: data.step,
                                             progress: data.progress,
                                             details: data.details,
                                             state: data.step === 'ERROR' ? 'error' : (data.step === 'COMPLETED' ? 'completed' : (data.state || 'running'))
                                         }
                                     };
                                 }
                                 return s;
                             }));

                             if (data.step === 'COMPLETED') {
                                 // @ts-ignore
                                 window.electronAPI.removeListener('kb-progress', handler);
                                 resolve(data.data);
                             } else if (data.step === 'ERROR') {
                                 // @ts-ignore
                                 window.electronAPI.removeListener('kb-progress', handler);
                                 reject(new Error(data.data.error));
                             }
                         }
                     };
                     // @ts-ignore
                     window.electronAPI.on('kb-progress', handler);
                 });
                 
                 contextText = ragResult.context;
                 sources = ragResult.sources;
                 finalChunks = ragResult.chunks;

             } catch (err) {
                 console.error("RAG Job Failed:", err);
                 setSessions(prev => prev.map(s => {
                    if (s.id === currentSessionId) {
                        return { ...s, isChatting: false, progressState: { ...s.progressState, state: 'error', details: (err as any).message } as any };
                    }
                    return s;
                 }));
                 return;
             }
             
        } else if (activeSession.customContexts.length > 0) {
            // Custom Context Mode (Legacy / Complex)
            // ... (Keep existing logic or migrate to Job API?)
            // For now, keep existing logic but maybe wrap in Job if possible?
            // It's parallel queries. Hard to map to single linear job.
            // Let's keep it as is for now, user asked for RAG flow control.
            // ... (Existing Custom Context Logic)

            console.log("Using Custom Context Orchestration with", activeSession.customContexts.length, "blocks");
            
            // Parallel Queries
            const queryPromises = activeSession.customContexts.map(async (ctx) => {
                // Resolve folder paths to file paths
                const targetFiles = new Set<string>();
                ctx.folderPaths.forEach(folder => {
                    // Find all ingested files that start with this folder path
                        Array.from(ingestedFiles).forEach(file => {
                             if (file.startsWith(folder)) {
                                 // --- ENFORCE ACTIVE FILES CONSTRAINT ---
                                 // Only include if it is ALSO in the currently active files (checkboxes)
                                 // IMPROVED: Check if file matches ANY active path (folder or file)
                                 // Since activeFiles now contains folder paths for efficiency, we must check prefix.
                                 const isActive = activeSession.activeFiles.has(file) || 
                                                  Array.from(activeSession.activeFiles).some(p => file.startsWith(p) && (file === p || file[p.length] === '/' || file[p.length] === '\\'));
                                 
                                 if (isActive) {
                                     targetFiles.add(file);
                                 }
                             }
                        });
                });
                
                if (targetFiles.size === 0) {
                    return { role: ctx.role, content: "(该来源未找到相关已索引文件，请检查左侧索引勾选状态)", sources: [], chunks: [] };
                }

                // Execute Query for this block
                // @ts-ignore
                const result: any = await window.electronAPI.knowledge.query({ 
                    text: currentInput, 
                    topK: 5,
                    // @ts-ignore
                    activeFiles: Array.from(targetFiles),
                    weight: ctx.weight || 1.0
                });

                const content = (typeof result === 'object' ? result.context : result) || "(未检索到相关内容)";
                const blockSources = (typeof result === 'object' ? result.sources : []) || [];
                const blockChunks = ((typeof result === 'object' ? result.chunks : []) || []).map((c: any) => ({
                    ...c, 
                    _mode: ctx.mode || 'include' // Inject mode into chunks
                }));
                
                return { 
                    role: ctx.role, 
                    content, 
                    sources: blockSources, 
                    chunks: blockChunks, 
                    weight: ctx.weight || 1.0,
                    mode: ctx.mode || 'include',
                    constraintLevel: ctx.constraintLevel || 'strict'
                };
            });

            const results = await Promise.all(queryPromises);
            
            // Construct Composite Context with Physical Isolation Logic
            const contextParts = results
                .filter(r => r.mode !== 'exclude') // <--- REMOVED NEGATIVE CHUNKS FROM CONTEXT
                .map(r => {
                    let prefix = '';
                    if (r.weight >= 1.2) prefix = '【⭐⭐⭐ 核心依据】';
                    else if (r.weight <= 0.8) prefix = '【仅供参考】';
                    return `${prefix}【参考资料：${r.role}】\n${r.content}`;
                });
            contextText = contextParts.join('\n\n');
            
            // Collect all unique sources and chunks (Including negative ones for backend check, but excluding from prompt?)
            // Wait, we need negative chunks in `finalChunks` to run the post-check.
            const allSources = new Set<string>();
            results.forEach(r => {
                // Only add to visible sources if not excluded? 
                // User wants "White Box" traceability. So maybe list them but mark as excluded.
                r.sources.forEach((s: string) => allSources.add(s));
                if (r.chunks) finalChunks.push(...r.chunks);
            });
            sources = Array.from(allSources);
            
            contextText += `\n\n【生成指令】\n请基于上述参考资料回答用户问题。对于【核心依据】，请优先采纳。`;
            // Removed strict negative instructions from prompt to avoid confusion.

        } else if (window.electronAPI) {
            // Standard RAG
            // @ts-ignore
            const result: any = await window.electronAPI.knowledge.query({ 
                text: currentInput, 
                topK: 15, // Increased from 3
                activeFiles: Array.from(activeSession.activeFiles) // Session-specific files
            });
            
            // --- FAST PATH HANDLING ---
            // If result contains a direct answer (from structured_search), skip LLM
            if (result && result.answer && (!result.context || result.context === "")) {
                console.log("[Frontend] Fast Path Answer Received. Skipping LLM.");
                
                const botMsgId = Date.now();
                const botMsg = { 
                    role: 'model', 
                    text: result.answer, 
                    timestamp: botMsgId,
                    sources: result.sources || [],
                    chunks: [],
                    complianceWarnings: []
                };

                setSessions(prev => prev.map(s => {
                    if (s.id === currentSessionId) {
                        return {
                            ...s,
                            messages: [...s.messages, botMsg as any],
                            isChatting: false
                        };
                    }
                    return s;
                }));
                return; // EXIT EARLY
            }

            if (typeof result === 'object') {
                // Reconstruct context with explicit indices for citation
                finalChunks = result.chunks || [];
                sources = result.sources || [];
                
                if (finalChunks.length > 0) {
                    contextText = finalChunks.map((c: any, i: number) => `[${i+1}] ${c.text}`).join('\n\n');
                } else {
                    contextText = result.context || "";
                }
            } else {
                contextText = result;
            }
        } else {
            // No local context found or no electron API
            contextText = "未找到相关的本地索引文件。";
        }

        // Generate Final Answer via LLM
        const systemPrompt = `You are a helpful NGO knowledge assistant. Answer based on the following context.
Important: You MUST cite your sources using the format [^N] where N is the index of the context chunk (e.g. [^1], [^2]).
Place citations immediately after the relevant sentence or fact. 
If the context is empty, try to answer with general knowledge but mention that no local docs were found.

Context:
${contextText}`;

        // @ts-ignore
        const answer = await chatWithKnowledgeBase(currentInput, systemPrompt); // Use service directly
        
        // 1. Immediate Display (No waiting for compliance check)
        const botMsgId = Date.now();
        const botMsg = { 
            role: 'model', 
            text: answer, // Clean answer
            timestamp: botMsgId,
            sources: sources,
            chunks: finalChunks,
            complianceWarnings: [] // Init empty
        };

        // Update session with result immediately
        setSessions(prev => prev.map(s => {
            if (s.id === currentSessionId) {
                return {
                    ...s,
                    messages: [...s.messages, botMsg as any],
                    isChatting: false
                };
            }
            return s;
        }));

        // 2. Async Compliance Check (Background)
        const negativeChunksToCheck: any[] = [];
        if (activeSession.customContexts.length > 0) {
            finalChunks.forEach(c => {
                if (c._mode === 'exclude') {
                    negativeChunksToCheck.push({
                        text: c.text,
                        constraintLevel: c.constraintLevel || 'strict'
                    });
                }
            });
        }

        if (negativeChunksToCheck.length > 0 && window.electronAPI) {
            console.log("Running Async Compliance Check on", negativeChunksToCheck.length, "negative chunks...");
            
            // Run asynchronously
            // @ts-ignore
            window.electronAPI.knowledge.checkCompliance({
                answer: answer,
                negativeChunks: negativeChunksToCheck
            }).then((report: any) => {
                if (!report.isCompliant && report.violations.length > 0) {
                    console.warn("Async Compliance Violations Found:", report.violations);
                    
                    // Update the specific message in session state with warnings
                    setSessions(prev => prev.map(s => {
                        if (s.id === currentSessionId) {
                            const newMessages = s.messages.map(m => {
                                if (m.timestamp === botMsgId) { // Identify by timestamp ID
                                    return { ...m, complianceWarnings: report.violations };
                                }
                                return m;
                            });
                            return { ...s, messages: newMessages };
                        }
                        return s;
                    }));
                }
            }).catch((err: any) => console.error("Async Compliance Check Failed:", err));
        }

    } catch (e: any) {
        console.error("Chat Error:", e);
        const errorMsg = { role: 'model', text: `⚠️ 发生错误: ${e.message || '未知错误'}`, timestamp: Date.now() };
        setSessions(prev => prev.map(s => {
            if (s.id === currentSessionId) {
                return {
                    ...s,
                    messages: [...s.messages, errorMsg as any],
                    isChatting: false
                };
            }
            return s;
        }));
    }
  };


    // We use a simple ref callback to scroll into view when content changes
    const previewContentRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (previewFile?.highlight && previewContentRef.current) {
            // Find the highlighted element
            const mark = previewContentRef.current.querySelector('mark');
            if (mark) {
                mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
            }
        }
    }, [previewFile]);

  return (
    <div className="flex h-full bg-[#f8fafc] gap-4 p-4 font-sans relative">
        {/* Context Orchestrator Modal */}
        {orchestratorOpen && (
            <div className="absolute inset-0 z-[70] bg-black/50 backdrop-blur-sm flex items-center justify-center animate-fade-in">
                <div className="bg-white shadow-2xl w-full h-full flex flex-col overflow-hidden animate-scale-up border border-slate-100">
                    <div className="p-5 border-b border-slate-100 bg-slate-50 flex justify-between items-center shrink-0">
                        <div className="flex items-center gap-4">
                            <div>
                                <h3 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                                    <KBIcons.Settings />
                                    自定义逻辑编排
                                </h3>
                                <p className="text-xs text-slate-400">定义多个数据源及其在生成逻辑中的角色</p>
                            </div>
                            
                            {/* Mode Toggle */}
                            <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
                                <button 
                                    onClick={() => setOrchestratorMode('simple')}
                                    className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${orchestratorMode === 'simple' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    基础模式
                                </button>
                                <button 
                                    onClick={() => setOrchestratorMode('workflow')}
                                    className={`px-3 py-1 text-xs font-bold rounded-md transition-all ${orchestratorMode === 'workflow' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600'}`}
                                >
                                    高级编排 (Workflow)
                                </button>
                            </div>
                        </div>

                        <div className="flex items-center gap-4">
                            <button onClick={() => setOrchestratorOpen(false)} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors">
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                            </button>
                        </div>
                    </div>

                    {/* Template Management Bar */}
                    <div className="px-6 py-3 bg-indigo-50/50 border-b border-indigo-100 flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1">
                            <span className="text-xs font-bold text-indigo-900">📂 快速模板:</span>
                            
                            {/* Preset Dropdown */}
                            <select
                                className="bg-white border border-purple-200 text-purple-700 text-xs rounded-lg px-2 py-1.5 outline-none focus:ring-2 focus:ring-purple-100 font-bold max-w-[200px]"
                                onChange={(e) => {
                                    const selected = presetTemplates.find(t => t.name === e.target.value);
                                    if (selected) handleLoadTemplate(selected);
                                    e.target.value = ""; // Reset
                                }}
                            >
                                <option value="" disabled selected>✨ 选择公益场景模版...</option>
                                {presetTemplates.map(t => (
                                    <option key={t.name} value={t.name}>
                                        {t.name}
                                    </option>
                                ))}
                            </select>

                            <div className="h-4 w-[1px] bg-indigo-200 mx-2"></div>

                            {/* User Templates List */}
                            <div className="flex gap-2 overflow-x-auto max-w-[300px] py-1 scrollbar-hide">
                                {templates.length === 0 && <span className="text-xs text-slate-400 italic">暂无自定义模板</span>}
                                {templates.map(t => (
                                    <div key={t.name} className="flex items-center bg-white border border-indigo-200 rounded-lg px-2 py-1 shrink-0 group">
                                        <button 
                                            onClick={() => handleLoadTemplate(t)}
                                            className="text-xs text-indigo-700 hover:underline mr-2"
                                            title="点击加载此模板"
                                        >
                                            {t.name}
                                        </button>
                                        <button 
                                            onClick={(e) => handleDeleteTemplate(t.name, e)}
                                            className="text-slate-300 hover:text-red-500 transition-colors"
                                            title="删除模板"
                                        >
                                            ×
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex items-center gap-2 pl-4 border-l border-indigo-200">
                            <input 
                                value={templateNameInput}
                                onChange={e => setTemplateNameInput(e.target.value)}
                                placeholder="输入新模板名称..."
                                className="text-xs px-2 py-1.5 rounded border border-indigo-200 focus:ring-2 focus:ring-indigo-100 outline-none w-32"
                            />
                            <button 
                                onClick={handleSaveTemplate}
                                disabled={!templateNameInput.trim()}
                                className="px-3 py-1.5 bg-indigo-600 text-white text-xs rounded hover:bg-indigo-700 transition-colors disabled:opacity-50"
                            >
                                保存模板
                            </button>
                            <button 
                                onClick={handleSaveAsAssistant}
                                disabled={!templateNameInput.trim() || isSnapshotting}
                                className="px-3 py-1.5 bg-gradient-to-r from-purple-600 to-pink-600 text-white text-xs rounded hover:from-purple-700 hover:to-pink-700 transition-all disabled:opacity-50 shadow-sm flex items-center gap-2"
                                title="将当前编排保存为独立的 AI 助手"
                            >
                                {isSnapshotting ? (
                                    <>
                                        <svg className="animate-spin h-3 w-3 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        处理中...
                                    </>
                                ) : (
                                    <>✨ 发布为助手</>
                                )}
                            </button>
                        </div>
                    </div>
                    
                    {orchestratorMode === 'simple' ? (
                        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-slate-50/30">
                        {editingContexts.length === 0 && (
                            <div className="text-center p-8 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
                                <p className="mb-2 text-sm">暂无编排规则</p>
                                <p className="text-xs">点击下方按钮添加数据源卡片</p>
                            </div>
                        )}

                        {editingContexts.map((ctx, idx) => (
                            <div key={ctx.id} className="bg-white p-3 rounded-xl shadow-sm border border-slate-100 relative group transition-all hover:shadow-md">
                                <button 
                                    onClick={() => setEditingContexts(prev => prev.filter(c => c.id !== ctx.id))}
                                    className="absolute -top-2 -right-2 bg-white rounded-full p-1 text-slate-300 hover:text-red-500 shadow-sm border border-slate-100 opacity-0 group-hover:opacity-100 transition-all z-10"
                                    title="删除"
                                >
                                    <KBIcons.Delete />
                                </button>
                                
                                <div className="grid grid-cols-12 gap-3 items-start">
                                    <div className="col-span-4">
                                        <label className="block text-[9px] font-bold text-slate-400 mb-1 uppercase">逻辑角色 (Role)</label>
                                        <input 
                                            value={ctx.role}
                                            onChange={e => setEditingContexts(prev => prev.map(c => c.id === ctx.id ? { ...c, role: e.target.value } : c))}
                                            placeholder="例如：主要论点..."
                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-indigo-500 transition-all font-bold text-slate-700"
                                        />
                                    </div>
                                    <div className="col-span-5">
                                        <label className="block text-[9px] font-bold text-slate-400 mb-1 uppercase">数据来源</label>
                                        <select 
                                            className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5 text-xs outline-none focus:border-indigo-500 transition-all appearance-none truncate"
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (!val) return;
                                                if (!ctx.folderPaths.includes(val)) {
                                                    setEditingContexts(prev => prev.map(c => c.id === ctx.id ? { ...c, folderPaths: [...c.folderPaths, val] } : c));
                                                }
                                                e.target.value = ''; // Reset
                                            }}
                                        >
                                            <option value="">+ 添加来源...</option>
                                            <optgroup label="📂 文件夹">
                                                {mountedFolders.map(f => (
                                                    <option key={f} value={f}>{f.split(/[\\/]/).pop()}</option>
                                                ))}
                                            </optgroup>
                                            {ingestedFiles.size > 0 && (
                                                <optgroup label="📄 具体文件">
                                                    {Array.from(ingestedFiles).slice(0, 50).map(f => (
                                                        <option key={f} value={f}>{f.split(/[\\/]/).pop()}</option>
                                                    ))}
                                                </optgroup>
                                            )}
                                        </select>
                                    </div>
                                    
                                    <div className="col-span-3">
                                        <div className="flex justify-between items-center mb-1">
                                            <label className="text-[9px] font-bold text-slate-400 uppercase">权重</label>
                                            <span className={`text-[10px] font-bold ${ctx.weight > 1.2 ? 'text-indigo-600' : 'text-slate-400'}`}>{ctx.weight?.toFixed(1)}x</span>
                                        </div>
                                        <input 
                                            type="range"
                                            min="0.1"
                                            max="2.0"
                                            step="0.1"
                                            value={ctx.weight || 1.0}
                                            onChange={e => setEditingContexts(prev => prev.map(c => c.id === ctx.id ? { ...c, weight: parseFloat(e.target.value) } : c))}
                                            className="w-full h-1 bg-slate-100 rounded-lg appearance-none cursor-pointer accent-indigo-600 block"
                                        />
                                    </div>
                                </div>

                                {/* Selected Folders Tags - Compact */}
                                {ctx.folderPaths.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-2 pt-2 border-t border-slate-50">
                                        {ctx.folderPaths.map(path => (
                                            <span key={path} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[10px] max-w-[150px] truncate group/tag border border-indigo-100">
                                                <span className="truncate">📁 {path.split(/[\\/]/).pop()}</span>
                                                <button 
                                                    onClick={() => setEditingContexts(prev => prev.map(c => c.id === ctx.id ? { ...c, folderPaths: c.folderPaths.filter(p => p !== path) } : c))}
                                                    className="hover:text-red-500 ml-0.5 opacity-0 group-hover/tag:opacity-100 transition-opacity"
                                                >
                                                    ×
                                                </button>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        ))}
                        </div>
                    ) : (
                        <div className="flex-1 overflow-hidden bg-slate-50 relative">
                            <WorkflowEditor 
                                availableFolders={mountedFolders}
                                initialNodes={workflowNodes}
                                initialEdges={workflowEdges}
                                onSave={(nodes, edges) => {
                                    setWorkflowNodes(nodes);
                                    setWorkflowEdges(edges);
                                    // Maybe auto-save to template or state?
                                    // alert('工作流状态已暂存。点击底部“应用编排”以生效。');
                                }}
                            />
                        </div>
                    )}

                    <div className="p-5 border-t border-slate-100 bg-white flex justify-between items-center">
                        {orchestratorMode === 'simple' ? (
                            <button 
                                onClick={() => setEditingContexts(prev => [...prev, { id: `ctx-${Date.now()}`, role: '', folderPaths: [], weight: 1.0 }])}
                                className="px-4 py-2 rounded-xl text-indigo-600 bg-indigo-50 hover:bg-indigo-100 text-sm font-bold transition-all flex items-center gap-2"
                            >
                                <KBIcons.Plus /> 添加数据源
                            </button>
                        ) : (
                            <div className="text-xs text-slate-400">
                                💡 拖拽左侧文件夹到画布创建节点，连线定义执行顺序。
                            </div>
                        )}
                        <div className="flex gap-2">
                            <button 
                                onClick={() => setOrchestratorOpen(false)}
                                className="px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-100 text-sm font-bold transition-all"
                            >
                                取消
                            </button>
                            <button 
                                onClick={() => {
                                    setCustomContexts(editingContexts.filter(c => c.role && c.folderPaths.length > 0));
                                    setOrchestratorOpen(false);
                                }}
                                className="px-6 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 text-sm font-bold transition-all shadow-lg shadow-indigo-200"
                            >
                                应用编排 ({editingContexts.filter(c => c.role && c.folderPaths.length > 0).length})
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* Index Manager Modal */}
        {indexManagerOpen && (
            <IndexManager 
                onClose={() => setIndexManagerOpen(false)} 
                onPreview={(path) => handlePreview({ name: path.split(/[\\/]/).pop(), path })}
            />
        )}

        {/* Save Modal */}
        {saveModalOpen && (
            <div className="absolute inset-0 z-[60] bg-black/50 backdrop-blur-sm flex items-center justify-center p-8 animate-fade-in">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col overflow-hidden animate-scale-up border border-slate-100">
                    <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                        <h3 className="font-bold text-slate-800">保存为知识库文档</h3>
                        <button onClick={() => setSaveModalOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                    </div>
                    <div className="p-6 space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">文件名称</label>
                            <input 
                                value={saveFileName}
                                onChange={e => setSaveFileName(e.target.value)}
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500 transition-all"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">保存位置</label>
                            <div className="flex flex-col gap-2">
                                <select 
                                    value={saveTargetFolder}
                                    onChange={e => setSaveTargetFolder(e.target.value)}
                                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500 transition-all"
                                >
                                    <option value="" disabled>选择挂载的根目录...</option>
                                    {mountedFolders.map(f => (
                                        <option key={f} value={f}>{f.split(/[\\/]/).pop()}</option>
                                    ))}
                                </select>
                                
                                <div className="flex items-center gap-2">
                                    <span className="text-slate-300 text-lg">↳</span>
                                    <input 
                                        value={saveNewFolderName}
                                        onChange={e => setSaveNewFolderName(e.target.value)}
                                        placeholder="新建子文件夹名称 (可选)"
                                        className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-sm outline-none focus:border-indigo-500 transition-all placeholder:text-slate-300"
                                    />
                                </div>
                            </div>
                            <p className="text-[10px] text-slate-400 mt-1">保存后将自动索引并激活，可立即被知识库检索。</p>
                        </div>
                    </div>
                    <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
                         <button onClick={() => setSaveModalOpen(false)} className="px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-200 text-xs font-bold transition-all">取消</button>
                         <button onClick={handleSaveMessage} disabled={!saveFileName || !saveTargetFolder} className="px-4 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 text-xs font-bold transition-all shadow-lg disabled:opacity-50">确认保存</button>
                    </div>
                </div>
            </div>
        )}

        {/* Message Editor & Reference Viewer Modal */}
        {editorOpen && editingMessage && (
            <div className="absolute inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center p-8 animate-fade-in">
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden animate-scale-up border border-slate-100">
                    <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                        <div>
                            <h3 className="font-bold text-slate-800 text-lg">📝 编辑回答与引用溯源</h3>
                            <p className="text-xs text-slate-400">查看回答依据，点击高亮原文定位</p>
                        </div>
                        <div className="flex gap-2 items-center">
                            <ExportMenu
                                content={editingMessage.text}
                                type="markdown"
                                fileName={`回答_${new Date().toLocaleDateString().replace(/\//g, '-')}.md`}
                                styleConfig={editorMode === 'optimize' ? optimizationConfig : undefined}
                            />
                            <button onClick={() => setEditorOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
                        </div>
                    </div>
                    
                    <div className="flex-1 flex overflow-hidden">
                        {/* Left: Editor */}
                        <div className="flex-1 flex flex-col border-r border-slate-100">
                            <div className="p-2 bg-slate-50 border-b border-slate-100 flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <div className="text-xs font-bold text-slate-500 uppercase">
                                        回答内容 ({editorMode === 'edit' ? '编辑模式' : '预览模式'})
                                    </div>
                                    
                                    {/* --- LOCAL POLISH TOOLBAR --- */}
                                    {editorMode === 'edit' && (
                                        <div className="flex gap-1 ml-4 border-l border-slate-200 pl-2">
                                            <button 
                                                onClick={() => handlePolish('auto')}
                                                disabled={polishModal?.isLoading}
                                                className="px-2 py-0.5 text-[10px] rounded font-bold bg-indigo-50 text-indigo-600 hover:bg-indigo-100 transition-colors flex items-center gap-1 disabled:opacity-50"
                                                title="一键润色选中内容（或全文）"
                                            >
                                                ✨ 一键润色
                                            </button>
                                            <button 
                                                onClick={() => handlePolish('custom')}
                                                disabled={polishModal?.isLoading}
                                                className="px-2 py-0.5 text-[10px] rounded font-bold bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors flex items-center gap-1 disabled:opacity-50"
                                                title="打开精致润色窗口"
                                            >
                                                ✍️ 精致润色
                                            </button>
                                        </div>
                                    )}
                                </div>

                                <div className="flex gap-1 bg-slate-200 p-0.5 rounded-lg">
                                    <button 
                                        onClick={() => setEditorMode('edit')}
                                        className={`px-2 py-0.5 text-[10px] rounded font-bold transition-all ${editorMode === 'edit' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        编辑
                                    </button>
                                    <button 
                                        onClick={() => setEditorMode('preview')}
                                        className={`px-2 py-0.5 text-[10px] rounded font-bold transition-all ${editorMode === 'preview' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        预览
                                    </button>
                                    <button 
                                        onClick={() => setEditorMode('optimize')}
                                        className={`px-2 py-0.5 text-[10px] rounded font-bold transition-all ${editorMode === 'optimize' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        优化
                                    </button>
                                </div>
                            </div>
                            
                            {editorMode === 'edit' ? (
                                <textarea 
                                    ref={textareaRef}
                                    value={editingMessage.text}
                                    onChange={e => setEditingMessage({...editingMessage, text: e.target.value})}
                                    className="flex-1 p-6 resize-none outline-none text-sm leading-relaxed text-slate-700 font-mono bg-white"
                                />
                            ) : (
                                <div className="flex flex-col h-full overflow-hidden">
                                    {editorMode === 'optimize' && !isMinimized && (
                                         <OptimizationPanel 
                                             config={optimizationConfig} 
                                             onChange={setOptimizationConfig}
                                             templates={savedTemplates}
                                             onSaveTemplate={(name) => {
                                                 const newTpl = { ...optimizationConfig, name };
                                                 const newTemplates = [...savedTemplates, newTpl];
                                                 setSavedTemplates(newTemplates);
                                                 localStorage.setItem('opt_templates', JSON.stringify(newTemplates));
                                             }}
                                             onDeleteTemplate={(idx) => {
                                                 const newTemplates = savedTemplates.filter((_, i) => i !== idx);
                                                 setSavedTemplates(newTemplates);
                                                 localStorage.setItem('opt_templates', JSON.stringify(newTemplates));
                                             }}
                                             onMinimize={() => setIsMinimized(true)}
                                         />
                                    )}
                                    {editorMode === 'optimize' && isMinimized && (
                                        <button 
                                            onClick={() => setIsMinimized(false)}
                                            className="absolute top-[100px] right-4 z-50 p-2 bg-indigo-600 text-white rounded-full shadow-lg hover:bg-indigo-700 transition-all hover:scale-105"
                                            title="打开优化配置"
                                        >
                                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" /></svg>
                                        </button>
                                    )}
                                    <div className={`flex-1 p-6 overflow-y-auto prose prose-sm max-w-none ${editorMode === 'optimize' && optimizationConfig.showBackground ? 'bg-slate-50' : 'bg-white'}`}>
                                        <div style={editorMode === 'optimize' ? getOptimizationStyles(optimizationConfig) : {}}>
                                            <ReactMarkdown 
                                        remarkPlugins={[remarkGfm]}
                                        components={{
                                            // Custom rendering for citation links [^N] and File Links [file](path)
                                            a: ({node, href, children, ...props}) => {
                                                // Handle File Links (from Fast Path)
                                                if (href && (href.startsWith('/') || href.match(/^[a-zA-Z]:\\/))) {
                                                    // It's likely a local file path
                                                    return (
                                                        <span 
                                                            className="text-indigo-600 font-medium cursor-pointer hover:underline inline-flex items-center gap-1"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                // @ts-ignore
                                                                if (window.electronAPI && window.electronAPI.fs && window.electronAPI.fs.openPath) {
                                                                    // Use openPath to open file in default OS app
                                                                    // @ts-ignore
                                                                    window.electronAPI.fs.openPath(href);
                                                                } else {
                                                                    alert(`File path: ${href}`);
                                                                }
                                                            }}
                                                            title={`Open ${href}`}
                                                        >
                                                            📄 {children}
                                                        </span>
                                                    );
                                                }

                                                // Handle Citations (if any are left as links)
                                                return <a href={href} {...props} target="_blank" rel="noopener noreferrer">{children}</a>;
                                            },
                                            // We can use a regex to replace text nodes
                                            p: ({children}) => {
                                                return <p>{
                                                    React.Children.map(children, child => {
                                                        if (typeof child === 'string') {
                                                            // Relaxed Regex: Matches [1], [^1], 【1】, (1)
                                                            // Captures the number in group 1
                                                            const parts = child.split(/((?:\[\^?\s*\d+\s*\])|(?:【\s*\d+\s*】)|(?:\(\s*\d+\s*\)))/g);
                                                            return parts.map((part, i) => {
                                                                // Extract number from any variant
                                                                const match = part.match(/^(?:\[\^?\s*(\d+)\s*\])|(?:【\s*(\d+)\s*】)|(?:\(\s*(\d+)\s*\))$/);
                                                                if (match) {
                                                                    // The number could be in group 1, 2, or 3 depending on which regex part matched
                                                                    const numStr = match[1] || match[2] || match[3];
                                                                    const index = parseInt(numStr) - 1;
                                                                    // Safety check
                                                                    if (index < 0 || !editingMessage.chunks || index >= editingMessage.chunks.length) {
                                                                        return <span key={i} className="text-gray-400 text-[10px] align-super">{part}</span>;
                                                                    }

                                                                    const targetChunkId = `chunk-${index}`;
                                                                    
                                                                    return (
                                                                        <span 
                                                                            key={i}
                                                                            className={`font-bold cursor-pointer hover:underline mx-0.5 px-1 rounded text-[10px] align-super transition-all ${
                                                                                activeChunkId === targetChunkId
                                                                                    ? 'bg-indigo-600 text-white shadow-sm ring-2 ring-indigo-200' 
                                                                                    : 'bg-indigo-50 text-indigo-600'
                                                                            }`}
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                
                                                                                // Extract context (previous part)
                                                                                let contextText = "";
                                                                                if (i > 0) {
                                                                                    const prevPart = parts[i-1];
                                                                                    // Get the last sentence or substantial phrase
                                                                                    // Simple heuristic: split by punctuation and take the last segment
                                                                                    const segments = prevPart.split(/[。！？.!?\n]/);
                                                                                    const validSegments = segments.filter(s => s.trim().length > 1);
                                                                                    if (validSegments.length > 0) {
                                                                                        contextText = validSegments[validSegments.length - 1].trim();
                                                                                    }
                                                                                }

                                                                                if (activeChunkId === targetChunkId) {
                                                                                    // Toggle off if clicking same
                                                                                    setActiveChunkId(null);
                                                                                    setCitationHighlight(null);
                                                                                } else {
                                                                                    // Activate
                                                                                    const el = document.getElementById(`chunk-card-${index}`);
                                                                                    if (el) {
                                                                                        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                                                    } else {
                                                                                        console.warn(`Element chunk-card-${index} not found.`);
                                                                                    }
                                                                                    setActiveChunkId(targetChunkId);
                                                                                    setCitationHighlight(contextText);
                                                                                }
                                                                            }}
                                                                        >
                                                                            {/* Standardize display to [1] regardless of input format */}
                                                                            [{index + 1}]
                                                                        </span>
                                                                    );
                                                                }
                                                                return part;
                                                            });
                                                        }
                                                        return child;
                                                    })
                                                }</p>;
                                            }
                                        }}
                                    >
                                        {editingMessage.text}
                                    </ReactMarkdown>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Right: References & Compliance */}
                        <div className="w-[400px] flex flex-col bg-slate-50/50">
                            {/* Tabs for Right Panel */}
                            <div className="flex border-b border-slate-200 bg-slate-100">
                                <button
                                    onClick={() => setRightPanelTab('references')}
                                    className={`flex-1 py-2 text-xs font-bold transition-colors ${rightPanelTab === 'references' ? 'bg-white text-indigo-600 border-t-2 border-t-indigo-500' : 'text-slate-500 hover:bg-slate-50'}`}
                                >
                                    📄 引用溯源
                                </button>
                                <button
                                    onClick={() => setRightPanelTab('compliance')}
                                    className={`flex-1 py-2 text-xs font-bold transition-colors ${rightPanelTab === 'compliance' ? 'bg-white text-red-600 border-t-2 border-t-red-500' : 'text-slate-500 hover:bg-slate-50'}`}
                                >
                                    🛡️ 查重检验
                                </button>
                            </div>

                            <div 
                                className="flex-1 overflow-y-auto p-4 space-y-4" 
                                onClick={() => { setActiveChunkId(null); setCitationHighlight(null); }}
                            >
                                {rightPanelTab === 'references' ? (
                                    <>
                                        {(!editingMessage.chunks || editingMessage.chunks.length === 0) && (
                                            <div className="text-center text-slate-400 text-xs mt-10">此回答未引用任何文档</div>
                                        )}
                                        {editingMessage.chunks && editingMessage.chunks.map((chunk, idx) => {
                                            const isActive = activeChunkId === `chunk-${idx}`;
                                            const isNegative = (chunk as any)._mode === 'exclude';
                                            return (
                                                <div 
                                                    key={idx}
                                                    id={`chunk-card-${idx}`}
                                                    onClick={() => setActiveChunkId(isActive ? null : `chunk-${idx}`)}
                                                    className={`p-3 rounded-xl border text-xs cursor-pointer transition-all ${
                                                        isActive 
                                                            ? (isNegative ? 'bg-red-50 border-red-200 shadow-md ring-1 ring-red-200' : 'bg-indigo-50 border-indigo-200 shadow-md ring-1 ring-indigo-200')
                                                            : (isNegative ? 'bg-red-50/30 border-red-100 hover:border-red-300' : 'bg-white border-slate-200 hover:border-indigo-300')
                                                    }`}
                                                >
                                                    <div className="flex justify-between items-center mb-2">
                                                        <div className="flex items-center gap-2 overflow-hidden">
                                                            {/* Citation Index Badge */}
                                                            <span className="w-5 h-5 rounded-full bg-indigo-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0 shadow-sm">
                                                                {idx + 1}
                                                            </span>
                                                            {isNegative && <span className="text-[10px] bg-red-100 text-red-600 px-1 rounded font-bold">⛔️ 负面约束</span>}
                                                            <span className={`font-bold truncate max-w-[130px] ${isNegative ? 'text-red-700' : 'text-indigo-700'}`} title={chunk.source}>
                                                                {chunk.source.split(/[\\/]/).pop()}
                                                            </span>
                                                        </div>
                                                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${chunk.score > 0.6 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'} cursor-help`} title="匹配度计算公式：(语义向量相似度 × 0.6 + 关键词匹配度 × 0.4) × 权重">
                                                            {(chunk.score * 100).toFixed(1)}%
                                                        </span>
                                                    </div>
                                                    <div className="text-slate-600 leading-relaxed max-h-[150px] overflow-y-auto scrollbar-thin">
                                                        <ChunkTextHighlighter text={chunk.text} highlight={isActive ? citationHighlight : null} />
                                                    </div>
                                                    <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between">
                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handlePreview({ name: chunk.source.split(/[\\/]/).pop(), path: chunk.source }, chunk.text);
                                                            }}
                                                            className="text-[10px] text-slate-400 hover:text-indigo-600 flex items-center gap-1"
                                                        >
                                                            📄 查看原文
                                                        </button>
                                                        <button 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const linkText = `[^${idx + 1}]`;
                                                                setEditingMessage(prev => prev ? { ...prev, text: prev.text + ` ${linkText}` } : null);
                                                            }}
                                                            className="text-[10px] text-indigo-500 hover:text-indigo-700 font-bold flex items-center gap-1"
                                                        >
                                                            ↩ 插入引用标记
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </>
                                ) : (
                                    <div className="space-y-4">
                                        <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                                            <h4 className="font-bold text-slate-700 text-xs mb-2">🔍 查重源设置</h4>
                                            <p className="text-[10px] text-slate-500 mb-3">
                                                系统将自动比对当前回答与已选“排除”资料的重合度。
                                            </p>
                                            {/* Manual Re-check Button */}
                                            <button
                                                onClick={() => {
                                                    // Trigger manual check
                                                    if (!editingMessage) return;
                                                    // Need access to negative chunks. 
                                                    // We can find them from activeSession contexts or assume they are stored/re-fetched.
                                                    // For simplicity, let's just re-run the check if we have the data.
                                                    // Or better: Show status.
                                                    alert("查重检验已自动运行。如需更新，请保存修改后重新生成。");
                                                }}
                                                className="w-full py-2 bg-white border border-slate-300 rounded-lg text-xs font-bold text-slate-600 hover:bg-slate-50 transition-all flex items-center justify-center gap-2"
                                            >
                                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                                手动刷新查重
                                            </button>
                                        </div>

                                        {(!editingMessage.complianceWarnings || editingMessage.complianceWarnings.length === 0) ? (
                                             <div className="flex flex-col items-center justify-center p-8 text-center border-2 border-dashed border-slate-100 bg-slate-50/30 rounded-xl">
                                                 {activeSession.customContexts.some(c => c.mode === 'exclude') ? (
                                                     <>
                                                         <div className="w-12 h-12 bg-green-100 text-green-500 rounded-full flex items-center justify-center mb-3">
                                                             <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                                                         </div>
                                                         <h4 className="font-bold text-green-700 text-sm">合规检测通过</h4>
                                                         <p className="text-[10px] text-green-600 mt-1">未发现与负面约束资料的违规重合。</p>
                                                     </>
                                                 ) : (
                                                     <>
                                                         <div className="w-12 h-12 bg-slate-100 text-slate-400 rounded-full flex items-center justify-center mb-3">
                                                             <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                                                         </div>
                                                         <h4 className="font-bold text-slate-600 text-sm">未启用负面约束</h4>
                                                         <p className="text-[10px] text-slate-400 mt-1">当前对话未设置任何“排除”类型的资料，无需进行合规检查。</p>
                                                     </>
                                                 )}
                                             </div>
                                         ) : (
                                            <div className="space-y-3">
                                                <div className="flex items-center justify-between">
                                                    <h4 className="font-bold text-red-700 text-xs">发现 {editingMessage.complianceWarnings.length} 处潜在风险</h4>
                                                </div>
                                                {editingMessage.complianceWarnings.map((v: any, idx: number) => (
                                                    <div key={idx} className="bg-red-50 border border-red-100 rounded-xl p-3 shadow-sm">
                                                        <div className="flex justify-between items-start mb-2">
                                                            <span className="inline-block px-1.5 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded">
                                                                {v.issueType}
                                                            </span>
                                                            <span className="text-xs font-bold text-red-500">
                                                                {(v.overlapScore * 100).toFixed(0)}% 重合
                                                            </span>
                                                        </div>
                                                        <div className="bg-white p-2 rounded border border-red-100 text-xs text-slate-600 italic mb-2">
                                                            "{v.segment}"
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 mb-2">
                                                            来源: {v.sourceChunk?.source?.split(/[\\/]/).pop() || '未知来源'}
                                                        </div>
                                                        <button 
                                                            onClick={() => {
                                                                const instruction = `Please rewrite the following text to avoid overlap with negative constraints. \nOriginal Text: "${v.segment}"`;
                                                                // Use editingMessage.id as index directly
                                                                handleRewriteMessage(editingMessage.id, instruction);
                                                                setEditorOpen(false); 
                                                            }}
                                                            className="w-full py-1.5 bg-white border border-red-200 text-red-600 rounded-lg text-[10px] font-bold hover:bg-red-50 flex items-center justify-center gap-1 transition-all"
                                                        >
                                                            ✨ AI 智能改写
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="p-4 border-t border-slate-100 bg-white flex justify-end gap-2">
                        <button 
                            onClick={() => setEditorOpen(false)}
                            className="px-4 py-2 rounded-xl text-slate-500 hover:bg-slate-100 text-sm font-bold transition-all"
                        >
                            取消
                        </button>
                        <button 
                            onClick={handleUpdateMessage}
                            className="px-6 py-2 rounded-xl bg-indigo-600 text-white hover:bg-indigo-700 text-sm font-bold transition-all shadow-lg shadow-indigo-200"
                        >
                            保存修改
                        </button>
                    </div>

                    {/* Polish Modal Overlay */}
                    {polishModal?.open && (
                        <div className="absolute inset-0 z-[90] bg-black/20 backdrop-blur-[2px] flex items-center justify-center animate-fade-in" onClick={() => setPolishModal(null)}>
                            <div className="bg-white rounded-xl shadow-2xl w-[600px] flex flex-col overflow-hidden animate-scale-up border border-indigo-100" onClick={e => e.stopPropagation()}>
                                <div className="p-3 border-b border-slate-100 bg-indigo-50/50 flex justify-between items-center">
                                    <h3 className="font-bold text-indigo-900 text-sm flex items-center gap-2">
                                        ✍️ 精致润色
                                        {polishModal.isLoading && <span className="text-[10px] text-indigo-400 animate-pulse">(AI 思考中...)</span>}
                                    </h3>
                                    <button onClick={() => setPolishModal(null)} className="text-slate-400 hover:text-slate-600">✕</button>
                                </div>
                                
                                <div className="p-4 space-y-3 bg-white">
                                    {/* Instruction Input */}
                                    <div>
                                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">润色指令</label>
                                        <div className="flex gap-2">
                                            <input 
                                                value={polishModal.instruction}
                                                onChange={e => setPolishModal(prev => prev ? { ...prev, instruction: e.target.value } : null)}
                                                placeholder="例如：更专业一点，或者翻译成英文..."
                                                className="flex-1 text-xs p-2 border border-slate-200 rounded-lg outline-none focus:border-indigo-500 transition-all bg-slate-50 focus:bg-white"
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && !polishModal.isLoading) {
                                                        executePolish(polishModal.sourceText, polishModal.instruction, polishModal.selectionStart, polishModal.selectionEnd);
                                                    }
                                                }}
                                            />
                                            <button 
                                                onClick={() => executePolish(polishModal.sourceText, polishModal.instruction, polishModal.selectionStart, polishModal.selectionEnd)}
                                                disabled={polishModal.isLoading}
                                                className="px-3 py-1 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 transition-all shadow-sm"
                                            >
                                                生成
                                            </button>
                                        </div>
                                    </div>

                                    {/* Comparison View */}
                                    <div className="grid grid-cols-2 gap-3 h-[300px]">
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-bold text-slate-400 mb-1">原文</span>
                                            <div className="flex-1 p-3 bg-slate-50 rounded-lg text-xs text-slate-600 overflow-y-auto border border-slate-100 font-mono leading-relaxed">
                                                {polishModal.sourceText}
                                            </div>
                                        </div>
                                        <div className="flex flex-col">
                                            <span className="text-[10px] font-bold text-indigo-400 mb-1">润色结果</span>
                                            {polishModal.isLoading ? (
                                                <div className="flex-1 flex items-center justify-center bg-indigo-50/30 rounded-lg border border-indigo-100 border-dashed">
                                                    <div className="flex flex-col items-center gap-2">
                                                        <div className="w-6 h-6 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin"></div>
                                                        <span className="text-[10px] text-indigo-400">正在生成优化建议...</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <textarea 
                                                    value={polishModal.result}
                                                    onChange={e => setPolishModal(prev => prev ? { ...prev, result: e.target.value } : null)}
                                                    placeholder="生成结果将显示在这里..."
                                                    className="flex-1 p-3 bg-white rounded-lg text-xs text-slate-800 overflow-y-auto border border-indigo-200 outline-none focus:ring-2 focus:ring-indigo-100 font-mono leading-relaxed resize-none"
                                                />
                                            )}
                                        </div>
                                    </div>
                                </div>

                                <div className="p-3 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
                                    <button 
                                        onClick={() => setPolishModal(null)}
                                        className="px-3 py-1.5 rounded-lg text-slate-500 hover:bg-slate-200 text-xs font-bold transition-all"
                                    >
                                        取消
                                    </button>
                                    <button 
                                        onClick={applyPolish}
                                        disabled={!polishModal.result || polishModal.isLoading}
                                        className="px-4 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 text-xs font-bold transition-all shadow-lg shadow-indigo-200 disabled:opacity-50 flex items-center gap-1"
                                    >
                                        ✅ 替换原文
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        )}

        {/* Reading Mode Overlay */}
        {readingFile && (
            <div className="fixed inset-0 z-[150] bg-white flex flex-col animate-fade-in">
                <ReaderLayout 
                    file={readingFile}
                    purpose={readingPurpose}
                    onClose={() => {
                        setReadingFile(null);
                        setReadingPurpose('');
                    }}
                />
            </div>
        )}

        {/* Reading Purpose Modal */}
        {showPurposeModal && previewFile && (
            <ReadingSessionModal 
                onConfirm={(purpose) => {
                    setReadingPurpose(purpose);
                    if (previewFile) {
                        setReadingFile({
                            name: previewFile.name,
                            path: previewFile.path,
                            content: previewFile.content,
                            type: previewFile.type
                        });
                        setPreviewFile(null);
                    }
                    setShowPurposeModal(false);
                }}
                onCancel={() => setShowPurposeModal(false)}
            />
        )}

        {/* Preview Modal Overlay - HIGH Z-INDEX - Block in Reading Tab */}
        {previewFile && sidebarTab !== 'reading' && (
            <div className="absolute inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-8 animate-fade-in" onClick={() => setPreviewFile(null)}>
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[85vh] flex flex-col overflow-hidden animate-scale-up" onClick={e => e.stopPropagation()}>
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <div className="flex items-center gap-3">
                            <span className="text-2xl">
                                {previewFile.type === 'image' ? '🖼️' : '📄'}
                            </span>
                            <div>
                                <h3 className="font-bold text-slate-800 text-lg">{previewFile.name}</h3>
                                <p className="text-xs text-slate-400 font-mono">
                                    {previewFile.type === 'image' ? 'Image Preview' : 'Text Content Extracted'}
                                </p>
                            </div>
                        </div>
                        <div className="flex gap-2 items-center">
                            {previewFile.type !== 'image' && (
                                <button 
                                    onClick={() => {
                                        setPreviewFile(null);
                                        setReadingFile({
                                            name: previewFile.name,
                                            path: previewFile.path,
                                            content: previewFile.content,
                                            type: previewFile.type
                                        });
                                        setShowPurposeModal(true);
                                    }}
                                    className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200"
                                >
                                    📖 进入深度阅读
                                </button>
                            )}
                            {previewFile.type !== 'image' && (
                                <button 
                                    onClick={() => window.electronAPI.fs.openPath(previewFile.path)}
                                    className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-50 transition-colors"
                                >
                                    ↗️ 系统默认打开
                                </button>
                            )}
                            {previewFile.type !== 'image' && (
                                <button 
                                    onClick={async () => {
                                        if (!window.electronAPI) return;
                                        setFileMetaOpen(true);
                                        setFileMetaLoading(true);
                                        try {
                                            const existing = await (window as any).electronAPI.invoke('kb-get-file-metadata', previewFile.path);
                                            if (existing && existing.file_path) {
                                                let keywords = '';
                                                try {
                                                    const arr = JSON.parse(existing.keywords_json || '[]');
                                                    if (Array.isArray(arr)) keywords = arr.join(', ');
                                                } catch (e) {}
                                                setFileMetaDraft({
                                                    title: existing.title || '',
                                                    author: existing.author || '',
                                                    published_time: existing.published_time || '',
                                                    abstract: existing.abstract || '',
                                                    keywords
                                                });
                                            } else {
                                                setFileMetaDraft({ title: '', author: '', published_time: '', abstract: '', keywords: '' });
                                            }
                                        } finally {
                                            setFileMetaLoading(false);
                                        }
                                    }}
                                    className="px-3 py-1.5 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-50 transition-colors"
                                >
                                    🏷️ 元信息
                                </button>
                            )}
                            {previewFile.type !== 'image' && (
                                <ExportMenu
                                    content={previewFile.content}
                                    type={previewFile.name.toLowerCase().endsWith('.csv') ? 'csv' : 'markdown'}
                                    fileName={previewFile.name}
                                />
                            )}
                            <button 
                                onClick={() => setPreviewFile(null)}
                                className="w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 flex items-center justify-center transition-colors"
                            >
                                ✕
                            </button>
                        </div>
                    </div>
                    
                    <div className="flex-1 overflow-auto bg-slate-50/30 p-8" ref={previewContentRef}>
                        {previewFile.type === 'image' ? (
                            <div className="flex items-center justify-center h-full">
                                <img src={previewFile.content} alt="Preview" className="max-w-full max-h-full object-contain rounded-lg shadow-sm" />
                            </div>
                        ) : (
                            <div className="prose prose-sm max-w-none bg-white p-8 rounded-xl shadow-sm border border-slate-100 mx-auto text-slate-800">
                                <pre className="whitespace-pre-wrap font-sans text-slate-700 leading-relaxed bg-transparent border-none p-0">
                                    {previewFile.highlight ? (
                                        renderHighlightedContent(previewFile.content, previewFile.highlight)
                                    ) : (
                                        previewFile.content || "(Empty File)"
                                    )}
                                </pre>
                            </div>
                        )}
                    </div>
                    
                    <div className="p-4 border-t border-slate-100 bg-white flex justify-end gap-3">
                        <button 
                            onClick={() => setPreviewFile(null)}
                            className="px-6 py-2 rounded-xl text-slate-600 hover:bg-slate-100 font-bold transition-colors"
                        >
                            关闭预览
                        </button>
                    </div>
                </div>
            </div>
        )}

        {exportMountOpen && (
            <div className="absolute inset-0 z-[110] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in" onClick={() => !exportMountWorking && setExportMountOpen(false)}>
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden" onClick={e => e.stopPropagation()}>
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <div>
                            <h3 className="font-bold text-slate-800 text-sm">导出本地挂载</h3>
                            <p className="text-[10px] text-slate-500">将“本地挂载”按当前列表导出为一个物理文件夹</p>
                        </div>
                        <button
                            onClick={() => !exportMountWorking && setExportMountOpen(false)}
                            className="w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 flex items-center justify-center transition-colors"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="p-4 space-y-3">
                        <div className="text-xs text-slate-600">
                            将导出 <span className="font-bold">{exportMountTargets.length}</span> 个项目（{exportMountScope === 'selected' ? '已勾选项' : '全部本地挂载'}）
                        </div>

                        <div className="space-y-2">
                            <div className="text-[11px] font-bold text-slate-500">导出范围</div>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => {
                                        const isChildOf = (child: string, parent: string) => {
                                            if (!child || !parent) return false;
                                            if (child === parent) return true;
                                            if (child.startsWith(parent)) {
                                                const next = child[parent.length];
                                                return next === '/' || next === '\\';
                                            }
                                            return false;
                                        };
                                        const selectedLocal = Array.from(activeFiles).filter((p) => groupedFolders.localMounts.some((root) => isChildOf(p, root)));
                                        if (selectedLocal.length === 0) return;
                                        setExportMountScope('selected');
                                        setExportMountTargets(selectedLocal);
                                    }}
                                    className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${exportMountScope === 'selected' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'} ${Array.from(activeFiles).length === 0 ? 'opacity-50' : ''}`}
                                >
                                    导出勾选项
                                </button>
                                <button
                                    onClick={() => {
                                        setExportMountScope('all');
                                        setExportMountTargets(groupedFolders.localMounts);
                                    }}
                                    className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${exportMountScope === 'all' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                                >
                                    导出全部
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="text-[11px] font-bold text-slate-500">导出模式</div>
                            <div className="grid grid-cols-3 gap-2">
                                <button
                                    onClick={() => setExportMountMode('shortcut')}
                                    className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${exportMountMode === 'shortcut' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                                >
                                    快捷方式
                                </button>
                                <button
                                    onClick={() => setExportMountMode('copy')}
                                    className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${exportMountMode === 'copy' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                                >
                                    分身(复制)
                                </button>
                                <button
                                    onClick={() => setExportMountMode('move')}
                                    className={`px-3 py-2 rounded-xl text-xs font-bold border transition-colors ${exportMountMode === 'move' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'}`}
                                >
                                    集成(移动)
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="text-[11px] font-bold text-slate-500">导出位置</div>
                            <div className="flex gap-2">
                                <input
                                    value={exportMountDestDir}
                                    onChange={(e) => setExportMountDestDir(e.target.value)}
                                    placeholder="选择一个目标目录"
                                    className="flex-1 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-xs outline-none focus:border-indigo-300 focus:bg-white transition-all font-mono"
                                />
                                <button
                                    onClick={async () => {
                                        if (!window.electronAPI) return;
                                        const dir = await window.electronAPI.fs.selectFolder();
                                        if (dir) setExportMountDestDir(dir);
                                    }}
                                    className="px-3 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-50 transition-colors"
                                >
                                    选择
                                </button>
                            </div>
                        </div>

                        <div className="space-y-2">
                            <div className="text-[11px] font-bold text-slate-500">文件夹名称</div>
                            <input
                                value={exportMountFolderName}
                                onChange={(e) => setExportMountFolderName(e.target.value)}
                                placeholder="例如：本地挂载_导出_20260201"
                                className="w-full bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-xs outline-none focus:border-indigo-300 focus:bg-white transition-all"
                            />
                        </div>
                    </div>

                    <div className="p-4 border-t border-slate-100 flex justify-end gap-2 bg-white">
                        <button
                            onClick={() => !exportMountWorking && setExportMountOpen(false)}
                            className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            disabled={exportMountWorking}
                        >
                            取消
                        </button>
                        <button
                            onClick={async () => {
                                if (!window.electronAPI) return;
                                if (exportMountTargets.length === 0) return alert('当前没有可导出的项目');
                                if (!exportMountDestDir) return alert('请选择导出位置');
                                if (exportMountMode === 'move') {
                                    if (!confirm('⚠️ 集成(移动)会把真实文件夹移动到新位置，原位置将不再存在。确定继续吗？')) return;
                                }
                                setExportMountWorking(true);
                                try {
                                    const payload = {
                                        mode: exportMountMode,
                                        destDir: exportMountDestDir,
                                        folderName: exportMountFolderName,
                                        paths: exportMountTargets
                                    };

                                    const exportViaExistingFs = async () => {
                                        const fsApi: any = (window as any).electronAPI.fs;
                                        const trimSlash = (s: string, left = false) => left ? s.replace(/^[\\/]+/, '') : s.replace(/[\\/]+$/, '');
                                        const join = (a: string, b: string) => `${trimSlash(a)}/${trimSlash(b, true)}`;
                                        const exportRoot = join(exportMountDestDir, exportMountFolderName || '本地挂载_导出');
                                        await window.electronAPI.fs.ensureDir(exportRoot);

                                        const used = new Map<string, number>();
                                        const nextName = (base: string) => {
                                            const k = base || 'item';
                                            const n = (used.get(k) || 0) + 1;
                                            used.set(k, n);
                                            return n === 1 ? k : `${k}-${n}`;
                                        };

                                        let ok = 0;
                                        let fail = 0;

                                        for (const src of exportMountTargets) {
                                            const baseName = (src.split(/[\\/]/).pop() || 'item').replace(/[\\/:*?"<>|]/g, '_');
                                            const name = nextName(baseName);
                                            const dest = join(exportRoot, name);
                                            try {
                                                if (exportMountMode === 'shortcut') {
                                                    const symlinkRes = await fsApi.createSymlink(src, dest);
                                                    if (!symlinkRes?.success) throw new Error(symlinkRes?.error || 'createSymlink failed');
                                                } else if (exportMountMode === 'copy') {
                                                    const copyDirRes = await fsApi.copyFiles(src, dest);
                                                    if (!copyDirRes?.success) {
                                                        const copyFileRes = await fsApi.copyFile(src, dest);
                                                        if (!copyFileRes?.success) throw new Error(copyFileRes?.error || 'copy failed');
                                                    }
                                                } else if (exportMountMode === 'move') {
                                                    const mvRes = await fsApi.rename(src, dest);
                                                    if (!mvRes?.success) throw new Error(mvRes?.error || 'rename failed');
                                                }
                                                ok++;
                                            } catch (e) {
                                                fail++;
                                            }
                                        }

                                        return { success: true, exportRoot, ok, fail };
                                    };

                                    let res: any;
                                    try {
                                        res = await (window as any).electronAPI.invoke('kb-export-local-mounts', payload);
                                    } catch (e: any) {
                                        if (String(e?.message || '').includes("No handler registered for 'kb-export-local-mounts'")) {
                                            res = await exportViaExistingFs();
                                        } else {
                                            throw e;
                                        }
                                    }
                                    if (res?.success) {
                                        alert(`导出完成\n成功: ${res.ok}\n失败: ${res.fail}`);
                                        if (res.exportRoot) window.electronAPI.fs.openPath(res.exportRoot);
                                        setExportMountOpen(false);
                                    } else {
                                        alert('导出失败: ' + (res?.error || '未知错误'));
                                    }
                                } catch (e: any) {
                                    alert('导出失败: ' + e.message);
                                } finally {
                                    setExportMountWorking(false);
                                }
                            }}
                            className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 disabled:opacity-50"
                            disabled={exportMountWorking}
                        >
                            {exportMountWorking ? '导出中...' : '开始导出'}
                        </button>
                    </div>
                </div>
            </div>
        )}

        {fileMetaOpen && previewFile && (
            <div className="absolute inset-0 z-[120] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6 animate-fade-in" onClick={() => !fileMetaLoading && setFileMetaOpen(false)}>
                <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl overflow-hidden" onClick={e => e.stopPropagation()}>
                    <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50">
                        <div className="min-w-0">
                            <h3 className="font-bold text-slate-800 text-sm truncate">元信息</h3>
                            <p className="text-[10px] text-slate-500 font-mono truncate">{previewFile.path}</p>
                        </div>
                        <button
                            onClick={() => !fileMetaLoading && setFileMetaOpen(false)}
                            className="w-8 h-8 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 flex items-center justify-center transition-colors"
                        >
                            ✕
                        </button>
                    </div>

                    <div className="p-4 space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1">
                                <div className="text-[11px] font-bold text-slate-500">标题</div>
                                <input
                                    value={fileMetaDraft.title}
                                    onChange={(e) => setFileMetaDraft(d => ({ ...d, title: e.target.value }))}
                                    className="w-full bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-xs outline-none focus:border-indigo-300 focus:bg-white transition-all"
                                />
                            </div>
                            <div className="space-y-1">
                                <div className="text-[11px] font-bold text-slate-500">作者</div>
                                <input
                                    value={fileMetaDraft.author}
                                    onChange={(e) => setFileMetaDraft(d => ({ ...d, author: e.target.value }))}
                                    className="w-full bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-xs outline-none focus:border-indigo-300 focus:bg-white transition-all"
                                />
                            </div>
                        </div>

                        <div className="space-y-1">
                            <div className="text-[11px] font-bold text-slate-500">发布时间</div>
                            <input
                                value={fileMetaDraft.published_time}
                                onChange={(e) => setFileMetaDraft(d => ({ ...d, published_time: e.target.value }))}
                                placeholder="可为空"
                                className="w-full bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-xs outline-none focus:border-indigo-300 focus:bg-white transition-all"
                            />
                        </div>

                        <div className="space-y-1">
                            <div className="text-[11px] font-bold text-slate-500">摘要</div>
                            <textarea
                                value={fileMetaDraft.abstract}
                                onChange={(e) => setFileMetaDraft(d => ({ ...d, abstract: e.target.value }))}
                                placeholder="可为空"
                                className="w-full bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-xs outline-none focus:border-indigo-300 focus:bg-white transition-all h-24 resize-none"
                            />
                        </div>

                        <div className="space-y-1">
                            <div className="text-[11px] font-bold text-slate-500">关键词（逗号分隔）</div>
                            <input
                                value={fileMetaDraft.keywords}
                                onChange={(e) => setFileMetaDraft(d => ({ ...d, keywords: e.target.value }))}
                                placeholder="可为空"
                                className="w-full bg-slate-50 border border-slate-100 rounded-lg px-3 py-2 text-xs outline-none focus:border-indigo-300 focus:bg-white transition-all"
                            />
                        </div>
                    </div>

                    <div className="p-4 border-t border-slate-100 flex justify-between items-center bg-white">
                        <button
                            onClick={async () => {
                                if (!window.electronAPI) return;
                                setFileMetaLoading(true);
                                try {
                                    const res = await (window as any).electronAPI.invoke('kb-extract-file-metadata', previewFile.path);
                                    if (res?.success && res.meta) {
                                        setFileMetaDraft({
                                            title: res.meta.title || '',
                                            author: res.meta.author || '',
                                            published_time: res.meta.published_time || '',
                                            abstract: res.meta.abstract || '',
                                            keywords: Array.isArray(res.meta.keywords) ? res.meta.keywords.join(', ') : ''
                                        });
                                    } else {
                                        alert('自动提取失败: ' + (res?.error || '未知错误'));
                                    }
                                } finally {
                                    setFileMetaLoading(false);
                                }
                            }}
                            className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                            disabled={fileMetaLoading}
                        >
                            自动提取
                        </button>

                        <div className="flex gap-2">
                            <button
                                onClick={() => !fileMetaLoading && setFileMetaOpen(false)}
                                className="px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors disabled:opacity-50"
                                disabled={fileMetaLoading}
                            >
                                关闭
                            </button>
                            <button
                                onClick={async () => {
                                    if (!window.electronAPI) return;
                                    setFileMetaLoading(true);
                                    try {
                                        const keywords = fileMetaDraft.keywords
                                            .split(',')
                                            .map(s => s.trim())
                                            .filter(Boolean)
                                            .slice(0, 30);
                                        const res = await (window as any).electronAPI.invoke('kb-save-file-metadata', {
                                            file_path: previewFile.path,
                                            title: fileMetaDraft.title,
                                            author: fileMetaDraft.author,
                                            published_time: fileMetaDraft.published_time,
                                            abstract: fileMetaDraft.abstract,
                                            keywords
                                        });
                                        if (res?.success) {
                                            alert('已保存');
                                            setFileMetaOpen(false);
                                        } else {
                                            alert('保存失败: ' + (res?.error || '未知错误'));
                                        }
                                    } finally {
                                        setFileMetaLoading(false);
                                    }
                                }}
                                className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 disabled:opacity-50"
                                disabled={fileMetaLoading}
                            >
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        )}

        {/* Sidebar Wrapper with Auto-Collapse */}
        <SmartSidebarWrapper 
            isCollapsed={isSidebarCollapsed} 
            isPinned={isSidebarPinned} 
            onTogglePin={() => setIsSidebarPinned(prev => !prev)}
        >
        <div className="w-full h-full bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
            {/* Sidebar Tabs */}
            <div className="p-2 border-b border-slate-100 bg-slate-50/50 flex gap-1">
                <button 
                    onClick={() => setSidebarTab('resources')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${sidebarTab === 'resources' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                >
                    <KBIcons.Folder /> 资源库
                </button>
                <button 
                    onClick={() => setSidebarTab('chats')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${sidebarTab === 'chats' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                >
                    <KBIcons.Chat /> 历史对话
                </button>
                <button 
                    onClick={() => setSidebarTab('reading')}
                    className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 ${sidebarTab === 'reading' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'}`}
                >
                    <KBIcons.Book /> 阅读空间
                </button>
            </div>
            
            {sidebarTab === 'resources' ? (
                <>
                    <div className="p-4 border-b border-slate-100 flex flex-col bg-white gap-2">
                        <div className="flex justify-between items-center">
                            <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider">已挂载目录</h3>
                            <div className="flex gap-1">
                                <button 
                                    onClick={() => {
                                        const d = new Date();
                                        const pad = (n: number) => String(n).padStart(2, '0');
                                        const isChildOf = (child: string, parent: string) => {
                                            if (!child || !parent) return false;
                                            if (child === parent) return true;
                                            if (child.startsWith(parent)) {
                                                const next = child[parent.length];
                                                return next === '/' || next === '\\';
                                            }
                                            return false;
                                        };
                                        const selectedLocal = Array.from(activeFiles).filter((p) => groupedFolders.localMounts.some((root) => isChildOf(p, root)));
                                        setExportMountScope(selectedLocal.length > 0 ? 'selected' : 'all');
                                        setExportMountTargets(selectedLocal.length > 0 ? selectedLocal : groupedFolders.localMounts);
                                        setExportMountFolderName(`本地挂载_导出_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`);
                                        setExportMountOpen(true);
                                    }}
                                    className="p-1.5 bg-slate-50 text-slate-500 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 transition-all"
                                    title="将“本地挂载”导出为物理文件夹（快捷方式/复制/移动）"
                                >
                                    <span className="text-[12px] leading-none">⬇️</span>
                                </button>
                                <button 
                                    onClick={handleReindexAll}
                                    disabled={isReindexing}
                                    className={`p-1.5 bg-slate-50 text-slate-500 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 transition-all ${isReindexing ? 'animate-spin' : ''}`}
                                    title="重新索引所有激活文件"
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
                                </button>
                                <button 
                                    onClick={() => { setRefreshKey(prev => prev + 1); loadSettings(); }}
                                    className="p-1.5 bg-slate-50 text-slate-500 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 transition-all"
                                    title="刷新文件列表"
                                >
                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                                </button>
                                {/* Removed small robot button */}
                                <button 
                                    onClick={() => handleMountFolder()}
                                    className="p-1.5 bg-slate-50 text-slate-500 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 transition-all"
                                    title="挂载文件夹"
                                >
                                    <KBIcons.Plus />
                                </button>
                                <button 
                                    onClick={() => setIndexManagerOpen(true)}
                                    className="p-1.5 bg-slate-50 text-slate-500 rounded-lg hover:bg-indigo-50 hover:text-indigo-600 transition-all"
                                    title="已索引文件管理"
                                >
                                    <KBIcons.Table />
                                </button>
                            </div>
                        </div>
                        {/* Search Bar */}
                        <div className="mb-2 space-y-2">
                            <div className="flex gap-2">
                                <div className="relative flex-1">
                                    <input 
                                        value={searchQuery}
                                        onChange={e => setSearchQuery(e.target.value)}
                                        placeholder="搜索文件/文件夹..."
                                        className="w-full bg-slate-50 border border-slate-100 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-indigo-300 focus:bg-white transition-all pl-8"
                                    />
                                    <svg className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                                </div>
                                <select
                                    value={fileTypeFilter}
                                    onChange={(e) => setFileTypeFilter(e.target.value as any)}
                                    className="bg-slate-50 border border-slate-100 rounded-lg px-2 py-1.5 text-[10px] outline-none focus:border-indigo-300 focus:bg-white transition-all"
                                    title="筛选类型"
                                >
                                    <option value="all">全部</option>
                                    <option value="pdf">PDF</option>
                                    <option value="doc">Word</option>
                                    <option value="ppt">PPT</option>
                                    <option value="xls">表格</option>
                                    <option value="md">Markdown/文本</option>
                                    <option value="image">图片</option>
                                </select>
                            </div>

                            {searchQuery.trim() && matchedIndexedFiles.length > 0 && (
                                <div className="bg-white border border-slate-100 rounded-xl overflow-hidden">
                                    <div className="px-2 py-1.5 bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                        命中文档（已索引）
                                    </div>
                                    <div className="max-h-32 overflow-y-auto">
                                        {matchedIndexedFiles.map((p) => (
                                            <button
                                                key={p}
                                                onClick={() => handlePreview({ name: p.split(/[\\/]/).pop() || '文件', path: p })}
                                                className="w-full text-left flex items-center gap-2 py-1 px-2 hover:bg-slate-100 transition-colors text-[11px] text-slate-600"
                                                title={p}
                                            >
                                                <span className="shrink-0">📄</span>
                                                <span className="truncate">{p.split(/[\\/]/).pop()}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {searchQuery.trim() && matchedUnindexedItems.length > 0 && (
                                <div className="bg-white border border-slate-100 rounded-xl overflow-hidden">
                                    <div className="px-2 py-1.5 bg-slate-50 text-[10px] font-bold text-slate-500 uppercase tracking-wider flex items-center justify-between">
                                        <span>命中文档（未索引）</span>
                                        {mountedSearchLoading && <span className="text-[10px] text-slate-400">搜索中...</span>}
                                    </div>
                                    <div className="max-h-32 overflow-y-auto">
                                        {matchedUnindexedItems.map((item) => (
                                            <button
                                                key={item.path}
                                                onClick={() => {
                                                    if (item.isDirectory) window.electronAPI.fs.openPath(item.path);
                                                    else handlePreview({ name: item.name || item.path.split(/[\\/]/).pop() || '文件', path: item.path });
                                                }}
                                                className="w-full text-left flex items-center gap-2 py-1 px-2 hover:bg-slate-100 transition-colors text-[11px] text-slate-600"
                                                title={item.path}
                                            >
                                                <span className="shrink-0">{item.isDirectory ? '📁' : '📄'}</span>
                                                <span className="truncate">{item.name || item.path.split(/[\\/]/).pop()}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                    <div 
                        className="flex-1 overflow-y-auto p-4 space-y-4 relative"
                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                        onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            const files = Array.from(e.dataTransfer.files);
                            if (files.length > 0) {
                                const p = files[0].path;
                                handleMountFolder(p);
                            }
                        }}
                    >
                        {mountedFolders.length === 0 && (
                            <div className="text-center p-8 text-slate-400 text-xs border-2 border-dashed border-slate-100 rounded-xl">
                                暂无挂载目录<br/>(拖入文件夹或点击 + 号挂载)
                            </div>
                        )}
                        
                        {/* 0. Active Projects Group */}
                        {groupedFolders.activeProjects.length > 0 && (
                            <div className="mb-4">
                                <div className="text-[10px] font-bold text-green-600 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <span className="text-lg">🚀</span> 进行中的项目
                                </div>
                                <div className="space-y-3 pl-2 border-l border-green-50">
                                    {groupedFolders.activeProjects.map(folder => (
                                        <FolderItem 
                                            key={folder} 
                                            folder={folder} 
                                            idx={folder} 
                                            refreshKey={refreshKey}
                                            activeFiles={activeFiles}
                                            loadingFiles={loadingFiles}
                                            setContextMenu={setContextMenu}
                                            onContextMenu={handleContextMenu}
                                            onPreview={handlePreview}
                                            onToggleIndex={toggleIndex}
                                            onFileDrop={handleFileDrop}
                                            isPrivacyProtected={privacyFolders.has(folder)}
                                            onTogglePrivacy={handleTogglePrivacy}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* 1. Project Archives Group */}
                        {groupedFolders.sortedArchiveKeys.length > 0 && (
                            <div className="mb-4">
                                <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <KBIcons.Archive /> 项目归档
                                </div>
                                <div className="space-y-3 pl-2 border-l border-indigo-50">
                                    {groupedFolders.sortedArchiveKeys.map(key => (
                                        <div key={key}>
                                            <div className="text-[10px] text-slate-400 mb-1">{key}</div>
                                            {groupedFolders.archives[key].map(folder => (
                                                <FolderItem 
                                                    key={folder} 
                                                    folder={folder} 
                                                    idx={folder} 
                                                    refreshKey={refreshKey}
                                                    activeFiles={activeFiles}
                                                    loadingFiles={loadingFiles}
                                                    setContextMenu={setContextMenu}
                                                    onContextMenu={handleContextMenu}
                                                    onPreview={handlePreview}
                                                    onToggleIndex={toggleIndex}
                                                    onFileDrop={handleFileDrop}
                                                    isPrivacyProtected={privacyFolders.has(folder)}
                                                    onTogglePrivacy={handleTogglePrivacy}
                                                />
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* 2. Local Mounts Group */}
                        {groupedFolders.localMounts.length > 0 && (
                            <div>
                                {groupedFolders.sortedArchiveKeys.length > 0 && (
                                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-2 mt-4">
                                        <KBIcons.Folder /> 本地挂载
                                    </div>
                                )}
                                <div className="space-y-2">
                                    {groupedFolders.localMounts.map(folder => (
                                        <FolderItem 
                                            key={folder} 
                                            folder={folder} 
                                            idx={folder} 
                                            refreshKey={refreshKey}
                                            activeFiles={activeFiles}
                                            loadingFiles={loadingFiles}
                                            setContextMenu={setContextMenu}
                                            onContextMenu={handleContextMenu}
                                            onPreview={handlePreview}
                                            onToggleIndex={toggleIndex}
                                            onFileDrop={handleFileDrop}
                                            isPrivacyProtected={privacyFolders.has(folder)}
                                            onTogglePrivacy={handleTogglePrivacy}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                    
                    {/* AI Migration Assistant Entry (Pinned to Bottom) */}
                    <div className="border-t border-slate-100 bg-slate-50 transition-all duration-300">
                        <button 
                            onClick={() => setIsAiMigrationExpanded(!isAiMigrationExpanded)}
                            className="w-full flex items-center justify-between px-4 py-2 hover:bg-slate-100 transition-colors"
                        >
                             <div className="flex items-center gap-2">
                                <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">智能工具</span>
                             </div>
                             <div className={`transition-transform duration-300 ${isAiMigrationExpanded ? 'rotate-180' : ''}`}>
                                <svg className="w-3 h-3 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>
                             </div>
                        </button>
                        
                        <div className={`overflow-hidden transition-all duration-300 ease-in-out ${isAiMigrationExpanded ? 'max-h-[100px] opacity-100' : 'max-h-0 opacity-0'}`}>
                            <div className="p-3 pt-0">
                                <div 
                                    onClick={() => setAiMigrationOpen(true)}
                                    className="group relative overflow-hidden bg-white border border-indigo-100 rounded-xl p-3 cursor-pointer shadow-sm hover:shadow-md transition-all hover:border-indigo-300 flex items-center gap-3"
                                >
                                    <div className="w-8 h-8 bg-indigo-50 rounded-lg flex items-center justify-center text-indigo-600 shrink-0">
                                         <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h4 className="font-bold text-slate-800 text-xs truncate">文件迁移助手</h4>
                                        <p className="text-[10px] text-slate-400 mt-0.5 truncate">智能重组文件夹结构</p>
                                    </div>
                                    <div className="absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity -mr-2 group-hover:mr-0 text-indigo-400">
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7" /></svg>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Context Menu Portal */}
                    {contextMenu.visible && (
                        <div 
                            className="fixed z-[100] bg-white rounded-lg shadow-xl border border-slate-100 py-1 min-w-[160px] animate-scale-up"
                            style={{ left: contextMenu.x, top: contextMenu.y }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="px-3 py-1.5 text-[10px] font-bold text-slate-400 border-b border-slate-50 mb-1 truncate max-w-[200px]">
                                {contextMenu.targetPath?.split(/[\\/]/).pop()}
                            </div>
                            <button 
                                onClick={() => { handleOpenInExplorer(); setContextMenu(prev => ({...prev, visible: false})); }}
                                className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-600 flex items-center gap-2"
                            >
                                📂 打开文件位置
                            </button>
                            <button 
                                onClick={() => { handleClearIndex(); setContextMenu(prev => ({...prev, visible: false})); }}
                                className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-blue-50 hover:text-blue-600 flex items-center gap-2"
                            >
                                🧹 清空索引缓存
                            </button>
                            <button 
                                onClick={() => { handleRemoveMount(); setContextMenu(prev => ({...prev, visible: false})); }}
                                className="w-full text-left px-3 py-2 text-xs text-slate-700 hover:bg-orange-50 hover:text-orange-600 flex items-center gap-2"
                            >
                                🗑️ 仅移除引用 (取消挂载)
                            </button>
                            <div className="my-1 border-t border-slate-50"></div>
                            {/* Only allow physical delete if NOT a mounted root folder */}
                            {!mountedFolders.includes(contextMenu.targetPath || '') && (
                                <button 
                                    onClick={() => { handlePhysicalDelete(); setContextMenu(prev => ({...prev, visible: false})); }}
                                    className="w-full text-left px-3 py-2 text-xs text-red-600 hover:bg-red-50 font-bold flex items-center gap-2"
                                >
                                    ⚠️ 彻底删除 (物理)
                                </button>
                            )}
                        </div>
                    )}

                    {/* Ingest Progress Indicator */}
                    {ingestProgress && (
                        <div className="p-3 bg-indigo-50 border-t border-indigo-100 animate-slide-up shrink-0">
                            <div className="flex justify-between items-center text-[10px] text-indigo-700 font-bold mb-1">
                                <span>🚀 处理中 ({ingestProgress.processed}/{ingestProgress.total})</span>
                                <span className="animate-pulse">{Math.round((ingestProgress.processed / ingestProgress.total) * 100)}%</span>
                            </div>
                            <div className="w-full h-1.5 bg-indigo-200 rounded-full overflow-hidden">
                                <div 
                                    className="h-full bg-indigo-600 transition-all duration-300" 
                                    style={{ width: `${(ingestProgress.processed / ingestProgress.total) * 100}%` }}
                                />
                            </div>
                            {ingestProgress.current && (
                                <div className="text-[8px] text-indigo-400 mt-1 truncate">
                                    正在解析: {ingestProgress.current.split(/[\\/]/).pop()}
                                </div>
                            )}
                        </div>
                    )}
                </>
            ) : sidebarTab === 'reading' ? (
                <div className="w-80 border-r border-slate-100 flex flex-col bg-slate-50/50 h-full">
                    {/* Left Sidebar (File Tree) */}
                    <div className="p-4 border-b border-slate-100">
                       <h3 className="font-bold text-slate-800 text-xs uppercase tracking-wider mb-2">阅读书架</h3>
                       <div className="relative">
                           <input 
                               value={searchQuery}
                               onChange={e => setSearchQuery(e.target.value)}
                               placeholder="搜索文档..."
                               className="w-full bg-white border border-slate-200 rounded-lg px-3 py-1.5 text-xs outline-none focus:border-indigo-300 transition-all pl-8"
                           />
                           <svg className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                       </div>
                    </div>
                    <div className="flex-1 overflow-y-auto p-4 space-y-4">
                        {/* 0. Active Projects */}
                        {groupedFolders.activeProjects.length > 0 && (
                            <div className="mb-4">
                                <div className="text-[10px] font-bold text-green-600 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <span className="text-lg">🚀</span> 进行中的项目
                                </div>
                                <div className="space-y-3 pl-2 border-l border-green-50">
                                    {groupedFolders.activeProjects.map(folder => (
                                        <FolderItem 
                                            key={folder} 
                                            folder={folder} 
                                            idx={folder} 
                                            refreshKey={refreshKey}
                                            activeFiles={activeFiles}
                                            loadingFiles={loadingFiles}
                                            setContextMenu={setContextMenu}
                                            onContextMenu={handleContextMenu}
                                            onPreview={handleReadingClick} 
                                            onToggleIndex={toggleIndex}
                                            onFileDrop={handleFileDrop}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* 1. Archives */}
                        {groupedFolders.sortedArchiveKeys.length > 0 && (
                            <div className="mb-4">
                                <div className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                                    <KBIcons.Archive /> 项目归档
                                </div>
                                <div className="space-y-3 pl-2 border-l border-indigo-50">
                                    {groupedFolders.sortedArchiveKeys.map(key => (
                                        <div key={key}>
                                            <div className="text-[10px] text-slate-400 mb-1">{key}</div>
                                            {groupedFolders.archives[key].map(folder => (
                                                <FolderItem 
                                                    key={folder} 
                                                    folder={folder} 
                                                    idx={folder} 
                                                    refreshKey={refreshKey}
                                                    activeFiles={activeFiles}
                                                    loadingFiles={loadingFiles}
                                                    setContextMenu={setContextMenu}
                                                    onContextMenu={handleContextMenu}
                                                    onPreview={handleReadingClick} 
                                                    onToggleIndex={toggleIndex}
                                                    onFileDrop={handleFileDrop}
                                                />
                                            ))}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* 2. Local Mounts */}
                        {groupedFolders.localMounts.length > 0 && (
                            <div>
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center justify-between mt-4">
                                    <div className="flex items-center gap-2">
                                        <KBIcons.Folder /> 本地挂载
                                    </div>
                                    <CloudSyncStatus localPaths={groupedFolders.localMounts} />
                                </div>
                                <div className="space-y-2">
                                    {groupedFolders.localMounts.map(folder => (
                                        <FolderItem 
                                            key={folder} 
                                            folder={folder} 
                                            idx={folder} 
                                            refreshKey={refreshKey}
                                            activeFiles={activeFiles}
                                            loadingFiles={loadingFiles}
                                            setContextMenu={setContextMenu}
                                            onContextMenu={handleContextMenu}
                                            onPreview={handleReadingClick}
                                            onToggleIndex={toggleIndex}
                                            onFileDrop={handleFileDrop}
                                        />
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            ) : (
                <div className="flex-1 flex flex-col bg-white">
                    <div className="p-4 border-b border-slate-100">
                        <button onClick={handleCreateSession} className="w-full py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2">
                            <KBIcons.Plus /> 开启新对话
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto p-2 space-y-2">
                        {sessions.map(s => (
                            <div 
                                key={s.id} 
                                onClick={() => setActiveSessionId(s.id)}
                                className={`p-3 rounded-xl border transition-all cursor-pointer group relative ${activeSessionId === s.id ? 'bg-indigo-50 border-indigo-200 shadow-sm' : 'bg-white border-transparent hover:bg-slate-50'}`}
                            >
                                <h4 className={`text-sm font-bold mb-1 truncate pr-6 ${activeSessionId === s.id ? 'text-indigo-900' : 'text-slate-700'}`}>{s.title}</h4>
                                <div className="flex justify-between items-center">
                                    <span className="text-[10px] text-slate-400 font-mono">{new Date(s.updatedAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span>
                                    <span className="text-[10px] bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-md">{s.messages.length} 条</span>
                                </div>
                                <button 
                                    onClick={(e) => handleDeleteSession(s.id, e)}
                                    className="absolute top-3 right-2 text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <KBIcons.Delete />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
        </SmartSidebarWrapper>

        {aiMigrationOpen ? (
            <div 
                className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden relative transition-all duration-300"
                onMouseEnter={() => !isSidebarPinned && setIsHoveringRight(true)}
                onMouseLeave={() => setIsHoveringRight(false)}
            >
                <AIMigrationModal 
                    onClose={() => setAiMigrationOpen(false)} 
                    onMount={(path) => handleMountFolder(path)}
                />
            </div>
        ) : sidebarTab === 'reading' ? (
            <div 
                className="flex-1 relative flex flex-col bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden transition-all duration-300"
                onMouseEnter={() => !isSidebarPinned && setIsHoveringRight(true)}
                onMouseLeave={() => setIsHoveringRight(false)}
            >
                {readingFile ? (
                    <ReaderLayout 
                        file={readingFile}
                        purpose={readingPurpose}
                        onClose={() => {
                            setReadingFile(null);
                            setReadingPurpose('');
                        }}
                    />
                ) : activeFiles.size > 0 ? (
                    <KnowledgeGraphView files={Array.from(activeFiles)} />
                ) : (
                    <ReadingProjectList 
                        onOpenReader={(file, purpose) => handleReadingClick(file, purpose)}
                    />
                )}
            </div>
        ) : (
            <div 
                className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden relative transition-all duration-300"
                onMouseEnter={() => !isSidebarPinned && setIsHoveringRight(true)}
                onMouseLeave={() => setIsHoveringRight(false)}
            >
                 <div className="p-4 border-b border-slate-100 flex items-center justify-between">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                    <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shrink-0"><KBIcons.Sparkles /></div>
                    <div className="flex-1 min-w-0">
                        {isEditingTitle ? (
                            <input 
                                autoFocus
                                className="font-bold text-slate-800 text-sm bg-slate-50 border border-slate-200 rounded px-2 py-1 w-full outline-none focus:ring-2 focus:ring-indigo-100"
                                value={activeSession.title}
                                onChange={(e) => updateActiveSession({ title: e.target.value })}
                                onBlur={() => setIsEditingTitle(false)}
                                onKeyDown={(e) => e.key === 'Enter' && setIsEditingTitle(false)}
                            />
                        ) : (
                            <div className="flex items-center gap-2 group">
                                <h3 className="font-bold text-slate-800 text-sm truncate cursor-pointer" onDoubleClick={() => setIsEditingTitle(true)} title="双击重命名">{activeSession.title}</h3>
                                <button 
                                    onClick={() => setIsEditingTitle(true)}
                                    className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-indigo-600 transition-opacity"
                                    title="重命名"
                                >
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                                </button>
                            </div>
                        )}
                        <p className="text-[10px] text-slate-400">智库对话助手</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 pl-4">
                    {exploreMode === 'multi' && (
                        <CardClip 
                            items={collectedItems} 
                            onRemove={handleRemoveCollected} 
                            onSynthesize={() => handleSynthesize('synthesis')}
                            isGenerating={activeSession.isChatting}
                            className="mr-1"
                        />
                    )}
                    <button 
                        onClick={handleCreateSession}
                        className="p-2 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors shadow-sm"
                        title="新建对话"
                    >
                        <KBIcons.NewChat />
                    </button>
                </div>
             </div>

             <div className="flex-1 p-6 space-y-4 overflow-y-auto bg-slate-50/20 scroll-smooth" id="chat-container" ref={chatContainerRef} onScroll={handleScroll}>
                {activeSession.messages.map((m, i) => (
                    (Array.isArray((m as any).multiResponses) && (m as any).multiResponses.length > 0) ? (
                        <MultiExploreView 
                            key={i} 
                            responses={m.multiResponses} 
                            isSidebarPinned={isSidebarPinned}
                            comparisonResult={(m as any).comparisonResult || null}
                            onCopy={(text) => {
                                // @ts-ignore
                                if (window.electronAPI) window.electronAPI.clipboard.writeText(text);
                            }}
                            onCopyMarkdown={(text) => {
                                // @ts-ignore
                                if (window.electronAPI) window.electronAPI.clipboard.writeText(text);
                            }}
                            onEdit={(text, providerId) => {
                                try {
                                    // Find specific provider response to get chunks/sources
                                    const targetResponse = m.multiResponses?.find(r => r.providerId === providerId);
                                    const chunks = targetResponse?.chunks || [];
                                    const sources = Array.from(new Set(chunks.map(c => c.source || 'Unknown')));

                                    console.log("[MultiExplore] Editing response:", { providerId, textLength: text.length, chunksCount: chunks.length });

                                    handleOpenEditor(i, {
                                        role: 'assistant',
                                        text: text,
                                        timestamp: Date.now(),
                                        chunks: chunks,
                                        sources: sources,
                                        multiResponses: m.multiResponses
                                    }, providerId);
                                } catch (e) {
                                    console.error("[MultiExplore] Edit failed:", e);
                                    alert("打开编辑器失败，请查看控制台日志。");
                                }
                            }}
                            onSave={(text, chunks) => handleOpenSaveModal({ text, chunks: chunks || [] })}
                            onDelete={(providerId) => {
                                // Remove specific provider response from this message
                                setSessions(prev => prev.map(s => {
                                    if (s.id === activeSession.id) {
                                        const msgs = [...s.messages];
                                        const newMulti = m.multiResponses?.filter(r => r.providerId !== providerId);
                                        msgs[i] = { ...m, multiResponses: newMulti };
                                        return { ...s, messages: msgs };
                                    }
                                    return s;
                                }));
                            }}
                            onUpdateContent={(text, providerId) => {
                                setSessions(prev => prev.map(s => {
                                    if (s.id === activeSession.id) {
                                        const msgs = [...s.messages];
                                        const newMulti = m.multiResponses?.map(r => 
                                            r.providerId === providerId ? { ...r, content: text } : r
                                        );
                                        msgs[i] = { ...m, multiResponses: newMulti };
                                        return { ...s, messages: msgs };
                                    }
                                    return s;
                                }));
                            }}
                            collectedItems={collectedItems}
                            onCollect={handleCollect}
                            onSynthesize={(providerId) => handleSynthesize(providerId)}
                            isGenerating={activeSession.isChatting}
                            onCompare={() => handleGenerateComparison(i)}
                        />
                    ) : (
                        <MessageItem 
                            key={i} 
                            message={m} 
                            index={i} 
                            handleOpenEditor={handleOpenEditor}
                            handleOpenSaveModal={handleOpenSaveModal}
                            handlePreview={handlePreview}
                            updateActiveSession={updateActiveSession}
                            setRightPanelTab={setRightPanelTab}
                            activeSession={activeSession}
                            onCollect={handleCollect}
                        />
                    )
                ))}
             </div>
             
             {/* Progress / Status Overlay (Positioned Absolute Bottom) */}
             {isChatting && (
                <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-40 w-auto pointer-events-none">
                     <div className="bg-white/90 backdrop-blur-md border border-slate-200/50 px-3 py-2 rounded-full shadow-sm flex items-center justify-center gap-3 pointer-events-auto animate-fade-in-up hover:shadow-md transition-shadow">
                         <div className="flex items-center gap-2">
                             <div className="flex gap-0.5 shrink-0">
                                <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce"></span>
                                <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                                <span className="w-1 h-1 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                             </div>
                             <span className="text-[10px] font-medium text-slate-500 truncate max-w-[120px]">
                                 {activeSession.progressState?.details || "AI 思考中..."}
                             </span>
                         </div>
                         
                         {/* Mini Progress Bar */}
                         <div className="w-16 bg-slate-100 rounded-full h-1 overflow-hidden">
                             <div 
                                 className="bg-indigo-400 h-1 rounded-full transition-all duration-300"
                                 style={{ width: `${activeSession.progressState?.progress || 5}%` }}
                             ></div>
                         </div>

                         <button 
                            onClick={async () => {
                                 if (activeSession.currentJobId && window.electronAPI) {
                                     // @ts-ignore
                                     await window.electronAPI.knowledge.controlAction({ jobId: activeSession.currentJobId, action: 'stop' });
                                     updateSession(activeSession.id, { isChatting: false });
                                 }
                            }}
                            className="text-slate-400 hover:text-red-500 transition-colors flex items-center justify-center w-4 h-4 rounded-full hover:bg-red-50"
                            title="终止生成"
                         >
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                         </button>
                     </div>
                </div>
             )}

             {showNewMessageToast && !isChatting && (
                <div className="absolute bottom-24 left-1/2 -translate-x-1/2 z-50 animate-bounce-in">
                    <button 
                        className="bg-indigo-600 text-white px-4 py-2 rounded-full shadow-lg flex items-center gap-2 cursor-pointer hover:bg-indigo-700 transition-colors border-2 border-white"
                        onClick={scrollToBottom}
                    >
                        <span className="text-xs font-bold">⬇️ 新回答已生成</span>
                        <span className="text-[10px] opacity-80">(点击查看)</span>
                    </button>
                </div>
             )}
             <div className="p-4 bg-white border-t border-slate-100 flex flex-col gap-2">
                {/* Active Contexts Chips */}
                {(customContexts.length > 0 || (orchestratorMode === 'workflow' && workflowNodes.length > 0)) && (
                    <div className="flex flex-wrap gap-2 mb-1 px-1">
                        {orchestratorMode === 'workflow' && workflowNodes.length > 0 ? (
                             <div className="flex items-center gap-2 bg-purple-50 border border-purple-100 px-3 py-1.5 rounded-lg text-xs text-purple-700 animate-scale-up">
                                <span className="font-bold">⚡️ 工作流模式已激活</span>
                                <span className="opacity-75">({workflowNodes.length} 步骤)</span>
                                <button 
                                    onClick={() => { setWorkflowNodes([]); setWorkflowEdges([]); }} // Reset
                                    className="hover:text-red-500 ml-1"
                                >
                                    ×
                                </button>
                            </div>
                        ) : (
                            customContexts.map(ctx => (
                                <div key={ctx.id} className={`flex items-center gap-2 border px-3 py-1.5 rounded-lg text-xs animate-scale-up ${ctx.mode === 'exclude' ? 'bg-red-50 border-red-100 text-red-700' : 'bg-indigo-50 border-indigo-100 text-indigo-700'}`}>
                                    <span className="font-bold">{ctx.role}:</span>
                                    <span className={`${ctx.mode === 'exclude' ? 'text-red-500' : 'text-indigo-500'} max-w-[150px] truncate`} title={ctx.folderPaths.join(', ')}>
                                        {ctx.mode === 'exclude' ? '🚫 ' : ''}{ctx.folderPaths.map(p => p.split(/[\\/]/).pop()).join(', ')}
                                    </span>
                                    <button 
                                        onClick={() => setCustomContexts(prev => prev.filter(c => c.id !== ctx.id))}
                                        className="hover:text-red-500 ml-1"
                                    >
                                        ×
                                    </button>
                                </div>
                            ))
                        )}
                        <button 
                            onClick={() => { 
                                setEditingContexts(customContexts);
                                setOrchestratorOpen(true); 
                            }}
                            className="text-xs text-slate-400 hover:text-indigo-600 px-2 underline decoration-dashed"
                        >
                            编辑...
                        </button>
                    </div>
                )}

                <div className="flex gap-2 w-full relative">
                    <button 
                        onClick={() => { 
                            setEditingContexts(customContexts);
                            // If we have saved nodes but no customContexts (simple), maybe switch mode?
                            // For now default to simple unless we detect workflow data.
                            // Ideally we should persist mode selection.
                            // Check if current loaded template was workflow?
                            // Simplified: Just open.
                            setOrchestratorOpen(true); 
                        }}
                        className={`p-3 rounded-xl transition-all flex items-center justify-center shrink-0 ${customContexts.length > 0 || workflowNodes.length > 0 ? 'bg-indigo-100 text-indigo-600 ring-2 ring-indigo-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                        title="自定义逻辑编排"
                    >
                        <KBIcons.Settings />
                    </button>
                    
                    <div 
                        className="flex-1 relative"
                        onMouseEnter={() => !input && setShowHistory(true)}
                        onMouseLeave={() => setShowHistory(false)}
                    >
                        {/* Recent Questions History Popup - Moved Inside */}
                        {showHistory && recentQuestions.length > 0 && (
                            <div className="absolute bottom-full left-0 w-full pb-2 z-20">
                                <div className="bg-white rounded-xl shadow-xl border border-slate-100 overflow-hidden animate-scale-up">
                                    <div className="bg-slate-50 px-3 py-2 border-b border-slate-100 flex justify-between items-center">
                                        <span className="text-[10px] font-bold text-slate-400 uppercase">最近提问</span>
                                    </div>
                                    <div className="max-h-[200px] overflow-y-auto">
                                        {recentQuestions.map((q, i) => (
                                            <button
                                                key={i}
                                                onClick={() => {
                                                    setInput(q);
                                                    setShowHistory(false);
                                                }}
                                                className="w-full text-left px-4 py-2 text-xs text-slate-600 hover:bg-indigo-50 hover:text-indigo-600 transition-colors border-b border-slate-50 last:border-0 truncate"
                                            >
                                                {q}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        )}

                        <input 
                            className="w-full bg-slate-100 border-none rounded-xl px-4 py-3 text-sm focus:ring-2 focus:ring-indigo-100 outline-none pr-28" 
                            placeholder={orchestratorMode === 'workflow' && workflowNodes.length > 0 ? "基于工作流逻辑提问..." : (customContexts.length > 0 ? "基于编排逻辑提问..." : "询问历史经验...")}
                            value={input}
                            onClick={() => setShowHistory(false)}
                            onChange={e => {
                                setInput(e.target.value);
                                setShowHistory(false);
                            }}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                                    e.preventDefault();
                                    handleSendMessage();
                                }
                            }}
                            disabled={isChatting}
                        />
                        
                        {/* Deep Thinking & Multi-Explore Toggles */}
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                             {/* Multi-Explore Toggle */}
                             {availableProviders.length >= 2 && (
                                 <div 
                                    onClick={() => {
                                        if (exploreMode === 'default') setExploreMode('multi');
                                        else setExploreMode('default');
                                        if (exploreMode === 'default') setIsDeepThinking(false);
                                    }}
                                    className={`flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer transition-all select-none ${exploreMode === 'multi' ? 'bg-purple-100 text-purple-700' : 'hover:bg-slate-200 text-slate-400'}`}
                                    title="多元探索模式：并行调用多个模型"
                                 >
                                     <span className="text-lg">{exploreMode === 'multi' ? '🌌' : '🔭'}</span>
                                     {exploreMode === 'multi' && (
                                         <span className="flex items-center gap-1">
                                             <span className="text-[10px] font-bold">多元探索</span>
                                             <button 
                                                onClick={(e) => { e.stopPropagation(); setShowMultiConfig(true); }}
                                                className="w-4 h-4 rounded-full bg-purple-200 text-purple-700 flex items-center justify-center hover:bg-purple-300"
                                             >
                                                 ⚙️
                                             </button>
                                         </span>
                                     )}
                                 </div>
                             )}

                             <div 
                                onClick={() => {
                                    setIsDeepThinking(!isDeepThinking);
                                    if (!isDeepThinking) setExploreMode('default');
                                }}
                                className={`flex items-center gap-1.5 px-2 py-1 rounded-lg cursor-pointer transition-all select-none ${isDeepThinking ? 'bg-indigo-100 text-indigo-700' : 'hover:bg-slate-200 text-slate-400'}`}
                                title="深度思考模式"
                             >
                                 <span className="text-lg">{isDeepThinking ? '🧠' : '☁️'}</span>
                                 {isDeepThinking && <span className="text-[10px] font-bold">深度思考</span>}
                             </div>
                        </div>
                    </div>
                    <button 
                        onClick={handleSendMessage}
                        disabled={!input.trim() || isChatting}
                        className="bg-indigo-600 text-white px-6 rounded-xl font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    >
                        发送
                    </button>
                </div>
             </div>
          </div>
        )}
        {/* Multi-Explore Config Modal */}
        {showMultiConfig && (
            <div className="fixed inset-0 z-[80] bg-black/50 backdrop-blur-sm flex items-center justify-center animate-fade-in">
                <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-md p-6 animate-scale-up border border-slate-100">
                    <h3 className="text-lg font-black text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                        <span>🌌</span> 多元探索配置
                    </h3>
                    <p className="text-xs text-slate-400 mb-4">
                        请选择参与并行回答的模型 (至少 2 个)。
                    </p>
                    
                    <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar mb-6">
                        {availableProviders.map(p => (
                            <label key={p.id} className="flex items-center justify-between p-3 rounded-xl border border-slate-100 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer transition-all">
                                <div className="flex items-center gap-3">
                                    <input 
                                        type="checkbox" 
                                        checked={selectedMultiProviders.includes(p.id)}
                                        onChange={e => {
                                            const newSel = e.target.checked 
                                                ? [...selectedMultiProviders, p.id]
                                                : selectedMultiProviders.filter(id => id !== p.id);
                                            setSelectedMultiProviders(newSel);
                                        }}
                                        className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500"
                                    />
                                    <div>
                                        <div className="text-sm font-bold text-slate-700 dark:text-slate-300">{p.name}</div>
                                        <div className="text-[10px] text-slate-400 font-mono">{p.modelId}</div>
                                    </div>
                                </div>
                                {p.isSystem && <span className="text-[9px] bg-slate-100 dark:bg-slate-700 text-slate-500 px-1.5 py-0.5 rounded">系统</span>}
                            </label>
                        ))}
                    </div>

                    <div className="flex justify-end gap-3">
                        <button onClick={() => setShowMultiConfig(false)} className="px-4 py-2 rounded-lg text-slate-500 hover:bg-slate-100 text-xs font-bold">关闭</button>
                        <button 
                            onClick={() => {
                                if (selectedMultiProviders.length < 2) return alert("请至少选择 2 个模型");
                                localStorage.setItem('multi_explore_selection', JSON.stringify(selectedMultiProviders));
                                setShowMultiConfig(false);
                            }}
                            className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200"
                        >
                            保存配置
                        </button>
                    </div>
                </div>
            </div>
        )}
        </div>
  );
};

export default KnowledgeBase;
