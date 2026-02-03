import { useEffect, useState } from 'react';
import type { Project, ActiveSession } from '../shared/types';

export default function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [sessions, setSessions] = useState<Record<string, ActiveSession>>({});
  const [search, setSearch] = useState('');

  useEffect(() => {
    loadData();
    window.cockpit.onSessionsChanged(setSessions);
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
    const path = await window.cockpit.selectFolder();
    if (path) {
      await window.cockpit.addProject(path);
      loadData();
    }
  }

  async function handleProjectClick(project: Project, e: React.MouseEvent) {
    const forceNew = e.metaKey;
    await window.cockpit.openSession(project.path, forceNew);
    const updated = await window.cockpit.getActiveSessions();
    setSessions(updated);
  }

  const filtered = projects.filter((p) => {
    const name = p.name || p.path.split('/').pop() || '';
    const desc = p.description || '';
    const q = search.toLowerCase();
    return name.toLowerCase().includes(q) || desc.toLowerCase().includes(q);
  });

  return (
    <div className="app">
      <div className="search-container">
        <input
          type="text"
          placeholder="Search..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="search-input"
        />
      </div>
      <div className="project-list">
        {filtered.map((project) => {
          const name = project.name || project.path.split('/').pop();
          const isActive = !!sessions[project.path];
          return (
            <div
              key={project.path}
              className="project-item"
              onClick={(e) => handleProjectClick(project, e)}
            >
              <div className="project-header">
                {isActive && <span className="active-indicator">●</span>}
                <span className="project-name">{name}</span>
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
    </div>
  );
}
