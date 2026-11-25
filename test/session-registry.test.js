// Tests for #58: Cockpit tracks every running terminal session, keyed by
// terminal session id, and derives each project's view from that.
//
// Runs against the compiled output. Run with: npm test

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SessionRegistry } = require('../dist/main/main/session-registry.js');

function threeWindowsForOneProject() {
  const r = new SessionRegistry();
  r.add({ sessionId: 's1', windowId: 11, projectPath: 'code/a', permissionMode: 'default' });
  r.add({ sessionId: 's2', windowId: 12, projectPath: 'code/a', permissionMode: 'plan' });
  r.add({ sessionId: 's3', windowId: 13, projectPath: 'code/a', permissionMode: 'default' });
  return r;
}

test('add and get: every terminal session is kept, not only the newest per project', () => {
  const r = threeWindowsForOneProject();
  assert.equal(r.count(), 3);
  assert.equal(r.get('s1').windowId, 11);
  assert.equal(r.get('s3').windowId, 13);
});

test('remove: drops one terminal session, leaves the others, and reports whether it was there', () => {
  const r = threeWindowsForOneProject();
  assert.equal(r.remove('s2'), true);
  assert.equal(r.remove('s2'), false);
  assert.equal(r.count(), 2);
  assert.equal(r.get('s2'), undefined);
  assert.deepEqual(r.forProject('code/a').map((s) => s.sessionId), ['s1', 's3']);
});

test('findByWindow: finds the terminal session of any window, including the oldest', () => {
  const r = threeWindowsForOneProject();
  assert.equal(r.findByWindow(11).sessionId, 's1');
  assert.equal(r.findByWindow(13).sessionId, 's3');
  assert.equal(r.findByWindow(99), undefined);
  assert.equal(r.findByWindow(null), undefined);
});

test('forProject: lists a project\'s terminal sessions in the order they opened', () => {
  const r = threeWindowsForOneProject();
  r.add({ sessionId: 's4', windowId: 14, projectPath: 'code/b', permissionMode: 'default' });
  assert.deepEqual(r.forProject('code/a').map((s) => s.sessionId), ['s1', 's2', 's3']);
  assert.deepEqual(r.forProject('code/b').map((s) => s.sessionId), ['s4']);
  assert.deepEqual(r.forProject('code/none'), []);
});

test('latestForProject: the newest running terminal session, falling back when it ends', () => {
  const r = threeWindowsForOneProject();
  assert.equal(r.latestForProject('code/a').sessionId, 's3');
  r.remove('s3');
  assert.equal(r.latestForProject('code/a').sessionId, 's2');
  r.remove('s1');
  r.remove('s2');
  assert.equal(r.latestForProject('code/a'), undefined);
});

test('projectView: one entry per project with a running terminal session (sessions-changed shape)', () => {
  const r = threeWindowsForOneProject();
  r.add({ sessionId: 's4', windowId: 14, projectPath: 'code/b', permissionMode: 'acceptEdits' });
  assert.deepEqual(r.projectView(), {
    'code/a': { sessionId: 's3', windowId: 13, permissionMode: 'default' },
    'code/b': { sessionId: 's4', windowId: 14, permissionMode: 'acceptEdits' },
  });
  // Closing an older window keeps the project active.
  r.remove('s1');
  assert.ok('code/a' in r.projectView());
  r.remove('s2');
  r.remove('s3');
  assert.deepEqual(Object.keys(r.projectView()), ['code/b']);
});

test('count: counts terminal sessions, not projects', () => {
  const r = threeWindowsForOneProject();
  r.add({ sessionId: 's4', windowId: 14, projectPath: 'code/b', permissionMode: 'default' });
  assert.equal(r.count(), 4);
  assert.equal(new SessionRegistry().count(), 0);
});

test('restoreSetPaths: each project once, in the order its first terminal session opened', () => {
  const r = new SessionRegistry();
  r.add({ sessionId: 's1', windowId: 1, projectPath: 'code/b', permissionMode: 'default' });
  r.add({ sessionId: 's2', windowId: 2, projectPath: 'code/a', permissionMode: 'default' });
  r.add({ sessionId: 's3', windowId: 3, projectPath: 'code/b', permissionMode: 'default' });
  r.add({ sessionId: 's4', windowId: 4, projectPath: 'code/a', permissionMode: 'default' });
  assert.deepEqual(r.restoreSetPaths(), ['code/b', 'code/a']);
  assert.deepEqual(new SessionRegistry().restoreSetPaths(), []);
});

test('setPermissionMode: changes only that terminal session and reports whether it exists', () => {
  const r = threeWindowsForOneProject();
  assert.equal(r.setPermissionMode('s1', 'bypassPermissions'), true);
  assert.equal(r.get('s1').permissionMode, 'bypassPermissions');
  assert.equal(r.get('s3').permissionMode, 'default');
  assert.equal(r.setPermissionMode('nope', 'plan'), false);
});

test('add with an id already tracked replaces that entry rather than duplicating it', () => {
  const r = new SessionRegistry();
  r.add({ sessionId: 's1', windowId: 1, projectPath: 'code/a', permissionMode: 'default' });
  r.add({ sessionId: 's1', windowId: 2, projectPath: 'code/a', permissionMode: 'plan' });
  assert.equal(r.count(), 1);
  assert.equal(r.get('s1').windowId, 2);
});
