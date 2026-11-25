// Regression tests for #52: Cmd+T in Terminal/iTerm could run commands hidden
// in a folder name. The path must reach the shell single-quoted (with ' written
// as '\''), and that shell command must then be escaped as an AppleScript string.
//
// Runs against the compiled output. Run with: npm test

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  shellSingleQuote,
  appleScriptString,
  cdCommand,
  terminalAppScript,
  iTermScript,
} = require('../dist/main/main/external-terminal-script.js');

test('shellSingleQuote wraps in single quotes and escapes embedded quotes', () => {
  assert.equal(shellSingleQuote('/Users/me/My Project'), "'/Users/me/My Project'");
  assert.equal(shellSingleQuote("it's"), "'it'\\''s'");
  assert.equal(shellSingleQuote(''), "''");
});

test('appleScriptString escapes backslash, double quote and control characters', () => {
  assert.equal(appleScriptString('a"b\\c'), '"a\\"b\\\\c"');
  assert.equal(appleScriptString('a\nb\rc\td'), '"a\\nb\\rc\\td"');
});

// Each case: folder path → exact shell command, and the AppleScript literal
// that carries it.
const cases = [
  { name: 'spaces', path: '/Users/me/My Project', cmd: "cd '/Users/me/My Project'", as: `"cd '/Users/me/My Project'"` },
  { name: 'double quote', path: '/Users/me/a"b', cmd: `cd '/Users/me/a"b'`, as: `"cd '/Users/me/a\\"b'"` },
  { name: 'single quote', path: "/Users/me/it's", cmd: "cd '/Users/me/it'\\''s'", as: `"cd '/Users/me/it'\\\\''s'"` },
  { name: 'backslash', path: '/Users/me/a\\b', cmd: "cd '/Users/me/a\\b'", as: `"cd '/Users/me/a\\\\b'"` },
  { name: '$(…)', path: '/Users/me/a$(touch x)b', cmd: "cd '/Users/me/a$(touch x)b'", as: `"cd '/Users/me/a$(touch x)b'"` },
  { name: 'backticks', path: '/Users/me/a`touch x`b', cmd: "cd '/Users/me/a`touch x`b'", as: '"cd \'/Users/me/a`touch x`b\'"' },
  { name: 'non-ASCII', path: '/Users/me/Projetos/São João 🚀', cmd: "cd '/Users/me/Projetos/São João 🚀'", as: `"cd '/Users/me/Projetos/São João 🚀'"` },
];

for (const c of cases) {
  test(`cdCommand: ${c.name}`, () => {
    assert.equal(cdCommand(c.path), c.cmd);
    assert.equal(appleScriptString(cdCommand(c.path)), c.as);
  });

  test(`terminalAppScript: ${c.name}`, () => {
    assert.equal(
      terminalAppScript(c.path),
      [
        'tell application "Terminal"',
        '  activate',
        `  do script ${c.as}`,
        'end tell',
      ].join('\n'),
    );
  });

  test(`iTermScript: ${c.name}`, () => {
    assert.equal(
      iTermScript(c.path),
      [
        'tell application "iTerm"',
        '  activate',
        '  set newWindow to (create window with default profile)',
        '  tell current session of newWindow',
        `    write text ${c.as}`,
        '  end tell',
        'end tell',
      ].join('\n'),
    );
  });
}

// End to end through a real shell: the command cdCommand builds must cd into
// the hostile folder and must not run anything hidden in its name.
test('cdCommand runs safely in a real shell for hostile folder names', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-52-'));
  try {
    const names = [
      'a$(touch x)b',
      'a`touch x`b',
      "it's; touch x",
      'a"b\\c $HOME',
      'São João 🚀',
      'line\nbreak',
    ];
    for (const name of names) {
      const dir = path.join(root, name);
      fs.mkdirSync(dir);
      for (const shell of ['/bin/sh', 'bash']) {
        const out = execFileSync(shell, ['-c', `${cdCommand(dir)} && pwd`], { cwd: root }).toString();
        assert.equal(out, dir + '\n', `${shell}: ${JSON.stringify(name)}`);
      }
      assert.equal(fs.existsSync(path.join(root, 'x')), false, `no file x for ${JSON.stringify(name)}`);
      assert.equal(fs.existsSync(path.join(dir, 'x')), false, `no file x inside ${JSON.stringify(name)}`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
