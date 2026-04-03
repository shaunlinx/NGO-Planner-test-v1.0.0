
import React, { useState, useEffect, useMemo, useRef } from 'react';
import Calendar from './components/Calendar';
import PlanModal from './components/PlanModal';
import UpcomingPanel from './components/UpcomingPanel';
import { TimelineVisual, AIScheduleManager } from './components/TimelinePanel';
import ProjectManager from './components/ProjectManager';
import SettingsModal from './components/SettingsModal';
import KnowledgeBase from './components/KnowledgeBase';
import AddEventModal from './components/AddEventModal';
import BatchEventManager from './components/BatchEventManager';
import DayDetailModal from './components/DayDetailModal';
import AuthModal from './components/AuthModal';
import WarehouseSetupModal from './components/WarehouseSetupModal';
import OrgSetupModal from './components/OrgSetupModal';
import TeamSetupModal from './components/TeamSetupModal';
import AIVolunteersManager from './components/AIVolunteersManager';
import AIAgentWorkspace from './components/AIAgentWorkspace';
import ToolCenter from './components/ToolCenter';
import PluginHost from './components/PluginHost';
import ProjectIntelWorkbench from './components/ProjectIntelWorkbench/ProjectIntelWorkbench';
import MasterTaskBoard from './components/MasterTaskBoard';
import GlobalAIAssistant from './components/GlobalAIAssistant';
import KnowledgeAssistantView from './components/KnowledgeAssistantView';
import ClaudeCodeTerminal from './components/ClaudeCodeTerminal';
import OpenClawDashboardPanel from './components/OpenClawDashboardPanel';
import ExtractionModal from './components/ExtractionModal';
import { CalendarEvent, NgoDomain, Project, TeamMember, AppTheme, EventPlanState, SavedSchedule, ProjectLeadSource, Opportunity, ProjectApplication, ExtractionSession, OrgProfile, EventCategory } from './types';
import { CATEGORY_LABELS, MOCK_EVENTS } from './constants';
import { formatDate } from './utils/dateUtils';

const Icons = {
    Calendar: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>,
    Project: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>,
    Dashboard: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>,
    Leads: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>,
    Knowledge: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>,
    AI: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
    Plugin: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M11 4a1 1 0 112 0v1.06a7.002 7.002 0 013.54 2.06l.75-.75a1 1 0 111.42 1.42l-.75.75A7.002 7.002 0 0120.94 11H22a1 1 0 110 2h-1.06a7.002 7.002 0 01-2.06 3.54l.75.75a1 1 0 11-1.42 1.42l-.75-.75A7.002 7.002 0 0113 20.94V22a1 1 0 11-2 0v-1.06a7.002 7.002 0 01-3.54-2.06l-.75.75a1 1 0 11-1.42-1.42l.75-.75A7.002 7.002 0 013.06 13H2a1 1 0 110-2h1.06a7.002 7.002 0 012.06-3.54l-.75-.75a1 1 0 011.42-1.42l.75.75A7.002 7.002 0 0111 5.06V4z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
    Settings: () => <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
    Chevron: ({ className }: { className?: string }) => <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7" /></svg>,
    Workspace: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>,
    Collaboration: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1.8"><path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" /></svg>
};

interface PlanSession {
    id: string;
    event: CalendarEvent;
    isMinimized: boolean;
    status: { loading: boolean, step: 'draft' | 'confirmed', progressInfo?: string };
}

type ModuleType =
  | 'Calendar'
  | 'Projects'
  | 'MasterBoard'
  | 'Leads'
  | 'Knowledge'
  | 'AIVolunteers'
  | 'AIWorkspace'
  | 'ClaudeCode'
  | 'OpenClaw'
  | 'ExternalWorkspace'
  | 'KnowledgeAssistant'
  | 'AITools'
  | `Plugin:${string}`;

type ExternalWindowKind = 'ClaudeCode' | 'OpenClaw';

interface ExternalWindowItem {
  id: string;
  kind: ExternalWindowKind;
  title: string;
}

const RECYCLE_BIN_EXPIRY = 30 * 24 * 60 * 60 * 1000; // 30天 (毫秒)

