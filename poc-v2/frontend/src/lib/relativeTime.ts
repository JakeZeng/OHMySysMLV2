/**
 * 相对时间格式化（M4.5 增量）。
 *
 * 返回"刚刚"/"3 分钟前"/"2 小时前"/"昨天"/"5 天前"/"3 个月前"/"2025-09-01"
 * 等人类友好的相对时间字符串。
 */

export function relativeTime(date: string | Date): string {
  const now = Date.now();
  const d = typeof date === 'string' ? new Date(date) : date;
  const diffMs = now - d.getTime();
  if (diffMs < 0) return d.toLocaleDateString(); // 未来时间直接显示日期

  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return '刚刚';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;

  const months = Math.floor(days / 30);
  if (months < 12) return `${months} 个月前`;

  // 超过一年显示完整日期
  return d.toLocaleDateString();
}
