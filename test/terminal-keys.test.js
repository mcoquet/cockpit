// Tests for the terminal key mapping (#16): Shift+Enter inserts a newline
// by sending what xterm.js sends for Option+Enter. Runs against compiled output.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  OPTION_ENTER_SEQUENCE,
  mapTerminalKey,
} = require('../dist/main/shared/terminal-keys.js');

const key = (over) => ({
  type: 'keydown', key: 'Enter', shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, ...over,
});

test('Option+Enter sequence is ESC CR, as xterm.js 5.5 Keyboard.ts emits it', () => {
  assert.equal(OPTION_ENTER_SEQUENCE, '\x1b\r');
});

test('Shift+Enter keydown sends the Option+Enter sequence and blocks xterm', () => {
  assert.deepEqual(mapTerminalKey(key({ shiftKey: true })), { handled: true, send: '\x1b\r' });
});

test('Shift+Enter keypress and keyup are blocked without sending', () => {
  assert.deepEqual(mapTerminalKey(key({ type: 'keypress', shiftKey: true })), { handled: true });
  assert.deepEqual(mapTerminalKey(key({ type: 'keyup', shiftKey: true })), { handled: true });
});

test('plain Enter is left to xterm (submits with CR)', () => {
  assert.deepEqual(mapTerminalKey(key({})), { handled: false });
  assert.deepEqual(mapTerminalKey(key({ type: 'keypress' })), { handled: false });
});

test('Option+Enter is left to xterm (it already sends ESC CR)', () => {
  assert.deepEqual(mapTerminalKey(key({ altKey: true })), { handled: false });
});

test('Shift+Enter combined with Ctrl, Cmd or Option is left to xterm', () => {
  assert.deepEqual(mapTerminalKey(key({ shiftKey: true, ctrlKey: true })), { handled: false });
  assert.deepEqual(mapTerminalKey(key({ shiftKey: true, metaKey: true })), { handled: false });
  assert.deepEqual(mapTerminalKey(key({ shiftKey: true, altKey: true })), { handled: false });
});

test('other keys with Shift are left to xterm', () => {
  assert.deepEqual(mapTerminalKey(key({ key: 'A', shiftKey: true })), { handled: false });
  assert.deepEqual(mapTerminalKey(key({ key: 'Tab', shiftKey: true })), { handled: false });
});

test('Shift+Enter during IME composition is left to the IME', () => {
  assert.deepEqual(mapTerminalKey(key({ shiftKey: true, isComposing: true })), { handled: false });
});
