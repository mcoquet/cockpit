// Tests for the shared project-path helper (#51). Runs against compiled output.
// Stored project paths are home-relative (ADR 0002), `~/…`, or absolute for
// folders outside home; all must resolve to an absolute folder under the given
// home, never against the process's working directory.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { expandProjectPath, isDeletableProjectFolder } = require('../dist/main/main/project-path.js');

const HOME = '/Users/miguel';

test('home-relative stored path resolves under home', () => {
  assert.equal(expandProjectPath('Projects/foo', HOME), '/Users/miguel/Projects/foo');
});

test('~/ path resolves under home', () => {
  assert.equal(expandProjectPath('~/Projects/foo', HOME), '/Users/miguel/Projects/foo');
});

test('bare ~ resolves to home', () => {
  assert.equal(expandProjectPath('~', HOME), HOME);
});

test('absolute path is kept as is', () => {
  assert.equal(expandProjectPath('/Volumes/work/foo', HOME), '/Volumes/work/foo');
});

test('defaults to the real home folder', () => {
  const os = require('node:os');
  assert.equal(expandProjectPath('Projects/foo'), path.join(os.homedir(), 'Projects/foo'));
});

test('a home-relative project is found on disk (dialog shows) and the delete target is that folder', () => {
  const fs = require('node:fs');
  const os = require('node:os');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-home-'));
  const cwdDecoy = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-cwd-'));
  fs.mkdirSync(path.join(home, 'Projects', 'foo'), { recursive: true });
  fs.mkdirSync(path.join(cwdDecoy, 'Projects', 'foo'), { recursive: true });
  const prevCwd = process.cwd();
  try {
    process.chdir(cwdDecoy);
    const target = expandProjectPath('Projects/foo', home);
    assert.equal(fs.existsSync(target), true);
    assert.equal(target, path.join(home, 'Projects', 'foo'));
    assert.notEqual(fs.realpathSync(target), fs.realpathSync(path.join(cwdDecoy, 'Projects', 'foo')));
  } finally {
    process.chdir(prevCwd);
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwdDecoy, { recursive: true, force: true });
  }
});

test('home, its ancestors and the root are never deletable project folders', () => {
  for (const p of ['/Users/miguel', '/Users/miguel/', '/Users', '/', '/Users/miguel/Projects/..']) {
    assert.equal(isDeletableProjectFolder(p, HOME), false, p);
  }
  for (const p of ['/Users/miguel/Projects/foo', '/Volumes/work/foo', '/Users/miguelito']) {
    assert.equal(isDeletableProjectFolder(p, HOME), true, p);
  }
});

// #83: addProject stores a folder under home as home-relative, anything else
// as absolute. A sibling folder that only starts with the same letters as home
// (/Users/miguel2) is outside home.
const { toStoredProjectPath } = require('../dist/main/main/project-path.js');

test('folder under home is stored home-relative', () => {
  assert.equal(toStoredProjectPath('/Users/miguel/Projects/foo', HOME), 'Projects/foo');
  assert.equal(toStoredProjectPath('/Users/miguel/foo', HOME), 'foo');
});

test('folder outside home is stored absolute', () => {
  assert.equal(toStoredProjectPath('/opt/work/foo', HOME), '/opt/work/foo');
});

test('a sibling of home with the same prefix is outside home (#83)', () => {
  assert.equal(toStoredProjectPath('/Users/miguel2/x', HOME), '/Users/miguel2/x');
  assert.equal(toStoredProjectPath('/Users/miguel.old/x', HOME), '/Users/miguel.old/x');
});

test('home itself is stored as before (empty string, expands back to home)', () => {
  assert.equal(toStoredProjectPath('/Users/miguel', HOME), '');
  assert.equal(expandProjectPath(toStoredProjectPath('/Users/miguel', HOME), HOME), HOME);
});

test('stored path round-trips through expandProjectPath', () => {
  for (const abs of ['/Users/miguel/Projects/foo', '/opt/work/foo', '/Users/miguel2/x']) {
    assert.equal(expandProjectPath(toStoredProjectPath(abs, HOME), HOME), abs);
  }
});
