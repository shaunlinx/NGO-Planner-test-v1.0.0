


import { CalendarEvent, NgoDomain, EventCategory } from './types';

// --- Deployment Configuration ---
// SECURITY NOTE: Keep this EMPTY in source code. 
// Do NOT hardcode proxy URLs here if they contain embedded secrets.
export const DEFAULT_API_BASE_URL: string = ''; 

// DeepSeek Configuration
export const DEEPSEEK_API_URL = 'https://api.deepseek.com';
export const DEEPSEEK_MODEL = 'deepseek-chat';

export const DOMAINS: NgoDomain[] = [
  '儿童', '妇女', '老人', '残障', '青年', 
  '环保', '医疗', '可持续', '教育', 
  '动物保护', '社区发展', '其他'
];

export const CATEGORY_COLORS: Record<string, string> = {
  'Western': 'bg-blue-50 text-blue-700 border-blue-200',
  'SolarTerm': 'bg-green-50 text-green-700 border-green-200',
  'Traditional': 'bg-red-50 text-red-700 border-red-200',
  'InternationalDay': 'bg-ngo-teal-light/10 text-ngo-teal-dark border-ngo-teal/20', // Used for '公益节日'
  'PublicHoliday': 'bg-pink-100 text-pink-700 border-pink-200',
  'Custom': 'bg-purple-50 text-purple-700 border-purple-200',
  'Personal': 'bg-indigo-50 text-indigo-700 border-indigo-200',
};

export const CATEGORY_LABELS: Record<EventCategory, string> = {
  'Western': '西方节日',
  'SolarTerm': '二十四节气',
  'Traditional': '传统节日',
  'InternationalDay': '国际/公益日',
  'PublicHoliday': '法定节假日',
  'Custom': '自定义节点',
  'Personal': '个人日程'
};

// --- Customization Options Constants ---
export const PLATFORM_OPTIONS = [
  '微信公众号', '视频号', '小红书', '抖音', '微博', 'B站', '快手', '朋友圈'
];

export const CONTENT_FORMAT_OPTIONS = [
  '图文文章', '短视频', '海报/长图', '直播', 'H5互动', '播客/音频'
];

// Granular Event Cycle Options
export const EVENT_CYCLE_OPTIONS = [
  '半天 (单场讲座/沙龙)',
  '1天 (全天活动/快闪)',
  '2-3天 (周末集市/训练营)',
  '1周 (主题周/传播周)',
  '1个月 (主题月/筹款月)',
  '1季度 (长期项目启动)',
  '1年 (年度战略项目)'
];

export const EVENT_SCALE_OPTIONS = [
  '微型 (社区/小组 <50人)', '小型 (50-200人)', '中型 (200-1000人)', '大型 (1000人+)'
];

export const BUDGET_TIERS = [
    { label: '0', desc: '纯志愿/资源置换', value: '0元 (无预算)' },
    { label: '<500', desc: '微型物料支持', value: '500元以内' },
    { label: '500-1k', desc: '小组活动', value: '500-1,000元' },
    { label: '1k-3k', desc: '社区小型活动', value: '1,000-3,000元' },
    { label: '3k-5k', desc: '标准小型活动', value: '3,000-5,000元' },
    { label: '5k-1w', desc: '中型单场活动', value: '5,000-10,000元' },
    { label: '1w-2w', desc: '中型系列活动', value: '10,000-20,000元' },
    { label: '2w-5w', desc: '大型策划/视频', value: '20,000-50,000元' },
    { label: '5w-10w', desc: '年度重点项目', value: '50,000-100,000元' },
    { label: '10w-30w', desc: '大型专项行动', value: '100,000-300,000元' },
    { label: '>30w', desc: '重大战略项目', value: '300,000元以上' }
];

// --- POSTER STUDIO CONSTANTS ---
export const POSTER_STYLES = [
    '扁平插画 (Flat)', '3D 渲染 (C4D)', '极简商务 (Minimalist)', '弥散光感 (Gradient)',
    '中国风水墨 (Ink)', '赛博朋克 (Cyberpunk)', '粘土风 (Clay)', '真实摄影 (Photo)'
];

