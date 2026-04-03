import React, { useState } from 'react';
import { TeamMember } from '../types';

// Icons
const Icons = {
    Play: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>,
    Save: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" /></svg>,
    Magic: () => <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" /></svg>,
};

interface DataVisualizerProps {
    warehousePath?: string;
}

const DataVisualizer: React.FC<DataVisualizerProps> = ({ warehousePath }) => {
    const [inputData, setInputData] = useState('');
    const [htmlContent, setHtmlContent] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);

    const handleGenerate = async () => {
        if (!inputData.trim()) return;
        setIsGenerating(true);

        const prompt = `You are a data visualization expert. 
        Analyze the following data and generate a complete, single-file HTML dashboard using Chart.js or ECharts.
        The HTML should include:
        1. Responsive layout.
        2. Interactive charts appropriate for the data type.
        3. A clean, modern UI (Tailwind CSS allowed via CDN).
        
        Data:
        ${inputData.substring(0, 5000)} // Truncate for safety

        Output ONLY the raw HTML code, starting with <!DOCTYPE html>. Do not include markdown backticks.`;

        try {
            if ((window as any).electronAPI?.knowledge?.completion) {
                const res = await (window as any).electronAPI.knowledge.completion({ prompt });
                if (res.success && res.text) {
                    let cleanHtml = res.text.replace(/```html/g, '').replace(/```/g, '');
                    setHtmlContent(cleanHtml);
                }
            } else {
                // Mock
                await new Promise(resolve => setTimeout(resolve, 2000));
                setHtmlContent(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
                        <script src="https://cdn.tailwindcss.com"></script>
                    </head>
                    <body class="bg-gray-50 p-8">
                        <div class="max-w-4xl mx-auto bg-white rounded-xl shadow-lg p-6">
                            <h1 class="text-2xl font-bold mb-4 text-gray-800">Data Visualization (Mock)</h1>
                            <canvas id="myChart"></canvas>
                        </div>
                        <script>
                            const ctx = document.getElementById('myChart');
                            new Chart(ctx, {
                                type: 'bar',
                                data: {
                                    labels: ['Red', 'Blue', 'Yellow', 'Green', 'Purple', 'Orange'],
                                    datasets: [{
                                        label: '# of Votes',
                                        data: [12, 19, 3, 5, 2, 3],
                                        borderWidth: 1,
                                        backgroundColor: 'rgba(79, 70, 229, 0.5)',
                                        borderColor: 'rgb(79, 70, 229)'
                                    }]
                                },
                                options: { scales: { y: { beginAtZero: true } } }
                            });
                        </script>
                    </body>
                    </html>
                `);
            }
        } catch (e) {
            console.error(e);
            alert("Visualization generation failed.");
        } finally {
            setIsGenerating(false);
        }
    };

    const handleDownload = () => {
        if (!htmlContent) return;
        const blob = new Blob([htmlContent], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'dashboard.html';
        a.click();
        URL.revokeObjectURL(url);
    };

    return (
        <div className="flex h-full gap-4 p-6">
            {/* Input Area */}
            <div className="w-1/3 flex flex-col gap-4">
                <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-4 flex-1 flex flex-col">
                    <h3 className="font-bold text-gray-700 mb-2 flex items-center gap-2">
                        <Icons.Magic /> 数据源输入
                    </h3>
                    <textarea 
                        className="flex-1 w-full p-3 bg-gray-50 rounded-lg border border-gray-200 text-xs font-mono outline-none focus:border-indigo-500 resize-none"
                        placeholder="粘贴 CSV, JSON 或 Excel 数据..."
                        value={inputData}
                        onChange={(e) => setInputData(e.target.value)}
                    />
                    <button 
                        onClick={handleGenerate}
                        disabled={isGenerating || !inputData}
                        className={`mt-4 w-full py-2 rounded-lg font-bold text-white flex items-center justify-center gap-2 ${isGenerating ? 'bg-indigo-300' : 'bg-indigo-600 hover:bg-indigo-700'}`}
                    >
                        {isGenerating ? 'AI 生成中...' : '生成可视化仪表盘'}
                    </button>
                </div>
            </div>

            {/* Preview Area */}
            <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-200 flex flex-col overflow-hidden relative">
                <div className="p-3 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                    <span className="text-xs font-bold text-gray-500">实时预览</span>
                    {htmlContent && (
                        <button onClick={handleDownload} className="text-indigo-600 text-xs font-bold hover:underline flex items-center gap-1">
                            <Icons.Save /> 保存为 HTML
                        </button>
                    )}
                </div>
                {htmlContent ? (
                    <iframe 
                        srcDoc={htmlContent} 
                        className="w-full h-full border-none"
                        title="Visualization Preview"
                        sandbox="allow-scripts"
                    />
                ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-gray-300">
                        <div className="text-4xl mb-2">📊</div>
                        <p>输入数据后点击生成预览</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default DataVisualizer;