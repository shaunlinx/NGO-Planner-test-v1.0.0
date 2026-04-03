const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(PROJECT_ROOT, 'logs');
const BACKUP_DIR = path.join(PROJECT_ROOT, 'backups');
const LOG_FILE = path.join(LOG_DIR, 'maintenance.log');
const MAINTENANCE_LOG_MD = path.join(PROJECT_ROOT, '.trae', 'MAINTENANCE_LOG.md');

// Ensure directories exist
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
if (!fs.existsSync(path.dirname(MAINTENANCE_LOG_MD))) fs.mkdirSync(path.dirname(MAINTENANCE_LOG_MD), { recursive: true });

function log(message, type = 'INFO') {
    const timestamp = new Date().toISOString();
    const icon = type === 'ERROR' ? '❌' : type === 'WARN' ? '⚠️' : 'ℹ️';
    const logMsg = `[${timestamp}] [${type}] ${message}`;
    const consoleMsg = `${icon} ${message}`;
    
    console.log(consoleMsg);
    fs.appendFileSync(LOG_FILE, logMsg + '\n');
}

function runCommand(command, description) {
    try {
        const output = execSync(command, { cwd: PROJECT_ROOT, encoding: 'utf8', stdio: 'pipe' });
        return { success: true, output };
    } catch (e) {
        return { success: false, error: e.message, output: e.stdout ? e.stdout.toString() : '' };
    }
}

function updateMaintenanceLog(summary) {
    const timestamp = new Date().toLocaleString();
    const entry = `
## [${timestamp}] Maintenance Session

${summary}
`;
    
    try {
        if (!fs.existsSync(MAINTENANCE_LOG_MD)) {
            fs.writeFileSync(MAINTENANCE_LOG_MD, '# Maintenance Log\n\n');
        }
        fs.appendFileSync(MAINTENANCE_LOG_MD, entry);
        log('Updated MAINTENANCE_LOG.md', 'INFO');
    } catch (e) {
        log(`Failed to update MAINTENANCE_LOG.md: ${e.message}`, 'WARN');
    }
}

function backup() {
    log('Starting Safety Backup...', 'INFO');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupName = `backup-${timestamp}.tar.gz`;
    const backupPath = path.join(BACKUP_DIR, backupName);
    
    // Exclude heavy and non-essential directories
    const excludes = [
        'node_modules',
        'dist',
        'dist_electron',
        '.git',
        'backups',
        'logs',
        'release',
        'build'
    ].map(dir => `--exclude="${dir}"`).join(' ');

    const cmd = `tar -czf "${backupPath}" ${excludes} .`;
    
    const result = runCommand(cmd);
    if (result.success) {
        log(`Backup created successfully: ${backupPath}`, 'INFO');
        // Clean old backups (keep last 5)
        cleanOldBackups();
        return { success: true, name: backupName };
    } else {
        log(`Backup failed: ${result.error}`, 'ERROR');
        return { success: false, error: result.error };
    }
}

function cleanOldBackups() {
    try {
        const files = fs.readdirSync(BACKUP_DIR)
            .filter(f => f.startsWith('backup-') && f.endsWith('.tar.gz'))
            .map(f => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtime.getTime() }))
            .sort((a, b) => b.time - a.time); // Newest first

        if (files.length > 5) {
            const toDelete = files.slice(5);
            toDelete.forEach(file => {
                fs.unlinkSync(path.join(BACKUP_DIR, file.name));
                log(`Removed old backup: ${file.name}`, 'INFO');
            });
        }
    } catch (e) {
        log(`Failed to clean old backups: ${e.message}`, 'WARN');
    }
}

