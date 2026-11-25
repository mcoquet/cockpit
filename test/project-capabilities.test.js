// Tests for the project capabilities reader (#14, #12). Runs against compiled output.
// Each test builds a throwaway home folder and project folder holding Claude Code's
// config files, then checks which MCP servers, skills, agents and commands the reader
// reports for the project. Missing and malformed files must never throw.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  readProjectCapabilities,
  createCapabilitiesReader,
  parseFrontmatter,
} = require('../dist/main/main/project-capabilities.js');

/** Writes { 'relative/path': content } under a new temp folder; objects become JSON. */
function fixture(files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cockpit-caps-'));
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  }
  return root;
}

/** A home folder, a project folder inside it, and a managed folder, all from specs. */
function setup({ home = {}, project = {}, managed = {} } = {}) {
  const homeDir = fixture(home);
  const projectDir = path.join(homeDir, 'Projects', 'app');
  fs.mkdirSync(projectDir, { recursive: true });
  for (const [rel, content] of Object.entries(project)) {
    const file = path.join(projectDir, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
  }
  const managedDir = fixture(managed);
  return { projectDir, paths: { home: homeDir, managedDir } };
}

const read = ({ projectDir, paths }) => readProjectCapabilities(projectDir, paths);
const byName = (items) => Object.fromEntries(items.map((i) => [i.plugin ? `${i.plugin}:${i.name}` : i.name, i]));
const skill = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\n\nBody\n`;

// --- nothing configured -----------------------------------------------------------

test('a project with no Claude Code config has no capabilities and no problems', async () => {
  const caps = await read(setup());
  assert.deepEqual(caps, { mcpServers: [], skills: [], agents: [], commands: [], plugins: [], problems: [] });
});

test('a project folder that does not exist is not an error', async () => {
  const s = setup();
  const caps = await readProjectCapabilities(path.join(s.paths.home, 'nope'), s.paths);
  assert.deepEqual(caps.problems, []);
  assert.deepEqual(caps.mcpServers, []);
});

// --- MCP servers --------------------------------------------------------------------

test('project .mcp.json servers need approval until a settings file approves them', async () => {
  const s = setup({
    project: {
      '.mcp.json': { mcpServers: { github: { command: 'gh-mcp' }, sentry: { type: 'http', url: 'https://x' }, old: { command: 'x' } } },
      '.claude/settings.local.json': { enabledMcpjsonServers: ['github'], disabledMcpjsonServers: ['old'] },
    },
  });
  const m = byName((await read(s)).mcpServers);
  assert.equal(m.github.state, 'enabled');
  assert.equal(m.github.source, 'project');
  assert.equal(m.sentry.state, 'needs-approval');
  assert.equal(m.old.state, 'disabled');
});

test('enableAllProjectMcpServers approves every project server except disabled ones', async () => {
  const s = setup({
    home: { '.claude/settings.json': { enableAllProjectMcpServers: true } },
    project: {
      '.mcp.json': { mcpServers: { a: { command: 'a' }, b: { command: 'b' } } },
      '.claude/settings.json': { disabledMcpjsonServers: ['b'] },
    },
  });
  const m = byName((await read(s)).mcpServers);
  assert.equal(m.a.state, 'enabled');
  assert.equal(m.b.state, 'disabled');
});

test('~/.claude.json gives local-scope and user-scope servers, approvals and per-project disables', async () => {
  const s = setup();
  fs.writeFileSync(
    path.join(s.paths.home, '.claude.json'),
    JSON.stringify({
      mcpServers: { everywhere: { command: 'e' }, muted: { command: 'm' } },
      projects: {
        [s.projectDir]: {
          mcpServers: { mine: { type: 'sse', url: 'https://s' } },
          enabledMcpjsonServers: ['shared'],
          disabledMcpServers: ['muted'],
        },
        '/some/other/project': { mcpServers: { notmine: { command: 'n' } } },
      },
    })
  );
  fs.writeFileSync(path.join(s.projectDir, '.mcp.json'), JSON.stringify({ mcpServers: { shared: { command: 's' } } }));
  const m = byName((await read(s)).mcpServers);
  assert.deepEqual(Object.keys(m).sort(), ['everywhere', 'mine', 'muted', 'shared']);
  assert.equal(m.mine.source, 'local');
  assert.equal(m.mine.transport, 'sse');
  assert.equal(m.everywhere.source, 'user');
  assert.equal(m.everywhere.state, 'enabled');
  assert.equal(m.muted.state, 'disabled');
  assert.equal(m.shared.state, 'enabled');
});

test('the same server name in several scopes is listed once: local, then project, then user', async () => {
  const s = setup({ project: { '.mcp.json': { mcpServers: { db: { command: 'p' }, api: { command: 'p' } } } } });
  fs.writeFileSync(
    path.join(s.paths.home, '.claude.json'),
    JSON.stringify({ mcpServers: { db: { command: 'u' }, api: { command: 'u' } }, projects: { [s.projectDir]: { mcpServers: { db: { command: 'l' } } } } })
  );
  const caps = await read(s);
  assert.equal(caps.mcpServers.length, 2);
  const m = byName(caps.mcpServers);
  assert.equal(m.db.source, 'local');
  assert.equal(m.api.source, 'project');
});

test('transport comes from type, or stdio when there is none', async () => {
  const s = setup({
    project: {
      '.mcp.json': { mcpServers: { a: { command: 'x' }, b: { type: 'http', url: 'u' }, c: { type: 'streamable-http', url: 'u' }, d: { type: 'ws', url: 'u' } } },
      '.claude/settings.json': { enableAllProjectMcpServers: true },
    },
  });
  const m = byName((await read(s)).mcpServers);
  assert.deepEqual([m.a, m.b, m.c, m.d].map((x) => x.transport), ['stdio', 'http', 'http', 'ws']);
});

test('a managed managed-mcp.json takes exclusive control of MCP servers', async () => {
  const s = setup({
    managed: { 'managed-mcp.json': { mcpServers: { corp: { type: 'http', url: 'https://corp' } } } },
    project: { '.mcp.json': { mcpServers: { local: { command: 'x' } } } },
  });
  const caps = await read(s);
  assert.deepEqual(caps.mcpServers.map((x) => [x.name, x.source, x.state]), [['corp', 'managed', 'enabled']]);
});

// --- malformed files ------------------------------------------------------------------

test('malformed JSON files are reported as problems and the rest is still read', async () => {
  const s = setup({
    home: { '.claude.json': '{ not json', '.claude/skills/review/SKILL.md': skill('review', 'Reviews') },
    project: { '.mcp.json': '{"mcpServers": ', '.claude/settings.json': '[1,2' },
  });
  const caps = await read(s);
  assert.deepEqual(caps.mcpServers, []);
  assert.equal(caps.skills.length, 1);
  assert.equal(caps.problems.length, 3);
  assert.ok(caps.problems.some((p) => p.includes('.claude.json')));
  assert.ok(caps.problems.some((p) => p.includes('.mcp.json')));
  assert.ok(caps.problems.some((p) => p.includes('settings.json')));
});

test('wrong shapes are ignored rather than thrown on', async () => {
  const s = setup({
    project: {
      '.mcp.json': { mcpServers: ['not', 'an', 'object'] },
      '.claude/settings.json': { enabledPlugins: 'yes', enabledMcpjsonServers: 'github' },
    },
  });
  s.paths.home && fs.writeFileSync(path.join(s.paths.home, '.claude.json'), JSON.stringify({ projects: null, mcpServers: 7 }));
  const caps = await read(s);
  assert.deepEqual(caps.mcpServers, []);
  assert.deepEqual(caps.plugins, []);
});

// --- skills, agents, commands -----------------------------------------------------------

test('skills come from project and user skills folders, user wins a name clash', async () => {
  const s = setup({
    home: {
      '.claude/skills/deploy/SKILL.md': skill('deploy', 'User deploy'),
      '.claude/skills/notes/SKILL.md': '---\ndescription: >\n  Takes notes\n  in markdown\n---\n',
    },
    project: {
      '.claude/skills/deploy/SKILL.md': skill('deploy', 'Project deploy'),
      '.claude/skills/migrate/SKILL.md': skill('migrate', '"Runs migrations"'),
      '.claude/skills/empty-folder/readme.txt': 'no SKILL.md here',
    },
  });
  const caps = await read(s);
  const k = byName(caps.skills);
  assert.deepEqual(Object.keys(k).sort(), ['deploy', 'migrate', 'notes']);
  assert.equal(k.deploy.source, 'user');
  assert.equal(k.deploy.description, 'User deploy');
  assert.equal(k.migrate.description, 'Runs migrations');
  assert.equal(k.notes.description, 'Takes notes in markdown', 'name defaults to the folder; folded description');
});

test('agents are found recursively, need name and description, project wins a clash', async () => {
  const s = setup({
    home: { '.claude/agents/reviewer.md': '---\nname: reviewer\ndescription: user one\n---\n' },
    project: {
      '.claude/agents/team/reviewer.md': '---\nname: reviewer\ndescription: project one\n---\n',
      '.claude/agents/broken.md': '---\ndescription: no name\n---\n',
      '.claude/agents/plain.md': 'no frontmatter at all',
    },
  });
  const caps = await read(s);
  assert.deepEqual(caps.agents.map((a) => [a.name, a.source, a.description]), [['reviewer', 'project', 'project one']]);
});

test('commands are namespaced by subfolder and a skill with the same name hides a command', async () => {
  const s = setup({
    home: { '.claude/commands/standup.md': 'Summarise yesterday\nmore' },
    project: {
      '.claude/commands/frontend/component.md': '---\ndescription: New component\n---\nBody',
      '.claude/commands/migrate.md': 'Old migrate command',
      '.claude/skills/migrate/SKILL.md': skill('migrate', 'New migrate skill'),
    },
  });
  const caps = await read(s);
  const c = byName(caps.commands);
  assert.deepEqual(Object.keys(c).sort(), ['frontend:component', 'standup']);
  assert.equal(c['frontend:component'].description, 'New component');
  assert.equal(c['frontend:component'].source, 'project');
  assert.equal(c.standup.description, 'Summarise yesterday', 'first non-empty line when no frontmatter');
  assert.equal(c.standup.source, 'user');
});

// --- plugins -------------------------------------------------------------------------------

function pluginHome(extra = {}) {
  const tools = '.claude/plugins/cache/mkt/tools/1.0.0';
  const single = '.claude/plugins/cache/mkt/single/2.0.0';
  return {
    tools,
    single,
    files: {
      [`${tools}/.claude-plugin/plugin.json`]: { name: 'tools', mcpServers: { inline: { command: 'i' } } },
      [`${tools}/skills/lint/SKILL.md`]: skill('lint', 'Lints'),
      [`${tools}/agents/fixer.md`]: '---\nname: fixer\ndescription: Fixes\n---\n',
      [`${tools}/commands/ship.md`]: '---\ndescription: Ships\n---\n',
      [`${tools}/.mcp.json`]: { mcpServers: { tracker: { type: 'http', url: 'u' } } },
      [`${single}/SKILL.md`]: skill('single', 'A one-skill plugin'),
      ...extra,
    },
  };
}

test('enabled plugins contribute skills, agents, commands and MCP servers', async () => {
  const h = pluginHome();
  const s = setup({
    home: {
      ...h.files,
      '.claude/settings.json': { enabledPlugins: { 'tools@mkt': true, 'single@mkt': true } },
      '.claude/plugins/installed_plugins.json': {
        version: 2,
        plugins: {
          'tools@mkt': [{ scope: 'user', installPath: 'TOOLS' }],
          'single@mkt': [{ scope: 'user', installPath: 'SINGLE' }],
        },
      },
    },
  });
  // installPath values are absolute in real files; patch them now that home is known.
  const ip = path.join(s.paths.home, '.claude/plugins/installed_plugins.json');
  fs.writeFileSync(ip, fs.readFileSync(ip, 'utf8').replace('TOOLS', path.join(s.paths.home, h.tools)).replace('SINGLE', path.join(s.paths.home, h.single)));

  const caps = await read(s);
  assert.deepEqual(caps.plugins.map((p) => [p.id, p.installed]), [['single@mkt', true], ['tools@mkt', true]]);
  assert.deepEqual(Object.keys(byName(caps.skills)).sort(), ['single:single', 'tools:lint']);
  assert.deepEqual(Object.keys(byName(caps.agents)), ['tools:fixer']);
  assert.deepEqual(Object.keys(byName(caps.commands)), ['tools:ship']);
  const m = byName(caps.mcpServers);
  assert.deepEqual(Object.keys(m).sort(), ['tools:inline', 'tools:tracker']);
  assert.equal(m['tools:tracker'].source, 'plugin');
  assert.equal(m['tools:tracker'].state, 'enabled');
});

test('project settings can turn a user plugin off, and a project install is preferred', async () => {
  const h = pluginHome();
  const s = setup({
    home: { ...h.files, '.claude/settings.json': { enabledPlugins: { 'tools@mkt': true, 'single@mkt': true } } },
    project: { '.claude/settings.local.json': { enabledPlugins: { 'single@mkt': false } } },
  });
  fs.writeFileSync(
    path.join(s.paths.home, '.claude/plugins/installed_plugins.json'),
    JSON.stringify({
      version: 2,
      plugins: {
        'tools@mkt': [
          { scope: 'user', installPath: '/nowhere' },
          { scope: 'project', projectPath: s.projectDir, installPath: path.join(s.paths.home, h.tools) },
        ],
      },
    })
  );
  const caps = await read(s);
  assert.deepEqual(caps.plugins.map((p) => p.id), ['tools@mkt']);
  assert.equal(caps.plugins[0].source, 'user');
  assert.deepEqual(Object.keys(byName(caps.skills)), ['tools:lint']);
});

test('an enabled plugin that is not installed is listed as not installed, not thrown on', async () => {
  const s = setup({ home: { '.claude/settings.json': { enabledPlugins: { 'ghost@mkt': true } } } });
  const caps = await read(s);
  assert.deepEqual(caps.plugins, [{ id: 'ghost@mkt', name: 'ghost', source: 'user', installed: false }]);
  assert.deepEqual(caps.skills, []);
});

test('version 1 installed_plugins.json (one record per plugin) is understood', async () => {
  const h = pluginHome();
  const s = setup({ home: { ...h.files }, project: { '.claude/settings.json': { enabledPlugins: { 'single@mkt': true } } } });
  fs.writeFileSync(
    path.join(s.paths.home, '.claude/plugins/installed_plugins.json'),
    JSON.stringify({ version: 1, plugins: { 'single@mkt': { installPath: path.join(s.paths.home, h.single) } } })
  );
  const caps = await read(s);
  assert.deepEqual(caps.plugins.map((p) => [p.id, p.source, p.installed]), [['single@mkt', 'project', true]]);
  assert.deepEqual(Object.keys(byName(caps.skills)), ['single:single']);
});

// --- frontmatter ----------------------------------------------------------------------------

test('parseFrontmatter reads plain, quoted and block values and ignores the body', () => {
  const fm = parseFrontmatter('---\nname: a\ndescription: "quoted: yes"\nother: |\n  line one\n  line two\nlast: \'single\'\n---\nname: body');
  assert.equal(fm.name, 'a');
  assert.equal(fm.description, 'quoted: yes');
  assert.equal(fm.other, 'line one\nline two');
  assert.equal(fm.last, 'single');
  assert.deepEqual(parseFrontmatter('no frontmatter'), {});
  assert.deepEqual(parseFrontmatter('---\nname: unterminated'), {});
});

// --- caching ----------------------------------------------------------------------------------

test('the cached reader re-reads only when a source file changes', async () => {
  const s = setup({ project: { '.mcp.json': { mcpServers: { a: { command: 'a' } } } } });
  const reader = createCapabilitiesReader(s.paths);
  const first = await reader.get(s.projectDir);
  const second = await reader.get(s.projectDir);
  assert.equal(second, first, 'same object while nothing changed');

  const file = path.join(s.projectDir, '.mcp.json');
  fs.writeFileSync(file, JSON.stringify({ mcpServers: { a: { command: 'a' }, b: { command: 'b' } } }));
  const later = new Date(Date.now() + 5000);
  fs.utimesSync(file, later, later);
  const third = await reader.get(s.projectDir);
  assert.notEqual(third, first);
  assert.deepEqual(third.mcpServers.map((x) => x.name).sort(), ['a', 'b']);
});

test('concurrent requests for one project share a single read', async () => {
  const s = setup();
  const reader = createCapabilitiesReader(s.paths);
  const [a, b] = await Promise.all([reader.get(s.projectDir), reader.get(s.projectDir)]);
  assert.equal(a, b);
});

// --- review follow-ups ------------------------------------------------------------------------

test('other keys in the ~/.claude.json project entry are not MCP servers', async () => {
  const s = setup();
  fs.writeFileSync(
    path.join(s.paths.home, '.claude.json'),
    JSON.stringify({ projects: { [s.projectDir]: { allowedTools: [], lastModelUsage: { opus: { inputTokens: 1 } }, hasTrustDialogAccepted: true } } })
  );
  assert.deepEqual((await read(s)).mcpServers, []);
});

test('a project .mcp.json without an mcpServers key has no servers', async () => {
  const s = setup({ project: { '.mcp.json': { github: { command: 'gh' } } } });
  assert.deepEqual((await read(s)).mcpServers, []);
});

test('plugin manifest paths outside the plugin folder are ignored; single files are read', async () => {
  const root = '.claude/plugins/cache/mkt/odd/1.0.0';
  const s = setup({
    home: {
      [`${root}/.claude-plugin/plugin.json`]: { name: 'odd', commands: ['..', '/', './extra/hello.md'], agents: '../../../..' },
      [`${root}/extra/hello.md`]: '---\ndescription: Says hello\n---\n',
      '.claude/plugins/cache/mkt/odd/stray.md': 'Outside the plugin',
      'Documents/private.md': 'Never read',
      '.claude/settings.json': { enabledPlugins: { 'odd@mkt': true } },
    },
  });
  fs.writeFileSync(
    path.join(s.paths.home, '.claude/plugins/installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'odd@mkt': [{ scope: 'user', installPath: path.join(s.paths.home, root) }] } })
  );
  const caps = await read(s);
  assert.deepEqual(caps.commands.map((c) => [`${c.plugin}:${c.name}`, c.description]), [['odd:hello', 'Says hello']]);
  assert.deepEqual(caps.agents, []);
});

test('a v2 install made for another project is not used', async () => {
  const h = pluginHome();
  const s = setup({ home: { ...h.files, '.claude/settings.json': { enabledPlugins: { 'tools@mkt': true } } } });
  fs.writeFileSync(
    path.join(s.paths.home, '.claude/plugins/installed_plugins.json'),
    JSON.stringify({ version: 2, plugins: { 'tools@mkt': [{ scope: 'project', projectPath: '/other/project', installPath: path.join(s.paths.home, h.tools) }] } })
  );
  const caps = await read(s);
  assert.deepEqual(caps.plugins.map((p) => [p.id, p.installed]), [['tools@mkt', false]]);
  assert.deepEqual(caps.skills, []);
});

test('the cached reader also re-reads once a result is older than maxAgeMs', async () => {
  const s = setup({ project: { '.claude/skills/one/SKILL.md': skill('one', 'First') } });
  let now = 1000;
  const reader = createCapabilitiesReader(s.paths, { maxAgeMs: 30000, now: () => now });
  const first = await reader.get(s.projectDir);
  // Edit inside an existing skill folder: no watched mtime changes.
  fs.writeFileSync(path.join(s.projectDir, '.claude/skills/one/SKILL.md'), skill('one', 'Edited'));
  now += 10000;
  assert.equal(await reader.get(s.projectDir), first, 'still fresh');
  now += 30000;
  const later = await reader.get(s.projectDir);
  assert.equal(later.skills[0].description, 'Edited');
});
