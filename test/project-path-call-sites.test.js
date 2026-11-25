// Table test for #59: every place that turned a stored project path into an
// absolute folder now uses expandProjectPath. Each `legacy` function below is
// the inline rule that call site used before, copied verbatim (with os.homedir()
// replaced by HOME). For the path shapes Cockpit stores (home-relative, `~/…`,
// absolute) the shared helper must give the same folder, except where the old
// rule was wrong (absolute paths in pty.ts and store.ts), which is asserted too.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  expandProjectPath,
  encodeProjectPath,
} = require('../dist/main/main/project-path.js');

const HOME = '/Users/miguel';

const SHAPES = {
  'home-relative': 'Projects/foo',
  'home-relative with dot': 'Projects/my.app',
  'tilde': '~/Projects/foo',
  'absolute inside home': '/Users/miguel/Projects/foo',
  'absolute outside home': '/opt/work/foo',
};

// scheduler-executor.ts executeSchedule
function legacyScheduler(p) {
  if (p.startsWith('~')) return path.join(HOME, p.slice(1));
  if (path.isAbsolute(p)) return p;
  return path.join(HOME, p);
}

// terminal-window.ts openExternalTerminal
function legacyTerminalWindow(p) {
  return p.startsWith('~')
    ? path.join(HOME, p.slice(1))
    : p.startsWith('/') ? p : path.join(HOME, p);
}

// sessions.ts encodeProjectPath
function legacyEncode(p) {
  let fullPath;
  if (p.startsWith('/')) fullPath = p;
  else if (p.startsWith('~')) fullPath = path.join(HOME, p.slice(1));
  else fullPath = path.join(HOME, p);
  return '-' + fullPath.slice(1).replace(/[\/\.]/g, '-');
}

// pty.ts spawnClaude, sessions.ts generateSessionSummary cwd, store.ts checkHasGit/getGithubUrl
function legacyHomeJoin(p) {
  return path.join(HOME, p);
}

for (const [shape, stored] of Object.entries(SHAPES)) {
  test(`scheduler-executor: ${shape} unchanged`, () => {
    assert.equal(expandProjectPath(stored, HOME), legacyScheduler(stored));
  });

  test(`terminal-window openExternalTerminal: ${shape} unchanged`, () => {
    assert.equal(expandProjectPath(stored, HOME), legacyTerminalWindow(stored));
  });

  test(`sessions encodeProjectPath: ${shape} unchanged`, () => {
    assert.equal(encodeProjectPath(stored, HOME), legacyEncode(stored));
  });
}

test('pty / store / session summary: home-relative unchanged', () => {
  for (const stored of [SHAPES['home-relative'], SHAPES['home-relative with dot']]) {
    assert.equal(expandProjectPath(stored, HOME), legacyHomeJoin(stored));
    assert.equal(
      path.join(expandProjectPath(stored, HOME), '.git'),
      path.join(HOME, stored, '.git'),
    );
  }
});

test('pty / store / session summary: absolute paths are no longer nested under home (bug fixed)', () => {
  // The old rule turned /opt/work/foo into /Users/miguel/opt/work/foo.
  assert.equal(legacyHomeJoin('/opt/work/foo'), '/Users/miguel/opt/work/foo');
  assert.equal(expandProjectPath('/opt/work/foo', HOME), '/opt/work/foo');
});

test('pty / store / session summary: ~/ paths are no longer nested as a literal ~ folder (bug fixed)', () => {
  assert.equal(legacyHomeJoin('~/Projects/foo'), '/Users/miguel/~/Projects/foo');
  assert.equal(expandProjectPath('~/Projects/foo', HOME), '/Users/miguel/Projects/foo');
});

test('encodeProjectPath matches Claude Code folder naming', () => {
  assert.equal(encodeProjectPath('Projects/cockpit', HOME), '-Users-miguel-Projects-cockpit');
  assert.equal(encodeProjectPath('/opt/my.app', HOME), '-opt-my-app');
});
