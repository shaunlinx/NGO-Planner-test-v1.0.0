const path = require('path');
const fs = require('fs');
const dbManager = require('../../databaseManager');
const { getFileMd5, getFileModifyTime } = require('../../utils/fileUtils');
const jianguoyunAdapter = require('./adapters/jianguoyunAdapter');
const { decryptToken } = require('../../utils/cryptoUtils');
const archiver = require('archiver');

// Use dynamic import for p-queue as it is an ESM module
let syncQueue;

const initQueue = async () => {
    if (syncQueue) return;
    try {
        // Dynamic import for ESM module in CommonJS
        const { default: PQueue } = await import('p-queue');
        syncQueue = new PQueue({ concurrency: 3 });
    } catch (e) {
        console.warn("p-queue load failed:", e);
        // Fallback simple queue
        syncQueue = {
            add: async (fn) => await fn(),
            onIdle: async () => {}
        };
    }
};

// Register format for encrypted zip
// Note: 'archiver-zip-encrypted' modifies archiver prototype or registers format
try {
    archiver.registerFormat('zip-encrypted', require('archiver-zip-encrypted'));
} catch (e) {
    console.warn('archiver-zip-encrypted not found or failed to register');
}

// ... existing imports ...

// Helper to create encrypted zip for the ENTIRE folder using 7-Zip (via 7zip-min or system command if available)
// Or use a more reliable node library 'minizlib' or 'yazl' if archiver fails.
// Given archiver-zip-encrypted is failing (0 bytes), we will switch to 'archiver' standard zip with password if supported,
// BUT standard archiver does not support password encryption natively without that plugin.
// Alternative: Use Node's crypto module to encrypt the ZIP file AFTER creation.
// This is the most robust way:
// 1. Create standard ZIP (unencrypted) -> temp_plain.zip
// 2. Encrypt temp_plain.zip using AES-256-CBC -> temp_encrypted.enc
// 3. Upload temp_encrypted.enc
// 4. User decrypts using a provided tool or script.
//
// HOWEVER, user wants "input password to decrypt view", which implies standard Zip encryption (ZipCrypto or AES).
// Since archiver-zip-encrypted is flaky, let's try 'adm-zip' or 'jszip' if they support encryption.
// adm-zip supports reading encrypted but writing encryption is limited/experimental.
//
// BEST STABLE APPROACH:
// Use 'archiver' to create a standard zip, BUT pipe it through a crypto stream? No, that makes it a non-standard file.
//
// Let's debug why archiver-zip-encrypted is 0 bytes.
// It might be because the 'registerFormat' is failing silently or the module wasn't installed.
// I just installed it.
//
// Let's try a different approach:
// Use 'archiver' for standard zip, but since we MUST support password, we will try to use 'minipass-zip' or similar if available?
// No, let's fix the logic. The 0 byte issue often happens if the stream is not properly finalized or events are missed.
//
// I will rewrite the createFolderEncryptedZip to be extremely verbose and use a simpler flow.
// If encryption is the blocker, I will fallback to:
// Create Standard Zip -> Then Encrypt the whole file with AES.
// User said: "Cloud disk input password decrypt view" -> This implies the Cloud Disk (e.g. Jianguoyun) supports ZIP preview?
// Or user downloads and opens in WinRAR/MacZip.
//
// If I cannot get Zip AES working reliably in Node, I will implement:
// "Standard Zip" (No Password) -> if user accepts? No, user wants encryption.
//
// Let's try to use `archiver` WITHOUT the encrypted format first to verify ZIP creation works at all.
// If standard ZIP works, then the issue is the plugin.
//
// Plan:
// 1. Try to create a standard ZIP first (to prove folder zipping works).
// 2. If successful, it means the issue is strictly the encryption plugin.
//
// I will modify the code to:
// - Check if `archiver-zip-encrypted` is actually working.
// - If not, I will use a pure Node.js crypto stream to encrypt the entire ZIP file.
//   -> Result: `backup.zip.enc`
//   -> This requires a decrypt tool, but it's 100% reliable.
//   -> BUT User wants "Input password to view", implying standard Zip handling.
//
// Let's try one more library: `node-stream-zip` or `yazl`.
// Actually, `archiver` is the standard.
//
// Let's try to fix the usage of archiver-zip-encrypted.
// The issue might be `zlib: { level: 9 }` conflict with encryption?
// Or `password` length?
//
// I will try to REMOVE zlib compression options when using encryption, as they sometimes conflict.