export const POSTER_PLATFORMS = [
    { label: '小红书', ratio: '3:4', icon: '📕' },
    { label: '朋友圈', ratio: '1:1', icon: '⭕' },
    { label: '公众号', ratio: '2.35:1', icon: '📰' },
    { label: '视频号/抖音', ratio: '9:16', icon: '🎬' },
    { label: 'B站', ratio: '16:9', icon: '📺' },
    { label: '微博', ratio: '1:1', icon: '🧣' },
    { label: '微信群', ratio: '3:4', icon: '💬' }
];

export const POSTER_COLORS = [
    { label: '莫兰迪', value: 'Morandi colors, muted tones', hex: '#8C9E9E' },
    { label: '多巴胺', value: 'Dopamine, bright and vibrant', hex: '#FF6B6B' },
    { label: '黑金', value: 'Black and Gold luxury', hex: '#2C2C2C' },
    { label: '党建红', value: 'Official Red and Yellow', hex: '#E60000' },
    { label: '自然绿', value: 'Nature Green, Eco-friendly', hex: '#4CAF50' },
    { label: '科技蓝', value: 'Tech Blue, Futuristic', hex: '#2196F3' },
    { label: '温暖橙', value: 'Warm Orange, Community', hex: '#FF9800' },
    { label: '公益紫', value: 'Charity Purple, Noble', hex: '#9C27B0' }
];

// Helper to generate a sequence of events for multi-day holidays
const generateEventRange = (
  title: string, 
  startDateStr: string, 
  durationDays: number, 
  category: EventCategory, 
  isPublicHoliday: boolean = false,
  domains: NgoDomain[] = []
): CalendarEvent[] => {
  const events: CalendarEvent[] = [];
  const start = new Date(startDateStr);
  
  for (let i = 0; i < durationDays; i++) {
    const current = new Date(start);
    current.setDate(start.getDate() + i);
    const dateStr = `${current.getFullYear()}-${String(current.getMonth() + 1).padStart(2, '0')}-${String(current.getDate()).padStart(2, '0')}`;
    
    events.push({
      id: `range-${dateStr}-${title}`,
      title: title + (durationDays > 1 ? (i === 0 ? ' (开始)' : '') : ''), // Only mark start distinctively if needed, or just keep same title
      date: dateStr,
      category,
      isPublicHoliday,
      relevantDomains: domains
    });
  }
  return events;
};

