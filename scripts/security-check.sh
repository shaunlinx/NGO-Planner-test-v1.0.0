#!/bin/bash

# Define colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${YELLOW}🔐 Daily Security Check Starting...${NC}"
EXIT_CODE=0

# 1. Check for Hardcoded Keys
echo -e "\n${YELLOW}🔍 Scanning for hardcoded secrets...${NC}"
# Exclude known non-secret files and directories
# Scan .js, .ts, .tsx, .json files
grep -rE "sk-[a-zA-Z0-9]{20,}" . \
    --include="*.js" --include="*.ts" --include="*.tsx" --include="*.json" \
    --exclude-dir="node_modules" \
    --exclude-dir="dist" \
    --exclude-dir="dist_electron" \
    --exclude-dir=".git" \
    --exclude="package-lock.json"

if [ $? -eq 0 ]; then
    echo -e "${RED}❌ Found potential hardcoded API keys!${NC}"
    EXIT_CODE=1
else
    echo -e "${GREEN}✅ No obvious hardcoded keys found.${NC}"
fi

# 2. Check Electron Security Configuration
echo -e "\n${YELLOW}🔍 Checking Electron security config...${NC}"
grep -r "nodeIntegration: true" electron/
if [ $? -eq 0 ]; then
    echo -e "${RED}❌ Found unsafe 'nodeIntegration: true' configuration!${NC}"
    EXIT_CODE=1
else
    echo -e "${GREEN}✅ nodeIntegration check passed.${NC}"
fi

grep -r "contextIsolation: false" electron/ | grep -v "// Allowed"
if [ $? -eq 0 ]; then
    echo -e "${RED}❌ Found unsafe 'contextIsolation: false' configuration!${NC}"
    EXIT_CODE=1
else
    echo -e "${GREEN}✅ contextIsolation check passed.${NC}"
fi

# 3. Check for Debugging Leftovers
echo -e "\n${YELLOW}🔍 Checking for debug code...${NC}"
grep -r "console\.log" electron/ components/ services/ utils/ --include="*.ts" --include="*.js" --include="*.tsx" | grep "process.env"
if [ $? -eq 0 ]; then
    echo -e "${YELLOW}⚠️  Found console.log printing process.env. Please verify this is safe.${NC}"
else
    echo -e "${GREEN}✅ No sensitive console logs found.${NC}"
fi

# 4. Check Dependencies
echo -e "\n${YELLOW}🔍 Checking dependencies...${NC}"
if command -v npm >/dev/null 2>&1; then
    npm audit --production --json | grep '"severity": "high"' > /dev/null
    if [ $? -eq 0 ]; then
        echo -e "${YELLOW}⚠️  Found high severity vulnerabilities. Run 'npm audit' for details.${NC}"
    else
        echo -e "${GREEN}✅ Dependency check passed.${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  npm not found, skipping dependency check.${NC}"
fi

# 5. Check for .env files committed to git
echo -e "\n${YELLOW}🔍 Checking for committed .env files...${NC}"
if git ls-files .env .env.local .env.production 2>/dev/null | grep -q ".env"; then
    echo -e "${RED}❌ Found .env file tracked by git!${NC}"
    EXIT_CODE=1
else
    echo -e "${GREEN}✅ No .env files tracked in git.${NC}"
fi

echo -e "\n${YELLOW}----------------------------------------${NC}"
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}✅ Security check completed successfully!${NC}"
else
    echo -e "${RED}❌ Security check failed. Please fix issues above.${NC}"
fi

exit $EXIT_CODE
