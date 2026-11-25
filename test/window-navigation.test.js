// Tests for #76: every Cockpit window (popup, settings, status, terminal) only
// ever shows its own page. rendererPageUrl gives each window's page URL;
// guardWindowNavigation wires classifyNavigation into will-navigate and
// setWindowOpenHandler. Electron is replaced by fakes.
//
// Runs against the compiled output. Run with: npm test

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const {
  rendererPageUrl,
  guardWindowNavigation,
} = require('../dist/main/main/window-navigation.js');

const RENDERER_DIR = '/Applications/Cockpit.app/Contents/Resources/app.asar/dist/renderer';

test('dev page URLs are on the Vite dev server; the popup is its root', () => {
  assert.equal(rendererPageUrl('index.html', { dev: true, rendererDir: RENDERER_DIR }), 'http://localhost:5173/');
  assert.equal(rendererPageUrl('settings.html', { dev: true, rendererDir: RENDERER_DIR }), 'http://localhost:5173/settings.html');
  assert.equal(rendererPageUrl('status.html', { dev: true, rendererDir: RENDERER_DIR }), 'http://localhost:5173/status.html');
  assert.equal(rendererPageUrl('terminal.html', { dev: true, rendererDir: RENDERER_DIR }), 'http://localhost:5173/terminal.html');
});

test('prod page URLs are the packaged HTML files', () => {
  for (const page of ['index.html', 'settings.html', 'status.html', 'terminal.html']) {
    assert.equal(
      rendererPageUrl(page, { dev: false, rendererDir: RENDERER_DIR }),
      pathToFileURL(`${RENDERER_DIR}/${page}`).href,
    );
  }
});

function fakeContents() {
  const listeners = {};
  let openHandler = null;
  return {
    setWindowOpenHandler(fn) { openHandler = fn; },
    on(event, fn) { (listeners[event] ||= []).push(fn); },
    navigate(url) {
      let prevented = false;
      for (const fn of listeners['will-navigate'] || []) fn({ preventDefault() { prevented = true; } }, url);
      return prevented;
    },
    windowOpen(url) { return openHandler({ url }); },
    hasOpenHandler() { return openHandler !== null; },
    count(event) { return (listeners[event] || []).length; },
  };
}

function setup(ownPage) {
  const contents = fakeContents();
  const opened = [];
  const warnings = [];
  guardWindowNavigation(contents, ownPage, 'settings', {
    openExternal: (url) => opened.push(url),
    warn: (msg) => warnings.push(msg),
  });
  return { contents, opened, warnings };
}

const DEV_SETTINGS = 'http://localhost:5173/settings.html';
const PROD_SETTINGS = pathToFileURL(`${RENDERER_DIR}/settings.html`).href;

test('installs both will-navigate and a window-open handler', () => {
  const { contents } = setup(DEV_SETTINGS);
  assert.equal(contents.count('will-navigate'), 1);
  assert.ok(contents.hasOpenHandler());
});

test('navigating to its own page (any query) is allowed', () => {
  const { contents, opened } = setup(DEV_SETTINGS);
  assert.equal(contents.navigate('http://localhost:5173/settings.html?dev=1'), false);
  const prod = setup(PROD_SETTINGS);
  assert.equal(prod.contents.navigate(`${PROD_SETTINGS}?x=1#a`), false);
  assert.deepEqual(opened, []);
});

test('a web link opens in the system browser, not in the window', () => {
  const { contents, opened } = setup(PROD_SETTINGS);
  assert.equal(contents.navigate('https://status.anthropic.com/'), true);
  assert.deepEqual(opened, ['https://status.anthropic.com/']);
});

test('another Cockpit page, file or localhost page is blocked and logged', () => {
  const { contents, opened, warnings } = setup(PROD_SETTINGS);
  assert.equal(contents.navigate(pathToFileURL(`${RENDERER_DIR}/terminal.html`).href), true);
  assert.equal(contents.navigate('file:///etc/passwd'), true);
  assert.equal(contents.navigate('http://localhost:3000/'), true);
  assert.equal(contents.navigate('javascript:alert(1)'), true);
  assert.deepEqual(opened, []);
  assert.equal(warnings.length, 4);
  assert.ok(warnings.every((w) => w.startsWith('[settings] Blocked navigation to ')));
});

test('window.open never makes an Electron window; web links go to the browser', () => {
  const { contents, opened, warnings } = setup(DEV_SETTINGS);
  assert.deepEqual(contents.windowOpen('https://github.com/mcoquet/cockpit'), { action: 'deny' });
  assert.deepEqual(contents.windowOpen('file:///etc/passwd'), { action: 'deny' });
  // Even its own page is denied as a new window.
  assert.deepEqual(contents.windowOpen(DEV_SETTINGS), { action: 'deny' });
  assert.deepEqual(opened, ['https://github.com/mcoquet/cockpit']);
  assert.equal(warnings.length, 2);
  assert.ok(warnings.every((w) => w.startsWith('[settings] Dropped window.open to ')));
});

test('long URLs are truncated in the log', () => {
  const { contents, warnings } = setup(DEV_SETTINGS);
  contents.navigate('file:///' + 'a'.repeat(500));
  assert.ok(warnings[0].length < 260);
});
