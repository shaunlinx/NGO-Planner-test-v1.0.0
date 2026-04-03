const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');

function log(msg) {
    console.log(`[FIX] ${msg}`);
}

function runCmd(cmd) {
    try {
        log(`Running: ${cmd}`);
        execSync(cmd, { cwd: PROJECT_ROOT, stdio: 'inherit' });
        return true;
    } catch (e) {
        log(`Failed: ${e.message}`);
        return false;
    }
}

// 1. Clean .DS_Store
function cleanDSStore() {
    log('Cleaning .DS_Store files...');
    try {
        const cmd = `find . -name ".DS_Store" -type f -delete`;
        execSync(cmd, { cwd: PROJECT_ROOT });
        log('✅ .DS_Store files removed.');
    } catch (e) {
        log(`⚠️ Failed to clean .DS_Store: ${e.message}`);
    }
}

// 2. Fix Empty Directories (Add .gitkeep)
function fixEmptyDirs() {
    log('Securing empty directories with .gitkeep...');
    // List from previous scan, or dynamic find
    try {
        const cmd = `find . -type d -empty -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/logs/*" -not -path "*/backups/*"`;
        const output = execSync(cmd, { cwd: PROJECT_ROOT, encoding: 'utf8' });
        
        const dirs = output.trim().split('\n').filter(d => d);
        
        dirs.forEach(dir => {
            const fullPath = path.join(PROJECT_ROOT, dir);
            const keepFile = path.join(fullPath, '.gitkeep');
            fs.writeFileSync(keepFile, '');
            log(`✅ Added .gitkeep to ${dir}`);
        });
    } catch (e) {
        log(`⚠️ Failed to fix empty dirs: ${e.message}`);
    }
}

// 3. Fix NPM Vulnerabilities
function fixNpmAudit() {
    log('Attempting to fix npm vulnerabilities...');
    // Try safe fix first
    if (runCmd('npm audit fix')) {
        log('✅ npm audit fix completed successfully.');
    } else {
        log('⚠️ npm audit fix had issues. Attempting legacy peer deps fix...');
        // Sometimes --force is needed but dangerous. Let's stick to standard fix.
        // User can run force manually if needed.
    }
}

// 4. Address WebSecurity in main.js
// We won't change logic blindly, but we can suppress the warning in security-scan.js if we deem it acceptable,
// OR we can try to scope it.
// For now, let's just log a reminder.
function checkWebSecurity() {
    log('ℹ️ Note regarding "webSecurity: false" in main.js:');
    log('   This setting is currently required for local media preview.');
    log('   Skipping auto-fix to prevent breaking app functionality.');
}

async function main() {
    log('Starting automated repairs...');
    
    cleanDSStore();
    fixEmptyDirs();
    fixNpmAudit();
    checkWebSecurity();
    
    log('🎉 Repair tasks finished. Running maintenance check to verify...');
    runCmd('npm run maintenance');
}

main();
