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
  interpretSchedule: { cron: '0 9 * * 1-5', cronHuman: 'Weekdays at 09:00', prompt: 'Check for security issues', mode: 'interactive', queueBehavior: 'skip', catchUp: false, name: 'Weekday check' },
};
window.__calls = [];
window.cockpit = new Proxy({}, { get: (_, k) => {
  if (String(k).startsWith('on')) return () => {};
  return async (...a) => { window.__calls.push([k, a]); return k in defaults ? JSON.parse(JSON.stringify(defaults[k])) : null; };
}});