const createFolderEncryptedZip = (sourceFolderPath, password) => {
    return new Promise((resolve, reject) => {
        const tempPath = path.join(path.dirname(sourceFolderPath), `${path.basename(sourceFolderPath)}_Backup.zip`);
        const output = fs.createWriteStream(tempPath);
        
        // NOTE: Some versions of archiver-zip-encrypted don't support zlib options well
        const archive = archiver('zip-encrypted', {
            encryptionMethod: 'aes256',
            password: password
        });

        archive.on('warning', err => console.warn('Zip warning:', err));
        archive.on('error', err => reject(err));
        output.on('error', err => reject(err));

        output.on('close', () => {
             try {
                 const stats = fs.statSync(tempPath);
                 if (stats.size === 0) reject(new Error('Created zip file is empty - Encryption plugin failed'));
                 else resolve(tempPath);
             } catch(e) { reject(e); }
        });

        archive.pipe(output);
        
        // Append the entire directory
        archive.directory(sourceFolderPath, false);
        
        archive.finalize();
    });
};

const syncFolderToCloud = async (localFolderPath, cloudType, cloudConfig, cloudTargetFolder) => {
    await initQueue();
    try {
        if (!localFolderPath || !cloudType || !cloudConfig) {
            throw new Error('Invalid sync parameters');
        }

        let localRootPath = localFolderPath;
        try {
            const stat = fs.statSync(localFolderPath);
            if (!stat.isDirectory()) {
                localRootPath = path.dirname(localFolderPath);
            }
        } catch (e) {
            throw new Error('Local path not accessible');
        }

        // Check Encryption Config
        let encryptionPassword = null;
        if (cloudConfig.encryption_password) {
            encryptionPassword = decryptToken(cloudConfig.encryption_password, cloudConfig.encryption_iv);
        }

        // --- MODE 1: Encrypted Folder Backup (User requested folder-level encryption) ---
        if (encryptionPassword) {
            console.log('[Sync] Starting Encrypted Folder Backup mode...');
            let uploadPath = null;
            try {
                // 1. Create one single encrypted zip for the whole folder
                uploadPath = await createFolderEncryptedZip(localRootPath, encryptionPassword);
                
                // 2. Upload the single zip file
                // Cloud Path: Target/FolderName_Backup.zip
                const zipName = path.basename(uploadPath);
                let cloudAdapter;
                if (cloudType === 'jianguoyun') {
                    cloudAdapter = jianguoyunAdapter;
                } else {
                    throw new Error(`Cloud type ${cloudType} not supported yet`);
                }

                await cloudAdapter.uploadFile(
                    uploadPath,
                    cloudConfig,
                    path.posix.join(cloudTargetFolder, zipName) // Upload to root of target
                );
                
                // 3. Update Sync Time
                await dbManager.updateCloudSyncConfig(cloudType, { last_sync_time: Date.now() });
                
                return { success: true, results: [{ success: true, fileName: zipName, message: 'Full Folder Backup' }] };

            } catch (err) {
                console.error('Encrypted Backup Failed:', err);
                throw err;
            } finally {
                // Cleanup
                if (uploadPath && fs.existsSync(uploadPath)) {
                    fs.unlinkSync(uploadPath);
                }
            }
        }

        // --- MODE 2: Standard Incremental File Sync (No Encryption) ---
        
        // 1. Get files to sync
        const needSyncFiles = await getNeedSyncFiles(localRootPath, cloudType, localFolderPath);
        
        if (needSyncFiles.length === 0) {
            return { success: true, message: 'No changes detected' };
        }

        // 2. Select Adapter
        let cloudAdapter;
        if (cloudType === 'jianguoyun') {
            cloudAdapter = jianguoyunAdapter;
        } else {
            throw new Error(`Cloud type ${cloudType} not supported yet`);
        }

        // 3. Execute Sync
        const syncResults = [];
        
        // Ensure queue is ready
        const promises = needSyncFiles.map(file => {
            return syncQueue.add(async () => {
                let uploadPath = file.localPath;
                let cleanupTemp = false;

                try {
                    const relativePathPosix = file.cloudRelPath;
                    
                    // Combine cloudTargetFolder (raw) with relativePath (raw)
                    // Ensure cloudTargetFolder doesn't have trailing slash
                    const targetFolderClean = cloudTargetFolder.replace(/\/+$/, '');
                    let cloudPath = `${targetFolderClean}/${relativePathPosix}`;
                    
                    // --- Encryption Logic ---
                    if (encryptionPassword) {
                        try {
                            // Create encrypted zip
                            uploadPath = await createEncryptedZip(file.localPath, encryptionPassword);
                            cleanupTemp = true;
                            // Append .zip to cloud path
                            cloudPath += '.zip';
                        } catch (zipErr) {
                            console.error(`Zip error for ${file.fileName}:`, zipErr);
                            throw new Error('Encryption failed');
                        }
                    }
                    
                    await cloudAdapter.uploadFile(
                        uploadPath,
                        cloudConfig,
                        cloudPath
                    );
                    
                    // Update DB (Save original file info to avoid re-sync loop)
                    await dbManager.updateSyncFileRecord({
                        file_path: file.recordKeyPath,
                        cloud_type: cloudType,
                        file_md5: file.md5,
                        modify_time: file.mtime,
                        cloud_path: cloudPath,
                        sync_time: Date.now()
                    });

                    await dbManager.updateSyncObjectRecord({
                        cloud_rel_path: file.cloudRelPath,
                        cloud_type: cloudType,
                        file_md5: file.md5,
                        modify_time: file.mtime,
                        cloud_path: cloudPath,
                        sync_time: Date.now(),
                        local_root_hint: localRootPath
                    });
                    
                    syncResults.push({ success: true, fileName: file.fileName });
                } catch (error) {
                    console.error(`Sync error for ${file.fileName}:`, error);
                    syncResults.push({ success: false, fileName: file.fileName, message: error.message });
                } finally {
                    // Cleanup temp zip
                    if (cleanupTemp && fs.existsSync(uploadPath)) {
                        fs.unlinkSync(uploadPath);
                    }
                }
            });
        });

        await Promise.all(promises);
        
        // Update Config Last Sync Time
        await dbManager.updateCloudSyncConfig(cloudType, { last_sync_time: Date.now() });

        return { success: true, results: syncResults };

    } catch (error) {
        console.error('Cloud Sync Error:', error);
        throw error;
    }
};

