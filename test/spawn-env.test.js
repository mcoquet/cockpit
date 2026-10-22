// Tests for env var injection into claude spawn env (#42). Runs against compiled output.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { getClaudeSpawnEnv } = require('../dist/main/main/env.js');

test('getClaudeSpawnEnv applies extra vars after PATH', () => {
  const env = getClaudeSpawnEnv('/x/bin/claude', { FOO: 'bar', PATH: '/custom' });
  assert.equal(env.FOO, 'bar');
  assert.equal(env.PATH, '/custom');
});

test('getClaudeSpawnEnv without extras keeps computed PATH', () => {
  const env = getClaudeSpawnEnv('/x/bin/claude');
  assert.ok(env.PATH.startsWith('/x/bin:'));
});
