// Tests for the popup's capabilities summary (#14, #12). Runs against compiled output.
// Project-specific items are listed by name; user-level, plugin and managed items fold
// into a "+N global" count whose names go in a tooltip.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { summarizeCapabilities } = require('../dist/main/shared/capabilities-display.js');

const empty = { mcpServers: [], skills: [], agents: [], commands: [], plugins: [], problems: [] };

test('nothing configured gives no groups', () => {
  assert.deepEqual(summarizeCapabilities(empty), { groups: [], problems: [] });
});

test('MCP servers list own servers enabled first, with state notes, and fold the rest', () => {
  const s = summarizeCapabilities({
    ...empty,
    mcpServers: [
      { name: 'old', source: 'project', transport: 'stdio', state: 'disabled' },
      { name: 'github', source: 'project', transport: 'stdio', state: 'enabled' },
      { name: 'sentry', source: 'project', transport: 'http', state: 'needs-approval' },
      { name: 'mine', source: 'local', transport: 'sse', state: 'enabled' },
      { name: 'everywhere', source: 'user', transport: 'stdio', state: 'enabled' },
      { name: 'tracker', source: 'plugin', plugin: 'tools', transport: 'http', state: 'disabled' },
    ],
  });
  assert.equal(s.groups.length, 1);
  const g = s.groups[0];
  assert.equal(g.label, 'MCP');
  assert.deepEqual(g.own.map((i) => i.text), ['github', 'mine', 'sentry (needs approval)', 'old (disabled)']);
  assert.deepEqual(g.own.map((i) => i.muted), [false, false, true, true]);
  assert.deepEqual(g.global, ['everywhere', 'tools:tracker (disabled)']);
});

test('skills, agents and commands keep that order; plugin items are prefixed and folded', () => {
  const s = summarizeCapabilities({
    ...empty,
    skills: [
      { name: 'deploy', source: 'project', description: 'Deploys' },
      { name: 'notes', source: 'user' },
      { name: 'lint', source: 'plugin', plugin: 'tools' },
    ],
    agents: [{ name: 'reviewer', source: 'user' }],
    commands: [{ name: 'frontend:component', source: 'project', description: 'New component' }],
  });
  assert.deepEqual(s.groups.map((g) => g.label), ['Skills', 'Agents', 'Commands']);
  const [skills, agents, commands] = s.groups;
  assert.deepEqual(skills.own, [{ text: 'deploy', title: 'Deploys', muted: false }]);
  assert.deepEqual(skills.global, ['notes', 'tools:lint'], 'sorted by name');
  assert.deepEqual(agents.own, []);
  assert.deepEqual(agents.global, ['reviewer']);
  assert.deepEqual(commands.own.map((i) => i.text), ['/frontend:component']);
});

test('problems are passed through', () => {
  const s = summarizeCapabilities({ ...empty, problems: ['~/.claude.json: invalid JSON'] });
  assert.deepEqual(s.problems, ['~/.claude.json: invalid JSON']);
});
