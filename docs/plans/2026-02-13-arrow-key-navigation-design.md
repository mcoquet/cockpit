# Arrow Key Navigation for Session History

**Ticket:** cockpit-507
**Date:** 2026-02-13

## Problem

Keyboard navigation only cycles through projects. When a project's history is expanded, users cannot navigate to sessions with arrow keys.

## Design Decisions

- **Down enters sessions:** Down from project goes directly to first session (no Right required)
- **Right/Left expand/collapse:** Right expands history, Left collapses it
- **Past sessions:** Down from last session goes to next project

## Solution: Flat Navigation List

Build a flat array of all navigable items (projects + visible sessions). `selectedIndex` indexes into this flat list.

### Data Structure

```typescript
type NavItem =
  | { type: 'project'; project: Project; index: number }
  | { type: 'session'; project: Project; session: SessionInfo };

const navItems: NavItem[] = filtered.flatMap((project, index) => {
  const items: NavItem[] = [{ type: 'project', project, index }];
  if (expandedProjects.has(project.path)) {
    const sessions = projectSessions[project.path] || [];
    items.push(...sessions.map(s => ({ type: 'session', project, session: s })));
  }
  return items;
});
```

### Keyboard Behavior

| Key | Action |
|-----|--------|
| Up/Down | Move through `navItems` |
| Right | Expand history for current project (if has history) |
| Left | Collapse history (moves selection to project if on session) |
| Enter | Open new session (project) or continue session (session) |

### Visual Selection

- Project items: existing `.selected` class
- Session items: new `.selected` class on `.session-item`
