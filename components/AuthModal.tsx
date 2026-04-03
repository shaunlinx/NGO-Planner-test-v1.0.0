import React, { useState, useEffect } from 'react';
import { authLogin, authRegister, activateMembership } from '../services/geminiService';
import { isDesktopApp } from '../utils/platformUtils';
import { DEFAULT_API_BASE_URL, DEEPSEEK_API_URL } from '../constants';
import { DeepSeekProvider } from '../services/llm/DeepSeekProvider';
import { GeminiProvider } from '../services/llm/GeminiProvider';
import { AIProvider } from '../types';

interface AuthModalProps {
  onLoginSuccess: (username: string) => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ onLoginSuccess }) => {
  const isDesktop = isDesktopApp();
  
  // Detect if on Mobile to show helpful hints
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
      setIsMobile(window.innerWidth < 768);
  }, []);

  // Typewriter Animation State
  const [typedText, setTypedText] = useState('');
  const fullSlogan = "让AI解放的人，去爱具体的人";

  useEffect(() => {
      let index = 0;
      setTypedText(''); // Reset
      const timer = setInterval(() => {
          if (index < fullSlogan.length) {
              setTypedText(prev => fullSlogan.slice(0, index + 1));
              index++;
          } else {
              clearInterval(timer);
          }
      }, 150); // Typing speed
      return () => clearInterval(timer);
  }, []);

  // Default mode: If desktop, force API_KEY mode initially
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER' | 'API_KEY' | 'ACTIVATE'>(isDesktop ? 'API_KEY' : 'LOGIN');

  // Login/Register State
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  
  // API Key State
  const [provider, setProvider] = useState<AIProvider>('DeepSeek'); // Default to DeepSeek as per request
  const [deepseekKey, setDeepseekKey] = useState('');
  const [googleKey, setGoogleKey] = useState('');
  const [deepseekModel, setDeepseekModel] = useState(localStorage.getItem('user_model_deepseek') || 'deepseek-chat');
  const [googleModel, setGoogleModel] = useState(localStorage.getItem('user_model_google') || 'gemini-2.0-flash-exp');
  const [customBaseUrl, setCustomBaseUrl] = useState(''); 
  const [showAdvanced, setShowAdvanced] = useState(false); 
  const [rememberApi, setRememberApi] = useState(true);

  // Activation State
  const [activationCode, setActivationCode] = useState('');

  const [error, setError] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [loading, setLoading] = useState(false);

  // Load saved settings
  useEffect(() => {
      const savedBaseUrl = localStorage.getItem('user_base_url');
      if (savedBaseUrl) {
          setCustomBaseUrl(savedBaseUrl);
          setShowAdvanced(true);
      }
      
      // Load saved keys if they exist (pre-fill)
      const savedDsKey = localStorage.getItem('user_api_key_deepseek');
      if (savedDsKey) setDeepseekKey(savedDsKey);
      
      const savedGKey = localStorage.getItem('user_api_key_google');
      if (savedGKey) setGoogleKey(savedGKey);

      const savedRemember = localStorage.getItem('remember_api_config');
      if (savedRemember !== null) {
          setRememberApi(savedRemember === 'true');
      }
      
      const savedDsModel = localStorage.getItem('user_model_deepseek');
      if (savedDsModel) setDeepseekModel(savedDsModel);
      const savedGModel = localStorage.getItem('user_model_google');
      if (savedGModel) setGoogleModel(savedGModel);
  }, []);

  // Update defaults when provider changes
  useEffect(() => {
      if (provider === 'DeepSeek') {
          setCustomBaseUrl(DEEPSEEK_API_URL);
          setShowAdvanced(false); 
      } else {
          // Google
          const savedUrl = localStorage.getItem('user_base_url');
          setCustomBaseUrl(savedUrl || '');
      }
  }, [provider]);

  // Handle Standard Login/Register
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccessMsg('');
    setLoading(true);
    try {
        if (mode === 'LOGIN') {
            const data = await authLogin(username, password);
            localStorage.setItem('ngo_auth_token', data.token);
            localStorage.setItem('ngo_username', data.username);
            // Mark as authenticated
            localStorage.setItem('app_is_authenticated', 'true');

            if (data.isActive) {
                onLoginSuccess(data.username);
            } else {
                setMode('ACTIVATE');
                setSuccessMsg("登录成功，请激活您的会员资格");
            }
        } else if (mode === 'REGISTER') {
            await authRegister(username, password);
            setSuccessMsg("注册成功，请登录");
            setMode('LOGIN');
        }
    } catch (err) {
        // If fetch failed (e.g. 404 on static hosting), handle gracefully
        setError(mode === 'LOGIN' ? "登录失败：可能是网络问题或账号错误" : "注册失败：无法连接到服务器");
    } finally {
        setLoading(false);
    }
  };

  // Handle API Key Submit
  const handleKeySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const currentKey = provider === 'DeepSeek' ? deepseekKey : googleKey;
    const cleanedKey = currentKey.trim();
    const cleanedBaseUrl = customBaseUrl.trim();
    const modelId = (provider === 'DeepSeek' ? deepseekModel : googleModel).trim();
    
    // STRICT VALIDATION
    if (cleanedKey.length < 10) {
        setError("API Key 格式无效 (长度过短)。请检查您复制的 Key 是否完整。");
        return;
    }
    
    if (provider === 'Google' && !cleanedKey.startsWith('AIza')) {
         // Weak check for Google keys
    }

    if (provider === 'DeepSeek' && !cleanedKey.startsWith('sk-')) {
        setError("DeepSeek Key 通常以 'sk-' 开头。");
        return;
    }
    
    // Save Keys
    if ((window as any).electronAPI?.secure) {
        await (window as any).electronAPI.secure.set(`user_api_key_${provider.toLowerCase()}`, cleanedKey);
    } else {
        localStorage.setItem(`user_api_key_${provider.toLowerCase()}`, cleanedKey);
    }
    
    // Save Model ID
    localStorage.setItem(`user_model_${provider === 'DeepSeek' ? 'deepseek' : 'google'}`, modelId || '');
    
    // Also save the other key if present
    const otherProvider = provider === 'DeepSeek' ? 'google' : 'deepseek';
    const otherKey = provider === 'DeepSeek' ? googleKey : deepseekKey;
    if (otherKey.trim()) {
         if ((window as any).electronAPI?.secure) {
            await (window as any).electronAPI.secure.set(`user_api_key_${otherProvider}`, otherKey.trim());
        } else {
            localStorage.setItem(`user_api_key_${otherProvider}`, otherKey.trim());
        }
    }

    // Save Preference
    localStorage.setItem('user_provider', provider);
    localStorage.setItem('remember_api_config', String(rememberApi));
    try {
        if ((window as any).electronAPI?.db) {
            await (window as any).electronAPI.db.saveSetting('user_provider', provider);
            await (window as any).electronAPI.db.saveSetting('user_model_deepseek', deepseekModel.trim() || '');
            await (window as any).electronAPI.db.saveSetting('user_model_google', googleModel.trim() || '');
            await (window as any).electronAPI.db.saveSetting('user_base_url', cleanedBaseUrl || '');
        }
    } catch (e) {}
    
    // Mark as authenticated
    localStorage.setItem('app_is_authenticated', 'true');

    if (cleanedBaseUrl && cleanedBaseUrl !== DEEPSEEK_API_URL) {
        localStorage.setItem('user_base_url', cleanedBaseUrl);
    } else {
        localStorage.removeItem('user_base_url'); 
    }

    // Legacy cleanup
    localStorage.removeItem('ngo_auth_token'); 
    localStorage.removeItem('ngo_username');
    
    onLoginSuccess(`${provider} 用户`);
  };
  
  const [isTesting, setIsTesting] = useState(false);
  const handleTestProvider = async () => {
    setError('');
    setSuccessMsg('');
    const currentKey = provider === 'DeepSeek' ? deepseekKey : googleKey;
    const modelId = provider === 'DeepSeek' ? deepseekModel : googleModel;
    const cleanedKey = currentKey.trim();
    if (!cleanedKey) { setError('请先填写 API Key'); return; }
    if (!modelId.trim()) { setError('请填写模型型号'); return; }
    setIsTesting(true);
    try {
      // Temporarily save key for provider classes to read
      const keyName = `user_api_key_${provider.toLowerCase()}`;
      if ((window as any).electronAPI?.secure) {
        await (window as any).electronAPI.secure.set(keyName, cleanedKey);
      } else {
        localStorage.setItem(keyName, cleanedKey);
      }
      if (customBaseUrl.trim()) {
        localStorage.setItem('user_base_url', customBaseUrl.trim());
      }
      const providerInstance = provider === 'DeepSeek' ? new DeepSeekProvider() : new GeminiProvider();
      const res = await providerInstance.generateContent({ prompt: 'Hello', temperature: 0.1, model: modelId });
      setSuccessMsg('✅ 连接测试成功');
    } catch (e: any) {
      setError(`❌ 连接测试失败: ${e.message}`);
    } finally {
      setIsTesting(false);
    }
  };

  // Handle Activation
  const handleActivation = async (e: React.FormEvent) => {
      e.preventDefault();
      setLoading(true);
      setError('');
      try {
          await activateMembership(activationCode);
          onLoginSuccess(username); 
      } catch (e) {
          setError("激活失败：无效的激活码");
      } finally {
          setLoading(false);
      }
  };

  return (
    <div 
        className="fixed inset-0 z-[100] flex items-center justify-center p-4 font-sans"
        style={{
            background: 'linear-gradient(-45deg, #f1f5f9, #e2e8f0, #f8fafc, #f1f5f9)',
            backgroundSize: '400% 400%',
            animation: 'gradientBG 15s ease infinite'
        }}
    >
      <style>{`
        @keyframes gradientBG {
          0% { background-position: 0% 50%; }
          50% { background-position: 100% 50%; }
          100% { background-position: 0% 50%; }
        }
        .pixel-font {
            font-family: 'Courier New', Courier, monospace;
            letter-spacing: 0.1em;
            text-shadow: 1px 1px 0px rgba(0,0,0,0.1);
        }
      `}</style>

      {/* Standardized Split Container: 1100px x 640px */}
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1100px] h-[640px] flex overflow-hidden animate-fade-in-up border border-white/50">
        
        {/* Left Side: Decorative & Context */}
        <div className="w-[320px] bg-gradient-to-br from-slate-900 to-slate-800 text-white p-8 flex flex-col justify-between relative overflow-hidden shrink-0">
            {/* Decorative Background Elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-ngo-teal/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-indigo-500/10 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2"></div>
            <div className="absolute inset-0 opacity-5 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

            <div className="relative z-10">
                <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 bg-ngo-teal rounded-lg flex items-center justify-center font-bold shadow-lg shadow-ngo-teal/20 text-white text-xl">N</div>
                    <span className="font-bold text-xl tracking-wide opacity-90">NGO Planner</span>
                </div>
                
                {isDesktop && (
                    <div className="mb-8">
                         <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 text-xs font-bold text-indigo-200">
                            <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
                            Step 1 / 4
                         </div>
                         <h2 className="text-3xl font-black mt-4 leading-tight tracking-tight">
                             开启您的<br/>
                             <span className="text-transparent bg-clip-text bg-gradient-to-r from-ngo-teal to-indigo-400">公益 AI 之旅</span>
                         </h2>
                    </div>
                )}
            </div>

            <div className="relative z-10">
                 {/* Pixel Typewriter Animation */}
                <div className="bg-black/20 rounded-xl backdrop-blur-md border border-white/5 p-4 mb-4">
                    <p className="pixel-font text-indigo-200 text-xs font-bold leading-relaxed whitespace-pre-wrap min-h-[40px]">
                        {typedText}
                        <span className="animate-pulse inline-block w-2 h-4 bg-indigo-400 align-middle ml-1"></span>
                    </p>
                </div>
                <p className="text-[10px] text-slate-400 font-medium">
                    {isDesktop ? "本地安全运行 • 数据自主掌控" : "公益人专属的 AI 策划工作台"}
                </p>
            </div>
        </div>

        {/* Right Side: Form Area */}
        <div className="flex-1 bg-white relative flex flex-col items-center justify-center p-12 overflow-y-auto custom-scrollbar">
            <div className="w-full max-w-md space-y-8">
                <div className="text-center">
                    <h3 className="text-2xl font-black text-slate-800 mb-2">身份验证</h3>
                    <p className="text-sm text-slate-500 font-medium">请完成登录以访问您的工作台</p>
                </div>

                {/* Tabs - Hide in desktop mode, force API key */}
                {!isDesktop && mode !== 'ACTIVATE' && (
                    <div className="flex justify-center mb-6 border-b border-gray-100">
                        <button 
                            onClick={() => { setMode('API_KEY'); setError(''); setSuccessMsg(''); }}
                            className={`pb-2 px-4 font-bold text-sm transition-all border-b-2 ${mode === 'API_KEY' ? 'text-ngo-teal border-ngo-teal' : 'text-gray-400 border-transparent hover:text-gray-600'}`}
                        >
                            使用 API Key
                        </button>
                        <button 
                            onClick={() => { setMode('LOGIN'); setError(''); setSuccessMsg(''); }}
                            className={`pb-2 px-4 font-bold text-sm transition-all border-b-2 ${mode === 'LOGIN' || mode === 'REGISTER' ? 'text-ngo-teal border-ngo-teal' : 'text-gray-400 border-transparent hover:text-gray-600'}`}
                        >
                            账号登录
                        </button>
                    </div>
                )}

                {mode === 'ACTIVATE' && (
                     <div className="mb-6 text-center">
                        <h3 className="text-lg font-bold text-gray-800">💎 会员激活</h3>
                        <p className="text-xs text-gray-500 mt-1">请输入激活码以解锁云端资源</p>
                     </div>
                )}

                {/* ERROR / SUCCESS MESSAGES */}
                {error && <div className="bg-red-50 border border-red-100 text-red-500 text-xs p-3 rounded-lg mb-4 text-center font-medium animate-pulse">{error}</div>}
                {successMsg && <div className="bg-green-50 border border-green-100 text-green-600 text-xs p-3 rounded-lg mb-4 text-center font-medium">{successMsg}</div>}

                {/* FORM 1: LOGIN / REGISTER */}
                {!isDesktop && (mode === 'LOGIN' || mode === 'REGISTER') && (
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="bg-orange-50 border border-orange-100 p-2 rounded text-[10px] text-orange-700 mb-2 flex gap-2 items-start">
                            <span>ℹ️</span>
                            <span>注意：Web 版账号登录仅在部署了后端服务时可用。纯前端部署请使用 "API Key" 模式。</span>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">用户名</label>
                            <input 
                                type="text" 
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                className="w-full p-3 rounded-lg border border-gray-200 focus:border-ngo-teal focus:ring-2 focus:ring-ngo-teal/20 outline-none transition-all text-sm font-bold"
                                placeholder="请输入用户名"
                                required
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">密码</label>
                            <input 
                                type="password" 
                                value={password}
                                onChange={e => setPassword(e.target.value)}
                                className="w-full p-3 rounded-lg border border-gray-200 focus:border-ngo-teal focus:ring-2 focus:ring-ngo-teal/20 outline-none transition-all text-sm font-bold"
                                placeholder="请输入密码"
                                required
                            />
                        </div>

                        <button 
                            type="submit" 
                            disabled={loading}
                            className="w-full bg-gradient-to-r from-ngo-teal to-ngo-teal-dark hover:shadow-lg text-white font-bold py-3 rounded-lg transition-all disabled:opacity-70 mt-2 transform active:scale-95"
                        >
                            {loading ? "处理中..." : (mode === 'LOGIN' ? "登 录" : "注 册")}
                        </button>

                        <div className="text-center mt-4">
                            <button 
                                type="button"
                                onClick={() => setMode(mode === 'LOGIN' ? 'REGISTER' : 'LOGIN')}
                                className="text-xs text-gray-400 hover:text-ngo-teal underline"
                            >
                                {mode === 'LOGIN' ? "没有账号？点击注册" : "已有账号？点击登录"}
                            </button>
                        </div>
                    </form>
                )}

                {/* FORM 2: API KEY (Default/Only for Desktop) */}
                {mode === 'API_KEY' && (
                    <form onSubmit={handleKeySubmit} className="space-y-5">
                        {/* Mobile Hint for Provider Selection */}
                        {isMobile && provider === 'Google' && (
                            <div className="bg-indigo-50 p-2 rounded-lg border border-indigo-100 mb-2 text-[11px] text-indigo-800">
                                 💡 <b>移动端提示</b>: 在手机上直接使用 Google 服务可能会因网络问题报错。推荐切换到 <b>DeepSeek</b> 或在下方配置代理。
                            </div>
                        )}

                        <div className="bg-blue-50/50 p-3 rounded-lg border border-blue-100">
                            <p className="text-xs text-blue-600 leading-relaxed text-center font-medium">
                                {isDesktop 
                                 ? "桌面版本为纯本地运行模式。请填入 API Key 以启用 AI 功能。"
                                 : "建议输入您自己的 API Key，直接与模型交互，响应更快。"
                                }
                            </p>
                        </div>

                        {/* AI Provider Selection */}
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase mb-2 tracking-wider">AI 模型服务商</label>
                            <div className="grid grid-cols-2 gap-3">
                                 <button
                                    type="button"
                                    onClick={() => setProvider('DeepSeek')}
                                    className={`py-3 px-3 text-xs font-bold rounded-xl border transition-all flex flex-col items-center gap-1 ${provider === 'DeepSeek' ? 'bg-blue-600 text-white border-blue-600 shadow-md shadow-blue-200' : 'bg-white text-gray-500 border-gray-200 hover:border-blue-200 hover:text-blue-600'}`}
                                 >
                                    <span className="text-lg">🐋</span>
                                    DeepSeek (国内直连)
                                 </button>
                                 <button
                                    type="button"
                                    onClick={() => setProvider('Google')}
                                    className={`py-3 px-3 text-xs font-bold rounded-xl border transition-all flex flex-col items-center gap-1 ${provider === 'Google' ? 'bg-indigo-600 text-white border-indigo-600 shadow-md shadow-indigo-200' : 'bg-white text-gray-500 border-gray-200 hover:border-indigo-200 hover:text-indigo-600'}`}
                                 >
                                    <span className="text-lg">🌍</span>
                                    Google Gemini
                                 </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase mb-2 tracking-wider">
                                {provider} API Key <span className="text-red-500">*</span>
                            </label>
                            <input 
                                type="password" 
                                value={provider === 'DeepSeek' ? deepseekKey : googleKey}
                                onChange={e => provider === 'DeepSeek' ? setDeepseekKey(e.target.value) : setGoogleKey(e.target.value)}
                                className="w-full p-3.5 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none font-mono text-sm transition-all font-bold text-slate-700 placeholder-slate-300"
                                placeholder={provider === 'Google' ? "AIzaSy..." : "sk-..."}
                                required
                            />
                        </div>
                        
                        <div>
                            <label className="block text-xs font-bold text-gray-400 uppercase mb-2 tracking-wider">
                                模型型号 (Model ID)
                            </label>
                            <input
                                type="text"
                                value={provider === 'DeepSeek' ? deepseekModel : googleModel}
                                onChange={e => provider === 'DeepSeek' ? setDeepseekModel(e.target.value) : setGoogleModel(e.target.value)}
                                className="w-full p-3.5 rounded-xl border border-gray-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 outline-none font-mono text-sm transition-all font-bold text-slate-700 placeholder-slate-300"
                                placeholder={provider === 'Google' ? "例如: gemini-2.0-flash-exp" : "例如: deepseek-chat"}
                            />
                            <p className="text-[10px] text-gray-400 mt-1">可自定义最新型号，避免硬编码过时。</p>
                        </div>

                        {/* Remember API Checkbox */}
                        <div className="flex items-center gap-2">
                            <input 
                                type="checkbox" 
                                id="rememberApi"
                                checked={rememberApi}
                                onChange={e => setRememberApi(e.target.checked)}
                                className="w-4 h-4 rounded border-gray-300 text-ngo-teal focus:ring-ngo-teal"
                            />
                            <label htmlFor="rememberApi" className="text-xs text-gray-500 font-bold select-none cursor-pointer">
                                记住 API Key (退出后不清除)
                            </label>
                        </div>

                        {/* Advanced Settings Toggle */}
                        <div className="pt-2">
                            <button 
                                type="button"
                                onClick={() => setShowAdvanced(!showAdvanced)}
                                className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors font-bold"
                            >
                                {showAdvanced ? '▼' : '▶'} 高级设置 (代理配置)
                            </button>
                            
                            {showAdvanced && (
                                <div className="mt-3 animate-fade-in-up bg-slate-50 p-4 rounded-xl border border-slate-100">
                                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1">
                                        自定义代理地址 (Base URL)
                                    </label>
                                    <input 
                                        type="text" 
                                        value={customBaseUrl}
                                        onChange={e => setCustomBaseUrl(e.target.value)}
                                        className="w-full p-2.5 rounded-lg border border-gray-200 focus:border-indigo-500 outline-none font-mono text-xs bg-white font-medium"
                                        placeholder={provider === 'Google' ? (DEFAULT_API_BASE_URL || "https://generativelanguage.googleapis.com") : DEEPSEEK_API_URL}
                                    />
                                    <p className="text-[10px] text-gray-400 mt-2 leading-relaxed">
                                        {provider === 'Google' ? (
                                            <>若您在国内且无 VPN，请填入可用的反代地址。<span className="text-red-400">不要包含 /v1beta</span>。</>
                                        ) : (
                                            <>DeepSeek 默认无需配置，除非您使用第三方中转。</>
                                        )}
                                    </p>
                                </div>
                            )}
                        </div>

                        <button 
                            type="submit" 
                            className="w-full bg-slate-900 hover:bg-black text-white font-bold py-3.5 rounded-xl shadow-xl shadow-slate-200 transition-all mt-4 transform active:scale-[0.98] flex items-center justify-center gap-2"
                        >
                            <span>{isDesktop ? "开启本地工作台" : "进入工作台"}</span>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                        </button>
                        <button
                            type="button"
                            onClick={handleTestProvider}
                            disabled={isTesting}
                            className="w-full bg-blue-50 text-blue-600 font-bold py-3.5 rounded-xl shadow-sm transition-all mt-2 transform active:scale-[0.98]"
                        >
                            {isTesting ? '测试中...' : '🔌 测试连接 (API + Model)'}
                        </button>
                        <div className="text-center mt-3 flex justify-center gap-4">
                            {provider === 'Google' ? (
                                <a href="https://aistudio.google.com/app/apikey" target="_blank" className="text-xs text-indigo-400 hover:text-indigo-600 hover:underline font-bold">获取 Gemini Key &rarr;</a>
                            ) : (
                                <a href="https://platform.deepseek.com/" target="_blank" className="text-xs text-blue-400 hover:text-blue-600 hover:underline font-bold">获取 DeepSeek Key &rarr;</a>
                            )}
                        </div>
                    </form>
                )}

                {/* FORM 3: ACTIVATION */}
                {!isDesktop && mode === 'ACTIVATE' && (
                    <form onSubmit={handleActivation} className="space-y-4">
                         <div className="bg-yellow-50 p-3 rounded-lg border border-yellow-100 mb-4">
                            <p className="text-xs text-yellow-700 leading-relaxed text-center">
                                为了保障服务质量，使用托管资源需要验证会员身份。
                                <br/>演示激活码: <b>NGO2025</b>
                            </p>
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-gray-500 uppercase mb-1">激活码</label>
                            <input 
                                type="text" 
                                value={activationCode}
                                onChange={e => setActivationCode(e.target.value)}
                                className="w-full p-3 rounded-lg border border-gray-200 focus:border-ngo-teal focus:ring-2 focus:ring-ngo-teal/20 outline-none tracking-widest text-center font-bold text-lg"
                                placeholder="XXXXXX"
                                required
                            />
                        </div>
                        <button 
                            type="submit" 
                            disabled={loading}
                            className="w-full bg-ngo-teal hover:bg-ngo-teal-dark text-white font-bold py-3 rounded-lg shadow-lg shadow-ngo-teal/30 transition-all disabled:opacity-70 mt-2 transform active:scale-95"
                        >
                            {loading ? "验证中..." : "激活并进入"}
                        </button>
                    </form>
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default AuthModal;
