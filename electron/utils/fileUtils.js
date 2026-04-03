const fs = require('fs');
const crypto = require('crypto');

const getFileMd5 = (filePath) => {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash('md5');
        const stream = fs.createReadStream(filePath);
        stream.on('error', err => reject(err));
        stream.on('data', chunk => hash.update(chunk));
        stream.on('end', () => resolve(hash.digest('hex')));
    });
};

const getFileModifyTime = (filePath) => {
    try {
        const stats = fs.statSync(filePath);
        return Math.floor(stats.mtimeMs);
    } catch (e) {
        return 0;
    }
};

module.exports = { getFileMd5, getFileModifyTime };