// Helper to generate recurring events for 2025, 2026, 2027 (Single Day)
const generateRecurringEvents = (years: number[]): CalendarEvent[] => {
  const events: CalendarEvent[] = [];
  
  const recurring: Partial<CalendarEvent & { month: number, day: number }>[] = [
    // --- Specific Chinese Charity Days ---
    { month: 5, day: 20, title: '520社会责任日', category: 'InternationalDay', relevantDomains: ['可持续', '社区发展'] },
    { month: 5, day: 8, title: '世界微笑日', category: 'InternationalDay' }, // Often used by NGOs
    
    // --- Existing International/Charity Days ---
    { month: 3, day: 8, title: '国际妇女节', category: 'InternationalDay', relevantDomains: ['妇女'] },
    { month: 3, day: 21, title: '世界森林日', category: 'InternationalDay', relevantDomains: ['环保', '可持续'] },
    { month: 3, day: 22, title: '世界水日', category: 'InternationalDay', relevantDomains: ['环保', '可持续'] },
    { month: 4, day: 2, title: '世界自闭症日', category: 'InternationalDay', relevantDomains: ['儿童', '残障', '医疗'] },
    { month: 4, day: 7, title: '世界卫生日', category: 'InternationalDay', relevantDomains: ['医疗'] },
    { month: 4, day: 22, title: '世界地球日', category: 'InternationalDay', relevantDomains: ['环保', '可持续'] },
    { month: 5, day: 8, title: '世界红十字日', category: 'InternationalDay', relevantDomains: ['医疗'] },
    { month: 5, day: 12, title: '国际护士节', category: 'InternationalDay', relevantDomains: ['医疗'] },
    { month: 5, day: 31, title: '世界无烟日', category: 'InternationalDay', relevantDomains: ['医疗'] },
    { month: 6, day: 1, title: '儿童节', category: 'InternationalDay', isPublicHoliday: false, relevantDomains: ['儿童', '教育'] },
    { month: 6, day: 5, title: '世界环境日', category: 'InternationalDay', relevantDomains: ['环保', '可持续'] },
    { month: 6, day: 8, title: '世界海洋日', category: 'InternationalDay', relevantDomains: ['环保', '动物保护'] },
    { month: 9, day: 5, title: '中华慈善日', category: 'InternationalDay' }, 
    { month: 9, day: 10, title: '教师节', category: 'InternationalDay', relevantDomains: ['教育', '儿童', '青年'] },
    { month: 9, day: 21, title: '国际和平日', category: 'InternationalDay', relevantDomains: ['社区发展'] },
    { month: 10, day: 10, title: '世界精神卫生日', category: 'InternationalDay', relevantDomains: ['医疗'] },
    { month: 10, day: 16, title: '世界粮食日', category: 'InternationalDay', relevantDomains: ['可持续', '社区发展'] },
    { month: 10, day: 17, title: '国际消除贫困日', category: 'InternationalDay', relevantDomains: ['社区发展'] },
    { month: 11, day: 20, title: '世界儿童日', category: 'InternationalDay', relevantDomains: ['儿童'] },
    { month: 12, day: 1, title: '世界艾滋病日', category: 'InternationalDay', relevantDomains: ['医疗'] },
    { month: 12, day: 3, title: '国际残疾人日', category: 'InternationalDay', relevantDomains: ['残障'] },
    { month: 12, day: 5, title: '国际志愿者日', category: 'InternationalDay' },
    { month: 12, day: 10, title: '世界人权日', category: 'InternationalDay' },

    // Western Festivals
    { month: 2, day: 14, title: '情人节', category: 'Western', relevantDomains: ['青年'] },
    { month: 10, day: 31, title: '万圣节前夜', category: 'Western', relevantDomains: ['青年', '儿童'] },
    { month: 11, day: 1, title: '万圣节', category: 'Western', relevantDomains: ['青年', '儿童'] },
    { month: 12, day: 24, title: '平安夜', category: 'Western' },
    { month: 12, day: 25, title: '圣诞节', category: 'Western' },
  ];

  years.forEach(year => {
    recurring.forEach((evt, index) => {
      events.push({
        id: `rec-${year}-${evt.month}-${evt.day}-${index}`,
        title: evt.title!,
        date: `${year}-${String(evt.month).padStart(2, '0')}-${String(evt.day).padStart(2, '0')}`,
        category: evt.category as any,
        isPublicHoliday: evt.isPublicHoliday,
        relevantDomains: evt.relevantDomains
      });
    });
  });

  return events;
};

// Generate Specific Ranges for Holidays and Special Multi-day Charity Events (99 Giving Day)
const getRangeEvents = (): CalendarEvent[] => {
  return [
    // --- 2025 Holidays ---
    ...generateEventRange('元旦', '2025-01-01', 1, 'PublicHoliday', true),
    // Spring Festival 2025 (Jan 28 Eve - Feb 4) - approx 8 days including adjustments
    ...generateEventRange('春节假期', '2025-01-28', 8, 'PublicHoliday', true),
    ...generateEventRange('清明节假期', '2025-04-04', 3, 'PublicHoliday', true),
    ...generateEventRange('劳动节假期', '2025-05-01', 5, 'PublicHoliday', true),
    ...generateEventRange('端午节假期', '2025-05-31', 3, 'PublicHoliday', true),
    ...generateEventRange('国庆节假期', '2025-10-01', 7, 'PublicHoliday', true),
    ...generateEventRange('中秋节假期', '2025-10-06', 1, 'PublicHoliday', true), // 2025 Mid-Autumn is distinct or close to National Day
    
    // --- 2025 Charity Events (Multi-day) ---
    ...generateEventRange('99公益日', '2025-09-07', 3, 'InternationalDay', false, ['其他']),

    // --- 2026 Holidays (Estimated based on standard duration) ---
    ...generateEventRange('元旦', '2026-01-01', 1, 'PublicHoliday', true),
    ...generateEventRange('春节假期', '2026-02-16', 7, 'PublicHoliday', true), // Feb 17 is NY
    ...generateEventRange('清明节假期', '2026-04-05', 3, 'PublicHoliday', true),
    ...generateEventRange('劳动节假期', '2026-05-01', 5, 'PublicHoliday', true),
    ...generateEventRange('端午节假期', '2026-06-19', 3, 'PublicHoliday', true),
    ...generateEventRange('国庆节假期', '2026-10-01', 7, 'PublicHoliday', true),
    ...generateEventRange('中秋节假期', '2026-09-25', 1, 'PublicHoliday', true),

    // --- 2026 Charity Events ---
    ...generateEventRange('99公益日', '2026-09-07', 3, 'InternationalDay', false, ['其他']),

    // --- 2027 Holidays (Estimated) ---
    ...generateEventRange('元旦', '2027-01-01', 1, 'PublicHoliday', true),
    ...generateEventRange('春节假期', '2027-02-05', 7, 'PublicHoliday', true), // Feb 6 is NY
    ...generateEventRange('清明节假期', '2027-04-05', 3, 'PublicHoliday', true),
    ...generateEventRange('劳动节假期', '2027-05-01', 5, 'PublicHoliday', true),
    ...generateEventRange('端午节假期', '2027-06-09', 3, 'PublicHoliday', true),
    ...generateEventRange('国庆节假期', '2027-10-01', 7, 'PublicHoliday', true),
    ...generateEventRange('中秋节假期', '2027-09-15', 1, 'PublicHoliday', true),

    // --- 2027 Charity Events ---
    ...generateEventRange('99公益日', '2027-09-07', 3, 'InternationalDay', false, ['其他']),
  ];
};

