const truncateString = (s: string, maxLen: number) => {
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen) + '…(truncated)';
};

const shortenPath = (p: string) => {
    const parts = p.split(/[\\/]+/).filter(Boolean);
    if (parts.length <= 2) return p;
    return `…/${parts.slice(-2).join('/')}`;
};

const redactPathsInString = (s: string) => {
    const unixPathRegex = /(\/(?:Users|home|Volumes|var|private|opt|Applications|Library)[^\s"')\]]+)/g;
    const winPathRegex = /([a-zA-Z]:\\[^\s"')\]]+)/g;
    return s
        .replace(unixPathRegex, (m) => shortenPath(m))
        .replace(winPathRegex, (m) => shortenPath(m));
};

export const sanitizeForModel = (value: any, opts?: { redactPaths?: boolean; maxStringLen?: number; maxDepth?: number }) => {
    const redactPaths = opts?.redactPaths !== false;
    const maxStringLen = typeof opts?.maxStringLen === 'number' ? opts.maxStringLen : 8000;
    const maxDepth = typeof opts?.maxDepth === 'number' ? opts.maxDepth : 6;

    const seen = new WeakSet();
    const walk = (v: any, depth: number): any => {
        if (depth > maxDepth) return '[max_depth]';
        if (v === null || v === undefined) return v;
        if (typeof v === 'string') {
            const next = redactPaths ? redactPathsInString(v) : v;
            return truncateString(next, maxStringLen);
        }
        if (typeof v === 'number' || typeof v === 'boolean') return v;
        if (Array.isArray(v)) return v.slice(0, 200).map(x => walk(x, depth + 1));
        if (typeof v === 'object') {
            if (seen.has(v)) return '[circular]';
            seen.add(v);
            const out: any = {};
            const keys = Object.keys(v).slice(0, 200);
            keys.forEach(k => {
                out[k] = walk(v[k], depth + 1);
            });
            return out;
        }
        try {
            return String(v);
        } catch {
            return '[unserializable]';
        }
    };

    return walk(value, 0);
};

export const appendAuditLog = async (entry: any, limit: number = 300) => {
    const db = (window as any)?.electronAPI?.db;
    if (!db?.getSetting || !db?.saveSetting) return;
    try {
        const prev = await db.getSetting('mcp_audit_log');
        const list = Array.isArray(prev) ? prev : [];
        list.unshift(entry);
        await db.saveSetting('mcp_audit_log', list.slice(0, limit));
    } catch {
    }
};

export const withTimeout = async <T>(p: Promise<T>, ms: number, label: string) => {
    let timer: any;
    const timeout = new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_timeout_${ms}ms`)), ms);
    });
    try {
        return await Promise.race([p, timeout]);
    } finally {
        if (timer) clearTimeout(timer);
    }
};

