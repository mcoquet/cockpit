// Regression tests for #4 — "First window close hides dock despite other
// windows open". Verifies dock visibility is driven by the actual number of
// open terminal windows, not by activeSessions (which is keyed by projectPath
// and collapses multiple windows of one project into a single entry).
//
// Runs against the compiled output so it exercises the real shipped code.
// Run with: npm test   (build:main first, which `npm test` does for you)

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  countLiveWindows,
  shouldShowDock,
} = require('../dist/main/main/window-count.js');

// A stub standing in for an Electron BrowserWindow as far as the dock logic cares.
function stubWindow() {
  let destroyed = false;
  return {
    isDestroyed: () => destroyed,
    destroy: () => {
      destroyed = true;
    },
  };
}

test('countLiveWindows: no windows -> 0', () => {
  assert.equal(countLiveWindows([]), 0);
});

test('countLiveWindows: counts only non-destroyed windows', () => {
  const a = stubWindow();
  const b = stubWindow();
  const c = stubWindow();
  b.destroy();
  assert.equal(countLiveWindows([a, b, c]), 2);
});

test('shouldShowDock: visible iff at least one window is open', () => {
  assert.equal(shouldShowDock(0), false);
  assert.equal(shouldShowDock(1), true);
  assert.equal(shouldShowDock(5), true);
});

// --- #4 reproduction --------------------------------------------------------
// Model the two competing sources of truth from the app and the window
// lifecycle (terminal-window.ts deletes from the window map BEFORE index.ts's
// onClose runs, so dock decisions see the post-close state).

function makeApp() {
  const windows = new Map(); // sessionId -> stub window  (real: terminalWindows)
  const activeSessions = {}; // projectPath -> sessionId  (real: activeSessions)

  return {
    open(project, sessionId) {
      windows.set(sessionId, stubWindow());
      // forceNew opens a second window for the same project and OVERWRITES the
      // single project-keyed entry — this is the bug's root cause.
      activeSessions[project] = sessionId;
    },
    close(project, sessionId) {
      // terminal-window.ts: window removed from the map first...
      windows.get(sessionId).destroy();
      windows.delete(sessionId);
      // ...then index.ts onClose only clears activeSessions if it still matches.
      if (activeSessions[project] === sessionId) delete activeSessions[project];
    },
    // OLD (buggy) heuristic: dock visible iff any project-keyed session remains.
    oldDockVisible: () => Object.keys(activeSessions).length > 0,
    // NEW (fixed) heuristic: dock visible iff any window is still open.
    newDockVisible: () => shouldShowDock(countLiveWindows(windows.values())),
  };
}

test('#4: closing the tracked window keeps dock visible when another remains', () => {
  const app = makeApp();
  app.open('P', 's1'); // first window for project P
  app.open('P', 's2'); // second window (forceNew) — overwrites activeSessions[P]

  app.close('P', 's2'); // close the currently-tracked window; s1 stays open

  // The bug: old heuristic hides the dock even though s1's window is open.
  assert.equal(app.oldDockVisible(), false, 'demonstrates the #4 bug');
  // The fix: dock stays visible because a window remains open.
  assert.equal(app.newDockVisible(), true, 'fixed: dock stays visible');
});

test('#4: closing the non-tracked window also keeps dock visible', () => {
  const app = makeApp();
  app.open('P', 's1');
  app.open('P', 's2');

  app.close('P', 's1'); // close the older, non-tracked window; s2 stays open

  assert.equal(app.newDockVisible(), true, 'dock stays visible, a window remains');
});

test('#4: dock hides only once the last window is closed', () => {
  const app = makeApp();
  app.open('P', 's1');
  app.open('P', 's2');

  app.close('P', 's2');
  assert.equal(app.newDockVisible(), true, 'one window left');

  app.close('P', 's1');
  assert.equal(app.newDockVisible(), false, 'all windows closed -> dock hides');
});

test('#4: multiple projects — dock tracks total open windows', () => {
  const app = makeApp();
  app.open('A', 'a1');
  app.open('B', 'b1');

  app.close('A', 'a1');
  assert.equal(app.newDockVisible(), true, "B's window is still open");

  app.close('B', 'b1');
  assert.equal(app.newDockVisible(), false, 'no windows left');
});
