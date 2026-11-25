// Tests for splitting a location for middle truncation on the Create tab (#18).
// Runs against compiled output.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { splitPathForDisplay } = require('../dist/main/shared/path-display.js');

test('splits off the last folder so it is never truncated', () => {
  assert.deepEqual(
    splitPathForDisplay('/Users/miguel/Documents/Clients/experiments'),
    { head: '/Users/miguel/Documents/Clients', tail: '/experiments' },
  );
});

test('home-relative paths', () => {
  assert.deepEqual(splitPathForDisplay('~/Projects'), { head: '~', tail: '/Projects' });
  assert.deepEqual(splitPathForDisplay('~'), { head: '', tail: '~' });
});

test('a trailing slash is ignored', () => {
  assert.deepEqual(splitPathForDisplay('/Users/miguel/Projects/'), { head: '/Users/miguel', tail: '/Projects' });
});

test('root and top-level folders', () => {
  assert.deepEqual(splitPathForDisplay('/'), { head: '', tail: '/' });
  assert.deepEqual(splitPathForDisplay('/Volumes'), { head: '', tail: '/Volumes' });
});

test('head + tail always rebuilds the path (minus a trailing slash)', () => {
  for (const p of ['/a/b/c', '~/x', 'relative', '/a b/c d']) {
    const { head, tail } = splitPathForDisplay(p);
    assert.equal(head + tail, p);
  }
});

test('empty input', () => {
  assert.deepEqual(splitPathForDisplay(''), { head: '', tail: '' });
});
