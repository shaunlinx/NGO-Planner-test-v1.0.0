const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const dbManager = require('../databaseManager');
const skillRegistry = require('./skillRegistry');
const identityAnalyzer = require('./identityAnalyzer');

const SKILL_CACHE_FILE = 'skill_orchestrator_cache.json';

class SkillOrchestrator {
  constructor() {
    this.cachePath = path.join(app.getPath('userData'), SKILL_CACHE_FILE);
    this.activeSkills = new Set();
  }

  async init() {
    // Load cache
    try {
      if (fs.existsSync(this.cachePath)) {
        const raw = fs.readFileSync(this.cachePath, 'utf8');
        const data = JSON.parse(raw);
        if (Array.isArray(data.activeSkills)) {
          this.activeSkills = new Set(data.activeSkills);
        }
      }
    } catch (e) {
      console.error("[SkillOrchestrator] Failed to load cache:", e);
    }
  }

  async runAnalysisAndSync() {
    console.log("[SkillOrchestrator] Starting identity analysis...");
    
    // 1. Analyze Context
    const context = await identityAnalyzer.analyzeUserContext();
    console.log(`[SkillOrchestrator] Context analyzed: ${context.projects.length} projects, ${context.events.length} events.`);

    // 2. Match Skills
    const matchedSkills = skillRegistry.findMatchingSkills(context);
    console.log(`[SkillOrchestrator] Matched ${matchedSkills.length} skills:`, matchedSkills.map(s => s.id).join(', '));

    // 3. Install/Update Skills
    const openclawHome = await this._getOpenClawHome();
    const skillsDir = path.join(openclawHome, '.openclaw', 'workspace', 'skills');
    
    // Ensure directory exists
    await fs.promises.mkdir(skillsDir, { recursive: true });

    for (const skill of matchedSkills) {
      await this._installSkill(skillsDir, skill);
      this.activeSkills.add(skill.id);
    }

    // 4. Save Cache
    this._saveCache();

    return {
      success: true,
      context,
      matchedSkills
    };
  }

  async _getOpenClawHome() {
    const managedHome = await dbManager.getSetting('openclaw_managed_state_home');
    if (managedHome && typeof managedHome === 'string') return managedHome;
    return path.join(app.getPath('userData'), 'openclaw-state');
  }

  async _installSkill(baseDir, skill) {
    const skillDir = path.join(baseDir, skill.id);
    await fs.promises.mkdir(skillDir, { recursive: true });

    const config = skill.openclawConfig;
    const toolsList = (config.tools || []).map(t => `- ${t}`).join('\n');
    
    const content = `---
name: ${skill.id}
description: ${skill.description}
---

${config.systemPrompt}

You have access to the following tools:
${toolsList}

Usage Trigger:
This skill is activated because the user context matches: ${JSON.stringify(skill.triggerConditions)}
`;

    await fs.promises.writeFile(path.join(skillDir, 'SKILL.md'), content, 'utf8');
    console.log(`[SkillOrchestrator] Installed skill: ${skill.id}`);
  }

  _saveCache() {
    try {
      const data = {
        activeSkills: Array.from(this.activeSkills),
        lastRun: new Date().toISOString()
      };
      fs.writeFileSync(this.cachePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (e) {
      console.error("[SkillOrchestrator] Failed to save cache:", e);
    }
  }
}

module.exports = new SkillOrchestrator();
