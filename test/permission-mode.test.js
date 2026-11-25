// Tests for #56: a new terminal session (and a headless schedule run) uses the
// project's default permission mode unless a mode is chosen explicitly.
//
// Runs against the compiled output. Run with: npm test

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  resolvePermissionMode,
  permissionModeArgs,
  headlessScheduleArgs,
} = require('../dist/main/main/permission-mode.js');

const ALL_MODES = ['default', 'acceptEdits', 'plan', 'auto', 'dontAsk', 'bypassPermissions'];

test('resolvePermissionMode: explicit mode wins over the project default', () => {
  assert.equal(resolvePermissionMode('plan', 'acceptEdits'), 'plan');
});

test('resolvePermissionMode: explicit "default" still wins over the project default', () => {
  // Option+click -> "Default" is a real choice for that launch.
  assert.equal(resolvePermissionMode('default', 'bypassPermissions'), 'default');
});

test('resolvePermissionMode: no explicit mode -> project default', () => {
  for (const mode of ALL_MODES) {
    assert.equal(resolvePermissionMode(undefined, mode), mode);
  }
});

test('resolvePermissionMode: no explicit mode, no project mode -> Claude Code default', () => {
  assert.equal(resolvePermissionMode(undefined, undefined), 'default');
});

test('permissionModeArgs: default (or none) adds no flags', () => {
  assert.deepEqual(permissionModeArgs('default'), []);
  assert.deepEqual(permissionModeArgs(undefined), []);
});

test('permissionModeArgs: non-default modes pass --permission-mode', () => {
  for (const mode of ['acceptEdits', 'plan', 'auto', 'dontAsk']) {
    assert.deepEqual(permissionModeArgs(mode), ['--permission-mode', mode]);
  }
});

test('permissionModeArgs: bypassPermissions also passes --dangerously-skip-permissions (as pty.ts)', () => {
  assert.deepEqual(permissionModeArgs('bypassPermissions'), [
    '--permission-mode',
    'bypassPermissions',
    '--dangerously-skip-permissions',
  ]);
});

test('headlessScheduleArgs: default mode is just -p <prompt>', () => {
  assert.deepEqual(headlessScheduleArgs('do it', 'default'), ['-p', 'do it']);
  assert.deepEqual(headlessScheduleArgs('do it', undefined), ['-p', 'do it']);
});

test('headlessScheduleArgs: project mode flags come before -p <prompt>', () => {
  assert.deepEqual(headlessScheduleArgs('do it', 'acceptEdits'), [
    '--permission-mode',
    'acceptEdits',
    '-p',
    'do it',
  ]);
});

// #63: spawnClaude in pty.ts builds its arguments with terminalSessionArgs,
// which reuses permissionModeArgs instead of repeating the flag rule.
const { terminalSessionArgs } = require('../dist/main/main/permission-mode.js');

test('terminalSessionArgs: --continue by default, then the mode flags', () => {
  assert.deepEqual(terminalSessionArgs({}), ['--continue']);
  assert.deepEqual(terminalSessionArgs({ permissionMode: 'plan' }), ['--continue', '--permission-mode', 'plan']);
});

test('terminalSessionArgs: continueSession false starts a new conversation', () => {
  assert.deepEqual(terminalSessionArgs({ continueSession: false }), []);
  assert.deepEqual(terminalSessionArgs({ continueSession: false, permissionMode: 'default' }), []);
});

test('terminalSessionArgs: resume wins over continue', () => {
  assert.deepEqual(
    terminalSessionArgs({ resumeSessionId: 'abc', continueSession: true, permissionMode: 'bypassPermissions' }),
    ['--resume', 'abc', '--permission-mode', 'bypassPermissions', '--dangerously-skip-permissions']
  );
});

test('terminalSessionArgs: mode flags match permissionModeArgs for every mode', () => {
  for (const mode of ALL_MODES) {
    assert.deepEqual(terminalSessionArgs({ continueSession: false, permissionMode: mode }), permissionModeArgs(mode));
  }
});