const App: React.FC = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState('');
  const [warehousePath, setWarehousePath] = useState('');
  const [isWarehouseConfigured, setIsWarehouseConfigured] = useState(false);
  const [isOrgConfigured, setIsOrgConfigured] = useState(false);
  const [isTeamConfigured, setIsTeamConfigured] = useState(false);
  const [createSubfolders, setCreateSubfolders] = useState(true);

  const [events, setEvents] = useState<CalendarEvent[]>(MOCK_EVENTS);
  const [projects, setProjects] = useState<Project[]>([]);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([
      { id: 'tm-1', nickname: '示例成员', role: '项目官', responsibility: '项目执行', department: '项目部', status: 'Active' }
  ]);
  const [leads, setLeads] = useState<ProjectLeadSource[]>([]);
  const [savedPlanStates, setSavedPlanStates] = useState<Record<string, Record<string, EventPlanState>>>({});
  const [savedSchedules, setSavedSchedules] = useState<SavedSchedule[]>([]);
  const [theme, setTheme] = useState<AppTheme>('Day');
  const [preferredDomains, setPreferredDomains] = useState<NgoDomain[]>(['教育', '社区发展']);
  const [orgProfile, setOrgProfile] = useState<OrgProfile>({ name: '', description: '', focusAreas: [] });
  const [calendarVisibleCategories, setCalendarVisibleCategories] = useState<Set<EventCategory>>(new Set(Object.keys(CATEGORY_LABELS) as EventCategory[]));

  const [extractionSessions, setExtractionSessions] = useState<ExtractionSession[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [applications, setApplications] = useState<ProjectApplication[]>([]);
  
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewingDay, setViewingDay] = useState<{ date: Date, events: CalendarEvent[] } | null>(null);
  const [showAddEventModal, setShowAddEventModal] = useState(false);
  const [prefillDate, setPrefillDate] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [showBatchManager, setShowBatchManager] = useState(false);
  const [planSessions, setPlanSessions] = useState<PlanSession[]>([]);
  const [selectedEventIds, setSelectedEventIds] = useState<Set<string>>(new Set());
  const [rightPanelCollapsed, setRightPanelCollapsed] = useState({ upcoming: false, timeline: false, schedule: false });
  const [focusedDate, setFocusedDate] = useState<Date | null>(null);
  const [aiRequest, setAiRequest] = useState<{ text: string, timestamp: number } | null>(null);

  const filteredCalendarEvents = useMemo(() => {
      return events.filter(e => calendarVisibleCategories.has(e.category));
  }, [events, calendarVisibleCategories]);

  const calendarFilterSignature = useMemo(() => {
      return Array.from(calendarVisibleCategories).sort().join('|');
  }, [calendarVisibleCategories]);

  const hasRunningTasks = useMemo(() => {
      return planSessions.some(s => s.isMinimized) || extractionSessions.some(s => s.isMinimized);
  }, [planSessions, extractionSessions]);

  const [activeModule, setActiveModule] = useState<ModuleType>('Calendar');
  const [externalWindows, setExternalWindows] = useState<ExternalWindowItem[]>([]);
  const [activeExternalWindowId, setActiveExternalWindowId] = useState<string | null>(null);
  const [projectManagerInitialSelectedId, setProjectManagerInitialSelectedId] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isAiMenuOpen, setIsAiMenuOpen] = useState(true);
  const [claudeCodeEnabled, setClaudeCodeEnabled] = useState(true);

  const [enabledPlugins, setEnabledPlugins] = useState<any[]>([]);
  const refreshEnabledPlugins = async () => {
      const api = (window as any).electronAPI?.marketplace;
      if (!api?.listPlugins) return;
      try {
          const res = await api.listPlugins();
          if (res?.success) {
              const list = Array.isArray(res.result) ? res.result : [];
              setEnabledPlugins(list.filter((p: any) => p && p.enabled));
          }
      } catch (e) {}
  };
  useEffect(() => {
      refreshEnabledPlugins();
      const handler = () => refreshEnabledPlugins();
      window.addEventListener('plugins-updated', handler as any);
      return () => window.removeEventListener('plugins-updated', handler as any);
  }, []);

  useEffect(() => {
      const load = async () => {
          const db = (window as any).electronAPI?.db;
          if (!db?.getSetting) return;
          try {
              const v = await db.getSetting('claude_code_enabled');
              const en = !(v === false || v === 'false');
              setClaudeCodeEnabled(en);
          } catch (e) {}
      };
      load();
      const handler = () => load();
      window.addEventListener('claude-code-config-updated', handler as any);
      return () => window.removeEventListener('claude-code-config-updated', handler as any);
  }, []);

  const openExternalWindow = (kind: ExternalWindowKind) => {
      setExternalWindows((prev) => {
          const hit = prev.find((x) => x.kind === kind);
          if (hit) {
              setActiveExternalWindowId(hit.id);
              setActiveModule('ExternalWorkspace');
              return prev;
          }
          const id = `${kind}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
          const title = kind === 'OpenClaw' ? 'OpenClaw' : 'Claude Code';
          setActiveExternalWindowId(id);
          setActiveModule('ExternalWorkspace');
          return [...prev, { id, kind, title }];
      });
  };

  const closeExternalWindow = (id: string) => {
      const closing = externalWindows.find((x) => x.id === id);
      setExternalWindows((prev) => {
          const next = prev.filter((x) => x.id !== id);
          setActiveExternalWindowId((cur) => {
              if (cur !== id) return cur;
              if (!next.length) {
                  setActiveModule('Calendar');
                  return null;
              }
              return next[next.length - 1].id;
          });
          return next;
      });
      if (closing?.kind === 'ClaudeCode') {
          try {
              void (window as any).electronAPI?.claudeCode?.killAll?.();
          } catch (e) {}
      }
  };

  const activeExternalWindow = useMemo(
      () => externalWindows.find((x) => x.id === activeExternalWindowId) || null,
      [externalWindows, activeExternalWindowId]
  );
  const hasClaudeWindow = useMemo(
      () => externalWindows.some((x) => x.kind === 'ClaudeCode'),
      [externalWindows]
  );
  const hasOpenClawWindow = useMemo(
      () => externalWindows.some((x) => x.kind === 'OpenClaw'),
      [externalWindows]
  );
  const activeExternalKind = activeExternalWindow?.kind || null;
  
  const [rightPanelPercent, setRightPanelPercent] = useState(31.82); 
  const [isResizing, setIsResizing] = useState(false);
  const [forceVertical, setForceVertical] = useState(false); // Default false for desktop layout

  const [assistants, setAssistants] = useState<any[]>([]);
  const [selectedAssistantId, setSelectedAssistantId] = useState<string | null>(null);
  const persistTimersRef = useRef<Record<string, number>>({});
  const ensureUniqueEventIds = (arr: any[]) => {
      const used = new Set<string>();
      const makeId = () => {
          try {
              return `evt-${crypto.randomUUID()}`;
          } catch (e) {
              return `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
          }
      };
      return (Array.isArray(arr) ? arr : []).map((e: any) => {
          const next = { ...(e || {}) };
          const raw = typeof next.id === 'string' ? next.id.trim() : '';
          let id = raw || makeId();
          while (used.has(id)) id = makeId();
          used.add(id);
          next.id = id;
          return next;
      });
  };

  const persistToDb = (key: string, value: any) => {
      const db = (window as any).electronAPI?.db;
      if (!db?.saveSetting) return;
      const timers = persistTimersRef.current;
      if (timers[key]) window.clearTimeout(timers[key]);
      timers[key] = window.setTimeout(() => {
          try { db.saveSetting(key, value); } catch (e) {}
      }, 400);
  };

  // --- Load Assistants ---
  useEffect(() => {
      if ((window as any).electronAPI?.db) {
          (window as any).electronAPI.db.getSetting('kb_assistants').then((saved: any) => {
              if (Array.isArray(saved)) {
                  setAssistants(saved);
              }
          });
      }
  }, [activeModule]); // Reload when switching modules just in case

  const handleUpdateAssistant = async (updated: any) => {
      const nextAssistants = assistants.map(a => a.id === updated.id ? updated : a);
      setAssistants(nextAssistants);
      if ((window as any).electronAPI?.db) {
          await (window as any).electronAPI.db.saveSetting('kb_assistants', nextAssistants);
      }
  };

  // --- Auto Login Check (Secure Storage) & Data Persistence ---
  useEffect(() => {
      const checkLogin = async () => {
          let dbEvents: any = null;
          let dbSchedules: any = null;
          let dbSelectedIds: any = null;

          // 1. Check Explicit Auth Flag
          const isAuth = localStorage.getItem('app_is_authenticated') === 'true';

          if (isAuth) {
              console.log("[App] Authenticated session found.");
              const provider = localStorage.getItem('user_provider') || 'DeepSeek';
              setCurrentUser(`${provider} User`);
              setIsAuthenticated(true);
          } else {
              console.log("[App] No active session. Enforcing AuthModal.");
              setIsAuthenticated(false);
          }

          // Load Warehouse & Other Configs
          if ((window as any).electronAPI?.db) {
              try {
                  const savedPath = await (window as any).electronAPI.db.getSetting('warehouse_path');
                  const savedSubfolders = await (window as any).electronAPI.db.getSetting('kb_auto_subfolders');
                  const savedOrgConfig = await (window as any).electronAPI.db.getSetting('org_configured');
                  const savedTeamConfig = await (window as any).electronAPI.db.getSetting('team_configured');
                  
                  if (savedPath && savedPath !== 'null' && savedPath !== 'undefined') {
                      const pathStr = String(savedPath);
                      const isPlaceholder = pathStr.includes('/Users/Username/');
                      let exists = true;
                      try {
                          if ((window as any).electronAPI?.fs?.exists) {
                              exists = await (window as any).electronAPI.fs.exists(pathStr);
                          }
                      } catch (e) {
                          exists = true;
                      }
                      if (!exists || isPlaceholder) {
                          setWarehousePath('');
                          setIsWarehouseConfigured(false);
                          try { await (window as any).electronAPI.db.saveSetting('warehouse_path', ''); } catch (e) {}
                      } else {
                          setWarehousePath(pathStr);
                          setIsWarehouseConfigured(true);
                      }
                  }
                  if (savedSubfolders !== undefined) {
                      setCreateSubfolders(savedSubfolders);
                  }
                  if (savedOrgConfig === 'true' || savedOrgConfig === true) {
                      setIsOrgConfigured(true);
                  }
                  if (savedTeamConfig === 'true' || savedTeamConfig === true) {
                      setIsTeamConfigured(true);
                  }

                  // Load Projects from DB
                  const dbProjects = await (window as any).electronAPI.db.getProjects();
                  if (Array.isArray(dbProjects)) {
                      setProjects(dbProjects);
                  }

                  dbEvents = await (window as any).electronAPI.db.getSetting('app_events');
                  dbSchedules = await (window as any).electronAPI.db.getSetting('app_schedules');
                  dbSelectedIds = await (window as any).electronAPI.db.getSetting('app_selected_event_ids');
              } catch (e) {
                  console.error("Failed to load config/projects:", e);
               }
           }
           
           // Load persisted local data
           try {
               const savedTeam = localStorage.getItem('app_team');
               if (savedTeam) setTeamMembers(JSON.parse(savedTeam));

               const savedOrgProfile = localStorage.getItem('app_org_profile');
               if (savedOrgProfile) {
                   const p = JSON.parse(savedOrgProfile);
                   setOrgProfile(p);
                   if (p.focusAreas && p.focusAreas.length > 0) {
                       setPreferredDomains(p.focusAreas as NgoDomain[]);
                   }
               }

               const savedEvents = localStorage.getItem('app_events');
               if (Array.isArray(dbEvents)) setEvents(ensureUniqueEventIds(dbEvents));
               else if (savedEvents) setEvents(ensureUniqueEventIds(JSON.parse(savedEvents)));

               const savedSchedules = localStorage.getItem('app_schedules');
               if (Array.isArray(dbSchedules)) setSavedSchedules(dbSchedules);
               else if (savedSchedules) setSavedSchedules(JSON.parse(savedSchedules));

               const savedSelectedIds = localStorage.getItem('app_selected_event_ids');
               const ids = Array.isArray(dbSelectedIds) ? dbSelectedIds : (savedSelectedIds ? JSON.parse(savedSelectedIds) : []);
               if (Array.isArray(ids)) setSelectedEventIds(new Set(ids.filter((x: any) => typeof x === 'string')));

               const savedLeads = localStorage.getItem('app_leads');
               if (savedLeads) setLeads(JSON.parse(savedLeads));

           } catch (e) { console.error("Failed to load local data:", e); }

           setIsLoading(false);
       };
       checkLogin();
   }, []);

  useEffect(() => {
      const api = (window as any).electronAPI;
      const subscribe = api?.appEvents?.onDataRefresh;
      if (!subscribe || !api?.db) return;
      const unsub = subscribe(async (payload: any) => {
          const keys = Array.isArray(payload?.keys) ? payload.keys.map((x: any) => String(x || '')) : [];
          if (keys.includes('projects')) {
              try {
                  const dbProjects = await api.db.getProjects();
                  if (Array.isArray(dbProjects)) setProjects(dbProjects);
              } catch (e) {}
          }
          if (keys.includes('events')) {
              try {
                  const dbEvents = await api.db.getSetting('app_events');
                  if (Array.isArray(dbEvents)) setEvents(ensureUniqueEventIds(dbEvents));
              } catch (e) {}
          }
          if (keys.includes('leads')) {
              try {
                  const dbLeads = await api.db.getSetting('app_leads');
                  if (Array.isArray(dbLeads)) setLeads(dbLeads);
              } catch (e) {}
          }
          if (keys.includes('schedules')) {
              try {
                  const dbSchedules = await api.db.getSetting('app_schedules');
                  if (Array.isArray(dbSchedules)) setSavedSchedules(dbSchedules);
              } catch (e) {}
          }
          if (keys.includes('team')) {
              try {
                  const dbTeam = await api.db.getSetting('app_team');
                  if (Array.isArray(dbTeam)) setTeamMembers(dbTeam);
              } catch (e) {}
          }
          if (keys.includes('org_profile')) {
              try {
                  const p = await api.db.getSetting('app_org_profile');
                  if (p && typeof p === 'object') setOrgProfile(p);
              } catch (e) {}
          }
          if (keys.includes('selected_event_ids')) {
              try {
                  const ids = await api.db.getSetting('app_selected_event_ids');
                  if (Array.isArray(ids)) setSelectedEventIds(new Set(ids.filter((x: any) => typeof x === 'string')));
              } catch (e) {}
          }
      });
      return () => { try { unsub?.(); } catch (e) {} };
  }, []);

  // --- Auto Save Persistence ---
  useEffect(() => { localStorage.setItem('app_team', JSON.stringify(teamMembers)); persistToDb('app_team', teamMembers); }, [teamMembers]);
  useEffect(() => { localStorage.setItem('app_events', JSON.stringify(events)); persistToDb('app_events', events); }, [events]);
  useEffect(() => { localStorage.setItem('app_schedules', JSON.stringify(savedSchedules)); persistToDb('app_schedules', savedSchedules); }, [savedSchedules]);
  useEffect(() => { localStorage.setItem('app_leads', JSON.stringify(leads)); persistToDb('app_leads', leads); }, [leads]);
  useEffect(() => { const arr = Array.from(selectedEventIds); localStorage.setItem('app_selected_event_ids', JSON.stringify(arr)); persistToDb('app_selected_event_ids', arr); }, [selectedEventIds]);

  useEffect(() => {
      const existing = new Set((events || []).map(e => e.id));
      setSelectedEventIds(prev => {
          const nextArr = Array.from(prev).filter(id => existing.has(id));
          if (nextArr.length === prev.size) return prev;
          return new Set(nextArr);
      });
  }, [events]);

  // --- 回收站自动粉碎逻辑 ---
  useEffect(() => {
      const autoCleanTrash = async () => {
          const now = Date.now();
          const expiredProjects = projects.filter(p => p.deletedAt && (now - p.deletedAt > RECYCLE_BIN_EXPIRY));
          
          if (expiredProjects.length > 0) {
              console.log(`[Auto-Clean] Found ${expiredProjects.length} expired items in trash.`);
              for (const p of expiredProjects) {
                  // 物理删除目录
                  if (window.electronAPI && warehousePath && p.title) {
                      const dir = `${warehousePath}${p.title}/`;
                      await window.electronAPI.fs.deleteDirectory?.(dir);
                  }
                  try {
                      await (window as any).electronAPI?.db?.deleteProject?.(p.id);
                  } catch (e) {}
              }
              // 更新状态，移除已粉碎项目
              setProjects(prev => prev.filter(p => !expiredProjects.some(ep => ep.id === p.id)));
          }
      };

      autoCleanTrash();
      const interval = setInterval(autoCleanTrash, 60 * 60 * 1000); // 每小时扫描一次
      return () => clearInterval(interval);
  }, [projects, warehousePath]);

  useEffect(() => {
    const handleResize = () => {
        // Force desktop layout (horizontal split) if width > 1024px, otherwise adapt
        // We want the default desktop experience to be side-by-side (Fig 2)
        const isDesktop = window.innerWidth >= 1024;
        
        if (isDesktop) {
            setForceVertical(false);
        } else {
            // Mobile/Tablet logic
            const sidebarWidth = isSidebarCollapsed ? 80 : 256;
            const totalAvailableWidth = window.innerWidth - sidebarWidth - 48;
            const panelWidth = (totalAvailableWidth * rightPanelPercent) / 100;
            setForceVertical(panelWidth < 320);
        }
    };
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [rightPanelPercent, isSidebarCollapsed]);

  useEffect(() => {
      const handleMouseMove = (e: MouseEvent) => {
          if (!isResizing || forceVertical) return;
          const sidebarWidth = isSidebarCollapsed ? 80 : 256;
          const totalAvailableWidth = window.innerWidth - sidebarWidth - 48;
          const mouseXInContainer = e.clientX - sidebarWidth - 24;
          
          let newLeftPercent = (mouseXInContainer / totalAvailableWidth) * 100;
          newLeftPercent = Math.max(20, Math.min(75, newLeftPercent));
          setRightPanelPercent(100 - newLeftPercent);
      };

      const handleMouseUp = () => {
          setIsResizing(false);
          document.body.style.cursor = 'default';
      };

      if (isResizing) {
          document.body.style.cursor = 'col-resize';
          window.addEventListener('mousemove', handleMouseMove);
          window.addEventListener('mouseup', handleMouseUp);
      }
      return () => {
          window.removeEventListener('mousemove', handleMouseMove);
          window.removeEventListener('mouseup', handleMouseUp);
      };
  }, [isResizing, forceVertical, isSidebarCollapsed]);

  const handleOpenExtraction = () => {
      const newSession: ExtractionSession = {
          id: `ext-${Date.now()}`,
          status: 'idle',
          files: [],
          inputText: '',
          results: [],
          isMinimized: false,
          createdAt: Date.now()
      };
      setExtractionSessions(prev => [...prev, newSession]);
  };

  const handleUpdateExtraction = (id: string, updates: Partial<ExtractionSession>) => {
      setExtractionSessions(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
  };

  const handleCloseExtraction = (id: string) => setExtractionSessions(prev => prev.filter(s => s.id !== id));
  
  const handleOpenEvent = (event: CalendarEvent) => {
      const existing = planSessions.find(s => s.id === event.id);
      if (existing) { if (existing.isMinimized) setPlanSessions(prev => prev.map(s => s.id === event.id ? { ...s, isMinimized: false } : s)); } 
      else setPlanSessions(prev => [...prev, { id: event.id, event, isMinimized: false, status: { loading: false, step: 'draft' } }]);
  };

  const handleCreateProject = (p: Project) => { 
      setProjects(prev => [...prev, p]); 
      setActiveModule('Projects'); 
      try { (window as any).electronAPI?.db?.saveProject?.(p); } catch (e) {}
  };
  const handleUpdateProject = (p: Project) => { 
      setProjects(prev => prev.map(old => old.id === p.id ? p : old)); 
      try { (window as any).electronAPI?.db?.saveProject?.(p); } catch (e) {}
  };

  const handleBatchToggleIds = (ids: string[], action: 'select' | 'deselect') => {
      setSelectedEventIds(prev => {
          const next = new Set(prev);
          ids.forEach(id => {
              if (action === 'select') next.add(id);
              else next.delete(id);
          });
          return next;
      });
  };

  const handleEventUpdate = (updatedEvent: CalendarEvent) => {
      setEvents(prev => prev.map(e => e.id === updatedEvent.id ? updatedEvent : e));
  };

  const handleAnalyzeDay = (date: Date) => {
      const dateStr = formatDate(date);
      setAiRequest({
          text: `请分析 ${dateStr} 的日程安排，检查是否有冲突，并给出当天的行动建议。`,
          timestamp: Date.now()
      });
  };

  // 处理排期方案中的日历节点同步
  const handleAddEvents = (newEvents: CalendarEvent[]) => {
      setEvents(prev => {
          const used = new Set((prev || []).map(e => e.id));
          const makeId = () => {
              try {
                  return `evt-${crypto.randomUUID()}`;
              } catch (e) {
                  return `evt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
              }
          };
          const normalized = (newEvents || []).map((ne, idx) => {
              const next: any = { ...(ne as any) };
              const raw = typeof next.id === 'string' ? next.id.trim() : '';
              let id = raw || makeId();
              while (used.has(id)) id = `${makeId()}-${idx}`;
              used.add(id);
              next.id = id;
              return next as CalendarEvent;
          });
          return [...(prev || []), ...normalized];
      });
  };

  if (isLoading) return <div className="flex h-screen w-full items-center justify-center bg-[#0f172a]"><div className="w-12 h-12 border-4 border-ngo-teal border-t-transparent rounded-full animate-spin"></div></div>;

  if (!isAuthenticated) return <AuthModal onLoginSuccess={(user) => { setCurrentUser(user); setIsAuthenticated(true); }} />;
  if (!isWarehouseConfigured) return <WarehouseSetupModal onConfirm={async (path, createSub) => {  
      setWarehousePath(path); 
      setCreateSubfolders(createSub);
      setIsWarehouseConfigured(true); 
      if ((window as any).electronAPI?.db) {
          await (window as any).electronAPI.db.saveSetting('warehouse_path', path);
          await (window as any).electronAPI.db.saveSetting('kb_auto_subfolders', createSub);
      }
  }} onLogout={() => {
      setIsAuthenticated(false);
      setCurrentUser('');
      // Optional: Clear stored key if needed, or just let them re-enter
      localStorage.removeItem('user_api_key');
      if ((window as any).electronAPI?.secure) {
           (window as any).electronAPI.secure.set('user_api_key', '');
      }
  }} />;
  
  if (!isOrgConfigured) return <OrgSetupModal 
      onConfirm={async (profile) => {
          setOrgProfile(profile);
          if (profile.focusAreas && profile.focusAreas.length > 0) {
              setPreferredDomains(profile.focusAreas as NgoDomain[]);
          }
          localStorage.setItem('app_org_profile', JSON.stringify(profile));
          setIsOrgConfigured(true);
          if ((window as any).electronAPI?.db) {
              await (window as any).electronAPI.db.saveSetting('app_org_profile', profile);
              await (window as any).electronAPI.db.saveSetting('org_configured', 'true');
          }
      }} 
      onSkip={async () => {
          setIsOrgConfigured(true);
          if ((window as any).electronAPI?.db) {
              await (window as any).electronAPI.db.saveSetting('org_configured', 'true');
          }
      }}
  />;

  if (!isTeamConfigured) return <TeamSetupModal teamMembers={teamMembers} onUpdateTeam={setTeamMembers} onConfirm={async () => {
      setIsTeamConfigured(true);
      if ((window as any).electronAPI?.db) {
          await (window as any).electronAPI.db.saveSetting('team_configured', 'true');
      }
  }} onSkip={async () => {
      setIsTeamConfigured(true);
      if ((window as any).electronAPI?.db) {
          await (window as any).electronAPI.db.saveSetting('team_configured', 'true');
      }
  }} />;

  return (
    <div className={`flex h-screen w-full bg-[#f1f5f9] dark:bg-slate-950 text-slate-900 dark:text-slate-100 font-sans overflow-hidden ${theme === 'Night' ? 'dark' : ''}`}>
        <div 
            onMouseEnter={() => setIsSidebarCollapsed(false)}
            onMouseLeave={() => setIsSidebarCollapsed(true)}
            className={`${isSidebarCollapsed || forceVertical ? 'w-20' : 'w-64'} bg-[#0f172a] text-white flex flex-col shrink-0 transition-all duration-300 z-40 shadow-2xl relative`}
        >
            <div className={`p-6 pt-12 flex items-center gap-3 ${(isSidebarCollapsed || forceVertical) ? 'justify-center px-0' : ''}`}>
                <div className="w-8 h-8 bg-ngo-teal rounded-full flex items-center justify-center font-bold shadow-lg shrink-0 overflow-hidden relative">
                    <img 
                        src="logo.png" 
                        className="w-full h-full object-cover" 
                        onError={(e) => { e.currentTarget.style.display = 'none'; e.currentTarget.nextElementSibling?.classList.remove('hidden'); }}
                    />
                    <span className="hidden absolute inset-0 flex items-center justify-center text-white">N</span>
                </div>
                <span className={`font-bold text-lg whitespace-nowrap tracking-wide overflow-hidden transition-all duration-300 ${isSidebarCollapsed || forceVertical ? 'w-0 opacity-0' : 'w-auto opacity-100'}`}>NGO Planner</span>
            </div>
            <nav className="flex-1 px-4 space-y-1.5 py-4 overflow-y-auto custom-scrollbar">
                <button onClick={() => setActiveModule('Calendar')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-all ${activeModule === 'Calendar' ? 'bg-ngo-teal text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'} ${(isSidebarCollapsed || forceVertical) ? 'justify-center px-0 gap-0' : 'gap-4'}`}>
                    <Icons.Calendar /> 
                    <span className={`font-bold text-sm whitespace-nowrap overflow-hidden transition-all duration-300 ${isSidebarCollapsed || forceVertical ? 'max-w-0 opacity-0' : 'max-w-[200px] opacity-100'}`}>行动日历</span>
                </button>
                <button onClick={() => setActiveModule('Projects')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-all ${activeModule === 'Projects' ? 'bg-ngo-teal text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'} ${(isSidebarCollapsed || forceVertical) ? 'justify-center px-0 gap-0' : 'gap-4'}`}>
                    <Icons.Project /> 
                    <span className={`font-bold text-sm whitespace-nowrap overflow-hidden transition-all duration-300 ${isSidebarCollapsed || forceVertical ? 'max-w-0 opacity-0' : 'max-w-[200px] opacity-100'}`}>项目台账</span>
                </button>
                <button onClick={() => setActiveModule('MasterBoard')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-all ${activeModule === 'MasterBoard' ? 'bg-indigo-600 text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'} ${(isSidebarCollapsed || forceVertical) ? 'justify-center px-0 gap-0' : 'gap-4'}`}>
                    <Icons.Dashboard /> 
                    <span className={`font-bold text-sm whitespace-nowrap overflow-hidden transition-all duration-300 ${isSidebarCollapsed || forceVertical ? 'max-w-0 opacity-0' : 'max-w-[200px] opacity-100'}`}>全局看板</span>
                </button>
                <button onClick={() => setActiveModule('Leads')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-all ${activeModule === 'Leads' ? 'bg-ngo-teal text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'} ${(isSidebarCollapsed || forceVertical) ? 'justify-center px-0 gap-0' : 'gap-4'}`}>
                    <Icons.Leads /> 
                    <span className={`font-bold text-sm whitespace-nowrap overflow-hidden transition-all duration-300 ${isSidebarCollapsed || forceVertical ? 'max-w-0 opacity-0' : 'max-w-[200px] opacity-100'}`}>万物互联</span>
                </button>
                <button onClick={() => setActiveModule('Knowledge')} className={`w-full flex items-center px-4 py-3 rounded-xl transition-all ${activeModule === 'Knowledge' ? 'bg-ngo-teal text-white shadow-lg' : 'text-slate-400 hover:bg-slate-800'} ${(isSidebarCollapsed || forceVertical) ? 'justify-center px-0 gap-0' : 'gap-4'}`}>
                    <Icons.Knowledge /> 
                    <span className={`font-bold text-sm whitespace-nowrap overflow-hidden transition-all duration-300 ${isSidebarCollapsed || forceVertical ? 'max-w-0 opacity-0' : 'max-w-[200px] opacity-100'}`}>知识库</span>
                </button>
                <div className="h-px bg-slate-800 my-4 mx-2 opacity-50"></div>
                <button onClick={() => setIsAiMenuOpen(!isAiMenuOpen)} className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all ${['AIWorkspace', 'AIVolunteers'].includes(activeModule) ? 'text-indigo-400' : 'text-indigo-300/60 hover:bg-slate-800'} ${(isSidebarCollapsed || forceVertical) ? 'justify-center px-0' : ''}`}>
                    <div className={`flex items-center transition-all duration-300 ${isSidebarCollapsed || forceVertical ? 'gap-0' : 'gap-4'}`}>
                        <Icons.AI /> 
                        <span className={`font-bold text-sm whitespace-nowrap overflow-hidden transition-all duration-300 ${isSidebarCollapsed || forceVertical ? 'max-w-0 opacity-0' : 'max-w-[200px] opacity-100'}`}>AI 助手</span>
                    </div>
                    <div className={`transition-all duration-300 overflow-hidden ${isSidebarCollapsed || forceVertical ? 'max-w-0 opacity-0' : 'max-w-[20px] opacity-100'}`}>
                        <Icons.Chevron className={`w-3 h-3 transition-transform ${isAiMenuOpen ? 'rotate-0' : '-rotate-90'}`} />
                    </div>
                </button>
                {!(isSidebarCollapsed || forceVertical) && isAiMenuOpen && (
                    <div className="pl-4 pr-2 space-y-1 animate-fade-in my-2">
                        <div className="bg-slate-800/50 rounded-2xl p-2 space-y-1">
                            {/* Knowledge Assistants Section */}
                            {assistants.length > 0 && (
                                <div className="mb-3 pb-3 border-b border-white/5">
                                    <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest px-2 mb-2 whitespace-nowrap overflow-hidden">专属助手</div>
                                    {assistants.map(ast => (
                                        <button 
                                            key={ast.id}
                                            onClick={() => { setActiveModule('KnowledgeAssistant'); setSelectedAssistantId(ast.id); }}
                                            className={`w-full flex items-center gap-3 py-2 px-3 rounded-xl text-xs font-bold transition-all ${activeModule === 'KnowledgeAssistant' && selectedAssistantId === ast.id ? 'text-white bg-indigo-600 shadow-md' : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'}`}
                                        >
                                            <span>🧠</span> <span className="truncate whitespace-nowrap">{ast.name}</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                            
                            <div className="space-y-1">
                                <div className="text-[9px] font-black text-slate-500 uppercase tracking-widest px-2 mb-1 whitespace-nowrap overflow-hidden">通用工具</div>
                                <button onClick={() => setActiveModule('AIWorkspace')} className={`w-full flex items-center gap-3 py-2 px-3 rounded-xl text-xs font-bold transition-all ${activeModule === 'AIWorkspace' ? 'text-white bg-white/10' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}>
                                    <Icons.Workspace /> <span className="whitespace-nowrap">工作间</span>
                                </button>
                                <button
                                    onClick={() => {
                                        if (!claudeCodeEnabled) {
                                            alert('Claude Code 未启用：请到“系统设置 → 插件市场 → 集成”中启用/配置。');
                                            return;
                                        }
                                        openExternalWindow('ClaudeCode');
                                    }}
                                    className={`w-full flex items-center gap-3 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                                        !claudeCodeEnabled
                                            ? 'text-slate-600 bg-white/5 cursor-not-allowed'
                                            : activeModule === 'ExternalWorkspace' && activeExternalKind === 'ClaudeCode'
                                              ? 'text-white bg-white/10'
                                              : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                                    }`}
                                >
                                    <span className="w-4 h-4 flex items-center justify-center">⌨️</span> <span className="whitespace-nowrap">Claude Code</span>
                                </button>
                                <button
                                    onClick={() => openExternalWindow('OpenClaw')}
                                    className={`w-full flex items-center gap-3 py-2 px-3 rounded-xl text-xs font-bold transition-all ${
                                        activeModule === 'ExternalWorkspace' && activeExternalKind === 'OpenClaw'
                                          ? 'text-white bg-white/10'
                                          : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'
                                    }`}
                                >
                                    <span className="w-4 h-4 flex items-center justify-center">🦾</span> <span className="whitespace-nowrap">OpenClaw</span>
                                </button>
                                <button onClick={() => setActiveModule('AIVolunteers')} className={`w-full flex items-center gap-3 py-2 px-3 rounded-xl text-xs font-bold transition-all ${activeModule === 'AIVolunteers' ? 'text-white bg-white/10' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}>
                                    <Icons.Collaboration /> <span className="whitespace-nowrap">专家协作</span>
                                </button>
                                <button onClick={() => setActiveModule('AITools')} className={`w-full flex items-center gap-3 py-2 px-3 rounded-xl text-xs font-bold transition-all ${activeModule === 'AITools' ? 'text-white bg-white/10' : 'text-slate-500 hover:text-slate-300 hover:bg-white/5'}`}>
                                    <span className="w-4 h-4 flex items-center justify-center">🧩</span> <span className="whitespace-nowrap">工具中心</span>
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {hasRunningTasks && (
                  <div className="mt-8 space-y-2 animate-fade-in">
                      {!(isSidebarCollapsed || forceVertical) && <div className="px-4 text-[10px] font-black text-slate-500 uppercase tracking-widest mb-2 whitespace-nowrap overflow-hidden">正在运行的任务</div>}
                      {planSessions.filter(s => s.isMinimized).map(s => (
                          <button key={s.id} onClick={() => { setActiveModule('Calendar'); setPlanSessions(prev => prev.map(p => p.id === s.id ? { ...p, isMinimized: false } : p)); }} className={`w-full group flex items-center px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 transition-all border border-white/5 ${(isSidebarCollapsed || forceVertical) ? 'justify-center gap-0' : 'gap-3'}`}>
                              <span className="w-2 h-2 rounded-full bg-indigo-400 animate-pulse shrink-0"></span>
                              <span className={`text-[10px] font-bold text-slate-300 truncate whitespace-nowrap overflow-hidden transition-all duration-300 ${isSidebarCollapsed || forceVertical ? 'max-w-0 opacity-0' : 'max-w-[200px] opacity-100'}`}>策划: {s.event.title}</span>
                          </button>
                      ))}
                      {extractionSessions.filter(s => s.isMinimized).map(s => (
                          <button key={s.id} onClick={() => handleUpdateExtraction(s.id, { isMinimized: false })} className={`w-full group flex items-center px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 transition-all border border-white/5 ${(isSidebarCollapsed || forceVertical) ? 'justify-center gap-0' : 'gap-3'}`}>
                              <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shrink-0"></span>
                              <span className={`text-[10px] font-bold text-slate-300 truncate whitespace-nowrap overflow-hidden transition-all duration-300 ${isSidebarCollapsed || forceVertical ? 'max-w-0 opacity-0' : 'max-w-[200px] opacity-100'}`}>AI 提取排期</span>
                          </button>
                      ))}
                  </div>
                )}
            </nav>
            <div className="p-4 border-t border-slate-800/50 mt-auto">
                <button onClick={() => setShowSettings(true)} className={`flex items-center text-slate-400 hover:text-white transition-colors w-full px-2 py-3 rounded-xl ${(isSidebarCollapsed || forceVertical) ? 'justify-center gap-0' : 'gap-4'}`}>
                    <Icons.Settings /> 
                    <span className={`text-xs font-bold whitespace-nowrap overflow-hidden transition-all duration-300 ${isSidebarCollapsed || forceVertical ? 'max-w-0 opacity-0' : 'max-w-[200px] opacity-100'}`}>系统设置</span>
                </button>
            </div>
        </div>

        <div className="flex-1 min-w-0 flex flex-col h-full overflow-hidden p-4 relative">
            <div className="flex-1 w-full bg-white rounded-2xl border border-slate-200 shadow-2xl overflow-hidden flex flex-col">
                <div className={`h-full w-full ${activeModule === 'Calendar' ? 'block' : 'hidden'}`}>
                    <div className={`h-full flex ${forceVertical ? 'flex-col overflow-y-auto' : 'flex-row overflow-hidden'} relative custom-scrollbar`}>
                        <div 
                          style={{ 
                              width: forceVertical ? '100%' : `${100 - rightPanelPercent}%`, 
                              minHeight: forceVertical ? '650px' : 'auto',
                              height: forceVertical ? 'auto' : '100%'
                          }} 
                          className="min-w-0 flex flex-col border-b lg:border-b-0 lg:border-r border-slate-100 transition-all duration-75"
                        >
                            <Calendar year={currentDate.getFullYear()} month={currentDate.getMonth()} events={events} onEventClick={handleOpenEvent} onDayClick={(date, events) => setViewingDay({ date, events })} onPrevMonth={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1))} onNextMonth={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1))} onAddEvent={(date) => { setPrefillDate(date ? formatDate(date) : ''); setShowAddEventModal(true); }} onBatchManage={() => setShowBatchManager(true)} onDeleteEvent={(id) => setEvents(prev => prev.filter(e => e.id !== id))} onEventUpdate={handleEventUpdate} onDayFocus={setFocusedDate} onAnalyzeDay={handleAnalyzeDay} visibleCategories={calendarVisibleCategories} onVisibleCategoriesChange={setCalendarVisibleCategories} />
                        </div>
                        
                        {!forceVertical && (
                          <div 
                              className={`w-1.5 cursor-col-resize hover:bg-indigo-400 transition-all z-30 group relative flex items-center justify-center ${isResizing ? 'bg-indigo-600/30' : 'bg-gray-50'}`} 
                              onMouseDown={() => setIsResizing(true)}
                          >
                              <div className="absolute top-1/2 -translate-y-1/2 w-4 h-16 bg-white border border-slate-200 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg z-40">
                                  <div className="w-0.5 h-6 bg-slate-300 rounded-full"></div>
                              </div>
                          </div>
                        )}

                        <div 
                          style={{ 
                              width: forceVertical ? '100%' : `${rightPanelPercent}%`, 
                              height: forceVertical ? 'auto' : '100%' 
                          }} 
                          className={`flex-1 flex flex-col shrink-0 bg-slate-50/30 ${forceVertical ? '' : 'overflow-hidden'}`}
                        >
                            <div className={`flex-1 flex flex-col ${forceVertical ? 'space-y-4 p-4 pb-12' : 'p-4 gap-4 overflow-hidden'}`}>
                                <div className={`${rightPanelCollapsed.upcoming ? 'h-14' : forceVertical ? 'h-auto' : 'flex-1'} min-h-0 transition-all`}><UpcomingPanel currentDate={new Date()} events={events} teamMembers={teamMembers} savedSchedules={savedSchedules} onEventClick={handleOpenEvent} isCollapsed={rightPanelCollapsed.upcoming} onToggleCollapse={() => setRightPanelCollapsed({...rightPanelCollapsed, upcoming: !rightPanelCollapsed.upcoming})} focusedDate={focusedDate} /></div>
                                <div className={`${rightPanelCollapsed.timeline ? 'h-14' : forceVertical ? 'h-auto' : 'flex-1'} min-h-0 transition-all`}><TimelineVisual events={events} selectedEventIds={selectedEventIds} onToggleEventSelection={(id) => setSelectedEventIds(prev => { const n = new Set(prev); if(n.has(id)) n.delete(id); else n.add(id); return n; })} onBatchEventSelection={handleBatchToggleIds} isCollapsed={rightPanelCollapsed.timeline} onToggleCollapse={() => setRightPanelCollapsed({...rightPanelCollapsed, timeline: !rightPanelCollapsed.timeline})} /></div>
                                <div className={`${rightPanelCollapsed.schedule ? 'h-14' : forceVertical ? 'h-auto' : 'flex-1'} min-h-0 transition-all`}><AIScheduleManager events={events} teamMembers={teamMembers} domain={preferredDomains} schedules={savedSchedules} onUpdateSchedules={setSavedSchedules} onAddEvents={handleAddEvents} selectedEventIds={selectedEventIds} onToggleEventSelection={(id) => setSelectedEventIds(prev => { const n = new Set(prev); if(n.has(id)) n.delete(id); else n.add(id); return n; })} isCollapsed={rightPanelCollapsed.schedule} onToggleCollapse={() => setRightPanelCollapsed({...rightPanelCollapsed, schedule: !rightPanelCollapsed.schedule})} /></div>
                            </div>
                        </div>
                    </div>
                </div>
                <div className={`h-full w-full ${activeModule === 'Projects' ? 'block' : 'hidden'}`}>
                    <ProjectManager projects={projects} teamMembers={teamMembers} warehousePath={warehousePath} createSubfolders={createSubfolders} initialSelectedId={projectManagerInitialSelectedId} onUpdateProject={handleUpdateProject} onDeleteProject={(id) => { setProjects(prev => prev.filter(p => p.id !== id)); try { (window as any).electronAPI?.db?.deleteProject?.(id); } catch (e) {} }} onClose={() => setActiveModule('Calendar')} onCreateProject={handleCreateProject} />
                </div>
                <div className={`h-full w-full ${activeModule === 'Leads' ? 'block' : 'hidden'}`}>
                    <ProjectIntelWorkbench overlayActive={showSettings} />
                </div>
                <div className={`h-full w-full ${activeModule === 'Knowledge' ? 'block' : 'hidden'}`}>
                    <KnowledgeBase projects={projects} teamMembers={teamMembers} preferredDomains={preferredDomains} />
                </div>
                <div className={`h-full w-full ${activeModule === 'AIVolunteers' ? 'block' : 'hidden'}`}>
                    <AIVolunteersManager teamMembers={teamMembers} onAddMember={m=>setTeamMembers([...teamMembers, m])} projects={projects} events={events} />
                </div>
                <div className={`h-full w-full ${activeModule === 'AIWorkspace' ? 'block' : 'hidden'}`}>
                    <AIAgentWorkspace projects={projects} teamMembers={teamMembers} onUpdateProject={handleUpdateProject} warehousePath={warehousePath} />
                </div>
                <div className={`h-full w-full ${activeModule === 'ExternalWorkspace' ? 'block' : 'hidden'}`}>
                    <div className="h-full flex flex-col bg-slate-50">
                        <div className="h-11 border-b border-slate-200 px-3 flex items-end gap-2 overflow-x-auto custom-scrollbar">
                            {externalWindows.map((w) => {
                                const active = w.id === activeExternalWindowId;
                                return (
                                    <div
                                        key={w.id}
                                        className={`h-9 px-3 rounded-t-xl border border-b-0 flex items-center gap-2 shrink-0 cursor-pointer ${
                                            active ? 'bg-white border-slate-300 text-slate-900' : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
                                        }`}
                                        onClick={() => setActiveExternalWindowId(w.id)}
                                    >
                                        <span className="text-xs font-bold whitespace-nowrap">{w.title}</span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                closeExternalWindow(w.id);
                                            }}
                                            className="w-4 h-4 rounded-full hover:bg-slate-300/60 inline-flex items-center justify-center text-[10px] font-black"
                                        >
                                            ×
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="flex-1 min-h-0 bg-white">
                            {hasClaudeWindow && (
                                <div className={`h-full w-full ${activeExternalWindow?.kind === 'ClaudeCode' ? 'block' : 'hidden'}`}>
                                    <ClaudeCodeTerminal defaultCwd={warehousePath || undefined} />
                                </div>
                            )}
                            {hasOpenClawWindow && (
                                <div className={`h-full w-full ${activeExternalWindow?.kind === 'OpenClaw' ? 'block' : 'hidden'}`}>
                                    <OpenClawDashboardPanel active={!showSettings && activeModule === 'ExternalWorkspace' && activeExternalKind === 'OpenClaw'} />
                                </div>
                            )}
                            {!activeExternalWindow && (
                                <div className="h-full flex items-center justify-center text-slate-400 text-sm font-bold">
                                    请选择左侧入口打开 OpenClaw 或 Claude Code
                                </div>
                            )}
                        </div>
                    </div>
                </div>
                <div className={`h-full w-full ${activeModule === 'KnowledgeAssistant' ? 'block' : 'hidden'}`}>
                    {activeModule === 'KnowledgeAssistant' && selectedAssistantId && assistants.find(a => a.id === selectedAssistantId) && (
                        <KnowledgeAssistantView 
                            assistant={assistants.find(a => a.id === selectedAssistantId)}
                            onUpdateAssistant={handleUpdateAssistant}
                        />
                    )}
                    {activeModule === 'KnowledgeAssistant' && (!selectedAssistantId || !assistants.find(a => a.id === selectedAssistantId)) && (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400">
                            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-3xl">🧠</div>
                            <p className="font-bold">请选择一个专属助手</p>
                            <p className="text-xs mt-2 opacity-60">点击左侧边栏的助手名称开始对话</p>
                        </div>
                    )}
                </div>
                <div className={`h-full w-full ${activeModule === 'MasterBoard' ? 'block' : 'hidden'}`}>
                    <MasterTaskBoard projects={projects} teamMembers={teamMembers} onViewProject={(id)=> { setProjectManagerInitialSelectedId(id); setActiveModule('Projects'); }} />
                </div>
                <div className={`h-full w-full ${activeModule === 'AITools' ? 'block' : 'hidden'}`}>
                    <ToolCenter
                        onOpenPlugin={(id) => setActiveModule(`Plugin:${id}`)}
                        onNavigateToModule={(m) => {
                            const key = String(m || '');
                            if (key === 'OpenClaw') {
                                openExternalWindow('OpenClaw');
                                return;
                            }
                            if (key === 'ClaudeCode') {
                                openExternalWindow('ClaudeCode');
                                return;
                            }
                            setActiveModule(m as any);
                        }}
                    />
                </div>
                <div className={`h-full w-full ${String(activeModule).startsWith('Plugin:') ? 'block' : 'hidden'}`}>
                    {(() => {
                        const pluginId = String(activeModule).startsWith('Plugin:') ? String(activeModule).slice(7) : '';
                        const p = enabledPlugins.find((x: any) => x && String(x.id) === pluginId);
                        if (!p) {
                            return (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                    <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-4 text-3xl">🧩</div>
                                    <p className="font-bold">插件不可用</p>
                                    <p className="text-xs mt-2 opacity-60">该插件可能未启用或已卸载</p>
                                </div>
                            );
                        }
                        return <PluginHost plugin={p} onBack={() => setActiveModule('AITools')} />;
                    })()}
                </div>
            </div>
        </div>

        <div style={{ display: activeModule === 'Calendar' ? 'block' : 'none' }}>
            {planSessions.map(s => (<PlanModal key={s.id} event={s.event} onClose={() => setPlanSessions(prev => prev.filter(p => p.id !== s.id))} isMinimized={s.isMinimized} onMinimize={() => setPlanSessions(prev => prev.map(p => p.id === s.id ? { ...p, isMinimized: true } : p))} onRestore={() => setPlanSessions(prev => prev.map(p => p.id === s.id ? { ...p, isMinimized: false } : p))} preSelectedDomain={preferredDomains[0] || '教育'} onDomainChange={() => {}} onCreateProject={handleCreateProject} warehousePath={warehousePath} teamMembers={teamMembers} allEvents={filteredCalendarEvents} eventScopeIds={filteredCalendarEvents.map(e => e.id)} eventScopeSignature={calendarFilterSignature} onSavePlanState={(st) => setSavedPlanStates(prev => ({...prev, [st.eventId]: {[st.plan.type]: st}}))} savedStates={savedPlanStates[s.event.id] as any} mainSidebarCollapsed={isSidebarCollapsed} />))}
        </div>
        {extractionSessions.map(s => (<ExtractionModal key={s.id} session={s} onClose={() => handleCloseExtraction(s.id)} onMinimize={() => handleUpdateExtraction(s.id, { isMinimized: true })} onUpdateSession={(upd) => handleUpdateExtraction(s.id, upd)} onImport={(evs) => { if (showBatchManager) { window.dispatchEvent(new CustomEvent('ai-extraction-complete', { detail: evs })); } else { setEvents(prev => [...prev, ...evs]); } }} />))}
        {showBatchManager && <BatchEventManager customEvents={events.filter(e => e.isCustom)} onUpdateEvents={(upd) => setEvents(prev => [...(prev || []).filter(e=>!e.isCustom), ...(upd || [])])} onClose={() => setShowBatchManager(false)} onOpenAiExtraction={handleOpenExtraction} />}
        {showAddEventModal && <AddEventModal prefillDate={prefillDate} onClose={() => setShowAddEventModal(false)} onAdd={(ev) => setEvents(prev => ([...(prev || []), { ...ev, id: `custom-${Date.now()}`, category: 'Custom', isCustom: true, status: 'Active', locked: false }]))} teamMembers={teamMembers} />}
        {showSettings && <SettingsModal 
            currentUser={currentUser} 
            teamMembers={teamMembers} 
            onUpdateTeam={setTeamMembers} 
            currentTheme={theme} 
            onThemeChange={setTheme} 
            warehousePath={warehousePath} 
            onUpdateWarehouse={setWarehousePath} 
            onClose={() => setShowSettings(false)} 
            preferredDomains={preferredDomains} 
            onUpdateDomains={setPreferredDomains} 
            onNavigateTo={(m:any) => {
                const key = String(m || '');
                if (key === 'OpenClaw') {
                    openExternalWindow('OpenClaw');
                    return;
                }
                if (key === 'ClaudeCode') {
                    openExternalWindow('ClaudeCode');
                    return;
                }
                setActiveModule(m);
            }} 
            orgProfile={orgProfile}
            onUpdateOrgProfile={(p) => {
                setOrgProfile(p);
                localStorage.setItem('app_org_profile', JSON.stringify(p));
                try { (window as any).electronAPI?.db?.saveSetting?.('app_org_profile', p); } catch (e) {}
                if (p.focusAreas && p.focusAreas.length > 0) {
                    setPreferredDomains(p.focusAreas as NgoDomain[]);
                }
            }}
        />}
        {viewingDay && <DayDetailModal date={viewingDay.date} events={viewingDay.events} onClose={() => setViewingDay(null)} onEventClick={handleOpenEvent} onAddEvent={() => { setPrefillDate(formatDate(viewingDay.date)); setShowAddEventModal(true); }} onDeleteEvent={(id) => setEvents(prev => prev.filter(e => e.id !== id))} />}

        <GlobalAIAssistant
            projects={projects}
            events={events}
            teamMembers={teamMembers}
            currentDate={currentDate}
            onNavigateToModule={(m: any) => {
                const key = String(m || '');
                if (key === 'OpenClaw') {
                    openExternalWindow('OpenClaw');
                    return;
                }
                if (key === 'ClaudeCode') {
                    openExternalWindow('ClaudeCode');
                    return;
                }
                setActiveModule(m);
            }}
            onOpenEvent={handleOpenEvent}
            onOpenProject={(projectId) => { setProjectManagerInitialSelectedId(projectId); setActiveModule('Projects'); }}
            pendingRequest={aiRequest}
        />
    </div>
  );
};

export default App;
