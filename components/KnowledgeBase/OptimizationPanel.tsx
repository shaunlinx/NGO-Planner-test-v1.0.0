import React, { useState, useRef, useEffect } from 'react';

export interface OptimizationConfig {
    preset: 'formal' | 'viral' | 'note' | 'print' | 'custom';
    fontFamily: string;
    fontSize: string;
    lineHeight: string;
    letterSpacing: string;
    showBackground: boolean;
    name?: string; 
}

const SYSTEM_FONTS = [
    { label: '系统默认 (Default)', value: 'inherit' },
    { label: '微软雅黑 (Microsoft YaHei)', value: '"Microsoft YaHei", "微软雅黑", sans-serif' },
    { label: '苹方 (PingFang SC)', value: '"PingFang SC", sans-serif' },
    { label: '黑体 (SimHei)', value: 'SimHei, "黑体", sans-serif' },
    { label: '宋体 (SimSun)', value: 'SimSun, "宋体", serif' },
    { label: '楷体 (KaiTi)', value: 'KaiTi, "楷体", serif' },
    { label: '仿宋 (FangSong)', value: 'FangSong, "仿宋", serif' },
    { label: '冬青黑体 (Hiragino Sans GB)', value: '"Hiragino Sans GB", sans-serif' },
    { label: '兰亭黑 (Lantinghei SC)', value: '"Lantinghei SC", sans-serif' },
    { label: 'Arial', value: 'Arial, sans-serif' },
    { label: 'Helvetica', value: 'Helvetica, sans-serif' },
    { label: 'Times New Roman', value: '"Times New Roman", serif' },
    { label: 'Georgia', value: 'Georgia, serif' },
    { label: 'Verdana', value: 'Verdana, sans-serif' },
    { label: 'Courier New', value: '"Courier New", monospace' }
];

export const getOptimizationStyles = (config: OptimizationConfig): React.CSSProperties => {
    const fontMap: Record<string, string> = {
        'font-serif': 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
        'font-sans': 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        'font-mono': 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    };
    
    const fontFamily = fontMap[config.fontFamily] || config.fontFamily;

    return {
        fontFamily: fontFamily,
        fontSize: config.fontSize === 'text-sm' ? '0.875rem' : 
                  config.fontSize === 'text-base' ? '1rem' : 
                  config.fontSize === 'text-lg' ? '1.125rem' : 
                  config.fontSize === 'text-xl' ? '1.25rem' : '1rem',
        lineHeight: config.lineHeight === 'leading-normal' ? '1.5' : 
                    config.lineHeight === 'leading-relaxed' ? '1.625' : 
                    config.lineHeight === 'leading-loose' ? '2' : 
                    config.lineHeight === 'leading-tight' ? '1.25' : '1.5',
        letterSpacing: config.letterSpacing === 'tracking-tight' ? '-0.025em' : 
                       config.letterSpacing === 'tracking-normal' ? '0' : 
                       config.letterSpacing === 'tracking-wide' ? '0.025em' : '0'
    };
};

