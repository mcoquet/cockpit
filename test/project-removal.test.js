// Tests for removing a project's schedules with the project (#53).
// Runs against compiled output in dist/main/.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  partitionProjectSchedules,
  buildRemoveDialogText,
} = require('../dist/main/main/project-removal.js');

function schedule(id, projectPath, name = id, cron = '0 9 * * *') {
  return { id, projectPath, name, cron };
}

test('partition removes only the project\'s schedules and their runs', () => {
  const schedules = [
    schedule('a', 'Projects/foo'),
    schedule('b', 'Projects/bar'),
    schedule('c', 'Projects/foo'),
  ];
  const runs = [
    { id: 'r1', scheduleId: 'a' },
    { id: 'r2', scheduleId: 'b' },
    { id: 'r3', scheduleId: 'c' },
    { id: 'r4', scheduleId: 'b' },
  ];
  const result = partitionProjectSchedules(schedules, runs, 'Projects/foo');
  assert.deepEqual(result.removedIds, ['a', 'c']);
  assert.deepEqual(result.keptSchedules.map((s) => s.id), ['b']);
  assert.deepEqual(result.keptRuns.map((r) => r.id), ['r2', 'r4']);
});

test('partition with no matching schedules keeps everything', () => {
  const schedules = [schedule('b', 'Projects/bar')];
  const runs = [{ id: 'r2', scheduleId: 'b' }];
  const result = partitionProjectSchedules(schedules, runs, 'Projects/foo');
  assert.deepEqual(result.removedIds, []);
  assert.equal(result.keptSchedules.length, 1);
  assert.equal(result.keptRuns.length, 1);
});

test('partition does not match a project whose path only shares a prefix', () => {
  const schedules = [schedule('a', 'Projects/foo-bar')];
  const result = partitionProjectSchedules(schedules, [], 'Projects/foo');
  assert.deepEqual(result.removedIds, []);
});

test('partition does not mutate its inputs', () => {
  const schedules = [schedule('a', 'Projects/foo')];
  const runs = [{ id: 'r1', scheduleId: 'a' }];
  partitionProjectSchedules(schedules, runs, 'Projects/foo');
  assert.equal(schedules.length, 1);
  assert.equal(runs.length, 1);
});

test('dialog text is null when the project has no schedules', () => {
  assert.equal(buildRemoveDialogText([]), null);
});

test('dialog text for one schedule is singular and lists it', () => {
  const text = buildRemoveDialogText([schedule('a', 'p', 'Nightly tests', '0 2 * * *')]);
  assert.equal(text.checkboxLabel, 'Also delete 1 schedule and its run history');
  assert.match(text.detail, /Nightly tests \(0 2 \* \* \*\)/);
  assert.match(text.detail, /This project has 1 schedule:/);
});

test('dialog text for two schedules is plural and lists both', () => {
  const text = buildRemoveDialogText([
    schedule('a', 'p', 'Nightly tests', '0 2 * * *'),
    schedule('b', 'p', 'Weekly report', '0 9 * * 1'),
  ]);
  assert.equal(text.checkboxLabel, 'Also delete 2 schedules and their run history');
  assert.match(text.detail, /This project has 2 schedules:/);
  assert.match(text.detail, /• Nightly tests \(0 2 \* \* \*\)/);
  assert.match(text.detail, /• Weekly report \(0 9 \* \* 1\)/);
});
