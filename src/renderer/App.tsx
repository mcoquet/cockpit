import { useEffect, useState, useRef, useMemo } from 'react';
import type { Project, ActiveSession, SessionInfo } from '../shared/types';
import ProjectEditor from './ProjectEditor';

// Apply dev mode class if running in development
if (new URLSearchParams(window.location.search).has('dev')) {
  document.body.classList.add('dev');
}

type Mode = 'search' | 'create';

type NavItem =
  | { type: 'project'; project: Project }
  | { type: 'session'; project: Project; session: SessionInfo };

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Record<string, ActiveSession>>({});
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Project | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<Mode>('search');
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectLocation, setNewProjectLocation] = useState('~/Projects');
  const searchRef = useRef<HTMLTextAreaElement>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [projectSessions, setProjectSessions] = useState<Record<string, SessionInfo[]>>({});
  const [sessionCounts, setSessionCounts] = useState<Record<string, number>>({});
  const [hasHistory, setHasHistory] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadData();
    loadCreateLocation();
    window.cockpit.onSessionsChanged(setSessions);

    // Auto-focus appropriate input on mount and when window gains focus
    const focusCurrentInput = () => {
      if (mode === 'search') {
        searchRef.current?.focus();
      } else {
        createInputRef.current?.focus();
      }
    };
    focusCurrentInput();
    window.addEventListener('focus', focusCurrentInput);
    window.cockpit.onFocusSearch(focusCurrentInput);

    return () => {
      window.removeEventListener('focus', focusCurrentInput);
    };
  }, [mode]);

  useEffect(() => {
    // Global keyboard handlers
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        const activeInput = mode === 'search' ? searchRef.current : createInputRef.current;
        if (document.activeElement === activeInput) {
          activeInput?.blur();
        } else {
          window.cockpit.closePopup();
        }
      } else if (e.key === 'Tab' && e.shiftKey) {
        e.preventDefault();
        setMode((m) => (m === 'search' ? 'create' : 'search'));
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [mode]);

  async function loadData() {
    const [projectList, activeSessions] = await Promise.all([
      window.cockpit.getProjects(),
      window.cockpit.getActiveSessions(),
    ]);
    setProjects(projectList);
    setSessions(activeSessions);
    checkSessionHistory(projectList);
  }

  async function loadCreateLocation() {
    const location = await window.cockpit.getCreateLocation();
    if (location) {
      setNewProjectLocation(location);
    }
  }

  async function checkSessionHistory(projectList: Project[]) {
    const historyMap: Record<string, boolean> = {};
    await Promise.all(
      projectList.map(async (p) => {
        historyMap[p.path] = await window.cockpit.hasSessionHistory(p.path);
      })
    );
    setHasHistory(historyMap);
  }

  async function handleAddProject() {
    const folderPath = await window.cockpit.selectFolder();
    if (folderPath) {
      const project = await window.cockpit.addProject(folderPath);
      await window.cockpit.openSession(project.path);
      loadData();
    }
  }

  async function handleSelectLocation() {
    const folderPath = await window.cockpit.selectFolder();
    if (folderPath) {
      setNewProjectLocation(folderPath);
      await window.cockpit.setCreateLocation(folderPath);
    }
  }

  async function handleCreateProject() {
    if (!newProjectName.trim()) return;

    const result = await window.cockpit.createProject(newProjectName.trim(), newProjectLocation);
    if (result) {
      setNewProjectName('');
      setMode('search');
      loadData();
    }
  }

  async function handleProjectClick(project: Project, _e: React.MouseEvent) {
    await window.cockpit.openSession(project.path, true);  // Always new session
    const updated = await window.cockpit.getActiveSessions();
    setSessions(updated);
  }

  function handleContextMenu(project: Project, e: React.MouseEvent) {
    e.preventDefault();
    setEditing(project);
  }

  async function handleToggleExpand(project: Project, e: React.MouseEvent) {
    e.stopPropagation();
    const path = project.path;
    const newExpanded = new Set(expandedProjects);

    if (newExpanded.has(path)) {
      newExpanded.delete(path);
    } else {
      newExpanded.add(path);
      // Load sessions if not already loaded
      if (!projectSessions[path]) {
        const sessions = await window.cockpit.getProjectSessions(path, 5);
        setProjectSessions((prev) => ({ ...prev, [path]: sessions }));
        // Get total count for "Show more"
        const allSessions = await window.cockpit.getProjectSessions(path);
        setSessionCounts((prev) => ({ ...prev, [path]: allSessions.length }));
      }
    }
    setExpandedProjects(newExpanded);
  }

  async function handleLoadMoreSessions(project: Project) {
    const path = project.path;
    const currentCount = projectSessions[path]?.length || 0;
    const moreSessions = await window.cockpit.getProjectSessions(path, 5, currentCount);
    setProjectSessions((prev) => ({
      ...prev,
      [path]: [...(prev[path] || []), ...moreSessions],
    }));
  }

  async function handleSessionClick(project: Project, sessionId: string) {
    await window.cockpit.openSessionById(project.path, sessionId);
    const updated = await window.cockpit.getActiveSessions();
    setSessions(updated);
  }

  async function handleDeleteSession(project: Project, sessionId: string, e: React.MouseEvent) {
    e.stopPropagation();
    const deleted = await window.cockpit.deleteSession(project.path, sessionId);
    if (deleted) {
      // Refresh sessions for this project
      const sessions = await window.cockpit.getProjectSessions(project.path, projectSessions[project.path]?.length || 5);
      setProjectSessions((prev) => ({ ...prev, [project.path]: sessions }));
      // Update count
      const allSessions = await window.cockpit.getProjectSessions(project.path);
      setSessionCounts((prev) => ({ ...prev, [project.path]: allSessions.length }));
      // If no more sessions, collapse and update hasHistory
      if (sessions.length === 0) {
        setExpandedProjects((prev) => {
          const newSet = new Set(prev);
          newSet.delete(project.path);
          return newSet;
        });
        setHasHistory((prev) => ({ ...prev, [project.path]: false }));
      }
    }
  }

  function formatRelativeDate(timestamp: number): string {
    const now = Date.now();
    const diff = now - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return 'Just now';
    if (minutes < 60) return `${minutes}m ago`;
    if (hours < 24) return `${hours}h ago`;
    if (days === 1) return 'Yesterday';
    if (days < 7) return `${days}d ago`;

    return new Date(timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  async function handleSaveProject(updates: Partial<Project>) {
    if (editing) {
      await window.cockpit.updateProject(editing.path, updates);
      loadData();
    }
  }

  async function handleRemoveProject() {
    if (editing) {
      await window.cockpit.removeProject(editing.path);
      loadData();
    }
  }

  const filtered = projects.filter((p) => {
    const name = p.name || p.path.split('/').pop() || '';
    const desc = p.description || '';
    const q = search.toLowerCase();
    return name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
  });

  // Build flat navigation list of projects + expanded sessions
  const navItems: NavItem[] = useMemo(() => {
    return filtered.flatMap((project) => {
      const items: NavItem[] = [{ type: 'project', project }];
      if (expandedProjects.has(project.path)) {
        const sessions = projectSessions[project.path] || [];
        items.push(...sessions.map((session) => ({ type: 'session' as const, project, session })));
      }
      return items;
    });
  }, [filtered, expandedProjects, projectSessions]);

  // Empty state actions when no projects match
  const emptyStateActions = [
    { id: 'choose-folder', label: 'Choose folder', icon: '📁' },
    { id: 'create-project', label: 'Create new project', icon: '✨' },
  ];

  // Total navigable items count
  const totalItems = navItems.length > 0 ? navItems.length : emptyStateActions.length;

  // Constrain selectedIndex when totalItems changes
  useEffect(() => {
    if (selectedIndex >= totalItems && totalItems > 0) {
      setSelectedIndex(0);
    }
  }, [totalItems, selectedIndex]);

  // Scroll selected item into view
  useEffect(() => {
    const container = listRef.current;
    if (!container) return;

    // Handle both project list and empty state actions
    let item: HTMLElement | null = null;
    if (navItems.length > 0) {
      // Find the selected item (project or session)
      item = container.querySelector('.project-item.selected, .session-item.selected') as HTMLElement | null;
    } else {
      const actions = container.querySelector('.empty-state')?.querySelectorAll('.empty-state-action');
      item = actions?.[selectedIndex] as HTMLElement | null;
    }

    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, navItems.length]);

  function handleEmptyStateAction(actionId: string) {
    if (actionId === 'choose-folder') {
      handleAddProject();
    } else if (actionId === 'create-project') {
      setMode('create');
    }
  }

  async function handleExpandProject(project: Project) {
    const path = project.path;
    if (!hasHistory[path]) return;

    const newExpanded = new Set(expandedProjects);
    newExpanded.add(path);

    // Load sessions if not already loaded
    if (!projectSessions[path]) {
      const sessions = await window.cockpit.getProjectSessions(path, 5);
      setProjectSessions((prev) => ({ ...prev, [path]: sessions }));
      const allSessions = await window.cockpit.getProjectSessions(path);
      setSessionCounts((prev) => ({ ...prev, [path]: allSessions.length }));
    }
    setExpandedProjects(newExpanded);
  }

  function handleCollapseProject(project: Project) {
    const newExpanded = new Set(expandedProjects);
    newExpanded.delete(project.path);
    setExpandedProjects(newExpanded);

    // Move selection to the project
    const projectIndex = navItems.findIndex(
      (item) => item.type === 'project' && item.project.path === project.path
    );
    if (projectIndex >= 0) {
      setSelectedIndex(projectIndex);
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % totalItems);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      const currentItem = navItems[selectedIndex];
      if (currentItem?.type === 'project' && hasHistory[currentItem.project.path]) {
        handleExpandProject(currentItem.project);
      }
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      const currentItem = navItems[selectedIndex];
      if (currentItem) {
        handleCollapseProject(currentItem.project);
      }
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (navItems.length > 0) {
        const currentItem = navItems[selectedIndex];
        if (currentItem?.type === 'project') {
          handleProjectClick(currentItem.project, e as unknown as React.MouseEvent);
        } else if (currentItem?.type === 'session') {
          handleSessionClick(currentItem.project, currentItem.session.sessionId);
        }
      } else if (emptyStateActions[selectedIndex]) {
        handleEmptyStateAction(emptyStateActions[selectedIndex].id);
      }
    }
  }

  return (
    <div className={`app ${mode === 'create' ? 'create-mode' : ''}`}>
      <div className="mode-tabs">
        <button
          className={`mode-tab ${mode === 'search' ? 'active' : ''}`}
          onClick={() => setMode('search')}
        >
          Search
        </button>
        <button
          className={`mode-tab ${mode === 'create' ? 'active' : ''}`}
          onClick={() => setMode('create')}
        >
          Create
        </button>
        <span className="mode-hint">⇧Tab</span>
      </div>

      {mode === 'search' ? (
        <>
          <div className="search-container">
            <textarea
              ref={searchRef}
              placeholder="Search projects..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setSelectedIndex(0);
              }}
              onKeyDown={handleSearchKeyDown}
              className="search-input"
              rows={1}
            />
          </div>
          <div className="project-list" ref={listRef}>
            {filtered.length > 0 ? (
              filtered.map((project) => {
                const name = project.name || project.path.split('/').pop();
                const isActive = !!sessions[project.path];
                const selectedItem = navItems[selectedIndex];
                const isProjectSelected = selectedItem?.type === 'project' && selectedItem.project.path === project.path;
                const isExpanded = expandedProjects.has(project.path);
                const projectHasHistory = hasHistory[project.path];
                const sessionList = projectSessions[project.path] || [];
                const totalSessions = sessionCounts[project.path] || 0;
                const hasMore = sessionList.length < totalSessions;

                return (
                  <div key={project.path} className="project-wrapper">
                    <div
                      className={`project-item ${isProjectSelected ? 'selected' : ''}`}
                      onClick={(e) => handleProjectClick(project, e)}
                      onContextMenu={(e) => handleContextMenu(project, e)}
                    >
                      <div className="project-header">
                        {projectHasHistory && (
                          <span
                            className={`expand-triangle ${isExpanded ? 'expanded' : ''}`}
                            onClick={(e) => handleToggleExpand(project, e)}
                          >
                            ▶
                          </span>
                        )}
                        {isActive && <span className="active-indicator">●</span>}
                        <span className="project-name">{name}</span>
                        {project.hasGit && (
                          <span className="project-indicators">
                            {project.hasGithub ? (
                              <span className="github-indicator" title="GitHub repository">🐙</span>
                            ) : (
                              <span className="git-indicator" title="Git repository">⎇</span>
                            )}
                          </span>
                        )}
                      </div>
                      {project.description && (
                        <div className="project-description">{project.description}</div>
                      )}
                    </div>
                    {isExpanded && (
                      <div className="session-list">
                        {sessionList.map((session) => {
                          const isSessionSelected = selectedItem?.type === 'session' &&
                            selectedItem.project.path === project.path &&
                            selectedItem.session.sessionId === session.sessionId;
                          return (
                            <div
                              key={session.sessionId}
                              className={`session-item ${isSessionSelected ? 'selected' : ''}`}
                              onClick={() => handleSessionClick(project, session.sessionId)}
                              onContextMenu={(e) => handleDeleteSession(project, session.sessionId, e)}
                            >
                              <span className="session-date">{formatRelativeDate(session.lastModified)}</span>
                              <span className="session-message">
                                {session.lastUserMessage || 'No message'}
                              </span>
                            </div>
                          );
                        })}
                        {hasMore && (
                          <button
                            className="show-more-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleLoadMoreSessions(project);
                            }}
                          >
                            Show more
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            ) : (
              <div className="empty-state">
                {search && (
                  <div className="empty-state-message">
                    No projects match "{search}"
                  </div>
                )}
                {emptyStateActions.map((action, index) => (
                  <div
                    key={action.id}
                    className={`empty-state-action ${index === selectedIndex ? 'selected' : ''}`}
                    onClick={() => handleEmptyStateAction(action.id)}
                  >
                    <span className="empty-state-icon">{action.icon}</span>
                    <span className="empty-state-label">{action.label}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="footer">
            <button onClick={handleAddProject}>+ Add Existing</button>
          </div>
        </>
      ) : (
        <div className="create-container">
          <div className="create-field">
            <label>Project name</label>
            <input
              ref={createInputRef}
              type="text"
              placeholder="my-new-project"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleCreateProject();
                }
              }}
            />
          </div>
          <div className="create-field">
            <label>Location</label>
            <div className="location-picker">
              <span className="location-path">{newProjectLocation}</span>
              <button onClick={handleSelectLocation}>Change</button>
            </div>
          </div>
          <div className="create-preview">
            {newProjectName && (
              <span>{newProjectLocation}/{newProjectName}</span>
            )}
          </div>
          <div className="create-actions">
            <button
              className="create-btn"
              onClick={handleCreateProject}
              disabled={!newProjectName.trim()}
            >
              Create & Open
            </button>
          </div>
        </div>
      )}

      {editing && (
        <ProjectEditor
          project={editing}
          onSave={handleSaveProject}
          onRemove={handleRemoveProject}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
