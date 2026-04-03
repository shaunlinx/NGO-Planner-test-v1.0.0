
export interface MultiExploreResponse {
    providerId: string;
    providerName: string;
    modelId: string;
    content: string;
    chunks?: any[]; // References
    isLoading: boolean;
    error?: string;
    
    // Scoring
    score?: number;
    stats?: {
        recall: number;
        collectionCount: number;
        collectionRatio: number;
        userRating: number;
    };
}

export interface MultiExploreConfig {
    enabledProviders: string[]; // IDs of enabled providers
}

export interface ComparisonResult {
    models: {
        providerId: string;
        providerName: string;
        summary: string;
        keywords: string[];
    }[];
    consensus: {
        text: string;
        support: string[]; // providerIds
    }[];
    differences: {
        topic: string;
        statements: { providerId: string; text: string }[];
    }[];
    contradictions: {
        a: { providerId: string; text: string };
        b: { providerId: string; text: string };
        severity?: 'low' | 'medium' | 'high';
    }[];
    matrix: {
        points: { id: string; text: string }[];
        // rows align with points, columns align with models order in models[]
        values: number[][]; // 0: not mentioned, 1: supports, 2: contradicts
    };
}
