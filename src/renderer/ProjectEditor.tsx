import { useState, useEffect } from 'react';
import type { Project, Schedule } from '../shared/types';

interface Props {
  project: Project;
  onSave: (updates: Partial<Project>) => void;
  onRemove: () => Promise<void>;
  onClose: () => void;
}

type Tab = 'details' | 'schedules';

export default function ProjectEditor({ project, onSave, onRemove, onClose }: Props) {
  const defaultName = project.path.split('/').pop() || '';
  const [name, setName] = useState(project.name || defaultName);
  const [description, setDescription] = useState(project.description || '');
  const [tab, setTab] = useState<Tab>('details');
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [isAddingSchedule, setIsAddingSchedule] = useState(false);

  // New schedule form state
  const [schedName, setSchedName] = useState('');
  const [schedCron, setSchedCron] = useState('');
  const [schedMode, setSchedMode] = useState<'interactive' | 'headless'>('interactive');
  const [schedPrompt, setSchedPrompt] = useState('');
  const [schedQueueBehavior, setSchedQueueBehavior] = useState<'skip' | 'queue' | 'parallel'>('skip');
  const [schedCatchUp, setSchedCatchUp] = useState(false);
  const [schedEnabled, setSchedEnabled] = useState(true);

  useEffect(() => {
    loadSchedules();
  }, [project.path]);

  async function loadSchedules() {
    const list = await window.cockpit.listSchedules(project.path);
    setSchedules(list);
  }

  function resetScheduleForm() {
    setSchedName('');
    setSchedCron('');
    setSchedMode('interactive');
    setSchedPrompt('');
    setSchedQueueBehavior('skip');
    setSchedCatchUp(false);
    setSchedEnabled(true);
    setEditingSchedule(null);
    setIsAddingSchedule(false);
  }

  async function handleSaveSchedule() {
    if (!schedName.trim() || !schedCron.trim() || !schedPrompt.trim()) return;

    if (editingSchedule) {
      await window.cockpit.updateSchedule(editingSchedule.id, {
        name: schedName,
        cron: schedCron,
        mode: schedMode,
        prompt: schedPrompt,
        queueBehavior: schedQueueBehavior,
        catchUp: schedCatchUp,
        enabled: schedEnabled,
      });
    } else {
      await window.cockpit.createSchedule({
        projectPath: project.path,
        name: schedName,
        cron: schedCron,
        mode: schedMode,
        prompt: schedPrompt,
        queueBehavior: schedQueueBehavior,
        catchUp: schedCatchUp,
        enabled: schedEnabled,
      });
    }

    resetScheduleForm();
    loadSchedules();
  }

  function handleEditSchedule(schedule: Schedule) {
    setEditingSchedule(schedule);
    setSchedName(schedule.name);
    setSchedCron(schedule.cron);
    setSchedMode(schedule.mode);
    setSchedPrompt(schedule.prompt);
    setSchedQueueBehavior(schedule.queueBehavior);
    setSchedCatchUp(schedule.catchUp);
    setSchedEnabled(schedule.enabled);
    setIsAddingSchedule(true);
  }

  async function handleDeleteSchedule(id: string) {
    await window.cockpit.deleteSchedule(id);
    loadSchedules();
  }

  async function handleToggleEnabled(schedule: Schedule) {
    if (schedule.enabled) {
      await window.cockpit.pauseSchedule(schedule.id);
    } else {
      await window.cockpit.resumeSchedule(schedule.id);
    }
    loadSchedules();
  }

  async function handleTriggerSchedule(id: string) {
    await window.cockpit.triggerSchedule(id);
  }

  function handleSave() {
    onSave({ name: name || defaultName, description });
    onClose();
  }

  async function handleRemove() {
    await onRemove();
    onClose();
  }

  return (
    <div className="editor-overlay" onClick={onClose}>
      <div className="editor-panel editor-panel-large" onClick={(e) => e.stopPropagation()}>
        <div className="editor-tabs">
          <button className={`editor-tab ${tab === 'details' ? 'active' : ''}`} onClick={() => setTab('details')}>
            Details
          </button>
          <button className={`editor-tab ${tab === 'schedules' ? 'active' : ''}`} onClick={() => setTab('schedules')}>
            Schedules
          </button>
        </div>

        {tab === 'details' ? (
          <>
            <div className="editor-field">
              <label>Name</label>
              <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={defaultName} />
            </div>
            <div className="editor-field">
              <label>Description</label>
              <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="What is this project for?" />
            </div>
            <div className="editor-path">{project.path}</div>
            <div className="editor-actions">
              <button className="remove-btn" onClick={handleRemove}>Remove</button>
              <button className="save-btn" onClick={handleSave}>Save</button>
            </div>
          </>
        ) : (
          <div className="schedules-tab">
            {isAddingSchedule ? (
              <div className="schedule-form">
                <div className="editor-field">
                  <label>Name</label>
                  <input type="text" value={schedName} onChange={(e) => setSchedName(e.target.value)} placeholder="Daily check" />
                </div>
                <div className="editor-field">
                  <label>Cron</label>
                  <input type="text" value={schedCron} onChange={(e) => setSchedCron(e.target.value)} placeholder="0 9 * * 1-5" />
                </div>
                <div className="editor-field">
                  <label>Mode</label>
                  <select value={schedMode} onChange={(e) => setSchedMode(e.target.value as 'interactive' | 'headless')}>
                    <option value="interactive">Interactive</option>
                    <option value="headless">Headless</option>
                  </select>
                </div>
                <div className="editor-field">
                  <label>Prompt</label>
                  <textarea value={schedPrompt} onChange={(e) => setSchedPrompt(e.target.value)} placeholder="Run tests and report any failures" rows={3} />
                </div>
                <div className="editor-field">
                  <label>Queue Behavior</label>
                  <select value={schedQueueBehavior} onChange={(e) => setSchedQueueBehavior(e.target.value as 'skip' | 'queue' | 'parallel')}>
                    <option value="skip">Skip if running</option>
                    <option value="queue">Queue</option>
                    <option value="parallel">Parallel</option>
                  </select>
                </div>
                <div className="editor-field-row">
                  <label><input type="checkbox" checked={schedCatchUp} onChange={(e) => setSchedCatchUp(e.target.checked)} /> Catch up missed</label>
                  <label><input type="checkbox" checked={schedEnabled} onChange={(e) => setSchedEnabled(e.target.checked)} /> Enabled</label>
                </div>
                <div className="editor-actions">
                  <button onClick={resetScheduleForm}>Cancel</button>
                  <button className="save-btn" onClick={handleSaveSchedule}>{editingSchedule ? 'Update' : 'Add'}</button>
                </div>
              </div>
            ) : (
              <>
                <div className="schedule-list">
                  {schedules.length === 0 ? (
                    <div className="empty-schedules">No schedules configured</div>
                  ) : (
                    schedules.map((schedule) => (
                      <div key={schedule.id} className={`schedule-item ${!schedule.enabled ? 'disabled' : ''}`}>
                        <div className="schedule-info">
                          <span className="schedule-name">{schedule.name}</span>
                          <span className="schedule-cron">{schedule.cron}</span>
                          <span className={`schedule-mode ${schedule.mode}`}>{schedule.mode}</span>
                        </div>
                        <div className="schedule-actions">
                          <button onClick={() => handleToggleEnabled(schedule)} title={schedule.enabled ? 'Pause' : 'Resume'}>
                            {schedule.enabled ? '⏸' : '▶'}
                          </button>
                          <button onClick={() => handleTriggerSchedule(schedule.id)} title="Run Now">⚡</button>
                          <button onClick={() => handleEditSchedule(schedule)} title="Edit">✎</button>
                          <button onClick={() => handleDeleteSchedule(schedule.id)} title="Delete">✕</button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <button className="add-schedule-btn" onClick={() => setIsAddingSchedule(true)}>+ Add Schedule</button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
