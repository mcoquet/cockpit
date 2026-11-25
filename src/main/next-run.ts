// A schedule's next run time (#54). Kept free of Electron so it can be
// unit-tested.
//
// node-cron fires a schedule at every local second whose parts are all in the
// value sets it converts the cron expression into. It reads some expressions
// differently from standard cron (full day names, `7` in ranges, `5/15`, `#`,
// both day fields having to match), so the next run is worked out from those
// same sets rather than from a separate cron parser. node-cron's own
// getNextRun() can't be used: it needs a started task, can't be asked "after
// when", and its walker skips weekdays by whole years.

import path from 'path';
import cron from 'node-cron';

// node-cron's expression-to-value-sets conversion. Its package exports don't
// expose it, so it is loaded by file; the tests check the result against
// node-cron's own matcher, so a layout change in node-cron fails them.
const convertExpression: (expression: string) => number[][] = require(
  path.join(path.dirname(require.resolve('node-cron')), 'pattern', 'convertion', 'index.js')
).default;

// Days looked at before giving up. Weekdays and dates repeat on a 28-year
// cycle, so anything that ever fires is found within it.
const MAX_DAYS = 29 * 366;

/**
 * The first time after `from` (local time, to the second) that node-cron would
 * fire `cronExpression`, or null when node-cron rejects it or it never fires.
 */
export function nextRunAt(cronExpression: string, from: Date = new Date()): Date | null {
  const expression = cronExpression.trim();
  if (!expression || !cron.validate(expression)) return null;

  let fields: number[][];
  try {
    fields = convertExpression(expression).map((values) =>
      [...new Set(values)].filter((v) => Number.isInteger(v)).sort((a, b) => a - b)
    );
  } catch {
    return null;
  }
  const [seconds, minutes, hours, days, months, weekdays] = fields;

  const earliest = Math.floor(from.getTime() / 1000) * 1000 + 1000;
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  for (let d = 0; d < MAX_DAYS; d++) {
    const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d);
    if (
      !months.includes(day.getMonth() + 1) ||
      !days.includes(day.getDate()) ||
      !weekdays.includes(day.getDay())
    ) {
      continue;
    }
    for (const h of hours) {
      for (const m of minutes) {
        for (const s of seconds) {
          const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, s);
          // A local time skipped when clocks go forward never comes, so never fires
          if (at.getDate() !== day.getDate() || at.getHours() !== h || at.getMinutes() !== m) continue;
          if (at.getTime() >= earliest) return at;
        }
      }
    }
  }
  return null;
}
