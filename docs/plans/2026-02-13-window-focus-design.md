# Window Focus on App Activate

**Ticket:** cockpit-4fe
**Date:** 2026-02-13

## Problem

When the Cockpit app is activated (dock click, Cmd+Tab), terminal session windows remain unfocused. The last active session window should receive focus.

## Design Decisions

- **Multi-window behavior:** Focus the last active terminal window (most recently used)
- **Popup handling:** If popup window is open, keep it focused (user intentionally opened it)
- **No sessions:** Do nothing, let macOS handle naturally

## Solution

### 1. terminal-window.ts: Add `focusLastTerminalWindow()`

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

### 2. index.ts: Add `app.on('activate')` handler

```typescript
app.on('activate', () => {
  // Don't steal focus from popup or settings windows
  if (popupWindow && !popupWindow.isDestroyed() && popupWindow.isVisible()) return;
  if (settingsWindow && !settingsWindow.isDestroyed() && settingsWindow.isFocused()) return;

  terminalWindow.focusLastTerminalWindow();
});
```

## Data Flow

```
User activates app → activate event → check popup/settings → focusLastTerminalWindow() → terminal gets focus
```
