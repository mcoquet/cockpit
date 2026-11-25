// Tests for a schedule's next run time (#54): computing it from the cron
// expression and labelling it for the schedule editor. Runs against compiled
// output in dist/main/. Times are local; pin the zone so the tests are stable.
process.env.TZ = 'UTC';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextRunAt } = require('../dist/main/main/next-run.js');
const { formatNextRun } = require('../dist/main/shared/next-run-label.js');

// Wednesday 25 November 2026, 10:00 UTC
const WED = new Date('2026-11-25T10:00:00Z');

test('weekdays at 9: on a Wednesday after 9, the next run is Thursday 09:00', () => {
  assert.equal(nextRunAt('0 9 * * 1-5', WED).toISOString(), '2026-11-26T09:00:00.000Z');
});

test('weekdays at 9: on a Friday after 9, the next run skips to Monday', () => {
  const fri = new Date('2026-11-27T10:00:00Z');
  assert.equal(nextRunAt('0 9 * * 1-5', fri).toISOString(), '2026-11-30T09:00:00.000Z');
});

test('daily at 18:30: later the same day', () => {
  assert.equal(nextRunAt('30 18 * * *', WED).toISOString(), '2026-11-25T18:30:00.000Z');
});

test('daily: an occurrence exactly now is not the next run', () => {
  const at9 = new Date('2026-11-25T09:00:00Z');
  assert.equal(nextRunAt('0 9 * * *', at9).toISOString(), '2026-11-26T09:00:00.000Z');
});

test('monthly on the 1st at 09:00: next month', () => {
  assert.equal(nextRunAt('0 9 1 * *', WED).toISOString(), '2026-12-01T09:00:00.000Z');
});

test('six-field cron with seconds, as node-cron accepts', () => {
  assert.equal(nextRunAt('30 0 9 * * *', WED).toISOString(), '2026-11-26T09:00:30.000Z');
});

test('invalid cron has no next run', () => {
  assert.equal(nextRunAt('not a cron', WED), null);
  assert.equal(nextRunAt('', WED), null);
  assert.equal(nextRunAt('99 9 * * *', WED), null);
  assert.equal(nextRunAt('0 9 * *', WED), null);
});

test('a date that never comes has no next run', () => {
  assert.equal(nextRunAt('0 9 31 2 *', WED), null);
});

test('label: same day says Today', () => {
  assert.equal(formatNextRun(new Date('2026-11-25T18:30:00Z'), WED), 'Today 18:30');
});

test('label: next day says Tomorrow', () => {
  assert.equal(formatNextRun(new Date('2026-11-26T09:00:00Z'), WED), 'Tomorrow 09:00');
});

test('label: within the week gives the weekday', () => {
  assert.equal(formatNextRun(new Date('2026-11-30T09:00:00Z'), WED), 'Mon 09:00');
});

test('label: a week or more away gives the date', () => {
  assert.equal(formatNextRun(new Date('2026-12-02T09:05:00Z'), WED), 'Wed 2 Dec 09:05');
  assert.equal(formatNextRun(new Date('2027-01-01T00:00:00Z'), WED), 'Fri 1 Jan 2027 00:00');
});
