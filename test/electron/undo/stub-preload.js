const defaults = {
  getProjects: [{ path: '~/Projects/demo', name: 'demo', description: 'Demo project' }, { path: '~/Projects/other', name: 'other' }],
  getActiveSessions: {},
  getSettings: { globalShortcut: 'CommandOrControl+Shift+Space', launchAtLogin: false, externalTerminal: 'Terminal', envVars: [] },
  getCreateLocation: '~/Projects',
  hasSessionHistory: false,
  getProjectSessions: [],
  listSchedules: [],
  getScheduleHistory: [],
  hasSelection: false,
};
window.__calls = [];
window.cockpit = new Proxy({}, { get: (_, k) => {
  if (String(k).startsWith('on')) return () => {};
  return async (...a) => { window.__calls.push([k, a]); return k in defaults ? JSON.parse(JSON.stringify(defaults[k])) : null; };
}});
