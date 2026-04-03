
import React, { useState, useEffect } from 'react';
import { isDesktopApp } from '../utils/platformUtils';

interface WarehouseSetupModalProps {
  onConfirm: (path: string, createSubfolders: boolean) => void;
  onLogout?: () => void;
}

const WarehouseSetupModal: React.FC<WarehouseSetupModalProps> = ({ onConfirm, onLogout }) => {
  const isDesktop = isDesktopApp();
  // Detect OS for better default path
  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  
  const [path, setPath] = useState('');
  const [createSubfolders, setCreateSubfolders] = useState(true);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (path.trim()) {
      let finalPath = path.trim();
      // Ensure trailing slash for consistency
      if (!finalPath.endsWith('/') && !finalPath.endsWith('\\')) {
          finalPath += '/';
      }
      onConfirm(finalPath, createSubfolders);
    }
  };

  const handleBrowse = async () => {
      if ((window as any).electronAPI?.fs?.selectFolder) {
          const selected = await (window as any).electronAPI.fs.selectFolder();
          if (selected) {
              // Ensure trailing slash
              const finalPath = (selected.endsWith('/') || selected.endsWith('\\')) ? selected : `${selected}/`;
              setPath(finalPath);
          }
      } else {
          alert("浏览功能仅在桌面版可用");
      }
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[80] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1100px] h-[640px] flex overflow-hidden animate-fade-in-up border border-white/50">
        
        {/* Left Side: Decorative & Context */}
        <div className="w-[320px] bg-gradient-to-br from-teal-900 to-teal-800 text-white p-8 flex flex-col justify-between relative overflow-hidden shrink-0">
            {/* Decorative Background Elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-emerald-500/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2"></div>
            <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

            <div className="relative z-10">
                <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center font-bold backdrop-blur-sm text-white text-xl">2</div>
                    <span className="font-bold text-xl tracking-wide opacity-90">Warehouse</span>
                </div>
                
                <div className="mb-8">
                     <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 text-xs font-bold text-teal-100">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse"></span>
                        Step 2 / 4
                     </div>
                     <h2 className="text-3xl font-black mt-4 leading-tight tracking-tight">
                         配置本地<br/>
                         <span className="text-teal-200">数字仓库</span>
                     </h2>
                </div>
            </div>

            <div className="relative z-10">
                <p className="text-sm font-medium text-teal-100/80 leading-relaxed">
                    {isDesktop 
                        ? "我们将为您创建一个本地文件夹结构，用于安全存储所有的项目方案、票据和归档文件。" 
                        : "您当前正在使用网页版。此路径将作为「虚拟归档目录」用于生成规范的文件名。"}
                </p>
            </div>
        </div>

        {/* Right Side: Form Area */}
        <div className="flex-1 bg-white relative flex flex-col items-center justify-center p-12 overflow-y-auto custom-scrollbar">
             <div className="absolute top-6 right-6">
                  {onLogout && (
                      <button 
                          onClick={onLogout}
                          className="text-xs font-bold text-slate-400 hover:text-red-500 transition-colors flex items-center gap-1"
                      >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" /></svg>
                          重新登录
                      </button>
                  )}
             </div>

            <div className="w-full max-w-lg space-y-8">
                 <div className="text-center">
                    <div className="w-16 h-16 bg-teal-50 rounded-2xl flex items-center justify-center text-3xl mx-auto mb-4 shadow-sm text-teal-600">
                        📂
                    </div>
                    <h3 className="text-2xl font-black text-slate-800 mb-2">选择存储位置</h3>
                    <p className="text-sm text-slate-500 font-medium">请选择一个您拥有读写权限的本地文件夹</p>
                </div>

                <form onSubmit={handleSubmit} className="space-y-6">
                    <div>
                        <label className="block text-xs font-bold text-gray-400 uppercase mb-2 tracking-wider">
                        本地根目录路径 (绝对路径)
                        </label>
                        <div className="flex gap-2">
                            <input 
                            type="text" 
                            value={path}
                            onChange={e => setPath(e.target.value)}
                            className="flex-1 p-3.5 rounded-xl border border-gray-200 focus:border-teal-500 focus:ring-4 focus:ring-teal-500/10 outline-none font-mono text-sm font-bold text-slate-700 transition-all"
                            placeholder={isMac ? "/Users/yourname/Documents/NGO/" : "D:/NGO_Projects/"}
                            autoFocus
                            />
                            {isDesktop && (
                                <button 
                                    type="button"
                                    onClick={handleBrowse}
                                    className="px-6 py-3.5 bg-slate-50 text-slate-700 rounded-xl border border-slate-200 hover:bg-slate-100 hover:border-slate-300 font-bold text-sm transition-all whitespace-nowrap shadow-sm active:scale-95"
                                >
                                    📂 浏览...
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="bg-slate-50 p-5 rounded-xl border border-slate-100">
                        <div className="flex items-start gap-4">
                            <div className="relative flex items-center">
                                <input 
                                    type="checkbox" 
                                    id="subfolders"
                                    checked={createSubfolders}
                                    onChange={e => setCreateSubfolders(e.target.checked)}
                                    className="w-5 h-5 text-teal-600 border-gray-300 rounded focus:ring-teal-500 transition-all cursor-pointer"
                                />
                            </div>
                            <div className="flex-1">
                                <label htmlFor="subfolders" className="text-sm font-bold text-slate-700 cursor-pointer block mb-1">自动规划子目录结构</label>
                                <p className="text-xs text-slate-500 leading-relaxed mb-3">
                                    开启后，每次新建项目时将自动创建标准化的文件夹结构：
                                </p>
                                <div className="text-[10px] text-slate-500 font-mono bg-white p-3 rounded-lg border border-slate-200/60 shadow-sm">
                                    <div>📂 {path || '.../'}ProjectName/</div>
                                    <div className="pl-4 text-slate-400">├── 📄 Docs (文档)</div>
                                    <div className="pl-4 text-slate-400">├── 📷 Images (图片)</div>
                                    <div className="pl-4 text-slate-400">├── 📦 Archive (归档)</div>
                                    <div className="pl-4 text-slate-400">└── ...</div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <button 
                        type="submit" 
                        className="w-full bg-teal-600 hover:bg-teal-700 text-white font-bold py-3.5 rounded-xl shadow-xl shadow-teal-200 transition-all transform active:scale-[0.98] flex justify-center items-center gap-2 mt-4"
                    >
                        <span>确认并继续</span>
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>
                </form>
            </div>
        </div>
      </div>
    </div>
  );
};

export default WarehouseSetupModal;
