import React, { useState } from 'react';

export interface CardData {
    id: string;
    selected_text: string;
    user_note: string;
    ai_tags: string[];
    created_at?: number;
    page_number?: number;
}

interface KnowledgeCardProps {
    card: CardData;
    onUpdate: (id: string, updates: Partial<CardData>) => void;
    onDelete: (id: string) => void;
    onClick?: () => void;
}

export const KnowledgeCard: React.FC<KnowledgeCardProps> = ({ card, onUpdate, onDelete, onClick }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [note, setNote] = useState(card.user_note);
    const [tags, setTags] = useState(card.ai_tags);
    const [newTag, setNewTag] = useState('');
    const [isAddingTag, setIsAddingTag] = useState(false);

    const handleSaveNote = () => {
        onUpdate(card.id, { user_note: note });
        setIsEditing(false);
    };

    const handleAddTag = () => {
        if (newTag.trim()) {
            const updatedTags = [...tags, newTag.trim()];
            setTags(updatedTags);
            onUpdate(card.id, { ai_tags: updatedTags });
            setNewTag('');
            setIsAddingTag(false);
        }
    };

    const handleRemoveTag = (tagToRemove: string) => {
        const updatedTags = tags.filter(t => t !== tagToRemove);
        setTags(updatedTags);
        onUpdate(card.id, { ai_tags: updatedTags });
    };

    return (
        <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-100 mb-3 hover:shadow-md transition-shadow group relative">
            <button 
                onClick={() => onDelete(card.id)}
                className="absolute top-2 right-2 text-slate-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
            >
                ✕
            </button>

            {/* Quote Context */}
            <div 
                onClick={(e) => { e.stopPropagation(); onClick && onClick(); }}
                className="text-xs text-slate-500 mb-3 border-l-2 border-indigo-300 pl-2 italic line-clamp-3 bg-slate-50 p-2 rounded-r cursor-pointer hover:bg-indigo-50 transition-colors"
                title="点击跳转到原文"
            >
                "{card.selected_text}"
            </div>

            {/* Note Area */}
            {isEditing ? (
                <div className="mb-3">
                    <textarea 
                        className="w-full border border-indigo-200 p-2 text-sm rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-100 min-h-[80px]" 
                        value={note} 
                        onChange={e => setNote(e.target.value)}
                        placeholder="输入您的思考..."
                        autoFocus
                    />
                    <div className="flex justify-end gap-2 mt-1">
                        <button onClick={() => setIsEditing(false)} className="text-xs text-slate-400 hover:text-slate-600">取消</button>
                        <button onClick={handleSaveNote} className="text-xs bg-indigo-50 text-indigo-600 px-3 py-1 rounded-full font-bold">保存笔记</button>
                    </div>
                </div>
            ) : (
                <div 
                    className="text-sm text-slate-800 mb-3 cursor-text min-h-[20px]" 
                    onClick={() => setIsEditing(true)}
                >
                    {card.user_note ? (
                        <p className="whitespace-pre-wrap">{card.user_note}</p>
                    ) : (
                        <span className="text-slate-300 italic text-xs">点击添加您的思考或笔记...</span>
                    )}
                </div>
            )}

            {/* Tags Area */}
            <div className="flex flex-wrap gap-1.5 items-center">
                {tags.map(tag => (
                    <span key={tag} className="text-[10px] bg-indigo-50 text-indigo-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                        #{tag}
                        <button onClick={() => handleRemoveTag(tag)} className="hover:text-red-500">×</button>
                    </span>
                ))}
                
                {isAddingTag ? (
                    <div className="flex items-center gap-1">
                        <input 
                            className="text-[10px] border border-indigo-200 rounded px-1 w-16 focus:outline-none"
                            value={newTag}
                            onChange={e => setNewTag(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && handleAddTag()}
                            autoFocus
                        />
                        <button onClick={handleAddTag} className="text-indigo-500 text-[10px]">✓</button>
                    </div>
                ) : (
                    <button 
                        onClick={() => setIsAddingTag(true)}
                        className="text-[10px] text-slate-400 hover:text-indigo-500 border border-dashed border-slate-300 rounded-full px-2 py-0.5 transition-colors"
                    >
                        + 标签
                    </button>
                )}
            </div>
        </div>
    );
};