function scanLegacyFiles(autoFix = false) {
    log('Scanning for legacy and temporary files...', 'INFO');
    let summary = [];
    
    const legacyPatterns = [
        '*.log', '*.tmp', '*.bak', '*.old', '.DS_Store', 'Thumbs.db', '*.swp'
    ];
    
    // Find temporary files
    const findCmd = `find . -type f \\( ${legacyPatterns.map(p => `-name "${p}"`).join(' -o ')} \\) -not -path "*/node_modules/*" -not -path "*/dist/*" -not -path "*/.git/*" -not -path "*/logs/*" -not -path "*/backups/*"`;
    
    const result = runCommand(findCmd);
    if (result.success && result.output.trim()) {
        const files = result.output.trim().split('\n');
        log(`Found ${files.length} potential junk files.`, 'WARN');
        
        files.forEach(f => {
            if (autoFix) {
                try {
                    fs.unlinkSync(path.join(PROJECT_ROOT, f));
                    log(`  - Deleted: ${f}`, 'INFO');
                } catch (e) {
                    log(`  - Failed to delete ${f}: ${e.message}`, 'ERROR');
                }
            } else {
                log(`  - ${f}`, 'WARN');
            }
        });
        const action = autoFix ? 'Deleted' : 'Found';
        summary.push(`${action} ${files.length} junk files`);
    } else {
        log('No legacy junk files found.', 'INFO');
        summary.push('Clean (No junk files)');
    }

    // Find empty directories
    const emptyDirCmd = `find . -type d -empty -not -path "*/node_modules/*" -not -path "*/.git/*" -not -path "*/logs/*" -not -path "*/backups/*"`;
    const emptyRes = runCommand(emptyDirCmd);
    if (emptyRes.success && emptyRes.output.trim()) {
        const dirs = emptyRes.output.trim().split('\n');
        log(`Found ${dirs.length} empty directories.`, 'WARN');
        
        dirs.forEach(d => {
            if (autoFix) {
                try {
                    const keepFile = path.join(PROJECT_ROOT, d, '.gitkeep');
                    fs.writeFileSync(keepFile, '');
                    log(`  - Added .gitkeep to: ${d}`, 'INFO');
                } catch (e) {
                    log(`  - Failed to fix ${d}: ${e.message}`, 'ERROR');
                }
            } else {
                log(`  - ${d}`, 'WARN');
            }
        });
        const action = autoFix ? 'Fixed' : 'Found';
        summary.push(`${action} ${dirs.length} empty directories`);
    } else {
        summary.push('Clean (No empty dirs)');
    }
    
    return summary.join(', ');
}

function runSecurityCheck() {
    log('Running Security Scan...', 'INFO');
    let results = [];
    let success = true;
    
    // Run existing security scan script
    try {
        execSync('node scripts/security-scan.js', { cwd: PROJECT_ROOT, stdio: 'inherit' });
        log('Security scan passed.', 'INFO');
        results.push('Security Scan: ✅ Passed');
    } catch (e) {
        log('Security scan failed or found issues. Check console output.', 'ERROR');
        results.push('Security Scan: ❌ Issues Found');
        success = false;
    }
    
    // Run npm audit
    log('Running npm audit...', 'INFO');
    try {
        execSync('npm audit --production --audit-level=high', { cwd: PROJECT_ROOT, stdio: 'ignore' });
        log('Dependency audit passed (no high severity issues).', 'INFO');
        results.push('Dependencies: ✅ Secure');
    } catch (e) {
        log('npm audit found high severity vulnerabilities. Run "npm audit" manually.', 'WARN');
        results.push('Dependencies: ⚠️ Vulnerabilities Found');
        // We don't fail the build for npm audit warnings, only for security scan failures
    }
    
    return { summary: results.join('\n'), success };
}

async function main() {
    const args = process.argv.slice(2);
    const autoFix = args.includes('--fix');

    console.log('\n=================================================');
    console.log('   🛠️  NGO PLANNER MAINTENANCE & REVIEW TOOL');
    if (autoFix) console.log('          (AUTO-FIX MODE ENABLED)');
    console.log('=================================================\n');

    log('Maintenance session started', 'INFO');

    let logSummary = [];
    logSummary.push(`- **Mode**: ${autoFix ? 'Auto-Fix' : 'Scan Only'}`);

    // 1. Backup
    const backupRes = backup();
    if (backupRes.success) {
        logSummary.push(`- **Backup**: ✅ Created (\`${backupRes.name}\`)`);
    } else {
        logSummary.push(`- **Backup**: ❌ Failed (${backupRes.error})`);
    }

    // 2. Legacy/Junk File Scan (with optional fix)
    const scanRes = scanLegacyFiles(autoFix);
    logSummary.push(`- **Cleanup**: ${scanRes}`);

    // 3. Security Scan
    const { summary: secSummary, success: secSuccess } = runSecurityCheck();
    // secRes is multiline, format it
    secSummary.split('\n').forEach(line => logSummary.push(`- **${line.split(': ')[0]}**: ${line.split(': ')[1]}`));

    // Update Log
    updateMaintenanceLog(logSummary.join('\n'));

    console.log('\n=================================================');
    console.log(`✅ Maintenance complete. Log saved to: logs/maintenance.log`);
    console.log('=================================================\n');

    if (!secSuccess) {
        console.error('❌ Security check FAILED! Please fix issues before committing.');
        process.exit(1);
    }
}

main().catch(err => {
    log(`Fatal error: ${err.message}`, 'ERROR');
    process.exit(1);
});
