import { app, globalShortcut } from 'electron';
import type { AppSettings } from '../shared/types';

// Use require for electron-store due to ESM/CJS compatibility
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ElectronStore = require('electron-store');
const Store = ElectronStore.default || ElectronStore;

const DEFAULT_SETTINGS: AppSettings = {
  globalShortcut: '',
  launchAtLogin: false,
};

interface SettingsStoreSchema {
  settings: AppSettings;
}

const store = new Store({
  name: 'settings',
  defaults: {
    settings: DEFAULT_SETTINGS,
  },
}) as {
  get: <K extends keyof SettingsStoreSchema>(key: K) => SettingsStoreSchema[K];
  set: <K extends keyof SettingsStoreSchema>(key: K, value: SettingsStoreSchema[K]) => void;
};

let currentShortcut: string | null = null;
let shortcutCallback: (() => void) | null = null;

export function getSettings(): AppSettings {
  return store.get('settings');
}

export function saveSettings(settings: AppSettings): void {
  const oldSettings = getSettings();

  // Update stored settings
  store.set('settings', settings);

  // Handle global shortcut changes
  if (oldSettings.globalShortcut !== settings.globalShortcut) {
    updateGlobalShortcut(settings.globalShortcut);
  }

  // Handle launch at login changes
  if (oldSettings.launchAtLogin !== settings.launchAtLogin) {
    app.setLoginItemSettings({
      openAtLogin: settings.launchAtLogin,
    });
  }
}

export function setShortcutCallback(callback: () => void): void {
  shortcutCallback = callback;
}

export function updateGlobalShortcut(shortcut: string): void {
  // Unregister current shortcut
  if (currentShortcut) {
    try {
      globalShortcut.unregister(currentShortcut);
    } catch {
      // Ignore errors when unregistering
    }
    currentShortcut = null;
  }

  // Register new shortcut
  if (shortcut && shortcutCallback) {
    // Convert our format to Electron's accelerator format
    const accelerator = shortcut
      .replace('Command', 'CommandOrControl')
      .replace(/(?<!CommandOr)Control/, 'CommandOrControl');

    try {
      const registered = globalShortcut.register(accelerator, shortcutCallback);
      if (registered) {
        currentShortcut = accelerator;
      } else {
        console.warn(`[settings] Failed to register global shortcut: ${accelerator}`);
      }
    } catch (err) {
      console.warn(`[settings] Error registering global shortcut: ${err}`);
    }
  }
}

export function initializeSettings(callback: () => void): void {
  setShortcutCallback(callback);
  const settings = getSettings();

  // Apply global shortcut
  if (settings.globalShortcut) {
    updateGlobalShortcut(settings.globalShortcut);
  }

  // Apply launch at login
  app.setLoginItemSettings({
    openAtLogin: settings.launchAtLogin,
  });
}
