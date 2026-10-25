// Tests for the claude spawn env (#42, #45). Runs against compiled output.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ENV_START,
  ENV_END,
  parseEnvOutput,
  filterShellEnv,
  buildClaudeSpawnEnv,
  captureShellEnv,
  getClaudeSpawnEnv,
} = require('../dist/main/main/env.js');

function envBlock(vars) {
  return Object.entries(vars).map(([k, v]) => `${k}=${v}\0`).join('');
}

// Writes an executable fake shell that ignores its args and runs `body`.
function fakeShell(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-env-'));
  const file = path.join(dir, 'shell');
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return file;
}

test('parseEnvOutput reads only between markers', () => {
  const out = `noise: .zshrc:12 error\n${ENV_START}${envBlock({ A: '1', B: 'x=y' })}${ENV_END}trailing`;
  assert.deepEqual(parseEnvOutput(out), { A: '1', B: 'x=y' });
});

test('parseEnvOutput keeps multi-line values', () => {
  const out = `${ENV_START}${envBlock({ ML: 'line1\nline2', C: '3' })}${ENV_END}`;
  assert.deepEqual(parseEnvOutput(out), { ML: 'line1\nline2', C: '3' });
});

test('parseEnvOutput returns null without both markers', () => {
  assert.equal(parseEnvOutput('A=1\0'), null);
  assert.equal(parseEnvOutput(`${ENV_START}A=1\0`), null);
});

test('filterShellEnv drops shell-local vars, keeps fnm vars', () => {
  const env = filterShellEnv({
    PWD: '/p', OLDPWD: '/o', SHLVL: '2', _: '/usr/bin/env', TERM: 'dumb',
    TERM_PROGRAM: 'x', TERM_PROGRAM_VERSION: '1',
    FNM_MULTISHELL_PATH: '/m', PATH: '/m/bin:/usr/bin', HOME: '/h',
  });
  assert.deepEqual(env, { FNM_MULTISHELL_PATH: '/m', PATH: '/m/bin:/usr/bin', HOME: '/h' });
});

test('buildClaudeSpawnEnv merge order: base < shell < claude dir < extras', () => {
  const env = buildClaudeSpawnEnv(
    { A: 'base', B: 'base', PATH: '/base' },
    { B: 'shell', C: 'shell', PATH: '/shell/bin:/usr/bin' },
    '/x/bin/claude',
    { C: 'extra' },
  );
  assert.equal(env.A, 'base');
  assert.equal(env.B, 'shell');
  assert.equal(env.C, 'extra');
  assert.equal(env.PATH, '/x/bin:/shell/bin:/usr/bin');
});

test('buildClaudeSpawnEnv: extra PATH overrides everything', () => {
  const env = buildClaudeSpawnEnv({}, { PATH: '/s' }, '/x/bin/claude', { PATH: '/custom' });
  assert.equal(env.PATH, '/custom');
});

test('captureShellEnv returns the filtered env from the shell', async () => {
  const shell = fakeShell(`printf 'banner\\n'; printf '${ENV_START}'; printf 'FOO=bar\\0PWD=%s\\0SHLVL=3\\0' "$(pwd)"; printf '${ENV_END}'`);
  const env = await captureShellEnv(os.tmpdir(), { shell, timeoutMs: 5000 });
  assert.deepEqual(env, { FOO: 'bar' });
});

test('captureShellEnv returns null on timeout', async () => {
  const shell = fakeShell('sleep 5');
  const started = Date.now();
  const env = await captureShellEnv(os.tmpdir(), { shell, timeoutMs: 200 });
  assert.equal(env, null);
  assert.ok(Date.now() - started < 2000);
});

test('captureShellEnv returns null on failure', async () => {
  assert.equal(await captureShellEnv(os.tmpdir(), { shell: fakeShell('exit 1'), timeoutMs: 5000 }), null);
  assert.equal(await captureShellEnv(os.tmpdir(), { shell: '/nonexistent/shell', timeoutMs: 5000 }), null);
});

test('getClaudeSpawnEnv falls back to a PATH with standard dirs when capture fails', async () => {
  const env = await getClaudeSpawnEnv('/x/bin/claude', os.tmpdir(), { FOO: 'bar' }, { shell: fakeShell('exit 1'), timeoutMs: 5000 });
  assert.equal(env.FOO, 'bar');
  assert.ok(env.PATH.startsWith('/x/bin:'));
  assert.ok(env.PATH.split(':').includes('/usr/bin'));
});
