// A schedule's next run time (#54). Kept free of Electron so it can be
// unit-tested.
//
// node-cron, which fires the schedules, can't be relied on for this: its
// getNextRun() works only on a started task, can't be asked "after when", and
// its walker skips weekdays by whole years. So this uses cron-parser on the
// same expression, with one correction: node-cron fires only when EVERY field
// matches, so when both day of month and day of week are restricted, both must
// match (standard cron, and cron-parser, accept either).

import cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';

// Days examined at most when both day fields are restricted. A day-of-month set
// recurs at least every 4 years (29 Feb) and weekdays repeat on a 28-year cycle,
// so any combination that ever fires is found well within this.
const MAX_DAYS_EXAMINED = 2000;

/**
 * The first time after `from` (local time) that node-cron would fire
 * `cronExpression`, or null when node-cron rejects the expression or it never
 * fires.
 */
export function nextRunAt(cronExpression: string, from: Date = new Date()): Date | null {
  const expression = cronExpression.trim();
  if (!expression || !cron.validate(expression)) return null;
  try {
    const fields = expression.split(/\s+/);
    const offset = fields.length === 6 ? 1 : 0; // optional leading seconds field
    const dayOfMonth = fields[2 + offset];
    const dayOfWeek = fields[4 + offset];
    if (dayOfMonth === '*' || dayOfWeek === '*') {
      return CronExpressionParser.parse(expression, { currentDate: from }).next().toDate();
    }

    // Both restricted: walk the day-of-month matches, keep the first whose
    // weekday also matches.
    const weekdays = new Set<number>(
      CronExpressionParser.parse(expression).fields.dayOfWeek.values.map((d) => Number(d) % 7)
    );
    const domOnly = [...fields];
    domOnly[4 + offset] = '*';
    const domOnlyExpression = domOnly.join(' ');
    let cursor = from;
    for (let i = 0; i < MAX_DAYS_EXAMINED; i++) {
      const next = CronExpressionParser.parse(domOnlyExpression, { currentDate: cursor }).next().toDate();
      if (weekdays.has(next.getDay())) return next;
      // Skip the rest of that day
      cursor = new Date(next.getFullYear(), next.getMonth(), next.getDate(), 23, 59, 59, 999);
    }
    return null;
  } catch {
    return null;
  }
}
