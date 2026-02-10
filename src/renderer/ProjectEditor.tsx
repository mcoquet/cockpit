import { useState } from 'react';
import type { Project } from '../shared/types';

interface Props {
  project: Project;
  onSave: (updates: Partial<Project>) => void;
  onRemove: () => Promise<void>;
  onClose: () => void;
}

export default function ProjectEditor({ project, onSave, onRemove, onClose }: Props) {
  const defaultName = project.path.split('/').pop() || '';
  const [name, setName] = useState(project.name || defaultName);
  const [description, setDescription] = useState(project.description || '');

  function handleSave() {
    onSave({ name: name || defaultName, description });
    onClose();
  }

  async function handleRemove() {
    // Main process shows dialog with folder deletion option
    await onRemove();
    onClose();
  }

  return (
    <div className="editor-overlay" onClick={onClose}>
      <div className="editor-panel" onClick={(e) => e.stopPropagation()}>
        <div className="editor-header">Edit Project</div>
        <div className="editor-field">
          <label>Name</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={defaultName}
          />
        </div>
        <div className="editor-field">
          <label>Description</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What is this project for?"
          />
        </div>
        <div className="editor-path">{project.path}</div>
        <div className="editor-actions">
          <button className="remove-btn" onClick={handleRemove}>Remove</button>
          <button className="save-btn" onClick={handleSave}>Save</button>
        </div>
      </div>
    </div>
  );
}
