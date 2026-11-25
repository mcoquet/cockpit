// Tests for #5: dropping files on a terminal window types their paths, like
// iTerm and Terminal.app: absolute paths, each shell-quoted, separated by
// spaces, one trailing space, no Enter.
//
// Runs against the compiled output. Run with: npm test

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { droppedPathsText } = require('../dist/main/shared/dropped-paths.js');
const { shellSingleQuote } = require('../dist/main/shared/shell-quote.js');
const legacy = require('../dist/main/main/external-terminal-script.js');

test('one file becomes its quoted path and a trailing space', () => {
  assert.equal(droppedPathsText(['/Users/me/notes.md']), "'/Users/me/notes.md' ");
});

test('several files are separated by single spaces, in drop order', () => {
  assert.equal(
    droppedPathsText(['/a/one.txt', '/b/two.png', '/c/three']),
    "'/a/one.txt' '/b/two.png' '/c/three' ",
  );
});

test('a folder path is quoted like a file, trailing slash kept as given', () => {
  assert.equal(droppedPathsText(['/Users/me/My Project']), "'/Users/me/My Project' ");
  assert.equal(droppedPathsText(['/Users/me/dir/']), "'/Users/me/dir/' ");
});

test('spaces, quotes, $(…), backticks and $VAR stay one literal word', () => {
  assert.equal(droppedPathsText(['/tmp/My File.txt']), "'/tmp/My File.txt' ");
  assert.equal(droppedPathsText(["/tmp/it's.txt"]), "'/tmp/it'\\''s.txt' ");
  assert.equal(droppedPathsText(['/tmp/$(rm -rf ~)']), "'/tmp/$(rm -rf ~)' ");
  assert.equal(droppedPathsText(['/tmp/`id` $HOME "x" \\y']), "'/tmp/`id` $HOME \"x\" \\y' ");
});

test('non-ASCII names are passed through unchanged', () => {
  assert.equal(droppedPathsText(['/Users/me/Fotografias/praia de Faro ☀️ ção.jpg']),
    "'/Users/me/Fotografias/praia de Faro ☀️ ção.jpg' ");
});

test('nothing usable dropped types nothing', () => {
  assert.equal(droppedPathsText([]), '');
  assert.equal(droppedPathsText(['', '']), '');
  assert.equal(droppedPathsText(['', '/a']), "'/a' ");
});

test('never contains a newline or carriage return outside the quotes (no Enter)', () => {
  const text = droppedPathsText(['/a', '/b c']);
  assert.ok(!/[\r\n]$/.test(text));
  assert.ok(text.endsWith(' '));
});

test('the shell reads each quoted path back as exactly one argument', () => {
  const paths = ['/tmp/My File.txt', "/tmp/it's", '/tmp/$(echo pwned)', '/tmp/ção ☀️', '/tmp/a\nb'];
  const out = execFileSync('/bin/sh', ['-c', `printf '%s\\0' ${droppedPathsText(paths)}`]);
  assert.deepEqual(out.toString('utf8').split('\0').slice(0, -1), paths);
});

test('shellSingleQuote moved to src/shared and is still exported from the old module', () => {
  assert.equal(shellSingleQuote("it's"), "'it'\\''s'");
  assert.equal(legacy.shellSingleQuote, shellSingleQuote);
});
