const crypto = require('crypto');

const APP_ENCRYPT_KEY = process.env.APP_ENCRYPT_KEY || 'ngo-planner-sync-key';

const encryptToken = (token) => {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(APP_ENCRYPT_KEY, 'salt', 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(algorithm, key, iv);
    let encrypted = cipher.update(token, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return { encrypted, iv: iv.toString('hex') };
};

const decryptToken = (encryptedToken, ivHex) => {
    const algorithm = 'aes-256-cbc';
    const key = crypto.scryptSync(APP_ENCRYPT_KEY, 'salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const decipher = crypto.createDecipheriv(algorithm, key, iv);
    let decrypted = decipher.update(encryptedToken, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
};

module.exports = { encryptToken, decryptToken };