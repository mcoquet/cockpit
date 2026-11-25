// How the schedule editor shows a schedule's next run (#54), in local time:
// "Today 18:30", "Tomorrow 09:00", "Mon 09:00" within the week, otherwise
// "Wed 2 Dec 09:05" (with the year when it isn't this year's).

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function formatNextRun(next: Date, now: Date = new Date()): string {
  const time = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
  const days = Math.round((startOfDay(next) - startOfDay(now)) / 86_400_000);
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  const weekday = WEEKDAYS[next.getDay()];
  if (days > 1 && days < 7) return `${weekday} ${time}`;
  const year = next.getFullYear() === now.getFullYear() ? '' : ` ${next.getFullYear()}`;
  return `${weekday} ${next.getDate()} ${MONTHS[next.getMonth()]}${year} ${time}`;
}
