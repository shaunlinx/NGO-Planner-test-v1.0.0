import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Project, CalendarEvent, TeamMember, ExtractionSession } from '../types';
import { chatWithKnowledgeBase, callAI } from '../services/geminiService';
import { buildAppToolbox, toolboxPromptText, executeTool } from '../services/mcp/appToolbox';
import { appendAuditLog, sanitizeForModel, withTimeout } from '../services/mcp/security';

interface GlobalAIAssistantProps {
    projects: Project[];
    events: CalendarEvent[];
    teamMembers: TeamMember[];
    currentDate: Date;
    extractionSessions?: ExtractionSession[];
    onNavigateToModule: (module: 'Calendar' | 'Projects' | 'MasterBoard' | 'Leads' | 'Knowledge' | 'AIVolunteers' | 'AIWorkspace') => void;
    onOpenEvent: (event: CalendarEvent) => void;
    onOpenProject: (projectId: string) => void;
    onRestoreExtraction?: (id: string) => void;
    pendingRequest?: { text: string; timestamp: number } | null;
}

interface Message {
    role: 'user' | 'model';
    text: string;
    timestamp: number;
    sources?: string[];
    routedAgentName?: string;
}

interface KnowledgeAssistant {
    id: string;
    name: string;
    contexts: any[];
    systemPrompt: string;
    createdAt: number;
}

