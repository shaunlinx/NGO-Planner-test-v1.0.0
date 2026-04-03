export const getDaysInMonth = (year: number, month: number) => {
  return new Date(year, month + 1, 0).getDate();
};

export const getFirstDayOfMonth = (year: number, month: number) => {
  return new Date(year, month, 1).getDay(); // 0 = Sunday
};

const CHINESE_NUMBERS = ['〇', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
const CHINESE_MONTHS = ['正月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '冬月', '腊月'];

const getChineseDay = (day: number): string => {
  if (day === 10) return '初十';
  if (day === 20) return '二十';
  if (day === 30) return '三十';
  const digit = day % 10;
  if (day < 11) return '初' + CHINESE_NUMBERS[digit];
  if (day < 20) return '十' + CHINESE_NUMBERS[digit];
  if (day < 30) return '廿' + CHINESE_NUMBERS[digit]; // 21-29
  return '三十'; 
};

const getChineseMonth = (month: number): string => {
  return CHINESE_MONTHS[month - 1] || `${month}月`;
};

// Simplified Lunar date formatter using Intl with manual mapping for consistency
export const getLunarDateString = (date: Date): string => {
  try {
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      calendar: 'chinese',
      day: 'numeric',
      month: 'numeric',
    });
    const parts = formatter.formatToParts(date);
    
    const monthPart = parts.find(p => p.type === 'month')?.value;
    const dayPart = parts.find(p => p.type === 'day')?.value;
    
    if (!monthPart || !dayPart) return '';

    let dayStr = dayPart;
    let monthStr = monthPart;

    // Convert numeric Day to Chinese if needed
    const dayNum = parseInt(dayPart.replace(/[^\d]/g, ''), 10);
    if (!isNaN(dayNum)) {
       dayStr = getChineseDay(dayNum);
    }

    // Convert numeric Month to Chinese if needed
    const isLeap = monthPart.includes('闰');
    const monthNum = parseInt(monthPart.replace(/[^\d]/g, ''), 10);
    if (!isNaN(monthNum)) {
       monthStr = (isLeap ? '闰' : '') + getChineseMonth(monthNum);
    } else {
       // Normalize standard text returns if necessary
       if (monthPart === '一月') monthStr = '正月';
       if (monthPart === '十一月') monthStr = '冬月';
       if (monthPart === '十二月') monthStr = '腊月';
    }

    // Logic: If day is Start of month (初一), show Month. Else show Day.
    if (dayStr === '初一') {
        return monthStr;
    }
    return dayStr;

  } catch (e) {
    console.error(e);
    return "";
  }
};

export const isWeekend = (date: Date): boolean => {
  const day = date.getDay();
  return day === 0 || day === 6;
};

export const formatDate = (date: Date): string => {
  // Use local time for date string to avoid timezone shifts
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export const addDays = (date: Date, days: number): Date => {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
};
