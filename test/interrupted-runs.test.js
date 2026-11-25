// Tests for the scheduler's start-up sweep of runs left "queued" or "running"
// by a previous Cockpit process (#55). Runs against compiled output in dist/main/.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  failInterruptedRuns,
  INTERRUPTED_RUN_ERROR,
} = require('../dist/main/main/interrupted-runs.js');

const NOW = 1_800_000_000_000;

function run(id, status, extra = {}) {
  return { id, scheduleId: 's1', startedAt: NOW - 60_000, status, ...extra };
}

test('a queued run from a previous process becomes failed', () => {
  const { runs, failedIds } = failInterruptedRuns([run('q', 'queued')], new Set(), NOW);
  assert.deepEqual(failedIds, ['q']);
  assert.equal(runs[0].status, 'failed');
  assert.equal(runs[0].error, 'Cockpit quit before this ran');
  assert.equal(runs[0].error, INTERRUPTED_RUN_ERROR);
  assert.equal(runs[0].completedAt, NOW);
});

test('a running run from a previous process becomes failed', () => {
  const { runs, failedIds } = failInterruptedRuns([run('r', 'running')], new Set(), NOW);
  assert.deepEqual(failedIds, ['r']);
  assert.equal(runs[0].status, 'failed');
  assert.equal(runs[0].error, INTERRUPTED_RUN_ERROR);
});

test('runs the current process knows about are untouched', () => {
  const input = [run('q', 'queued'), run('r', 'running')];
  const { runs, failedIds } = failInterruptedRuns(input, new Set(['q', 'r']), NOW);
  assert.deepEqual(failedIds, []);
  assert.deepEqual(runs, input);
});

test('finished runs are untouched', () => {
  const input = [
    run('ok', 'success', { completedAt: NOW - 1, output: 'done' }),
    run('bad', 'failed', { completedAt: NOW - 1, error: 'boom' }),
  ];
  const { runs, failedIds } = failInterruptedRuns(input, new Set(), NOW);
  assert.deepEqual(failedIds, []);
  assert.deepEqual(runs, input);
});

test('keeps order and other fields, and does not mutate its input', () => {
  const input = [run('a', 'success'), run('b', 'queued', { output: 'partial' }), run('c', 'success')];
  const snapshot = structuredClone(input);
  const { runs } = failInterruptedRuns(input, new Set(), NOW);
  assert.deepEqual(runs.map((r) => r.id), ['a', 'b', 'c']);
  assert.equal(runs[1].output, 'partial');
  assert.equal(runs[1].scheduleId, 's1');
  assert.deepEqual(input, snapshot);
});
