import { promises as fs } from 'fs';
import path from 'path';
import type {
  CapabilityItem,
  CapabilitySource,
  McpServerInfo,
  PluginInfo,
  ProjectCapabilities,
} from '../shared/types';

/**
 * Reads, without changing anything, which MCP servers, skills, subagents, slash
 * commands and plugins Claude Code would load when launched in a project (#14, #12).
 *
 * Sources (per code.claude.com/docs, checked 2026-11-25):
 * - MCP: `<project>/.mcp.json`; `~/.claude.json` top-level `mcpServers` (user scope)
 *   and `projects["<abs path>"].mcpServers` (local scope); enabled plugins; and
 *   `<managed>/managed-mcp.json`, which when present is the only source.
 *   A project server is enabled once `enabledMcpjsonServers` or
 *   `enableAllProjectMcpServers` approves it and disabled by `disabledMcpjsonServers`
 *   (any settings file or the `~/.claude.json` project entry); the project entry's
 *   `disabledMcpServers` turns any server off.
 * - Skills: `.claude/skills/<name>/SKILL.md` in the project and in `~/.claude`.
 * - Agents: `.claude/agents/**.md` (name and description required).
 * - Commands: `.claude/commands/**.md`; a subfolder becomes a `ns:` prefix.
 * - Plugins: `enabledPlugins` across user, project, local and managed settings, located
 *   through `~/.claude/plugins/installed_plugins.json`.
 *
 * Not read: parent folders up to the repository root, nested `.claude/skills` in
 * subfolders, managed skills and agents, `CLAUDE_CONFIG_DIR`.
 *
 * Kept free of Electron so it can be unit-tested. Missing files are normal; files that
 * exist but cannot be parsed are listed in `problems`. Nothing here throws.
 */

export interface CapabilityPaths {
  /** The user's home folder (holds `.claude.json` and `.claude/`). */
  home: string;
  /** Folder of managed (enterprise) settings. Defaults to the macOS location. */
  managedDir?: string;
}

export const DEFAULT_MANAGED_DIR = '/Library/Application Support/ClaudeCode';

type Json = Record<string, unknown>;

const isObj = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined);
const MAX_DEPTH = 4;
/** Most Markdown files read from one skills, agents or commands folder. */
const MAX_FILES = 300;
/** Files bigger than this are skipped; frontmatter is at the top of small files. */
const MAX_BYTES = 256 * 1024;

class Reader {
  problems: string[] = [];

  constructor(private home: string) {}

  private show(file: string): string {
    return file.startsWith(this.home + path.sep) ? '~' + file.slice(this.home.length) : file;
  }

  async text(file: string): Promise<string | undefined> {
    try {
      const st = await fs.stat(file);
      if (st.size > MAX_BYTES) {
        this.problems.push(`${this.show(file)}: larger than ${MAX_BYTES / 1024} KB, skipped`);
        return undefined;
      }
      return await fs.readFile(file, 'utf8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT' && code !== 'ENOTDIR' && code !== 'EISDIR') {
        this.problems.push(`${this.show(file)}: ${(err as Error).message}`);
      }
      return undefined;
    }
  }

  /** A JSON object file, or undefined when missing or unusable (then a problem is noted). */
  async json(file: string): Promise<Json | undefined> {
    const raw = await this.text(file);
    if (raw === undefined) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isObj(parsed)) return parsed;
      this.problems.push(`${this.show(file)}: not a JSON object`);
    } catch {
      this.problems.push(`${this.show(file)}: invalid JSON`);
    }
    return undefined;
  }

  async entries(dir: string): Promise<{ name: string; isDir: boolean; isFile: boolean }[]> {
    try {
      const list = await fs.readdir(dir, { withFileTypes: true });
      return Promise.all(
        list.map(async (d) => {
          if (!d.isSymbolicLink()) return { name: d.name, isDir: d.isDirectory(), isFile: d.isFile() };
          const st = await fs.stat(path.join(dir, d.name)).catch(() => undefined);
          return { name: d.name, isDir: !!st?.isDirectory(), isFile: !!st?.isFile() };
        })
      );
    } catch {
      return [];
    }
  }

  /**
   * Every `*.md` file under dir, as paths relative to it (at most MAX_FILES, skipping
   * dot folders and node_modules). A dir that is itself a `.md` file gives ''.
   */
  async markdownFiles(dir: string): Promise<string[]> {
    if (dir.endsWith('.md')) {
      const st = await fs.stat(dir).catch(() => undefined);
      return st?.isFile() ? [''] : [];
    }
    const out: string[] = [];
    const walk = async (rel: string, depth: number) => {
      if (depth > MAX_DEPTH) return;
      for (const e of await this.entries(path.join(dir, rel))) {
        if (out.length >= MAX_FILES) return;
        if (e.name.startsWith('.') || e.name === 'node_modules') continue;
        const child = rel ? path.join(rel, e.name) : e.name;
        if (e.isDir) await walk(child, depth + 1);
        else if (e.isFile && e.name.endsWith('.md')) out.push(child);
      }
    };
    await walk('', 0);
    return out.sort();
  }
}

