// Builds the AppleScript that Cmd+T sends to Terminal.app or iTerm (#52).
// Kept free of Electron so it can be unit-tested.
//
// Two layers of quoting, innermost first:
// 1. The path is single-quoted for the shell, so `$(…)`, backticks, `$VAR`,
//    `"` and `\` in a folder name are plain characters. A `'` is written `'\''`.
// 2. The resulting shell command is escaped as an AppleScript string literal.

import { shellSingleQuote } from '../shared/shell-quote';

// Moved to src/shared so the terminal renderer can use it too (#5).
export { shellSingleQuote };

/** Quote a string as an AppleScript string literal, double quotes included. */
export function appleScriptString(value: string): string {
  const escaped = value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/** The shell command that changes into `dir`. */
export function cdCommand(dir: string): string {
  return `cd ${shellSingleQuote(dir)}`;
}

/** AppleScript that opens a Terminal.app window in `dir`. */
export function terminalAppScript(dir: string): string {
  return [
    'tell application "Terminal"',
    '  activate',
    `  do script ${appleScriptString(cdCommand(dir))}`,
    'end tell',
  ].join('\n');
}

/** AppleScript that opens an iTerm window in `dir`. */
export function iTermScript(dir: string): string {
  return [
    'tell application "iTerm"',
    '  activate',
    '  set newWindow to (create window with default profile)',
    '  tell current session of newWindow',
    `    write text ${appleScriptString(cdCommand(dir))}`,
    '  end tell',
    'end tell',
  ].join('\n');
}