// Comprehensive list of variable date events (Solar terms and Traditional Festivals) for 2025-2027
const getVariableEvents = (): CalendarEvent[] => {
  return [
    // --- 2025 ---
    // Traditional (Only single days marks, Holiday ranges cover the days off)
    { id: 'tr-2025-01-29', title: '春节(正日)', date: '2025-01-29', category: 'Traditional', isPublicHoliday: true },
    { id: 'tr-2025-02-12', title: '元宵节', date: '2025-02-12', category: 'Traditional' },
    { id: 'tr-2025-04-04', title: '清明', date: '2025-04-04', category: 'SolarTerm', isPublicHoliday: true },
    { id: 'tr-2025-05-31', title: '端午', date: '2025-05-31', category: 'Traditional', isPublicHoliday: true },
    { id: 'tr-2025-08-02', title: '七夕节', date: '2025-08-02', category: 'Traditional' },
    { id: 'tr-2025-10-06', title: '中秋', date: '2025-10-06', category: 'Traditional', isPublicHoliday: true },
    { id: 'tr-2025-10-29', title: '重阳节', date: '2025-10-29', category: 'Traditional', relevantDomains: ['老人'] },
    { id: 'tr-2025-01-23', title: '小年', date: '2025-01-23', category: 'Traditional' },

    // Solar Terms 2025 (Complete 24)
    { id: 'st-2025-01-05', title: '小寒', date: '2025-01-05', category: 'SolarTerm' },
    { id: 'st-2025-01-20', title: '大寒', date: '2025-01-20', category: 'SolarTerm' },
    { id: 'st-2025-02-03', title: '立春', date: '2025-02-03', category: 'SolarTerm' },
    { id: 'st-2025-02-18', title: '雨水', date: '2025-02-18', category: 'SolarTerm' },
    { id: 'st-2025-03-05', title: '惊蛰', date: '2025-03-05', category: 'SolarTerm' },
    { id: 'st-2025-03-20', title: '春分', date: '2025-03-20', category: 'SolarTerm' },
    { id: 'st-2025-04-19', title: '谷雨', date: '2025-04-19', category: 'SolarTerm' },
    { id: 'st-2025-05-05', title: '立夏', date: '2025-05-05', category: 'SolarTerm' },
    { id: 'st-2025-05-20', title: '小满', date: '2025-05-20', category: 'SolarTerm' },
    { id: 'st-2025-06-05', title: '芒种', date: '2025-06-05', category: 'SolarTerm' },
    { id: 'st-2025-06-21', title: '夏至', date: '2025-06-21', category: 'SolarTerm' },
    { id: 'st-2025-07-07', title: '小暑', date: '2025-07-07', category: 'SolarTerm' },
    { id: 'st-2025-07-22', title: '大暑', date: '2025-07-22', category: 'SolarTerm' },
    { id: 'st-2025-08-07', title: '立秋', date: '2025-08-07', category: 'SolarTerm' },
    { id: 'st-2025-08-23', title: '处暑', date: '2025-08-23', category: 'SolarTerm' },
    { id: 'st-2025-09-07', title: '白露', date: '2025-09-07', category: 'SolarTerm' },
    { id: 'st-2025-09-23', title: '秋分', date: '2025-09-23', category: 'SolarTerm' },
    { id: 'st-2025-10-08', title: '寒露', date: '2025-10-08', category: 'SolarTerm' },
    { id: 'st-2025-10-23', title: '霜降', date: '2025-10-23', category: 'SolarTerm' },
    { id: 'st-2025-11-07', title: '立冬', date: '2025-11-07', category: 'SolarTerm' },
    { id: 'st-2025-11-22', title: '小雪', date: '2025-11-22', category: 'SolarTerm' },
    { id: 'st-2025-12-07', title: '大雪', date: '2025-12-07', category: 'SolarTerm' },
    { id: 'st-2025-12-21', title: '冬至', date: '2025-12-21', category: 'SolarTerm' },

    // --- 2026 ---
    // Traditional
    { id: 'tr-2026-02-17', title: '春节(正日)', date: '2026-02-17', category: 'Traditional', isPublicHoliday: true },
    { id: 'tr-2026-03-04', title: '元宵节', date: '2026-03-04', category: 'Traditional' },
    { id: 'tr-2026-04-05', title: '清明', date: '2026-04-05', category: 'SolarTerm', isPublicHoliday: true },
    { id: 'tr-2026-06-19', title: '端午', date: '2026-06-19', category: 'Traditional', isPublicHoliday: true },
    { id: 'tr-2026-08-22', title: '七夕节', date: '2026-08-22', category: 'Traditional' },
    { id: 'tr-2026-09-25', title: '中秋', date: '2026-09-25', category: 'Traditional', isPublicHoliday: true },
    { id: 'tr-2026-10-18', title: '重阳节', date: '2026-10-18', category: 'Traditional', relevantDomains: ['老人'] },
    { id: 'tr-2026-02-11', title: '小年', date: '2026-02-11', category: 'Traditional' },

    // Solar Terms 2026
    { id: 'st-2026-01-05', title: '小寒', date: '2026-01-05', category: 'SolarTerm' },
    { id: 'st-2026-01-20', title: '大寒', date: '2026-01-20', category: 'SolarTerm' },
    { id: 'st-2026-02-04', title: '立春', date: '2026-02-04', category: 'SolarTerm' },
    { id: 'st-2026-02-18', title: '雨水', date: '2026-02-18', category: 'SolarTerm' },
    { id: 'st-2026-03-05', title: '惊蛰', date: '2026-03-05', category: 'SolarTerm' },
    { id: 'st-2026-03-20', title: '春分', date: '2026-03-20', category: 'SolarTerm' },
    { id: 'st-2026-04-05', title: '清明', date: '2026-04-05', category: 'SolarTerm' }, 
    { id: 'st-2026-04-20', title: '谷雨', date: '2026-04-20', category: 'SolarTerm' },
    { id: 'st-2026-05-05', title: '立夏', date: '2026-05-05', category: 'SolarTerm' },
    { id: 'st-2026-05-21', title: '小满', date: '2026-05-21', category: 'SolarTerm' },
    { id: 'st-2026-06-05', title: '芒种', date: '2026-06-05', category: 'SolarTerm' },
    { id: 'st-2026-06-21', title: '夏至', date: '2026-06-21', category: 'SolarTerm' },
    { id: 'st-2026-07-07', title: '小暑', date: '2026-07-07', category: 'SolarTerm' },
    { id: 'st-2026-07-23', title: '大暑', date: '2026-07-23', category: 'SolarTerm' },
    { id: 'st-2026-08-07', title: '立秋', date: '2026-08-07', category: 'SolarTerm' },
    { id: 'st-2026-08-23', title: '处暑', date: '2026-08-23', category: 'SolarTerm' },
    { id: 'st-2026-09-07', title: '白露', date: '2026-09-07', category: 'SolarTerm' },
    { id: 'st-2026-09-23', title: '秋分', date: '2026-09-23', category: 'SolarTerm' },
    { id: 'st-2026-10-08', title: '寒露', date: '2026-10-08', category: 'SolarTerm' },
    { id: 'st-2026-10-23', title: '霜降', date: '2026-10-23', category: 'SolarTerm' },
    { id: 'st-2026-11-07', title: '立冬', date: '2026-11-07', category: 'SolarTerm' },
    { id: 'st-2026-11-22', title: '小雪', date: '2026-11-22', category: 'SolarTerm' },
    { id: 'st-2026-12-07', title: '大雪', date: '2026-12-07', category: 'SolarTerm' },
    { id: 'st-2026-12-22', title: '冬至', date: '2026-12-22', category: 'SolarTerm' },

    // --- 2027 ---
    // Traditional
    { id: 'tr-2027-02-06', title: '春节(正日)', date: '2027-02-06', category: 'Traditional', isPublicHoliday: true },
    { id: 'tr-2027-02-20', title: '元宵节', date: '2027-02-20', category: 'Traditional' },
    { id: 'tr-2027-04-05', title: '清明', date: '2027-04-05', category: 'SolarTerm', isPublicHoliday: true },
    { id: 'tr-2027-06-09', title: '端午', date: '2027-06-09', category: 'Traditional', isPublicHoliday: true },
    { id: 'tr-2027-08-11', title: '七夕节', date: '2027-08-11', category: 'Traditional' },
    { id: 'tr-2027-09-15', title: '中秋', date: '2027-09-15', category: 'Traditional', isPublicHoliday: true },
    { id: 'tr-2027-10-07', title: '重阳节', date: '2027-10-07', category: 'Traditional', relevantDomains: ['老人'] },
    { id: 'tr-2027-01-31', title: '小年', date: '2027-01-31', category: 'Traditional' },
    
    // Solar Terms 2027
    { id: 'st-2027-01-05', title: '小寒', date: '2027-01-05', category: 'SolarTerm' },
    { id: 'st-2027-01-20', title: '大寒', date: '2027-01-20', category: 'SolarTerm' },
    { id: 'st-2027-02-04', title: '立春', date: '2027-02-04', category: 'SolarTerm' },
    { id: 'st-2027-02-18', title: '雨水', date: '2027-02-18', category: 'SolarTerm' },
    { id: 'st-2027-03-06', title: '惊蛰', date: '2027-03-06', category: 'SolarTerm' },
    { id: 'st-2027-03-21', title: '春分', date: '2027-03-21', category: 'SolarTerm' },
    { id: 'st-2027-04-05', title: '清明', date: '2027-04-05', category: 'SolarTerm' },
    { id: 'st-2027-04-20', title: '谷雨', date: '2027-04-20', category: 'SolarTerm' },
    { id: 'st-2027-05-06', title: '立夏', date: '2027-05-06', category: 'SolarTerm' },
    { id: 'st-2027-05-21', title: '小满', date: '2027-05-21', category: 'SolarTerm' },
    { id: 'st-2027-06-06', title: '芒种', date: '2027-06-06', category: 'SolarTerm' },
    { id: 'st-2027-06-21', title: '夏至', date: '2027-06-21', category: 'SolarTerm' },
    { id: 'st-2027-07-07', title: '小暑', date: '2027-07-07', category: 'SolarTerm' },
    { id: 'st-2027-07-23', title: '大暑', date: '2027-07-23', category: 'SolarTerm' },
    { id: 'st-2027-08-08', title: '立秋', date: '2027-08-08', category: 'SolarTerm' },
    { id: 'st-2027-08-23', title: '处暑', date: '2027-08-23', category: 'SolarTerm' },
    { id: 'st-2027-09-08', title: '白露', date: '2027-09-08', category: 'SolarTerm' },
    { id: 'st-2027-09-23', title: '秋分', date: '2027-09-23', category: 'SolarTerm' },
    { id: 'st-2027-10-08', title: '寒露', date: '2027-10-08', category: 'SolarTerm' },
    { id: 'st-2027-10-24', title: '霜降', date: '2027-10-24', category: 'SolarTerm' },
    { id: 'st-2027-11-08', title: '立冬', date: '2027-11-08', category: 'SolarTerm' },
    { id: 'st-2027-11-22', title: '小雪', date: '2027-11-22', category: 'SolarTerm' },
    { id: 'st-2027-12-07', title: '大雪', date: '2027-12-07', category: 'SolarTerm' },
    { id: 'st-2027-12-22', title: '冬至', date: '2027-12-22', category: 'SolarTerm' },
  ];
}

const yearList = [2025, 2026, 2027];
export const MOCK_EVENTS: CalendarEvent[] = [
  ...generateRecurringEvents(yearList),
  ...getRangeEvents(),
  ...getVariableEvents()
];
