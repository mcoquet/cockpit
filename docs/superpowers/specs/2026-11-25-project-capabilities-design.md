# Project capabilities in the popup (#14, #12)

Date: 2026-11-25. Tickets: #14 (MCP servers per project), #12 (skills, agents and slash
commands per project). Worker 6 of a coordinated round.

## Problem

When choosing a project in the popup, the user can't see what Claude Code will have
available there: which MCP servers are on, which skills, subagents and slash commands it
will offer. They have to open the files or start a terminal session and ask.

## Scope

Read only. Cockpit shows what Claude Code's config files say; it never edits them
(editing is out of scope for these tickets). No popup light theme (#26).

## What is read

`src/main/project-capabilities.ts`, Electron-free, behind one read-only IPC handler
(`get-project-capabilities`). Locations were checked against code.claude.com/docs on
2026-11-25 and against real files (the v2 `installed_plugins.json`):

| Capability | Sources |
|---|---|
| MCP servers | `<project>/.mcp.json`; `~/.claude.json` top-level `mcpServers` (user) and `projects["<abs path>"].mcpServers` (local); enabled plugins' `.mcp.json` and `plugin.json` `mcpServers`; `/Library/Application Support/ClaudeCode/managed-mcp.json`, which when present is the only source |
| MCP state | Project servers need approval until `enabledMcpjsonServers` or `enableAllProjectMcpServers` approves them; `disabledMcpjsonServers` disables them (user, project, local and managed settings, plus the `~/.claude.json` project entry). The project entry's `disabledMcpServers` turns any server off |
| Skills | `.claude/skills/<name>/SKILL.md` in the project and `~/.claude`; plugin `skills/` and a plugin-root `SKILL.md`. Personal wins a name clash |
| Agents | `.claude/agents/**.md` (name and description required) in the project and `~/.claude`; plugin `agents/`. Project wins a name clash |
| Commands | `.claude/commands/**.md`, a subfolder becoming an `ns:` prefix; plugin `commands/`. A skill with the same name hides a command |
| Plugins | `enabledPlugins` in user, project, local and managed settings (the highest level that names an id decides), located through `~/.claude/plugins/installed_plugins.json` (v1 and v2), preferring an install made for this project |

Not read in v1 (approved): walking up to the repository root, nested `.claude/skills`
in subfolders, managed skills and agents, `CLAUDE_CONFIG_DIR`.

Missing files are normal. Files that exist but don't parse are listed in `problems`;
nothing throws. Results are cached per project and re-read when a watched file's or
folder's modification time changes, so reading never holds up the popup.

## How it shows

Pending Miguel's choice (the roadmap's Decide tab), defaulting to B at 21:00 UTC:

- **A. Badges on the project row**, counting only what is specific to the project, with a
  tooltip listing names. Every project is read after the popup renders.
- **B. A section in the expanded project** (recommended), loaded on first expand: MCP
  servers with their state, skills, agents and commands, with user-level and plugin items
  folded into "+N global". Every project becomes expandable.

## Documentation impact

- `GLOSSARY.md`: add **Capabilities** (of a project).
- `docs/domain-model.md`: a project's capabilities are derived from Claude Code's files,
  never stored by Cockpit.
- `docs/architecture/c4-context.md`, `c4-containers.md`: Cockpit also reads Claude Code's
  configuration (`~/.claude.json`, settings files, plugins, and each project's `.mcp.json`
  and `.claude/`).
- `ARCHITECTURE.md`: `project-capabilities.ts` in the code map; the "only the main process
  writes" invariant already covers it (read only).
- ADR: none. Reading Claude Code's files directly, rather than asking the CLI, is how
  Cockpit already reads conversations; it is not a new hard-to-reverse choice.
