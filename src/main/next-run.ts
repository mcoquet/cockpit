// A schedule's next run time (#54). node-cron (which runs the schedules) can
// only report the next run of a started task and cannot be asked "after when",
// so this uses cron-parser on the same expression. Kept free of Electron so it
// can be unit-tested.

import cron from 'node-cron';
import { CronExpressionParser } from 'cron-parser';

/**
 * The first time after `from` (local time) that `cronExpression` fires, or
 * null when node-cron would reject the expression or it never fires.
 */
export function nextRunAt(cronExpression: string, from: Date = new Date()): Date | null {
  const expression = cronExpression.trim();
  if (!expression || !cron.validate(expression)) return null;
  try {
    return CronExpressionParser.parse(expression, { currentDate: from }).next().toDate();
  } catch {
    return null;
  }
}
