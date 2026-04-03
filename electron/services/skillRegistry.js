const skills = [
  {
    id: "academic_researcher",
    name: "学术研究助手",
    description: "专为学生和研究人员设计。擅长查找文献、整理引用、生成摘要，并根据考试大纲制定复习计划。",
    category: "learning",
    tags: ["research", "student", "exam", "reading"],
    triggerConditions: {
      keywords: ["thesis", "exam", "study", "research", "paper", "论文", "考试", "复习", "研"],
      minProjectCount: 1
    },
    openclawConfig: {
      systemPrompt: "You are an expert Academic Researcher. Your goal is to help the user with their studies, exam preparation, and research papers. You have access to their Knowledge Base. Always cite sources. When they mention an exam, ask for the syllabus and help create a study schedule.",
      tools: ["kb_query", "calendar_list_events", "calendar_add_event"]
    }
  },
  {
    id: "project_manager_pro",
    name: "高级项目经理",
    description: "针对多项目并行的高效管理助手。自动跟踪里程碑、识别风险、协调资源，并在每日晨会时提供简报。",
    category: "productivity",
    tags: ["management", "planning", "risk"],
    triggerConditions: {
      keywords: ["project", "launch", "deadline", "milestone", "team", "项目", "上线", "交付"],
      minProjectCount: 3
    },
    openclawConfig: {
      systemPrompt: "You are a Senior Project Manager. You oversee the user's projects. Monitor deadlines closely. If a project is 'At Risk', proactively suggest mitigation strategies. Use the calendar to block time for deep work.",
      tools: ["projects_list", "projects_get", "calendar_list_events", "calendar_add_event"]
    }
  },
  {
    id: "content_creator",
    name: "内容创作引擎",
    description: "辅助自媒体与创作者。从知识库中提取灵感，自动生成大纲、脚本，并管理发布日历。",
    category: "creative",
    tags: ["writing", "blog", "video", "content"],
    triggerConditions: {
      keywords: ["blog", "video", "post", "article", "draft", "写作", "视频", "公众号"],
      minProjectCount: 1
    },
    openclawConfig: {
      systemPrompt: "You are a Creative Content Strategist. Help the user brainstorm ideas based on their notes. Draft outlines and scripts. Ensure consistency in tone. Suggest publishing dates based on the user's calendar.",
      tools: ["kb_query", "kb_list_files", "calendar_add_event"]
    }
  },
  {
    id: "life_coach",
    name: "生活平衡教练",
    description: "关注工作与生活的平衡。分析日程安排，提醒休息，并在高压期提供心理支持与鼓励。",
    category: "lifestyle",
    tags: ["health", "balance", "wellness"],
    triggerConditions: {
      keywords: ["health", "workout", "meditation", "stress", "life", "生活", "健康", "运动"],
      alwaysAvailable: true
    },
    openclawConfig: {
      systemPrompt: "You are a supportive Life Coach. Your job is to ensure the user maintains a healthy work-life balance. If you see a packed calendar, suggest a break. Offer encouragement when tasks are completed.",
      tools: ["calendar_list_events", "calendar_get_stats"]
    }
  }
];

module.exports = {
  getAllSkills: () => skills,
  getSkillById: (id) => skills.find(s => s.id === id),
  findMatchingSkills: (userContext) => {
    // Simple rule-based matching (can be enhanced with LLM later)
    return skills.filter(skill => {
      if (skill.triggerConditions.alwaysAvailable) return true;
      
      const contextText = (userContext.projects.map(p => p.title + " " + p.description).join(" ") + 
                          userContext.events.map(e => e.title).join(" ")).toLowerCase();
      
      const matchesKeyword = skill.triggerConditions.keywords.some(kw => contextText.includes(kw.toLowerCase()));
      const matchesProjectCount = (userContext.projects.length >= (skill.triggerConditions.minProjectCount || 0));
      
      return matchesKeyword && matchesProjectCount;
    });
  }
};
