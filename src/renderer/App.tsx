import { useEffect, useState, useRef } from 'react';
import type { Project, ActiveSession } from '../shared/types';
import ProjectEditor from './ProjectEditor';

// Apply dev mode class if running in development
if (new URLSearchParams(window.location.search).has('dev')) {
  document.body.classList.add('dev');
}

type Mode = 'search' | 'create';

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
  }

  async function loadCreateLocation() {
    const location = await window.cockpit.getCreateLocation();
    if (location) {
      setNewProjectLocation(location);
    }
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

  async function handleProjectClick(project: Project, e: React.MouseEvent) {
    const forceNew = e.metaKey;
    await window.cockpit.openSession(project.path, forceNew);
    const updated = await window.cockpit.getActiveSessions();
    setSessions(updated);
  }

  function handleContextMenu(project: Project, e: React.MouseEvent) {
    e.preventDefault();
    setEditing(project);
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

  // Empty state actions when no projects match
  const emptyStateActions = [
    { id: 'choose-folder', label: 'Choose folder', icon: '📁' },
    { id: 'create-project', label: 'Create new project', icon: '✨' },
  ];

  // Total navigable items count
  const totalItems = filtered.length > 0 ? filtered.length : emptyStateActions.length;

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
    const items = filtered.length > 0
      ? container.children
      : container.querySelector('.empty-state')?.querySelectorAll('.empty-state-action');

    const item = items?.[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex, filtered.length]);

  function handleEmptyStateAction(actionId: string) {
    if (actionId === 'choose-folder') {
      handleAddProject();
    } else if (actionId === 'create-project') {
      setMode('create');
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % totalItems);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + totalItems) % totalItems);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (filtered.length > 0) {
        handleProjectClick(filtered[selectedIndex], e as unknown as React.MouseEvent);
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
              filtered.map((project, index) => {
                const name = project.name || project.path.split('/').pop();
                const isActive = !!sessions[project.path];
                const isSelected = index === selectedIndex;
                return (
                  <div
                    key={project.path}
                    className={`project-item ${isSelected ? 'selected' : ''}`}
                    onClick={(e) => handleProjectClick(project, e)}
                    onContextMenu={(e) => handleContextMenu(project, e)}
                  >
                    <div className="project-header">
                      {isActive && <span className="active-indicator">●</span>}
                      <span className="project-name">{name}</span>
                      {(project.hasGit || project.hasBeads) && (
                        <span className="project-indicators">
                          {project.hasGithub ? (
                            <span className="github-indicator" title="GitHub repository">🐙</span>
                          ) : project.hasGit ? (
                            <span className="git-indicator" title="Git repository">⎇</span>
                          ) : null}
                          {project.hasBeads && <span className="beads-indicator" title="Has beads">◆</span>}
                        </span>
                      )}
                    </div>
                    {project.description && (
                      <div className="project-description">{project.description}</div>
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
