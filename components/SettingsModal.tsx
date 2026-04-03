
import React, { useState, useEffect } from 'react';
import { 
  TeamMember, AppTheme, NgoDomain, TeamRole, MainResponsibility, 
  ScheduleType, UnavailablePeriod, MemberStatus, OrgProfile,
  VisualProvider, VisualEngineConfig
} from '../types';
import { CustomLLMConfig } from '../services/llm/CustomOpenAIProvider';
import { DeepSeekProvider } from '../services/llm/DeepSeekProvider';
import { GeminiProvider } from '../services/llm/GeminiProvider';
import { DOMAINS } from '../constants';
import { isDesktopApp } from '../utils/platformUtils';

interface SettingsModalProps {
  onClose: () => void;
  teamMembers: TeamMember[];
  onUpdateTeam: (members: TeamMember[]) => void;
  currentTheme: AppTheme;
  onThemeChange: (theme: AppTheme) => void;
  warehousePath: string;
  onUpdateWarehouse: (path: string) => void;
  currentUser: string;
  preferredDomains: NgoDomain[];
  onUpdateDomains: (domains: NgoDomain[]) => void;
  onNavigateTo: (module: string) => void;
  orgProfile?: OrgProfile;
  onUpdateOrgProfile?: (profile: OrgProfile) => void;
}

// 对应用户截图中的图标标签映射
const PRESET_TRAIT_OBJECTS = [
    { label: "创意脑洞", icon: "💡" },
    { label: "执行力强", icon: "⚡" },
    { label: "文案高手", icon: "✍️" },
    { label: "视觉审美", icon: "🎨" },
    { label: "社牛属性", icon: "🤝" },
    { label: "数据分析", icon: "📊" },
    { label: "细致耐心", icon: "🧘" },
    { label: "逻辑严密", icon: "🧠" },
    { label: "演讲表达", icon: "🎤" },
    { label: "资源丰富", icon: "💰" },
    { label: "摄影摄像", icon: "📷" },
    { label: "技术支持", icon: "💻" }
];

const WEEKDAYS = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