export const OptimizationPanel: React.FC<{
    config: OptimizationConfig;
    onChange: (c: OptimizationConfig) => void;
    templates: OptimizationConfig[];
    onSaveTemplate: (name: string) => void;
    onDeleteTemplate: (idx: number) => void;
    onMinimize: () => void;
}> = ({ config, onChange, templates, onSaveTemplate, onDeleteTemplate, onMinimize }) => {
    const [templateName, setTemplateName] = useState('');
    const [isDragging, setIsDragging] = useState(false);
    const [position, setPosition] = useState({ x: 0, y: 0 }); 
    const dragRef = useRef<HTMLDivElement>(null);
    const startPosRef = useRef({ x: 0, y: 0 });
    const initialPosRef = useRef({ x: 0, y: 0 });

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        startPosRef.current = { x: e.clientX, y: e.clientY };
        initialPosRef.current = { x: position.x, y: position.y };
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (!isDragging) return;
            const dx = e.clientX - startPosRef.current.x;
            const dy = e.clientY - startPosRef.current.y;
            setPosition({ x: initialPosRef.current.x + dx, y: initialPosRef.current.y + dy });
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging]);

    const applyPreset = (preset: 'formal' | 'viral' | 'note' | 'print') => {
        const presets: Record<string, Partial<OptimizationConfig>> = {
            formal: { fontFamily: 'SimSun, "宋体", serif', fontSize: 'text-base', lineHeight: 'leading-loose', letterSpacing: 'tracking-normal', showBackground: true },
            viral: { fontFamily: '"Microsoft YaHei", "微软雅黑", sans-serif', fontSize: 'text-lg', lineHeight: 'leading-relaxed', letterSpacing: 'tracking-wide', showBackground: true },
            note: { fontFamily: '"PingFang SC", sans-serif', fontSize: 'text-sm', lineHeight: 'leading-tight', letterSpacing: 'tracking-tight', showBackground: true },
            print: { fontFamily: 'SimSun, "宋体", serif', fontSize: 'text-base', lineHeight: 'leading-normal', letterSpacing: 'tracking-normal', showBackground: false }
        };
        onChange({ ...config, preset, ...presets[preset] });
    };

    return (
        <div 
            ref={dragRef}
            className="flex flex-col bg-white/95 backdrop-blur-sm border border-slate-200 w-[300px] shadow-2xl z-50 rounded-2xl overflow-hidden fixed"
            style={{ 
                top: '100px', 
                right: '20px', 
                height: 'calc(100vh - 140px)',
                transform: `translate(${position.x}px, ${position.y}px)`,
                transition: isDragging ? 'none' : 'transform 0.1s ease-out'
            }}
        >
             <div 
                className="p-3 border-b border-slate-200 bg-slate-50 flex justify-between items-center cursor-move select-none"
                onMouseDown={handleMouseDown}
             >
                 <h3 className="font-bold text-slate-700 flex items-center gap-2 text-sm">
                     <span className="text-lg">✨</span> 优化排版
                 </h3>
                 <div className="flex items-center gap-1">
                     <button onClick={onMinimize} className="p-1 hover:bg-slate-200 rounded text-slate-400 hover:text-slate-600" title="最小化">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                     </button>
                 </div>
             </div>

             <div className="flex-1 overflow-y-auto p-3 space-y-4 scrollbar-thin">
                <div>
                    <label className="text-[10px] font-bold text-slate-400 mb-2 block uppercase tracking-wider">快速预设</label>
                    <div className="grid grid-cols-2 gap-2">
                        {[
                            { id: 'formal', label: '👔 正式', desc: '衬线 / 宽松', color: 'indigo' },
                            { id: 'viral', label: '🚀 传播', desc: '无衬线 / 大字', color: 'pink' },
                            { id: 'note', label: '📝 笔记', desc: '紧凑 / 小字', color: 'emerald' },
                            { id: 'print', label: '🖨️ 打印', desc: '黑白 / 清晰', color: 'slate' }
                        ].map((p) => {
                            const isSelected = config.preset === p.id;
                            const colors: Record<string, string> = {
                                indigo: isSelected ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'hover:border-indigo-200',
                                pink: isSelected ? 'bg-pink-50 border-pink-500 text-pink-700' : 'hover:border-pink-200',
                                emerald: isSelected ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'hover:border-emerald-200',
                                slate: isSelected ? 'bg-slate-100 border-slate-500 text-slate-700' : 'hover:border-slate-300'
                            };

                            return (
                                <button
                                    key={p.id}
                                    onClick={() => applyPreset(p.id as any)}
                                    className={`p-2 rounded-lg border-2 text-left transition-all relative overflow-hidden group ${isSelected ? 'shadow-sm' : 'bg-white border-slate-100'} ${colors[p.color]}`}
                                >
                                    <div className="text-xs font-bold mb-0.5">{p.label}</div>
                                    <div className="text-[9px] opacity-70">{p.desc}</div>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div className="bg-slate-50/50 p-3 rounded-xl border border-slate-200 shadow-sm space-y-3">
                    <label className="text-[10px] font-bold text-slate-400 block uppercase tracking-wider">排版细节</label>
                    
                    <div className="space-y-1">
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] font-bold text-slate-500">字体 (Font)</span>
                        </div>
                        <div className="relative space-y-2">
                            <select 
                                value={config.fontFamily}
                                onChange={(e) => onChange({...config, preset: 'custom', fontFamily: e.target.value})}
                                className="w-full text-xs border border-slate-200 rounded-lg pl-2 pr-8 py-1.5 bg-white outline-none focus:border-indigo-500 appearance-none font-medium truncate"
                                style={{ fontFamily: config.fontFamily.includes('"') ? config.fontFamily : 'inherit' }}
                            >
                                {SYSTEM_FONTS.map(f => (
                                    <option key={f.value} value={f.value} style={{ fontFamily: f.value }}>
                                        {f.label}
                                    </option>
                                ))}
                            </select>
                            <input 
                                type="text"
                                placeholder="或输入本地字体名称..."
                                className="w-full text-xs border border-slate-200 rounded-lg px-2 py-1.5 bg-white outline-none focus:border-indigo-500"
                                value={config.fontFamily.includes(',') ? '' : config.fontFamily}
                                onChange={(e) => {
                                    if(e.target.value) onChange({...config, preset: 'custom', fontFamily: e.target.value});
                                }}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 gap-3 pt-1">
                        {[
                            { label: '字号', key: 'fontSize', options: ['text-sm', 'text-base', 'text-lg', 'text-xl'], labels: ['小', '中', '大', '超大'] },
                            { label: '行高', key: 'lineHeight', options: ['leading-tight', 'leading-normal', 'leading-relaxed', 'leading-loose'], labels: ['紧凑', '标准', '舒适', '宽松'] },
                            { label: '字距', key: 'letterSpacing', options: ['tracking-tight', 'tracking-normal', 'tracking-wide'], labels: ['紧密', '标准', '疏松'] }
                        ].map((ctrl) => (
                            <div key={ctrl.key} className="space-y-1">
                                <div className="flex justify-between text-[10px]">
                                    <span className="font-bold text-slate-500">{ctrl.label}</span>
                                    <span className="text-indigo-600 font-bold">
                                        {ctrl.labels[(ctrl.options as string[]).indexOf((config as any)[ctrl.key])]}
                                    </span>
                                </div>
                                <input 
                                    type="range" 
                                    min="0" 
                                    max={ctrl.options.length - 1} 
                                    step="1" 
                                    value={(ctrl.options as string[]).indexOf((config as any)[ctrl.key])}
                                    onChange={(e) => {
                                        onChange({...config, preset: 'custom', [ctrl.key]: ctrl.options[parseInt(e.target.value)]});
                                    }}
                                    className="w-full h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-600 block"
                                />
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-slate-100 p-2 rounded-xl border border-slate-200">
                    <div 
                        className={`bg-white rounded-lg p-3 shadow-sm min-h-[80px] text-xs transition-all duration-300 ${!config.showBackground ? 'bg-transparent shadow-none border-2 border-dashed border-slate-300' : ''}`}
                        style={getOptimizationStyles(config)}
                    >
                        <p className="mb-1">预览 Preview</p>
                        <p>敏捷的棕色狐狸。</p>
                        <p>The quick brown fox.</p>
                    </div>
                    <div className="flex justify-end mt-2">
                        <button 
                            onClick={() => onChange({...config, showBackground: !config.showBackground})}
                            className={`text-[9px] px-2 py-0.5 rounded border ${config.showBackground ? 'bg-white border-slate-300 text-slate-500' : 'bg-indigo-100 border-indigo-300 text-indigo-700'}`}
                        >
                            {config.showBackground ? '显示背景' : '隐藏背景'}
                        </button>
                    </div>
                </div>
             </div>

             <div className="p-3 bg-slate-50 border-t border-slate-200">
                <div className="flex items-center gap-2 mb-2">
                    <input 
                        type="text" 
                        placeholder="存为模版..." 
                        value={templateName}
                        onChange={e => setTemplateName(e.target.value)}
                        className="flex-1 text-xs border border-slate-200 rounded-lg px-2 py-1.5 outline-none focus:border-indigo-500 bg-white transition-all"
                    />
                    <button 
                        disabled={!templateName}
                        onClick={() => { onSaveTemplate(templateName); setTemplateName(''); }}
                        className="px-2 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-bold hover:bg-indigo-700 disabled:opacity-50 shadow-sm transition-all"
                    >
                        保存
                    </button>
                </div>
                
                {templates.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 max-h-[60px] overflow-y-auto pr-1 scrollbar-thin">
                        {templates.map((t, idx) => (
                            <span key={idx} className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 bg-white rounded-md text-[9px] text-slate-600 border border-slate-200 group hover:border-indigo-300 transition-all">
                                <span 
                                    className="cursor-pointer font-bold truncate max-w-[60px]"
                                    onClick={() => onChange(t)}
                                    title={t.name}
                                >
                                    {t.name}
                                </span>
                                <button onClick={() => onDeleteTemplate(idx)} className="w-3.5 h-3.5 flex items-center justify-center rounded-full hover:bg-red-100 text-slate-300 hover:text-red-500 transition-colors">×</button>
                            </span>
                        ))}
                    </div>
                )}
             </div>
        </div>
    );
};