const getNeedSyncFiles = async (folderPath, cloudType, originalPath) => {
    const files = [];
    const onlyOneFile = (() => {
        if (!originalPath) return null;
        try {
            const st = fs.statSync(originalPath);
            if (st.isDirectory()) return null;
            return originalPath;
        } catch (e) {
            return null;
        }
    })();
    
    // Recursive read
    const scan = (dir) => {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            // Skip temp zip files created by encryption process
            if (entry.name.endsWith('.temp.zip')) {
                continue;
            }

            if (entry.name === '.DS_Store' || entry.name === 'Thumbs.db' || entry.name === '.localized') {
                continue;
            }

            if (entry.name.startsWith('._')) {
                continue;
            }
            
            if (entry.isDirectory()) {
                scan(fullPath);
            } else {
                files.push(fullPath);
            }
        }
    };
    
    if (onlyOneFile) {
        files.push(onlyOneFile);
    } else if (fs.existsSync(folderPath)) {
        scan(folderPath);
    }

    const needSync = [];
    for (const file of files) {
        let resolvedPath = file;
        try {
            resolvedPath = fs.realpathSync(file);
        } catch (e) {}

        const mtime = getFileModifyTime(resolvedPath);
        let rel = path.relative(folderPath, resolvedPath);
        if (!rel || rel.startsWith('..')) rel = path.basename(resolvedPath);
        const cloudRelPath = rel.split(path.sep).join('/');

        const objectRecord = await dbManager.getSyncObjectRecord(cloudRelPath, cloudType);

        if (objectRecord && objectRecord.modify_time === mtime) {
            continue;
        }

        const md5 = await getFileMd5(resolvedPath);

        if (objectRecord) {
            if (objectRecord.file_md5 === md5) {
                await dbManager.updateSyncObjectRecord({
                    cloud_rel_path: cloudRelPath,
                    cloud_type: cloudType,
                    file_md5: md5,
                    modify_time: mtime,
                    cloud_path: objectRecord.cloud_path,
                    sync_time: objectRecord.sync_time || Date.now(),
                    local_root_hint: folderPath
                });
                continue;
            }
        } else {
            const legacyRecord = await dbManager.getSyncFileRecord(resolvedPath, cloudType);
            if (legacyRecord && legacyRecord.file_md5 === md5) {
                await dbManager.updateSyncObjectRecord({
                    cloud_rel_path: cloudRelPath,
                    cloud_type: cloudType,
                    file_md5: md5,
                    modify_time: mtime,
                    cloud_path: legacyRecord.cloud_path,
                    sync_time: legacyRecord.sync_time || Date.now(),
                    local_root_hint: folderPath
                });
                if (legacyRecord.modify_time !== mtime) {
                    await dbManager.updateSyncFileRecord({
                        file_path: resolvedPath,
                        cloud_type: cloudType,
                        file_md5: md5,
                        modify_time: mtime,
                        cloud_path: legacyRecord.cloud_path,
                        sync_time: legacyRecord.sync_time || Date.now()
                    });
                }
                continue;
            }
        }

        needSync.push({
            localPath: resolvedPath,
            recordKeyPath: resolvedPath,
            cloudRelPath,
            fileName: path.basename(resolvedPath),
            md5,
            mtime
        });
    }
    
    return needSync;
};

