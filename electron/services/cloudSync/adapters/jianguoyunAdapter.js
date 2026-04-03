const axios = require('axios');
const path = require('path');
const fs = require('fs');
const { decryptToken } = require('../../../utils/cryptoUtils');

const JIANGUOYUN_API_BASE = 'https://dav.jianguoyun.com/dav';

const normalizeCloudPath = (cloudTargetFilePath) => {
    let p = String(cloudTargetFilePath || '').trim();
    p = p.replace(/\\/g, '/');
    p = p.replace(/^https?:\/\/[^/]+\/dav\/?/i, '');
    p = p.replace(/^\/+/, '');
    p = p.replace(/^dav\/+/i, '');
    p = p.replace(/\/{2,}/g, '/');
    p = p.replace(/^\.\//, '');

    const parts = p.split('/').filter(Boolean);
    const encodedParts = parts.map((part) => encodeURIComponent(part));
    return { parts, encodedParts };
};

const isWebDavCollection = (propfindBody) => {
    if (!propfindBody) return false;
    const text = typeof propfindBody === 'string' ? propfindBody : String(propfindBody);
    return /<[^>]*collection\s*\/?\s*>/i.test(text) || /<[^>]*resourcetype[^>]*>[\s\S]*collection/i.test(text);
};

/**
 * 坚果云文件上传（WebDAV）
 * @param {string} localFilePath 
 * @param {object} cloudConfig 
 * @param {string} cloudTargetFilePath 
 */
const uploadFile = async (localFilePath, cloudConfig, cloudTargetFilePath) => {
    try {
        const decryptedToken = decryptToken(cloudConfig.encrypted_token, cloudConfig.iv);
        const auth = Buffer.from(`${cloudConfig.username}:${decryptedToken}`).toString('base64');

        if (!fs.existsSync(localFilePath)) throw new Error('Local file not found');

        const { encodedParts } = normalizeCloudPath(cloudTargetFilePath);
        if (encodedParts.length === 0) throw new Error('Invalid cloud target path');

        const request = async (config) => {
            return await axios.request({
                ...config,
                validateStatus: () => true
            });
        };

        const ensureDirectoryEncoded = async (encodedDirPath) => {
            if (!encodedDirPath) return;
            const dirUrl = `${JIANGUOYUN_API_BASE}/${encodedDirPath}/`;

            const prop = await request({
                method: 'PROPFIND',
                url: dirUrl,
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Depth': '0'
                }
            });

            if (prop.status === 207 || prop.status === 200) {
                if (!isWebDavCollection(prop.data)) {
                    throw new Error(`Remote path is not a folder: ${encodedDirPath}`);
                }
                return;
            }
            if (prop.status === 401 || prop.status === 403) {
                throw new Error(`Jianguoyun auth failed (${prop.status})`);
            }

            if (prop.status !== 404) {
                throw new Error(`Jianguoyun PROPFIND failed (${prop.status}) for ${encodedDirPath}`);
            }

            const mk = await request({
                method: 'MKCOL',
                url: dirUrl,
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Length': '0'
                }
            });

            if (mk.status === 201 || mk.status === 200 || mk.status === 405) return;
            throw new Error(`Jianguoyun MKCOL failed (${mk.status}) for ${encodedDirPath}`);
        };

        const parentEncodedParts = encodedParts.slice(0, -1);
        let current = '';
        for (const part of parentEncodedParts) {
            current = current ? `${current}/${part}` : part;
            await ensureDirectoryEncoded(current);
        }

        const encodedFullPath = encodedParts.join('/');
        const url = `${JIANGUOYUN_API_BASE}/${encodedFullPath}`;

        const uploadOnce = async () => {
            const fileStream = fs.createReadStream(localFilePath);
            return await axios.put(url, fileStream, {
                validateStatus: () => true,
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/octet-stream',
                    'User-Agent': 'NGO Planner Desktop/2.4.0'
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });
        };

        let putRes = await uploadOnce();
        if (putRes.status === 409) {
            const delRes = await request({
                method: 'DELETE',
                url,
                headers: {
                    'Authorization': `Basic ${auth}`
                }
            });

            if (![204, 200, 404].includes(delRes.status)) {
                throw new Error(`Jianguoyun DELETE failed (${delRes.status}) for ${cloudTargetFilePath}`);
            }
            putRes = await uploadOnce();
        }

        if (putRes.status === 409) {
            const parentEncoded = parentEncodedParts.join('/');
            const parentUrl = parentEncoded ? `${JIANGUOYUN_API_BASE}/${parentEncoded}/` : `${JIANGUOYUN_API_BASE}/`;
            const parentProbe = parentEncoded ? await request({
                method: 'PROPFIND',
                url: parentUrl,
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Depth': '0'
                }
            }) : { status: 207, data: '<collection/>' };

            const parentIsFolder = parentEncoded ? isWebDavCollection(parentProbe.data) : true;
            throw new Error(
                `Jianguoyun PUT conflict (409) for ${cloudTargetFilePath}; ` +
                `encoded=${encodedFullPath}; parent=${parentEncoded || '(root)'} ` +
                `parentStatus=${parentProbe.status} parentIsFolder=${parentIsFolder}`
            );
        }

        if (putRes.status < 200 || putRes.status >= 300) {
            throw new Error(`Jianguoyun PUT failed (${putRes.status}) for ${cloudTargetFilePath}; encoded=${encodedFullPath}`);
        }

        console.log(`[Jianguoyun] Upload success: ${cloudTargetFilePath}`);
        return { success: true, cloudFilePath: cloudTargetFilePath };
    } catch (error) {
        console.error('[Jianguoyun] Upload failed:', error.message);
        throw new Error(`Jianguoyun upload failed: ${error.message}`);
    }
};

