import { useState, useEffect } from 'react';

interface Settings {
  globalShortcut: string;
  launchAtLogin: boolean;
}

const DEFAULT_SHORTCUT = 'CommandOrControl+Shift+Space';

export default function Settings() {
  const [settings, setSettings] = useState<Settings>({
    globalShortcut: DEFAULT_SHORTCUT,
    launchAtLogin: false,
  });
  const [recording, setRecording] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // Load settings on mount
    window.cockpit.getSettings().then(setSettings);
  }, []);

  const handleRecordShortcut = () => {
    setRecording(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!recording) return;

    e.preventDefault();

    // Build shortcut string
    const parts: string[] = [];
    if (e.metaKey) parts.push('Command');
    if (e.ctrlKey) parts.push('Control');
    if (e.altKey) parts.push('Alt');
    if (e.shiftKey) parts.push('Shift');

    // Add the key if it's not just a modifier
    const key = e.key;
    if (!['Meta', 'Control', 'Alt', 'Shift'].includes(key)) {
      // Normalize key names
      const keyName = key.length === 1 ? key.toUpperCase() : key;
      parts.push(keyName);

      const shortcut = parts.join('+');
      setSettings((s) => ({ ...s, globalShortcut: shortcut }));
      setRecording(false);
    }
  };

  const handleSave = async () => {
    await window.cockpit.saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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

      <div className="setting-group">
        <label>Global Shortcut</label>
        <p className="setting-description">
          Press this shortcut from anywhere to open Cockpit
        </p>
        <div className="shortcut-input">
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

      <div className="setting-group">
        <label>
          <input
            type="checkbox"
            checked={settings.launchAtLogin}
            onChange={(e) =>
              setSettings((s) => ({ ...s, launchAtLogin: e.target.checked }))
            }
          />
          Launch at login
        </label>
      </div>

      <div className="actions">
        <button className="save-btn" onClick={handleSave}>
          {saved ? 'Saved!' : 'Save'}
        </button>
      </div>
    </div>
  );
}
