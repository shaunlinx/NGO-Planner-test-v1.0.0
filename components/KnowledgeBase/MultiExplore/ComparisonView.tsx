import React from 'react';
import { ComparisonResult } from './types';
import * as KBIcons from '../KBIcons';

interface ComparisonViewProps {
    result: ComparisonResult;
}

export const ComparisonView: React.FC<ComparisonViewProps> = ({ result }) => {
    const modelOrder = result.models.map(m => m.providerId);
    return (
        <div className="mt-4 border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden">
            <div className="p-3 bg-slate-50 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-700 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <KBIcons.Compare />
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200">多模型对比分析</span>
                </div>
            </div>
            <div className="p-4 grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="space-y-2">
                    <div className="text-xs font-black text-slate-600 dark:text-slate-300">模型概览</div>
                    {result.models.map((m, idx) => (
                        <div key={m.providerId} className="p-2 bg-white dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
                            <div className="flex items-center gap-2">
                                <div className="text-[10px] font-bold text-slate-500">{String.fromCharCode(65 + idx)}</div>
                                <div className="text-xs font-bold truncate">{m.providerName}</div>
                            </div>
                            <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300">{m.summary}</div>
                            <div className="mt-1 flex flex-wrap gap-1">
                                {m.keywords.slice(0,6).map(k => (
                                    <span key={k} className="text-[9px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 rounded">{k}</span>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
                <div className="space-y-2">
                    <div className="text-xs font-black text-slate-600 dark:text-slate-300">共性要点</div>
                    {result.consensus.length === 0 ? (
                        <div className="text-[11px] text-slate-400">无显著共识</div>
                    ) : (
                        result.consensus.map((c, i) => (
                            <div key={i} className="p-2 bg-white dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
                                <div className="text-[11px] text-slate-700 dark:text-slate-200">{c.text}</div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                    {c.support.map(id => {
                                        const idx = modelOrder.indexOf(id);
                                        return (
                                            <span key={id} className="text-[9px] px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">
                                                {String.fromCharCode(65 + (idx >= 0 ? idx : 0))}
                                            </span>
                                        );
                                    })}
                                </div>
                            </div>
                        ))
                    )}
                </div>
                <div className="space-y-2">
                    <div className="text-xs font-black text-slate-600 dark:text-slate-300">差异与矛盾</div>
                    {result.differences.slice(0,4).map((d, i) => (
                        <div key={i} className="p-2 bg-white dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
                            <div className="text-[11px] font-bold">{d.topic}</div>
                            <div className="mt-1 space-y-1">
                                {d.statements.map(s => {
                                    const idx = modelOrder.indexOf(s.providerId);
                                    return (
                                        <div key={s.providerId} className="text-[11px] text-slate-600 dark:text-slate-300">
                                            <span className="text-[10px] font-bold mr-1">{String.fromCharCode(65 + (idx >= 0 ? idx : 0))}</span>
                                            {s.text}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    {result.contradictions.slice(0,3).map((c, i) => {
                        const idxA = modelOrder.indexOf(c.a.providerId);
                        const idxB = modelOrder.indexOf(c.b.providerId);
                        return (
                            <div key={`ct-${i}`} className="p-2 bg-red-50 dark:bg-red-900/10 rounded-lg border border-red-100 dark:border-red-900/40">
                                <div className="text-[10px] font-bold text-red-600 dark:text-red-300">潜在矛盾（{c.severity || 'medium'}）</div>
                                <div className="mt-1 text-[11px] text-red-700 dark:text-red-200">
                                    <span className="font-bold mr-1">{String.fromCharCode(65 + (idxA >= 0 ? idxA : 0))}</span>{c.a.text}
                                </div>
                                <div className="text-[11px] text-red-700 dark:text-red-200">
                                    <span className="font-bold mr-1">{String.fromCharCode(65 + (idxB >= 0 ? idxB : 0))}</span>{c.b.text}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>
            <div className="p-4">
                <div className="text-xs font-black text-slate-600 dark:text-slate-300 mb-2">关系矩阵</div>
                <div className="overflow-x-auto">
                    <table className="min-w-full text-[10px] border border-slate-200 dark:border-slate-700">
                        <thead>
                            <tr>
                                <th className="p-2 border-b border-slate-200 dark:border-slate-700 text-left">要点</th>
                                {result.models.map((_, i) => (
                                    <th key={i} className="p-2 border-b border-slate-200 dark:border-slate-700">{String.fromCharCode(65 + i)}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {result.matrix.points.map((p, rIdx) => (
                                <tr key={p.id} className="border-t border-slate-100 dark:border-slate-800">
                                    <td className="p-2 align-top">{p.text}</td>
                                    {result.models.map((_, cIdx) => {
                                        const val = result.matrix.values[rIdx]?.[cIdx] ?? 0;
                                        return (
                                            <td key={`${rIdx}-${cIdx}`} className="p-2 text-center">
                                                {val === 2 ? <span className="text-red-500">×</span> : (val === 1 ? <span className="text-green-500">•</span> : <span className="text-slate-300">–</span>)}
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

