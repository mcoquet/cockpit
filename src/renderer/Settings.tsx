import { useState, useEffect } from 'react';

interface Settings {
  globalShortcut: string;
  launchAtLogin: boolean;
}

export default function Settings() {
  const [settings, setSettings] = useState<Settings>({
    globalShortcut: '',
    launchAtLogin: false,
  });
  const [recording, setRecording] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    window.cockpit.getSettings().then(setSettings);
  }, []);

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
      </div>

      <div className="actions">
        <button className={`save-btn ${saved ? 'saved' : ''}`} onClick={handleSave}>
          {saved ? 'Saved!' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
}
