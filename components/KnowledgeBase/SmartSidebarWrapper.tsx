import React from 'react';
import * as KBIcons from './KBIcons';

interface SmartSidebarWrapperProps {
    children: React.ReactNode;
    isCollapsed: boolean;
    isPinned: boolean;
    onTogglePin: () => void;
}

export const SmartSidebarWrapper: React.FC<SmartSidebarWrapperProps> = ({
    children,
    isCollapsed,
    isPinned,
    onTogglePin
}) => {
    return (
        <>
            {/* 
              折角/控制按钮 
              定位：相对于父容器 (KnowledgeBase 的 flex 容器应为 relative) 
              z-index: 高于内容
            */}
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin();
                }}
                className={`
                    absolute top-0 left-0 z-50 
                    transition-all duration-300 ease-in-out
                    focus:outline-none group
                    ${isCollapsed 
                        ? 'w-10 h-10 cursor-pointer' // 缩小尺寸
                        : 'w-8 h-8 translate-x-2 translate-y-2'
                    }
                `}
                title={isPinned ? "点击取消固定（启用自动收起）" : isCollapsed ? "点击固定侧边栏" : "点击固定侧边栏"}
            >
                {isCollapsed ? (
                    // 收起状态：精致的小折角 (书的卷边)
                    // 样式优化：更小的尺寸，更柔和的渐变，去除“叉”图标，改为悬浮时显示微小提示
                    <div className="relative w-full h-full filter drop-shadow-sm transition-transform group-hover:scale-110">
                        {/* 卷边三角形背景 - 纯净版 */}
                        <div 
                            className="absolute top-0 left-0 w-full h-full bg-gradient-to-br from-white via-indigo-50 to-indigo-100 border-b border-r border-indigo-100/50"
                            style={{ 
                                clipPath: 'polygon(0 0, 100% 0, 0 100%)',
                                borderRadius: '0 0 6px 0' 
                            }}
                        />
                        
                        {/* 极简装饰：一个小小的圆点或线条，暗示可点击 */}
                        <div className="absolute top-1.5 left-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                             <div className="w-2 h-2 rounded-full bg-indigo-400/30"></div>
                        </div>

                        {/* 或者：使用一个非常淡的“书签”纹理 */}
                        <div 
                            className="absolute top-0 left-0 w-full h-full bg-indigo-600/5 opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ clipPath: 'polygon(0 0, 100% 0, 0 100%)' }}
                        />
                    </div>
                ) : (
                    // 展开状态：图钉图标
                    <div 
                        className={`
                            p-1.5 rounded-lg shadow-sm border transition-all
                            ${isPinned 
                                ? 'bg-indigo-600 text-white border-indigo-600' 
                                : 'bg-white text-slate-400 border-slate-200 hover:text-indigo-600 hover:border-indigo-300'
                            }
                        `}
                    >
                         {isPinned ? (
                             // 实心图钉 (已固定)
                             <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M16 12V4H8v8l-2 2v2h6v6l2-2v-4h6v-2l-2-2z" />
                             </svg>
                         ) : (
                             // 空心图钉 (未固定/自动模式)
                             <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M16 12V4H8v8l-2 2v2h6v6l2-2v-4h6v-2l-2-2z" />
                             </svg>
                         )}
                    </div>
                )}
            </button>

            {/* Sidebar 容器动画包装器 */}
            <div 
                className={`
                    relative flex flex-col shrink-0 h-full
                    transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]
                    overflow-hidden
                    ${isCollapsed ? 'w-0 opacity-0 -ml-4' : 'w-80 opacity-100 ml-0'} 
                `}
            >
                <div className="w-80 h-full flex flex-col">
                    {children}
                </div>
            </div>
        </>
    );
};
