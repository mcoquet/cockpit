// Key mapping for the built-in terminal (#16). Pure and Electron-free so it
// can be unit-tested; Terminal.tsx feeds it xterm.js custom key events.

/**
 * What xterm.js sends for Option+Enter (ESC CR, "meta return"): see
 * `case 13` in @xterm/xterm src/common/input/Keyboard.ts. Claude Code reads it
 * as "insert a newline" instead of "submit".
 */
export const OPTION_ENTER_SEQUENCE = '\x1b\r';

/** The fields of a DOM KeyboardEvent the mapping looks at. */
export interface TerminalKeyEvent {
  type: string;
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

/**
 * `handled: true` means xterm.js must not process the event (the custom key
 * handler returns false); `send`, when set, is written to the PTY.
 */
export interface TerminalKeyResult {
  handled: boolean;
  send?: string;
}

/**
 * Shift+Enter (no other modifier) sends the Option+Enter sequence. Every event
 * type of that key (keydown, keypress, keyup) is blocked, because xterm.js
 * would otherwise send CR from the keypress and submit. Anything else is left
 * to xterm.js, so plain Enter still submits.
 */
export function mapTerminalKey(ev: TerminalKeyEvent): TerminalKeyResult {
  const isShiftEnter =
    ev.key === 'Enter' && ev.shiftKey && !ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.isComposing;
  if (!isShiftEnter) return { handled: false };
  return ev.type === 'keydown' ? { handled: true, send: OPTION_ENTER_SEQUENCE } : { handled: true };
}
