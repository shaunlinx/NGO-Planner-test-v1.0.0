
class EntityExtractor {
    /**
     * Extracts known entities from text.
     * @param {string} text - The content to analyze.
     * @param {string[]} knownProjects - List of existing project titles to look for.
     * @returns {Array<{name: string, type: string, confidence: number}>}
     */
    static extract(text, knownProjects = []) {
        if (!text) return [];
        
        const entities = [];
        const seen = new Set();

        // 1. Project Matching (Exact Match, Case Insensitive)
        // Sort projects by length descending to match longest titles first
        const sortedProjects = [...knownProjects].sort((a, b) => b.length - a.length);
        const lowerText = text.toLowerCase();

        for (const project of sortedProjects) {
            if (project.length < 3) continue; // Skip very short abbreviations to avoid noise
            
            if (lowerText.includes(project.toLowerCase())) {
                if (!seen.has(`project:${project}`)) {
                    entities.push({
                        name: project,
                        type: 'project',
                        confidence: 1.0
                    });
                    seen.add(`project:${project}`);
                }
            }
        }

        // 2. Email Extraction (Contacts)
        const emailRegex = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
        let match;
        while ((match = emailRegex.exec(text)) !== null) {
            const email = match[0];
            if (!seen.has(`contact:${email}`)) {
                entities.push({
                    name: email,
                    type: 'contact',
                    confidence: 0.9
                });
                seen.add(`contact:${email}`);
            }
        }

        return entities;
    }

    /**
     * Advanced extraction using LLM (DeepSeek/OpenAI).
     * @param {string} text - The content to analyze.
     * @param {object} embeddingService - The service to call completion.
     * @returns {Promise<Array<{name: string, type: string, confidence: number}>>}
     */
    static async extractWithLLM(text, embeddingService) {
        if (!text || text.length < 50) return [];
        
        // Truncate text to avoid token limits (e.g. first 2000 chars is usually enough for context)
        const sample = text.substring(0, 3000);

        const prompt = `You are a Data Analyst for an NGO. 
Extract key entities from the text below.
Focus on: 
1. **Projects** (Specific initiatives, e.g., "Project Alpha")
2. **People** (Names, Roles)
3. **Organizations** (Partners, Donors, Government bodies)
4. **Locations** (Cities, Regions)
5. **Events** (Conferences, Workshops)

Text Preview:
"""
${sample}
...
"""

Return a JSON array ONLY: 
[{"name": "Entity Name", "type": "project|person|org|location|event", "confidence": 0.9}]
Do not include generic terms like "The Project" or "Manager".
JSON ONLY.`;

        try {
            const response = await embeddingService.completion(prompt);
            const jsonStr = response.replace(/```json/g, '').replace(/```/g, '').trim();
            const result = JSON.parse(jsonStr);
            
            if (Array.isArray(result)) {
                return result.map(r => ({
                    name: r.name,
                    type: r.type ? r.type.toLowerCase() : 'unknown',
                    confidence: r.confidence || 0.8
                }));
            }
        } catch (e) {
            console.warn("LLM Entity Extraction failed:", e.message);
        }
        return [];
    }
}

module.exports = EntityExtractor;
