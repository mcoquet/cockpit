# Window Focus on App Activate Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Focus the last active terminal window when the Cockpit app is activated via dock click or Cmd+Tab.

**Architecture:** Add `focusLastTerminalWindow()` to terminal-window.ts, then add `app.on('activate')` handler in index.ts that calls it (skipping if popup/settings is visible).

**Tech Stack:** Electron (app events, BrowserWindow)

---

### Task 1: Add focusLastTerminalWindow function

**Files:**
- Modify: `src/main/terminal-window.ts:158-168` (after `getFocusedTerminalWindowId`)

**Step 1: Add the function after getFocusedTerminalWindowId**

In `src/main/terminal-window.ts`, add after line 168:

```typescript
export function focusLastTerminalWindow(): boolean {
  // Focus the last focused terminal window if it still exists
  if (lastFocusedTerminalId) {
    for (const win of terminalWindows.values()) {
      if (win.id === lastFocusedTerminalId && !win.isDestroyed()) {
        win.show();
        win.focus();
        return true;
      }
    }
  }
  // Fallback: focus any available terminal window
  const windows = Array.from(terminalWindows.values()).filter(w => !w.isDestroyed());
  if (windows.length > 0) {
    windows[0].show();
    windows[0].focus();
    return true;
  }
  return false;
}
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build:main`
Expected: No errors

**Step 3: Commit**

```bash
git add src/main/terminal-window.ts
git commit -m "feat(terminal): add focusLastTerminalWindow function"
```

---

### Task 2: Add app.on('activate') handler

**Files:**
- Modify: `src/main/index.ts:994-996` (after `app.on('window-all-closed')`)

**Step 1: Add the activate handler**

In `src/main/index.ts`, add after line 996 (after `window-all-closed` handler):

```typescript
app.on('activate', () => {
  // Don't steal focus from popup or settings windows
  if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) return;
  if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isFocused()) return;

  terminalWindow.focusLastTerminalWindow();
});
```

**Step 2: Verify TypeScript compiles**

Run: `npm run build:main`
Expected: No errors

**Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: focus last terminal on app activate

Fixes cockpit-4fe - when app is activated via dock click or Cmd+Tab,
focus the last active terminal window instead of leaving it unfocused."
```

---

### Task 3: Manual testing

**Step 1: Start dev server**

Run: `npm run dev`

**Step 2: Test scenarios**

1. Open a terminal session for any project
2. Click away to another app (e.g., Finder)
3. Click the Cockpit dock icon → terminal should focus
4. Click away again
5. Cmd+Tab to Cockpit → terminal should focus
6. Open the popup (click tray icon), click away, Cmd+Tab back → popup should stay (not terminal)
7. With multiple terminals open, use the most recent one, switch away, activate → most recent should focus

**Step 3: Report results to user for validation**
