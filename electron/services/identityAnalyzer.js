const dbManager = require('../databaseManager');

/**
 * Analyzes the user's data (Time, Action, Knowledge) to build an identity profile.
 */
async function analyzeUserContext() {
  try {
    // 1. Action Dimension: Projects
    const projects = await dbManager.getAllProjects();
    const activeProjects = Array.isArray(projects) 
      ? projects.filter(p => p.status !== 'Completed' && p.status !== 'Archived') 
      : [];

    // 2. Time Dimension: Calendar Events (Future & Recent Past)
    const eventsRaw = await dbManager.getSetting('app_events');
    const events = Array.isArray(eventsRaw) ? eventsRaw : [];
    const now = Date.now();
    const upcomingEvents = events.filter(e => {
      const t = new Date(e.date).getTime();
      return t >= now && t <= now + 7 * 24 * 60 * 60 * 1000; // Next 7 days
    });

    // 3. Knowledge Dimension: Artifacts & Recent Files
    // (Simplification: Just counting artifacts for now as a proxy for activity)
    const artifacts = await dbManager.listAiArtifacts({ limit: 20 });

    // 4. Construct Context Object
    return {
      projects: activeProjects.map(p => ({
        id: p.id,
        title: p.title,
        description: p.description,
        status: p.status
      })),
      events: upcomingEvents.map(e => ({
        title: e.title,
        date: e.date,
        category: e.category
      })),
      recentArtifacts: artifacts.map(a => ({
        title: a.title,
        kind: a.kind
      })),
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    console.error("[IdentityAnalyzer] Failed to analyze context:", error);
    return { projects: [], events: [], recentArtifacts: [] };
  }
}

module.exports = {
  analyzeUserContext
};
