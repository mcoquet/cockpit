import { useState } from 'react';
import type { ProjectCapabilities as Capabilities } from '../shared/types';
import { summarizeCapabilities } from '../shared/capabilities-display';

export type CapabilitiesState = Capabilities | 'loading' | 'error';

interface Props {
  state: CapabilitiesState | undefined;
}

/**
 * The capabilities lines in an expanded project (#14, #12): MCP servers, skills, agents
 * and commands from the project itself by name, everything user-level or from plugins
 * folded into "+N global" (tooltip, or click to list them).
 */
export default function ProjectCapabilities({ state }: Props) {
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  if (state === undefined || state === 'loading') {
    return <div className="capabilities caps-note">Reading Claude Code config…</div>;
  }
  if (state === 'error') {
    return <div className="capabilities caps-note">Couldn't read Claude Code config</div>;
  }

  const { groups, problems } = summarizeCapabilities(state);
  const toggle = (label: string) =>
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label);
      else next.add(label);
      return next;
    });

  return (
    <div className="capabilities" onClick={(e) => e.stopPropagation()}>
      {groups.length === 0 && <div className="caps-note">No MCP servers, skills, agents or commands</div>}
      {groups.map((g) => (
        <div key={g.label} className="caps-group">
          <div className="caps-row">
            <span className="caps-label">{g.label}</span>
            <span className="caps-items">
              {g.own.map((item, i) => (
                <span key={item.text}>
                  <span className={item.muted ? 'caps-item caps-muted' : 'caps-item'} title={item.title}>
                    {item.text}
                  </span>
                  {i < g.own.length - 1 && ', '}
                </span>
              ))}
              {g.global.length > 0 && (
                <button
                  type="button"
                  className="caps-global"
                  title={g.global.join('\n')}
                  aria-expanded={openGroups.has(g.label)}
                  onClick={() => toggle(g.label)}
                >
                  +{g.global.length} global
                </button>
              )}
            </span>
          </div>
          {openGroups.has(g.label) && <div className="caps-global-list">{g.global.join(', ')}</div>}
        </div>
      ))}
      {problems.length > 0 && (
        <div className="caps-note caps-problem" title={problems.join('\n')}>
          ⚠ {problems.length === 1 ? '1 config file' : `${problems.length} config files`} could not be read
        </div>
      )}
    </div>
  );
}
