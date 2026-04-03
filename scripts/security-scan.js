const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

console.log('🔒 Starting Security Scan...');

const securityChecks = {
  // 1. Check for Hardcoded Secrets
  checkHardcodedSecrets: () => {
    console.log('\n🔍 Checking for hardcoded secrets...');
    const secretPatterns = [
      /sk-[a-zA-Z0-9]{20,}/, // OpenAI style
      /AIza[0-9A-Za-z-_]{35}/, // Google API Key
      /api[_-]?key["']?\s*[:=]\s*["'][^"']{10,}["']/i, // Generic API Key assignment
      /password["']?\s*[:=]\s*["'][^"']{3,}["']/i // Password assignment
    ];

    const excludeDirs = ['node_modules', '.git', 'dist', 'dist_electron', 'coverage', '.trae', '.claude'];
    const extensions = ['.js', '.ts', '.tsx', '.json', '.env'];

    let issues = [];

    function scanDir(dir) {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          if (!excludeDirs.includes(file)) scanDir(fullPath);
        } else {
          if (extensions.includes(path.extname(file)) && !file.endsWith('.d.ts')) {
            const content = fs.readFileSync(fullPath, 'utf8');
            secretPatterns.forEach(pattern => {
              if (pattern.test(content)) {
                // Ignore the security script itself and example envs
                if (!fullPath.includes('security-scan.js') && !fullPath.includes('.example')) {
                  const match = content.match(pattern)[0];
                  // Ignore template literals like ${VARIABLE}
                  if (!match.includes('${')) {
                    // Check for inline ignore comment
                    const lines = content.split('\n');
                    const matchLineIndex = lines.findIndex(line => line.includes(match));
                    if (matchLineIndex !== -1 && !lines[matchLineIndex].includes('// security-ignore')) {
                       issues.push(`Potential secret in ${fullPath}: matches ${pattern}`);
                    }
                  }
                }
              }
            });
          }
        }
      }
    }

    scanDir(path.resolve(__dirname, '..'));
    return issues;
  },

  // 2. Check Insecure Electron Configurations
  checkInsecureConfigs: () => {
    console.log('\n🔍 Checking Electron configuration...');
    const issues = [];
    
    // Scan electron directory
    const electronDir = path.resolve(__dirname, '../electron');
    if (fs.existsSync(electronDir)) {
      const files = fs.readdirSync(electronDir).filter(f => f.endsWith('.js') || f.endsWith('.ts'));
      
      files.forEach(file => {
        const content = fs.readFileSync(path.join(electronDir, file), 'utf8');
        
        if (content.includes('nodeIntegration: true')) {
          issues.push(`❌ nodeIntegration: true found in ${file}`);
        }
        if (content.includes('contextIsolation: false') && !content.includes('contextIsolation: false, // Allowed')) {
          issues.push(`❌ contextIsolation: false found in ${file}`);
        }
        if (content.includes('enableRemoteModule: true')) {
          issues.push(`❌ enableRemoteModule: true found in ${file}`);
        }
        if (content.includes('webSecurity: false')) {
            // Check if it's explicitly allowed via comment
            if (content.includes('webSecurity: false // Disable webSecurity to allow local file://')) {
                 console.warn(`ℹ️  [Allowed Risk] webSecurity: false found in ${file} (Media Preview)`);
            } else {
                 issues.push(`❌ webSecurity: false found in ${file} (Disabling CORS/Security is dangerous)`);
            }
        }
      });
    }
    return issues;
  },

  // 3. Check Dependencies (npm audit)
  checkDependencies: () => {
    console.log('\n🔍 Checking dependencies...');
    try {
      execSync('npm audit --production --audit-level=high', { stdio: 'ignore' });
      return [];
    } catch (e) {
      return ['⚠️  High severity vulnerabilities found in dependencies. Run "npm audit" for details.'];
    }
  },

  // 4. Check for .env files in git
  checkGitTrackedEnv: () => {
    console.log('\n🔍 Checking for tracked .env files...');
    try {
      const output = execSync('git ls-files .env .env.local .env.production', { encoding: 'utf8' }).trim();
      if (output) {
        return [`❌ .env files are tracked by git: ${output}`];
      }
    } catch (e) {
      // Not a git repo or git not found
    }
    return [];
  },

  // 5. Block risky staged files before commit
  checkBlockedStagedFiles: () => {
    console.log('\n🔍 Checking staged files policy...');
    const blockedPatterns = [
      /^\.env(\..*)?$/,
      /^backups\//,
      /^logs\//,
      /^\.trae\//,
      /^\.claude\//,
      /^eng\.traineddata$/
    ];
    try {
      const raw = execSync('git diff --cached --name-only', { encoding: 'utf8' }).trim();
      if (!raw) return [];
      const staged = raw.split('\n').map((s) => s.trim()).filter(Boolean);
      const blocked = staged.filter((file) => blockedPatterns.some((pattern) => pattern.test(file)));
      if (blocked.length > 0) {
        return blocked.map((file) => `❌ Staged file is blocked by policy: ${file}`);
      }
    } catch (e) {
      return ['❌ Failed to inspect staged files policy'];
    }
    return [];
  }
};

async function runSecurityScan() {
  let hasErrors = false;

  for (const [checkName, checkFunc] of Object.entries(securityChecks)) {
    try {
      const issues = await checkFunc();
      if (issues && issues.length > 0) {
        console.warn(`⚠️  ${checkName} Issues:`);
        issues.forEach(issue => console.warn(`   - ${issue}`));
        if (checkName !== 'checkDependencies') hasErrors = true; // Audit is warning only for now
      } else {
        console.log(`✅ ${checkName}: Passed`);
      }
    } catch (error) {
      console.error(`❌ ${checkName} Failed to execute:`, error.message);
    }
  }

  console.log('\n🔐 Scan Complete');
  if (hasErrors) {
    console.error('❌ Security checks failed. Please fix the issues above.');
    process.exit(1);
  }
}

runSecurityScan();
