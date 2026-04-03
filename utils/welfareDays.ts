export interface WelfareDay {
    date: string; // Format: MM-DD
    title: string;
    description?: string;
}

export const WELFARE_DAYS: WelfareDay[] = [
    { date: '03-03', title: '全国爱耳日', description: '关注听力健康' },
    { date: '03-05', title: '学雷锋纪念日', description: '弘扬雷锋精神，开展志愿服务' },
    { date: '03-08', title: '国际妇女节', description: '庆祝妇女在经济、政治和社会等领域做出的贡献' },
    { date: '03-12', title: '植树节', description: '鼓励人们爱林造林' },
    { date: '03-21', title: '世界唐氏综合征日', description: '提高公众对唐氏综合征的认识' },
    { date: '03-22', title: '世界水日', description: '唤起公众的节水意识' },
    { date: '04-02', title: '世界自闭症日', description: '提高对自闭症的关注' },
    { date: '04-07', title: '世界卫生日', description: '关注全球健康问题' },
    { date: '04-22', title: '世界地球日', description: '世界性的环境保护活动' },
    { date: '05-08', title: '世界红十字日', description: '纪念红十字会创始人亨利·杜南' },
    { date: '05-12', title: '国际护士节', description: '纪念南丁格尔，激励护士工作' },
    { date: '05-15', title: '国际家庭日', description: '提高公众对家庭问题的认识' },
    { date: '05-20', title: '全国母乳喂养宣传日', description: '呼吁社会关注母乳喂养' },
    { date: '05-31', title: '世界无烟日', description: '宣扬不吸烟的理念' },
    { date: '06-01', title: '国际儿童节', description: '保障儿童权利' },
    { date: '06-05', title: '世界环境日', description: '提高环保意识' },
    { date: '06-14', title: '世界献血者日', description: '感谢自愿无偿献血者' },
    { date: '06-26', title: '国际禁毒日', description: '宣传毒品危害' },
    { date: '09-05', title: '中华慈善日', description: '鼓励社会各界参与慈善活动' },
    { date: '09-09', title: '99公益日', description: '中国互联网公益日' },
    { date: '09-10', title: '教师节', description: '感谢教师的贡献' },
    { date: '09-21', title: '世界阿尔茨海默病日', description: '关注老年痴呆症' },
    { date: '10-10', title: '世界精神卫生日', description: '提高对精神卫生的关注' },
    { date: '10-15', title: '国际盲人节', description: '关注盲人权益' },
    { date: '10-16', title: '世界粮食日', description: '关注粮食安全' },
    { date: '10-17', title: '国际消除贫困日', description: '关注全球贫困问题' },
    { date: '10-24', title: '联合国日', description: '纪念联合国宪章生效' },
    { date: '12-01', title: '世界艾滋病日', description: '宣传艾滋病预防知识' },
    { date: '12-03', title: '国际残疾人日', description: '促进残疾人融入社会' },
    { date: '12-05', title: '国际志愿者日', description: '赞扬和鼓励志愿者服务' },
];
