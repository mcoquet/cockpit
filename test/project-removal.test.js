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

// --- The remove-project dialog flow (#73) ---------------------------------

const { askRemoveProject } = require('../dist/main/main/project-removal.js');

// A fake dialog that answers each showMessageBox call in turn and records it.
function fakeDialog(...answers) {
  const calls = [];
  return {
    calls,
    show: async (options) => {
      calls.push(options);
      const answer = answers.shift();
      if (!answer) throw new Error('unexpected dialog');
      return answer;
    },
  };
}

const schedText = { checkboxLabel: 'Also delete 1 schedule', detail: 'This project has 1 schedule' };

test('Cancel in the Delete Permanently confirmation cancels the whole removal', async () => {
  const d = fakeDialog({ response: 1, checkboxChecked: true }, { response: 0 });
  const plan = await askRemoveProject({
    expandedPath: '/Users/m/Projects/foo',
    canDeleteFolder: true,
    scheduleText: schedText,
    showMessageBox: d.show,
  });
  assert.equal(d.calls.length, 2);
  assert.equal(d.calls[1].title, 'Delete Folder?');
  assert.equal(plan, null);
});

test('Delete Permanently deletes the folder, removes the project and honours the box', async () => {
  const d = fakeDialog({ response: 1, checkboxChecked: true }, { response: 1 });
  const plan = await askRemoveProject({
    expandedPath: '/p', canDeleteFolder: true, scheduleText: schedText, showMessageBox: d.show,
  });
  assert.deepEqual(plan, { deleteFolder: true, deleteSchedules: true });
});

test('Cancel in the first dialog cancels', async () => {
  const d = fakeDialog({ response: 2, checkboxChecked: true });
  const plan = await askRemoveProject({
    expandedPath: '/p', canDeleteFolder: true, scheduleText: schedText, showMessageBox: d.show,
  });
  assert.equal(plan, null);
});

test('Remove from Cockpit keeps the folder; unticked box keeps schedules', async () => {
  const d = fakeDialog({ response: 0, checkboxChecked: false });
  const plan = await askRemoveProject({
    expandedPath: '/p', canDeleteFolder: true, scheduleText: schedText, showMessageBox: d.show,
  });
  assert.equal(d.calls.length, 1);
  assert.deepEqual(plan, { deleteFolder: false, deleteSchedules: false });
});

test('no deletable folder and schedules: one dialog, Cancel cancels', async () => {
  const d = fakeDialog({ response: 1, checkboxChecked: true });
  const plan = await askRemoveProject({
    expandedPath: '/p', canDeleteFolder: false, scheduleText: schedText, showMessageBox: d.show,
  });
  assert.equal(plan, null);
});

test('no deletable folder and schedules: Remove honours the box', async () => {
  const d = fakeDialog({ response: 0, checkboxChecked: true });
  const plan = await askRemoveProject({
    expandedPath: '/p', canDeleteFolder: false, scheduleText: schedText, showMessageBox: d.show,
  });
  assert.deepEqual(plan, { deleteFolder: false, deleteSchedules: true });
});

test('no deletable folder and no schedules: no dialog, just remove', async () => {
  const d = fakeDialog();
  const plan = await askRemoveProject({
    expandedPath: '/p', canDeleteFolder: false, scheduleText: null, showMessageBox: d.show,
  });
  assert.equal(d.calls.length, 0);
  assert.deepEqual(plan, { deleteFolder: false, deleteSchedules: false });
});

test('folder but no schedules: checkbox state is ignored', async () => {
  const d = fakeDialog({ response: 0, checkboxChecked: true });
  const plan = await askRemoveProject({
    expandedPath: '/p', canDeleteFolder: true, scheduleText: null, showMessageBox: d.show,
  });
  assert.equal(d.calls[0].checkboxLabel, undefined);
  assert.deepEqual(plan, { deleteFolder: false, deleteSchedules: false });
});
