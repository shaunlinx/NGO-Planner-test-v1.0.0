import React, { useState } from 'react';
import { TeamMember } from '../types';
import DataVisualizer from './DataVisualizer';
import SimpleSpreadsheet from './SimpleSpreadsheet';
import AgentWorkflowTable from './AgentWorkflowTable';

interface FormsAssistantProps {
    teamMembers: TeamMember[];
    warehousePath?: string;
}

type TabType = 'visualization' | 'spreadsheet' | 'workflow';

const FormsAssistant: React.FC<FormsAssistantProps> = ({ teamMembers, warehousePath }) => {
    const [activeTab, setActiveTab] = useState<TabType>('workflow');

    return (
        <div className="flex flex-col h-full bg-gray-50">
            {/* Top Navigation Bar */}
            <div className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm z-10">
                <div className="flex items-center gap-2">
                    <div className="p-1.5 bg-indigo-100 rounded-lg text-indigo-600">
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                    </div>
                    <div>
                        <h2 className="text-lg font-bold text-gray-800 leading-tight">表单助手</h2>
                        <p className="text-[10px] text-gray-500">数据可视化 · 智能表格 · 自动化工作流</p>
                    </div>
                </div>

                {/* Tab Switcher */}
                <div className="flex bg-gray-100 p-1 rounded-lg">
                    <button
                        onClick={() => setActiveTab('visualization')}
                        className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'visualization' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        📊 数据可视化
                    </button>
                    <button
                        onClick={() => setActiveTab('spreadsheet')}
                        className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'spreadsheet' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        ⚡️ 智能表格
                    </button>
                    <button
                        onClick={() => setActiveTab('workflow')}
                        className={`px-4 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'workflow' ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        🤖 多维表格 (Workflow)
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="flex-1 overflow-hidden relative">
                {activeTab === 'visualization' && <DataVisualizer warehousePath={warehousePath} />}
                {activeTab === 'spreadsheet' && <SimpleSpreadsheet />}
                {activeTab === 'workflow' && <AgentWorkflowTable teamMembers={teamMembers} warehousePath={warehousePath} />}
            </div>
        </div>
    );
};

export default FormsAssistant;