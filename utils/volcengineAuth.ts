// utils/volcengineAuth.ts

interface SignParams {
    accessKeyId: string;
    secretAccessKey: string;
    service: string;
    region: string;
    method: string;
    path: string;
    query?: Record<string, string>;
    headers?: Record<string, string>;
    body?: string;
}

// Helper for RFC3986 encoding
function encode(str: string): string {
    return encodeURIComponent(str)
        .replace(/!/g, '%21')
        .replace(/'/g, '%27')
        .replace(/\(/g, '%28')
        .replace(/\)/g, '%29')
        .replace(/\*/g, '%2A');
}

export async function signVolcengineRequest(params: SignParams) {
    const {
        service,
        region,
        method,
        path,
        query = {},
        headers = {},
        body = ''
    } = params;

    // Sanitize Keys
    const accessKeyId = params.accessKeyId.trim();
    const secretAccessKey = params.secretAccessKey.trim();

    const now = new Date();
    // Format: YYYYMMDDTHHMMSSZ
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateShort = amzDate.slice(0, 8); // YYYYMMDD

    // 1. Headers
    const signedHeadersMap: Record<string, string> = {
        ...headers,
        'x-date': amzDate,
        // Content-Type is usually handled by fetch, but we sign it if we know it
        // 'content-type': 'application/json' 
    };
    if (!signedHeadersMap['content-type']) {
        signedHeadersMap['content-type'] = 'application/json';
    }

    // Lowercase keys
    const lowerCaseHeaders: Record<string, string> = {};
    Object.keys(signedHeadersMap).forEach(k => {
        lowerCaseHeaders[k.toLowerCase()] = signedHeadersMap[k].trim();
    });

    const sortedHeaderKeys = Object.keys(lowerCaseHeaders).sort();
    const canonicalHeaders = sortedHeaderKeys
        .map(k => `${k}:${lowerCaseHeaders[k]}`)
        .join('\n') + '\n';
    const signedHeadersStr = sortedHeaderKeys.join(';');

    // 2. Query
    const canonicalQuery = Object.keys(query).sort().map(key => {
        return `${encode(key)}=${encode(query[key])}`;
    }).join('&');

    // 3. Payload Hash
    const payloadHash = await sha256Hex(body);

    // 4. Canonical Request
    const canonicalRequest = [
        method.toUpperCase(),
        path,
        canonicalQuery,
        canonicalHeaders,
        signedHeadersStr,
        payloadHash
    ].join('\n');

    // 5. String to Sign
    const algorithm = 'HMAC-SHA256';
    const credentialScope = `${dateShort}/${region}/${service}/request`;
    const canonicalRequestHash = await sha256Hex(canonicalRequest);
    
    const stringToSign = [
        algorithm,
        amzDate,
        credentialScope,
        canonicalRequestHash
    ].join('\n');

    // 6. Signing Key
    const kDate = await hmac(secretAccessKey, dateShort);
    const kRegion = await hmac(kDate, region);
    const kService = await hmac(kRegion, service);
    const kSigning = await hmac(kService, 'request');

    // 7. Signature
    const signature = await hmacHex(kSigning, stringToSign);

    // 8. Authorization Header
    const authorization = `${algorithm} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeadersStr}, Signature=${signature}`;

    return {
        authorization,
        headers: {
            ...headers,
            'X-Date': amzDate, // Note: Fetch headers are case-insensitive, but Volc might expect X-Date
            'Content-Type': 'application/json',
            'Authorization': authorization
        }
    };
}

// Helpers using Web Crypto API

async function sha256Hex(message: string): Promise<string> {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    return bufferToHex(hashBuffer);
}

async function hmac(key: string | ArrayBuffer, message: string): Promise<ArrayBuffer> {
    const keyData = typeof key === 'string' 
        ? new TextEncoder().encode(key) 
        : key;
    
    const cryptoKey = await crypto.subtle.importKey(
        'raw',
        keyData,
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );
    
    const msgBuffer = new TextEncoder().encode(message);
    return await crypto.subtle.sign('HMAC', cryptoKey, msgBuffer);
}

async function hmacHex(key: ArrayBuffer, message: string): Promise<string> {
    const signature = await hmac(key, message);
    return bufferToHex(signature);
}

function bufferToHex(buffer: ArrayBuffer): string {
    return Array.from(new Uint8Array(buffer))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
}