const syncCloudToLocal = async (localFolderPath, cloudType, cloudConfig, cloudTargetFolder) => {
    await initQueue();
    try {
        if (!localFolderPath || !cloudType || !cloudConfig) {
            throw new Error('Invalid sync parameters');
        }

        let localRootPath = localFolderPath;
        try {
            const stat = fs.statSync(localFolderPath);
            if (!stat.isDirectory()) {
                localRootPath = path.dirname(localFolderPath);
            }
        } catch (e) {
            throw new Error('Local path not accessible');
        }

        let cloudAdapter;
        if (cloudType === 'jianguoyun') {
            cloudAdapter = jianguoyunAdapter;
        } else {
            throw new Error(`Cloud type ${cloudType} not supported yet`);
        }

        const targetFolderClean = String(cloudTargetFolder || '').replace(/\/+$/, '').replace(/^\/+/, '');
        if (!targetFolderClean) throw new Error('Target folder not configured');

        const downloaded = [];
        const skipped = [];
        const conflicts = [];

        const queue = syncQueue;
        const visitedDirs = new Set();
        const pendingDirs = [targetFolderClean];

        while (pendingDirs.length > 0) {
            const dir = pendingDirs.pop();
            if (!dir || visitedDirs.has(dir)) continue;
            visitedDirs.add(dir);

            const res = await cloudAdapter.listDirectory(cloudConfig, dir);
            const items = res.items || [];
            for (const item of items) {
                if (!item?.path) continue;
                if (item.isDirectory) {
                    pendingDirs.push(item.path);
                } else {
                    const fullPath = item.path;
                    let rel = fullPath;
                    if (fullPath === targetFolderClean) rel = '';
                    else if (fullPath.startsWith(`${targetFolderClean}/`)) rel = fullPath.slice(targetFolderClean.length + 1);

                    if (!rel) continue;

                    const cloudRelPath = rel;
                    const localDest = path.join(localRootPath, ...cloudRelPath.split('/'));

                    const objectRecord = await dbManager.getSyncObjectRecord(cloudRelPath, cloudType);
                    const existsLocally = fs.existsSync(localDest);

                    if (existsLocally && objectRecord) {
                        skipped.push({ cloudRelPath, localPath: localDest });
                        continue;
                    }

                    if (existsLocally && !objectRecord) {
                        const parsed = path.parse(localDest);
                        const conflictPath = path.join(parsed.dir, `${parsed.name}.conflict-${Date.now()}${parsed.ext}`);
                        conflicts.push({ cloudRelPath, localPath: localDest, conflictPath });
                        await queue.add(async () => {
                            await cloudAdapter.downloadFile(cloudConfig, `${targetFolderClean}/${cloudRelPath}`, conflictPath);
                            const md5 = await getFileMd5(conflictPath);
                            const mtime = getFileModifyTime(conflictPath);
                            const cloudPath = `/${targetFolderClean}/${cloudRelPath}`;
                            await dbManager.updateSyncObjectRecord({
                                cloud_rel_path: cloudRelPath,
                                cloud_type: cloudType,
                                file_md5: md5,
                                modify_time: mtime,
                                cloud_path: cloudPath,
                                sync_time: Date.now(),
                                local_root_hint: localRootPath
                            });
                        });
                        continue;
                    }

                    await queue.add(async () => {
                        await cloudAdapter.downloadFile(cloudConfig, `${targetFolderClean}/${cloudRelPath}`, localDest);
                        const md5 = await getFileMd5(localDest);
                        const mtime = getFileModifyTime(localDest);
                        const cloudPath = `/${targetFolderClean}/${cloudRelPath}`;

                        await dbManager.updateSyncObjectRecord({
                            cloud_rel_path: cloudRelPath,
                            cloud_type: cloudType,
                            file_md5: md5,
                            modify_time: mtime,
                            cloud_path: cloudPath,
                            sync_time: Date.now(),
                            local_root_hint: localRootPath
                        });

                        await dbManager.updateSyncFileRecord({
                            file_path: localDest,
                            cloud_type: cloudType,
                            file_md5: md5,
                            modify_time: mtime,
                            cloud_path: cloudPath,
                            sync_time: Date.now()
                        });

                        downloaded.push({ cloudRelPath, localPath: localDest });
                    });
                }
            }
        }

        await syncQueue.onIdle();
        return { success: true, downloaded, skipped, conflicts };
    } catch (error) {
        console.error('Cloud Pull Error:', error);
        throw error;
    }
};

module.exports = { syncFolderToCloud, syncCloudToLocal };
