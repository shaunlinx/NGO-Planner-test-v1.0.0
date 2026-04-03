import React, { useState } from 'react';

// Simplified types
interface SimpleRow {
    id: string;
    [key: string]: any;
}

interface SimpleCol {
    id: string;
    title: string;
    width: number;
}

const SimpleSpreadsheet: React.FC = () => {
    const [columns, setColumns] = useState<SimpleCol[]>([
        { id: 'A', title: 'A', width: 100 },
        { id: 'B', title: 'B', width: 100 },
        { id: 'C', title: 'C', width: 100 },
        { id: 'D', title: 'D', width: 100 },
    ]);
    const [rows, setRows] = useState<SimpleRow[]>(
        Array.from({ length: 20 }).map((_, i) => ({ id: `row-${i + 1}` }))
    );
    const [command, setCommand] = useState('');
    const [isProcessing, setIsProcessing] = useState(false);

    const handleCommand = async () => {
        if (!command.trim()) return;
        setIsProcessing(true);

        const prompt = `
        You are an AI spreadsheet assistant. 
        Current Columns: ${JSON.stringify(columns)}
        Current Rows (Sample): ${JSON.stringify(rows.slice(0, 5))}
        User Command: "${command}"

        Return a JSON object with the following structure to update the state:
        {
            "action": "update_cell" | "add_column" | "sort" | "filter",
            "target": "target details",
            "data": "new data or explanation"
        }
        
        For now, just return a mock response that simulates the action.
        `;

        try {
            // Mock logic for demo
            await new Promise(resolve => setTimeout(resolve, 1000));
            alert(`AI 执行指令: ${command} (Mock Implementation)`);
            setCommand('');
        } catch (e) {
            console.error(e);
        } finally {
            setIsProcessing(false);
        }
    };

    return (
        <div className="flex flex-col h-full bg-white">
            {/* AI Command Bar */}
            <div className="p-4 border-b border-gray-200 bg-gray-50 flex gap-2 items-center">
                <span className="text-xl">✨</span>
                <input 
                    value={command}
                    onChange={(e) => setCommand(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleCommand()}
                    className="flex-1 p-2 border border-gray-300 rounded-lg text-sm outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200"
                    placeholder="输入自然语言指令，例如：'计算 A 列总和' 或 '把所有大于 50 的数字标红'..."
                />
                <button 
                    onClick={handleCommand}
                    disabled={isProcessing}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-bold rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                >
                    {isProcessing ? '执行中...' : '执行'}
                </button>
            </div>

            {/* Simple Grid */}
            <div className="flex-1 overflow-auto p-6">
                <div className="border border-gray-200 rounded-lg overflow-hidden inline-block bg-white shadow-sm">
                    <table className="table-fixed border-collapse">
                        <thead>
                            <tr className="bg-gray-100">
                                <th className="w-10 p-2 border-r border-gray-200 text-xs text-gray-500">#</th>
                                {columns.map(col => (
                                    <th key={col.id} className="p-2 border-r border-gray-200 border-b border-gray-200 text-xs font-bold text-gray-700 w-24">
                                        {col.title}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {rows.map((row, idx) => (
                                <tr key={row.id} className="border-b border-gray-100 hover:bg-gray-50">
                                    <td className="p-2 border-r border-gray-100 text-center text-xs text-gray-400 bg-gray-50">{idx + 1}</td>
                                    {columns.map(col => (
                                        <td key={`${row.id}-${col.id}`} className="border-r border-gray-100 p-0">
                                            <input 
                                                className="w-full h-full p-2 outline-none text-sm bg-transparent"
                                                value={row[col.id] || ''}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    setRows(prev => prev.map(r => r.id === row.id ? { ...r, [col.id]: val } : r));
                                                }}
                                            />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

export default SimpleSpreadsheet;