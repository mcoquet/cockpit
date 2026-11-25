import type { CapabilityItem, McpServerInfo, ProjectCapabilities } from './types';

/**
 * Turns a project's capabilities into what the popup's expanded project shows (#14, #12):
 * one line per kind (MCP, Skills, Agents, Commands). Items from the project itself
 * (project and local scope) are named; user-level, plugin and managed items, the same on
 * every project, fold into a "+N global" count whose names go in a tooltip.
 */

export interface DisplayItem {
  text: string;
  /** Tooltip, e.g. the item's description. */
  title?: string;
  /** Shown dimmed: an MCP server that is off or waiting for approval. */
  muted: boolean;
}

export interface DisplayGroup {
  label: 'MCP' | 'Skills' | 'Agents' | 'Commands';
  own: DisplayItem[];
  /** Names of the folded items, sorted. */
  global: string[];
}

export interface CapabilitiesSummary {
  groups: DisplayGroup[];
  problems: string[];
}

const isOwn = (source: string) => source === 'project' || source === 'local';
const qualified = (i: { name: string; plugin?: string }) => (i.plugin ? `${i.plugin}:${i.name}` : i.name);
const STATE_ORDER: Record<McpServerInfo['state'], number> = { enabled: 0, 'needs-approval': 1, disabled: 2 };
const STATE_NOTE: Record<McpServerInfo['state'], string> = { enabled: '', 'needs-approval': ' (needs approval)', disabled: ' (disabled)' };

function mcpGroup(servers: McpServerInfo[]): DisplayGroup {
  const own = servers
    .filter((s) => isOwn(s.source))
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state])
    .map((s) => ({ text: s.name + STATE_NOTE[s.state], title: `${s.transport}, ${s.source} scope`, muted: s.state !== 'enabled' }));
  const global = servers
    .filter((s) => !isOwn(s.source))
    .map((s) => qualified(s) + STATE_NOTE[s.state])
    .sort();
  return { label: 'MCP', own, global };
}

function itemGroup(label: DisplayGroup['label'], items: CapabilityItem[], prefix = ''): DisplayGroup {
  const own = items
    .filter((i) => isOwn(i.source))
    .map((i) => {
      const item: DisplayItem = { text: prefix + i.name, muted: false };
      if (i.description) item.title = i.description;
      return item;
    });
  const global = items.filter((i) => !isOwn(i.source)).map(qualified).sort();
  return { label, own, global };
}

export function summarizeCapabilities(caps: ProjectCapabilities): CapabilitiesSummary {
  const groups = [
    mcpGroup(caps.mcpServers),
    itemGroup('Skills', caps.skills),
    itemGroup('Agents', caps.agents),
    itemGroup('Commands', caps.commands, '/'),
  ].filter((g) => g.own.length > 0 || g.global.length > 0);
  return { groups, problems: caps.problems };
}
