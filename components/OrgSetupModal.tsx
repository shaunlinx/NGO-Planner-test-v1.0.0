import React, { useState } from 'react';
import { OrgProfile } from '../types';
import { DOMAINS } from '../constants';

interface OrgSetupModalProps {
  onConfirm: (profile: OrgProfile) => void;
  onSkip: () => void;
}

const OrgSetupModal: React.FC<OrgSetupModalProps> = ({ onConfirm, onSkip }) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [focusAreas, setFocusAreas] = useState<string[]>([]);

  const toggleDomain = (d: string) => {
    setFocusAreas(prev => 
      prev.includes(d) ? prev.filter(i => i !== d) : [...prev, d]
    );
  };

  const handleConfirm = () => {
      onConfirm({ name, description, focusAreas });
  };

  return (
    <div className="fixed inset-0 bg-black/70 z-[80] flex items-center justify-center p-4 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-[1100px] h-[640px] flex overflow-hidden animate-fade-in-up border border-white/50">
        
        {/* Left Side: Decorative & Context */}
        <div className="w-[320px] bg-gradient-to-br from-indigo-900 to-indigo-800 text-white p-8 flex flex-col justify-between relative overflow-hidden shrink-0">
            {/* Decorative Background Elements */}
            <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
            <div className="absolute bottom-0 left-0 w-48 h-48 bg-purple-500/20 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2"></div>
            <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')]"></div>

            <div className="relative z-10">
                <div className="flex items-center gap-3 mb-8">
                    <div className="w-10 h-10 bg-white/20 rounded-lg flex items-center justify-center font-bold backdrop-blur-sm text-white text-xl">3</div>
                    <span className="font-bold text-xl tracking-wide opacity-90">Organization</span>
                </div>
                
                <div className="mb-8">
                     <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm border border-white/10 text-xs font-bold text-indigo-100">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse"></span>
                        Step 3 / 4
                     </div>
                     <h2 className="text-3xl font-black mt-4 leading-tight tracking-tight">
                         完善您的<br/>
                         <span className="text-indigo-200">机构档案</span>
                     </h2>
                </div>
            </div>

            <div className="relative z-10">
                <p className="text-sm font-medium text-indigo-100/80 leading-relaxed">
                    完善的机构画像有助于 AI 更精准地理解您的业务背景，从而生成更符合机构调性的项目方案和文案。
                </p>
            </div>
        </div>

        {/* Right Side: Form Area - Compact & No Scroll */}
        <div className="flex-1 bg-white relative flex flex-col p-8 overflow-hidden">
             <div className="w-full max-w-3xl mx-auto flex-1 flex flex-col h-full">
                 <div className="text-center shrink-0 mb-6">
                    <div className="w-12 h-12 bg-indigo-50 rounded-2xl flex items-center justify-center text-2xl mx-auto mb-3 shadow-sm text-indigo-600">
                        🏢
                    </div>
                    <h3 className="text-xl font-black text-slate-800 mb-1">机构基本信息</h3>
                    <p className="text-xs text-slate-500 font-medium">可选步骤，您可以稍后在设置中补充</p>
                </div>

                <div className="flex-1 flex flex-col gap-5 min-h-0">
                    <div className="grid grid-cols-2 gap-5">
                        <div className="col-span-1">
                            <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">机构名称</label>
                            <input 
                                value={name}
                                onChange={e => setName(e.target.value)}
                                placeholder="例如：益行公益发展中心"
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all placeholder-slate-300"
                            />
                        </div>
                        <div className="col-span-1">
                             {/* Empty Spacer or Additional Field if needed */}
                             <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">主要工作地域 (可选)</label>
                             <input 
                                placeholder="例如：四川省、云南省..."
                                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm font-bold focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all placeholder-slate-300"
                            />
                        </div>
                    </div>
                    
                    <div className="flex-1 min-h-0 flex flex-col">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2 shrink-0">关注领域 (多选)</label>
                        <div className="bg-slate-50 border border-slate-100 rounded-xl p-3 overflow-y-auto custom-scrollbar flex-1">
                            <div className="flex flex-wrap gap-2">
                                {DOMAINS.map(d => (
                                    <button 
                                        key={d}
                                        onClick={() => toggleDomain(d)}
                                        className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all active:scale-95 ${focusAreas.includes(d) ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm' : 'bg-white border-slate-200 text-slate-500 hover:border-indigo-300 hover:text-indigo-600'}`}
                                    >
                                        {d}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    <div className="h-32 shrink-0">
                        <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">机构简介 / 使命愿景</label>
                        <textarea 
                            value={description}
                            onChange={e => setDescription(e.target.value)}
                            placeholder="简要描述机构的使命、愿景或核心业务..."
                            className="w-full h-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm font-medium focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 outline-none transition-all resize-none placeholder-slate-300"
                        />
                    </div>
                </div>

                {/* Footer Buttons */}
                <div className="pt-5 border-t border-slate-100 flex justify-end items-center gap-3 shrink-0 mt-6">
                     <button 
                        onClick={onSkip}
                        className="px-5 py-2.5 rounded-xl text-slate-400 font-bold text-xs hover:bg-slate-50 transition-colors"
                    >
                        跳过
                    </button>
                     <button 
                        onClick={handleConfirm}
                        className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-2.5 px-6 rounded-xl shadow-lg shadow-indigo-200 transition-all flex items-center gap-2 transform active:scale-[0.98] text-xs"
                    >
                        <span>下一步</span>
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14 5l7 7m0 0l-7 7m7-7H3" /></svg>
                    </button>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default OrgSetupModal;