const listDirectory = async (cloudConfig, cloudDirPath) => {
    const decryptedToken = decryptToken(cloudConfig.encrypted_token, cloudConfig.iv);
    const auth = Buffer.from(`${cloudConfig.username}:${decryptedToken}`).toString('base64');

    const { encodedParts } = normalizeCloudPath(cloudDirPath);
    const encodedDir = encodedParts.join('/');
    const dirUrl = encodedDir ? `${JIANGUOYUN_API_BASE}/${encodedDir}/` : `${JIANGUOYUN_API_BASE}/`;

    const res = await axios.request({
        method: 'PROPFIND',
        url: dirUrl,
        headers: {
            'Authorization': `Basic ${auth}`,
            'Depth': '1'
        },
        validateStatus: () => true
    });

    if (res.status === 401 || res.status === 403) {
        throw new Error(`Jianguoyun auth failed (${res.status})`);
    }
    if (res.status !== 207 && res.status !== 200) {
        throw new Error(`Jianguoyun PROPFIND failed (${res.status}) for ${cloudDirPath}`);
    }

    const xml = typeof res.data === 'string' ? res.data : String(res.data || '');
    const responseBlocks = xml.split(/<[^:>]*:?response\b/i).slice(1).map((b) => '<response' + b);

    const items = [];
    for (const block of responseBlocks) {
        const hrefMatch = block.match(/<[^:>]*:?href[^>]*>([\s\S]*?)<\/[^:>]*:?href>/i);
        if (!hrefMatch) continue;
        const href = hrefMatch[1].trim();

        const isDir = isWebDavCollection(block);
        const pathPart = href.replace(/^https?:\/\/[^/]+/i, '');
        const davIndex = pathPart.toLowerCase().indexOf('/dav/');
        if (davIndex === -1) continue;
        const rel = pathPart.slice(davIndex + 5);
        const normalized = rel.replace(/\/+$/, '');
        if (!normalized) continue;

        const decoded = normalized
            .split('/')
            .filter(Boolean)
            .map((p) => {
                try {
                    return decodeURIComponent(p);
                } catch (e) {
                    return p;
                }
            })
            .join('/');

        const decodedDir = encodedParts
            .map((p) => {
                try {
                    return decodeURIComponent(p);
                } catch (e) {
                    return p;
                }
            })
            .join('/');
        if (decoded && decodedDir && decoded === decodedDir) continue;

        items.push({ path: decoded, isDirectory: isDir });
    }

    return { success: true, items };
};

const downloadFile = async (cloudConfig, cloudFilePath, localDestPath) => {
    const decryptedToken = decryptToken(cloudConfig.encrypted_token, cloudConfig.iv);
    const auth = Buffer.from(`${cloudConfig.username}:${decryptedToken}`).toString('base64');

    const { encodedParts } = normalizeCloudPath(cloudFilePath);
    if (encodedParts.length === 0) throw new Error('Invalid cloud file path');
    const encodedFullPath = encodedParts.join('/');
    const url = `${JIANGUOYUN_API_BASE}/${encodedFullPath}`;

    fs.mkdirSync(path.dirname(localDestPath), { recursive: true });
    const res = await axios.get(url, {
        responseType: 'stream',
        validateStatus: () => true,
        headers: {
            'Authorization': `Basic ${auth}`
        }
    });

    if (res.status === 401 || res.status === 403) throw new Error(`Jianguoyun auth failed (${res.status})`);
    if (res.status !== 200) throw new Error(`Jianguoyun GET failed (${res.status}) for ${cloudFilePath}`);

    await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(localDestPath);
        out.on('error', reject);
        res.data.on('error', reject);
        out.on('finish', resolve);
        res.data.pipe(out);
    });

    return { success: true, localPath: localDestPath };
};

module.exports = { uploadFile, listDirectory, downloadFile };
