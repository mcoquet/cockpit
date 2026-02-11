import { useState, useEffect } from 'react';
import type { ExternalTerminal } from '../shared/types';

interface Settings {
  globalShortcut: string;
  launchAtLogin: boolean;
  externalTerminal: ExternalTerminal;
}

const TERMINAL_OPTIONS: { value: ExternalTerminal | 'other'; label: string }[] = [
  { value: 'terminal', label: 'Terminal' },
  { value: 'iterm', label: 'iTerm' },
  { value: 'warp', label: 'Warp' },
  { value: 'kitty', label: 'Kitty' },
  { value: 'other', label: 'Other...' },
];

export default function Settings() {
  const [settings, setSettings] = useState<Settings>({
    globalShortcut: '',
    launchAtLogin: false,
    externalTerminal: 'terminal',
  });
  const [recording, setRecording] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load settings on mount
  useEffect(() => {
    window.cockpit.getSettings().then((s) => {
      setSettings(s);
      setLoaded(true);
    });
  }, []);

  // Auto-save on change (debounced)
  useEffect(() => {
    if (!loaded) return; // Don't save until initial load complete

    const timer = setTimeout(() => {
      window.cockpit.saveSettings(settings);
    }, 300);

    return () => clearTimeout(timer);
  }, [settings, loaded]);

  const handleTerminalChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const value = e.target.value;
    if (value === 'other') {
      // Open file picker for custom app
      const appName = await window.cockpit.selectApp();
      if (appName) {
        setSettings((s) => ({ ...s, externalTerminal: `custom:${appName}` }));
      }
    } else {
      setSettings((s) => ({ ...s, externalTerminal: value as ExternalTerminal }));
    }
  };

  const getTerminalDisplayValue = (): string => {
    const terminal = settings.externalTerminal;
    if (terminal.startsWith('custom:')) {
      return terminal; // Will show as custom option
    }
    return terminal;
  };

  const getTerminalLabel = (): string => {
    const terminal = settings.externalTerminal;
    if (terminal.startsWith('custom:')) {
      return terminal.slice(7); // Remove "custom:" prefix
    }
    const option = TERMINAL_OPTIONS.find((o) => o.value === terminal);
    return option?.label || 'Terminal';
  };

  const handleRecordShortcut = () => {
    setRecording(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return;

    e.preventDefault();

    const parts: string[] = [];
    if (e.metaKey) parts.push('Command');
    if (e.ctrlKey) parts.push('Control');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    const key = e.key;
    if (!['Meta', 'Control', 'Alt', 'Shift'].includes(key)) {
      const keyName = key.length === 1 ? key.toUpperCase() : key;
      parts.push(keyName);

      const shortcut = parts.join('+');
      setSettings((s) => ({ ...s, globalShortcut: shortcut }));
      setRecording(false);
    }
  };

  const handleClearShortcut = () => {
    setSettings((s) => ({ ...s, globalShortcut: '' }));
  };

  const formatShortcut = (shortcut: string) => {
    if (!shortcut) return 'None';
    return shortcut
      .replace('CommandOrControl', '⌘')
      .replace('Command', '⌘')
      .replace('Control', '⌃')
      .replace('Alt', '⌥')
      .replace('Shift', '⇧')
      .replace(/\+/g, '');
  };

  return (
    <div className="settings">
      <h1>Settings</h1>

      <div className="settings-card">
        <div className="card-title">Shortcuts</div>
        <div className="setting-row">
          <div>
            <div className="setting-label">Global Shortcut</div>
            <div className="setting-description">Open Cockpit from anywhere</div>
          </div>
          <div className="shortcut-wrapper">
            <div
              className={`shortcut-display ${recording ? 'recording' : ''}`}
              onClick={handleRecordShortcut}
              onKeyDown={handleKeyDown}
              tabIndex={0}
            >
              {recording ? 'Press keys...' : formatShortcut(settings.globalShortcut)}
            </div>
            {settings.globalShortcut && (
              <button className="clear-btn" onClick={handleClearShortcut}>
                ✕
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="settings-card">
        <div className="card-title">General</div>
        <div className="setting-row">
          <div>
            <div className="setting-label">Launch at Login</div>
            <div className="setting-description">Start Cockpit when you log in</div>
          </div>
          <div
            className={`toggle-switch ${settings.launchAtLogin ? 'active' : ''}`}
            onClick={() =>
              setSettings((s) => ({ ...s, launchAtLogin: !s.launchAtLogin }))
            }
          />
        </div>
        <div className="setting-row">
          <div>
            <div className="setting-label">External Terminal</div>
            <div className="setting-description">Cmd+T opens this terminal</div>
          </div>
          <select
            className="terminal-select"
            value={getTerminalDisplayValue()}
            onChange={handleTerminalChange}
          >
            {TERMINAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
            {settings.externalTerminal.startsWith('custom:') && (
              <option value={settings.externalTerminal}>
                {getTerminalLabel()}
              </option>
            )}
          </select>
        </div>
      </div>

    </div>
  );
}