const SettingsModal: React.FC<SettingsModalProps> = ({
  onClose, teamMembers, onUpdateTeam, currentTheme, onThemeChange, 
  warehousePath, onUpdateWarehouse, currentUser, preferredDomains, onUpdateDomains, onNavigateTo,
  orgProfile, onUpdateOrgProfile
}) => {
  const [activeTab, setActiveTab] = useState<'General' | 'Team' | 'AI' | 'Account' | 'Integrations' | 'DigitalTwin' | 'About'>('General');
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [newTrait, setNewTrait] = useState('');
  const [newPeriod, setNewPeriod] = useState({ start: '', end: '', reason: '' });
  
  const [apiState, setApiState] = useState({
    deepseek: { key: '', status: 'active' as 'active' | 'paused' },
    google: { key: '', status: 'active' as 'active' | 'paused' }
  });
  const [modelState, setModelState] = useState({
    deepseek: localStorage.getItem('user_model_deepseek') || 'deepseek-chat',
    google: localStorage.getItem('user_model_google') || 'gemini-2.0-flash-exp'
  });

  useEffect(() => {
    const loadKeys = async () => {
        const secure = (window as any).electronAPI?.secure;
        
        // DeepSeek
        let dsKey = localStorage.getItem('user_api_key_deepseek') || '';
        if (secure) {
            const k = await secure.get('user_api_key_deepseek');
            if (k) dsKey = k;
        }
        let dsStatus = (localStorage.getItem('user_api_status_deepseek') as any) || 'active';
        if (secure) {
            const s = await secure.get('user_api_status_deepseek');
            if (s) dsStatus = s;
        }

        // Google
        let gKey = localStorage.getItem('user_api_key_google') || '';
        if (secure) {
            const k = await secure.get('user_api_key_google');
            if (k) gKey = k;
        }
        let gStatus = (localStorage.getItem('user_api_status_google') as any) || 'active';
        if (secure) {
            const s = await secure.get('user_api_status_google');
            if (s) gStatus = s;
        }
        let dsModel = localStorage.getItem('user_model_deepseek') || 'deepseek-chat';
        let gModel = localStorage.getItem('user_model_google') || 'gemini-2.0-flash-exp';
        const db = (window as any).electronAPI?.db;
        if (db?.getSetting) {
            const m1 = await db.getSetting('user_model_deepseek');
            const m2 = await db.getSetting('user_model_google');
            if (m1) dsModel = m1;
            if (m2) gModel = m2;
        }

        setApiState({
            deepseek: { key: dsKey, status: dsStatus },
            google: { key: gKey, status: gStatus }
        });
        setModelState({
            deepseek: dsModel,
            google: gModel
        });
    };
    loadKeys();
  }, []);

  const handleUpdateKey = async (provider: 'deepseek' | 'google', key: string) => {
      const secure = (window as any).electronAPI?.secure;
      setApiState(prev => ({ ...prev, [provider]: { ...prev[provider], key } }));
      
      const keyName = `user_api_key_${provider}`;
      if (secure) {
          await secure.set(keyName, key);
      } else {
          localStorage.setItem(keyName, key);
      }
  };

  const handleToggleStatus = async (provider: 'deepseek' | 'google') => {
      const newStatus = apiState[provider].status === 'active' ? 'paused' : 'active';
      setApiState(prev => ({ ...prev, [provider]: { ...prev[provider], status: newStatus } }));
      localStorage.setItem(`user_api_status_${provider}`, newStatus);
      const secure = (window as any).electronAPI?.secure;
      if (secure?.set) {
          await secure.set(`user_api_status_${provider}`, newStatus);
      } else if ((window as any).electronAPI?.db?.saveSetting) {
          await (window as any).electronAPI.db.saveSetting(`user_api_status_${provider}`, newStatus);
      }
  };
  
  const handleUpdateModel = async (provider: 'deepseek' | 'google', modelId: string) => {
      setModelState(prev => ({ ...prev, [provider]: modelId }));
      localStorage.setItem(`user_model_${provider}`, modelId);
      if ((window as any).electronAPI?.db?.saveSetting) {
          await (window as any).electronAPI.db.saveSetting(`user_model_${provider}`, modelId);
      }
  };
  
  const [isTestingDeepseek, setIsTestingDeepseek] = useState(false);
  const [isTestingGoogle, setIsTestingGoogle] = useState(false);
  const handleTestEngine = async (provider: 'deepseek' | 'google') => {
      const key = apiState[provider].key;
      const modelId = modelState[provider];
      if (!key) { alert('请先填写 API Key'); return; }
      if (!modelId) { alert('请先填写模型型号'); return; }
      provider === 'deepseek' ? setIsTestingDeepseek(true) : setIsTestingGoogle(true);
      try {
          const keyName = `user_api_key_${provider}`;
          if ((window as any).electronAPI?.secure) {
              await (window as any).electronAPI.secure.set(keyName, key);
          } else {
              localStorage.setItem(keyName, key);
          }
          const instance = provider === 'deepseek' ? new DeepSeekProvider() : new GeminiProvider();
          await instance.generateContent({ prompt: 'Hello', temperature: 0.1, model: modelId });
          alert('✅ 连接测试成功！');
      } catch (e: any) {
          alert(`❌ 连接测试失败: ${e.message}`);
      } finally {
          provider === 'deepseek' ? setIsTestingDeepseek(false) : setIsTestingGoogle(false);
      }
  };

  const handleClearKey = async (provider: 'deepseek' | 'google') => {
      if(!confirm(`确定要清除 ${provider === 'deepseek' ? 'DeepSeek' : 'Google Gemini'} 的配置吗？`)) return;
      
      const secure = (window as any).electronAPI?.secure;
      const keyName = `user_api_key_${provider}`;
      
      if (secure) await secure.set(keyName, '');
      localStorage.removeItem(keyName);
      localStorage.setItem(`user_api_status_${provider}`, 'active'); // Reset status
      
      setApiState(prev => ({ ...prev, [provider]: { key: '', status: 'active' } }));
  };

  const [visualConfigs, setVisualConfigs] = useState<Record<VisualProvider, VisualEngineConfig>>({
    Jimeng: { provider: 'Jimeng', apiKey: '', accessKeyId: '', secretAccessKey: '', isEnabled: false },
    Doubao: { provider: 'Doubao', apiKey: '', accessKeyId: '', secretAccessKey: '', isEnabled: false },
    Nanobanana: { provider: 'Nanobanana', apiKey: '', isEnabled: false },
    Gemini: { provider: 'Gemini', apiKey: '', isEnabled: true } // Default fallback
  });

  useEffect(() => {
    const loadVisualConfigs = async () => {
        const secure = (window as any).electronAPI?.secure;
        const newConfigs = { ...visualConfigs };
        
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
            
            newConfigs[p] = {
                provider: p,
                apiKey,
                accessKeyId: ak,
                secretAccessKey: sk,
                isEnabled: status ? status === 'active' : (p === 'Gemini') // Gemini enabled by default
            };
        }
        setVisualConfigs(newConfigs);
    };
    loadVisualConfigs();
  }, []);

  const handleUpdateVisualConfig = async (provider: VisualProvider, field: 'apiKey' | 'accessKeyId' | 'secretAccessKey', value: string) => {
      setVisualConfigs(prev => ({ 
          ...prev, 
          [provider]: { ...prev[provider], [field]: value } 
      }));
      
      const secure = (window as any).electronAPI?.secure;
      // Map field to storage key suffix
      const suffix = field === 'apiKey' ? 'key' : (field === 'accessKeyId' ? 'ak' : 'sk');
      const keyName = `visual_api_${suffix}_${provider}`;
      
      if (secure) {
          await secure.set(keyName, value);
      } else {
          localStorage.setItem(keyName, value);
      }
  };

  const handleToggleVisualStatus = (provider: VisualProvider) => {
      setVisualConfigs(prev => {
          const newStatus = !prev[provider].isEnabled;
          localStorage.setItem(`visual_api_status_${provider}`, newStatus ? 'active' : 'paused');
          return { ...prev, [provider]: { ...prev[provider], isEnabled: newStatus } };
      });
  };

  const handleClearVisualKey = async (provider: VisualProvider) => {
      if(!confirm(`确定要清除 ${provider} 的配置吗？`)) return;
      const secure = (window as any).electronAPI?.secure;
      
      const keys = [`visual_api_key_${provider}`, `visual_api_ak_${provider}`, `visual_api_sk_${provider}`];
      
      for (const k of keys) {
          if (secure) await secure.set(k, '');
          localStorage.removeItem(k);
      }
      localStorage.setItem(`visual_api_status_${provider}`, 'paused');
      
      setVisualConfigs(prev => ({ 
          ...prev, 
          [provider]: { 
              ...prev[provider], 
              apiKey: '', 
              accessKeyId: '', 
              secretAccessKey: '', 
              isEnabled: false 
          } 
      }));
  };

  const [ragConfig, setRagConfig] = useState({
    provider: 'openai', // 'openai' | 'baidu' | 'hybrid'
    apiKey: '',
    secretKey: '', // For Baidu
    baseUrl: '',
    model: 'embo-01',
    hfToken: '',
    jinaKey: ''
  });

  const [openclawStatus, setOpenclawStatus] = useState<any>(null);
  const [openclawManagedStatus, setOpenclawManagedStatus] = useState<any>(null);
  const [openclawBusy, setOpenclawBusy] = useState(false);
  const [openclawBridgeToken, setOpenclawBridgeToken] = useState('');
  const [notifyWecomWebhook, setNotifyWecomWebhook] = useState('');
  const [notifyFeishuWebhook, setNotifyFeishuWebhook] = useState('');
  const [openclawFeishuAppId, setOpenclawFeishuAppId] = useState('');
  const [openclawFeishuAppSecret, setOpenclawFeishuAppSecret] = useState('');
  const [openclawFeishuDomain, setOpenclawFeishuDomain] = useState<'lark' | 'feishu'>('feishu');
  const [openclawInstallState, setOpenclawInstallState] = useState<any>(null);
  const [openclawInstallProgress, setOpenclawInstallProgress] = useState<number>(0);
  const [openclawInstallWorking, setOpenclawInstallWorking] = useState(false);
  const [openclawWizard, setOpenclawWizard] = useState<null | 'install' | 'uninstall'>(null);
  const [openclawDesiredVersion, setOpenclawDesiredVersion] = useState<string>('latest');
  const [openclawUseLatest, setOpenclawUseLatest] = useState(true);
  const [openclawAgreeTerms, setOpenclawAgreeTerms] = useState(false);
  const [openclawAgreeRisk, setOpenclawAgreeRisk] = useState(false);
  const [openclawAuthSummary, setOpenclawAuthSummary] = useState<{ deepseek: boolean; google: boolean; custom: number }>({ deepseek: false, google: false, custom: 0 });
  const [claudeCodeStatus, setClaudeCodeStatus] = useState<any>(null);
  const [claudeCodeManagedStatus, setClaudeCodeManagedStatus] = useState<any>(null);
  const [claudeCodeBusy, setClaudeCodeBusy] = useState(false);
  const [claudeCodeInstallState, setClaudeCodeInstallState] = useState<any>(null);
  const [claudeCodeInstallProgress, setClaudeCodeInstallProgress] = useState<number>(0);
  const [claudeCodeInstallWorking, setClaudeCodeInstallWorking] = useState(false);
  const [claudeCodeProxy, setClaudeCodeProxy] = useState('');
  const [claudeCodeNoProxy, setClaudeCodeNoProxy] = useState('');
  const [marketSection, setMarketSection] = useState<'Integrations' | 'Plugins' | 'Tools' | 'Locations'>('Integrations');
  const [marketBusy, setMarketBusy] = useState(false);
  const [marketLocations, setMarketLocations] = useState<any>(null);
  const [marketPlugins, setMarketPlugins] = useState<any[]>([]);
  const [marketSkills, setMarketSkills] = useState<{ drafts: any[]; tools: any[] }>({ drafts: [], tools: [] });
  const [agentPolicy, setAgentPolicy] = useState<any>(null);
  const [agentApprovals, setAgentApprovals] = useState<any[]>([]);
  const [agentBusy, setAgentBusy] = useState(false);
  const [digitalTwinResult, setDigitalTwinResult] = useState<any>(null);
  const [isAnalyzingIdentity, setIsAnalyzingIdentity] = useState(false);

  const handleAnalyzeIdentity = async () => {
    setIsAnalyzingIdentity(true);
    try {
      const api = (window as any).electronAPI?.skillOrchestrator;
      if (!api) return;
      const res = await api.runAnalysis();
      if (res?.success) {
        setDigitalTwinResult(res);
      } else {
        alert('Analysis failed: ' + (res?.error || 'Unknown error'));
      }
    } catch (e: any) {
      alert('Analysis error: ' + e.message);
    } finally {
      setIsAnalyzingIdentity(false);
    }
  };

  const refreshAgentControls = async () => {
    const api = (window as any).electronAPI;
    if (!api?.agentPolicy?.get || !api?.agentApprovals?.list) return;
    setAgentBusy(true);
    try {
      const [pRes, aRes] = await Promise.all([api.agentPolicy.get(), api.agentApprovals.list({ status: 'pending' })]);
      if (pRes?.success) setAgentPolicy(pRes.policy);
      if (aRes?.success) setAgentApprovals(Array.isArray(aRes.approvals) ? aRes.approvals : []);
    } finally {
      setAgentBusy(false);
    }
  };

  const refreshOpenClaw = async () => {
    const api = (window as any).electronAPI?.openclaw;
    if (!api) return;
    try {
      if (api.managed?.getStatus) {
        const ms = await api.managed.getStatus();
        setOpenclawManagedStatus(ms);
        const desired = (ms && typeof ms.desiredVersion === 'string' && ms.desiredVersion) ? ms.desiredVersion : 'latest';
        setOpenclawDesiredVersion(desired);
        setOpenclawUseLatest(desired === 'latest');
        if (ms?.activeInstall?.running) {
          setOpenclawInstallWorking(true);
          setOpenclawInstallState({ step: ms.activeInstall.step || 'init', message: '安装进行中…' });
        } else if (openclawInstallWorking) {
          setOpenclawInstallWorking(false);
        }
      }
    } catch (e: any) {}
    try {
      const s = await api.getStatus();
      setOpenclawStatus(s);
    } catch (e: any) {
      setOpenclawStatus({ lastError: e?.message || '加载失败' });
    }
    try {
      const secure = (window as any).electronAPI?.secure;
      const dsKey = secure?.get ? await secure.get('user_api_key_deepseek') : (localStorage.getItem('user_api_key_deepseek') || '');
      const gKey = secure?.get ? await secure.get('user_api_key_google') : (localStorage.getItem('user_api_key_google') || '');
      const w1 = secure?.get ? await secure.get('notify_wecom_webhook') : (localStorage.getItem('notify_wecom_webhook') || '');
      const w2 = secure?.get ? await secure.get('notify_feishu_webhook') : (localStorage.getItem('notify_feishu_webhook') || '');
      const fAppId = secure?.get ? await secure.get('openclaw_feishu_app_id') : (localStorage.getItem('openclaw_feishu_app_id') || '');
      const fSecret = secure?.get ? await secure.get('openclaw_feishu_app_secret') : (localStorage.getItem('openclaw_feishu_app_secret') || '');
      const fDomain = secure?.get ? await secure.get('openclaw_feishu_domain') : (localStorage.getItem('openclaw_feishu_domain') || '');
      setNotifyWecomWebhook(String(w1 || ''));
      setNotifyFeishuWebhook(String(w2 || ''));
      setOpenclawFeishuAppId(String(fAppId || ''));
      setOpenclawFeishuAppSecret(String(fSecret || ''));
      setOpenclawFeishuDomain((String(fDomain || '').trim() === 'lark') ? 'lark' : 'feishu');
      let customCount = 0;
      try {
        const raw = secure?.get ? await secure.get('custom_llm_configs') : (localStorage.getItem('custom_llm_configs') || '');
        const list = JSON.parse(raw || '[]');
        if (Array.isArray(list)) {
          customCount = list.filter((x: any) => x && x.isEnabled !== false && x.baseUrl && x.modelId).length;
        }
      } catch (e) {}
      setOpenclawAuthSummary({ deepseek: !!String(dsKey || '').trim(), google: !!String(gKey || '').trim(), custom: customCount });
    } catch (e) {}
  };

  const refreshClaudeCode = async () => {
    const api = (window as any).electronAPI?.claudeCode;
    if (!api?.getStatus) return;
    setClaudeCodeBusy(true);
    try {
      const [s, ms] = await Promise.all([api.getStatus(), api.managed?.getStatus ? api.managed.getStatus() : null]);
      setClaudeCodeStatus(s);
      if (ms?.success) setClaudeCodeManagedStatus(ms);
      const secure = (window as any).electronAPI?.secure;
      if (secure?.get) {
        const [p1, p2] = await Promise.all([secure.get('claude_code_proxy'), secure.get('claude_code_no_proxy')]);
        setClaudeCodeProxy(String(p1 || ''));
        setClaudeCodeNoProxy(String(p2 || ''));
      }
    } catch (e: any) {
      setClaudeCodeStatus({ success: false, error: e?.message || '加载失败' });
    } finally {
      setClaudeCodeBusy(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'Integrations') refreshOpenClaw();
    if (activeTab === 'Integrations') refreshClaudeCode();
    if (activeTab === 'Integrations') refreshAgentControls();
  }, [activeTab]);

  const refreshMarketplace = async () => {
    const api = (window as any).electronAPI?.marketplace;
    if (!api) return;
    setMarketBusy(true);
    try {
      const [locRes, pluginsRes, skillsRes] = await Promise.all([api.getLocations(), api.listPlugins(), api.listSkills()]);
      if (locRes?.success) setMarketLocations(locRes.result);
      if (pluginsRes?.success) setMarketPlugins(Array.isArray(pluginsRes.result) ? pluginsRes.result : []);
      if (skillsRes?.success) setMarketSkills(skillsRes.result || { drafts: [], tools: [] });
    } finally {
      setMarketBusy(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'Integrations') refreshMarketplace();
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'Integrations') return;
    const api = (window as any).electronAPI?.openclaw;
    if (!api?.managed?.onProgress) return;
    const off = api.managed.onProgress((payload: any) => {
      setOpenclawInstallState(payload);
      if (payload?.progress !== undefined) {
        const v = Number(payload.progress);
        if (Number.isFinite(v)) setOpenclawInstallProgress(Math.max(0, Math.min(1, v)));
      }
      if (payload?.step === 'done') {
        setOpenclawInstallWorking(false);
        setOpenclawWizard(null);
        refreshOpenClaw();
        refreshMarketplace();
      }
      if (payload?.step === 'error') {
        setOpenclawInstallWorking(false);
      }
    });
    return () => {
      try {
        off?.();
      } catch (e) {}
    };
  }, [activeTab]);

  useEffect(() => {
    if (activeTab !== 'Integrations') return;
    const api = (window as any).electronAPI?.claudeCode;
    if (!api?.managed?.onProgress) return;
    const off = api.managed.onProgress((payload: any) => {
      setClaudeCodeInstallState(payload);
      if (payload?.progress !== undefined) {
        const v = Number(payload.progress);
        if (Number.isFinite(v)) setClaudeCodeInstallProgress(Math.max(0, Math.min(1, v)));
      }
      if (payload?.step === 'download_node' || payload?.step === 'extract_node' || payload?.step === 'install_claude_code') {
        setClaudeCodeInstallWorking(true);
      }
      if (payload?.step === 'done') {
        setClaudeCodeInstallWorking(false);
        refreshClaudeCode();
      }
      if (payload?.step === 'error') {
        setClaudeCodeInstallWorking(false);
      }
    });
    return () => {
      try {
        off?.();
      } catch (e) {}
    };
  }, [activeTab]);

  // Custom LLM Engine State
  const [customLLMs, setCustomLLMs] = useState<CustomLLMConfig[]>([]);
  const [editingLLM, setEditingLLM] = useState<Partial<CustomLLMConfig> | null>(null);
  const [isTestingLLM, setIsTestingLLM] = useState(false);
  const [isLoadingLLMModels, setIsLoadingLLMModels] = useState(false);
  const [llmModels, setLlmModels] = useState<string[]>([]);
  const [llmModelsError, setLlmModelsError] = useState<string>('');
  const [primaryCustomId, setPrimaryCustomId] = useState<string>(localStorage.getItem('user_primary_custom_llm_id') || '');
  const [primaryCustomStatus, setPrimaryCustomStatus] = useState<'active' | 'paused'>((localStorage.getItem('user_api_status_custom') as any) || 'paused');

  useEffect(() => {
      (async () => {
          try {
              const secure = (window as any).electronAPI?.secure;
              if (secure?.get) {
                  const pid = await secure.get('user_primary_custom_llm_id');
                  if (typeof pid === 'string') {
                      setPrimaryCustomId(pid);
                      if (pid) localStorage.setItem('user_primary_custom_llm_id', pid);
                  }
                  const st = await secure.get('user_api_status_custom');
                  if (st === 'active' || st === 'paused') {
                      setPrimaryCustomStatus(st);
                      localStorage.setItem('user_api_status_custom', st);
                  }
              }
          } catch (e) {}
          try {
              const secure = (window as any).electronAPI?.secure;
              if (secure?.get) {
                  const s = await secure.get('custom_llm_configs');
                  if (s) {
                      setCustomLLMs(JSON.parse(s));
                      return;
                  }
              }
          } catch (e) {}
          const stored = localStorage.getItem('custom_llm_configs');
          if (stored) {
              try {
                  const parsed = JSON.parse(stored);
                  setCustomLLMs(parsed);
                  try {
                      const secure = (window as any).electronAPI?.secure;
                      if (secure?.set) {
                          await secure.set('custom_llm_configs', JSON.stringify(parsed));
                      }
                  } catch (e) {}
              } catch (e) {}
          }
      })();
  }, []);

  useEffect(() => {
      setLlmModels([]);
      setLlmModelsError('');
      setIsLoadingLLMModels(false);
  }, [editingLLM?.id]);

  const saveCustomLLMs = async (newConfigs: CustomLLMConfig[]) => {
      setCustomLLMs(newConfigs);
      localStorage.setItem('custom_llm_configs', JSON.stringify(newConfigs));
      try {
          const secure = (window as any).electronAPI?.secure;
          if (secure?.set) {
              await secure.set('custom_llm_configs', JSON.stringify(newConfigs));
          } else if ((window as any).electronAPI?.db?.saveSetting) {
              await (window as any).electronAPI.db.saveSetting('custom_llm_configs', JSON.stringify(newConfigs));
          }
      } catch (e) {}
  };

  const handleSaveLLM = async () => {
      if (!editingLLM?.name || !editingLLM?.provider) {
          alert("请填写完整信息 (名称, 提供商)");
          return;
      }
      if (!editingLLM?.baseUrl) {
          alert("请填写 Base URL");
          return;
      }
      if (!editingLLM?.modelId) {
          alert("请填写 Model ID");
          return;
      }
      
      // Defaults
      const newConfig: CustomLLMConfig = {
          id: editingLLM.id || `llm-${Date.now()}`,
          name: editingLLM.name,
          provider: editingLLM.provider,
          apiKey: editingLLM.apiKey || '',
          baseUrl: editingLLM.baseUrl || '',
          modelId: editingLLM.modelId || '',
          isEnabled: editingLLM.isEnabled ?? true
      };

      // Secure storage for key (Optional optimization, strictly keeping keys in localStorage for now as per simple requirement, 
      // but ideally should use secure. For now, following existing pattern for custom things)
      // Actually, let's try to use secure if available, but for list structure it's easier to keep in localstorage
      // For simplicity in this "Novice" feature, we'll store in localStorage stringified for now, 
      // or we can just strip key when saving to localstorage and load from secure. 
      // To keep it simple and consistent with the "List" nature, we will store in localStorage.
      
      const newLLMs = editingLLM.id 
          ? customLLMs.map(l => l.id === editingLLM.id ? newConfig : l)
          : [...customLLMs, newConfig];
          
      await saveCustomLLMs(newLLMs);
      setEditingLLM(null);
  };

  const handleDeleteLLM = (id: string) => {
      if (confirm("确定删除该模型配置吗？")) {
          void saveCustomLLMs(customLLMs.filter(l => l.id !== id));
      }
  };
  
  const handleSelectPrimaryCustom = (id: string) => {
      setPrimaryCustomId(id);
      localStorage.setItem('user_primary_custom_llm_id', id);
      try {
          const secure = (window as any).electronAPI?.secure;
          if (secure?.set) {
              void secure.set('user_primary_custom_llm_id', id);
          } else if ((window as any).electronAPI?.db?.saveSetting) {
              void (window as any).electronAPI.db.saveSetting('user_primary_custom_llm_id', id);
          }
      } catch (e) {}
  };
  
  const handleTogglePrimaryCustomStatus = () => {
      const next = primaryCustomStatus === 'active' ? 'paused' : 'active';
      setPrimaryCustomStatus(next);
      localStorage.setItem('user_api_status_custom', next);
      try {
          const secure = (window as any).electronAPI?.secure;
          if (secure?.set) {
              void secure.set('user_api_status_custom', next);
          } else if ((window as any).electronAPI?.db?.saveSetting) {
              void (window as any).electronAPI.db.saveSetting('user_api_status_custom', next);
          }
      } catch (e) {}
  };

  const handleTestLLM = async (config: Partial<CustomLLMConfig>) => {
      if (!config.baseUrl) return alert("请先填写 Base URL");
      if (!config.modelId) return alert("请先填写 Model ID");
      setIsTestingLLM(true);
      try {
          const res = await (window as any).electronAPI.llm.openaiTest({
              baseUrl: config.baseUrl,
              apiKey: config.apiKey || '',
              modelId: config.modelId
          });
          if (!res?.success) throw new Error(res?.error || 'Unknown error');
          alert("✅ 连接测试成功！");
      } catch (e: any) {
          alert(`❌ 连接测试失败: ${e.message}`);
      } finally {
          setIsTestingLLM(false);
      }
  };

  const handleLoadModels = async () => {
      const baseUrl = String(editingLLM?.baseUrl || '').trim();
      if (!baseUrl) return alert("请先填写 Base URL");
      setIsLoadingLLMModels(true);
      setLlmModelsError('');
      try {
          const res = await (window as any).electronAPI.llm.openaiListModels({
              baseUrl,
              apiKey: String(editingLLM?.apiKey || '')
          });
          if (!res?.success) throw new Error(res?.error || 'Unknown error');
          const list = Array.isArray(res.models) ? res.models : [];
          setLlmModels(list);
          if ((!editingLLM?.modelId || String(editingLLM.modelId).trim() === '') && list.length === 1) {
              setEditingLLM(prev => prev ? ({ ...prev, modelId: list[0] }) : prev);
          }
      } catch (e: any) {
          setLlmModels([]);
          setLlmModelsError(e?.message || '加载失败');
      } finally {
          setIsLoadingLLMModels(false);
      }
  };

  const PRESET_LLM_PROVIDERS = [
      { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-chat' },
      { name: 'Moonshot (Kimi)', baseUrl: 'https://api.moonshot.cn/v1', defaultModel: 'moonshot-v1-8k' },
      { name: 'Qwen (通义千问)', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', defaultModel: 'qwen-plus' },
      { name: '阿里 Coding Plan', baseUrl: 'https://coding.dashscope.aliyuncs.com/v1', defaultModel: 'qwen3.5-plus' },
      { name: 'Yi (零一万物)', baseUrl: 'https://api.lingyiwanwu.com/v1', defaultModel: 'yi-34b-chat-0205' },
      { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4o' },
      { name: 'LM Studio (Local)', baseUrl: 'http://localhost:1234/v1', defaultModel: '' },
      { name: 'Ollama (Local)', baseUrl: 'http://localhost:11434/v1', defaultModel: '' },
      { name: 'Other', baseUrl: '', defaultModel: '' }
  ];

  useEffect(() => {
    if (window.electronAPI) {
        Promise.all([
            window.electronAPI.db.getSetting('rag_provider'),
            window.electronAPI.db.getSetting('rag_api_key'),
            window.electronAPI.db.getSetting('rag_secret_key'),
            window.electronAPI.db.getSetting('rag_base_url'),
            window.electronAPI.db.getSetting('rag_model'),
            window.electronAPI.db.getSetting('rag_hf_token'),
            window.electronAPI.db.getSetting('rag_jina_key')
        ]).then(([provider, key, secret, url, model, hf, jina]) => {
            setRagConfig({
                provider: provider || 'openai',
                apiKey: key || '',
                secretKey: secret || '',
                baseUrl: url || '',
                model: model || 'embo-01',
                hfToken: hf || '',
                jinaKey: jina || ''
            });
        });
    }
  }, []);

  const isDesktop = isDesktopApp();

  const handleSelectFolder = async () => {
    if (window.electronAPI) {
      const path = await window.electronAPI.fs.selectFolder();
      if (path) onUpdateWarehouse(path);
    }
  };

  const toggleDomain = (d: NgoDomain) => {
    const next = preferredDomains.includes(d) 
      ? preferredDomains.filter(i => i !== d)
      : [...preferredDomains, d];
    onUpdateDomains(next);
    if (onUpdateOrgProfile && orgProfile) {
        onUpdateOrgProfile({ ...orgProfile, focusAreas: next });
    }
  };

  const addMember = () => {
    const newMember: TeamMember = {
      id: `tm-${Date.now()}`,
      nickname: '新成员',
      department: '项目部',
      role: '项目官',
      responsibility: '项目执行',
      traits: [],
      status: 'Active',
      scheduleType: 'Fixed',
      unavailablePeriods: [],
      availableWeekdays: [1,2,3,4,5]
    };
    onUpdateTeam([...teamMembers, newMember]);
    setEditingMemberId(newMember.id);
  };

  const updateMember = (id: string, updates: Partial<TeamMember>) => {
    onUpdateTeam(teamMembers.map(m => m.id === id ? { ...m, ...updates } : m));
  };

  const removeMember = (id: string) => {
    if (confirm("确定移除该成员吗？")) {
        onUpdateTeam(teamMembers.filter(m => m.id !== id));
        if (editingMemberId === id) setEditingMemberId(null);
    }
  };

  const toggleTrait = (id: string, trait: string) => {
    const member = teamMembers.find(m => m.id === id);
    if (member) {
        const traits = member.traits || [];
        const nextTraits = traits.includes(trait) 
            ? traits.filter(t => t !== trait)
            : [...traits, trait];
        updateMember(id, { traits: nextTraits });
    }
  };

  const handleAddCustomTrait = (id: string) => {
    if (!newTrait.trim()) return;
    const member = teamMembers.find(m => m.id === id);
    if (member) {
        updateMember(id, { traits: Array.from(new Set([...(member.traits || []), newTrait.trim()])) });
        setNewTrait('');
    }
  };

  const handleAddPeriod = (id: string) => {
      if (!newPeriod.start || !newPeriod.end) return;
      const member = teamMembers.find(m => m.id === id);
      if (member) {
          const periods = [...(member.unavailablePeriods || []), { 
              id: `up-${Date.now()}`, 
              start: newPeriod.start, 
              end: newPeriod.end, 
              reason: newPeriod.reason 
          }];
          updateMember(id, { unavailablePeriods: periods });
          setNewPeriod({ start: '', end: '', reason: '' });
      }
  };

  const handleRemovePeriod = (memberId: string, periodId: string) => {
      const member = teamMembers.find(m => m.id === memberId);
      if (member) {
          const periods = (member.unavailablePeriods || []).filter(p => p.id !== periodId);
          updateMember(memberId, { unavailablePeriods: periods });
      }
  };

  const handleBackupData = () => {
    try {
        const backupData = {
            app_events: JSON.parse(localStorage.getItem('app_events') || '[]'),
            app_projects: JSON.parse(localStorage.getItem('app_projects') || '[]'),
            app_team: JSON.parse(localStorage.getItem('app_team') || '[]'),
            app_leads: JSON.parse(localStorage.getItem('app_leads') || '[]'),
            app_plan_states: JSON.parse(localStorage.getItem('app_plan_states') || '{}'),
            app_schedules: JSON.parse(localStorage.getItem('app_schedules') || '[]'),
            app_domains: JSON.parse(localStorage.getItem('app_domains') || '[]'),
            app_warehouse: localStorage.getItem('app_warehouse'),
            exportTime: new Date().toISOString(),
            version: "2.3.1"
        };
        
        const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `NGO_Planner_FullBackup_${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        alert("全量备份导出成功！请妥善保存该 JSON 文件。");
    } catch (e) {
        alert("备份失败，请检查浏览器权限。");
    }
  };

  const handleRestoreBackup = async () => {
      if (!confirm("恢复备份将【覆盖】当前所有本地数据（日历、项目、团队等）。建议执行前先点击导出备份。是否继续？")) return;
      
      if (window.electronAPI) {
          try {
              const file = await window.electronAPI.fs.selectFile({
                  filters: [{ name: 'Backup JSON', extensions: ['json'] }]
              });
              if (!file) return;

              // Read content from path for desktop
              const readRes = await window.electronAPI.fs.readFile(file.path);
              if (readRes.success && readRes.data) {
                  const backup = JSON.parse(readRes.data);
                  Object.entries(backup).forEach(([key, value]) => {
                      if (key.startsWith('app_')) {
                          localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
                      }
                  });
                  alert("✅ 数据已从备份文件恢复！应用将立即重启以加载新数据。");
                  window.location.reload();
              }
          } catch (e: any) {
              alert("恢复失败: " + e.message);
          }
      } else {
          // Web fallback via input
          const input = document.createElement('input');
          input.type = 'file';
          input.accept = '.json';
          input.onchange = (e: any) => {
              const file = e.target.files[0];
              const reader = new FileReader();
              reader.onload = (ev) => {
                  try {
                      const backup = JSON.parse(ev.target?.result as string);
                      Object.entries(backup).forEach(([key, value]) => {
                          if (key.startsWith('app_')) {
                              localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
                          }
                      });
                      alert("✅ 数据恢复成功！");
                      window.location.reload();
                  } catch (err) { alert("文件解析错误"); }
              };
              reader.readAsText(file);
          };
          input.click();
      }
  };

  const handleLogout = async () => {
    if (!confirm("确定要退出登录吗？")) return;
    
    // 1. Mark session as ended
    localStorage.setItem('app_is_authenticated', 'false');

    // 2. Check if we should clear keys
    const remember = localStorage.getItem('remember_api_config') === 'true';
    if (!remember) {
        // Clear Keys
        if ((window as any).electronAPI?.secure) {
            await (window as any).electronAPI.secure.set('user_api_key_deepseek', '');
            await (window as any).electronAPI.secure.set('user_api_key_google', '');
        }
        localStorage.removeItem('user_api_key_deepseek');
        localStorage.removeItem('user_api_key_google');
        localStorage.removeItem('user_provider');
    }
    
    // 3. Always clear tokens
    localStorage.removeItem('ngo_auth_token');
    localStorage.removeItem('ngo_username');

    window.location.reload();
  };

  const handleResetAndLogout = async () => {
    if (!confirm("⚠️ 警告：此操作将清除 API 登录凭证并重置应用配置（如仓库路径）。\n\n您的本地项目数据文件（JSON/Markdown）将保留在硬盘上，但应用将忘记它们的路径。\n\n确认重置并退出？")) return;
    
    // 1. Clear Secure Key
    if ((window as any).electronAPI?.secure) {
        await (window as any).electronAPI.secure.set('user_api_key', '');
        await (window as any).electronAPI.secure.set('user_api_key_deepseek', '');
        await (window as any).electronAPI.secure.set('user_api_key_google', '');
    }

    // 2. Clear App Configs (Force Re-onboarding)
    if ((window as any).electronAPI?.db) {
        await (window as any).electronAPI.db.saveSetting('warehouse_path', '');
        await (window as any).electronAPI.db.saveSetting('org_configured', 'false');
        await (window as any).electronAPI.db.saveSetting('team_configured', 'false');
        await (window as any).electronAPI.db.saveSetting('rag_provider', 'openai');
    }

    // 3. Clear LocalStorage
    localStorage.removeItem('user_api_key');
    localStorage.removeItem('user_provider'); 
    localStorage.removeItem('user_base_url');
    localStorage.removeItem('ngo_auth_token');
    localStorage.removeItem('ngo_username');
    
    // Clear Setup Flags
    localStorage.removeItem('app_warehouse');
    localStorage.removeItem('app_org_profile');
    
    // Clear API Configs from LocalStorage
    localStorage.removeItem('user_api_key_deepseek');
    localStorage.removeItem('user_api_key_google');
    
    window.location.reload();
  };

    const handleClearKnowledgeBase = async () => {
        if (confirm("⚠️ 高危操作：确定要清空知识库索引吗？\n\n这将删除所有已向量化的数据。如果您的文档还在文件夹中，您需要重新挂载/扫描才能再次搜索。\n\n适用于：模型升级后需要重建索引。")) {
            try {
                // @ts-ignore
                const res = await window.electronAPI.knowledge.resetIndex();
                if (res.success) {
                    alert("知识库索引已清空。请前往知识库重新挂载文件夹以重建索引。");
                } else {
                    alert("操作失败: " + res.error);
                }
            } catch (e: any) {
                alert("操作异常: " + e.message);
            }
        }
    };

    const saveRagSetting = (key: string, value: string) => {
    if ((window as any).electronAPI) {
      (window as any).electronAPI.db.saveSetting(key, value);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      {/* Unified Container: 1100px x 640px */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-[1100px] h-[640px] flex overflow-hidden animate-fade-in-up border border-white/50 dark:border-slate-800">
        
        {/* Left Side: Navigation Sidebar */}
        <div className="w-[280px] bg-gradient-to-br from-slate-900 to-slate-800 text-white flex flex-col shrink-0 relative overflow-hidden border-r border-slate-800">
            {/* Decorative Elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-teal-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2 pointer-events-none"></div>
            
            <div className="p-8 pb-4 relative z-10">
                 <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center text-white border border-white/10 backdrop-blur-sm shadow-inner">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                    </div>
                    <h2 className="text-xl font-black tracking-tight text-white">系统设置</h2>
                 </div>
            </div>

            <div className="flex-1 px-4 space-y-2 overflow-y-auto custom-scrollbar-dark relative z-10">
                {[
                  { 
                    id: 'General', 
                    label: '通用设置', 
                    icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /></svg>,
                    desc: '路径 / 主题 / 偏好' 
                  },
                  { 
                    id: 'Team', 
                    label: '团队管理', 
                    icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" /></svg>,
                    desc: '成员 / 角色 / 权限' 
                  },
                  { 
                    id: 'AI', 
                    label: 'AI 智能引擎', 
                    icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>,
                    desc: '模型 / RAG / 知识库' 
                  },
                  { 
                    id: 'Account', 
                    label: '账户与数据', 
                    icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>,
                    desc: '备份 / 恢复 / 安全' 
                  },
                  { 
                    id: 'Integrations', 
                    label: 'Agent 工具中枢', 
                    icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9.75 3v2.25m4.5-2.25v2.25M4.5 9h15m-15 0A2.25 2.25 0 002.25 11.25v6A2.25 2.25 0 004.5 19.5h15a2.25 2.25 0 002.25-2.25v-6A2.25 2.25 0 0019.5 9m-15 0h15" /></svg>,
                    desc: '安装 / 配置 / 管理' 
                  },
                  { 
                    id: 'DigitalTwin', 
                    label: '数字分身', 
                    icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 17h5l-1.405-1.405M19.595 15.595A8.962 8.962 0 0021 11c0-4.97-4.03-9-9-9S3 6.03 3 11s4.03 9 9 9a8.962 8.962 0 004.595-1.405M15 17l-3-3m0 0l-3 3m3-3V8" /></svg>,
                    desc: '画像 / 协作 / 控制' 
                  },
                  { 
                    id: 'About', 
                    label: '关于软件', 
                    icon: <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
                    desc: '版本 / 文档 / 社区' 
                  }
                ].map(t => (
                  <button 
                    key={t.id} 
                    onClick={() => setActiveTab(t.id as any)} 
                    className={`w-full text-left px-4 py-3 rounded-xl transition-all flex items-center gap-3 group relative overflow-hidden ${activeTab === t.id ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/50 ring-1 ring-white/20' : 'text-slate-400 hover:bg-white/5 hover:text-white'}`}
                  >
                    <span className={`transition-transform group-hover:scale-110 ${activeTab === t.id ? 'scale-110' : ''}`}>{t.icon}</span>
                    <div>
                        <div className="text-xs font-bold">{t.label}</div>
                        <div className={`text-[9px] font-medium mt-0.5 ${activeTab === t.id ? 'text-indigo-200' : 'text-slate-600'}`}>{t.desc}</div>
                    </div>
                    {activeTab === t.id && <div className="absolute right-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-white rounded-l-full"></div>}
                  </button>
                ))}
            </div>

            <div className="p-4 border-t border-white/5 relative z-10 space-y-2">
                <button onClick={() => { try { onNavigateTo('AITools'); } catch (e) {} onClose(); }} className="w-full py-2.5 bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-200 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 border border-indigo-500/20">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>
                    <span>打开工具中心</span>
                </button>
                <button onClick={onClose} className="w-full py-2.5 bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 border border-white/5">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
                    <span>返回工作台</span>
                </button>
                <button onClick={handleLogout} className="w-full py-2.5 bg-red-500/10 hover:bg-red-500 text-red-400 hover:text-white rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 border border-red-500/20">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                    <span>退出登录</span>
                </button>
            </div>
        </div>

        {/* Right Side: Content Area */}
        <div className="flex-1 bg-white dark:bg-slate-900 relative flex flex-col overflow-hidden">
            {activeTab === 'General' && (
              <div className="flex-1 p-6 overflow-hidden flex flex-col">
                <div className="flex flex-col lg:grid lg:grid-cols-2 gap-6 flex-1 min-h-0">
                    <div className="flex flex-col gap-6 h-full overflow-y-auto custom-scrollbar pr-1">
                        {orgProfile && (
                            <section className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5 shrink-0">
                                <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                    <span>🏢</span> 机构基本信息
                                </label>
                                <div className="space-y-3">
                                    <div>
                                        <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase block mb-1">机构名称</label>
                                        <input 
                                            value={orgProfile.name} 
                                            onChange={e => onUpdateOrgProfile?.({ ...orgProfile, name: e.target.value })}
                                            className="w-full bg-white dark:bg-slate-900 border-none rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all dark:text-white"
                                            placeholder="输入机构名称..."
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase block mb-1">机构简介</label>
                                        <textarea 
                                            value={orgProfile.description} 
                                            onChange={e => onUpdateOrgProfile?.({ ...orgProfile, description: e.target.value })}
                                            className="w-full bg-white dark:bg-slate-900 border-none rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all dark:text-white resize-none h-24"
                                            placeholder="简要描述机构使命与愿景..."
                                        />
                                    </div>
                                </div>
                            </section>
                        )}

                        <section className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5 shrink-0">
                            <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <span>📂</span> 本地存储仓库
                            </label>
                            <div className="flex gap-2">
                                <input 
                                  readOnly
                                  value={warehousePath} 
                                  className="flex-1 p-3 bg-white dark:bg-slate-900 border-none rounded-xl text-xs font-mono text-slate-600 dark:text-slate-300 outline-none truncate"
                                />
                                {isDesktop && (
                                    <button 
                                        onClick={handleSelectFolder}
                                        className="px-5 py-2.5 bg-indigo-600 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-200 dark:shadow-none hover:bg-indigo-700 transition-all whitespace-nowrap active:scale-95"
                                    >
                                        更改...
                                    </button>
                                )}
                            </div>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 leading-relaxed">
                                * 所有项目文件将存储在此目录下，建议选择空间充足的磁盘分区。
                            </p>
                        </section>

                        <section className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5 shrink-0">
                            <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                                <span>🎨</span> 界面视觉风格
                            </label>
                            <div className="flex gap-3">
                                {['Day', 'Night'].map(t => (
                                  <button 
                                    key={t} 
                                    onClick={() => onThemeChange(t as any)}
                                    className={`flex-1 py-3.5 rounded-xl border-2 font-bold text-xs transition-all flex items-center justify-center gap-2 ${currentTheme === t ? 'border-indigo-600 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'border-transparent bg-white dark:bg-slate-700 text-slate-400 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-600'}`}
                                  >
                                    <span>{t === 'Day' ? '☀️' : '🌙'}</span>
                                    <span>{t === 'Day' ? '清爽日间' : '极客夜间'}</span>
                                  </button>
                                ))}
                            </div>
                        </section>
                    </div>

                    <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-800/50 rounded-2xl overflow-hidden">
                        <div className="p-5 pb-2">
                            <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                <span>🏷️</span> 默认关注领域 (多选)
                            </label>
                        </div>
                        <div className="flex-1 p-5 pt-2 overflow-y-auto custom-scrollbar">
                            <div className="flex flex-wrap gap-2.5">
                                {DOMAINS.map(d => (
                                  <button 
                                    key={d} 
                                    onClick={() => toggleDomain(d)}
                                    className={`px-3.5 py-2 rounded-lg border text-[10px] font-bold transition-all active:scale-95 ${preferredDomains.includes(d) ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-white dark:bg-slate-700 text-slate-500 dark:text-slate-300 border-transparent hover:border-indigo-300 hover:text-indigo-600'}`}
                                  >
                                    {d}
                                  </button>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
              </div>
            )}

            {activeTab === 'Team' && (
              <div className="flex-1 p-6 overflow-hidden flex flex-col">
                <div className="flex gap-6 h-full min-h-0">
                    {/* Compact Member List */}
                    <div className="w-60 bg-slate-50 dark:bg-slate-800/50 rounded-2xl flex flex-col shrink-0 overflow-hidden">
                        <div className="flex justify-between items-center mb-2 p-5 pb-0">
                            <h3 className="font-black text-slate-400 dark:text-slate-500 text-[10px] uppercase tracking-widest">成员 ({teamMembers.length})</h3>
                            <button onClick={addMember} className="w-7 h-7 bg-indigo-600 text-white rounded-lg flex items-center justify-center hover:bg-indigo-700 shadow-lg shadow-indigo-200 dark:shadow-none transition-all text-sm font-bold active:scale-95 pb-0.5">+</button>
                        </div>
                        <div className="flex-1 overflow-y-auto space-y-1.5 p-3 custom-scrollbar">
                            {teamMembers.map(m => (
                                <div 
                                    key={m.id} 
                                    onClick={() => setEditingMemberId(m.id)}
                                    className={`p-3 rounded-xl cursor-pointer transition-all group border border-transparent ${editingMemberId === m.id ? 'bg-white dark:bg-slate-700 shadow-sm' : 'hover:bg-white dark:hover:bg-slate-700 hover:shadow-sm'}`}
                                >
                                    <div className="flex justify-between items-center mb-0.5">
                                        <span className={`font-bold text-xs truncate ${editingMemberId === m.id ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-700 dark:text-slate-300'}`}>{m.nickname}</span>
                                        <span className={`w-1.5 h-1.5 rounded-full ${m.status === 'Active' ? 'bg-green-400' : 'bg-slate-300 dark:bg-slate-600'}`}></span>
                                    </div>
                                    <div className="text-[9px] text-slate-400 dark:text-slate-500 truncate">{m.role}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Compact Edit Form */}
                    <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-6 overflow-hidden flex flex-col">
                        {editingMemberId ? (
                            <div className="flex-1 flex flex-col min-h-0">
                                {(() => {
                                    const m = teamMembers.find(item => item.id === editingMemberId);
                                    if (!m) return null;
                                    return (
                                        <>
                                            <div className="flex justify-between items-center border-b border-slate-200/50 dark:border-slate-700/50 pb-4 mb-4 shrink-0">
                                                <div className="flex items-center gap-3">
                                                    <div className="w-10 h-10 bg-white dark:bg-indigo-900/30 rounded-xl flex items-center justify-center text-xl shadow-sm text-indigo-500">
                                                        {m.isAI ? '🤖' : '👤'}
                                                    </div>
                                                    <div>
                                                        <h4 className="text-sm font-black text-slate-800 dark:text-white">{m.nickname}</h4>
                                                        <p className="text-[9px] text-indigo-500 dark:text-indigo-400 font-bold uppercase">{m.isAI ? 'AI 专家' : '人类成员'}</p>
                                                    </div>
                                                </div>
                                                <button onClick={() => removeMember(m.id)} className="text-[10px] font-bold text-red-400 hover:text-red-600 bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/40 px-3 py-1.5 rounded-lg transition-all">移除成员</button>
                                            </div>
                                            
                                            <div className="grid grid-cols-4 gap-3 mb-6 shrink-0">
                                                <div><label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1.5 block">昵称</label><input value={m.nickname} onChange={e => updateMember(m.id, { nickname: e.target.value })} className="w-full bg-white dark:bg-slate-800 border-none rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all dark:text-white" /></div>
                                                <div><label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1.5 block">角色</label><select value={m.role} onChange={e => updateMember(m.id, { role: e.target.value as TeamRole })} className="w-full bg-white dark:bg-slate-800 border-none rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all dark:text-white"><option>理事长</option><option>秘书长</option><option>总干事</option><option>项目官</option><option>传播官</option><option>财务</option><option>志愿者</option><option>实习生</option></select></div>
                                                <div><label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1.5 block">状态</label><select value={m.status} onChange={e => updateMember(m.id, { status: e.target.value as any })} className="w-full bg-white dark:bg-slate-800 border-none rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all dark:text-white"><option value="Active">在岗</option><option value="Inactive">离岗</option></select></div>
                                                <div><label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-1.5 block">职责</label><select value={m.responsibility} onChange={e => updateMember(m.id, { responsibility: e.target.value as MainResponsibility })} className="w-full bg-white dark:bg-slate-800 border-none rounded-xl px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all dark:text-white"><option>统筹管理</option><option>项目执行</option><option>传播推广</option><option>后勤支持</option><option>外联募资</option><option>其他</option></select></div>
                                            </div>

                                            <div className="grid grid-cols-2 gap-4 flex-1 min-h-0">
                                                {/* Schedule - Compact */}
                                                <div className="bg-white dark:bg-slate-800/50 rounded-xl p-4 flex flex-col overflow-hidden">
                                                    <div className="flex justify-between items-center mb-3 shrink-0"><label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase">协作忙闲</label><div className="flex bg-slate-100 dark:bg-slate-700 rounded p-0.5">{(['Fixed', 'Flexible'] as ScheduleType[]).map(st => (<button key={st} onClick={() => updateMember(m.id, { scheduleType: st })} className={`px-2 py-0.5 text-[8px] font-bold rounded transition-all ${m.scheduleType === st ? 'bg-white dark:bg-slate-600 text-indigo-600 shadow-sm' : 'text-slate-400 dark:text-slate-400'}`}>{st === 'Fixed' ? '固定' : '灵活'}</button>))}</div></div>
                                                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                                                        {m.scheduleType === 'Flexible' ? (
                                                            <div className="grid grid-cols-4 gap-1.5">{WEEKDAYS.map((day, idx) => { const isSelected = (m.availableWeekdays || []).includes(idx); return (<button key={idx} onClick={() => { const current = m.availableWeekdays || []; const next = isSelected ? current.filter(i => i !== idx) : [...current, idx]; updateMember(m.id, { availableWeekdays: next }); }} className={`py-2 rounded-lg border text-[9px] font-bold transition-all ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-slate-50 dark:bg-slate-700 border-transparent text-slate-400 dark:text-slate-500 hover:bg-slate-100'}`}>{day.replace('周','')}</button>); })}</div>
                                                        ) : (
                                                            <div className="space-y-2">
                                                                <div className="space-y-1.5">{(m.unavailablePeriods || []).map(p => (<div key={p.id} className="flex items-center justify-between bg-slate-50 dark:bg-slate-700 border border-transparent px-2.5 py-1.5 rounded-lg"><span className="text-[9px] font-bold text-slate-600 dark:text-slate-300">{p.start}~{p.end}</span><button onClick={() => handleRemovePeriod(m.id, p.id)} className="text-slate-300 hover:text-red-500 text-xs font-bold">&times;</button></div>))}</div>
                                                                <div className="flex gap-1.5"><input type="date" value={newPeriod.start} onChange={e => setNewPeriod({...newPeriod, start: e.target.value})} className="w-1/2 text-[9px] bg-slate-50 border-none dark:bg-slate-700 dark:text-slate-300 rounded-lg p-1.5 outline-none" /><input type="date" value={newPeriod.end} onChange={e => setNewPeriod({...newPeriod, end: e.target.value})} className="w-1/2 text-[9px] bg-slate-50 border-none dark:bg-slate-700 dark:text-slate-300 rounded-lg p-1.5 outline-none" /></div>
                                                                <button onClick={() => handleAddPeriod(m.id)} className="w-full bg-indigo-50 dark:bg-slate-700 text-indigo-500 dark:text-indigo-400 hover:bg-indigo-100 dark:hover:bg-slate-600 py-1.5 rounded-lg text-[9px] font-bold border border-dashed border-indigo-200 dark:border-indigo-800">+ 忙时</button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Traits - Compact */}
                                                <div className="bg-white dark:bg-slate-800/50 rounded-xl p-4 flex flex-col overflow-hidden">
                                                    <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase mb-3 shrink-0">能力标签</label>
                                                    <div className="flex-1 overflow-y-auto custom-scrollbar pr-1">
                                                        <div className="grid grid-cols-4 gap-1.5">
                                                            {PRESET_TRAIT_OBJECTS.map(t => {
                                                                const isSelected = (m.traits || []).includes(t.label);
                                                                return (
                                                                    <button key={t.label} onClick={() => toggleTrait(m.id, t.label)} className={`p-1.5 rounded-lg border transition-all flex flex-col items-center gap-0.5 active:scale-95 ${isSelected ? 'bg-indigo-600 border-indigo-600 text-white shadow-md shadow-indigo-200' : 'bg-slate-50 dark:bg-slate-700 border-transparent text-slate-500 dark:text-slate-400 hover:bg-slate-100'}`}><span className="text-sm">{t.icon}</span><span className="text-[8px] font-bold scale-90">{t.label}</span></button>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-slate-200 dark:text-slate-700 italic"><div className="text-3xl mb-2">🛋️</div><p className="text-[10px] font-bold uppercase tracking-widest text-slate-300 dark:text-slate-600">请选择成员</p></div>
                        )}
                    </div>
                </div>
              </div>
            )}

            {activeTab === 'AI' && (
              <div className="flex-1 p-6 overflow-hidden flex flex-col">
                <div className="flex flex-col lg:grid lg:grid-cols-12 gap-6 h-full min-h-0">
                    {/* Left Column: Status & RAG (Combined) */}
                    <div className="lg:col-span-5 flex flex-col gap-6 overflow-y-auto custom-scrollbar pr-1">
                        {/* Status Card */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5 relative overflow-hidden shrink-0">
                             <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-50/50 dark:bg-indigo-900/20 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2"></div>
                             <h3 className="text-sm font-black uppercase tracking-widest text-slate-800 dark:text-white mb-4 flex items-center gap-2"><span>🚀</span> AI 引擎状态</h3>
                             
                             <div className="space-y-5 relative z-10">
                                {/* DeepSeek Status */}
                                <div className="border-b border-slate-200/50 dark:border-slate-700/50 pb-4">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">DeepSeek (主引擎)</span>
                                        <span className={`text-[10px] font-black px-2 py-0.5 rounded ${apiState.deepseek.status === 'active' && apiState.deepseek.key ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'}`}>
                                            {apiState.deepseek.status === 'active' && apiState.deepseek.key ? '🟢 就绪' : '⚪️ 未配置'}
                                        </span>
                                    </div>
                                    <div className="text-[10px] text-slate-400">优先使用。若配置有效且启用，系统将默认调用此模型。</div>
                                </div>

                                {/* Gemini Status */}
                                <div>
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Google Gemini (备用)</span>
                                        <span className={`text-[10px] font-black px-2 py-0.5 rounded ${apiState.google.status === 'active' && apiState.google.key ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'}`}>
                                            {apiState.google.status === 'active' && apiState.google.key ? '🟢 就绪' : '⚪️ 未配置'}
                                        </span>
                                    </div>
                                    <div className="text-[10px] text-slate-400">当主引擎不可用或响应超时时，自动切换至此模型。</div>
                                </div>
                                
                                {/* Custom Primary Status */}
                                <div className="pt-4 border-t border-slate-200/50 dark:border-slate-700/50">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-300">其他模型（主力备选）</span>
                                        {(() => {
                                            const selectedId = localStorage.getItem('user_primary_custom_llm_id') || '';
                                            const status = (localStorage.getItem('user_api_status_custom') as any) || 'paused';
                                            const cfg = customLLMs.find(c => c.id === selectedId);
                                            const ready = status === 'active' && !!cfg?.apiKey;
                                            return (
                                                <span className={`text-[10px] font-black px-2 py-0.5 rounded ${ready ? 'bg-green-100 text-green-700' : 'bg-slate-200 text-slate-500'}`}>
                                                    {ready ? '🟢 就绪' : (selectedId ? '⚪️ 未配置' : '⚪️ 未选择')}
                                                </span>
                                            );
                                        })()}
                                    </div>
                                    <div className="text-[10px] text-slate-400">当 DeepSeek 与 Gemini 均不可用时，按启用状态自动尝试此主力自定义模型。</div>
                                </div>

                                <div className="bg-indigo-50/50 dark:bg-indigo-900/20 p-3 rounded-xl">
                                    <p className="text-[10px] text-indigo-600 dark:text-indigo-300 font-bold mb-1">💡 提示</p>
                                    <p className="text-[10px] text-indigo-500/80 dark:text-indigo-400/80">
                                        如需修改 API Key 或切换启用状态，请前往左侧 <b className="underline cursor-pointer hover:text-indigo-700" onClick={() => setActiveTab('Account')}>账户与数据</b> 菜单。
                                    </p>
                                </div>
                             </div>
                        </div>

                        {/* RAG Engine Card */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5 flex-1 flex flex-col">
                             <h3 className="text-sm font-black text-slate-700 dark:text-white mb-4 flex items-center gap-2"><span>📚</span> 知识库 RAG 引擎</h3>
                             <div className="flex gap-2 p-1 bg-white dark:bg-slate-900/50 rounded-xl mb-4 shrink-0">
                                {['openai', 'baidu', 'hybrid'].map(p => (
                                    <button 
                                        key={p}
                                        onClick={() => { setRagConfig({...ragConfig, provider: p}); saveRagSetting('rag_provider', p); }}
                                        className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${ragConfig.provider === p ? 'bg-slate-100 dark:bg-slate-700 text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500 hover:text-slate-600'}`}
                                    >
                                        {p === 'openai' ? '通用' : p === 'baidu' ? '百度' : '混合'}
                                    </button>
                                ))}
                             </div>
                             
                             <div className="space-y-3 overflow-y-auto custom-scrollbar pr-1 flex-1">
                                {ragConfig.provider === 'openai' && (
                                    <>
                                        <div><label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase block mb-1">API Key</label><input type="password" value={ragConfig.apiKey} onChange={e => setRagConfig({...ragConfig, apiKey: e.target.value})} onBlur={() => saveRagSetting('rag_api_key', ragConfig.apiKey)} className="w-full bg-white dark:bg-slate-900 border-none rounded-xl px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all dark:text-white shadow-sm" placeholder="sk-..." /></div>
                                        <div><label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase block mb-1">Base URL</label><input type="text" value={ragConfig.baseUrl} onChange={e => setRagConfig({...ragConfig, baseUrl: e.target.value})} onBlur={() => saveRagSetting('rag_base_url', ragConfig.baseUrl)} className="w-full bg-white dark:bg-slate-900 border-none rounded-xl px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all dark:text-white shadow-sm" /></div>
                                    </>
                                )}
                                {ragConfig.provider === 'baidu' && (
                                    <>
                                        <div><label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase block mb-1">API Key</label><input type="password" value={ragConfig.apiKey} onChange={e => setRagConfig({...ragConfig, apiKey: e.target.value})} onBlur={() => saveRagSetting('rag_api_key', ragConfig.apiKey)} className="w-full bg-white dark:bg-slate-900 border-none rounded-xl px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 transition-all dark:text-white shadow-sm" /></div>
                                        <div><label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase block mb-1">Secret Key</label><input type="password" value={ragConfig.secretKey} onChange={e => setRagConfig({...ragConfig, secretKey: e.target.value})} onBlur={() => saveRagSetting('rag_secret_key', ragConfig.secretKey)} className="w-full bg-white dark:bg-slate-900 border-none rounded-xl px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 transition-all dark:text-white shadow-sm" /></div>
                                    </>
                                )}
                                {ragConfig.provider === 'hybrid' && (
                                    <div className="text-[10px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30 p-4 rounded-xl font-bold leading-relaxed">⚡️ 混合模式自动优先使用本地模型，云端作为备用。无需配置 Key。</div>
                                )}
                                
                                <div className="pt-4 border-t border-slate-200/50 dark:border-slate-700/50 mt-4">
                                    <button 
                                        onClick={handleClearKnowledgeBase}
                                        className="w-full py-2 bg-red-50 dark:bg-red-900/20 text-red-500 hover:bg-red-100 dark:hover:bg-red-900/40 rounded-xl text-[10px] font-bold transition-all border border-red-200 dark:border-red-800/50 flex items-center justify-center gap-2"
                                    >
                                        <span>🗑️</span> 清空/重建知识库索引
                                    </button>
                                    <p className="text-[9px] text-slate-400 mt-2 text-center">模型升级或数据异常时使用</p>
                                </div>
                             </div>
                        </div>
                    </div>

                    {/* Right Column: Visual Design & LLM Engine */}
                    <div className="lg:col-span-7 h-full overflow-hidden flex flex-col gap-4">
                        {/* Visual Design Engine */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5 relative overflow-hidden flex flex-col h-[40%] shrink-0">
                             <div className="absolute top-0 right-0 w-48 h-48 bg-purple-50/50 dark:bg-purple-900/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
                             <div className="shrink-0 mb-3">
                                 <h3 className="text-sm font-black uppercase tracking-widest text-slate-800 dark:text-white mb-2 flex items-center gap-2"><span>🎨</span> 视觉设计引擎</h3>
                                 <div className="text-[10px] text-slate-400 leading-relaxed max-w-lg">
                                    配置文生图模型以启用海报生成功能。
                                 </div>
                             </div>
                             
                             <div className="space-y-3 overflow-y-auto custom-scrollbar pr-1 flex-1 relative z-10">
                                {(['Jimeng', 'Doubao', 'Nanobanana', 'Gemini'] as VisualProvider[]).map(p => {
                                    const config = visualConfigs[p];
                                    const links: Record<string, string> = {
                                        Jimeng: 'https://jimeng.jianying.com/',
                                        Doubao: 'https://console.volcengine.com/ark/',
                                        Nanobanana: 'https://nanobanana.com/',
                                        Gemini: 'https://aistudio.google.com/'
                                    };
                                    
                                    const isVolcengine = p === 'Jimeng' || p === 'Doubao';

                                    return (
                                        <div key={p} className="bg-white dark:bg-slate-900/50 rounded-xl p-3 shadow-sm border border-transparent hover:border-indigo-100 dark:hover:border-indigo-900 transition-all">
                                            <div className="flex justify-between items-center mb-2">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-xs font-black text-slate-700 dark:text-slate-300">{p}</span>
                                                    <a href={links[p]} target="_blank" rel="noreferrer" className="text-[9px] text-indigo-400 hover:text-indigo-600 underline bg-indigo-50 px-1.5 py-0.5 rounded">获取 Key</a>
                                                </div>
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-1.5 h-1.5 rounded-full ${config.isEnabled && (config.apiKey || (config.accessKeyId && config.secretAccessKey)) ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-slate-300'}`}></div>
                                                    <button 
                                                        onClick={() => handleToggleVisualStatus(p)}
                                                        className={`text-[9px] font-bold px-2.5 py-1 rounded-lg transition-colors ${config.isEnabled ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                                                    >
                                                        {config.isEnabled ? '已启用' : '暂停'}
                                                    </button>
                                                </div>
                                            </div>
                                            
                                            {isVolcengine ? (
                                                <div className="grid grid-cols-2 gap-2">
                                                    <div className="flex flex-col gap-1">
                                                        <input 
                                                            value={config.accessKeyId || ''}
                                                            onChange={(e) => handleUpdateVisualConfig(p, 'accessKeyId', e.target.value)}
                                                            className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-2.5 py-1.5 text-[10px] outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-mono text-slate-600"
                                                            placeholder="AK..."
                                                        />
                                                    </div>
                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex gap-2">
                                                            <input 
                                                                type="password" 
                                                                value={config.secretAccessKey || ''}
                                                                onChange={(e) => handleUpdateVisualConfig(p, 'secretAccessKey', e.target.value)}
                                                                className="flex-1 bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-2.5 py-1.5 text-[10px] outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-mono text-slate-600"
                                                                placeholder="SK..."
                                                            />
                                                            {(config.accessKeyId || config.secretAccessKey) && (
                                                                <button onClick={() => handleClearVisualKey(p)} className="text-slate-400 hover:text-red-500 px-1" title="清除配置">
                                                                    <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex gap-2">
                                                        <input 
                                                            type="password" 
                                                            value={config.apiKey || ''}
                                                            onChange={(e) => handleUpdateVisualConfig(p, 'apiKey', e.target.value)}
                                                            className="flex-1 bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-2.5 py-1.5 text-[10px] outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all font-mono text-slate-600"
                                                            placeholder={`输入 ${p} API Key...`}
                                                        />
                                                        {config.apiKey && (
                                                            <button onClick={() => handleClearVisualKey(p)} className="text-slate-400 hover:text-red-500 px-1" title="清除配置">
                                                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                             </div>
                        </div>

                        {/* LLM Engine */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5 relative overflow-hidden flex flex-col flex-1 min-h-0">
                             <div className="absolute top-0 right-0 w-48 h-48 bg-blue-50/50 dark:bg-blue-900/20 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>
                             <div className="shrink-0 mb-3 flex justify-between items-center relative z-10">
                                 <div>
                                    <h3 className="text-sm font-black uppercase tracking-widest text-slate-800 dark:text-white mb-1 flex items-center gap-2"><span>🧠</span> LLM 引擎</h3>
                                    <div className="text-[10px] text-slate-400">配置更多大语言模型以开启“多元探索”模式 (需至少 2 个模型)。</div>
                                 </div>
                                 <button 
                                    onClick={() => setEditingLLM({ isEnabled: true })}
                                    className="px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 transition-all shadow-md shadow-indigo-200 dark:shadow-none"
                                 >
                                    + 添加模型
                                 </button>
                             </div>

                             {editingLLM ? (
                                 <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10 bg-white dark:bg-slate-900/50 rounded-xl p-4 border border-indigo-100 dark:border-indigo-900/30">
                                     <h4 className="text-xs font-black text-slate-700 dark:text-slate-300 mb-4 uppercase">
                                         {editingLLM.id ? '编辑模型配置' : '添加新模型'}
                                     </h4>
                                     <div className="space-y-3">
                                         <div>
                                             <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">模型提供商</label>
                                             <select 
                                                value={editingLLM.provider} 
                                                onChange={e => {
                                                    const p = PRESET_LLM_PROVIDERS.find(pre => pre.name === e.target.value);
                                                    setEditingLLM({
                                                        ...editingLLM,
                                                        provider: e.target.value,
                                                        baseUrl: p?.baseUrl || editingLLM.baseUrl,
                                                        modelId: p?.defaultModel || editingLLM.modelId,
                                                        name: editingLLM.name || e.target.value // Auto set name if empty
                                                    });
                                                }}
                                                className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2 text-xs font-bold outline-none"
                                             >
                                                 <option value="">请选择...</option>
                                                 {PRESET_LLM_PROVIDERS.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                                             </select>
                                         </div>
                                         <div className="grid grid-cols-2 gap-3">
                                             <div>
                                                 <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">显示名称</label>
                                                 <input 
                                                    value={editingLLM.name || ''}
                                                    onChange={e => setEditingLLM({...editingLLM, name: e.target.value})}
                                                    className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2 text-xs font-bold outline-none"
                                                    placeholder="例如: 我的 DeepSeek"
                                                 />
                                             </div>
                                             <div>
                                                 <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Model ID</label>
                                                 <div className="flex gap-2">
                                                    <input 
                                                       value={editingLLM.modelId || ''}
                                                       onChange={e => setEditingLLM({...editingLLM, modelId: e.target.value})}
                                                       className="flex-1 bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2 text-xs font-bold outline-none font-mono"
                                                       placeholder="模型型号..."
                                                    />
                                                    <button
                                                       onClick={handleLoadModels}
                                                       disabled={isLoadingLLMModels}
                                                       className="px-3 rounded-lg bg-slate-100 text-slate-600 text-[10px] font-black hover:bg-slate-200 disabled:opacity-50"
                                                       title="从 /v1/models 拉取可用模型"
                                                    >
                                                       {isLoadingLLMModels ? '加载中' : '拉取'}
                                                    </button>
                                                 </div>
                                                 {llmModelsError && (
                                                    <div className="text-[10px] text-red-500 mt-1 font-bold">{llmModelsError}</div>
                                                 )}
                                                 {llmModels.length > 0 && (
                                                    <select
                                                       value={editingLLM.modelId || ''}
                                                       onChange={e => setEditingLLM({...editingLLM, modelId: e.target.value})}
                                                       className="w-full mt-2 bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2 text-xs font-bold outline-none font-mono"
                                                    >
                                                       <option value="">从列表选择...</option>
                                                       {llmModels.map(m => <option key={m} value={m}>{m}</option>)}
                                                    </select>
                                                 )}
                                             </div>
                                         </div>
                                         <div>
                                             <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Base URL (API 地址)</label>
                                             <input 
                                                value={editingLLM.baseUrl || ''}
                                                onChange={e => setEditingLLM({...editingLLM, baseUrl: e.target.value})}
                                                className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2 text-xs font-bold outline-none font-mono"
                                                placeholder="https://..."
                                             />
                                         </div>
                                         <div>
                                             <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">API Key</label>
                                             <input 
                                                type="password"
                                                value={editingLLM.apiKey || ''}
                                                onChange={e => setEditingLLM({...editingLLM, apiKey: e.target.value})}
                                                className="w-full bg-slate-50 dark:bg-slate-800 border-none rounded-lg px-3 py-2 text-xs font-bold outline-none font-mono"
                                                placeholder="sk-..."
                                             />
                                         </div>
                                         
                                         <div className="flex gap-2 pt-2">
                                             <button onClick={() => setEditingLLM(null)} className="flex-1 py-2 rounded-lg bg-slate-100 text-slate-500 text-xs font-bold hover:bg-slate-200">取消</button>
                                             <button 
                                                onClick={() => handleTestLLM(editingLLM)}
                                                disabled={isTestingLLM}
                                                className="flex-1 py-2 rounded-lg bg-blue-50 text-blue-600 text-xs font-bold hover:bg-blue-100 disabled:opacity-50"
                                             >
                                                 {isTestingLLM ? '测试中...' : '🔌 测试连接'}
                                             </button>
                                             <button onClick={handleSaveLLM} className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-xs font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-200 dark:shadow-none">保存</button>
                                         </div>
                                     </div>
                                 </div>
                             ) : (
                                 <div className="flex-1 overflow-y-auto custom-scrollbar relative z-10 space-y-2">
                                     {customLLMs.length === 0 ? (
                                         <div className="h-full flex flex-col items-center justify-center text-slate-300 dark:text-slate-600">
                                             <div className="text-2xl mb-2">🧊</div>
                                             <div className="text-[10px] font-bold uppercase tracking-widest">暂无自定义模型</div>
                                         </div>
                                     ) : (
                                         customLLMs.map(llm => (
                                             <div key={llm.id} className="bg-white dark:bg-slate-900/50 rounded-xl p-3 shadow-sm border border-transparent hover:border-indigo-100 dark:hover:border-indigo-900 transition-all group">
                                                 <div className="flex justify-between items-center mb-1">
                                                     <div className="flex items-center gap-2">
                                                         <span className="text-xs font-black text-slate-700 dark:text-slate-300">{llm.name}</span>
                                                         <span className="text-[9px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded font-mono">{llm.modelId}</span>
                                                     </div>
                                                     <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                         <button onClick={() => setEditingLLM(llm)} className="text-[9px] font-bold text-indigo-500 hover:text-indigo-700 bg-indigo-50 px-2 py-1 rounded">编辑</button>
                                                         <button onClick={() => handleDeleteLLM(llm.id)} className="text-[9px] font-bold text-red-400 hover:text-red-600 bg-red-50 px-2 py-1 rounded">删除</button>
                                                     </div>
                                                 </div>
                                                 <div className="flex justify-between items-center">
                                                     <div className="text-[9px] text-slate-400 truncate max-w-[200px]">{llm.baseUrl}</div>
                                                     <div className={`w-1.5 h-1.5 rounded-full ${llm.isEnabled ? 'bg-green-500' : 'bg-slate-300'}`}></div>
                                                 </div>
                                             </div>
                                         ))
                                     )}
                                 </div>
                             )}
                        </div>
                    </div>
                </div>
              </div>
            )}

            {activeTab === 'Account' && (
              <div className="flex-1 p-6 overflow-hidden flex flex-col">
                <div className="flex flex-col lg:grid lg:grid-cols-2 gap-6 flex-1 min-h-0">
                        {/* Left Column: Dual API Config */}
                    <div className="flex flex-col gap-6 h-full overflow-y-auto custom-scrollbar pr-1">
                         {/* DeepSeek Card (Primary) */}
                         <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 shrink-0 flex flex-col">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-black text-slate-700 dark:text-slate-300">DeepSeek (首选)</span>
                                    <a href="https://platform.deepseek.com/api-docs" target="_blank" rel="noreferrer" className="text-[9px] text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded hover:text-blue-700">API 文档</a>
                                    <a href="https://platform.deepseek.com/api-docs" target="_blank" rel="noreferrer" className="text-[9px] text-blue-500 bg-blue-50 px-1.5 py-0.5 rounded hover:text-blue-700">型号列表</a>
                                </div>
                                <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${apiState.deepseek.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-slate-200 text-slate-500'}`}>
                                    {apiState.deepseek.status === 'active' ? '已启用' : '已暂停'}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <div>
                                    <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase block mb-1">API Key</label>
                                    <input 
                                        type="password" 
                                        value={apiState.deepseek.key}
                                        onChange={(e) => handleUpdateKey('deepseek', e.target.value)}
                                        placeholder="sk-..."
                                        className="w-full bg-white dark:bg-slate-900 border-none rounded-lg px-2.5 py-2 text-[10px] font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase block mb-1">Model ID</label>
                                    <input
                                        type="text"
                                        value={modelState.deepseek}
                                        onChange={(e) => handleUpdateModel('deepseek', e.target.value)}
                                        placeholder="deepseek-chat"
                                        className="w-full bg-white dark:bg-slate-900 border-none rounded-lg px-2.5 py-2 text-[10px] font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all dark:text-white font-mono"
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => handleToggleStatus('deepseek')} className="flex-1 py-2 rounded-lg bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 text-[10px] font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                    {apiState.deepseek.status === 'active' ? '⏸ 暂停' : '▶️ 启用'}
                                </button>
                                <button 
                                    onClick={() => handleTestEngine('deepseek')}
                                    disabled={isTestingDeepseek}
                                    className="flex-1 py-2 rounded-lg bg-blue-50 text-blue-600 text-[10px] font-bold hover:bg-blue-100 disabled:opacity-50"
                                >
                                    {isTestingDeepseek ? '测试中...' : '🔌 测试连接'}
                                </button>
                                <button onClick={() => handleClearKey('deepseek')} className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 text-red-500 text-[10px] font-bold hover:bg-red-50 transition-colors">
                                    清除
                                </button>
                            </div>
                         </div>

                         {/* Gemini Card (Secondary) */}
                         <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 shrink-0 flex flex-col">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-black text-slate-700 dark:text-slate-300">Google Gemini (备用)</span>
                                    <a href="https://ai.google.dev/gemini-api" target="_blank" rel="noreferrer" className="text-[9px] text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded hover:text-indigo-700">API 文档</a>
                                    <a href="https://ai.google.dev/gemini-api/docs/models" target="_blank" rel="noreferrer" className="text-[9px] text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded hover:text-indigo-700">型号列表</a>
                                </div>
                                <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${apiState.google.status === 'active' ? 'bg-green-100 text-green-600' : 'bg-slate-200 text-slate-500'}`}>
                                    {apiState.google.status === 'active' ? '已启用' : '已暂停'}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <div>
                                    <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase block mb-1">API Key</label>
                                    <input 
                                        type="password" 
                                        value={apiState.google.key}
                                        onChange={(e) => handleUpdateKey('google', e.target.value)}
                                        placeholder="AIza..."
                                        className="w-full bg-white dark:bg-slate-900 border-none rounded-lg px-2.5 py-2 text-[10px] font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all dark:text-white"
                                    />
                                </div>
                                <div>
                                    <label className="text-[9px] font-bold text-slate-400 dark:text-slate-500 uppercase block mb-1">Model ID</label>
                                    <input
                                        type="text"
                                        value={modelState.google}
                                        onChange={(e) => handleUpdateModel('google', e.target.value)}
                                        placeholder="gemini-2.0-flash-exp"
                                        className="w-full bg-white dark:bg-slate-900 border-none rounded-lg px-2.5 py-2 text-[10px] font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all dark:text-white font-mono"
                                    />
                                </div>
                            </div>
                            <div className="flex gap-2">
                                <button onClick={() => handleToggleStatus('google')} className="flex-1 py-2 rounded-lg bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 text-[10px] font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                    {apiState.google.status === 'active' ? '⏸ 暂停' : '▶️ 启用'}
                                </button>
                                <button 
                                    onClick={() => handleTestEngine('google')}
                                    disabled={isTestingGoogle}
                                    className="flex-1 py-2 rounded-lg bg-blue-50 text-blue-600 text-[10px] font-bold hover:bg-blue-100 disabled:opacity-50"
                                >
                                    {isTestingGoogle ? '测试中...' : '🔌 测试连接'}
                                </button>
                                <button onClick={() => handleClearKey('google')} className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 text-red-500 text-[10px] font-bold hover:bg-red-50 transition-colors">
                                    清除
                                </button>
                            </div>
                         </div>
                         
                         {/* Other Model (Primary) */}
                         <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 shrink-0 flex flex-col">
                            <div className="flex items-center justify-between mb-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-black text-slate-700 dark:text-slate-300">其他模型（主力）</span>
                                </div>
                                <div className={`px-2 py-0.5 rounded text-[10px] font-bold ${primaryCustomStatus === 'active' ? 'bg-green-100 text-green-600' : 'bg-slate-200 text-slate-500'}`}>
                                    {primaryCustomStatus === 'active' ? '已启用' : '已暂停'}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-3 mb-3">
                                <div className="col-span-2">
                                    <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">选择自定义模型</label>
                                    <select
                                        value={primaryCustomId}
                                        onChange={(e) => handleSelectPrimaryCustom(e.target.value)}
                                        className="w-full bg-white dark:bg-slate-900 border-none rounded-lg px-2.5 py-2 text-[10px] font-bold outline-none"
                                    >
                                        <option value="">未选择</option>
                                        {customLLMs.map(c => (
                                            <option key={c.id} value={c.id}>{c.name} ({c.modelId})</option>
                                        ))}
                                    </select>
                                </div>
                                {(() => {
                                    const cfg = customLLMs.find(c => c.id === primaryCustomId);
                                    if (!cfg) return null;
                                    return (
                                        <>
                                            <div>
                                                <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Model ID</label>
                                                <input
                                                    value={cfg.modelId}
                                                    readOnly
                                                    className="w-full bg-white dark:bg-slate-900 border-none rounded-lg px-2.5 py-2 text-[10px] font-bold outline-none font-mono"
                                                />
                                            </div>
                                            <div>
                                                <label className="text-[9px] font-bold text-slate-400 uppercase block mb-1">Base URL</label>
                                                <input
                                                    value={cfg.baseUrl || ''}
                                                    readOnly
                                                    className="w-full bg-white dark:bg-slate-900 border-none rounded-lg px-2.5 py-2 text-[10px] font-bold outline-none font-mono"
                                                />
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>
                            <div className="flex gap-2">
                                <button onClick={handleTogglePrimaryCustomStatus} className="flex-1 py-2 rounded-lg bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 text-[10px] font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                    {primaryCustomStatus === 'active' ? '⏸ 暂停' : '▶️ 启用'}
                                </button>
                                <button
                                    onClick={() => {
                                        const cfg = customLLMs.find(c => c.id === primaryCustomId);
                                        if (!cfg) { alert('请先选择模型'); return; }
                                        handleTestLLM(cfg);
                                    }}
                                    disabled={isTestingLLM}
                                    className="flex-1 py-2 rounded-lg bg-blue-50 text-blue-600 text-[10px] font-bold hover:bg-blue-100 disabled:opacity-50"
                                >
                                    {isTestingLLM ? '测试中...' : '🔌 测试连接'}
                                </button>
                                <button
                                    onClick={() => {
                                        setPrimaryCustomId('');
                                        localStorage.removeItem('user_primary_custom_llm_id');
                                        try {
                                            const secure = (window as any).electronAPI?.secure;
                                            if (secure?.set) {
                                                void secure.set('user_primary_custom_llm_id', '');
                                            } else if ((window as any).electronAPI?.db?.saveSetting) {
                                                void (window as any).electronAPI.db.saveSetting('user_primary_custom_llm_id', '');
                                            }
                                        } catch (e) {}
                                    }}
                                    className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 text-red-500 text-[10px] font-bold hover:bg-red-50 transition-colors"
                                >
                                    清除选择
                                </button>
                            </div>
                         </div>
                    </div>

                    <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-800/50 rounded-2xl overflow-hidden">
                        <div className="p-6 border-b border-slate-200/50 dark:border-slate-700/50">
                            <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-2">
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" /></svg>
                                数据备份与迁移
                            </label>
                        </div>
                        <div className="flex-1 p-8 flex flex-col items-center justify-center text-center">
                            <div className="w-20 h-20 bg-indigo-50 dark:bg-indigo-900/20 rounded-3xl flex items-center justify-center text-4xl mb-6 shadow-sm text-indigo-500 dark:text-indigo-400">
                                💾
                            </div>
                            <h4 className="text-base font-black text-slate-800 dark:text-white mb-2">本地数据快照</h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xs mb-8 leading-relaxed">
                                将您的所有项目、排期、团队成员和偏好设置导出为 JSON 文件，用于备份或迁移到新设备。
                            </p>
                            
                            <div className="w-full max-w-xs space-y-3">
                                <button onClick={handleBackupData} className="w-full py-3.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold shadow-lg shadow-indigo-200 dark:shadow-none transition-all flex items-center justify-center gap-2 active:scale-95">
                                    <span>📤</span> 导出完整备份
                                </button>
                                <button onClick={handleRestoreBackup} className="w-full py-3.5 bg-white dark:bg-slate-700 hover:bg-slate-50 dark:hover:bg-slate-600 border border-transparent hover:border-slate-200 text-slate-600 dark:text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 active:scale-95">
                                    <span>📥</span> 从文件恢复数据
                                </button>
                            </div>

                            <div className="w-full max-w-xs mt-8 pt-8 border-t border-slate-200/50 dark:border-slate-700/50">
                                <button onClick={handleResetAndLogout} className="w-full py-3 text-red-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl text-[10px] font-bold transition-all flex items-center justify-center gap-2">
                                    <span>⚠️</span> 重置应用配置 (Factory Reset)
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
              </div>
            )}

            {activeTab === 'Integrations' && (
              <div className="flex-1 p-6 overflow-hidden flex flex-col relative">
                <div className="flex items-center justify-between gap-3 mb-4">
                  <div className="flex items-center gap-2 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-700/60 rounded-xl p-1">
                    <button
                      onClick={() => setMarketSection('Integrations')}
                      className={`px-3 py-2 rounded-lg text-[10px] font-black transition-colors ${marketSection === 'Integrations' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                    >
                      集成
                    </button>
                    <button
                      onClick={() => setMarketSection('Plugins')}
                      className={`px-3 py-2 rounded-lg text-[10px] font-black transition-colors ${marketSection === 'Plugins' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                    >
                      插件
                    </button>
                    <button
                      onClick={() => setMarketSection('Tools')}
                      className={`px-3 py-2 rounded-lg text-[10px] font-black transition-colors ${marketSection === 'Tools' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                    >
                      脚本工具
                    </button>
                    <button
                      onClick={() => setMarketSection('Locations')}
                      className={`px-3 py-2 rounded-lg text-[10px] font-black transition-colors ${marketSection === 'Locations' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
                    >
                      位置
                    </button>
                  </div>
                  <button
                    onClick={async () => {
                      setMarketBusy(true);
                      await refreshOpenClaw();
                      await refreshClaudeCode();
                      await refreshMarketplace();
                      setMarketBusy(false);
                    }}
                    className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 text-[10px] font-black hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 border border-slate-200/60 dark:border-slate-700/60"
                    disabled={marketBusy || openclawBusy}
                  >
                    {marketBusy ? '刷新中...' : '刷新'}
                  </button>
                </div>

                {marketSection === 'Integrations' && (
                <div className="flex flex-col lg:grid lg:grid-cols-2 gap-6 flex-1 min-h-0">
                  <div className="flex flex-col gap-6 h-full overflow-y-auto custom-scrollbar pr-1">
                    <section className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5 shrink-0">
                      <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <span>🦞</span> OpenClaw 集成
                      </label>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                            状态：{openclawStatus?.enabled ? '已启用' : '未启用'} / {openclawStatus?.gateway?.running ? 'Gateway 运行中' : 'Gateway 未运行'}
                          </div>
                          <button
                            onClick={async () => {
                              setOpenclawBusy(true);
                              await refreshOpenClaw();
                              setOpenclawBusy(false);
                            }}
                            className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 text-[10px] font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                            disabled={openclawBusy}
                          >
                            {openclawBusy ? '刷新中...' : '刷新状态'}
                          </button>
                        </div>

                        <div className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                          * 本集成为可选能力：默认关闭。启用后将启动本地 OpenClaw 服务，并开放仅限本机回环地址的受控技能桥接端口。
                        </div>

                        <div className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700/60">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">模型凭据（来自 AI 智能引擎）</div>
                            <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                              {openclawAuthSummary.deepseek ? 'DeepSeek✓' : 'DeepSeek×'} · {openclawAuthSummary.google ? 'Google✓' : 'Google×'} · 自定义 {openclawAuthSummary.custom}
                            </div>
                          </div>
                          {(!openclawAuthSummary.deepseek && !openclawAuthSummary.google && openclawAuthSummary.custom === 0) && (
                            <div className="mt-2 text-[10px] text-amber-700 dark:text-amber-300">
                              未检测到可用密钥：OpenClaw 运行会报缺少 API Key。请先在“AI 智能引擎”配置并保存。
                            </div>
                          )}
                        </div>

                        <div className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700/60">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">安装检测</div>
                            <div className={`text-[10px] font-black ${openclawStatus?.installed ? 'text-green-600' : 'text-red-500'}`}>
                              {openclawStatus?.installed ? '已检测到' : '未检测到'}
                            </div>
                          </div>
                          <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 font-mono break-all">
                            {openclawStatus?.executable || 'openclaw (PATH 未找到)'}
                          </div>
                          {openclawStatus?.lastError && (
                            <div className="mt-2 text-[10px] text-red-500 break-words">{openclawStatus.lastError}</div>
                          )}
                        </div>

                        {!openclawStatus?.installed && (
                          <div className="bg-amber-50/70 dark:bg-amber-900/10 rounded-xl p-3 border border-amber-200/60 dark:border-amber-800/40">
                            <div className="text-[10px] font-black text-amber-700 dark:text-amber-300">尚未安装 OpenClaw</div>
                            <div className="mt-1 text-[10px] text-amber-800/80 dark:text-amber-200/80 leading-relaxed">
                              推荐使用“一键安装并配置”（托管安装，便于管理与干净卸载）。如果你已有 openclaw，也可以走手动安装。
                            </div>
                            {openclawManagedStatus?.activeInstall?.running && (
                              <div className="mt-2 bg-white/80 dark:bg-slate-900 rounded-xl p-3 border border-amber-200/60 dark:border-amber-800/40">
                                <div className="text-[10px] font-black text-amber-800 dark:text-amber-200">安装进行中</div>
                                <div className="mt-1 text-[10px] text-amber-800/80 dark:text-amber-200/80">
                                  当前步骤：{openclawManagedStatus.activeInstall.step || 'init'}（已用时 {Math.round(((openclawManagedStatus.activeInstall.elapsedMs || 0) / 1000))}s）
                                </div>
                                <div className="mt-2 flex gap-2">
                                  <button
                                    onClick={() => {
                                      setOpenclawAgreeTerms(false);
                                      setOpenclawAgreeRisk(false);
                                      setOpenclawWizard('install');
                                    }}
                                    className="flex-1 py-2 rounded-lg bg-white dark:bg-slate-900 text-amber-800 dark:text-amber-200 text-[10px] font-black hover:bg-white dark:hover:bg-slate-800 transition-colors border border-amber-200/60 dark:border-amber-800/40"
                                  >
                                    查看安装
                                  </button>
                                  <button
                                    onClick={async () => {
                                      const api = (window as any).electronAPI?.openclaw;
                                      if (!api?.managed?.cancel) return;
                                      const ok = confirm('确认取消正在进行的安装？');
                                      if (!ok) return;
                                      try {
                                        await api.managed.cancel();
                                      } catch (e) {}
                                      setOpenclawInstallWorking(false);
                                      await refreshOpenClaw();
                                    }}
                                    className="flex-1 py-2 rounded-lg bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white text-[10px] font-black transition-colors border border-red-500/20"
                                  >
                                    取消安装
                                  </button>
                                </div>
                              </div>
                            )}
                            <div className="mt-2 text-[10px] text-amber-800/70 dark:text-amber-200/70 leading-relaxed">
                              {openclawManagedStatus?.offlineRuntime?.available
                                ? '✅ 检测到离线安装资源：安装过程可不依赖下载 Node（openclaw 包是否离线取决于是否随包附带 tgz）。'
                                : 'ℹ️ 未检测到离线资源：安装时将联网下载 Node，并从 npm 安装 openclaw。'}
                            </div>
                            {openclawManagedStatus?.systemNode?.detected && (
                              <div className="mt-1 text-[10px] text-amber-800/70 dark:text-amber-200/70 leading-relaxed">
                                系统 Node：v{openclawManagedStatus.systemNode.major || '?'}（本软件默认不复用系统 Node，避免版本不一致导致不可控）
                              </div>
                            )}
                            <div className="mt-3 space-y-2">
                              <button
                                onClick={async () => {
                                  setOpenclawAgreeTerms(false);
                                  setOpenclawAgreeRisk(false);
                                  setOpenclawWizard('install');
                                }}
                                disabled={openclawInstallWorking || openclawManagedStatus?.activeInstall?.running}
                                className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black transition-all disabled:opacity-50"
                              >
                                {openclawInstallWorking || openclawManagedStatus?.activeInstall?.running ? '安装中...' : '一键安装并配置（推荐）'}
                              </button>

                              {(openclawInstallWorking || openclawInstallState) && (
                                <div className="bg-white/80 dark:bg-slate-900 rounded-xl p-3 border border-amber-200/60 dark:border-amber-800/40">
                                  <div className="flex items-center justify-between">
                                    <div className="text-[10px] font-black text-amber-800 dark:text-amber-200">安装进度</div>
                                    <div className="text-[10px] font-mono text-amber-800 dark:text-amber-200">
                                      {Math.round((openclawInstallProgress || 0) * 100)}%
                                    </div>
                                  </div>
                                  <div className="mt-2 h-2 w-full bg-amber-100 dark:bg-amber-900/30 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-amber-500"
                                      style={{ width: `${Math.round((openclawInstallProgress || 0) * 100)}%` }}
                                    />
                                  </div>
                                  <div className="mt-2 text-[10px] text-amber-800/80 dark:text-amber-200/80">
                                    {openclawInstallState?.message || openclawInstallState?.step || '准备中...'}
                                  </div>
                                </div>
                              )}
                            </div>
                            <div className="mt-3 flex gap-2">
                              <a
                                href="https://github.com/openclaw/openclaw?tab=readme-ov-file"
                                target="_blank"
                                rel="noreferrer"
                                className="flex-1 text-center py-2 rounded-lg bg-white/80 dark:bg-slate-900 text-amber-800 dark:text-amber-200 text-[10px] font-black hover:bg-white dark:hover:bg-slate-800 transition-colors border border-amber-200/60 dark:border-amber-800/40"
                              >
                                打开安装指南
                              </a>
                              <a
                                href="https://nodejs.org/"
                                target="_blank"
                                rel="noreferrer"
                                className="flex-1 text-center py-2 rounded-lg bg-white/80 dark:bg-slate-900 text-amber-800 dark:text-amber-200 text-[10px] font-black hover:bg-white dark:hover:bg-slate-800 transition-colors border border-amber-200/60 dark:border-amber-800/40"
                              >
                                安装 Node.js
                              </a>
                            </div>
                          </div>
                        )}

                        {openclawManagedStatus?.openclawBin && (
                          <div className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700/60">
                            <div className="flex items-center justify-between">
                              <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">托管安装</div>
                              <div className="text-[10px] font-black text-green-600">已安装</div>
                            </div>
                            <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 font-mono break-all">
                              {openclawManagedStatus.openclawBin}
                            </div>
                            <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
                              目标版本：{openclawManagedStatus?.desiredVersion || 'latest'} / 已安装：{openclawManagedStatus?.installedMeta?.openclawVersionInstalled || openclawManagedStatus?.installedMeta?.openclawVersion || 'unknown'}
                            </div>
                            <div className="mt-3">
                              <div className="flex gap-2">
                                <button
                                  onClick={() => {
                                    setOpenclawAgreeTerms(false);
                                    setOpenclawAgreeRisk(false);
                                    setOpenclawWizard('install');
                                  }}
                                  disabled={openclawInstallWorking}
                                  className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black transition-all disabled:opacity-50"
                                >
                                  升级 / 重装
                                </button>
                                <button
                                  onClick={async () => {
                                    const api = (window as any).electronAPI?.openclaw;
                                    if (!api?.managed?.rollback) return;
                                    const hasBackup = Array.isArray(openclawManagedStatus?.backups) && openclawManagedStatus.backups.length > 0;
                                    if (!hasBackup) { alert('没有可用的回滚版本'); return; }
                                    const ok = confirm('将停止 OpenClaw 并回滚到上一版本，是否继续？');
                                    if (!ok) return;
                                    setOpenclawInstallWorking(true);
                                    try {
                                      const res = await api.managed.rollback();
                                      if (!res?.success) alert(`❌ 回滚失败：${res?.error || 'Unknown error'}`);
                                    } catch (e: any) {
                                      alert(`❌ 回滚失败：${e?.message || 'Unknown error'}`);
                                    } finally {
                                      setOpenclawInstallWorking(false);
                                      await refreshOpenClaw();
                                    }
                                  }}
                                  disabled={openclawInstallWorking || !(Array.isArray(openclawManagedStatus?.backups) && openclawManagedStatus.backups.length > 0)}
                                  className="flex-1 py-2.5 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-black border border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all disabled:opacity-50"
                                >
                                  回滚
                                </button>
                              </div>
                              <button
                                onClick={() => setOpenclawWizard('uninstall')}
                                disabled={openclawInstallWorking}
                                className="mt-2 w-full py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white text-xs font-black transition-all disabled:opacity-50 border border-red-500/20"
                              >
                                干净卸载（托管安装）
                              </button>
                            </div>
                          </div>
                        )}

                        <div className="flex gap-2">
                          <button
                            onClick={async () => {
                              const api = (window as any).electronAPI?.openclaw;
                              if (!api) return;
                              if (!openclawStatus?.enabled) {
                                const ok = confirm(
                                  '启用 OpenClaw 前请确认：\n\n1) OpenClaw 属于高权限自动化代理，可能执行文件/网络等操作；\n2) 本软件仅通过受控桥接接口提供能力，仍需你自行承担使用风险；\n3) 建议仅在受信任设备与账号环境启用。\n\n是否继续启用？'
                                );
                                if (!ok) return;
                              }
                              setOpenclawBusy(true);
                              const s = await api.setEnabled(!openclawStatus?.enabled);
                              setOpenclawStatus(s);
                              setOpenclawBusy(false);
                            }}
                            disabled={openclawBusy || !openclawStatus?.installed}
                            className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black transition-all disabled:opacity-50"
                          >
                            {openclawStatus?.enabled ? '关闭集成' : '启用集成'}
                          </button>
                          <button
                            onClick={async () => {
                              const api = (window as any).electronAPI?.openclaw;
                              if (!api) return;
                              setOpenclawBusy(true);
                              const s = await api.ensureRunning();
                              setOpenclawStatus(s);
                              setOpenclawBusy(false);
                            }}
                            disabled={openclawBusy || !openclawStatus?.installed}
                            className="flex-1 py-2.5 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-black border border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all disabled:opacity-50"
                          >
                            一键拉起服务
                          </button>
                        </div>
                      </div>
                    </section>

                    <section className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5 shrink-0">
                      <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <span>⌨️</span> Claude Code 集成
                      </label>

                      <div className="space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                            状态：{claudeCodeStatus?.enabled ? '已启用' : '未启用'} / {claudeCodeStatus?.executableExists ? '已检测到可执行体' : '未检测到可执行体'}
                          </div>
                          <button
                            onClick={refreshClaudeCode}
                            className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 text-[10px] font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                            disabled={claudeCodeBusy}
                          >
                            {claudeCodeBusy ? '刷新中...' : '刷新状态'}
                          </button>
                        </div>

                        <div className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                          * Claude Code 属于高权限开发代理（终端会话）。建议仅在受信任设备启用，并把工作目录限制在项目仓库内。
                        </div>

                        <div className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700/60">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">可执行体来源</div>
                            <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">
                              {claudeCodeStatus?.configuredBin ? '自定义路径' : '自动检测'}
                            </div>
                          </div>
                          {claudeCodeStatus?.configuredBin && (
                            <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 font-mono break-all">
                              配置：{String(claudeCodeStatus.configuredBin || '')}
                            </div>
                          )}
                          <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 font-mono break-all">
                            当前：{claudeCodeStatus?.executablePath || 'claude (PATH 未找到)'}
                          </div>
                          {!claudeCodeStatus?.executableExists && (
                            <div className="mt-2 text-[10px] text-amber-700 dark:text-amber-300 leading-relaxed">
                              未检测到可执行体：如果你希望“打包后开箱即用”，需要在打包前把 Claude Code 可执行体放入 resources/claude_code_runtime（或在此处选择本机已安装的可执行文件）。
                            </div>
                          )}
                        </div>

                        <div className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700/60">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">网络代理（可选）</div>
                            <div className="flex gap-2">
                              <button
                                onClick={async () => {
                                  const api = (window as any).electronAPI?.claudeCode;
                                  if (!api?.resolveSystemProxy) return;
                                  setClaudeCodeBusy(true);
                                  try {
                                    const res = await api.resolveSystemProxy('https://api.anthropic.com');
                                    if (!res?.success) {
                                      alert(`❌ 自动检测失败：${res?.error || 'Unknown error'}`);
                                      return;
                                    }
                                    const raw = String(res?.proxy || '').trim();
                                    const first = raw
                                      .split(';')
                                      .map((s: string) => s.trim())
                                      .find((s: string) => /^PROXY\s+/i.test(s) || /^HTTPS?\s+/i.test(s) || /^SOCKS/i.test(s));
                                    if (!first) {
                                      alert(`未检测到系统代理（当前规则：${raw || 'DIRECT'}）`);
                                      return;
                                    }
                                    const parts = first.split(/\s+/);
                                    const kind = String(parts[0] || '').toUpperCase();
                                    const hostPort = String(parts[1] || '').trim();
                                    if (!hostPort) {
                                      alert(`未解析到代理地址（当前规则：${raw || 'DIRECT'}）`);
                                      return;
                                    }
                                    const scheme =
                                      kind.startsWith('SOCKS') ? (kind === 'SOCKS5' ? 'socks5' : 'socks') : 'http';
                                    setClaudeCodeProxy(`${scheme}://${hostPort}`);
                                    alert(`✅ 已检测到系统代理：${scheme}://${hostPort}\n请点击“保存”后重启 Claude Code 会话。`);
                                  } finally {
                                    setClaudeCodeBusy(false);
                                  }
                                }}
                                disabled={claudeCodeBusy}
                                className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 text-[10px] font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50 border border-slate-200/60 dark:border-slate-700/60"
                              >
                                自动检测
                              </button>
                              <button
                                onClick={async () => {
                                  const secure = (window as any).electronAPI?.secure;
                                  if (!secure?.set) return;
                                  setClaudeCodeBusy(true);
                                  try {
                                    await secure.set('claude_code_proxy', String(claudeCodeProxy || '').trim());
                                    await secure.set('claude_code_no_proxy', String(claudeCodeNoProxy || '').trim());
                                    alert('✅ 已保存（下次启动会话生效）');
                                    await refreshClaudeCode();
                                    try { window.dispatchEvent(new Event('claude-code-config-updated')); } catch (e) {}
                                  } catch (e: any) {
                                    alert(`❌ 保存失败：${e?.message || 'Unknown error'}`);
                                  } finally {
                                    setClaudeCodeBusy(false);
                                  }
                                }}
                                disabled={claudeCodeBusy}
                                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                              >
                                保存
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 grid grid-cols-1 gap-2">
                            <input
                              value={claudeCodeProxy}
                              onChange={(e) => setClaudeCodeProxy(e.target.value)}
                              placeholder="HTTPS_PROXY/HTTP_PROXY，例如 http://127.0.0.1:7890"
                              className="w-full px-3 py-2 rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-950 text-xs font-bold text-slate-700 dark:text-slate-200"
                            />
                            <input
                              value={claudeCodeNoProxy}
                              onChange={(e) => setClaudeCodeNoProxy(e.target.value)}
                              placeholder="NO_PROXY，例如 127.0.0.1,localhost"
                              className="w-full px-3 py-2 rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-950 text-xs font-bold text-slate-700 dark:text-slate-200"
                            />
                          </div>
                          <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                            * 将以环境变量注入 Claude Code 终端会话（HTTPS_PROXY/HTTP_PROXY/ALL_PROXY/NO_PROXY）。如果你处在受限网络环境，这是最常见的解决方式。
                          </div>
                        </div>

                        {!claudeCodeStatus?.executableExists && (
                          <div className="bg-amber-50/70 dark:bg-amber-900/10 rounded-xl p-3 border border-amber-200/60 dark:border-amber-800/40">
                            <div className="text-[10px] font-black text-amber-700 dark:text-amber-300">一键安装（推荐）</div>
                            <div className="mt-1 text-[10px] text-amber-800/80 dark:text-amber-200/80 leading-relaxed">
                              将自动下载 Node，并通过 npm 安装 {claudeCodeManagedStatus?.claude?.pkg || '@anthropic-ai/claude-code'} 到应用托管目录；安装完成后可直接在本软件中使用。
                              注意：首次使用仍可能需要在 Claude Code 内完成登录/授权。
                            </div>
                            <div className="mt-2 text-[10px] text-amber-800/70 dark:text-amber-200/70 leading-relaxed">
                              {claudeCodeManagedStatus?.claude?.offlineAvailable
                                ? '✅ 检测到离线安装资源：可不依赖网络安装（包内已携带 tgz）。'
                                : 'ℹ️ 未检测到离线资源：将联网下载 Node / npm 包。'}
                            </div>

                            <div className="mt-3 space-y-2">
                              <button
                                onClick={async () => {
                                  const api = (window as any).electronAPI?.claudeCode;
                                  if (!api?.managed?.install) return;
                                  setClaudeCodeInstallWorking(true);
                                  setClaudeCodeInstallState({ step: 'init', message: '准备安装…' });
                                  setClaudeCodeInstallProgress(0);
                                  const res = await api.managed.install({ claudeCodeVersion: 'latest' });
                                  if (!res?.success) {
                                    setClaudeCodeInstallWorking(false);
                                    alert(`❌ 安装失败：${res?.error || 'Unknown error'}`);
                                  } else {
                                    try { window.dispatchEvent(new Event('claude-code-config-updated')); } catch (e) {}
                                  }
                                }}
                                disabled={claudeCodeInstallWorking || claudeCodeManagedStatus?.activeInstall?.running}
                                className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-xs font-black transition-all disabled:opacity-50"
                              >
                                {claudeCodeInstallWorking || claudeCodeManagedStatus?.activeInstall?.running ? '安装中...' : '一键安装并配置'}
                              </button>

                              {(claudeCodeInstallWorking || claudeCodeInstallState || claudeCodeManagedStatus?.activeInstall?.running) && (
                                <div className="bg-white/80 dark:bg-slate-900 rounded-xl p-3 border border-amber-200/60 dark:border-amber-800/40">
                                  <div className="flex items-center justify-between">
                                    <div className="text-[10px] font-black text-amber-800 dark:text-amber-200">安装进度</div>
                                    <div className="text-[10px] font-mono text-amber-800 dark:text-amber-200">{Math.round((claudeCodeInstallProgress || 0) * 100)}%</div>
                                  </div>
                                  <div className="mt-2 h-2 w-full bg-amber-100 dark:bg-amber-900/30 rounded-full overflow-hidden">
                                    <div className="h-full bg-amber-500" style={{ width: `${Math.round((claudeCodeInstallProgress || 0) * 100)}%` }} />
                                  </div>
                                  <div className="mt-2 text-[10px] text-amber-800/80 dark:text-amber-200/80">
                                    {claudeCodeInstallState?.message || claudeCodeInstallState?.step || '准备中...'}
                                  </div>
                                  <div className="mt-2 flex gap-2">
                                    <button
                                      onClick={async () => {
                                        const api = (window as any).electronAPI?.claudeCode;
                                        if (!api?.managed?.cancel) return;
                                        const ok = confirm('确认取消正在进行的安装？');
                                        if (!ok) return;
                                        try {
                                          await api.managed.cancel();
                                        } catch (e) {}
                                        setClaudeCodeInstallWorking(false);
                                        await refreshClaudeCode();
                                      }}
                                      className="flex-1 py-2 rounded-lg bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white text-[10px] font-black transition-colors border border-red-500/20"
                                    >
                                      取消安装
                                    </button>
                                    <button
                                      onClick={async () => {
                                        const api = (window as any).electronAPI?.claudeCode;
                                        if (!api?.managed?.uninstall) return;
                                        const ok = confirm('确认卸载 Claude Code（托管安装）？');
                                        if (!ok) return;
                                        setClaudeCodeInstallWorking(false);
                                        setClaudeCodeInstallProgress(0);
                                        setClaudeCodeInstallState(null);
                                        const res = await api.managed.uninstall();
                                        if (!res?.success) {
                                          alert(`❌ 卸载失败：${res?.error || 'Unknown error'}`);
                                        }
                                        await refreshClaudeCode();
                                        try { window.dispatchEvent(new Event('claude-code-config-updated')); } catch (e) {}
                                      }}
                                      className="flex-1 py-2 rounded-lg bg-white dark:bg-slate-900 text-amber-800 dark:text-amber-200 text-[10px] font-black hover:bg-white dark:hover:bg-slate-800 transition-colors border border-amber-200/60 dark:border-amber-800/40"
                                    >
                                      干净卸载
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={async () => {
                              const api = (window as any).electronAPI?.claudeCode;
                              if (!api?.setEnabled) return;
                              if (!claudeCodeStatus?.enabled) {
                                const ok = confirm(
                                  '启用 Claude Code 前请确认：\n\n1) Claude Code 可能执行文件读写/命令/网络请求；\n2) 请仅在受信任设备与账号环境启用；\n3) 建议把工作目录限制在项目仓库。\n\n是否继续启用？'
                                );
                                if (!ok) return;
                              }
                              setClaudeCodeBusy(true);
                              try {
                                const s = await api.setEnabled(!claudeCodeStatus?.enabled);
                                setClaudeCodeStatus(s);
                                try { window.dispatchEvent(new Event('claude-code-config-updated')); } catch (e) {}
                              } finally {
                                setClaudeCodeBusy(false);
                              }
                            }}
                            disabled={claudeCodeBusy}
                            className="py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black transition-all disabled:opacity-50"
                          >
                            {claudeCodeStatus?.enabled ? '关闭集成' : '启用集成'}
                          </button>
                          <button
                            onClick={() => {
                              onNavigateTo('ClaudeCode');
                              onClose();
                            }}
                            disabled={claudeCodeBusy || !claudeCodeStatus?.enabled}
                            className="py-2.5 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-black border border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all disabled:opacity-50"
                          >
                            打开终端页
                          </button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            onClick={async () => {
                              const fsApi = (window as any).electronAPI?.fs;
                              const api = (window as any).electronAPI?.claudeCode;
                              if (!fsApi?.selectFile || !api?.installFromPath) return;
                              const file = await fsApi.selectFile({
                                filters: [{ name: 'Executable', extensions: ['*'] }]
                              });
                              const p = String(file?.path || file || '').trim();
                              if (!p) return;
                              setClaudeCodeBusy(true);
                              try {
                                const s = await api.installFromPath(p);
                                if (!s?.success) {
                                  alert(`❌ 托管安装失败：${s?.error || 'Unknown error'}`);
                                }
                                setClaudeCodeStatus(s);
                                try { window.dispatchEvent(new Event('claude-code-config-updated')); } catch (e) {}
                              } finally {
                                setClaudeCodeBusy(false);
                              }
                            }}
                            disabled={claudeCodeBusy}
                            className="py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-black hover:bg-slate-200 dark:hover:bg-slate-700 transition-all disabled:opacity-50"
                          >
                            托管安装（复制）
                          </button>
                          <button
                            onClick={async () => {
                              const fsApi = (window as any).electronAPI?.fs;
                              const api = (window as any).electronAPI?.claudeCode;
                              if (!fsApi?.selectFile || !api?.setExecutablePath) return;
                              const file = await fsApi.selectFile({
                                filters: [{ name: 'Executable', extensions: ['*'] }]
                              });
                              const p = String(file?.path || file || '').trim();
                              if (!p) return;
                              setClaudeCodeBusy(true);
                              try {
                                const s = await api.setExecutablePath(p);
                                if (!s?.success) {
                                  alert(`❌ 配置失败：${s?.error || 'Unknown error'}`);
                                }
                                setClaudeCodeStatus(s);
                                try { window.dispatchEvent(new Event('claude-code-config-updated')); } catch (e) {}
                              } finally {
                                setClaudeCodeBusy(false);
                              }
                            }}
                            disabled={claudeCodeBusy}
                            className="py-2.5 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-black border border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all disabled:opacity-50"
                          >
                            仅引用路径
                          </button>
                        </div>

                        <button
                          onClick={async () => {
                            const api = (window as any).electronAPI?.claudeCode;
                            if (!api?.clearExecutablePath) return;
                            const ok = confirm('清除当前可执行体配置？不会卸载系统已安装的 Claude Code。');
                            if (!ok) return;
                            setClaudeCodeBusy(true);
                            try {
                              const s = await api.clearExecutablePath();
                              setClaudeCodeStatus(s);
                              try { window.dispatchEvent(new Event('claude-code-config-updated')); } catch (e) {}
                            } finally {
                              setClaudeCodeBusy(false);
                            }
                          }}
                          disabled={claudeCodeBusy}
                          className="w-full py-2.5 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-black border border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all disabled:opacity-50"
                        >
                          清除配置
                        </button>

                        <button
                          onClick={async () => {
                            const api = (window as any).electronAPI?.claudeCode;
                            const canManaged = !!api?.managed?.uninstall;
                            const canLegacy = !!api?.uninstallManaged;
                            if (!canManaged && !canLegacy) return;
                            const ok = confirm('确认卸载 Claude Code（托管清理）？将清理应用托管目录并移除当前配置，但不会影响系统全局安装。');
                            if (!ok) return;
                            setClaudeCodeBusy(true);
                            try {
                              if (canManaged) {
                                const res = await api.managed.uninstall();
                                if (!res?.success) alert(`❌ 卸载失败：${res?.error || 'Unknown error'}`);
                                await refreshClaudeCode();
                              } else {
                                const s = await api.uninstallManaged();
                                setClaudeCodeStatus(s);
                              }
                              try { window.dispatchEvent(new Event('claude-code-config-updated')); } catch (e) {}
                            } finally {
                              setClaudeCodeBusy(false);
                            }
                          }}
                          disabled={claudeCodeBusy}
                          className="w-full py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500 text-red-600 dark:text-red-300 hover:text-white text-xs font-black transition-colors disabled:opacity-50 border border-red-500/20"
                        >
                          卸载（托管清理）
                        </button>
                      </div>
                    </section>
                  </div>

                  <div className="h-full flex flex-col bg-slate-50 dark:bg-slate-800/50 rounded-2xl overflow-hidden">
                    <div className="p-6 border-b border-slate-200/50 dark:border-slate-700/50">
                      <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest flex items-center gap-2">
                        <span>🔌</span> 受控技能桥接 (本地)
                      </label>
                    </div>
                    <div className="flex-1 p-6 overflow-y-auto custom-scrollbar">
                      <div className="space-y-3">
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                          * 仅监听 127.0.0.1。对 OpenClaw 暴露受控能力：获取工作上下文、知识库检索、触发 ProjectIntel 任务、写入/列出过程资产。
                        </div>
                        <div className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700/60">
                          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Bridge 端口</div>
                          <div className="text-xs font-black text-slate-700 dark:text-slate-200">
                            {openclawStatus?.bridge?.port || 18890} / {openclawStatus?.bridge?.running ? '运行中' : '未运行'}
                          </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700/60">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">Bridge Token</div>
                            <div className="flex gap-2">
                              <button
                                onClick={async () => {
                                  const api = (window as any).electronAPI?.openclaw;
                                  if (!api) return;
                                  const ok = confirm('Token 属于本机受控接口密钥，请仅在本机配置 OpenClaw 时使用。是否显示？');
                                  if (!ok) return;
                                  const t = await api.getBridgeToken();
                                  setOpenclawBridgeToken(String(t || ''));
                                }}
                                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                              >
                                显示
                              </button>
                              <button
                                onClick={async () => {
                                  const api = (window as any).electronAPI?.openclaw;
                                  if (!api?.rotateBridgeToken) return;
                                  const ok = confirm('这会立刻重置 Bridge Token。旧 Token 将失效，你需要在 OpenClaw 侧更新配置。是否继续？');
                                  if (!ok) return;
                                  try {
                                    await api.rotateBridgeToken();
                                  } catch (e) {}
                                  setOpenclawBridgeToken('');
                                  await refreshOpenClaw();
                                  alert('✅ 已重置 Bridge Token');
                                }}
                                className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-300 text-[10px] font-bold hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                              >
                                重置
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 text-[10px] font-mono break-all text-slate-600 dark:text-slate-300">
                            {openclawBridgeToken ? openclawBridgeToken : '（未显示）'}
                          </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700/60">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">消息推送（机器人 Webhook）</div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  try {
                                    (window as any).electronAPI?.shell?.openExternal?.('https://open.work.weixin.qq.com/help2/pc/14931');
                                  } catch (e) {}
                                }}
                                className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 text-[10px] font-bold border border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                              >
                                企业微信机器人指南
                              </button>
                              <button
                                onClick={() => {
                                  try {
                                    (window as any).electronAPI?.shell?.openExternal?.('https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot');
                                  } catch (e) {}
                                }}
                                className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 text-[10px] font-bold border border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                              >
                                飞书机器人指南
                              </button>
                              <button
                                onClick={async () => {
                                  const secure = (window as any).electronAPI?.secure;
                                  if (!secure?.set) return;
                                  try {
                                    await secure.set('notify_wecom_webhook', String(notifyWecomWebhook || '').trim());
                                    await secure.set('notify_feishu_webhook', String(notifyFeishuWebhook || '').trim());
                                    alert('✅ 已保存');
                                  } catch (e: any) {
                                    alert(`❌ 保存失败：${e?.message || 'Unknown error'}`);
                                  }
                                }}
                                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                              >
                                保存
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 grid grid-cols-1 gap-2">
                            <input
                              value={notifyWecomWebhook}
                              onChange={(e) => setNotifyWecomWebhook(e.target.value)}
                              placeholder="企业微信机器人 Webhook URL"
                              className="w-full px-3 py-2 rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-950 text-xs font-bold text-slate-700 dark:text-slate-200"
                            />
                            <input
                              value={notifyFeishuWebhook}
                              onChange={(e) => setNotifyFeishuWebhook(e.target.value)}
                              placeholder="飞书机器人 Webhook URL"
                              className="w-full px-3 py-2 rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-950 text-xs font-bold text-slate-700 dark:text-slate-200"
                            />
                          </div>
                          <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                            * 由本机受控桥接调用发送；默认需要审批后才会推送。
                          </div>
                        </div>

                        <div className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700/60">
                          <div className="flex items-center justify-between">
                            <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">OpenClaw 飞书/Lark 通道</div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  try {
                                    const url = openclawFeishuDomain === 'lark' ? 'https://open.larksuite.com/app' : 'https://open.feishu.cn/app';
                                    (window as any).electronAPI?.shell?.openExternal?.(url);
                                  } catch (e) {}
                                }}
                                className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 text-[10px] font-bold border border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                              >
                                打开开放平台
                              </button>
                              <button
                                onClick={() => {
                                  try {
                                    (window as any).electronAPI?.shell?.openExternal?.('https://docs.openclaw.ai/channels/feishu');
                                  } catch (e) {}
                                }}
                                className="px-3 py-2 rounded-lg bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 text-[10px] font-bold border border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
                              >
                                配置教程
                              </button>
                              <button
                                onClick={async () => {
                                  const secure = (window as any).electronAPI?.secure;
                                  const openclaw = (window as any).electronAPI?.openclaw;
                                  if (!secure?.set) return;
                                  try {
                                    await secure.set('openclaw_feishu_app_id', String(openclawFeishuAppId || '').trim());
                                    await secure.set('openclaw_feishu_app_secret', String(openclawFeishuAppSecret || '').trim());
                                    await secure.set('openclaw_feishu_domain', String(openclawFeishuDomain || 'feishu'));
                                    try { await openclaw?.ensureRunning?.(); } catch (e) {}
                                    alert('✅ 已保存（如已运行，建议重启 OpenClaw Gateway 使配置生效）');
                                  } catch (e: any) {
                                    alert(`❌ 保存失败：${e?.message || 'Unknown error'}`);
                                  }
                                }}
                                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                              >
                                保存
                              </button>
                            </div>
                          </div>
                          <div className="mt-2 grid grid-cols-1 gap-2">
                            <select
                              value={openclawFeishuDomain}
                              onChange={(e) => setOpenclawFeishuDomain((String(e.target.value) === 'lark') ? 'lark' : 'feishu')}
                              className="w-full px-3 py-2 rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-950 text-xs font-bold text-slate-700 dark:text-slate-200"
                            >
                              <option value="feishu">飞书（feishu）</option>
                              <option value="lark">Lark（海外）</option>
                            </select>
                            <input
                              value={openclawFeishuAppId}
                              onChange={(e) => setOpenclawFeishuAppId(e.target.value)}
                              placeholder="App ID（如 cli_xxx）"
                              className="w-full px-3 py-2 rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-950 text-xs font-bold text-slate-700 dark:text-slate-200"
                            />
                            <input
                              value={openclawFeishuAppSecret}
                              onChange={(e) => setOpenclawFeishuAppSecret(e.target.value)}
                              placeholder="App Secret"
                              className="w-full px-3 py-2 rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white dark:bg-slate-950 text-xs font-bold text-slate-700 dark:text-slate-200"
                            />
                          </div>
                          <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                            * 该配置用于 OpenClaw 原生“Channels→Feishu/Lark”通道（不是机器人 Webhook）。保存后将写入 OpenClaw 配置，需重启 Gateway 生效。
                          </div>
                        </div>

                      <div className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700/60">
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">Agent 自动放行策略</div>
                          <button
                            onClick={refreshAgentControls}
                            disabled={agentBusy}
                            className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                          >
                            {agentBusy ? '刷新中...' : '刷新'}
                          </button>
                        </div>
                        <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                          * 目标是尽量不打断 agent：低风险自动放行；高风险进入待审批队列，你可以稍后统一处理。
                        </div>
                        <div className="mt-3 space-y-2">
                          {[
                            { key: 'netFetchAllowlisted', label: '白名单域名联网自动放行' },
                            { key: 'fsWriteArtifacts', label: '写入应用托管目录自动放行' },
                            { key: 'projectIntelRun', label: 'ProjectIntel 联网任务自动放行' }
                          ].map((row) => (
                            <label key={row.key} className="flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl px-3 py-2 border border-slate-200/60 dark:border-slate-700/60">
                              <div className="text-[10px] font-black text-slate-700 dark:text-slate-200">{row.label}</div>
                              <input
                                type="checkbox"
                                checked={!!agentPolicy?.autoApprove?.[row.key]}
                                onChange={async (e) => {
                                  const api = (window as any).electronAPI;
                                  if (!api?.agentPolicy?.set) return;
                                  const next = {
                                    ...(agentPolicy || {}),
                                    autoApprove: { ...(agentPolicy?.autoApprove || {}), [row.key]: !!e.currentTarget.checked }
                                  };
                                  setAgentBusy(true);
                                  try {
                                    const res = await api.agentPolicy.set(next);
                                    if (res?.success) setAgentPolicy(res.policy);
                                  } finally {
                                    setAgentBusy(false);
                                  }
                                }}
                                className="h-4 w-4"
                              />
                            </label>
                          ))}
                        </div>
                      </div>

                      <div className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700/60">
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400">待审批队列</div>
                          <div className="text-[10px] font-mono text-slate-400 dark:text-slate-500">{Array.isArray(agentApprovals) ? agentApprovals.length : 0}</div>
                        </div>
                        <div className="mt-2 space-y-2">
                          {(Array.isArray(agentApprovals) ? agentApprovals : []).slice(0, 20).map((a: any) => (
                            <div key={String(a.id || '')} className="bg-slate-50 dark:bg-slate-800/60 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700/60">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="text-[10px] font-black text-slate-700 dark:text-slate-200 break-words">{String(a.summary || a.action || '')}</div>
                                  <div className="mt-1 text-[10px] text-slate-500 dark:text-slate-400 font-mono break-all">{String(a.id || '')}</div>
                                </div>
                                <div className="flex gap-2 shrink-0">
                                  <button
                                    onClick={async () => {
                                      const api = (window as any).electronAPI;
                                      if (!api?.agentApprovals?.decide) return;
                                      setAgentBusy(true);
                                      try {
                                        await api.agentApprovals.decide({ id: a.id, decision: 'approved', grantScopeKey: a.scopeKey || '' });
                                        await refreshAgentControls();
                                      } finally {
                                        setAgentBusy(false);
                                      }
                                    }}
                                    disabled={agentBusy}
                                    className="px-3 py-2 rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300 text-[10px] font-black hover:bg-green-100 dark:hover:bg-green-900/30 transition-colors disabled:opacity-50"
                                  >
                                    允许
                                  </button>
                                  <button
                                    onClick={async () => {
                                      const api = (window as any).electronAPI;
                                      if (!api?.agentApprovals?.decide) return;
                                      setAgentBusy(true);
                                      try {
                                        await api.agentApprovals.decide({ id: a.id, decision: 'denied' });
                                        await refreshAgentControls();
                                      } finally {
                                        setAgentBusy(false);
                                      }
                                    }}
                                    disabled={agentBusy}
                                    className="px-3 py-2 rounded-lg bg-red-500/10 text-red-600 dark:text-red-300 hover:bg-red-500 hover:text-white text-[10px] font-black transition-colors disabled:opacity-50"
                                  >
                                    拒绝
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                          {(Array.isArray(agentApprovals) ? agentApprovals.length : 0) === 0 && (
                            <div className="text-[10px] text-slate-400 dark:text-slate-500">暂无待审批请求</div>
                          )}
                        </div>
                      </div>

                      <div className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700/60">
                        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-2">OpenClaw（使用）</div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                          * 直接在 AI 助手 → OpenClaw 进入内嵌工作台（推荐）。
                        </div>
                        <div className="mt-3 flex gap-2">
                          <button
                            onClick={() => {
                              onNavigateTo('OpenClaw');
                              onClose();
                            }}
                            disabled={openclawBusy}
                            className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black transition-all disabled:opacity-50"
                          >
                            打开 OpenClaw 工作台
                          </button>
                          <button
                            onClick={async () => {
                              const api = (window as any).electronAPI?.marketplace;
                              if (!api?.installBundledPlugin) return;
                              setOpenclawBusy(true);
                              try {
                                const res = await api.installBundledPlugin('openclaw-console');
                                const okInstalled = !!res?.success || String(res?.error || '').toLowerCase().includes('already installed');
                                if (!okInstalled) {
                                  alert(`❌ 安装失败：${res?.error || 'Unknown error'}`);
                                  return;
                                }
                                try { window.dispatchEvent(new Event('plugins-updated')); } catch (e) {}
                                onNavigateTo('AITools');
                                onNavigateTo('Plugin:ngo.openclaw.console');
                                onClose();
                              } finally {
                                setOpenclawBusy(false);
                              }
                            }}
                            disabled={openclawBusy}
                            className="flex-1 py-2.5 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-black border border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all disabled:opacity-50"
                          >
                            安装并打开控制台（高级）
                          </button>
                        </div>
                      </div>
                      </div>
                    </div>
                  </div>
                </div>
                )}

                {marketSection === 'Plugins' && (
                  <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                    <section className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5">
                      <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <span>🧩</span> 插件管理
                      </label>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                        * 插件为可执行代码，建议仅安装可信来源。默认可启用/停用/卸载，并可打开存放目录进行彻底清理。
                      </div>
                      <div className="mt-4 flex gap-2">
                        <button
                          onClick={async () => {
                            const dir = await (window as any).electronAPI?.fs?.selectFolder?.();
                            if (!dir) return;
                            const api = (window as any).electronAPI?.marketplace;
                            if (!api?.installPluginFromDir) return;
                            setMarketBusy(true);
                            try {
                              const res = await api.installPluginFromDir(dir);
                              if (!res?.success) alert(`❌ 安装失败：${res?.error || 'Unknown error'}`);
                              await refreshMarketplace();
                              window.dispatchEvent(new Event('plugins-updated'));
                            } finally {
                              setMarketBusy(false);
                            }
                          }}
                          disabled={marketBusy}
                          className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black transition-all disabled:opacity-50"
                        >
                          安装本地插件
                        </button>
                        <button
                          onClick={async () => {
                            const p = marketLocations?.pluginsDir;
                            if (!p) return;
                            await (window as any).electronAPI?.shell?.openPath?.(p);
                          }}
                          disabled={!marketLocations?.pluginsDir}
                          className="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-black border border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all disabled:opacity-50"
                        >
                          打开插件目录
                        </button>
                      </div>

                      <div className="mt-4 space-y-2">
                        {(marketPlugins || []).map((p: any) => (
                          <div key={p.id} className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700/60">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-xs font-black text-slate-800 dark:text-white truncate">
                                  {p.name || p.id} <span className="text-[10px] text-slate-400 font-mono">{p.version || ''}</span>
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 break-words">{p.description || ''}</div>
                                <div className="mt-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 break-all">{p.path || ''}</div>
                              </div>
                              <div className="flex flex-col gap-2 shrink-0">
                                <button
                                  onClick={async () => {
                                    const api = (window as any).electronAPI?.marketplace;
                                    if (!api?.setPluginEnabled) return;
                                    setMarketBusy(true);
                                    try {
                                      const res = await api.setPluginEnabled(p.id, !p.enabled);
                                      if (!res?.success) alert(`❌ 操作失败：${res?.error || 'Unknown error'}`);
                                      await refreshMarketplace();
                                      window.dispatchEvent(new Event('plugins-updated'));
                                    } finally {
                                      setMarketBusy(false);
                                    }
                                  }}
                                  disabled={marketBusy}
                                  className={`px-3 py-2 rounded-lg text-[10px] font-black transition-colors ${p.enabled ? 'bg-amber-50 text-amber-700 hover:bg-amber-100' : 'bg-green-50 text-green-700 hover:bg-green-100'} disabled:opacity-50`}
                                >
                                  {p.enabled ? '停用' : '启用'}
                                </button>
                                <button
                                  onClick={async () => {
                                    if (!p.path) return;
                                    await (window as any).electronAPI?.shell?.openPath?.(p.path);
                                  }}
                                  className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[10px] font-black hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                                >
                                  打开
                                </button>
                                <button
                                  onClick={async () => {
                                    const ok = confirm('确认卸载该插件？将删除插件目录。');
                                    if (!ok) return;
                                    const api = (window as any).electronAPI?.marketplace;
                                    if (!api?.uninstallPlugin) return;
                                    setMarketBusy(true);
                                    try {
                                      const res = await api.uninstallPlugin(p.id);
                                      if (!res?.success) alert(`❌ 卸载失败：${res?.error || 'Unknown error'}`);
                                      await refreshMarketplace();
                                      window.dispatchEvent(new Event('plugins-updated'));
                                    } finally {
                                      setMarketBusy(false);
                                    }
                                  }}
                                  disabled={marketBusy}
                                  className="px-3 py-2 rounded-lg bg-red-500/10 text-red-600 hover:bg-red-500 hover:text-white text-[10px] font-black transition-colors disabled:opacity-50"
                                >
                                  卸载
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                        {(!marketPlugins || marketPlugins.length === 0) && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">暂无已安装插件</div>
                        )}
                      </div>
                    </section>
                  </div>
                )}

                {marketSection === 'Tools' && (
                  <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar space-y-6">
                    <section className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5">
                      <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <span>🧰</span> 可复用脚本工具
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={async () => {
                            const dir = await (window as any).electronAPI?.fs?.selectFolder?.();
                            if (!dir) return;
                            const api = (window as any).electronAPI?.marketplace;
                            if (!api?.importSkillFromDir) return;
                            setMarketBusy(true);
                            try {
                              const res = await api.importSkillFromDir(dir);
                              if (!res?.success) alert(`❌ 导入失败：${res?.error || 'Unknown error'}`);
                              await refreshMarketplace();
                            } finally {
                              setMarketBusy(false);
                            }
                          }}
                          disabled={marketBusy}
                          className="px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black transition-all disabled:opacity-50"
                        >
                          导入 SKILL 目录
                        </button>
                        <button
                          onClick={async () => {
                            const p = marketLocations?.toolsSkills;
                            if (!p) return;
                            await (window as any).electronAPI?.shell?.openPath?.(p);
                          }}
                          disabled={!marketLocations?.toolsSkills}
                          className="px-4 py-2.5 rounded-xl bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 text-xs font-black border border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-800 transition-all disabled:opacity-50"
                        >
                          打开工具目录
                        </button>
                      </div>

                      <div className="mt-4 space-y-2">
                        {(marketSkills?.tools || []).map((s: any) => (
                          <div key={s.id} className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700/60">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-xs font-black text-slate-800 dark:text-white truncate">
                                  {s.name || '未命名'} {!s.valid && <span className="ml-2 text-[10px] text-red-500 font-black">格式不完整</span>}
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 break-words">{s.description || ''}</div>
                                <div className="mt-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 break-all">{s.dir}</div>
                              </div>
                              <div className="flex flex-col gap-2 shrink-0">
                                <button
                                  onClick={async () => await (window as any).electronAPI?.shell?.openPath?.(s.dir)}
                                  className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[10px] font-black hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                                >
                                  打开
                                </button>
                                <button
                                  onClick={async () => {
                                    const ok = confirm('确认删除该工具？将删除其目录。');
                                    if (!ok) return;
                                    const api = (window as any).electronAPI?.marketplace;
                                    if (!api?.deleteSkill) return;
                                    setMarketBusy(true);
                                    try {
                                      const res = await api.deleteSkill(s.dir);
                                      if (!res?.success) alert(`❌ 删除失败：${res?.error || 'Unknown error'}`);
                                      await refreshMarketplace();
                                    } finally {
                                      setMarketBusy(false);
                                    }
                                  }}
                                  disabled={marketBusy}
                                  className="px-3 py-2 rounded-lg bg-red-500/10 text-red-600 hover:bg-red-500 hover:text-white text-[10px] font-black transition-colors disabled:opacity-50"
                                >
                                  删除
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                        {(!marketSkills?.tools || marketSkills.tools.length === 0) && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">暂无可复用工具</div>
                        )}
                      </div>
                    </section>

                    <section className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5">
                      <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <span>📝</span> 草稿（一次性→可复用）
                      </label>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                        * 草稿来自 OpenClaw workspace 或本地草稿区，可一键提升为“脚本工具”以供复用。
                      </div>
                      <div className="mt-4 space-y-2">
                        {(marketSkills?.drafts || []).map((s: any) => (
                          <div key={s.id} className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700/60">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-xs font-black text-slate-800 dark:text-white truncate">
                                  {s.name || '未命名'} {!s.valid && <span className="ml-2 text-[10px] text-red-500 font-black">缺少 SKILL.md</span>}
                                </div>
                                <div className="text-[10px] text-slate-500 dark:text-slate-400 break-words">{s.description || ''}</div>
                                <div className="mt-1 text-[10px] font-mono text-slate-500 dark:text-slate-400 break-all">{s.dir}</div>
                              </div>
                              <div className="flex flex-col gap-2 shrink-0">
                                <button
                                  onClick={async () => await (window as any).electronAPI?.shell?.openPath?.(s.dir)}
                                  className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[10px] font-black hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                                >
                                  打开
                                </button>
                                <button
                                  onClick={async () => {
                                    const api = (window as any).electronAPI?.marketplace;
                                    if (!api?.promoteSkill) return;
                                    setMarketBusy(true);
                                    try {
                                      const res = await api.promoteSkill(s.dir);
                                      if (!res?.success) alert(`❌ 提升失败：${res?.error || 'Unknown error'}`);
                                      await refreshMarketplace();
                                    } finally {
                                      setMarketBusy(false);
                                    }
                                  }}
                                  disabled={marketBusy || !s.valid}
                                  className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[10px] font-black transition-colors disabled:opacity-50"
                                >
                                  提升为工具
                                </button>
                                <button
                                  onClick={async () => {
                                    const ok = confirm('确认删除该草稿？将删除其目录。');
                                    if (!ok) return;
                                    const api = (window as any).electronAPI?.marketplace;
                                    if (!api?.deleteSkill) return;
                                    setMarketBusy(true);
                                    try {
                                      const res = await api.deleteSkill(s.dir);
                                      if (!res?.success) alert(`❌ 删除失败：${res?.error || 'Unknown error'}`);
                                      await refreshMarketplace();
                                    } finally {
                                      setMarketBusy(false);
                                    }
                                  }}
                                  disabled={marketBusy}
                                  className="px-3 py-2 rounded-lg bg-red-500/10 text-red-600 hover:bg-red-500 hover:text-white text-[10px] font-black transition-colors disabled:opacity-50"
                                >
                                  删除
                                </button>
                              </div>
                            </div>
                          </div>
                        ))}
                        {(!marketSkills?.drafts || marketSkills.drafts.length === 0) && (
                          <div className="text-[10px] text-slate-500 dark:text-slate-400">暂无草稿</div>
                        )}
                      </div>
                    </section>
                  </div>
                )}

                {marketSection === 'Locations' && (
                  <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                    <section className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-5">
                      <label className="block text-[10px] font-black text-slate-400 dark:text-slate-500 uppercase tracking-widest mb-3 flex items-center gap-2">
                        <span>📍</span> 存放位置
                      </label>
                      <div className="text-[10px] text-slate-400 dark:text-slate-500 leading-relaxed">
                        * 所有插件与工具尽量存放在 userData 下，便于暂停使用、卸载与彻底清理。
                      </div>
                      <div className="mt-4 space-y-2">
                        {[
                          { label: 'UserData', value: marketLocations?.userData },
                          { label: '插件目录', value: marketLocations?.pluginsDir },
                          { label: 'OpenClaw 托管目录', value: marketLocations?.openclawManagedRoot },
                          { label: 'OpenClaw HOME（隔离）', value: marketLocations?.openclawHome },
                          { label: 'OpenClaw workspace', value: marketLocations?.openclawWorkspace },
                          { label: 'OpenClaw workspace/skills', value: marketLocations?.openclawWorkspaceSkills },
                          { label: '市场根目录', value: marketLocations?.marketplaceRoot },
                          { label: '工具目录', value: marketLocations?.toolsSkills },
                          { label: '草稿目录', value: marketLocations?.draftsSkills }
                        ].filter((x) => !!x.value).map((x) => (
                          <div key={x.label} className="bg-white dark:bg-slate-900 rounded-xl p-3 border border-slate-200/60 dark:border-slate-700/60">
                            <div className="flex items-center justify-between gap-3">
                              <div className="min-w-0">
                                <div className="text-[10px] font-black text-slate-500 dark:text-slate-400">{x.label}</div>
                                <div className="mt-1 text-[10px] font-mono break-all text-slate-700 dark:text-slate-200">{x.value}</div>
                              </div>
                              <button
                                onClick={async () => await (window as any).electronAPI?.shell?.openPath?.(String(x.value))}
                                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-[10px] font-black hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors shrink-0"
                              >
                                打开
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>
                  </div>
                )}

                {openclawWizard && (
                  <div className="absolute inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
                    <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200/60 dark:border-slate-700/60 overflow-hidden">
                      <div className="p-5 border-b border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between">
                        <div className="text-sm font-black text-slate-800 dark:text-white">
                          {openclawWizard === 'install' ? '安装 / 升级 OpenClaw' : '卸载 OpenClaw（托管安装）'}
                        </div>
                        <button
                          onClick={() => setOpenclawWizard(null)}
                          className="px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-black hover:bg-slate-200 dark:hover:bg-slate-700"
                        >
                          关闭
                        </button>
                      </div>

                      <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto custom-scrollbar">
                        {openclawWizard === 'install' && (
                          <div className="space-y-4">
                            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                              <div className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">组件</div>
                              <div className="mt-3 space-y-2">
                                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                                  <input type="checkbox" checked readOnly className="accent-indigo-600" />
                                  OpenClaw 核心服务（托管）
                                </label>
                                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                                  <input type="checkbox" checked readOnly className="accent-indigo-600" />
                                  NGO Planner 受控桥接技能（本地回环）
                                </label>
                              </div>
                            </div>

                            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                              <div className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">版本</div>
                              <div className="mt-3 space-y-2">
                                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                                  <input
                                    type="radio"
                                    name="openclaw-ver"
                                    checked={openclawUseLatest}
                                    onChange={() => {
                                      setOpenclawUseLatest(true);
                                      setOpenclawDesiredVersion('latest');
                                    }}
                                    className="accent-indigo-600"
                                  />
                                  跟随最新（latest）
                                </label>
                                <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                                  <input
                                    type="radio"
                                    name="openclaw-ver"
                                    checked={!openclawUseLatest}
                                    onChange={() => {
                                      setOpenclawUseLatest(false);
                                      if (openclawDesiredVersion === 'latest') setOpenclawDesiredVersion('');
                                    }}
                                    className="accent-indigo-600"
                                  />
                                  固定版本
                                </label>
                                {!openclawUseLatest && (
                                  <input
                                    value={openclawDesiredVersion}
                                    onChange={(e) => setOpenclawDesiredVersion(e.target.value)}
                                    placeholder="例如：1.2.3"
                                    className="w-full mt-2 bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-700/60 rounded-lg px-3 py-2 text-xs font-bold outline-none focus:ring-2 focus:ring-indigo-500/20 dark:text-white font-mono"
                                  />
                                )}
                                <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                  默认不复用系统 Node，避免版本不一致导致不可控；OpenClaw 运行状态与配置将隔离在应用托管目录中。
                                </div>
                              </div>
                            </div>

                            <div className="bg-amber-50/70 dark:bg-amber-900/10 rounded-xl p-4 border border-amber-200/60 dark:border-amber-800/40">
                              <div className="text-[10px] font-black text-amber-700 dark:text-amber-300">协议与风险确认</div>
                              <div className="mt-2 space-y-2">
                                <label className="flex items-start gap-2 text-xs font-bold text-amber-900/80 dark:text-amber-200/80">
                                  <input
                                    type="checkbox"
                                    checked={openclawAgreeTerms}
                                    onChange={(e) => setOpenclawAgreeTerms(e.target.checked)}
                                    className="mt-0.5 accent-amber-600"
                                  />
                                  <span>
                                    我理解 OpenClaw 为第三方组件，需遵守其许可与条款（
                                    <a href="https://github.com/openclaw/openclaw" target="_blank" rel="noreferrer" className="underline">
                                      查看项目主页
                                    </a>
                                    ）
                                  </span>
                                </label>
                                <label className="flex items-start gap-2 text-xs font-bold text-amber-900/80 dark:text-amber-200/80">
                                  <input
                                    type="checkbox"
                                    checked={openclawAgreeRisk}
                                    onChange={(e) => setOpenclawAgreeRisk(e.target.checked)}
                                    className="mt-0.5 accent-amber-600"
                                  />
                                  <span>我理解自动化代理可能进行文件/网络操作，并同意自行承担使用风险</span>
                                </label>
                              </div>
                            </div>

                            {(openclawInstallWorking || openclawInstallState) && (
                              <div className="bg-white dark:bg-slate-900 rounded-xl p-4 border border-slate-200/60 dark:border-slate-700/60">
                                <div className="flex items-center justify-between">
                                  <div className="text-[10px] font-black text-slate-500 dark:text-slate-400">安装进度</div>
                                  <div className="text-[10px] font-mono text-slate-600 dark:text-slate-300">
                                    {Math.round((openclawInstallProgress || 0) * 100)}%
                                  </div>
                                </div>
                                <div className="mt-2 h-2 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                  <div className="h-full bg-indigo-600" style={{ width: `${Math.round((openclawInstallProgress || 0) * 100)}%` }} />
                                </div>
                                <div className="mt-2 text-[10px] text-slate-500 dark:text-slate-400">
                                  {openclawInstallState?.message || openclawInstallState?.step || '准备中...'}（已用时 {openclawInstallState?.elapsedText || '0s'}）
                                </div>
                                {Array.isArray(openclawInstallState?.tail) && openclawInstallState.tail.length > 0 && (
                                  <pre className="mt-2 text-[10px] font-mono whitespace-pre-wrap break-words text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 rounded-lg p-2 max-h-24 overflow-y-auto custom-scrollbar">
                                    {openclawInstallState.tail.slice(-6).join('\n')}
                                  </pre>
                                )}
                                {openclawInstallState?.stuckHint && (
                                  <div className="mt-2 text-[10px] text-amber-600 dark:text-amber-300 leading-relaxed">
                                    进度长时间未变化通常是 npm 解析/下载依赖或网络较慢导致。可尝试取消后重试，或使用离线资源随包安装。日志：{openclawInstallState?.logPath || '未知'}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {openclawWizard === 'uninstall' && (
                          <div className="space-y-4">
                            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-4">
                              <div className="text-[10px] font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest">将清理内容</div>
                              <div className="mt-3 space-y-2 text-xs font-bold text-slate-700 dark:text-slate-200">
                                <div className="text-[10px] font-black text-slate-500 dark:text-slate-400">目录</div>
                                <div className="text-[10px] font-mono break-all text-slate-600 dark:text-slate-300">
                                  {openclawManagedStatus?.installRoot || 'openclaw-managed（未知路径）'}
                                </div>
                                {Array.isArray(openclawManagedStatus?.backups) && openclawManagedStatus.backups.length > 0 && (
                                  <div className="mt-2">
                                    <div className="text-[10px] font-black text-slate-500 dark:text-slate-400">备份</div>
                                    <pre className="text-[10px] font-mono whitespace-pre-wrap break-all text-slate-600 dark:text-slate-300">
                                      {openclawManagedStatus.backups.join('\n')}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            </div>

                            <div className="bg-red-500/10 rounded-xl p-4 border border-red-500/20">
                              <div className="text-[10px] font-black text-red-600">注意</div>
                              <div className="mt-2 text-[10px] text-red-600/90 leading-relaxed">
                                卸载将移除托管 OpenClaw 与其隔离配置，并清空本应用保存的 OpenClaw Bridge Token、端口与版本信息。不会删除你的项目数据。
                              </div>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="p-5 border-t border-slate-200/60 dark:border-slate-700/60 flex gap-2">
                        <button
                          onClick={() => setOpenclawWizard(null)}
                          className="flex-1 py-2.5 rounded-xl bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-black border border-slate-200/60 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-700"
                        >
                          取消
                        </button>

                        {openclawWizard === 'install' && (
                          <>
                          {openclawInstallWorking && (
                            <button
                              onClick={async () => {
                                const api = (window as any).electronAPI?.openclaw;
                                if (!api?.managed?.cancel) return;
                                try {
                                  await api.managed.cancel();
                                } catch (e) {}
                                setOpenclawInstallWorking(false);
                              }}
                              className="flex-1 py-2.5 rounded-xl bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white text-xs font-black transition-all border border-red-500/20"
                            >
                              取消安装
                            </button>
                          )}
                          <button
                            onClick={async () => {
                              const api = (window as any).electronAPI?.openclaw;
                              if (!api?.managed?.install) return;

                              const ver = openclawUseLatest ? 'latest' : String(openclawDesiredVersion || '').trim();
                              if (!ver) { alert('请填写固定版本号'); return; }
                              if (!openclawAgreeTerms || !openclawAgreeRisk) { alert('请先勾选协议与风险确认'); return; }

                              setOpenclawInstallWorking(true);
                              setOpenclawInstallProgress(0);
                              try {
                                const res = await api.managed.install({ openclawVersion: ver });
                                if (!res?.success) {
                                  alert(`❌ 安装失败：${res?.error || 'Unknown error'}`);
                                  setOpenclawInstallWorking(false);
                                } else {
                                  setOpenclawInstallState({ step: 'init', message: '已开始安装…', progress: 0 });
                                }
                              } catch (e: any) {
                                alert(`❌ 安装失败：${e?.message || 'Unknown error'}`);
                                setOpenclawInstallWorking(false);
                              }
                            }}
                            disabled={openclawInstallWorking}
                            className="flex-1 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black transition-all disabled:opacity-50"
                          >
                            {openclawInstallWorking ? '安装中...' : '开始安装'}
                          </button>
                          </>
                        )}

                        {openclawWizard === 'uninstall' && (
                          <button
                            onClick={async () => {
                              const api = (window as any).electronAPI?.openclaw;
                              if (!api?.managed?.uninstall) return;
                              const ok = confirm('确认卸载并清理托管 OpenClaw？');
                              if (!ok) return;
                              setOpenclawInstallWorking(true);
                              try {
                                const res = await api.managed.uninstall();
                                if (!res?.success) {
                                  alert(`❌ 卸载失败：${res?.error || 'Unknown error'}`);
                                } else {
                                  setOpenclawWizard(null);
                                }
                              } catch (e: any) {
                                alert(`❌ 卸载失败：${e?.message || 'Unknown error'}`);
                              } finally {
                                setOpenclawInstallWorking(false);
                                await refreshOpenClaw();
                              }
                            }}
                            disabled={openclawInstallWorking}
                            className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-xs font-black transition-all disabled:opacity-50"
                          >
                            {openclawInstallWorking ? '卸载中...' : '确认卸载'}
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'DigitalTwin' && (
              <div className="flex-1 p-8 overflow-y-auto custom-scrollbar">
                <div className="max-w-4xl mx-auto space-y-8">
                  {/* Header */}
                  <div className="text-center space-y-4">
                    <div className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl mx-auto flex items-center justify-center text-white shadow-xl shadow-indigo-500/30">
                      <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                    </div>
                    <div>
                      <h2 className="text-2xl font-black text-slate-800 dark:text-white tracking-tight">数字分身配置</h2>
                      <p className="text-slate-500 dark:text-slate-400 mt-2 font-medium">
                        基于您的时间（日历）、行动（项目）和知识（文档）数据，<br/>
                        智能识别您的身份角色，并自动为 AI 助手（OpenClaw/Claude Code）配置专属技能。
                      </p>
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className="flex justify-center">
                    <button
                      onClick={handleAnalyzeIdentity}
                      disabled={isAnalyzingIdentity}
                      className={`
                        px-8 py-4 rounded-2xl text-white font-bold text-lg shadow-xl hover:shadow-2xl hover:-translate-y-1 transition-all flex items-center gap-3
                        ${isAnalyzingIdentity ? 'bg-slate-400 cursor-not-allowed' : 'bg-gradient-to-r from-indigo-600 to-purple-600'}
                      `}
                    >
                      {isAnalyzingIdentity ? (
                        <>
                          <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                          <span>正在分析您的数字足迹...</span>
                        </>
                      ) : (
                        <>
                          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>
                          <span>一键生成技能配置</span>
                        </>
                      )}
                    </button>
                  </div>

                  {/* Results */}
                  {digitalTwinResult && (
                    <div className="animate-fade-in-up space-y-6">
                      <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-6 border border-slate-200 dark:border-slate-700">
                        <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-4">分析结果</h3>
                        <div className="grid grid-cols-3 gap-4 mb-6">
                          <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                            <div className="text-2xl font-black text-indigo-500">{digitalTwinResult.context?.projects?.length || 0}</div>
                            <div className="text-xs font-bold text-slate-400">活跃项目</div>
                          </div>
                          <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                            <div className="text-2xl font-black text-purple-500">{digitalTwinResult.context?.events?.length || 0}</div>
                            <div className="text-xs font-bold text-slate-400">近期日程</div>
                          </div>
                          <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-200 dark:border-slate-700">
                            <div className="text-2xl font-black text-emerald-500">{digitalTwinResult.context?.recentArtifacts?.length || 0}</div>
                            <div className="text-xs font-bold text-slate-400">知识库活跃</div>
                          </div>
                        </div>

                        <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest mb-4">已自动配置的技能</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          {digitalTwinResult.matchedSkills?.map((skill: any) => (
                            <div key={skill.id} className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-indigo-500/30 ring-1 ring-indigo-500/20 shadow-sm relative overflow-hidden group">
                              <div className="absolute top-0 right-0 p-2 opacity-50 group-hover:opacity-100 transition-opacity">
                                <span className="bg-emerald-500/10 text-emerald-500 text-[10px] font-bold px-2 py-1 rounded-full">已安装</span>
                              </div>
                              <div className="font-bold text-slate-800 dark:text-white mb-1">{skill.name}</div>
                              <div className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{skill.description}</div>
                              <div className="mt-3 flex flex-wrap gap-1">
                                {skill.tags?.map((tag: string) => (
                                  <span key={tag} className="text-[9px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded-md uppercase">{tag}</span>
                                ))}
                              </div>
                            </div>
                          ))}
                          {(!digitalTwinResult.matchedSkills || digitalTwinResult.matchedSkills.length === 0) && (
                            <div className="col-span-2 text-center py-8 text-slate-400 text-sm">
                              未找到匹配的特定技能，已配置通用助手能力。
                            </div>
                          )}
                        </div>
                        
                        <div className="mt-6 flex items-center gap-2 text-xs text-emerald-500 font-bold bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" /></svg>
                          配置已同步至 OpenClaw Workspace，AI 助手已就绪。
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'About' && (
              <div className="flex-1 flex flex-col items-center justify-center p-10 text-center animate-fade-in">
                 <div className="mb-8 transform hover:rotate-6 transition-transform cursor-pointer">
                    <img 
                        src="logo.png" 
                        alt="NGO Planner" 
                        className="w-32 h-32 object-contain drop-shadow-2xl"
                        onError={(e) => {
                            e.currentTarget.style.display = 'none';
                            e.currentTarget.nextElementSibling?.classList.remove('hidden');
                        }}
                    />
                    <div className="w-24 h-24 bg-gradient-to-br from-teal-400 to-indigo-600 rounded-[2rem] flex items-center justify-center text-5xl text-white font-black shadow-2xl border-4 border-white/20 hidden mx-auto">
                        N
                    </div>
                 </div>
                 <h3 className="text-3xl font-black text-slate-800 dark:text-white tracking-tight">NGO Planner</h3>
                 <p className="text-xs text-indigo-400 font-bold uppercase tracking-[0.3em] mt-3 mb-10">Desktop UX 2.3.6 (Official)</p>
                 
                 <div className="grid grid-cols-2 gap-6 w-full max-w-lg mb-12">
                    <a href="https://shaunlinx.github.io/Shuanlinx-NGO-Planner/" target="_blank" className="p-6 bg-white dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-slate-700 border border-slate-100 dark:border-slate-700 hover:border-indigo-100 dark:hover:border-slate-600 hover:shadow-xl rounded-2xl transition-all group">
                        <div className="text-3xl mb-3 group-hover:scale-110 transition-transform">🌐</div>
                        <div className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider">官方网站</div>
                    </a>
                    <a href="#" className="p-6 bg-white dark:bg-slate-800 hover:bg-indigo-50 dark:hover:bg-slate-700 border border-slate-100 dark:border-slate-700 hover:border-indigo-100 dark:hover:border-slate-600 hover:shadow-xl rounded-2xl transition-all group">
                        <div className="text-3xl mb-3 group-hover:scale-110 transition-transform">📘</div>
                        <div className="text-xs font-black text-slate-700 dark:text-slate-300 uppercase tracking-wider">使用文档</div>
                    </a>
                 </div>
                 
                 <p className="text-[10px] text-slate-300 dark:text-slate-600 font-bold uppercase tracking-[0.2em] border-t border-slate-50 dark:border-slate-800 pt-8 w-full max-w-xs">Designed for Non-Profit Efficiency</p>
              </div>
            )}
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
