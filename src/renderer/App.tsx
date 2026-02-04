import { useEffect, useState, useRef } from 'react';
import type { Project, ActiveSession } from '../shared/types';
import ProjectEditor from './ProjectEditor';

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Record<string, ActiveSession>>({});
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Project | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const searchRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadData();
    window.cockpit.onSessionsChanged(setSessions);

    // Auto-focus search input on mount and when window gains focus
    searchRef.current?.focus();
    const handleFocus = () => searchRef.current?.focus();
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, []);

  async function loadData() {
    const [projectList, activeSessions] = await Promise.all([
      window.cockpit.getProjects(),
      window.cockpit.getActiveSessions(),
    ]);
    setProjects(projectList);
    setSessions(activeSessions);
  }

  async function handleAddProject() {
    const folderPath = await window.cockpit.selectFolder();
    if (folderPath) {
      const project = await window.cockpit.addProject(folderPath);
      await window.cockpit.openSession(project.path);
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

  // Scroll selected item into view
  useEffect(() => {
    const item = listRef.current?.children[selectedIndex] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selectedIndex]);

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % filtered.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + filtered.length) % filtered.length);
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (filtered.length > 0) {
        handleProjectClick(filtered[selectedIndex], e as unknown as React.MouseEvent);
      }
    }
  }

  return (
    <div className="app">
      <div className="search-container">
        <textarea
          ref={searchRef}
          placeholder="Search..."
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
        {filtered.map((project, index) => {
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
                {project.hasBeads && <span className="beads-indicator" title="Has beads">◆</span>}
              </div>
              {project.description && (
                <div className="project-description">{project.description}</div>
              )}
            </div>
          );
        })}
      </div>
      <div className="footer">
        <button onClick={handleAddProject}>+ Add Project</button>
      </div>
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