/**
 * Reads the YAML frontmatter block at the top of a Markdown file. Handles what skill,
 * agent and command files use: `key: value`, quoted values and `|`/`>` blocks. Nested
 * structures are skipped. Returns {} when there is no complete block.
 */
export function parseFrontmatter(text: string): Record<string, string> {
  return splitFrontmatter(text).fields;
}

function splitFrontmatter(text: string): { fields: Record<string, string>; body: string } {
  const lines = text.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { fields: {}, body: text };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end < 0) return { fields: {}, body: text };
  const fields: Record<string, string> = {};
  for (let i = 1; i < end; i++) {
    const m = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(lines[i]);
    if (!m) continue;
    const [, key, rawValue] = m;
    const value = rawValue.trim();
    if (/^[|>][+-]?$/.test(value)) {
      const block: string[] = [];
      while (i + 1 < end && (/^\s/.test(lines[i + 1]) || lines[i + 1].trim() === '')) block.push(lines[++i].trim());
      while (block.length && block[block.length - 1] === '') block.pop();
      fields[key] = value.startsWith('|') ? block.join('\n') : block.filter(Boolean).join(' ');
    } else if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
      fields[key] = value.slice(1, -1).replace(/\\"/g, '"');
    } else if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
      fields[key] = value.slice(1, -1).replace(/''/g, "'");
    } else {
      fields[key] = value;
    }
  }
  return { fields, body: lines.slice(end + 1).join('\n') };
}

function transportOf(config: Json): McpServerInfo['transport'] {
  const type = typeof config.type === 'string' ? config.type : '';
  if (type === 'http' || type === 'streamable-http') return 'http';
  if (type === 'sse') return 'sse';
  if (type === 'ws') return 'ws';
  return 'stdio';
}

/** The `mcpServers` map of a config object (`.mcp.json`, a `~/.claude.json` entry). */
function serverMap(value: unknown): Json {
  return isObj(value) && isObj(value.mcpServers) ? value.mcpServers : {};
}

/** Plugins may also give a bare name → config map. */
function pluginServerMap(value: unknown): Json {
  if (!isObj(value)) return {};
  return 'mcpServers' in value ? serverMap(value) : value;
}