const GlobalAIAssistant: React.FC<GlobalAIAssistantProps> = ({ 
    projects, events, teamMembers, currentDate, extractionSessions = [], onNavigateToModule, onOpenEvent, onOpenProject, pendingRequest
}) => {
    const [isOpen, setIsOpen] = useState(false);
    const [assistants, setAssistants] = useState<KnowledgeAssistant[]>([]);
    
    // Position and Dragging State
    const [position, setPosition] = useState({ bottom: 24 }); // Initial bottom-6 (24px)
    const [isDragging, setIsDragging] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    const dragStartRef = useRef({ y: 0, initialBottom: 0 });
    const hasDraggedRef = useRef(false);
    const lastRequestTime = useRef(0);

    const initialGreetingText = '你好！我是全息智能助手。我可以帮你查找日程、分析项目，或自动调用最合适的知识库助手来回答你的问题。';
    const formatDateYYYYMMDD = (d: Date) => {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    };
    const buildInitialMessage = (): Message => ({ role: 'model', text: initialGreetingText, timestamp: Date.now() });

    // Single session for the Global Assistant
    const [messages, setMessages] = useState<Message[]>([
        buildInitialMessage()
    ]);

    const [input, setInput] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [routingStatus, setRoutingStatus] = useState<string>(''); // e.g. "正在分析意图...", "已连接 [财务助手]..."
    const [showSettings, setShowSettings] = useState(false); // New: Settings toggle
    const [mcpPolicy, setMcpPolicy] = useState({
        confirmUi: true,
        confirmWrite: true,
        redactPaths: true,
        audit: true,
        toolTimeoutMs: 15000
    });
    const scrollRef = useRef<HTMLDivElement>(null);
    const activeExtractions = extractionSessions.filter(s => s.status === 'processing' || s.isMinimized);

    useEffect(() => {
        if (window.electronAPI?.db?.getSetting) {
            window.electronAPI.db.getSetting('mcp_policy').then((saved: any) => {
                if (saved && typeof saved === 'object') {
                    setMcpPolicy((prev: any) => ({ ...prev, ...saved }));
                }
            });
        }
    }, [isOpen]);

    const persistMcpPolicy = async (next: any) => {
        setMcpPolicy(next);
        if (window.electronAPI?.db?.saveSetting) {
            await window.electronAPI.db.saveSetting('mcp_policy', next);
        }
    };

    const handleResetToHome = () => {
        if (isLoading) return;
        if (messages.length > 1) {
            const ok = confirm('确定要回到初始界面吗？当前对话记录将被清空。');
            if (!ok) return;
        }
        setShowSettings(false);
        setInput('');
        setRoutingStatus('');
        setMessages([buildInitialMessage()]);
    };

    // Handle Dragging
    const [isDragOver, setIsDragOver] = useState(false);

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;

        // Auto-open if dropped on the ball
        if (!isOpen) setIsOpen(true);

        const file = files[0];
        setMessages(prev => [...prev, { role: 'user', text: `[上传文件] ${file.name}`, timestamp: Date.now() }]);
        setRoutingStatus('正在分析文件...');
        setIsLoading(true);

        try {
            // Check file type
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = async (ev) => {
                    const base64 = ev.target?.result as string;
                    // Use Gemini Vision
                    const analysis = await callAI({
                        model: 'gemini-2.5-flash-image',
                        prompt: "Describe this image in detail. If it's a receipt or document, extract key information.",
                        systemInstruction: "You are a helpful assistant analyzing user uploaded images."
                    });
                    setMessages(prev => [...prev, { role: 'model', text: analysis.text || '无法识别图片内容', timestamp: Date.now() }]);
                    setIsLoading(false);
                    setRoutingStatus('');
                };
                reader.readAsDataURL(file);
            } else {
                setMessages(prev => [...prev, { role: 'model', text: '目前仅支持图片文件分析 (Receipts/Photos)。PDF 支持即将上线。', timestamp: Date.now() }]);
                setIsLoading(false);
                setRoutingStatus('');
            }
        } catch (err: any) {
            setMessages(prev => [...prev, { role: 'model', text: `文件分析失败: ${err.message}`, timestamp: Date.now() }]);
            setIsLoading(false);
            setRoutingStatus('');
        }
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            
            const deltaY = dragStartRef.current.y - e.clientY;
            
            // Only consider it a drag if moved more than 3px
            if (Math.abs(deltaY) > 3) {
                hasDraggedRef.current = true;
            }

            let newBottom = dragStartRef.current.initialBottom + deltaY;
            
            // Constraints
            const padding = 24;
            const maxBottom = window.innerHeight - padding - 48; // 48 is approx max height of button
            const minBottom = padding;
            
            if (newBottom < minBottom) newBottom = minBottom;
            if (newBottom > maxBottom) newBottom = maxBottom;
            
            setPosition({ bottom: newBottom });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsDragging(true);
        hasDraggedRef.current = false;
        dragStartRef.current = { y: e.clientY, initialBottom: position.bottom };
    };

    const handleClick = () => {
        if (!hasDraggedRef.current) {
            setIsOpen(!isOpen);
        }
    };

    // Cache Clearing Handler
    const handleClearCache = async () => {
        if (!window.electronAPI) return;
        if (!confirm("确定要清理所有缓存数据吗？这将释放空间并可能需要重新登录。")) return;
        
        try {
            // @ts-ignore
            const res = await window.electronAPI.app.clearCache({ cache: true, storage: true, temp: true });
            if (res.success) {
                alert("缓存清理完成！应用将刷新。");
                window.location.reload();
            } else {
                alert("清理失败: " + res.error);
            }
        } catch (e: any) {
            alert("错误: " + e.message);
        }
    };

    // Load Assistants for Routing
    useEffect(() => {
        if (window.electronAPI) {
            window.electronAPI.db.getSetting('kb_assistants').then((saved: any) => {
                if (Array.isArray(saved)) {
                    setAssistants(saved);
                }
            });
        }
    }, [isOpen]);

    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, isOpen]);

    const handleSendMessage = async (textOverride?: string) => {
        const textToSend = textOverride || input;
        if (!textToSend.trim() || isLoading) return;
        
        const userMsg: Message = { role: 'user', text: textToSend, timestamp: Date.now() };
        setMessages(prev => [...prev, userMsg]);

        // Only clear input if we used the input state
        if (!textOverride) setInput('');
        
        const currentInput = textToSend;
        setIsLoading(true);
        setRoutingStatus('正在分析意图...');

        try {
            // 1. ROUTING LOGIC
            // Use a lightweight call to decide who handles this
            
            const systemToolsContext = `
            1. Calendar/Schedule: Check events, dates, deadlines. (supports date range)
            2. Projects: Check project status, budget, tasks.
            3. Navigation: Switch to different modules (Calendar, Projects, MasterBoard, Leads, Knowledge, AIVolunteers, AIWorkspace).
            4. General: Chit-chat or general knowledge.
            `;

            const assistantsList = assistants.map(a => `- ${a.name} (ID: ${a.id}): Expert in ${a.contexts.map(c=>c.role).join(', ')}`).join('\n');

            // Context Awareness: Include recent history
            const historyContext = messages.slice(-3).map(m => `${m.role}: ${m.text}`).join('\n');

            const routerPrompt = `
            You are the "Orchestrator" for an NGO management system.
            
            Today is: ${formatDateYYYYMMDD(currentDate)}.

            Context (Recent Conversation):
            ${historyContext}

            User Query: "${currentInput}"
            
            Available Tools:
            [System Tools]
            ${systemToolsContext}

            [Knowledge Base Assistants]
            ${assistantsList}

            Task: Analyze the user's intent based on the query and context. 
            - If the user asks about specific domain knowledge (e.g. finance, execution, specific project details stored in files), choose the best matching Knowledge Base Assistant.
            - If the user asks about schedule, calendar, or overview of projects (metadata), choose "System".
            - If the user explicitly asks to go to, open, or switch to a specific page/module, choose "Navigation".
            - If it's a general greeting or question, choose "General".
            - Use context to resolve pronouns (e.g. "it", "that project").

            Return strictly a JSON object:
            {
                "target": "assistant" | "system" | "general" | "navigation",
                "assistantId": "id if target is assistant",
                "assistantName": "name if target is assistant",
                "refinedQuery": "Optimized query for the assistant (add necessary context if needed)",
                "targetModule": "Calendar" | "Projects" | "MasterBoard" | "Leads" | "Knowledge" | "AIVolunteers" | "AIWorkspace" (if target is navigation),
                "reason": "Brief reason for selection"
            }
            `;

            // We use the flash model for fast routing via callAI service
            const routerResponse = await callAI({ 
                model: 'gemini-2.0-flash-exp', 
                prompt: routerPrompt,
                jsonMode: true
            });
            
            let route: any = { target: 'general' };
            try {
                const text = routerResponse.text;
                route = JSON.parse(text || '{}');
            } catch (e) {
                console.error("Routing parse error", e);
            }

            console.log("Router Decision:", route);

            if (route.target === 'assistant' && route.assistantId) {
                // --- ROUTE TO SPECIFIC ASSISTANT ---
                const targetAssistant = assistants.find(a => a.id === route.assistantId);
                if (targetAssistant) {
                    setRoutingStatus(`已连接专用助手: ${targetAssistant.name}`);
                    
                    // Perform RAG with this assistant's context
                    if (window.electronAPI) {
                        const ingested = await window.electronAPI.db.getSetting('kb_ingested_files') || [];
                        const queryPromises = targetAssistant.contexts.map(async (ctx) => {
                            const targetFiles = new Set<string>();
                            ctx.folderPaths.forEach((folder: string) => {
                                ingested.forEach((file: string) => {
                                    if (file.startsWith(folder)) targetFiles.add(file);
                                });
                            });
                            if (targetFiles.size === 0) return null;
                            
                            // @ts-ignore
                            const result = await window.electronAPI.knowledge.query({ 
                                text: route.refinedQuery || currentInput, 
                                topK: 5, 
                                activeFiles: Array.from(targetFiles),
                                weight: ctx.weight 
                            });
                            return { role: ctx.role, result, weight: ctx.weight };
                        });

                        const results = (await Promise.all(queryPromises)).filter(Boolean);
                        
                        let contextText = results.map((r: any) => {
                            const content = r.result.context || r.result;
                            return `【${r.role}】\n${content}`;
                        }).join('\n\n');

                        // Inject System Prompt of that assistant
                        if (targetAssistant.systemPrompt) {
                            contextText = `【${targetAssistant.name} System Prompt】\n${targetAssistant.systemPrompt}\n\n` + contextText;
                        }

                        // Collect sources
                        const sources = new Set<string>();
                        results.forEach((r: any) => {
                            if (r.result.sources) r.result.sources.forEach((s: string) => sources.add(s));
                        });

                        const response = await chatWithKnowledgeBase(route.refinedQuery || currentInput, contextText, messages.slice(-5));
                        
                        setMessages(prev => [...prev, { 
                            role: 'model', 
                            text: response || '无回答', 
                            timestamp: Date.now(), 
                            sources: Array.from(sources),
                            routedAgentName: targetAssistant.name 
                        }]);
                    }
                } else {
                    // Fallback
                    setMessages(prev => [...prev, { role: 'model', text: `抱歉，我试图连接助手 (ID: ${route.assistantId}) 但未找到。`, timestamp: Date.now() }]);
                }

            } else if (route.target === 'navigation') {
                // --- NAVIGATION ---
                setRoutingStatus(`正在跳转至 ${route.targetModule}...`);
                if (route.targetModule) {
                    onNavigateToModule(route.targetModule as any);
                    setMessages(prev => [...prev, { role: 'model', text: `已为您打开 ${route.targetModule} 模块。`, timestamp: Date.now() }]);
                    // Optionally close or minimize
                } else {
                     setMessages(prev => [...prev, { role: 'model', text: `抱歉，我不确定您想去哪个模块。`, timestamp: Date.now() }]);
                }
            } else if (route.target === 'system') {
                // --- ROUTE TO SYSTEM TOOLS ---
                setRoutingStatus('正在查询系统数据...');

                const toolCtx = {
                    projects,
                    events,
                    teamMembers,
                    currentDate,
                    navigate: onNavigateToModule,
                    openEvent: onOpenEvent,
                    openProject: onOpenProject
                };
                const toolbox = buildAppToolbox(toolCtx);

                const sysPrompt = `
                You are the System Assistant. 
                Today is ${formatDateYYYYMMDD(currentDate)}.
                User Query: "${currentInput}"
                
                Available Tools:
                ${toolboxPromptText(toolbox)}
                
                Decide if you need to call exactly ONE tool to answer the user's query.
                If yes, output a JSON object: {"tool": "tool_name", "args": {...}}.
                If no, output: {"tool": null}.

                Safety Rules:
                - Prefer read-only tools.
                - Only use write tools if the user explicitly requests creating/updating/deleting a saved recipe or other persistent state.
                `;
                
                // First pass: Decide tool
                const decision = await callAI({ model: 'gemini-2.0-flash-exp', prompt: sysPrompt, jsonMode: true });
                let toolCall: any = {};
                try { toolCall = JSON.parse(decision.text || '{}'); } catch (e) {}

                const toolName = toolCall?.tool ?? null;
                const args = toolCall?.args || {};
                const toolDef = toolName ? (toolbox as any[]).find(t => t.name === toolName) : null;
                const sideEffect = toolDef?.sideEffect || 'read';

                let toolExec: any = null;
                if (toolName && toolDef) {
                    if (sideEffect === 'ui' && mcpPolicy.confirmUi) {
                        const ok = confirm(`允许智能中枢执行 UI 操作吗？\n\n工具: ${toolName}\n参数: ${JSON.stringify(sanitizeForModel(args, { redactPaths: true, maxStringLen: 1200 }))}`);
                        if (!ok) {
                            toolExec = { tool: toolName, sideEffect, result: { ok: false, error: 'user_denied' } };
                        }
                    }
                    if (!toolExec && sideEffect === 'write' && mcpPolicy.confirmWrite) {
                        const ok = confirm(`允许智能中枢执行写入操作吗？\n\n工具: ${toolName}\n参数: ${JSON.stringify(sanitizeForModel(args, { redactPaths: true, maxStringLen: 1200 }))}`);
                        if (!ok) {
                            toolExec = { tool: toolName, sideEffect, result: { ok: false, error: 'user_denied' } };
                        }
                    }
                }

                if (!toolExec) {
                    toolExec = await withTimeout(
                        executeTool(toolbox, toolName, args, toolCtx),
                        Number(mcpPolicy.toolTimeoutMs) || 15000,
                        String(toolName || 'tool')
                    );
                }

                const safeArgs = sanitizeForModel(args, { redactPaths: Boolean(mcpPolicy.redactPaths), maxStringLen: 4000 });
                const safeResult = sanitizeForModel(toolExec?.result, { redactPaths: Boolean(mcpPolicy.redactPaths), maxStringLen: 8000 });

                if (mcpPolicy.audit) {
                    await appendAuditLog({
                        ts: Date.now(),
                        userQuery: currentInput,
                        tool: toolExec?.tool ?? toolName,
                        sideEffect: toolExec?.sideEffect ?? sideEffect,
                        args: safeArgs,
                        result: safeResult
                    });
                }

                // Final Answer
                const finalPrompt = `
                User Query: "${currentInput}"
                Tool Call: ${JSON.stringify({ tool: toolExec.tool, args: safeArgs })}
                Tool SideEffect: ${String((toolExec as any).sideEffect || 'unknown')}
                Tool Result: ${JSON.stringify(safeResult)}
                
                Please answer the user's question based on the tool result.
                `;

                const response = await callAI({ model: 'gemini-2.0-flash-exp', prompt: finalPrompt });
                
                setMessages(prev => [...prev, { 
                    role: 'model', 
                    text: response.text || '...', 
                    timestamp: Date.now(),
                    routedAgentName: 'System Kernel'
                }]);

            } else {
                // --- GENERAL CHAT ---
                setRoutingStatus('通用对话模式');
                const response = await chatWithKnowledgeBase(currentInput, '', messages.slice(-5));
                setMessages(prev => [...prev, { role: 'model', text: response || '...', timestamp: Date.now() }]);
            }

        } catch (error: any) {
            setMessages(prev => [...prev, { role: 'model', text: `Error: ${error.message}`, timestamp: Date.now() }]);
        } finally {
            setIsLoading(false);
            setRoutingStatus('');
        }
    };

    // Handle Pending Request
    useEffect(() => {
        if (pendingRequest && pendingRequest.timestamp > lastRequestTime.current) {
            lastRequestTime.current = pendingRequest.timestamp;
            setIsOpen(true);
            // Wait a tick to ensure open animation starts
            setTimeout(() => {
                handleSendMessage(pendingRequest.text);
            }, 100);
        }
    }, [pendingRequest]);

    // Determine current size state
    const isExpanded = isOpen || isHovered;
    const sizeClass = isExpanded ? 'w-12 h-12 rounded-2xl' : 'w-8 h-8 rounded-full'; // Idle: 32px (approx 1/2), Hover: 48px (3/4) - User asked for 1/3 but 24px is tiny. Let's try 32px for idle to be safe, or 24px if strict. Let's stick to 24px as 1/3 of 64 is 21px. 24px is close.
    // Actually, let's use w-7 h-7 (28px) for a bit more visibility, or w-6 (24px).
    // Let's go with w-8 (32px) for "silent" because 24px is extremely small for a main action button. 
    // Wait, "current size to 1/3". 64/3 = 21. "Hover to 3/4". 64*0.75 = 48.
    // Let's implement dynamic classes.
    
    return (
        <div 
            className="fixed right-6 flex flex-col items-end z-[100] gap-4 transition-[bottom] duration-75 ease-out"
            style={{ bottom: `${position.bottom}px` }}
        >
            {/* Holographic Chat Window */}
            {isOpen && (
                <div 
                    className={`w-[500px] h-[600px] bg-white/90 backdrop-blur-xl rounded-[2.5rem] shadow-2xl border flex flex-col overflow-hidden animate-fade-in-up ring-1 ring-slate-900/5 ${isDragOver ? 'border-indigo-500 bg-indigo-50/90' : 'border-white/50'}`}
                    onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                    onDragLeave={() => setIsDragOver(false)}
                    onDrop={handleDrop}
                >
                    {/* Header */}
                    <div className="h-16 border-b border-slate-100/50 flex justify-between items-center px-6 bg-white/50">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white shadow-lg animate-pulse-slow">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                            </div>
                            <div>
                                <h3 className="font-bold text-sm text-slate-800">全息智能中枢</h3>
                                <p className="text-[10px] text-slate-500">Auto-Routing & Contextual AI</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleResetToHome}
                                className="text-slate-400 hover:text-indigo-600 transition-colors"
                                title="回到初始界面"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12a9 9 0 1015.364-6.364M3 12V3m0 9h9" /></svg>
                            </button>
                            <button 
                                onClick={() => setShowSettings(!showSettings)}
                                className="text-slate-400 hover:text-indigo-600 transition-colors"
                                title="设置"
                            >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                            </button>
                            {routingStatus && (
                                <span className="text-[10px] px-2 py-1 bg-indigo-50 text-indigo-600 rounded-full font-bold animate-pulse">
                                    {routingStatus}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* Settings Panel Overlay */}
                    {showSettings && (
                        <div className="absolute top-16 left-0 right-0 bg-white/95 backdrop-blur-xl border-b border-slate-100 p-4 z-20 animate-fade-in shadow-lg">
                            <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">系统维护</h4>
                            <div className="space-y-2">
                                <button 
                                    onClick={handleClearCache}
                                    className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-red-50 text-slate-600 hover:text-red-600 rounded-xl transition-all group"
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                                            🧹
                                        </div>
                                        <div className="text-left">
                                            <div className="text-xs font-bold">深度清理系统缓存</div>
                                            <div className="text-[10px] opacity-60">释放空间 (GPU缓存, 日志, 临时文件, 崩溃报告)</div>
                                        </div>
                                    </div>
                                    <span className="text-xs font-bold">执行</span>
                                </button>
                            </div>
                            <div className="mt-4 pt-4 border-t border-slate-100">
                                <h4 className="text-xs font-bold text-slate-500 uppercase mb-3">安全与权限</h4>
                                <div className="space-y-2 text-xs">
                                    <label className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                                        <span className="font-bold text-slate-600">执行 UI 工具前确认</span>
                                        <input type="checkbox" checked={Boolean(mcpPolicy.confirmUi)} onChange={(e) => persistMcpPolicy({ ...mcpPolicy, confirmUi: e.target.checked })} />
                                    </label>
                                    <label className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                                        <span className="font-bold text-slate-600">执行写入工具前确认</span>
                                        <input type="checkbox" checked={Boolean(mcpPolicy.confirmWrite)} onChange={(e) => persistMcpPolicy({ ...mcpPolicy, confirmWrite: e.target.checked })} />
                                    </label>
                                    <label className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                                        <span className="font-bold text-slate-600">向模型脱敏本机路径</span>
                                        <input type="checkbox" checked={Boolean(mcpPolicy.redactPaths)} onChange={(e) => persistMcpPolicy({ ...mcpPolicy, redactPaths: e.target.checked })} />
                                    </label>
                                    <label className="flex items-center justify-between bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                                        <span className="font-bold text-slate-600">记录审计日志</span>
                                        <input type="checkbox" checked={Boolean(mcpPolicy.audit)} onChange={(e) => persistMcpPolicy({ ...mcpPolicy, audit: e.target.checked })} />
                                    </label>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar" ref={scrollRef}>
                        {messages.map((m, i) => (
                            <div key={i} className={`flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                                {m.routedAgentName && (
                                    <span className="text-[9px] text-slate-400 mb-1 px-2">via {m.routedAgentName}</span>
                                )}
                                <div className={`max-w-[90%] p-4 rounded-2xl text-xs shadow-sm leading-relaxed backdrop-blur-sm ${m.role === 'user' ? 'bg-slate-100 text-slate-800 rounded-br-none' : 'bg-white/80 text-slate-700 border border-white rounded-bl-none'}`}>
                                    <div className="prose prose-sm prose-indigo max-w-none">
                                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.text}</ReactMarkdown>
                                    </div>
                                    {m.sources && m.sources.length > 0 && (
                                        <div className="mt-2 pt-2 border-t border-indigo-100/20 text-[9px] opacity-70 flex flex-wrap gap-1">
                                            <span>📚</span>
                                            {m.sources.slice(0, 3).map((s, si) => (
                                                <span key={si} className="underline truncate max-w-[100px]">{s.split(/[\\/]/).pop()}</span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                        {isLoading && (
                            <div className="flex justify-start">
                                <div className="bg-white/50 border border-white p-3 rounded-2xl flex gap-1 items-center">
                                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce"></span>
                                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.2s]"></span>
                                    <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce [animation-delay:0.4s]"></span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Quick Actions (Empty Input State) */}
                    {messages.length === 1 && (
                        <div className="px-6 pb-4 grid grid-cols-2 gap-2">
                            <button 
                                onClick={() => handleSendMessage("分析当前所有项目的进度风险")}
                                className="p-3 bg-slate-50 hover:bg-indigo-50 border border-slate-100 rounded-xl text-left transition-colors group"
                            >
                                <div className="text-[10px] font-bold text-slate-500 group-hover:text-indigo-600 mb-1">📊 项目分析</div>
                                <div className="text-[9px] text-slate-400">检查所有进行中项目的风险点</div>
                            </button>
                            <button 
                                onClick={() => handleSendMessage("下周有什么重要的日程？")}
                                className="p-3 bg-slate-50 hover:bg-indigo-50 border border-slate-100 rounded-xl text-left transition-colors group"
                            >
                                <div className="text-[10px] font-bold text-slate-500 group-hover:text-indigo-600 mb-1">📅 日程概览</div>
                                <div className="text-[9px] text-slate-400">查看近期会议与截止日期</div>
                            </button>
                        </div>
                    )}

                    {/* Input */}
                    <div className="p-4 bg-white/60 border-t border-slate-100/50 backdrop-blur-md">
                        <div className="relative flex items-center">
                            <input 
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={e => e.key === 'Enter' && handleSendMessage()}
                                placeholder="输入问题，AI 将自动调度最合适的助手..."
                                className="w-full pl-5 pr-12 py-3 bg-white border border-slate-200 rounded-2xl text-xs font-bold focus:ring-4 focus:ring-indigo-100/50 outline-none transition-all shadow-sm"
                            />
                            <button onClick={() => handleSendMessage()} disabled={isLoading} className="absolute right-2 p-2 bg-slate-900 text-white rounded-xl shadow-lg hover:bg-black transition-all">
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 10l7-7m0 0l7 7m-7-7v18" /></svg>
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Floating Ball */}
            <button 
                onMouseDown={handleMouseDown}
                onClick={handleClick}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
                onDragOver={(e) => { e.preventDefault(); setIsHovered(true); }}
                onDrop={handleDrop}
                className={`${isExpanded ? 'w-12 h-12 rounded-2xl' : 'w-7 h-7 rounded-[14px]'} shadow-2xl flex items-center justify-center transition-all duration-300 z-[100] transform active:scale-90 relative backdrop-blur-md border border-white/20 ${isOpen ? 'bg-indigo-600/90 rotate-90' : 'bg-slate-900/90'} cursor-move`}
            >
                {isOpen ? (
                    <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg>
                ) : (
                    <>
                        <div className="relative flex items-center justify-center">
                            <div className={`${isExpanded ? 'w-6 h-6' : 'w-4 h-4'} text-indigo-300 animate-float mix-blend-screen transition-all duration-300`}>
                                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                            </div>
                            <div className={`absolute inset-0 ${isExpanded ? 'w-6 h-6' : 'w-4 h-4'} text-purple-400 animate-pulse blur-sm opacity-50 transition-all duration-300`}>
                                <svg fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" /></svg>
                            </div>
                            {activeExtractions.length > 0 && (
                                <span className="absolute -top-1 -right-1 w-3 h-3 bg-pink-500 border border-slate-900 text-[6px] font-black text-white flex items-center justify-center rounded-full animate-bounce">
                                    {activeExtractions.length}
                                </span>
                            )}
                        </div>
                    </>
                )}
            </button>
            <style>{`
                @keyframes float { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-1px); } }
                .animate-float { animation: float 3s ease-in-out infinite; }
                .animate-pulse-slow { animation: pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite; }
            `}</style>
        </div>
    );
};

export default GlobalAIAssistant;
