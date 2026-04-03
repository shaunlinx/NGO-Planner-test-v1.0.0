
import React, { useState, useRef, useEffect, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import JSZip from 'jszip';
import { Project, TeamMember, ExpenseItem, FileAttachment, ProjectStatus, NgoDomain, SOPDocument, MilestoneItem, ReportVersion, PPTSlide, PosterSlot } from '../types';
import { DOMAINS } from '../constants';
import { extractBudgetFromPlan, generateClosingReport, refineProjectContent, identifyAttachments, generateToolkitContent, decomposePlanToMilestones, chatWithKnowledgeBase, generatePPTScript, generateProjectFromIntention, evolveProject, analyzeReceipt } from '../services/geminiService';
import { exportToPPTX } from '../utils/pptGenerator';
import ImportProjectModal from './ImportProjectModal';
import ExportMenu from './ExportMenu';
import SmartBookkeepingModal from './SmartBookkeepingModal';

// 局部图标库 - 统一 1.8 描边
const ProjectIcons = {
    Overview: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
    Expenses: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
    Milestones: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2zm9-7h.01M9 16h.01" /></svg>,
    Files: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" /></svg>,
    Report: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.5L18 7.5V19a2 2 0 01-2 2z" /></svg>,
    Search: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>,
    Import: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" /></svg>,
    Download: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>,
    Plus: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>,
    Magic: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" /></svg>,
    Toolkit: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" /><path strokeLinecap="round" strokeLinejoin="round" d="M18.5 2.5a2.121 2.121 0 113 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>,
    Trash: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>,
    Attachment: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" /></svg>,
    Restore: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" /></svg>,
    Destroy: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" /></svg>,
    Planning: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
    Execution: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2m6-2a10 10 0 11-20 0 10 10 0 0120 0z" /></svg>,
    Closing: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5-2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
    Archive: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M20.54 5.23l-1.39-1.39A2 2 0 0017.74 3H6.26a2 2 0 00-1.41.59L3.46 5.23A2 2 0 003 6.64V8a2 2 0 002 2h14a2 2 0 002-2V6.64a2 2 0 00-.46-1.41z" /><path strokeLinecap="round" strokeLinejoin="round" d="M8 12h8v6H8z" /></svg>,
    Layout: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5z" /><path strokeLinecap="round" strokeLinejoin="round" d="M9 3v18" /></svg>,
    Grid: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z" /></svg>,
    List: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
};

interface ProjectManagerProps {
  projects: Project[];
  teamMembers: TeamMember[];
  warehousePath: string;
  createSubfolders?: boolean;
  initialSelectedId?: string | null;
  onUpdateProject: (project: Project) => void;
  onDeleteProject: (id: string) => void;
  onClose: () => void;
  onCreateProject: (project: Project) => void;
}

const ProjectManager: React.FC<ProjectManagerProps> = ({ 
    projects, 
    teamMembers, 
    warehousePath,
    createSubfolders = true,
    initialSelectedId,
    onUpdateProject, 
    onDeleteProject,
    onCreateProject
}) => {
    // --- 核心状态 ---
    const [selectedProjectId, setSelectedProjectId] = useState<string | null>(initialSelectedId || null);
    const [activeTab, setActiveTab] = useState<'Overview' | 'Expenses' | 'Milestones' | 'Files' | 'Report'>('Overview');
    const [searchText, setSearchText] = useState('');
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [viewMode, setViewMode] = useState<'Active' | 'Trash'>('Active'); // 切换正常列表与回收站
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [projectViewType, setProjectViewType] = useState<'card' | 'list'>('card');
    
    const [isGeneratingProject, setIsGeneratingProject] = useState(false);
    const [isSmartBookkeepingModalOpen, setIsSmartBookkeepingModalOpen] = useState(false);
    const [initChatMessages, setInitChatMessages] = useState<Array<{ role: 'assistant' | 'user'; text: string }>>([
        { role: 'assistant', text: '你好，我会陪你完成立项。你可以先说目标、时间和预算，我会继续追问细节。' }
    ]);
    const [initChatInput, setInitChatInput] = useState('');
    const [initChatRunning, setInitChatRunning] = useState(false);
    const [initAttachmentDragging, setInitAttachmentDragging] = useState(false);
    const [kbSearchText, setKbSearchText] = useState('');
    const [kbSearchLoading, setKbSearchLoading] = useState(false);
    const [kbSearchResults, setKbSearchResults] = useState<Array<{ name: string; path: string; isDirectory: boolean }>>([]);
    const [kbMountedRoots, setKbMountedRoots] = useState<string[]>([]);
    const [initAttachments, setInitAttachments] = useState<Array<{ id: string; name: string; path: string; origin: 'kb' | 'local' | 'drag'; summary?: string }>>([]);
    const [showProjectActions, setShowProjectActions] = useState(false);
    const [showAttachmentTools, setShowAttachmentTools] = useState(false);

    useEffect(() => {
        if (initialSelectedId !== undefined) {
            setSelectedProjectId(initialSelectedId || null);
            setActiveTab('Overview');
        }
    }, [initialSelectedId]);

    useEffect(() => {
        const loadMountedRoots = async () => {
            if (!window.electronAPI?.db?.getSetting) return;
            try {
                const roots = await window.electronAPI.db.getSetting('kb_mounted_folders');
                setKbMountedRoots(Array.isArray(roots) ? roots : []);
            } catch (e) {
                setKbMountedRoots([]);
            }
        };
        loadMountedRoots();
    }, []);

    const buildAttachmentMarkdown = async (attachment: { name: string; path: string }) => {
        const lowerName = attachment.name.toLowerCase();
        const ext = lowerName.includes('.') ? lowerName.split('.').pop() || '' : '';
        const codeLike = ['js', 'jsx', 'ts', 'tsx', 'json', 'html', 'css', 'xml', 'yml', 'yaml'];
        const textLike = ['md', 'markdown', 'txt', 'csv'];
        const binaryLike = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'mp3', 'wav', 'm4a', 'aac', 'mp4', 'mov', 'avi', 'mkv'];
        if (codeLike.includes(ext)) {
            const raw = await window.electronAPI.fs.readFile(attachment.path);
            const body = raw?.success ? raw.data : '';
            return `# ${attachment.name}.md\n\n\`\`\`${ext}\n${body || ''}\n\`\`\``;
        }
        if (textLike.includes(ext)) {
            const raw = await window.electronAPI.fs.readFile(attachment.path);
            const body = raw?.success ? raw.data : '';
            return `# ${attachment.name}${ext === 'md' || ext === 'markdown' ? '' : '.md'}\n\n${body || ''}`;
        }
        if (binaryLike.includes(ext)) {
            return `# ${attachment.name}.md\n\n该附件为二进制文件，路径：${attachment.path}\n类型：${ext || 'unknown'}`;
        }
        const preview = await window.electronAPI.fs.readFilePreview(attachment.path);
        if (preview?.success && preview?.data) {
            return `# ${attachment.name}.md\n\n${preview.data}`;
        }
        return `# ${attachment.name}.md\n\n无法解析内容，路径：${attachment.path}`;
    };

    const addInitAttachment = async (fileInfo: { name: string; path: string; origin: 'kb' | 'local' | 'drag' }) => {
        if (!fileInfo.path) return;
        setInitAttachments(prev => {
            if (prev.some(att => att.path === fileInfo.path)) return prev;
            return [...prev, { id: `init-att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...fileInfo }];
        });
    };

    const handlePickLocalInitFile = async () => {
        if (!window.electronAPI?.fs?.selectFile) return;
        const selected = await window.electronAPI.fs.selectFile({
            filters: [{ name: 'All Files', extensions: ['*'] }]
        });
        if (selected?.path) {
            await addInitAttachment({ name: selected.name || selected.path.split(/[\\/]/).pop() || '文件', path: selected.path, origin: 'local' });
        }
    };

    const handlePickLocalInitFolder = async () => {
        if (!window.electronAPI?.fs?.selectFolder || !window.electronAPI?.fs?.readDir) return;
        const folderPath = await window.electronAPI.fs.selectFolder();
        if (!folderPath) return;
        const entries = await window.electronAPI.fs.readDir(folderPath);
        const files = (Array.isArray(entries) ? entries : []).filter((item: any) => item && !item.isDirectory).slice(0, 30);
        for (const f of files) {
            await addInitAttachment({ name: f.name || f.path.split(/[\\/]/).pop() || '文件', path: f.path, origin: 'local' });
        }
        if (files.length === 0) {
            alert('该文件夹中没有可用文件。');
        }
    };

    const handleSearchKbAttachments = async () => {
        const q = kbSearchText.trim();
        if (!q) {
            setKbSearchResults([]);
            return;
        }
        setKbSearchLoading(true);
        try {
            const res = await window.electronAPI.invoke('kb-search-mounted-files', {
                query: q,
                roots: kbMountedRoots,
                limit: 20,
                fileTypeFilter: 'all'
            });
            setKbSearchResults(Array.isArray(res?.results) ? res.results.filter((i: any) => !i.isDirectory) : []);
        } finally {
            setKbSearchLoading(false);
        }
    };

    const handleInitAttachmentDrop = async (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setInitAttachmentDragging(false);
        const files = Array.from(e.dataTransfer.files || []);
        for (const file of files) {
            const anyFile = file as any;
            if (anyFile?.path) {
                await addInitAttachment({ name: file.name || anyFile.path.split(/[\\/]/).pop() || '文件', path: anyFile.path, origin: 'drag' });
            }
        }
    };

    const handleInitChatSend = async () => {
        const text = initChatInput.trim();
        if (!text || initChatRunning) return;
        const nextHistory = [...initChatMessages, { role: 'user' as const, text }];
        setInitChatMessages(nextHistory);
        setInitChatInput('');
        setInitChatRunning(true);
        try {
            const attachmentSummaries = initAttachments.map(att => `- ${att.name} (${att.path})`).join('\n');
            const context = attachmentSummaries ? `当前可引用附件：\n${attachmentSummaries}` : '暂无附件上下文';
            const answer = await chatWithKnowledgeBase(text, context, nextHistory);
            setInitChatMessages(prev => [...prev, { role: 'assistant', text: answer || '我已收到。你可以继续补充目标、对象、预算和时间。' }]);
        } catch (e: any) {
            setInitChatMessages(prev => [...prev, { role: 'assistant', text: `处理失败：${e.message || '请稍后重试'}` }]);
        } finally {
            setInitChatRunning(false);
        }
    };

    const handleCreateProjectFromDialogue = async () => {
        if (isGeneratingProject) return;
        setIsGeneratingProject(true);
        const tid = `init-project-${Date.now()}`;
        addTask(tid);
        try {
            const historyText = initChatMessages.map(m => `${m.role === 'user' ? '用户' : '助手'}：${m.text}`).join('\n');
            const attachmentTexts: string[] = [];
            for (const att of initAttachments) {
                const md = await buildAttachmentMarkdown({ name: att.name, path: att.path });
                attachmentTexts.push(md);
            }
            const finalIntention = [
                '请基于以下多轮对话和附件内容生成一个完整项目立项方案。',
                '【多轮对话】',
                historyText || '无',
                '【附件材料（已转为Markdown）】',
                attachmentTexts.join('\n\n---\n\n') || '无附件'
            ].join('\n\n');
            const partialProject = await generateProjectFromIntention(finalIntention, teamMembers);
            const newProject: Project = {
                ...partialProject,
                id: `p-${Date.now()}`,
                warehousePath: warehousePath
            } as Project;
            onCreateProject(newProject);
            setSelectedProjectId(newProject.id);
            syncProjectFilesToDisk(newProject);
            setInitChatMessages(prev => [...prev, { role: 'assistant', text: `已创建项目「${newProject.title}」，你可以继续补充材料后再迭代。` }]);
        } catch (e: any) {
            alert("❌ 立项失败: " + e.message);
        } finally {
            setIsGeneratingProject(false);
            removeTask(tid);
        }
    };

    const handleEvolveProject = async (sourceProject: Project) => {
        const instruction = prompt(`🧬 正在基于【${sourceProject.title}】进化新方案。\n\n请输入进化指令 (例如: "复刻这个项目，但改为2025年寒假，预算削减20%"):`);
        if (!instruction) return;

        const tid = `evolve-${sourceProject.id}`;
        addTask(tid);
        try {
            const evolvedData = await evolveProject(sourceProject, instruction);
             const newProject: Project = {
                ...evolvedData,
                id: `p-${Date.now()}`,
                warehousePath: warehousePath
            } as Project;
            
            onCreateProject(newProject);
            setSelectedProjectId(newProject.id);
            syncProjectFilesToDisk(newProject);
            alert("✅ 项目进化成功！已为您生成新方案。");
        } catch (e: any) {
            alert("❌ 进化失败: " + e.message);
        } finally {
            removeTask(tid);
        }
    };
    
    const [activeExpenseForFiles, setActiveExpenseForFiles] = useState<ExpenseItem | null>(null);
    const [isAuditingReceipt, setIsAuditingReceipt] = useState(false);
    const receiptUploadRef = useRef<HTMLInputElement>(null);

    const handleSmartReceiptUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0 || !selectedProject) return;
        
        setIsAuditingReceipt(true);
        const file = files[0];
        const reader = new FileReader();
        
        reader.onload = async (ev) => {
            try {
                const base64Data = ev.target?.result as string;
                // Call AI Audit
                const result = await analyzeReceipt(base64Data);
                
                // Construct new expense item
                const newExpense: ExpenseItem = {
                    id: `exp-auto-${Date.now()}`,
                    category: result.category || '其他',
                    item: result.item || '未命名支出',
                    budgetAmount: 0, // Usually receipt is actual, budget might be 0 or matched later
                    actualAmount: typeof result.amount === 'number' ? result.amount : parseFloat(result.amount) || 0,
                    notes: `${result.notes || ''} (商家: ${result.merchant || '未知'}) - AI 自动入账`,
                    attachments: [{
                        id: `att-receipt-${Date.now()}`,
                        name: file.name,
                        url: base64Data,
                        type: file.type,
                        uploadedAt: Date.now(),
                        category: 'Finance'
                    }]
                };

                handleUpdate({ expenses: [...(selectedProject.expenses || []), newExpense] });
                alert(`✅ 票据已识别并入账：${newExpense.item} ¥${newExpense.actualAmount}`);
            } catch (err: any) {
                alert("❌ 票据识别失败: " + err.message);
            } finally {
                setIsAuditingReceipt(false);
                if (receiptUploadRef.current) receiptUploadRef.current.value = '';
            }
        };
        
        reader.readAsDataURL(file);
    };
    
    const [activeMilestoneForEvidence, setActiveMilestoneForEvidence] = useState<MilestoneItem | null>(null);

    // AI 任务队列
    const [pendingTasks, setPendingTasks] = useState<Set<string>>(new Set());
    const addTask = (id: string) => setPendingTasks(prev => new Set(prev).add(id));
    const removeTask = (id: string) => setPendingTasks(prev => { const n = new Set(prev); n.delete(id); return n; });
    const isTaskRunning = (id: string) => pendingTasks.has(id);

    const selectedProject = useMemo(() => projects.find(p => p.id === selectedProjectId), [projects, selectedProjectId]);

    // 同步外部选中的项目 ID
    useEffect(() => {
        if (initialSelectedId) {
            setSelectedProjectId(initialSelectedId);
            setActiveTab('Overview');
        }
    }, [initialSelectedId]);

    // --- 回收站管理逻辑 ---
    const [toast, setToast] = useState<{ variant: 'success' | 'error'; text: string } | null>(null);
    const showToast = (text: string, variant: 'success' | 'error' = 'success', durationMs = 1800) => {
        setToast({ text, variant });
        window.setTimeout(() => setToast(null), Math.max(800, durationMs));
    };

    const handleMoveToTrash = (project: Project) => {
        if (!confirm(`确定将“${project.title}”移入回收站吗？\n项目将在30天后自动粉碎。`)) return;
        onUpdateProject({ ...project, deletedAt: Date.now() });
    };

    const handleRestoreProject = (project: Project) => {
        onUpdateProject({ ...project, deletedAt: undefined });
        showToast("✅ 项目已还原至原状态", 'success');
    };

    const handlePermanentDestroy = async (project: Project, opts?: { confirm?: boolean; silent?: boolean }) => {
        const requireConfirm = opts?.confirm === true;
        const silent = opts?.silent === true;

        if (requireConfirm) {
            const confirmMsg = `⚠️ 警告：正在执行“物理粉碎”删除！\n这将永久清除：\n1. 数据库中的所有记录\n2. ${project.warehousePath ? '本地硬盘上的所有物理文件' : '本地暂存文件'}\n此操作不可逆，且毫无痕迹。确认继续？`;
            if (!confirm(confirmMsg)) return;
        }

        const tid = `destroy-${project.id}`;
        addTask(tid);

        try {
            // 如果是桌面端，尝试物理删除整个项目目录
            if (window.electronAPI && warehousePath && project.title) {
                const projectRoot = `${warehousePath}${project.title}/`;
                const exists = await window.electronAPI.fs.exists(projectRoot);
                if (exists) {
                    const res = await window.electronAPI.fs.deleteDirectory!(projectRoot);
                    if (!res.success) throw new Error(res.error);
                }
            }
            // 从全局状态（及数据库）彻底移除
            onDeleteProject(project.id);
            if (!silent) showToast("🔥 项目已彻底粉碎", 'success', 1500);
        } catch (e: any) {
            if (!silent) showToast(`❌ 物理粉碎失败: ${e.message}`, 'error', 2600);
        } finally {
            removeTask(tid);
        }
    };

    const handleEmptyTrash = async () => {
        const trashProjects = projects.filter(p => p.deletedAt);
        if (trashProjects.length === 0) return;
        if (!confirm(`确定要清空回收站内的 ${trashProjects.length} 个项目吗？这将执行无痕物理粉碎。`)) return;
        
        for (const p of trashProjects) {
            await handlePermanentDestroy(p, { confirm: false, silent: true });
        }
        showToast(`✅ 回收站已清空（共粉碎 ${trashProjects.length} 个项目）`, 'success', 2000);
    };

    // --- 归档逻辑 ---
    const handleArchiveProject = async (targetProject: Project) => {
        if (!targetProject) return;
        const confirmMsg = `确定要归档“${targetProject.title}”吗？归档后该项目将：\n1. 锁定所有文档，防止意外修改。\n2. 立即流转至【知识库】年度归档中。\n3. 在桌面端会自动同步到本地路径。`;
        if (!confirm(confirmMsg)) return;

        const tid = `archive-${targetProject.id}`;
        addTask(tid);

        try {
            // Trigger final sync to ensure everything is on disk
            // Must use the latest targetProject which might have unsaved in-memory changes if not careful,
            // but here targetProject comes from UI click, usually it's current.
            // Better to sync 'selectedProject' if it matches targetProject to capture unsaved edits?
            // But handleArchiveProject is passed 'targetProject'.
            // Let's ensure we sync the targetProject.
            await syncProjectFilesToDisk(targetProject);

            // Auto-mount to Knowledge Base
            if (window.electronAPI && warehousePath) {
                const safeWarehouse = warehousePath.endsWith('/') || warehousePath.endsWith('\\') ? warehousePath : `${warehousePath}/`;
                const projectRoot = `${safeWarehouse}${targetProject.title}/`; // Ensure trailing slash consistency based on OS usually, but here strict string match
                
                // Remove trailing slash for consistency with selectFolder usually returning without it? 
                // Actually selectFolder usually returns path without trailing slash on macOS.
                // But let's check what we store. 
                // Ideally we store normalized paths. 
                // For now, let's store the directory path as constructed.
                // We might want to remove the trailing slash for the DB setting to match selectFolder behavior
                const projectRootDir = projectRoot.endsWith('/') ? projectRoot.slice(0, -1) : projectRoot;

                const currentMounts = await window.electronAPI.db.getSetting('kb_mounted_folders') || [];
                if (Array.isArray(currentMounts) && !currentMounts.includes(projectRootDir)) {
                    const newMounts = [...currentMounts, projectRootDir];
                    await window.electronAPI.db.saveSetting('kb_mounted_folders', newMounts);
                    console.log("Auto-mounted archived project to KB:", projectRootDir);
                }
            }

            onUpdateProject({ 
                ...targetProject,
                status: 'Archived', 
                planLocked: true, 
                financialsLocked: true, 
                executionLocked: true, 
                reportLocked: true, 
                pptLocked: true 
            });

            alert("✅ 项目已成功归档，并同步至【知识库】。");
        } catch (e: any) {
            console.error("Archive failure:", e);
            onUpdateProject({ ...targetProject, status: 'Archived', planLocked: true });
            alert(`⚠️ 归档过程遇到异常，但已完成逻辑归档。`);
        } finally {
            removeTask(tid);
        }
    };

    const handleStatusChange = async (targetProject: Project, newStatus: ProjectStatus) => {
        if (!targetProject) return;
        if (newStatus === 'Archived') {
            await handleArchiveProject(targetProject);
        } else {
            if (targetProject.status === 'Archived') {
                if (!confirm("确定要取消归档吗？这将解除该项目所有文档的锁定状态。")) return;
                onUpdateProject({ 
                    ...targetProject,
                    status: newStatus,
                    planLocked: false,
                    financialsLocked: false,
                    executionLocked: false,
                    reportLocked: false,
                    pptLocked: false
                });
            } else {
                onUpdateProject({ ...targetProject, status: newStatus });
            }
        }
    };

    // --- 其他业务逻辑 ---
    const [isEditingPlan, setIsEditingPlan] = useState(false);
    const [aiRefineInput, setAiRefineInput] = useState('');
    const [activeGenerations, setActiveGenerations] = useState<Set<string>>(new Set());
    const [previewFile, setPreviewFile] = useState<{ id: string, name: string, content: string, isImage?: boolean, url?: string, prompt?: string } | null>(null);
    const [isEditingFile, setIsEditingFile] = useState(false);
    const [editedFileContent, setEditedFileContent] = useState('');
    const [fileCategory, setFileCategory] = useState<'All' | 'Plan' | 'SOP' | 'Finance' | 'Execution' | 'Media' | 'Visuals'>('All');
    const [fileSearch, setFileSearch] = useState('');
    const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
    const [reportViewMode, setReportViewMode] = useState<'preview' | 'edit' | 'ppt'>('preview');
    const [reportParams, setReportParams] = useState({ audience: '资方/捐赠人', wordCount: '3000字左右' });
    const [diskPrompts, setDiskPrompts] = useState<{name: string, path: string, content: string, image?: string}[]>([]);
    const [diskPosters, setDiskPosters] = useState<{name: string, path: string, url: string, prompt?: string}[]>([]);

    useEffect(() => {
        if (!selectedProject || !window.electronAPI || !warehousePath) return;
        
        const loadDiskAssets = async () => {
             const safeWarehouse = warehousePath.endsWith('/') || warehousePath.endsWith('\\') ? warehousePath : `${warehousePath}/`;
             const projectRoot = `${safeWarehouse}${selectedProject.title}/`;
             
             // 1. Load Prompts
             const promptsPath = `${projectRoot}Knowledge/Prompts`;
             const loadedPrompts: any[] = [];
             
             if (await window.electronAPI.fs.exists(promptsPath)) {
                 const files = await window.electronAPI.fs.readDir(promptsPath);
                 for (const f of files) {
                     if (f.name.endsWith('.json')) {
                         const content = await window.electronAPI.fs.readFile(f.path);
                         if (content.success && content.data) {
                             try {
                                 const json = JSON.parse(content.data);
                                 loadedPrompts.push({
                                     name: f.name,
                                     path: f.path,
                                     content: json.content || json.prompt || '',
                                     image: json.previewImage || json.image || null,
                                     tags: json.tags || []
                                 });
                             } catch (e) { console.error("Error parsing prompt", f.path); }
                         }
                     }
                 }
             }
             setDiskPrompts(loadedPrompts);

             // 1.5 Load Visual Config (for Prompts)
             const visualConfigPath = `${projectRoot}Docs/visual_config.json`;
             const posterPrompts: Record<string, string> = {};
             if (await window.electronAPI.fs.exists(visualConfigPath)) {
                 const content = await window.electronAPI.fs.readFile(visualConfigPath);
                 if (content.success && content.data) {
                     try {
                         const posters: PosterSlot[] = JSON.parse(content.data);
                         posters.forEach(p => {
                             if (p.finalPrompt) posterPrompts[p.id] = p.finalPrompt;
                             else if (p.config.referenceImagePrompt) posterPrompts[p.id] = p.config.referenceImagePrompt;
                         });
                     } catch (e) { console.error("Error parsing visual config", e); }
                 }
             }

             // 2. Load Posters (Images)
             const imagesPath = `${projectRoot}Images`;
             const loadedPosters: any[] = [];
             try {
                if (await window.electronAPI.fs.exists(imagesPath)) {
                    const files = await window.electronAPI.fs.readDir(imagesPath);
                    // Ensure files is an array and filter properly
                    if (Array.isArray(files)) {
                        for (const f of files) {
                            if (f.name && ['.png', '.jpg', '.jpeg', '.webp'].some(ext => f.name.toLowerCase().endsWith(ext))) {
                                 // Read preview for display
                                 const prev = await window.electronAPI.fs.readFilePreview(f.path);
                                 if (prev.success && prev.data) {
                                     // Try to match ID from filename "poster_{id}.png"
                                     let prompt = '';
                                     const match = f.name.match(/poster_(.+)\./);
                                     if (match && match[1]) {
                                         prompt = posterPrompts[match[1]] || '';
                                     } else if (f.name === 'poster.png') {
                                         // Fallback for legacy poster if no config found, but we might have config from legacy conversion
                                         // Just leave prompt empty or try to find a legacy slot in posterPrompts
                                     }
                                     
                                     loadedPosters.push({
                                         name: f.name,
                                         path: f.path,
                                         url: prev.data,
                                         prompt: prompt
                                     });
                                 }
                            }
                        }
                    }
                }
             } catch (e) {
                 console.error("Failed to load posters", e);
             }
             setDiskPosters(loadedPosters);
        };
        
        loadDiskAssets();
    }, [selectedProject, warehousePath]);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const evidenceInputRef = useRef<HTMLInputElement>(null);
    const centerUploadRef = useRef<HTMLInputElement>(null);



    const filteredProjects = useMemo(() => {
        return projects
            .filter(p => {
                const matchSearch = p.title.toLowerCase().includes(searchText.toLowerCase());
                const matchBin = viewMode === 'Trash' ? !!p.deletedAt : !p.deletedAt;
                return matchSearch && matchBin;
            })
            .sort((a,b) => b.created_at - a.created_at);
    }, [projects, searchText, viewMode]);

    const trashCount = useMemo(() => projects.filter(p => p.deletedAt).length, [projects]);
    const activeProjects = useMemo(() => projects.filter(p => !p.deletedAt), [projects]);
    const ledgerStats = useMemo(() => {
        const planningCount = activeProjects.filter(p => p.status === 'Planning').length;
        const executionCount = activeProjects.filter(p => p.status === 'Execution').length;
        const closingCount = activeProjects.filter(p => p.status === 'Closing').length;
        const archivedCount = activeProjects.filter(p => p.status === 'Archived').length;
        const totalBudget = activeProjects.reduce((sum, p) => sum + (p.expenses || []).reduce((acc, expense) => acc + expense.budgetAmount, 0), 0);
        const totalMilestones = activeProjects.reduce((sum, p) => sum + (p.milestones || []).length, 0);
        const completedMilestones = activeProjects.reduce((sum, p) => sum + (p.milestones || []).filter(ms => ms.status === 'Done').length, 0);
        const overallProgress = totalMilestones === 0 ? 0 : Math.round((completedMilestones / totalMilestones) * 100);
        return { planningCount, executionCount, closingCount, archivedCount, totalBudget, overallProgress };
    }, [activeProjects]);

    const projectFiles = useMemo(() => {
        if (!selectedProject) return [];
        const files: any[] = [];
        if (selectedProject.officialPlanContent || selectedProject.originalPlan?.markdown) {
            files.push({ id: 'plan-file', name: '核心策划案.md', category: 'Plan', source: '系统生成', date: selectedProject.created_at, content: selectedProject.officialPlanContent || selectedProject.originalPlan?.markdown });
        }
        (selectedProject.sops || []).forEach(sop => {
            files.push({ id: sop.id, name: sop.title, category: 'SOP', source: 'AI 专家', date: selectedProject.created_at, content: sop.content });
        });
        
        // Add Disk Prompts to File List
        diskPrompts.forEach(p => {
             files.push({ 
                id: `prompt-file-${p.name}`, 
                name: p.name, 
                category: 'Visuals', 
                source: '提示词库', 
                date: Date.now(), 
                content: p.content,
                type: 'application/json' 
             });
        });

        // Add Disk Posters to File List
        diskPosters.forEach(p => {
            files.push({
                id: `poster-file-${p.name}`,
                name: p.name,
                category: 'Visuals', // Changed from Media to Visuals
                source: '视觉物料',
                date: Date.now(),
                content: p.url,
                type: 'image/png',
                isImage: true,
                url: p.url,
                prompt: p.prompt
            });
        });

        (selectedProject.expenses || []).forEach(exp => {
            (exp.attachments || []).forEach(att => {
                files.push({ ...att, category: 'Finance', source: `报销: ${exp.item}`, date: att.uploadedAt });
            });
        });
        (selectedProject.milestones || []).forEach(ms => {
            (ms.evidence || []).forEach(evid => {
                files.push({ ...evid, category: 'Execution', source: `任务: ${ms.task}`, date: evid.uploadedAt });
            });
        });
        return files;
    }, [selectedProject, diskPrompts, diskPosters]);

    const filteredFiles = useMemo(() => {
        return projectFiles.filter(f => {
            const matchesSearch = f.name.toLowerCase().includes(fileSearch.toLowerCase());
            const matchesCategory = fileCategory === 'All' 
                || f.category === fileCategory 
                || (fileCategory === 'Media' && (f.type?.startsWith('image/') || f.type?.startsWith('video/')))
                || (fileCategory === 'Visuals' && f.category === 'Visuals');
            return matchesSearch && matchesCategory;
        });
    }, [projectFiles, fileSearch, fileCategory]);

    const financialStats = useMemo(() => {
        const target = selectedProject || { expenses: [] };
        const totalB = (target.expenses || []).reduce((a, b) => a + b.budgetAmount, 0);
        const totalA = (target.expenses || []).reduce((a, b) => a + b.actualAmount, 0);
        return { totalBudget: totalB, totalActual: totalA, balance: totalB - totalA };
    }, [selectedProject]);

    const progressStats = useMemo(() => {
        const items = selectedProject?.milestones || [];
        if (items.length === 0) return 0;
        const done = items.filter(i => i.status === 'Done').length;
        return Math.round((done / items.length) * 100);
    }, [selectedProject]);

    const currentPlanContent = selectedProject?.officialPlanContent || selectedProject?.originalPlan?.markdown || '';
    const projectTabs: Array<{ key: 'Overview' | 'Expenses' | 'Milestones' | 'Files' | 'Report'; label: string; Icon: React.FC }> = [
        { key: 'Overview', label: '项目概览', Icon: ProjectIcons.Overview },
        { key: 'Expenses', label: '财务预算', Icon: ProjectIcons.Expenses },
        { key: 'Milestones', label: '执行进度', Icon: ProjectIcons.Milestones },
        { key: 'Files', label: '文档中心', Icon: ProjectIcons.Files },
        { key: 'Report', label: '结项报告', Icon: ProjectIcons.Report }
    ];

    // --- 文件同步逻辑 ---
    const simpleHash = (str: string) => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash;
        }
        return hash.toString();
    };

    const syncProjectFilesToDisk = async (project: Project) => {
        if (!window.electronAPI || !warehousePath) {
            console.warn("syncProjectFilesToDisk: Missing API or warehousePath", { api: !!window.electronAPI, warehousePath });
            return;
        }
        
        // Ensure proper path separator handling
        const safeWarehouse = warehousePath.endsWith('/') || warehousePath.endsWith('\\') ? warehousePath : `${warehousePath}/`;
        const projectRoot = `${safeWarehouse}${project.title}/`;
        
        console.log(`[Sync] Starting sync for project: ${project.title} at ${projectRoot}`);
        
        try {
            await window.electronAPI.fs.ensureDir(projectRoot);
            
            // Auto-create subfolders if enabled
            if (createSubfolders) {
                const subfolders = ['Docs', 'Images', 'Videos', 'Audio', 'Archive'];
                for (const folder of subfolders) {
                    await window.electronAPI.fs.ensureDir(`${projectRoot}${folder}/`);
                }
            }

            // Ensure specialized folders
            await window.electronAPI.fs.ensureDir(`${projectRoot}财务凭证/`);
            await window.electronAPI.fs.ensureDir(`${projectRoot}执行证明/`);
            
            // 1. 同步纯文本文件 (Plan, SOP)
            const docsPrefix = createSubfolders ? 'Docs/' : '';
            const planContent = project.officialPlanContent || project.originalPlan?.markdown || '';
            const planPath = `${projectRoot}${docsPrefix}核心策划案.md`;
            
            if (planContent) {
                await window.electronAPI.fs.writeFile(planPath, planContent);
                console.log(`[Sync] Wrote plan file (${planContent.length} chars)`);
            } else {
                const placeholder = `# ${project.title}\n\n(此项目暂无核心策划方案内容)\n\n归档日期: ${new Date().toLocaleDateString()}`;
                await window.electronAPI.fs.writeFile(planPath, placeholder);
                console.log(`[Sync] Wrote placeholder plan file`);
            }
            
            for (const sop of project.sops || []) {
                if (sop.content) {
                    await window.electronAPI.fs.writeFile(`${projectRoot}${docsPrefix}${sop.title}.md`, sop.content);
                }
            }

            // 2. 同步附件文件 (Financials & Execution)
            // 优化：仅索引，不复制文件 (避免冗余)
            // 附件文件已经在用户上传时保存到了数据库 (Base64) 或者本地临时目录
            // 但为了 RAG 能索引，我们需要一个物理路径。
            
            const attachmentPaths: {path: string, content: string}[] = [];

            const writeAttachment = async (att: FileAttachment, subFolder: string) => {
                // Support both Base64 Data URI and potential local paths (if we change logic later)
                if (!att.url) return;
                
                const targetPath = `${projectRoot}${subFolder}/${att.name}`;
                // Collect path and content(hash) for indexing. 
                // Note: For local files, we use the path as content-key effectively, or we'd need to read it to hash it.
                // For now, we just push it to ensure it gets indexed if possible.
                attachmentPaths.push({ path: targetPath, content: att.url }); 

                const exists = await window.electronAPI!.fs.exists(targetPath);
                
                if (exists) {
                    return;
                }

                if (att.url.startsWith('data:')) {
                    const base64Data = att.url.split(',')[1];
                    if (base64Data) {
                        await window.electronAPI!.fs.writeFile(targetPath, base64Data, { encoding: 'base64' });
                        console.log(`[Sync] Wrote attachment (Base64): ${att.name}`);
                    }
                } else {
                    // Try to treat as local path and copy
                    try {
                         const sourceExists = await window.electronAPI!.fs.exists(att.url);
                         if (sourceExists) {
                             const fileContent = await window.electronAPI!.fs.readFile(att.url);
                             if (fileContent.success && fileContent.data) {
                                 // If it's a binary file, readFile might return base64 or Buffer? 
                                 // The API usually returns base64 for binary or string for text.
                                 // Assuming readFile returns string (text) or base64 (if binary).
                                 // Let's assume standard behavior: we need to write what we read.
                                 // If readFile returns the content, we write it.
                                 // CAUTION: If readFile returns raw string for binary, writing it might be tricky.
                                 // But usually electronAPI.fs.readFile returns { success, data, encoding? }
                                 await window.electronAPI!.fs.writeFile(targetPath, fileContent.data);
                                 console.log(`[Sync] Wrote attachment (Copy): ${att.name}`);
                             }
                         } else {
                             console.warn(`[Sync] Attachment source not found: ${att.url}`);
                         }
                    } catch (err) {
                        console.warn(`[Sync] Failed to copy attachment: ${att.name}`, err);
                    }
                }
            };

            const attachmentPromises: Promise<void>[] = [];
            (project.expenses || []).forEach(exp => {
                (exp.attachments || []).forEach(att => attachmentPromises.push(writeAttachment(att, '财务凭证')));
            });
            (project.milestones || []).forEach(ms => {
                (ms.evidence || []).forEach(att => attachmentPromises.push(writeAttachment(att, '执行证明')));
            });
            
            await Promise.all(attachmentPromises);
            console.log(`[Sync] Processed ${attachmentPromises.length} attachments`);

            // 2.5 同步结项报告 (Reports)
            await window.electronAPI.fs.ensureDir(`${projectRoot}Reports/`);
            const reportPaths: {path: string, content: string}[] = [];
            
            for (const rv of project.reportVersions || []) {
                if (rv.content) {
                    const reportName = `Report_${rv.title.replace(/[\\/:*?"<>|]/g, '_')}_${rv.id.slice(-6)}.md`;
                    const reportPath = `${projectRoot}Reports/${reportName}`;
                    await window.electronAPI.fs.writeFile(reportPath, rv.content);
                    reportPaths.push({ path: reportPath, content: rv.content });
                }
            }

            // 3. 自动挂载到知识库
            const mountedFolders = await window.electronAPI.db.getSetting('kb_mounted_folders') || [];
            // Remove trailing slash for consistency in comparison and storage
            const normalizedRoot = projectRoot.endsWith('/') || projectRoot.endsWith('\\') ? projectRoot.slice(0, -1) : projectRoot;
            
            if (!mountedFolders.includes(normalizedRoot)) {
                 const newFolders = [...mountedFolders, normalizedRoot];
                 await window.electronAPI.db.saveSetting('kb_mounted_folders', newFolders);
                 console.log(`[Sync] Mounted folder: ${normalizedRoot}`);
            } else {
                 console.log(`[Sync] Folder already mounted: ${normalizedRoot}`);
            }

            (window as any).electronAPI.invoke('kb-upsert-folder-meta', {
                folder_id: normalizedRoot,
                folder_path: normalizedRoot,
                source_type: 'project_archive',
                origin_path: normalizedRoot,
                is_external_reference: 0,
                created_at: Date.now(),
                extra_json: { project_id: project.id || null }
            });
            
            // Always trigger update to refresh file tree content
            window.dispatchEvent(new CustomEvent('kb-folders-updated'));

            // 4. 自动索引
            const ingestedFiles = new Set(await window.electronAPI.db.getSetting('kb_ingested_files') || []);
            const activeFiles = new Set(await window.electronAPI.db.getSetting('kb_active_files') || []);
            const fileHashes = await window.electronAPI.db.getSetting('kb_file_hashes') || {};
            let hasUpdates = false;

            const autoIndex = (filePath: string, contentForHash: string) => {
                const newHash = simpleHash(contentForHash);
                const oldHash = fileHashes[filePath];

                // If hash changed OR file not in ingested list
                if (newHash !== oldHash || !ingestedFiles.has(filePath)) {
                    window.electronAPI!.knowledge.upload({ name: filePath.split('/').pop() || 'unknown', path: filePath } as any);
                    ingestedFiles.add(filePath);
                    activeFiles.add(filePath);
                    fileHashes[filePath] = newHash;
                    hasUpdates = true;
                    console.log(`[Sync] Auto-indexed (Hash Change): ${filePath}`);
                }
            };

            autoIndex(planPath, planContent);
            (project.sops || []).forEach(sop => autoIndex(`${projectRoot}${docsPrefix}${sop.title}.md`, sop.content || ''));
            attachmentPaths.forEach(item => autoIndex(item.path, item.content));
            reportPaths.forEach(item => autoIndex(item.path, item.content));

            if (hasUpdates) {
                await window.electronAPI.db.saveSetting('kb_ingested_files', Array.from(ingestedFiles));
                await window.electronAPI.db.saveSetting('kb_active_files', Array.from(activeFiles));
                await window.electronAPI.db.saveSetting('kb_file_hashes', fileHashes);
            }

        } catch (e) {
            console.error("Failed to sync project files to disk:", e);
        }
    };

    // --- 详情操作函数 ---
    const handleUpdate = (updates: Partial<Project>) => {
        if (!selectedProject) return;
        const updatedProject = { ...selectedProject, ...updates, updated_at: Date.now() };
        onUpdateProject(updatedProject);
        
        // 任何内容变更都触发磁盘同步 (包括附件上传)
        // 这样保证了知识库看到的文件永远是最新的 "Single Source of Truth"
        syncProjectFilesToDisk(updatedProject);
    };

    const handleAIRefinePlan = async () => {
        if (!selectedProject || !aiRefineInput.trim()) return;
        const tid = `refine-plan-${selectedProject.id}`;
        addTask(tid);
        try {
            const refinedContent = await refineProjectContent(currentPlanContent, aiRefineInput, selectedProject.title);
            handleUpdate({ officialPlanContent: refinedContent });
            setAiRefineInput('');
            alert("✅ 方案已根据指令优化完成");
        } catch (e: any) {
            alert("❌ AI 优化失败: " + e.message);
        } finally {
            removeTask(tid);
        }
    };

    const updateExpenseRow = (id: string, updates: Partial<ExpenseItem>) => {
        const next = (selectedProject?.expenses || []).map(e => e.id === id ? { ...e, ...updates } : e);
        handleUpdate({ expenses: next });
    };

    const updateMilestoneRow = (id: string, updates: Partial<MilestoneItem>) => {
        const next = (selectedProject?.milestones || []).map(m => m.id === id ? { ...m, ...updates } : m);
        handleUpdate({ milestones: next });
    };

    const handleRefreshSOPList = async () => {
        if (!selectedProject) return;
        const tid = `refresh-sop-${selectedProject.id}`;
        addTask(tid);
        try {
            const list = await identifyAttachments("策划案", currentPlanContent, selectedProject.title, selectedProject.domain);
            const next = [...(selectedProject.sops || [])];
            list.forEach(title => { if (!next.find(s => s.title === title)) next.push({ id: `sop-${Date.now()}-${title}`, title, content: '', type: title.endsWith('csv') ? 'csv' : 'markdown' }); });
            handleUpdate({ sops: next });
        } catch (e: any) { alert("识别失败: " + e.message); } finally { removeTask(tid); }
    };

    const handleGenerateSOPContent = async (id: string) => {
        if (!selectedProject) return;
        setActiveGenerations(prev => new Set(prev).add(id));
        try {
            const sop = selectedProject.sops?.find(s => s.id === id);
            if (!sop) return;
            const content = await generateToolkitContent(sop.title, selectedProject.title, selectedProject.domain, currentPlanContent, teamMembers, {});
            const updated = selectedProject.sops!.map(s => s.id === id ? { ...s, content } : s);
            handleUpdate({ sops: updated });
        } catch (e: any) { alert("生成失败: " + e.message); } finally { setActiveGenerations(prev => { const n = new Set(prev); n.delete(id); return n; }); }
    };

    const handleAIExtractBudget = async () => {
        if (!selectedProject || !currentPlanContent) return;
        const tid = `extract-budget-${selectedProject.id}`;
        addTask(tid);
        try {
            const extracted = await extractBudgetFromPlan(selectedProject.title, currentPlanContent);
            const formatted: ExpenseItem[] = extracted.map((e: any, idx: number) => ({ id: `exp-ai-${Date.now()}-${idx}`, category: e.category || '其他', item: e.item || '未命名项', budgetAmount: e.budgetAmount || 0, actualAmount: 0, attachments: [], notes: e.notes || '' }));
            handleUpdate({ expenses: [...(selectedProject.expenses || []), ...formatted] });
        } catch (e: any) { alert("提取预算失败: " + e.message); } finally { removeTask(tid); }
    };

    const handleAIDecomposeMilestones = async () => {
        if (!selectedProject) return;
        const tid = `decompose-milestones-${selectedProject.id}`;
        addTask(tid);
        try {
            const items = await decomposePlanToMilestones(currentPlanContent, teamMembers, selectedProject.startDate);
            const formatted: MilestoneItem[] = items.map((it: any, idx: number) => ({ id: `ms-${Date.now()}-${idx}`, stage: it.stage || '筹备期', task: it.task || '未命名任务', chargePerson: it.chargePerson || '', status: 'Pending', completionDate: it.completionDate || '', evidence: [] }));
            handleUpdate({ milestones: formatted });
        } catch (e: any) { alert("分解失败: " + e.message); } finally { removeTask(tid); }
    };

    const handleConfirmFinancials = () => {
        if (selectedProject?.financialsLocked) handleUpdate({ financialsLocked: false });
        else if (confirm("确认结项决算？锁定后财务数据将无法修改。")) {
            handleUpdate({ financialsLocked: true });
        }
    };

    const handleExportExpenses = async (format: string) => {
        if (!selectedProject) return;
        const rows = [["科目", "项目", "预算", "实支", "备注"], ...(selectedProject.expenses || []).map(e => [e.category, e.item, e.budgetAmount, e.actualAmount, e.notes])];
        const csv = "\uFEFF" + rows.map(r => r.join(',')).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = `${selectedProject.title}_账目决算.csv`; a.click();
    };

    const handleCreateReportVersion = () => {
        const nv: ReportVersion = { id: `rv-${Date.now()}`, title: `报告 - ${reportParams.audience}`, audience: reportParams.audience, wordCount: reportParams.wordCount, content: '', createdAt: Date.now(), isFinalized: false };
        handleUpdate({ reportVersions: [nv, ...(selectedProject?.reportVersions || [])] });
        setSelectedReportId(nv.id);
    };

    const handleGenerateReportFull = async () => {
        if (!selectedProject || !selectedReportId) return;
        const rv = selectedProject.reportVersions?.find(v => v.id === selectedReportId);
        if (!rv) return;
        const tid = `gen-report-${rv.id}`;
        addTask(tid);
        try {
            const content = await generateClosingReport(selectedProject.title, selectedProject.domain, {
                planMarkdown: currentPlanContent,
                executionData: (selectedProject.milestones || []).map(m => `- ${m.task}: ${m.status}`).join('\n'),
                financialData: (selectedProject.expenses || []).map(e => `- ${e.item}: ¥${e.actualAmount}`).join('\n'),
                teamData: teamMembers.map(m => m.nickname).join(', '),
                financialStats: `总支出: ¥${financialStats.totalActual}`,
                progressStats: `完成度: ${progressStats}%`,
                audience: rv.audience,
                wordCount: rv.wordCount
            });
            const updated = selectedProject.reportVersions!.map(v => v.id === selectedReportId ? { ...v, content } : v);
            handleUpdate({ reportVersions: updated });
        } catch (e: any) { alert("生成失败: " + e.message); } finally { removeTask(tid); }
    };

    const handleGeneratePPT = async () => {
        if (!selectedProject || !selectedReportId) return;
        const rv = selectedProject.reportVersions?.find(v => v.id === selectedReportId);
        if (!rv || !rv.content) return alert("请先生成报告正文");
        const tid = `gen-ppt-${rv.id}`;
        addTask(tid);
        try {
            const slides = await generatePPTScript(selectedProject.title, rv.content, {});
            const updated = selectedProject.reportVersions!.map(v => v.id === selectedReportId ? { ...v, pptSlides: slides, pptUpdatedAt: Date.now() } : v);
            handleUpdate({ reportVersions: updated });
            setReportViewMode('ppt');
        } catch (e: any) { alert("生成失败: " + e.message); } finally { removeTask(tid); }
    };

    const handleExportPPTX = async () => {
        if (!selectedProject || !selectedReportId) return;
        const activeReport = selectedProject.reportVersions?.find(v => v.id === selectedReportId);
        if (!activeReport || !activeReport.pptSlides) return;
        try {
            await exportToPPTX(activeReport.pptSlides, `${selectedProject.title}_结项汇报`);
        } catch (e: any) {
            alert("导出 PPTX 失败: " + e.message);
        }
    };

    const handleFileUploadToExpense = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0 || !activeExpenseForFiles || !selectedProject) return;
        const file = files[0];
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const base64Data = ev.target?.result as string;
            const newAtt: FileAttachment = { id: `att-${Date.now()}`, name: file.name, url: base64Data, type: file.type, uploadedAt: Date.now() };
            const updated = selectedProject.expenses.map(exp => exp.id === activeExpenseForFiles.id ? { ...exp, attachments: [...(exp.attachments || []), newAtt] } : exp);
            handleUpdate({ expenses: updated });
            setActiveExpenseForFiles(prev => prev ? { ...prev, attachments: [...(prev.attachments || []), newAtt] } : null);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    const handleFileUploadToEvidence = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (!files || files.length === 0 || !activeMilestoneForEvidence || !selectedProject) return;
        const file = files[0];
        const reader = new FileReader();
        reader.onload = async (ev) => {
            const base64Data = ev.target?.result as string;
            const newAtt: FileAttachment = { id: `att-ms-${Date.now()}`, name: file.name, url: base64Data, type: file.type, uploadedAt: Date.now() };
            const updated = selectedProject.milestones.map(ms => ms.id === activeMilestoneForEvidence.id ? { ...ms, evidence: [...(ms.evidence || []), newAtt] } : ms);
            handleUpdate({ milestones: updated as any });
            setActiveMilestoneForEvidence(prev => prev ? { ...prev, evidence: [...(prev.evidence || []), newAtt] } : null);
        };
        reader.readAsDataURL(file);
        e.target.value = '';
    };

    useEffect(() => {
        if (previewFile?.prompt) {
            setEditedFileContent(previewFile.prompt);
        } else {
            setEditedFileContent('');
        }
    }, [previewFile]);

    const handleSavePrompt = async () => {
        if (!previewFile || !selectedProject || !warehousePath) return;
        
        // Update local state
        setPreviewFile(prev => prev ? { ...prev, prompt: editedFileContent } : null);
        
        // Update diskPosters state
        setDiskPosters(prev => prev.map(p => p.name === previewFile.name ? { ...p, prompt: editedFileContent } : p));

        // Persist to visual_config.json
        const safeWarehouse = warehousePath.endsWith('/') || warehousePath.endsWith('\\') ? warehousePath : `${warehousePath}/`;
        const projectRoot = `${safeWarehouse}${selectedProject.title}/`;
        const visualConfigPath = `${projectRoot}Docs/visual_config.json`;
        
        try {
            if (await window.electronAPI.fs.exists(visualConfigPath)) {
                const content = await window.electronAPI.fs.readFile(visualConfigPath);
                if (content.success && content.data) {
                    const posters: PosterSlot[] = JSON.parse(content.data);
                    // Extract ID from filename
                    const match = previewFile.name.match(/poster_(.+)\./);
                    if (match && match[1]) {
                        const pid = match[1];
                        const updatedPosters = posters.map(p => p.id === pid ? { ...p, finalPrompt: editedFileContent } : p);
                        await window.electronAPI.fs.writeFile(visualConfigPath, JSON.stringify(updatedPosters, null, 2));
                        alert("✅ 提示词已更新");
                    }
                }
            }
        } catch (e) {
            console.error("Failed to save prompt", e);
            alert("保存失败");
        }
    };

    // --- 渲染逻辑 ---

    if (!selectedProjectId || !selectedProject) {
        return (
            <div className="h-full flex flex-col bg-white">
                <div className="px-3 py-2 border-b border-slate-100 bg-white shrink-0 flex items-center gap-2">
                    <button onClick={() => setSidebarCollapsed(prev => !prev)} className={`h-8 w-8 rounded-lg border flex items-center justify-center transition-all ${sidebarCollapsed ? 'bg-slate-900 border-slate-900 text-white' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`} title={sidebarCollapsed ? '展开左栏' : '收起左栏'}>
                        <ProjectIcons.Layout />
                    </button>
                    <button onClick={() => setViewMode(viewMode === 'Active' ? 'Trash' : 'Active')} className={`h-8 w-8 border rounded-lg transition-all flex items-center justify-center ${viewMode === 'Trash' ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`} title={viewMode === 'Active' ? `回收站 ${trashCount}` : '返回活跃'}>
                        {viewMode === 'Active' ? <ProjectIcons.Trash /> : <ProjectIcons.Overview />}
                    </button>
                    <div className="text-xs text-slate-400">{viewMode === 'Active' ? `回收站 ${trashCount}` : '活跃项目'}</div>
                    <div className="flex items-center gap-2 ml-auto">
                        <div className="h-8 p-0.5 rounded-lg border border-slate-200 bg-white flex items-center gap-0.5">
                            <button onClick={() => setProjectViewType('card')} className={`h-6 w-7 rounded-md flex items-center justify-center ${projectViewType === 'card' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`} title="卡片视图"><ProjectIcons.Grid /></button>
                            <button onClick={() => setProjectViewType('list')} className={`h-6 w-7 rounded-md flex items-center justify-center ${projectViewType === 'list' ? 'bg-slate-900 text-white' : 'text-slate-500 hover:bg-slate-100'}`} title="列表视图"><ProjectIcons.List /></button>
                        </div>
                        <div className="relative">
                            <button onClick={() => setShowProjectActions(v => !v)} className={`h-8 w-8 border rounded-lg transition-all flex items-center justify-center ${showProjectActions ? 'bg-slate-900 text-white border-slate-900' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`} title="更多操作">
                                <ProjectIcons.Plus />
                            </button>
                            {showProjectActions && (
                                <div className="absolute right-0 top-10 w-32 bg-white border border-slate-200 rounded-lg shadow-lg p-1.5 z-20">
                                    {viewMode === 'Trash' ? (
                                        <button onClick={() => { handleEmptyTrash(); setShowProjectActions(false); }} className="w-full text-left px-2 py-1.5 rounded text-xs font-semibold text-red-600 hover:bg-red-50">清空回收站</button>
                                    ) : (
                                        <>
                                            <button onClick={() => { setIsImportModalOpen(true); setShowProjectActions(false); }} className="w-full text-left px-2 py-1.5 rounded text-xs font-semibold text-slate-600 hover:bg-slate-50">导入项目</button>
                                            <button onClick={() => {
                                                const p: Project = {
                                                    id: `p-${Date.now()}`,
                                                    title: '新项目',
                                                    domain: '其他',
                                                    startDate: new Date().toISOString().split('T')[0],
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
                                                onCreateProject(p);
                                                setSelectedProjectId(p.id);
                                                syncProjectFilesToDisk(p);
                                                setShowProjectActions(false);
                                            }} className="w-full text-left px-2 py-1.5 rounded text-xs font-semibold text-slate-600 hover:bg-slate-50">新建项目</button>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className="flex-1 min-h-0 flex bg-slate-50/60">
                    {!sidebarCollapsed && (
                        <aside className="w-[290px] border-r border-slate-200 bg-white p-3 space-y-3">
                            <div className="relative">
                                <input type="text" placeholder="搜索项目标题..." value={searchText} onChange={e => setSearchText(e.target.value)} className="w-full pl-10 pr-3 py-2 bg-slate-100 border-none rounded-lg text-sm focus:ring-2 focus:ring-slate-200 focus:bg-white transition-all outline-none" />
                                <span className="absolute left-3 top-2.5 text-slate-400"><ProjectIcons.Search /></span>
                            </div>
                            {viewMode === 'Active' && (
                                <div className="rounded-xl border border-slate-200 bg-white px-3 py-3">
                                    <div className="flex items-center justify-between">
                                        <div className="inline-flex items-center gap-2 text-sm font-bold text-slate-800"><ProjectIcons.Overview />看板</div>
                                        <div className="text-xs text-slate-500">{ledgerStats.overallProgress}%</div>
                                    </div>
                                    <div className="mt-2 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                                        <div className="h-full bg-slate-800 transition-all" style={{ width: `${ledgerStats.overallProgress}%` }} />
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 mt-3">
                                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2"><div className="text-[10px] text-slate-500 inline-flex items-center gap-1"><ProjectIcons.Planning />策划</div><div className="text-base font-black text-slate-800">{ledgerStats.planningCount}</div></div>
                                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2"><div className="text-[10px] text-slate-500 inline-flex items-center gap-1"><ProjectIcons.Execution />执行</div><div className="text-base font-black text-slate-800">{ledgerStats.executionCount}</div></div>
                                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2"><div className="text-[10px] text-slate-500 inline-flex items-center gap-1"><ProjectIcons.Closing />结项</div><div className="text-base font-black text-slate-800">{ledgerStats.closingCount}</div></div>
                                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-2 py-2"><div className="text-[10px] text-slate-500 inline-flex items-center gap-1"><ProjectIcons.Archive />归档</div><div className="text-base font-black text-slate-800">{ledgerStats.archivedCount}</div></div>
                                    </div>
                                    <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-2">
                                        <div className="text-[10px] text-slate-500 inline-flex items-center gap-1"><ProjectIcons.Expenses />预算</div>
                                        <div className="text-base font-black text-slate-800">¥{ledgerStats.totalBudget.toLocaleString()}</div>
                                    </div>
                                </div>
                            )}
                            {viewMode === 'Active' && (
                                <div
                                    className={`rounded-xl border px-3 py-3 bg-white transition-all ${initAttachmentDragging ? 'border-slate-400 bg-slate-50' : 'border-slate-200'}`}
                                    onDragOver={(e) => { e.preventDefault(); setInitAttachmentDragging(true); }}
                                    onDragLeave={() => setInitAttachmentDragging(false)}
                                    onDrop={handleInitAttachmentDrop}
                                >
                                    <div className="flex items-center justify-between mb-2">
                                        <div className="inline-flex items-center gap-2 text-sm font-bold text-slate-800"><ProjectIcons.Magic />AI立项</div>
                                        <button onClick={handleCreateProjectFromDialogue} disabled={isGeneratingProject || initChatRunning} className="h-7 px-2.5 bg-slate-900 text-white rounded-md text-[11px] font-bold disabled:opacity-50">{isGeneratingProject ? '创建中' : '创建'}</button>
                                    </div>
                                    <div className="h-28 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-2">
                                        {initChatMessages.map((m, idx) => (
                                            <div key={`${m.role}-${idx}`} className={`text-xs leading-relaxed ${m.role === 'assistant' ? 'text-slate-600' : 'text-slate-800 font-semibold'}`}>
                                                {m.role === 'assistant' ? 'AI：' : '你：'}{m.text}
                                            </div>
                                        ))}
                                        {initChatRunning && <div className="text-xs text-slate-500">AI 正在思考...</div>}
                                    </div>
                                    <div className="mt-2 flex items-center gap-2">
                                        <input value={initChatInput} onChange={e => setInitChatInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleInitChatSend()} placeholder="继续补充需求..." className="flex-1 h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs outline-none" />
                                        <button onClick={() => setShowAttachmentTools(v => !v)} className={`h-8 w-8 rounded-lg border flex items-center justify-center ${showAttachmentTools ? 'bg-slate-900 text-white border-slate-900' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`} title="附件来源"><ProjectIcons.Attachment /></button>
                                        <button onClick={handleInitChatSend} disabled={initChatRunning || !initChatInput.trim()} className="h-8 w-8 rounded-lg bg-slate-900 text-white flex items-center justify-center disabled:opacity-50"><ProjectIcons.Magic /></button>
                                    </div>
                                    {showAttachmentTools && (
                                        <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-2 space-y-2">
                                            <div className="flex gap-2">
                                                <button onClick={handlePickLocalInitFile} className="h-7 px-2 rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-slate-600 hover:bg-slate-50">本地文件</button>
                                                <button onClick={handlePickLocalInitFolder} className="h-7 px-2 rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-slate-600 hover:bg-slate-50">本地文件夹</button>
                                            </div>
                                            <div className="flex gap-2">
                                                <input value={kbSearchText} onChange={e => setKbSearchText(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearchKbAttachments()} placeholder="知识库检索" className="flex-1 h-7 px-2 rounded-md border border-slate-200 bg-white text-[11px] outline-none" />
                                                <button onClick={handleSearchKbAttachments} disabled={kbSearchLoading} className="h-7 px-2 rounded-md border border-slate-200 bg-white text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">检索</button>
                                            </div>
                                            {kbSearchResults.length > 0 && (
                                                <div className="max-h-20 overflow-y-auto rounded-md border border-slate-200 bg-white p-1.5 space-y-1">
                                                    {kbSearchResults.map(item => (
                                                        <button key={item.path} onClick={() => addInitAttachment({ name: item.name || item.path.split(/[\\/]/).pop() || '文件', path: item.path, origin: 'kb' })} className="w-full text-left text-[11px] px-2 py-1 rounded hover:bg-slate-50 text-slate-600 truncate">+ {item.name}</button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {initAttachments.length > 0 && (
                                        <div className="mt-2 rounded-md border border-slate-200 bg-white p-1.5 max-h-16 overflow-y-auto">
                                            <div className="flex flex-wrap gap-1.5">
                                                {initAttachments.map(att => (
                                                    <span key={att.id} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-100 text-[10px] text-slate-600">
                                                        {att.name}
                                                        <button onClick={() => setInitAttachments(prev => prev.filter(x => x.id !== att.id))} className="text-slate-400 hover:text-red-500">×</button>
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </aside>
                    )}
                    <div className="flex-1 overflow-y-auto p-5 custom-scrollbar">
                        {filteredProjects.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center opacity-30 italic">
                                <div className="text-7xl mb-4">{viewMode === 'Trash' ? '🗑️' : '📁'}</div>
                                <p className="font-black tracking-[0.2em] text-xs">{viewMode === 'Trash' ? '回收站空空如也' : '暂无进行中的项目'}</p>
                            </div>
                        ) : projectViewType === 'card' ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                                {filteredProjects.map(p => {
                                    const isArchiving = isTaskRunning(`archive-${p.id}`);
                                    const isDestroying = isTaskRunning(`destroy-${p.id}`);
                                    const daysLeft = p.deletedAt ? 30 - Math.floor((Date.now() - p.deletedAt) / (24 * 60 * 60 * 1000)) : 0;
                                    const milestoneTotal = (p.milestones || []).length;
                                    const milestoneDone = (p.milestones || []).filter(ms => ms.status === 'Done').length;
                                    const completionRate = milestoneTotal === 0 ? 0 : Math.round((milestoneDone / milestoneTotal) * 100);

                                    return (
                                        <div key={p.id} className={`p-5 rounded-2xl border transition-all group flex flex-col h-full relative hover:-translate-y-0.5 ${p.status === 'Archived' ? 'bg-slate-900 border-slate-800 hover:shadow-slate-900/30' : 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-md'} ${isDestroying ? 'opacity-50 grayscale' : ''}`} onClick={() => !isArchiving && !isDestroying && !p.deletedAt && setSelectedProjectId(p.id)}>
                                            <div className="flex justify-between items-start mb-3">
                                                <div className="relative" onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                                                    {p.deletedAt ? (
                                                        <span className="bg-red-50 text-red-600 px-2 py-1 rounded-lg text-[10px] font-black border border-red-100">剩 {daysLeft} 天</span>
                                                    ) : (
                                                        <select value={p.status} disabled={isArchiving} onChange={(e) => handleStatusChange(p, e.target.value as ProjectStatus)} className={`px-2 py-1 rounded-lg text-[10px] font-black border outline-none transition-all cursor-pointer ${p.status === 'Archived' ? 'bg-slate-800 text-slate-400 border-slate-700' : 'bg-slate-100 text-slate-700 border-slate-200'}`}>
                                                            <option value="Planning">Planning</option>
                                                            <option value="Execution">Execution</option>
                                                            <option value="Closing">Closing</option>
                                                            <option value="Archived">{isArchiving ? '归档中...' : 'Archived'}</option>
                                                        </select>
                                                    )}
                                                </div>
                                                <div className="text-[10px] text-slate-400 font-mono">{p.startDate}</div>
                                            </div>
                                            <h3 className={`font-bold mb-2 truncate text-base transition-colors ${p.status === 'Archived' ? 'text-white group-hover:text-slate-200' : 'text-slate-800 group-hover:text-slate-900'}`}>{p.title}</h3>
                                            <div className="text-xs flex items-center gap-2 mb-4 font-medium">
                                                <span className={`px-2 py-0.5 rounded border text-[10px] ${p.status === 'Archived' ? 'bg-slate-800 border-slate-700 text-slate-500' : 'bg-slate-50 border-slate-100 text-slate-400'}`}>{p.domain}</span>
                                            </div>
                                            {!p.deletedAt && (
                                                <div className={`rounded-xl border px-3 py-2 mb-4 ${p.status === 'Archived' ? 'border-slate-700 bg-slate-800/60' : 'border-slate-200 bg-slate-50/70'}`}>
                                                    <div className="flex justify-between text-[10px] font-bold mb-1.5">
                                                        <span className={`inline-flex items-center gap-1 ${p.status === 'Archived' ? 'text-slate-400' : 'text-slate-500'}`}><ProjectIcons.Milestones />进度</span>
                                                        <span className={p.status === 'Archived' ? 'text-slate-300' : 'text-slate-700'}>{completionRate}%</span>
                                                    </div>
                                                    <div className={`h-1.5 rounded-full overflow-hidden ${p.status === 'Archived' ? 'bg-slate-700' : 'bg-slate-200'}`}><div className="h-full bg-slate-700 transition-all" style={{ width: `${completionRate}%` }}></div></div>
                                                </div>
                                            )}
                                            <div className="mt-auto pt-4 border-t border-slate-100/50 flex justify-between items-center">
                                                <div className="text-xs text-slate-500">{p.leader || '未指派'}</div>
                                                {p.deletedAt ? (
                                                    <div className="flex gap-2" onClick={e => e.stopPropagation()}>
                                                        <button onClick={() => handleRestoreProject(p)} className="p-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-600 hover:text-white transition-all" title="还原项目"><ProjectIcons.Restore /></button>
                                                        <button onClick={() => handlePermanentDestroy(p)} disabled={isDestroying} className="p-1.5 bg-red-50 text-red-600 rounded-lg hover:bg-red-600 hover:text-white transition-all" title="彻底粉碎">{isDestroying ? <span className="animate-pulse block"><ProjectIcons.Destroy /></span> : <ProjectIcons.Destroy />}</button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xs font-black ${p.status === 'Archived' ? 'text-slate-300' : 'text-slate-800'}`}>¥{p.expenses.reduce((a,b)=>a+b.budgetAmount,0).toLocaleString()}</span>
                                                        <button onClick={(e) => { e.stopPropagation(); handleMoveToTrash(p); }} className="text-slate-300 hover:text-red-500 transition-colors" title="移入回收站"><ProjectIcons.Trash /></button>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {filteredProjects.map(p => {
                                    const isArchiving = isTaskRunning(`archive-${p.id}`);
                                    const isDestroying = isTaskRunning(`destroy-${p.id}`);
                                    const daysLeft = p.deletedAt ? 30 - Math.floor((Date.now() - p.deletedAt) / (24 * 60 * 60 * 1000)) : 0;
                                    const milestoneTotal = (p.milestones || []).length;
                                    const milestoneDone = (p.milestones || []).filter(ms => ms.status === 'Done').length;
                                    const completionRate = milestoneTotal === 0 ? 0 : Math.round((milestoneDone / milestoneTotal) * 100);
                                    const projectBudget = (p.expenses || []).reduce((sum, item) => sum + item.budgetAmount, 0);
                                    return (
                                        <div key={p.id} className={`rounded-xl border bg-white px-4 py-3 transition-all ${isDestroying ? 'opacity-50 grayscale' : 'hover:border-slate-300'}`} onClick={() => !isArchiving && !isDestroying && !p.deletedAt && setSelectedProjectId(p.id)}>
                                            <div className="flex items-center gap-4">
                                                <div className="w-44 truncate font-bold text-sm text-slate-800">{p.title}</div>
                                                <div className="w-28 text-xs text-slate-500">{p.startDate}</div>
                                                <div className="w-24 text-xs text-slate-500">{p.domain}</div>
                                                <div className="w-28 text-xs text-slate-600">{p.leader || '未指派'}</div>
                                                <div className="flex-1 min-w-[170px]">
                                                    {p.deletedAt ? (
                                                        <span className="text-[11px] text-red-500 font-semibold">剩 {daysLeft} 天自动粉碎</span>
                                                    ) : (
                                                        <>
                                                            <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden"><div className="h-full bg-slate-700" style={{ width: `${completionRate}%` }} /></div>
                                                            <div className="text-[10px] text-slate-500 mt-1">里程碑 {milestoneDone}/{milestoneTotal} · {completionRate}%</div>
                                                        </>
                                                    )}
                                                </div>
                                                <div className="w-24 text-right text-xs font-black text-slate-800">¥{projectBudget.toLocaleString()}</div>
                                                <div className="w-28 flex justify-end items-center gap-1.5" onClick={e => e.stopPropagation()}>
                                                    {p.deletedAt ? (
                                                        <>
                                                            <button onClick={() => handleRestoreProject(p)} className="p-1.5 rounded-md bg-indigo-50 text-indigo-600 hover:bg-indigo-600 hover:text-white transition-all" title="还原"><ProjectIcons.Restore /></button>
                                                            <button onClick={() => handlePermanentDestroy(p)} className="p-1.5 rounded-md bg-red-50 text-red-600 hover:bg-red-600 hover:text-white transition-all" title="粉碎"><ProjectIcons.Destroy /></button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <button onClick={(e) => { e.stopPropagation(); handleMoveToTrash(p); }} className="p-1.5 rounded-md text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all" title="移入回收站"><ProjectIcons.Trash /></button>
                                                            <select value={p.status} disabled={isArchiving} onChange={(e) => handleStatusChange(p, e.target.value as ProjectStatus)} className="px-2 py-1 rounded-md text-[10px] font-bold border border-slate-200 bg-slate-100 text-slate-700 outline-none">
                                                                <option value="Planning">Planning</option>
                                                                <option value="Execution">Execution</option>
                                                                <option value="Closing">Closing</option>
                                                                <option value="Archived">{isArchiving ? '归档中...' : 'Archived'}</option>
                                                            </select>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
                {isImportModalOpen && <ImportProjectModal onImport={(ps) => { ps.forEach(onCreateProject); setIsImportModalOpen(false); }} onClose={() => setIsImportModalOpen(false)} />}
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col bg-white relative animate-fade-in">
            {toast && (
                <div className="fixed z-[120] right-6 bottom-6">
                    <div className={`px-5 py-3 rounded-2xl shadow-2xl border text-xs font-black ${toast.variant === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-red-50 border-red-200 text-red-700'}`}>
                        {toast.text}
                    </div>
                </div>
            )}
            <input type="file" ref={fileInputRef} onChange={handleFileUploadToExpense} className="hidden" accept="image/*,.pdf,.doc,.docx" />
            <input type="file" ref={receiptUploadRef} onChange={handleSmartReceiptUpload} className="hidden" accept="image/*" />
            <input type="file" ref={evidenceInputRef} onChange={handleFileUploadToEvidence} className="hidden" accept="image/*,.pdf,.doc,.docx" />
            <input type="file" ref={centerUploadRef} className="hidden" accept="image/*,.pdf,.doc,.docx,.md,.txt,.csv" />

            {/* 共享预览模态框 */}
            {previewFile && (
                <div className="fixed inset-0 z-[100] bg-slate-900/60 flex items-center justify-center p-4 backdrop-blur-sm" onClick={() => setPreviewFile(null)}>
                    <div className="bg-white w-full max-w-5xl h-[85vh] rounded-[2.5rem] flex flex-col shadow-2xl overflow-hidden border border-white/20" onClick={e => e.stopPropagation()}>
                        <div className="flex justify-between items-center p-6 border-b border-slate-100 bg-slate-50/50">
                            <div className="flex items-center gap-4"><div className="bg-indigo-600 text-white p-3 rounded-2xl shadow-lg shadow-indigo-100 text-xl">{previewFile.name.toLowerCase().endsWith('.csv') ? '📊' : (previewFile.isImage ? '🖼️' : '📄')}</div><div><h3 className="font-black text-slate-800 text-lg tracking-tight">{previewFile.name}</h3></div></div>
                            <div className="flex gap-2 items-center">
                                {!previewFile.isImage && (
                                    <ExportMenu 
                                        content={previewFile.content || ''} 
                                        type={previewFile.name.toLowerCase().endsWith('.csv') ? 'csv' : 'markdown'} 
                                        fileName={previewFile.name} 
                                    />
                                )}
                                <button onClick={() => setPreviewFile(null)} className="ml-4 text-slate-400 hover:text-red-500 transition-colors"><svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg></button>
                            </div>
                        </div>
                        <div className="flex-1 overflow-hidden relative bg-white">
                            <div className="h-full overflow-y-auto p-10 custom-scrollbar bg-slate-50/20 flex flex-col items-center">
                                {previewFile.isImage ? (
                                    <div className="flex flex-col md:flex-row gap-6 w-full max-w-6xl h-full">
                                        <div className="flex-1 bg-white p-4 rounded-3xl shadow-xl border border-slate-100 flex items-center justify-center bg-slate-50/50">
                                            <img src={previewFile.url || previewFile.content} className="max-h-[60vh] object-contain rounded-xl shadow-sm" />
                                        </div>
                                        {(previewFile.prompt !== undefined || previewFile.name.startsWith('poster_')) && (
                                            <div className="w-full md:w-80 flex flex-col gap-3 shrink-0">
                                                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col flex-1 overflow-hidden">
                                                    <div className="p-3 border-b border-slate-100 bg-slate-50/50 flex justify-between items-center">
                                                        <h4 className="font-black text-xs text-slate-500 uppercase tracking-wider">生成提示词 (Prompt)</h4>
                                                        {previewFile.prompt !== editedFileContent && <span className="text-[10px] text-amber-500 font-bold">已修改</span>}
                                                    </div>
                                                    <textarea 
                                                        value={editedFileContent} 
                                                        onChange={e => setEditedFileContent(e.target.value)} 
                                                        className="flex-1 w-full p-4 text-xs leading-relaxed text-slate-600 outline-none resize-none"
                                                        placeholder="暂无提示词..."
                                                    />
                                                    <div className="p-3 border-t border-slate-100 bg-slate-50/50">
                                                        <button 
                                                            onClick={handleSavePrompt}
                                                            disabled={previewFile.prompt === editedFileContent}
                                                            className={`w-full py-2 rounded-xl text-xs font-black transition-all ${previewFile.prompt === editedFileContent ? 'bg-slate-100 text-slate-400' : 'bg-indigo-600 text-white shadow-lg hover:bg-indigo-700'}`}
                                                        >
                                                            保存修改
                                                        </button>
                                                    </div>
                                                </div>
                                                <button onClick={() => {
                                                    const a = document.createElement('a');
                                                    a.href = previewFile.url || previewFile.content;
                                                    a.download = previewFile.name;
                                                    a.click();
                                                }} className="w-full py-3 bg-white border border-slate-200 rounded-xl text-xs font-black text-slate-600 shadow-sm hover:bg-slate-50 flex items-center justify-center gap-2">
                                                    <ProjectIcons.Download /> 下载图片
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <div className="max-w-3xl w-full bg-white p-12 rounded-[2rem] shadow-sm border border-slate-100 prose prose-indigo prose-sm max-w-none"><ReactMarkdown remarkPlugins={[remarkGfm]}>{previewFile.content}</ReactMarkdown></div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}
            
            <div className="min-h-[58px] px-4 border-b border-slate-200 bg-white flex items-center justify-between shrink-0 gap-4 z-20">
                <div className="flex items-center gap-3 shrink-0">
                    <button onClick={() => setSelectedProjectId(null)} className="text-slate-500 hover:text-slate-700 p-2 rounded-lg hover:bg-slate-50 transition-colors" title="返回列表">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    </button>
                    <div className="h-5 w-px bg-slate-200"></div>
                    <h2 className="text-base font-black text-slate-800 truncate max-w-[200px]" title={selectedProject.title}>{selectedProject.title}</h2>
                </div>

                <div className="flex items-center gap-1 bg-white rounded-lg p-0.5 border border-slate-200">
                    {projectTabs.map(({ key, label, Icon }) => (
                        <button 
                            key={key}
                            onClick={() => setActiveTab(key)}
                            className={`h-8 px-2.5 rounded-md text-xs font-bold transition-all flex items-center gap-1.5 ${
                                activeTab === key 
                                ? 'bg-slate-900 text-white' 
                                : 'text-slate-500 hover:text-slate-700'
                            }`}
                        >
                            <Icon />
                            <span>{label}</span>
                        </button>
                    ))}
                </div>

                <div className="flex items-center gap-3 shrink-0">
                    <div className="flex items-center gap-2 bg-slate-50 rounded-lg p-1 border border-slate-200">
                        <select 
                            value={selectedProject.status}
                            disabled={isTaskRunning(`archive-${selectedProject.id}`)}
                            onChange={(e) => handleStatusChange(selectedProject, e.target.value as ProjectStatus)}
                            className={`pl-2 pr-1 py-1 rounded text-[10px] font-black uppercase tracking-widest outline-none transition-all bg-transparent cursor-pointer ${
                                selectedProject.status === 'Archived' ? 'text-slate-500' : 'text-indigo-600'
                            }`}
                        >
                            <option value="Planning">Planning（策划中）</option>
                            <option value="Execution">Execution（执行中）</option>
                            <option value="Closing">Closing（结项中）</option>
                            <option value="Archived">Archived（归档存证）</option>
                        </select>
                    </div>
                    <button onClick={() => handleMoveToTrash(selectedProject)} className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all" title="移入回收站"><ProjectIcons.Trash /></button>
                </div>
            </div>

            <div className="flex-1 overflow-hidden bg-slate-50">
                {activeTab === 'Overview' && (
                    <div className="h-full flex gap-4 p-4 overflow-hidden">
                        <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-white/50 sticky top-0 z-10">
                                <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2"><ProjectIcons.Overview /> 核心策划方案</h3>
                                <div className="flex gap-2">
                                    <button disabled={selectedProject.planLocked} onClick={() => setIsEditingPlan(!isEditingPlan)} className="px-4 py-1.5 rounded-xl text-xs font-bold bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all">{isEditingPlan ? '预览模式' : '手动编辑'}</button>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-white">
                                {isEditingPlan ? (
                                    <textarea 
                                        value={currentPlanContent} 
                                        onChange={e => handleUpdate({ officialPlanContent: e.target.value })} 
                                        className="w-full h-full p-4 border-none rounded-xl text-sm font-mono focus:ring-0 outline-none resize-none bg-slate-50/30" 
                                        placeholder="在此直接编辑策划案内容..." 
                                    />
                                ) : (
                                    <div className="space-y-8">
                                        <div className="prose prose-slate max-w-none prose-sm leading-relaxed">
                                            <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentPlanContent || '*(暂无内容)*'}</ReactMarkdown>
                                        </div>
                                        
                                        {/* Visual Posters Display Section */}
                                        {selectedProject.originalPlan?.visuals?.posters && selectedProject.originalPlan.visuals.posters.length > 0 && (
                                            <div className="mt-8 pt-8 border-t border-slate-100">
                                                <h4 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2">
                                                    <span>🎨</span> 视觉物料与海报
                                                </h4>
                                                <div className="grid grid-cols-2 gap-4">
                                                    {selectedProject.originalPlan.visuals.posters.map(poster => (
                                                        <div key={poster.id} className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex flex-col gap-3">
                                                            <div 
                                                                className="aspect-[3/4] bg-slate-200 rounded-lg overflow-hidden relative group cursor-zoom-in"
                                                                onClick={() => setPreviewFile({
                                                                    id: poster.id,
                                                                    name: `海报: ${poster.title}`,
                                                                    content: poster.generatedImage || '',
                                                                    isImage: true,
                                                                    url: poster.generatedImage
                                                                })}
                                                            >
                                                                {poster.generatedImage ? (
                                                                    <img src={poster.generatedImage} className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <div className="flex items-center justify-center h-full text-slate-400 text-xs">暂无预览</div>
                                                                )}
                                                            </div>
                                                            <div>
                                                                <div className="font-bold text-xs text-slate-700 truncate">{poster.title}</div>
                                                                <div className="mt-2 bg-white p-2 rounded border border-slate-100 text-[10px] text-slate-500 font-mono break-all select-all">
                                                                    {poster.config.referenceImagePrompt || poster.config.style || '无提示词'}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        
                                        {/* Collected Prompts Section */}
                                        {diskPrompts.length > 0 && (
                                            <div className="mt-8 pt-8 border-t border-slate-100">
                                                <h4 className="text-sm font-black text-slate-800 mb-4 flex items-center gap-2">
                                                    <span>🖼️</span> 收藏的提示词库 (Project Library)
                                                </h4>
                                                <div className="grid grid-cols-2 gap-4">
                                                    {diskPrompts.map((p, idx) => (
                                                        <div key={idx} className="bg-slate-50 rounded-xl p-4 border border-slate-200 flex flex-col gap-3">
                                                            <div 
                                                                className="aspect-[3/4] bg-slate-200 rounded-lg overflow-hidden relative group cursor-zoom-in"
                                                                onClick={() => setPreviewFile({
                                                                    id: `prompt-${idx}`,
                                                                    name: p.name,
                                                                    content: p.image || '',
                                                                    isImage: true,
                                                                    url: p.image
                                                                })}
                                                            >
                                                                {p.image ? (
                                                                    <img src={p.image} className="w-full h-full object-cover" />
                                                                ) : (
                                                                    <div className="flex items-center justify-center h-full text-slate-400 text-xs">无缩略图</div>
                                                                )}
                                                            </div>
                                                            <div>
                                                                 <div className="flex flex-wrap gap-1 mb-2">
                                                                    {(p as any).tags?.map((t: string, i: number) => <span key={`${t}-${i}`} className="px-1.5 py-0.5 bg-indigo-100 text-indigo-700 rounded text-[9px] font-bold">{t}</span>)}
                                                                 </div>
                                                                <div className="bg-white p-2 rounded border border-slate-100 text-[10px] text-slate-500 font-mono break-all select-all h-20 overflow-y-auto custom-scrollbar">
                                                                    {p.content}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                            {/* AI Refinement Area */}
                            {!selectedProject.planLocked && (
                                <div className="p-4 border-t border-slate-100 bg-slate-50/80">
                                    <div className="flex gap-2">
                                        <input 
                                            value={aiRefineInput}
                                            onChange={e => setAiRefineInput(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleAIRefinePlan()}
                                            placeholder="输入 AI 优化指令，例如：'完善预算部分'、'调整为更感性的文风'..."
                                            className="flex-1 px-4 py-2 bg-white border border-slate-200 rounded-xl text-xs outline-none focus:ring-2 focus:ring-indigo-100"
                                        />
                                        <button 
                                            onClick={handleAIRefinePlan}
                                            disabled={isTaskRunning(`refine-plan-${selectedProject.id}`) || !aiRefineInput.trim()}
                                            className="px-4 py-2 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-md hover:bg-indigo-700 disabled:opacity-50 flex items-center gap-2"
                                        >
                                            {isTaskRunning(`refine-plan-${selectedProject.id}`) ? <span className="animate-spin"><ProjectIcons.Magic /></span> : <ProjectIcons.Magic />}
                                            AI 辅助修改
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                        <div className="w-96 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-white/50">
                                <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2"><ProjectIcons.Toolkit /> 执行工具包 (SOP)</h3>
                                <button disabled={selectedProject.planLocked} onClick={handleRefreshSOPList} className="p-2 hover:bg-slate-100 rounded-lg text-slate-400 hover:text-indigo-600 transition-all">
                                    <svg className={`w-4 h-4 ${isTaskRunning(`refresh-sop-${selectedProject.id}`) ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto p-4 custom-scrollbar space-y-3">
                                {(selectedProject.sops || []).map(sop => { const isGen = activeGenerations.has(sop.id); return (<div key={sop.id} className="p-4 rounded-2xl border border-slate-100 bg-slate-50/50 hover:border-indigo-200 transition-all group"><div className="flex items-center justify-between mb-2"><span className="text-xs font-bold text-slate-700 flex items-center gap-2">{sop.type === 'csv' ? '📊' : '📄'} {sop.title}</span>{sop.content && <span className="text-[8px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded font-black">已就绪</span>}</div><div className="flex gap-2"><button onClick={() => handleGenerateSOPContent(sop.id)} disabled={selectedProject.planLocked || isGen} className={`flex-1 py-1.5 rounded-lg text-[10px] font-black transition-all ${isGen ? 'bg-amber-100 text-amber-600 animate-pulse' : 'bg-white border border-slate-200 text-slate-500 hover:text-indigo-600 hover:border-indigo-200'}`}>{isGen ? '撰写中...' : (sop.content ? '重新生成' : '开始生成')}</button>{sop.content && <button onClick={() => setPreviewFile({ id: sop.id, name: sop.title, content: sop.content })} className="px-3 py-1.5 bg-white border border-slate-200 text-slate-500 rounded-lg hover:bg-slate-100 transition-all text-[10px] font-black">预览</button>}</div></div>); })}
                                {selectedProject.sops?.length ? (<div className="p-4 border-t border-slate-100 bg-slate-50/80"><button onClick={async () => { const zip = new JSZip(); selectedProject.sops!.forEach(s => zip.file(s.title, s.content)); const content = await zip.generateAsync({type:"blob"}); const url = URL.createObjectURL(content); const a = document.createElement('a'); a.href = url; a.download=`${selectedProject.title}_SOPs.zip`; a.click(); }} className="w-full bg-slate-900 text-white py-3 rounded-2xl font-black text-xs shadow-xl hover:bg-black transition-all flex items-center justify-center gap-2"><ProjectIcons.Download /> 打包下载 (.zip)</button></div>) : null}
                            </div>
                        </div>
                    </div>
                )}

                {activeTab === 'Expenses' && (
                    <div className="h-full flex flex-col p-4 gap-4 overflow-hidden">
                        <div className="grid grid-cols-4 gap-4 shrink-0">
                            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm"><div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">总预算额</div><div className="text-2xl font-mono font-black text-slate-800">¥{financialStats.totalBudget.toLocaleString()}</div></div>
                            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm"><div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">累计实支</div><div className="text-2xl font-mono font-black text-indigo-600">¥{financialStats.totalActual.toLocaleString()}</div></div>
                            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm"><div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">预算结余</div><div className={`text-2xl font-mono font-black ${financialStats.balance >= 0 ? 'text-green-600' : 'text-red-600'}`}>¥{financialStats.balance.toLocaleString()}</div></div>
                            <div className="flex flex-col gap-2">
                                <button onClick={() => setIsSmartBookkeepingModalOpen(true)} disabled={selectedProject.financialsLocked} className="flex-1 bg-gradient-to-r from-indigo-600 to-blue-600 text-white rounded-xl font-black text-xs shadow-lg flex items-center justify-center gap-2 hover:from-indigo-700 hover:to-blue-700 transition-all">
                                    <span className="text-base">✨</span> 智能记账
                                </button>
                                <button onClick={handleConfirmFinancials} className={`flex-1 border rounded-xl font-black text-xs flex items-center justify-center gap-2 transition-all ${selectedProject.financialsLocked ? 'bg-amber-50 border-amber-200 text-amber-600' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}>{selectedProject.financialsLocked ? '🔒 解除决算锁定' : '✅ 确认项目决算'}</button>
                            </div>
                        </div>
                        <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col overflow-hidden">
                            <div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/30">
                                <h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">科目明细台账</h3>
                                <div className="flex gap-2">
                                    <button onClick={handleAIExtractBudget} disabled={isTaskRunning(`extract-budget-${selectedProject.id}`) || selectedProject.financialsLocked} className="px-4 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-[10px] font-black hover:bg-indigo-100 transition-all flex items-center gap-2">
                                        <ProjectIcons.Magic /> {isTaskRunning(`extract-budget-${selectedProject.id}`) ? '解析中...' : '从方案提取预算'}
                                    </button>
                                    <button onClick={() => handleExportExpenses('csv')} className="px-4 py-1.5 bg-white border border-slate-200 rounded-lg text-[10px] font-black text-slate-600 hover:bg-slate-50 flex items-center gap-2"><ProjectIcons.Download /> 导出 .csv</button>
                                </div>
                            </div>
                            <div className="flex-1 overflow-auto custom-scrollbar"><table className="w-full text-xs text-left border-collapse"><thead className="sticky top-0 bg-white shadow-sm z-10 font-black text-slate-400 uppercase"><tr><th className="p-4 border-b">类别</th><th className="p-4 border-b">项目明细</th><th className="p-4 border-b">预算 (¥)</th><th className="p-4 border-b">实际支出 (¥)</th><th className="p-4 border-b text-center">凭证</th><th className="p-4 border-b">备注</th></tr></thead><tbody className="divide-y divide-slate-100">{(selectedProject?.expenses || []).map(exp => (<tr key={exp.id} className="hover:bg-slate-50/50 transition-colors"><td className="p-4"><input disabled={selectedProject.financialsLocked} value={exp.category} onChange={e => updateExpenseRow(exp.id, { category: e.target.value })} className="bg-transparent outline-none w-full font-bold text-slate-700" /></td><td className="p-4"><input disabled={selectedProject.financialsLocked} value={exp.item} onChange={e => updateExpenseRow(exp.id, { item: e.target.value })} className="bg-transparent outline-none w-full text-slate-600" /></td><td className="p-4"><input disabled={selectedProject.financialsLocked} type="number" value={exp.budgetAmount} onChange={e => updateExpenseRow(exp.id, { budgetAmount: Number(e.target.value) })} className="bg-slate-50/50 rounded px-2 py-1 outline-none w-24 font-mono font-bold text-slate-800" /></td><td className="p-4"><input disabled={selectedProject.financialsLocked} type="number" value={exp.actualAmount} onChange={e => updateExpenseRow(exp.id, { actualAmount: Number(e.target.value) })} className="bg-slate-50/50 rounded px-2 py-1 outline-none w-24 font-mono font-bold text-indigo-600" /></td><td className="p-4 text-center"><button onClick={() => { setActiveExpenseForFiles(exp); fileInputRef.current?.click(); }} className={`p-2 rounded-lg transition-all relative ${ (exp.attachments || []).length > 0 ? 'text-indigo-600 bg-indigo-50' : 'text-slate-400 hover:bg-indigo-50' }`}><ProjectIcons.Attachment />{(exp.attachments || []).length > 0 && <span className="absolute -top-1 -right-1 bg-indigo-600 text-white text-[8px] w-4 h-4 flex items-center justify-center rounded-full font-black border border-white">{(exp.attachments || []).length}</span>}</button></td><td className="p-4"><input disabled={selectedProject.financialsLocked} value={exp.notes} onChange={e => updateExpenseRow(exp.id, { notes: e.target.value })} className="bg-transparent outline-none w-full text-slate-400 italic" placeholder="..." /></td></tr>))}</tbody></table></div>
                        </div>
                    </div>
                )}
                
                {activeTab === 'Milestones' && (
                    <div className="h-full flex flex-col p-4 gap-4 overflow-hidden">
                        <div className="grid grid-cols-4 gap-4 shrink-0">
                            <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm"><div className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">执行进度概览</div><div className="flex items-center gap-4"><div className="text-3xl font-black text-slate-800">{progressStats}%</div><div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden"><div className="h-full bg-emerald-500 transition-all duration-1000" style={{ width: `${progressStats}%` }}></div></div></div></div>
                            <div className="flex flex-col gap-2">
                                <button onClick={handleAIDecomposeMilestones} disabled={isTaskRunning(`decompose-milestones-${selectedProject.id}`) || selectedProject.executionLocked} className="flex-1 bg-emerald-600 text-white rounded-xl font-black text-xs shadow-lg flex items-center justify-center gap-2 hover:bg-emerald-700">
                                    <ProjectIcons.Magic /> {isTaskRunning(`decompose-milestones-${selectedProject.id}`) ? '分解中...' : '方案智能分解任务'}
                                </button>
                                <button onClick={() => { const next = [...(selectedProject?.milestones || []), { id: `ms-${Date.now()}`, stage: '新阶段', task: '点击编辑任务', status: 'Pending', evidence: [] }]; handleUpdate({ milestones: next as any }); }} disabled={selectedProject.executionLocked} className="flex-1 border border-slate-200 bg-white text-slate-600 rounded-xl font-black text-xs flex items-center justify-center gap-2 hover:bg-slate-50 transition-all"><ProjectIcons.Milestones /> 手动添加里程碑</button>
                            </div>
                        </div>
                        <div className="flex-1 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col overflow-hidden"><div className="p-4 border-b border-slate-100 flex justify-between items-center bg-slate-50/30"><h3 className="text-xs font-black text-slate-500 uppercase tracking-[0.2em]">任务进度明细</h3></div><div className="flex-1 overflow-auto custom-scrollbar"><table className="w-full text-xs text-left border-collapse"><thead className="sticky top-0 bg-white shadow-sm z-10 font-black text-slate-400 uppercase"><tr><th className="p-4 border-b">阶段</th><th className="p-4 border-b">任务明细</th><th className="p-4 border-b">负责人</th><th className="p-4 border-b">截止日期</th><th className="p-4 border-b">当前状态</th><th className="p-4 border-b text-center">执行凭证</th><th className="p-4 border-b text-center">操作</th></tr></thead><tbody className="divide-y divide-slate-100">{(selectedProject?.milestones || []).map(ms => (<tr key={ms.id} className="hover:bg-slate-50/50 transition-colors"><td className="p-4"><input disabled={selectedProject.executionLocked} value={ms.stage} onChange={e => updateMilestoneRow(ms.id, { stage: e.target.value })} className="bg-transparent outline-none w-full font-bold text-slate-700" /></td><td className="p-4"><input disabled={selectedProject.executionLocked} value={ms.task} onChange={e => updateMilestoneRow(ms.id, { task: e.target.value })} className="bg-transparent outline-none w-full text-slate-600" /></td><td className="p-4"><select disabled={selectedProject.executionLocked} value={ms.chargePerson} onChange={e => updateMilestoneRow(ms.id, { chargePerson: e.target.value })} className="bg-transparent outline-none w-full"><option value="">指派人...</option>{teamMembers.map(m => <option key={m.id} value={m.nickname}>{m.nickname}</option>)}</select></td><td className="p-4"><input disabled={selectedProject.executionLocked} type="date" value={ms.completionDate} onChange={e => updateMilestoneRow(ms.id, { completionDate: e.target.value })} className="bg-transparent outline-none" /></td><td className="p-4"><select disabled={selectedProject.executionLocked} value={ms.status} onChange={e => updateMilestoneRow(ms.id, { status: e.target.value as any })} className={`px-3 py-1 rounded-lg font-black text-[10px] uppercase border outline-none ${ ms.status === 'Done' ? 'bg-green-50 text-green-600 border-green-200' : ms.status === 'In Progress' ? 'bg-indigo-50 text-indigo-600 border-indigo-200' : 'bg-slate-50 text-slate-400 border-slate-200' }`}><option value="Pending">待启动</option><option value="In Progress">执行中</option><option value="Done">已完成</option></select></td><td className="p-4 text-center"><button onClick={() => { setActiveMilestoneForEvidence(ms); evidenceInputRef.current?.click(); }} className={`p-2 rounded-lg transition-all relative ${ (ms.evidence || []).length > 0 ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400 hover:bg-slate-50' }`}><ProjectIcons.Attachment />{(ms.evidence || []).length > 0 && <span className="absolute -top-1 -right-1 bg-emerald-600 text-white text-[8px] w-4 h-4 flex items-center justify-center rounded-full font-black border border-white">{(ms.evidence || []).length}</span>}</button></td><td className="p-4 text-center"><button onClick={() => handleUpdate({ milestones: (selectedProject?.milestones || []).filter(m => m.id !== ms.id) as any })} className="p-2 text-slate-300 hover:text-red-500 transition-colors"><ProjectIcons.Trash /></button></td></tr>))}</tbody></table></div></div>
                    </div>
                )}
                
                {activeTab === 'Files' && (
                    <div className="h-full flex bg-[#f8fafc] overflow-hidden"><div className="w-64 bg-white border-r border-slate-200 flex flex-col shrink-0"><div className="p-5 border-b border-slate-100 flex items-center gap-3"><div className="p-2 bg-indigo-50 text-indigo-600 rounded-xl"><ProjectIcons.Files /></div><h3 className="font-black text-slate-800 text-sm">目录导航</h3></div><div className="flex-1 p-3 space-y-1">{[{ id: 'All', label: '所有文件', icon: '📁' }, { id: 'Plan', label: '核心策划', icon: '📄' }, { id: 'Visuals', label: '视觉物料', icon: '🎨' }, { id: 'SOP', label: '执行工具包', icon: '🧰' }, { id: 'Finance', label: '财务凭证', icon: '💰' }, { id: 'Execution', label: '执行证据', icon: '✅' }, { id: 'Media', label: '多媒体成果', icon: '🎬' }].map(cat => (<button key={cat.id} onClick={() => setFileCategory(cat.id as any)} className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-bold transition-all ${fileCategory === cat.id ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-500 hover:bg-slate-50'}`}><span>{cat.icon}</span><span>{cat.label}</span>{cat.id !== 'All' && <span className={`ml-auto text-[10px] px-1.5 py-0.5 rounded-full ${fileCategory === cat.id ? 'bg-white/20' : 'bg-slate-100'}`}>{projectFiles.filter(f => f.category === cat.id || (cat.id === 'Media' && (f.type?.startsWith('image/') || f.type?.startsWith('video/'))) || (cat.id === 'Visuals' && f.category === 'Visuals')).length}</span>}</button>))}</div><div className="p-4 border-t border-slate-100"><button onClick={() => centerUploadRef.current?.click()} className="w-full bg-slate-900 text-white py-3 rounded-xl text-xs font-black shadow-lg hover:bg-black transition-all flex items-center justify-center gap-2"><ProjectIcons.Import /> 快速上传文件</button></div></div><div className="flex-1 flex flex-col overflow-hidden"><div className="p-4 border-b border-slate-100 bg-white flex justify-between items-center px-4"><div className="relative w-80"><input type="text" value={fileSearch} onChange={e => setFileSearch(e.target.value)} placeholder="在当前目录搜索文件..." className="w-full pl-10 pr-4 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs focus:ring-2 focus:ring-indigo-100 outline-none" /><span className="absolute left-3.5 top-2.5 opacity-40"><ProjectIcons.Search /></span></div></div><div className="flex-1 overflow-y-auto p-8 custom-scrollbar">{filteredFiles.length === 0 ? (<div className="h-full flex flex-col items-center justify-center opacity-30 italic"><div className="text-6xl mb-4">📂</div><p className="font-black uppercase tracking-[0.2em] text-xs">该目录下暂无文件记录</p></div>) : (<div className="grid grid-cols-1 gap-3">{filteredFiles.map(f => (<div key={f.id} onClick={() => setPreviewFile({ id: f.id, name: f.name, content: f.content || '', url: f.url, isImage: f.type?.startsWith('image/') })} className="bg-white border border-slate-200 p-4 rounded-2xl flex items-center justify-between hover:border-indigo-400 hover:shadow-lg transition-all cursor-pointer group"><div className="flex items-center gap-5 overflow-hidden"><div className="w-14 h-14 bg-slate-50 rounded-2xl border border-slate-100 flex items-center justify-center shrink-0 overflow-hidden">{f.url && f.type?.startsWith('image/') ? <img src={f.url} className="w-full h-full object-cover" /> : <span className="text-2xl">{f.type?.startsWith('image') ? '🖼️' : (f.type?.startsWith('video') ? '🎬' : (f.name.endsWith('.md') ? '📄' : '📊'))}</span>}</div><div className="min-w-0"><div className="font-bold text-slate-800 text-sm truncate">{f.name}</div><div className="flex items-center gap-3 mt-1"><span className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">{f.category}</span><span className="text-[10px] text-slate-400">来源: {f.source}</span><span className="text-[10px] text-slate-300 font-mono">{new Date(f.date).toLocaleDateString()}</span></div></div></div><div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity"><button onClick={(e) => { e.stopPropagation(); const blob = new Blob([f.content || ''], { type: 'text/plain' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = f.url || url; a.download = f.name; a.click(); }} className="p-2 bg-slate-100 border border-slate-200 rounded-xl text-slate-500 hover:bg-indigo-600 hover:text-white transition-all"><ProjectIcons.Download /></button></div></div>))}</div>)}</div></div></div>
                )}

                {activeTab === 'Report' && (
                    <div className="h-full flex bg-slate-50 overflow-hidden">
                        <div className="w-72 bg-white border-r border-slate-200 flex flex-col shrink-0">
                            <div className="p-4 border-b border-slate-100 bg-slate-50/50">
                                <h3 className="font-black text-slate-800 text-sm mb-4">结项汇报管理</h3>
                                <div className="space-y-3 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                                    <div><label className="text-[10px] font-black text-slate-400 uppercase mb-1 block">汇报对象</label><select value={reportParams.audience} onChange={e=>setReportParams({...reportParams, audience: e.target.value})} className="w-full bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-xs font-bold"><option>资方/捐赠人</option><option>合作伙伴/政府</option><option>内部团队/复盘</option><option>公众/新媒体</option></select></div>
                                    <div><label className="text-[10px] font-black text-slate-400 uppercase mb-1 block">篇幅深度</label><select value={reportParams.wordCount} onChange={e=>setReportParams({...reportParams, wordCount: e.target.value})} className="w-full bg-slate-50 border border-slate-100 rounded-xl px-3 py-2 text-xs font-bold">
                                        <option value="1500字左右">1500字 (概要版)</option>
                                        <option value="3000字左右">3000字 (标准版)</option>
                                        <option value="5000字左右">5000字 (深度版)</option>
                                        <option value="10000字左右">10000字 (详尽版)</option>
                                        <option value="20000字左右">20000字 (白皮书版)</option>
                                    </select></div>
                                    <button disabled={selectedProject.reportLocked} onClick={handleCreateReportVersion} className="w-full bg-indigo-600 text-white py-2.5 rounded-xl font-black text-[10px] uppercase shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all">+ 新建报告版本</button>
                                </div>
                            </div>
                            <div className="flex-1 overflow-y-auto p-3 custom-scrollbar space-y-2">
                                {(selectedProject?.reportVersions || []).map(rv => (
                                    <div key={rv.id} onClick={() => setSelectedReportId(rv.id)} className={`p-4 rounded-2xl border transition-all cursor-pointer ${selectedReportId === rv.id ? 'bg-indigo-600 border-indigo-600 text-white shadow-lg' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-400'}`}>
                                        <div className="font-bold text-xs mb-1 truncate">{rv.title}</div>
                                        <div className="flex justify-between items-center opacity-70"><span className="text-[8px] font-black uppercase">{rv.audience}</span><span className="text-[8px] font-mono">{new Date(rv.createdAt).toLocaleDateString()}</span></div>
                                        {isTaskRunning(`gen-report-${rv.id}`) && <div className="mt-2 h-1 bg-white/20 rounded overflow-hidden"><div className="h-full bg-white animate-progress-indeterminate w-full"></div></div>}
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="flex-1 flex flex-col overflow-hidden bg-white shadow-inner">
                            {selectedReportId ? (
                                <>
                                    {(() => {
                                        const activeReport = selectedProject.reportVersions!.find(v => v.id === selectedReportId)!;
                                        return (
                                            <>
                                                <div className="p-4 border-b border-slate-100 flex justify-between items-center px-4 bg-white shrink-0">
                                                    <div className="flex items-center gap-4">
                                                        <div className="flex bg-slate-100/80 p-1 rounded-xl shadow-inner border border-slate-200">
                                                            <button onClick={() => setReportViewMode('preview')} className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${reportViewMode === 'preview' ? 'bg-white text-indigo-600 shadow-sm border border-slate-100' : 'text-slate-500'}`}>预览</button>
                                                            <button onClick={() => setReportViewMode('edit')} className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${reportViewMode === 'edit' ? 'bg-white text-indigo-600 shadow-sm border border-slate-100' : 'text-slate-500'}`}>编辑</button>
                                                            <button onClick={() => setReportViewMode('ppt')} className={`px-4 py-1.5 rounded-lg text-[10px] font-black transition-all ${reportViewMode === 'ppt' ? 'bg-white text-indigo-600 shadow-sm border border-slate-100' : 'text-slate-500'}`}>PPT</button>
                                                        </div>
                                                    </div>
                                                    <div className="flex gap-2">
                                                        {reportViewMode === 'ppt' ? (
                                                            <>
                                                                <button onClick={handleGeneratePPT} disabled={selectedProject.pptLocked || isTaskRunning(`gen-ppt-${activeReport.id}`)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black flex items-center gap-2 shadow-lg shadow-indigo-100 hover:bg-indigo-700">
                                                                    <ProjectIcons.Magic /> AI 生成大纲
                                                                </button>
                                                                {activeReport.pptSlides && <button onClick={handleExportPPTX} className="bg-slate-900 text-white px-4 py-2 rounded-xl text-[10px] font-black flex items-center gap-2 hover:bg-black shadow-lg"><ProjectIcons.Download /> 导出 PPTX</button>}
                                                            </>
                                                        ) : (
                                                            <button onClick={handleGenerateReportFull} disabled={selectedProject.reportLocked || isTaskRunning(`gen-report-${activeReport.id}`)} className="bg-indigo-600 text-white px-4 py-2 rounded-xl text-[10px] font-black flex items-center gap-2 shadow-lg shadow-indigo-100 hover:bg-indigo-700">
                                                                <ProjectIcons.Magic /> AI 同步撰写
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                                <div className="flex-1 overflow-y-auto p-4 custom-scrollbar bg-slate-50/20">
                                                    {reportViewMode === 'preview' && (
                                                        <div className="max-w-4xl mx-auto bg-white p-12 rounded-[2.5rem] shadow-xl border border-slate-100 min-h-full prose prose-indigo prose-sm">
                                                            {activeReport.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{activeReport.content}</ReactMarkdown> : <div className="h-64 flex flex-col items-center justify-center text-slate-300 opacity-60 italic"><p>报告内容为空</p></div>}
                                                        </div>
                                                    )}
                                                    {reportViewMode === 'edit' && (
                                                        <div className="max-w-4xl mx-auto bg-white p-12 rounded-[2.5rem] shadow-xl border border-slate-100 min-h-full">
                                                            <textarea 
                                                                value={activeReport.content} 
                                                                onChange={e => { const updated = (selectedProject?.reportVersions || []).map(v => v.id === activeReport.id ? { ...v, content: e.target.value } : v); handleUpdate({ reportVersions: updated }); }} 
                                                                className="w-full h-full min-h-[500px] outline-none resize-none font-mono text-sm leading-relaxed text-slate-700 bg-transparent" 
                                                                placeholder="手动编辑正文..." 
                                                            />
                                                        </div>
                                                    )}
                                                    {reportViewMode === 'ppt' && (
                                                        <div className="max-w-5xl mx-auto space-y-6 pb-20">
                                                            {!activeReport.pptSlides ? (
                                                                <div className="h-64 flex flex-col items-center justify-center text-slate-300 opacity-60 italic bg-white rounded-[2.5rem] border border-slate-100 shadow-sm"><p>尚未生成 PPT 大纲</p></div>
                                                            ) : (
                                                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                                    {activeReport.pptSlides.map((slide, idx) => (
                                                                        <div key={idx} className="bg-white rounded-3xl border border-slate-200 p-6 hover:border-indigo-500 hover:shadow-xl transition-all flex flex-col">
                                                                            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest mb-4">PAGE {idx + 1}</span>
                                                                            <h4 className="font-black text-slate-800 text-base mb-4 border-b border-slate-50 pb-2">{slide.title}</h4>
                                                                            <ul className="space-y-2 flex-1 mb-6">
                                                                                {slide.content.map((point, pi) => <li key={pi} className="text-xs text-slate-600 flex gap-2"><span className="text-indigo-300 font-black">•</span>{point}</li>)}
                                                                            </ul>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            </>
                                        );
                                    })()}
                                </>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center opacity-30 italic"><div className="text-6xl mb-4">📑</div><p className="font-black uppercase tracking-[0.2em] text-xs text-slate-400">请在左侧选择或创建一个报告版本</p></div>
                            )}
                        </div>
                    </div>
                )}
            </div>
            {isSmartBookkeepingModalOpen && selectedProject && (
                <SmartBookkeepingModal 
                    projectTitle={selectedProject.title}
                    onClose={() => setIsSmartBookkeepingModalOpen(false)}
                    onSaveToProject={(items) => {
                        handleUpdate({ expenses: [...(selectedProject.expenses || []), ...items] });
                        setIsSmartBookkeepingModalOpen(false);
                        alert(`✅ 已成功导入 ${items.length} 条记账记录！`);
                    }}
                />
            )}
            <style>{`
                @keyframes progress-indeterminate {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(100%); }
                }
                .animate-progress-indeterminate {
                    animation: progress-indeterminate 1.5s infinite linear;
                    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent);
                }
            `}</style>
        </div>
    );
};

export default ProjectManager;
