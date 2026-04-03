const { app, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const dbManager = require('../../databaseManager');
const { encryptToken, decryptToken } = require('../../utils/cryptoUtils');

class SocialMediaManager {
    constructor() {
        this.tokenCache = new Map(); // appId -> { token, expiresAt }
    }

    init() {
        // Register IPC handlers
        ipcMain.handle('social-wechat-add-account', async (event, data) => {
            return await this.addAccount(data);
        });
        ipcMain.handle('social-wechat-get-accounts', async () => {
            return await this.getAccounts();
        });
        ipcMain.handle('social-wechat-delete-account', async (event, appId) => {
            return await this.deleteAccount(appId);
        });
        ipcMain.handle('social-wechat-save-draft', async (event, draft) => {
            return await this.saveDraft(draft);
        });
        ipcMain.handle('social-wechat-get-drafts', async (event, accountId) => {
            return await this.getDrafts(accountId);
        });
        ipcMain.handle('social-wechat-delete-draft', async (event, id) => {
            return await this.deleteDraft(id);
        });
        ipcMain.handle('social-wechat-upload-image', async (event, { appId, filePath }) => {
            return await this.uploadImage(appId, filePath);
        });
        ipcMain.handle('social-wechat-upload-draft', async (event, { appId, draftId }) => {
            return await this.uploadDraftToWechat(appId, draftId);
        });
        ipcMain.handle('social-wechat-publish', async (event, { appId, mediaId }) => {
            return await this.publishDraft(appId, mediaId);
        });
        ipcMain.handle('social-wechat-send-preview', async (event, { appId, draftId, openId }) => {
            return await this.sendPreview(appId, draftId, openId);
        });
    }

    async addAccount({ appId, appSecret, name, previewOpenId }) {
        try {
            const { encrypted, iv } = encryptToken(appSecret);
            await dbManager.saveWechatAccount({
                id: appId,
                name,
                app_secret: encrypted,
                app_secret_iv: iv,
                preview_openid: previewOpenId
            });
            return { success: true };
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async getAccounts() {
        try {
            const accounts = await dbManager.getWechatAccounts();
            // Don't return secrets
            return accounts.map(a => ({
                id: a.id,
                name: a.name,
                preview_openid: a.preview_openid,
                created_at: a.created_at
            }));
        } catch (e) {
            return [];
        }
    }

    async deleteAccount(appId) {
        return await dbManager.deleteWechatAccount(appId);
    }

    async saveDraft(draft) {
        return await dbManager.saveWechatDraft(draft);
    }

    async getDrafts(accountId) {
        return await dbManager.getWechatDrafts(accountId);
    }

    async deleteDraft(id) {
        return await dbManager.deleteWechatDraft(id);
    }

    async getAccessToken(appId) {
        // Check cache first
        const now = Math.floor(Date.now() / 1000);
        if (this.tokenCache.has(appId)) {
            const cached = this.tokenCache.get(appId);
            if (cached.expiresAt > now + 300) { // 5 minutes buffer
                return cached.token;
            }
        }

        // Get from DB to decrypt secret
        const account = await dbManager.getWechatAccount(appId);
        if (!account) throw new Error('Account not found');

        // Check DB token
        if (account.access_token && account.token_expires_at > now + 300) {
            this.tokenCache.set(appId, { token: account.access_token, expiresAt: account.token_expires_at });
            return account.access_token;
        }

        // Decrypt secret
        let appSecret;
        try {
            appSecret = decryptToken(account.app_secret, account.app_secret_iv);
        } catch (e) {
            throw new Error('Failed to decrypt AppSecret');
        }

        // Request new token
        try {
            const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${appId}&secret=${appSecret}`;
            const response = await fetch(url);
            const data = await response.json();

            if (data.access_token) {
                const expiresAt = now + data.expires_in;
                this.tokenCache.set(appId, { token: data.access_token, expiresAt });
                
                // Update DB
                await dbManager.saveWechatAccount({
                    ...account,
                    access_token: data.access_token,
                    token_expires_at: expiresAt
                });

                return data.access_token;
            } else {
                throw new Error(`WeChat API Error: ${data.errcode} - ${data.errmsg}`);
            }
        } catch (e) {
            console.error('Failed to get access token:', e);
            throw e;
        }
    }

    async uploadImage(appId, filePath) {
        return this._uploadMedia(appId, filePath, 'image', true);
    }

    async uploadArticleImage(appId, filePath) {
        // 上传图文消息内的图片获取URL (不占用永久素材数量)
        // https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=ACCESS_TOKEN
        try {
            const token = await this.getAccessToken(appId);
            const url = `https://api.weixin.qq.com/cgi-bin/media/uploadimg?access_token=${token}`;
            
            const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
            const filename = path.basename(filePath);
            const fileContent = fs.readFileSync(filePath);
            
            let postData = Buffer.concat([
                Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`),
                fileContent,
                Buffer.from(`\r\n--${boundary}--\r\n`)
            ]);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': postData.length
                },
                body: postData
            });
            
            const data = await response.json();
            if (data.url) {
                return { success: true, url: data.url };
            } else {
                throw new Error(`Upload Article Image Failed: ${data.errmsg}`);
            }
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async _uploadMedia(appId, filePath, type, isPermanent) {
        try {
            const token = await this.getAccessToken(appId);
            // 永久素材: /material/add_material
            // 临时素材: /media/upload (这里暂未实现，如果需要可扩展)
            const url = isPermanent 
                ? `https://api.weixin.qq.com/cgi-bin/material/add_material?access_token=${token}&type=${type}`
                : `https://api.weixin.qq.com/cgi-bin/media/upload?access_token=${token}&type=${type}`;
            
            const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
            const filename = path.basename(filePath);
            const fileContent = fs.readFileSync(filePath);
            
            let postData = Buffer.concat([
                Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename}"\r\nContent-Type: image/jpeg\r\n\r\n`),
                fileContent,
                Buffer.from(`\r\n--${boundary}--\r\n`)
            ]);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': `multipart/form-data; boundary=${boundary}`,
                    'Content-Length': postData.length
                },
                body: postData
            });
            
            const data = await response.json();
            if (data.media_id) {
                return { success: true, media_id: data.media_id, url: data.url };
            } else {
                throw new Error(`Upload Failed: ${data.errmsg}`);
            }
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async uploadDraftToWechat(appId, draftId) {
        try {
            const draft = await dbManager.getWechatDrafts().then(res => res.find(d => d.id === draftId));
            if (!draft) throw new Error('Draft not found');

            const token = await this.getAccessToken(appId);
            
            // 1. Ensure thumb_media_id exists (upload cover if needed)
            if (!draft.thumb_media_id && draft.thumb_url && fs.existsSync(draft.thumb_url)) {
                const uploadRes = await this.uploadImage(appId, draft.thumb_url);
                if (uploadRes.success) {
                    draft.thumb_media_id = uploadRes.media_id;
                    await dbManager.saveWechatDraft(draft);
                } else {
                    throw new Error('Failed to upload cover image: ' + uploadRes.error);
                }
            }
            
            if (!draft.thumb_media_id) throw new Error('Cover image (thumb_media_id) is required');

            // 2. Process Content Images
            // Find all <img src="..."> where src is local file path
            let processedContent = draft.content;
            const imgRegex = /<img[^>]+src="([^">]+)"/g;
            let match;
            const replacements = [];

            while ((match = imgRegex.exec(draft.content)) !== null) {
                const src = match[1];
                // Check if it's a local path (starts with / or letter:) and not http/https
                if (!src.startsWith('http') && (src.startsWith('/') || src.match(/^[a-zA-Z]:/))) {
                     if (fs.existsSync(src)) {
                         const uploadRes = await this.uploadArticleImage(appId, src);
                         if (uploadRes.success) {
                             replacements.push({ original: src, new: uploadRes.url });
                         } else {
                             console.warn(`Failed to upload article image: ${src}, error: ${uploadRes.error}`);
                         }
                     }
                }
            }

            // Apply replacements
            for (const rep of replacements) {
                processedContent = processedContent.replace(rep.original, rep.new);
            }

            // Update content in DB if changed (optional, maybe keep local paths in local draft?)
            // Let's NOT update the local draft content with remote URLs to keep it editable locally?
            // Actually, wechat draft content MUST have wechat URLs. 
            // If we want to keep local paths, we should store them separately or just overwrite.
            // For now, let's overwrite, assuming "uploaded" status means it's ready for wechat.
            
            // 3. Upload Draft
            const url = `https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${token}`;
            const article = {
                title: draft.title,
                author: draft.author,
                digest: draft.digest,
                content: processedContent,
                content_source_url: draft.content_source_url,
                thumb_media_id: draft.thumb_media_id,
                need_open_comment: draft.need_open_comment,
                only_fans_can_comment: draft.only_fans_can_comment
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ articles: [article] })
            });

            const data = await response.json();
            if (data.media_id) {
                draft.media_id = data.media_id;
                draft.status = 'uploaded';
                // draft.content = processedContent; // Update content with remote URLs? Maybe.
                await dbManager.saveWechatDraft(draft);
                return { success: true, media_id: data.media_id };
            } else {
                throw new Error(`Upload Draft Failed: ${data.errmsg}`);
            }
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async publishDraft(appId, mediaId) {
        try {
            const token = await this.getAccessToken(appId);
            const url = `https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${token}`;
            
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ media_id: mediaId })
            });

            const data = await response.json();
            if (data.errcode === 0) {
                // Update draft status
                const drafts = await dbManager.getWechatDrafts();
                const draft = drafts.find(d => d.media_id === mediaId);
                if (draft) {
                    draft.status = 'published';
                    await dbManager.saveWechatDraft(draft);
                }
                return { success: true, publish_id: data.publish_id };
            } else {
                throw new Error(`Publish Failed: ${data.errmsg}`);
            }
        } catch (e) {
            return { success: false, error: e.message };
        }
    }

    async sendPreview(appId, draftId, openId) {
        try {
            const token = await this.getAccessToken(appId);
            const draft = await dbManager.getWechatDrafts().then(res => res.find(d => d.id === draftId));
            if (!draft) throw new Error('Draft not found');

            // 1. Process Content Images & Upload Cover
            // For preview via Customer Message, we need a media_id for the image (not URL for news cover, actually news msg needs picurl)
            // But to get a picurl on wechat domain, we upload it.
            // uploadArticleImage returns a URL.
            
            let coverUrl = '';
            if (draft.thumb_url && fs.existsSync(draft.thumb_url)) {
                const uploadRes = await this.uploadArticleImage(appId, draft.thumb_url);
                if (uploadRes.success) {
                    coverUrl = uploadRes.url;
                }
            }

            // 2. Send Custom Message (News)
            // https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=ACCESS_TOKEN
            const url = `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${token}`;
            
            const payload = {
                touser: openId,
                msgtype: "news",
                news: {
                    articles: [
                        {
                            title: draft.title,
                            description: draft.digest || draft.content.substring(0, 50),
                            url: "https://mp.weixin.qq.com", // Placeholder
                            picurl: coverUrl
                        }
                    ]
                }
            };

            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await response.json();
            if (data.errcode === 0) {
                return { success: true };
            } else {
                throw new Error(`Send Preview Failed: ${data.errcode} - ${data.errmsg}`);
            }
        } catch (e) {
            return { success: false, error: e.message };
        }
    }
}

module.exports = new SocialMediaManager();
