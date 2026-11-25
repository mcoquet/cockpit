// The next run across a clock change (#54). A separate file because the time
// zone must be set before any date is made.
process.env.TZ = 'Europe/Lisbon';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { nextRunAt } = require('../dist/main/main/next-run.js');

test('a time skipped when clocks go forward has no run that day', () => {
  // Clocks go from 01:00 to 02:00 on Sunday 28 March 2027 in Lisbon
  const sat = new Date(2027, 2, 27, 12, 0, 0);
  const next = nextRunAt('30 1 * * *', sat);
  assert.equal(next.getDate(), 29);
  assert.equal(next.getHours(), 1);
  assert.equal(next.getMinutes(), 30);
});
