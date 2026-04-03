import React from 'react';

export const ChunkTextHighlighter: React.FC<{ text: string, highlight: string | null }> = ({ text, highlight }) => {
    if (!highlight || !text) return <>{text}</>;

    const lowerText = text.toLowerCase();
    const lowerHighlight = highlight.toLowerCase();
    const matches: { start: number, end: number }[] = [];

    const addMatch = (start: number, end: number) => {
        const isOverlap = matches.some(m => 
            (start >= m.start && start < m.end) || 
            (end > m.start && end <= m.end) ||
            (start <= m.start && end >= m.end)
        );
        if (!isOverlap) {
            matches.push({ start, end });
        }
    };

    if (lowerText.includes(lowerHighlight)) {
        const idx = lowerText.indexOf(lowerHighlight);
        addMatch(idx, idx + lowerHighlight.length);
    } else {
        const phrases = lowerHighlight.split(/[，。！？,!?\s]+/).filter(p => p.length > 1);
        phrases.sort((a, b) => b.length - a.length);

        for (const p of phrases) {
            if (p.length < 2) continue;
            let searchPos = 0;
            while (searchPos < lowerText.length) {
                const idx = lowerText.indexOf(p, searchPos);
                if (idx === -1) break;
                addMatch(idx, idx + p.length);
                searchPos = idx + p.length;
            }
        }
    }

    if (matches.length === 0) return <>{text}</>;

    matches.sort((a, b) => a.start - b.start);

    const mergedMatches: { start: number, end: number }[] = [];
    if (matches.length > 0) {
        let current = matches[0];
        for (let i = 1; i < matches.length; i++) {
            if (matches[i].start < current.end) {
                current.end = Math.max(current.end, matches[i].end);
            } else {
                mergedMatches.push(current);
                current = matches[i];
            }
        }
        mergedMatches.push(current);
    }

    const result = [];
    let lastIndex = 0;
    
    mergedMatches.forEach((m, i) => {
        if (m.start > lastIndex) {
            result.push(<span key={`text-${i}`}>{text.substring(lastIndex, m.start)}</span>);
        }
        result.push(
            <mark key={`mark-${i}`} className="bg-yellow-200 text-slate-900 rounded px-0.5 animate-pulse">
                {text.substring(m.start, m.end)}
            </mark>
        );
        lastIndex = m.end;
    });
    
    if (lastIndex < text.length) {
        result.push(<span key={`text-end`}>{text.substring(lastIndex)}</span>);
    }

    return <>{result}</>;
};