async function readSkills(r: Reader, dir: string, source: CapabilitySource, plugin?: string): Promise<CapabilityItem[]> {
  const out: CapabilityItem[] = [];
  for (const e of await r.entries(dir)) {
    if (!e.isDir || e.name.startsWith('.')) continue;
    const text = await r.text(path.join(dir, e.name, 'SKILL.md'));
    if (text === undefined) continue;
    const fm = parseFrontmatter(text);
    out.push(item(str(fm.name) ?? e.name, str(fm.description), source, plugin));
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function readAgents(r: Reader, dir: string, source: CapabilitySource, plugin?: string): Promise<CapabilityItem[]> {
  const out: CapabilityItem[] = [];
  for (const rel of await r.markdownFiles(dir)) {
    const text = await r.text(path.join(dir, rel));
    if (text === undefined) continue;
    const fm = parseFrontmatter(text);
    const name = str(fm.name);
    const description = str(fm.description);
    // Claude Code skips agent files without a valid name and description.
    if (name && description && !name.includes(':')) out.push(item(name, description, source, plugin));
  }
  return out;
}

async function readCommands(r: Reader, dir: string, source: CapabilitySource, plugin?: string): Promise<CapabilityItem[]> {
  const out: CapabilityItem[] = [];
  for (const rel of await r.markdownFiles(dir)) {
    const text = await r.text(path.join(dir, rel));
    if (text === undefined) continue;
    const { fields, body } = splitFrontmatter(text);
    const firstLine = body.split(/\r?\n/).map((l) => l.replace(/^#+\s*/, '').trim()).find(Boolean);
    const name = (rel || path.basename(dir)).replace(/\.md$/, '').split(path.sep).join(':');
    out.push(item(name, str(fields.description) ?? firstLine, source, plugin));
  }
  return out;
}

function item(name: string, description: string | undefined, source: CapabilitySource, plugin?: string): CapabilityItem {
  const out: CapabilityItem = { name, source };
  if (description) out.description = description;
  if (plugin) out.plugin = plugin;
  return out;
}

/** Adds items whose key is not taken yet; earlier calls win. */
function addUnique(target: Map<string, CapabilityItem>, items: CapabilityItem[]): void {
  for (const it of items) {
    const key = it.plugin ? `${it.plugin}:${it.name}` : it.name;
    if (!target.has(key)) target.set(key, it);
  }
}

/** A manifest path resolved inside the plugin folder, or undefined if it leaves it. */
function insidePlugin(root: string, p: string): string | undefined {
  const resolved = path.resolve(root, p);
  const rel = path.relative(root, resolved);
  return rel === '' || rel.startsWith('..') || path.isAbsolute(rel) ? undefined : resolved;
}

/** Paths given in a plugin manifest field (a string or strings), kept inside the plugin. */
function manifestPaths(root: string, value: unknown): string[] {
  const list = typeof value === 'string' ? [value] : strings(value);
  return list.map((p) => insidePlugin(root, p)).filter((p): p is string => p !== undefined);
}

interface PluginContents {
  skills: CapabilityItem[];
  agents: CapabilityItem[];
  commands: CapabilityItem[];
  mcp: McpServerInfo[];
}

async function readPlugin(r: Reader, root: string, fallbackName: string): Promise<{ name: string } & PluginContents> {
  const manifest = (await r.json(path.join(root, '.claude-plugin', 'plugin.json'))) ?? {};
  const name = str(manifest.name) ?? fallbackName;

  const skills: CapabilityItem[] = [];
  const rootSkill = await r.text(path.join(root, 'SKILL.md'));
  if (rootSkill !== undefined) {
    const fm = parseFrontmatter(rootSkill);
    skills.push(item(str(fm.name) ?? name, str(fm.description), 'plugin', name));
  }
  for (const dir of [path.join(root, 'skills'), ...manifestPaths(root, manifest.skills)]) {
    skills.push(...(await readSkills(r, dir, 'plugin', name)));
  }

  const agents: CapabilityItem[] = [];
  for (const dir of [path.join(root, 'agents'), ...manifestPaths(root, manifest.agents)]) {
    agents.push(...(await readAgents(r, dir, 'plugin', name)));
  }
  const commands: CapabilityItem[] = [];
  for (const dir of [path.join(root, 'commands'), ...manifestPaths(root, manifest.commands)]) {
    commands.push(...(await readCommands(r, dir, 'plugin', name)));
  }

  const servers: Json = { ...pluginServerMap(await r.json(path.join(root, '.mcp.json'))) };
  const declared = Array.isArray(manifest.mcpServers) ? manifest.mcpServers : [manifest.mcpServers];
  for (const entry of declared) {
    const file = typeof entry === 'string' && entry.endsWith('.json') ? insidePlugin(root, entry) : undefined;
    if (file) Object.assign(servers, pluginServerMap(await r.json(file)));
    else if (isObj(entry)) Object.assign(servers, pluginServerMap(entry));
  }
  const mcp: McpServerInfo[] = Object.entries(servers)
    .filter(([, cfg]) => isObj(cfg))
    .map(([serverName, cfg]) => ({ name: serverName, source: 'plugin', plugin: name, transport: transportOf(cfg as Json), state: 'enabled' }));

  return { name, skills, agents, commands, mcp };
}

/** The install folder for a plugin id, preferring an install made for this project. */
function installPathFor(installed: Json | undefined, id: string, projectDir: string): string | undefined {
  const plugins = isObj(installed?.plugins) ? installed.plugins : undefined;
  const record = plugins?.[id];
  const records = (Array.isArray(record) ? record : [record]).filter(isObj);
  const chosen =
    records.find((x) => x.projectPath === projectDir) ??
    records.find((x) => x.scope === 'user') ??
    records.find((x) => typeof x.installPath === 'string' && x.projectPath === undefined) ??
    undefined;
  return chosen && typeof chosen.installPath === 'string' ? chosen.installPath : undefined;
}

export async function readProjectCapabilities(projectDir: string, paths: CapabilityPaths): Promise<ProjectCapabilities> {
  const { home } = paths;
  const managedDir = paths.managedDir ?? DEFAULT_MANAGED_DIR;
  const r = new Reader(home);
  const dir = projectDir.length > 1 ? projectDir.replace(/[/\\]+$/, '') : projectDir;

  const [claudeJson, userSettings, projectSettings, localSettings, managedSettings, mcpJson, managedMcp, installed] =
    await Promise.all([
      r.json(path.join(home, '.claude.json')),
      r.json(path.join(home, '.claude', 'settings.json')),
      r.json(path.join(dir, '.claude', 'settings.json')),
      r.json(path.join(dir, '.claude', 'settings.local.json')),
      r.json(path.join(managedDir, 'managed-settings.json')),
      r.json(path.join(dir, '.mcp.json')),
      r.json(path.join(managedDir, 'managed-mcp.json')),
      r.json(path.join(home, '.claude', 'plugins', 'installed_plugins.json')),
    ]);

  const projects = isObj(claudeJson?.projects) ? claudeJson.projects : {};
  const realDir = await fs.realpath(dir).catch(() => dir);
  const ownEntry = projects[dir] ?? projects[dir + '/'] ?? projects[realDir];
  const entry: Json = isObj(ownEntry) ? ownEntry : {};

  // Settings levels, lowest precedence first.
  const levels: [CapabilitySource, Json | undefined][] = [
    ['user', userSettings],
    ['project', projectSettings],
    ['local', localSettings],
    ['managed', managedSettings],
  ];
  const approvalSources: Json[] = [...levels.map(([, s]) => s ?? {}), entry];
  const approved = new Set(approvalSources.flatMap((s) => strings(s.enabledMcpjsonServers)));
  const rejected = new Set(approvalSources.flatMap((s) => strings(s.disabledMcpjsonServers)));
  const approveAll = approvalSources.some((s) => s.enableAllProjectMcpServers === true);
  const turnedOff = new Set(strings(entry.disabledMcpServers));

  // Plugins: the highest settings level that mentions an id decides.
  const pluginChoice = new Map<string, { on: boolean; source: CapabilitySource }>();
  for (const [source, settings] of levels) {
    if (!isObj(settings?.enabledPlugins)) continue;
    for (const [id, on] of Object.entries(settings.enabledPlugins)) {
      if (typeof on === 'boolean') pluginChoice.set(id, { on, source });
    }
  }
  const plugins: PluginInfo[] = [];
  const pluginContents: PluginContents[] = [];
  for (const id of [...pluginChoice.keys()].sort()) {
    const choice = pluginChoice.get(id)!;
    if (!choice.on) continue;
    const idName = id.split('@')[0];
    const installPath = installPathFor(installed, id, dir);
    plugins.push({ id, name: idName, source: choice.source, installed: installPath !== undefined });
    if (installPath) pluginContents.push(await readPlugin(r, installPath, idName));
  }

  // MCP servers.
  const servers = new Map<string, McpServerInfo>();
  const addServers = (map: Json, source: CapabilitySource, state: (name: string) => McpServerInfo['state']) => {
    for (const [name, cfg] of Object.entries(map)) {
      if (isObj(cfg) && !servers.has(name)) servers.set(name, { name, source, transport: transportOf(cfg), state: state(name) });
    }
  };
  if (managedMcp) {
    addServers(serverMap(managedMcp), 'managed', () => 'enabled');
  } else {
    addServers(serverMap(entry), 'local', () => 'enabled');
    addServers(serverMap(mcpJson), 'project', (name) =>
      rejected.has(name) ? 'disabled' : approveAll || approved.has(name) ? 'enabled' : 'needs-approval'
    );
    addServers(isObj(claudeJson?.mcpServers) ? claudeJson.mcpServers : {}, 'user', () => 'enabled');
    for (const p of pluginContents) {
      for (const s of p.mcp) if (!servers.has(`${s.plugin}:${s.name}`)) servers.set(`${s.plugin}:${s.name}`, s);
    }
  }
  // Plugin servers are matched by their qualified name (unconfirmed format: plugin:<plugin>:<server>).
  const offKey = (s: McpServerInfo) => (s.plugin ? `plugin:${s.plugin}:${s.name}` : s.name);
  const mcpServers = [...servers.values()].map((s) => (turnedOff.has(offKey(s)) ? { ...s, state: 'disabled' as const } : s));

  // Skills: personal beats project. Agents: project beats personal. Plugins are namespaced.
  const skills = new Map<string, CapabilityItem>();
  addUnique(skills, await readSkills(r, path.join(home, '.claude', 'skills'), 'user'));
  addUnique(skills, await readSkills(r, path.join(dir, '.claude', 'skills'), 'project'));
  for (const p of pluginContents) addUnique(skills, p.skills);

  const agents = new Map<string, CapabilityItem>();
  addUnique(agents, await readAgents(r, path.join(dir, '.claude', 'agents'), 'project'));
  addUnique(agents, await readAgents(r, path.join(home, '.claude', 'agents'), 'user'));
  for (const p of pluginContents) addUnique(agents, p.agents);

  // Commands: a skill with the same name wins over a command.
  const commands = new Map<string, CapabilityItem>();
  addUnique(commands, await readCommands(r, path.join(dir, '.claude', 'commands'), 'project'));
  addUnique(commands, await readCommands(r, path.join(home, '.claude', 'commands'), 'user'));
  for (const p of pluginContents) addUnique(commands, p.commands);
  for (const key of skills.keys()) commands.delete(key);

  return {
    mcpServers,
    skills: [...skills.values()],
    agents: [...agents.values()],
    commands: [...commands.values()],
    plugins,
    problems: r.problems,
  };
}

/** Files and folders whose modification time decides whether a cached result is stale. */
function watchedPaths(projectDir: string, paths: CapabilityPaths): string[] {
  const { home } = paths;
  const managedDir = paths.managedDir ?? DEFAULT_MANAGED_DIR;
  const claudeDirs = (base: string) => ['skills', 'agents', 'commands'].map((d) => path.join(base, '.claude', d));
  return [
    path.join(projectDir, '.mcp.json'),
    path.join(projectDir, '.claude', 'settings.json'),
    path.join(projectDir, '.claude', 'settings.local.json'),
    ...claudeDirs(projectDir),
    path.join(home, '.claude.json'),
    path.join(home, '.claude', 'settings.json'),
    path.join(home, '.claude', 'plugins', 'installed_plugins.json'),
    ...claudeDirs(home),
    path.join(managedDir, 'managed-settings.json'),
    path.join(managedDir, 'managed-mcp.json'),
  ];
}

async function signature(projectDir: string, paths: CapabilityPaths): Promise<string> {
  const times = await Promise.all(
    watchedPaths(projectDir, paths).map((p) => fs.stat(p).then((s) => s.mtimeMs, () => -1))
  );
  return times.join(',');
}

/**
 * A per-project cache in front of readProjectCapabilities. A result is reused while the
 * modification times of the config files and the top-level skills, agents and commands
 * folders are unchanged, for at most maxAgeMs (30 s). Changes the mtimes don't show (an
 * edited SKILL.md, a file in a subfolder, a plugin update) appear within that time.
 */
export function createCapabilitiesReader(
  paths: CapabilityPaths,
  { maxAgeMs = 30_000, now = Date.now }: { maxAgeMs?: number; now?: () => number } = {}
) {
  const cache = new Map<string, { sig: string; at: number; result: ProjectCapabilities }>();
  const inFlight = new Map<string, Promise<ProjectCapabilities>>();

  async function load(projectDir: string): Promise<ProjectCapabilities> {
    const sig = await signature(projectDir, paths);
    const hit = cache.get(projectDir);
    if (hit && hit.sig === sig && now() - hit.at < maxAgeMs) return hit.result;
    const at = now();
    const result = await readProjectCapabilities(projectDir, paths);
    cache.set(projectDir, { sig, at, result });
    return result;
  }

  return {
    get(projectDir: string): Promise<ProjectCapabilities> {
      const pending = inFlight.get(projectDir);
      if (pending) return pending;
      const p = load(projectDir).finally(() => inFlight.delete(projectDir));
      inFlight.set(projectDir, p);
      return p;
    },
  };
}
