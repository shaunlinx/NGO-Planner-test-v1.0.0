import React from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';

type BubbleNodeData = {
    title: string;
    subtitle?: string;
    badge?: string;
    fill: string;
    stroke: string;
    text: string;
    kind?: string;
    tooltip?: string;
};

const clampStyle: React.CSSProperties = {
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical' as any,
    overflow: 'hidden',
};

const BubbleNode = React.memo(({ data }: NodeProps) => {
    const d = data as unknown as BubbleNodeData;
    const title = typeof d?.title === 'string' ? d.title : '';
    const subtitle = typeof d?.subtitle === 'string' ? d.subtitle : '';
    const badge = typeof d?.badge === 'string' ? d.badge : '';
    const tooltip = typeof d?.tooltip === 'string' ? d.tooltip : '';
    const fill = typeof d?.fill === 'string' ? d.fill : '#ffffff';
    const stroke = typeof d?.stroke === 'string' ? d.stroke : '#cbd5e1';
    const text = typeof d?.text === 'string' ? d.text : '#0f172a';

    return (
        <div
            title={tooltip || [title, subtitle].filter(Boolean).join(' • ')}
            className="w-full h-full rounded-full flex flex-col items-center justify-center px-3 text-center select-none"
            style={{
                background: fill,
                border: `2px solid ${stroke}`,
                color: text,
                overflow: 'hidden',
            }}
        >
            <Handle
                type="target"
                position={Position.Left}
                className="!w-2 !h-2 !bg-slate-400 !border-2 !border-white !-left-1"
            />
            <Handle
                type="source"
                position={Position.Right}
                className="!w-2 !h-2 !bg-slate-400 !border-2 !border-white !-right-1"
            />
            <div className="text-[10px] font-black leading-tight" style={clampStyle}>
                {title}
            </div>
            {subtitle ? (
                <div className="mt-1 text-[9px] font-bold opacity-80 leading-tight" style={clampStyle}>
                    {subtitle}
                </div>
            ) : null}
            {badge ? <div className="mt-1 text-[9px] font-black opacity-70">{badge}</div> : null}
        </div>
    );
});

export default BubbleNode;
