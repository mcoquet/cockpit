// Tests for the pure env var helpers (#42). Runs against compiled output.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  isValidEnvName,
  rowsToEnvVars,
  envVarsToRows,
  mergeEnvVars,
} = require('../dist/main/shared/env-vars.js');

test('isValidEnvName accepts and rejects', () => {
  for (const n of ['FOO', '_x', 'A1_B', '  FOO  ']) assert.equal(isValidEnvName(n), true, n);
  for (const n of ['', '   ', '1ABC', 'MY VAR', 'A=B', 'A-B']) assert.equal(isValidEnvName(n), false, n);
});

test('rowsToEnvVars trims names, keeps values, drops invalid', () => {
  assert.deepEqual(
    rowsToEnvVars([{ name: ' FOO ', value: ' bar ' }, { name: '', value: 'x' }, { name: 'MY VAR', value: 'y' }]),
    { FOO: ' bar ' });
});

test('rowsToEnvVars: last duplicate wins', () => {
  assert.deepEqual(rowsToEnvVars([{ name: 'A', value: '1' }, { name: 'A', value: '2' }]), { A: '2' });
});

test('envVarsToRows round-trips and handles undefined', () => {
  assert.deepEqual(envVarsToRows({ A: '1', B: '2' }), [{ name: 'A', value: '1' }, { name: 'B', value: '2' }]);
  assert.deepEqual(envVarsToRows(undefined), []);
});

test('mergeEnvVars: project overrides global', () => {
  assert.deepEqual(mergeEnvVars({ A: 'g', B: 'g' }, { B: 'p', C: 'p' }), { A: 'g', B: 'p', C: 'p' });
  assert.deepEqual(mergeEnvVars(undefined, undefined), {});
  assert.deepEqual(mergeEnvVars({ A: 'g' }, undefined), { A: 'g' });
});
