// Tests for #69: a terminal window may only ever show its own page. Any other
// in-page navigation is prevented; http(s) URLs open in the system browser;
// everything else is dropped.
//
// Runs against the compiled output. Run with: npm test

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const {
  classifyNavigation,
  isOwnPage,
} = require('../dist/main/main/navigation-guard.js');

const PROD_PATH = '/Applications/Cockpit.app/Contents/Resources/app.asar/dist/renderer/terminal.html';
const PROD_PAGE = pathToFileURL(PROD_PATH).href;
const DEV_PAGE = 'http://localhost:5173/terminal.html';

// --- production: the packaged terminal.html ---

test('prod: own terminal.html is allowed', () => {
  assert.equal(classifyNavigation(PROD_PAGE, PROD_PAGE), 'allow');
});

test('prod: own page with a query string and hash is allowed', () => {
  assert.equal(
    classifyNavigation(`${PROD_PAGE}?sessionId=abc&title=%F0%9F%90%99%20x#top`, PROD_PAGE),
    'allow'
  );
});

test('prod: another file:// path is blocked', () => {
  assert.equal(classifyNavigation('file:///etc/passwd', PROD_PAGE), 'block');
  assert.equal(classifyNavigation('file:///Users/me/Downloads/evil.html', PROD_PAGE), 'block');
});

test('prod: a sibling renderer page is blocked', () => {
  const sibling = PROD_PAGE.replace('terminal.html', 'settings.html');
  assert.equal(classifyNavigation(sibling, PROD_PAGE), 'block');
});

test('prod: path traversal out of renderer/ is blocked', () => {
  const traversal = PROD_PAGE.replace('terminal.html', '../evil.html');
  assert.equal(classifyNavigation(traversal, PROD_PAGE), 'block');
  const encoded = PROD_PAGE.replace('terminal.html', '%2e%2e/evil.html');
  assert.equal(classifyNavigation(encoded, PROD_PAGE), 'block');
});

test('prod: traversal that resolves back to terminal.html is the same page', () => {
  const roundTrip = PROD_PAGE.replace('renderer/terminal.html', 'renderer/../renderer/terminal.html');
  assert.equal(classifyNavigation(roundTrip, PROD_PAGE), 'allow');
});

test('prod: a file:// URL with a host is blocked', () => {
  assert.equal(
    classifyNavigation(PROD_PAGE.replace('file://', 'file://evil.example'), PROD_PAGE),
    'block'
  );
});

test('prod: an encoded slash in the path is blocked, not thrown', () => {
  const slash = PROD_PAGE.replace('renderer/terminal.html', 'renderer%2Fterminal.html');
  assert.equal(classifyNavigation(slash, PROD_PAGE), 'block');
});

test('prod: the dev server page is blocked', () => {
  assert.equal(classifyNavigation(DEV_PAGE, PROD_PAGE), 'block');
});

// --- development: the Vite dev server ---

test('dev: own terminal.html is allowed', () => {
  assert.equal(classifyNavigation(DEV_PAGE, DEV_PAGE), 'allow');
});

test('dev: own page with a query string and hash is allowed', () => {
  assert.equal(classifyNavigation(`${DEV_PAGE}?sessionId=abc&dev=1#x`, DEV_PAGE), 'allow');
});

test('dev: other localhost ports are blocked', () => {
  assert.equal(classifyNavigation('http://localhost:3000/terminal.html', DEV_PAGE), 'block');
  assert.equal(classifyNavigation('http://localhost:3000/', DEV_PAGE), 'block');
  assert.equal(classifyNavigation('http://localhost/terminal.html', DEV_PAGE), 'block');
});

test('other loopback hosts are blocked, not opened externally', () => {
  for (const url of [
    'http://127.0.0.1:5173/terminal.html',
    'http://127.0.0.1:3000/',
    'http://[::1]:5173/terminal.html',
    'http://localhost.:5173/terminal.html',
    'http://foo.localhost/',
    'https://LOCALHOST:8443/',
  ]) {
    assert.equal(classifyNavigation(url, DEV_PAGE), 'block', url);
    assert.equal(classifyNavigation(url, PROD_PAGE), 'block', url);
  }
});

test('dev: other paths on the dev server are blocked', () => {
  assert.equal(classifyNavigation('http://localhost:5173/', DEV_PAGE), 'block');
  assert.equal(classifyNavigation('http://localhost:5173/settings.html', DEV_PAGE), 'block');
  assert.equal(classifyNavigation('http://localhost:5173/terminal.html/x', DEV_PAGE), 'block');
  assert.equal(classifyNavigation('http://localhost:5173/sub/../evil.html', DEV_PAGE), 'block');
});

test('dev: https or credentials on the dev server origin are not the own page', () => {
  assert.equal(classifyNavigation('http://user:pw@localhost:5173/terminal.html', DEV_PAGE), 'block');
  assert.equal(classifyNavigation('https://localhost:5173/terminal.html', DEV_PAGE), 'block');
});

test('dev: a file:// URL is blocked', () => {
  assert.equal(classifyNavigation(PROD_PAGE, DEV_PAGE), 'block');
});

// --- web links open in the system browser ---

test('http and https URLs open externally', () => {
  for (const own of [PROD_PAGE, DEV_PAGE]) {
    assert.equal(classifyNavigation('https://github.com/mcoquet/cockpit', own), 'open-external');
    assert.equal(classifyNavigation('http://example.com/a?b=c', own), 'open-external');
    assert.equal(classifyNavigation('HTTPS://Example.com/', own), 'open-external');
  }
});

// --- odd schemes and garbage are dropped ---

test('odd schemes are blocked', () => {
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'blob:file:///abc',
    'about:blank',
    'chrome://gpu',
    'devtools://devtools/bundled/inspector.html',
    'ftp://example.com/x',
    'mailto:me@example.com',
    'vscode://file/etc/passwd',
  ]) {
    assert.equal(classifyNavigation(url, PROD_PAGE), 'block', url);
    assert.equal(classifyNavigation(url, DEV_PAGE), 'block', url);
  }
});

test('unparseable URLs are blocked, not thrown', () => {
  assert.equal(classifyNavigation('', PROD_PAGE), 'block');
  assert.equal(classifyNavigation('not a url', PROD_PAGE), 'block');
  assert.equal(classifyNavigation('http://', DEV_PAGE), 'block');
});

test('an unparseable own page allows nothing', () => {
  assert.equal(isOwnPage(PROD_PAGE, 'not a url'), false);
  assert.equal(classifyNavigation(PROD_PAGE, 'not a url'), 'block');
});
