import { useState, useEffect } from 'react';
import type { Project, Schedule, ParsedSchedule, ScheduleRun } from '../shared/types';

interface Props {
  project: Project;
  onSave: (updates: Partial<Project>) => void;
  onRemove: () => Promise<void>;
  onClose: () => void;
}

type Tab = 'details' | 'schedules';
type ScheduleView = 'list' | 'input' | 'preview' | 'edit';

export default function ProjectEditor({ project, onSave, onRemove, onClose }: Props) {
  const defaultName = project.path.split('/').pop() || '';
  const [name, setName] = useState(project.name || defaultName);
  const [description, setDescription] = useState(project.description || '');
  const [tab, setTab] = useState<Tab>('details');
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [editingSchedule, setEditingSchedule] = useState<Schedule | null>(null);
  const [scheduleView, setScheduleView] = useState<ScheduleView>('list');

  // Natural language input state
  const [nlInput, setNlInput] = useState('');
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [interpretError, setInterpretError] = useState<string | null>(null);
  const [parsedSchedule, setParsedSchedule] = useState<ParsedSchedule | null>(null);

  // Manual schedule form state
  const [schedName, setSchedName] = useState('');
  const [schedCron, setSchedCron] = useState('');
  const [schedMode, setSchedMode] = useState<'interactive' | 'headless'>('interactive');
  const [schedPrompt, setSchedPrompt] = useState('');
  const [schedQueueBehavior, setSchedQueueBehavior] = useState<'skip' | 'queue' | 'parallel'>('skip');
  const [schedCatchUp, setSchedCatchUp] = useState(false);
  const [schedEnabled, setSchedEnabled] = useState(true);

  // Running state and history
  const [runningSchedules, setRunningSchedules] = useState<Set<string>>(new Set());
  const [expandedSchedule, setExpandedSchedule] = useState<string | null>(null);
  const [runHistory, setRunHistory] = useState<Record<string, ScheduleRun[]>>({});
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [liveOutput, setLiveOutput] = useState<Record<string, string>>({});

  useEffect(() => {
    loadSchedules();
  }, [project.path]);

  useEffect(() => {
    window.cockpit.onScheduleRunOutput(({ runId, chunk }) => {
      setLiveOutput(prev => ({
        ...prev,
        [runId]: (prev[runId] || '') + chunk,
      }));
    });
  }, []);

  useEffect(() => {
    window.cockpit.onScheduleRunStarted((run) => {
      // Add the new running task to history and auto-expand it
      setRunHistory(prev => ({
        ...prev,
        [run.scheduleId]: [run, ...(prev[run.scheduleId] || [])],
      }));
      setSelectedRunId(run.id);
    });
  }, []);

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
    setScheduleView('list');
    setNlInput('');
    setParsedSchedule(null);
    setInterpretError(null);
  }

  async function handleInterpret() {
    if (!nlInput.trim()) return;

    setIsInterpreting(true);
    setInterpretError(null);

    try {
      const parsed = await window.cockpit.interpretSchedule(nlInput);
      setParsedSchedule(parsed);
      // Pre-fill the manual form fields from parsed result
      setSchedName(parsed.name);
      setSchedCron(parsed.cron);
      setSchedMode(parsed.mode);
      setSchedPrompt(parsed.prompt);
      setSchedQueueBehavior(parsed.queueBehavior);
      setSchedCatchUp(parsed.catchUp);
      setScheduleView('preview');
    } catch (err) {
      setInterpretError(err instanceof Error ? err.message : 'Failed to interpret');
    } finally {
      setIsInterpreting(false);
    }
  }

  function handleConfirmSchedule() {
    handleSaveSchedule();
  }

  function handleEditDetails() {
    setScheduleView('edit');
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
    setScheduleView('edit');
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
    setRunningSchedules((prev) => new Set(prev).add(id));
    try {
      await window.cockpit.triggerSchedule(id);
      // Refresh history after run completes
      await loadRunHistory(id);
    } finally {
      setRunningSchedules((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  async function loadRunHistory(id: string) {
    const history = await window.cockpit.getScheduleHistory(id, 10);
    setRunHistory((prev) => ({ ...prev, [id]: history }));
  }

  async function toggleScheduleExpanded(id: string) {
    if (expandedSchedule === id) {
      setExpandedSchedule(null);
    } else {
      setExpandedSchedule(id);
      if (!runHistory[id]) {
        await loadRunHistory(id);
      }
    }
  }

  async function handleDeleteRun(runId: string) {
    await window.cockpit.deleteScheduleRun(runId);
    if (expandedSchedule) {
      await loadRunHistory(expandedSchedule);
    }
    setSelectedRunId(null);
  }

  function formatRunTime(timestamp: number): string {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  function getStatusIcon(status: ScheduleRun['status']): string {
    switch (status) {
      case 'success': return '✓';
      case 'failed': return '✗';
      case 'running': return '⟳';
      case 'queued': return '◷';
      default: return '?';
    }
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
            {scheduleView === 'list' && (
              <>
                <div className="schedule-list">
                  {schedules.length === 0 ? (
                    <div className="empty-schedules">No schedules configured</div>
                  ) : (
                    schedules.map((schedule) => (
                      <div key={schedule.id} className="schedule-wrapper">
                        <div className={`schedule-item ${!schedule.enabled ? 'disabled' : ''}`}>
                          <div className="schedule-info" onClick={() => toggleScheduleExpanded(schedule.id)} style={{ cursor: 'pointer' }}>
                            <span className={`expand-triangle ${expandedSchedule === schedule.id ? 'expanded' : ''}`}>▶</span>
                            <div className="schedule-details">
                              <span className="schedule-name">{schedule.name}</span>
                              <span className="schedule-cron">{schedule.cron}</span>
                              <span className={`schedule-mode ${schedule.mode}`}>{schedule.mode}</span>
                            </div>
                          </div>
                          <div className="schedule-actions">
                            <button onClick={() => handleToggleEnabled(schedule)} title={schedule.enabled ? 'Pause' : 'Resume'}>
                              {schedule.enabled ? '⏸' : '▶'}
                            </button>
                            <button
                              onClick={() => handleTriggerSchedule(schedule.id)}
                              title="Run Now"
                              disabled={runningSchedules.has(schedule.id)}
                              className={runningSchedules.has(schedule.id) ? 'running' : ''}
                            >
                              {runningSchedules.has(schedule.id) ? <span className="trigger-spinner" /> : '⚡'}
                            </button>
                            <button onClick={() => handleEditSchedule(schedule)} title="Edit">✎</button>
                            <button onClick={() => handleDeleteSchedule(schedule.id)} title="Delete">✕</button>
                          </div>
                        </div>
                        {expandedSchedule === schedule.id && (
                          <div className="run-history">
                            {!runHistory[schedule.id] ? (
                              <div className="run-history-loading">Loading...</div>
                            ) : runHistory[schedule.id].length === 0 ? (
                              <div className="run-history-empty">No runs yet</div>
                            ) : (
                              runHistory[schedule.id].map((run) => (
                                <div key={run.id}>
                                  <div
                                    className={`run-item run-${run.status} ${selectedRunId === run.id ? 'selected' : ''}`}
                                    onClick={() => setSelectedRunId(selectedRunId === run.id ? null : run.id)}
                                  >
                                    <span className="run-status">{getStatusIcon(run.status)}</span>
                                    <span className="run-time">{formatRunTime(run.startedAt)}</span>
                                    {run.completedAt && (
                                      <span className="run-duration">
                                        {Math.round((run.completedAt - run.startedAt) / 1000)}s
                                      </span>
                                    )}
                                    {run.error && <span className="run-error" title={run.error}>error</span>}
                                    <button
                                      className="run-delete"
                                      onClick={(e) => { e.stopPropagation(); handleDeleteRun(run.id); }}
                                      title="Delete run"
                                    >✕</button>
                                  </div>
                                  {selectedRunId === run.id && (
                                    <div className="run-output">
                                      <pre>{liveOutput[run.id] || run.output || 'No output'}</pre>
                                    </div>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
                <button className="add-schedule-btn" onClick={() => setScheduleView('input')}>+ Add Schedule</button>
              </>
            )}

            {scheduleView === 'input' && (
              <div className="schedule-form">
                <div className="editor-field">
                  <label>Describe your schedule</label>
                  <div className="nl-input-row">
                    <textarea
                      value={nlInput}
                      onChange={(e) => setNlInput(e.target.value)}
                      placeholder="e.g., every weekday at 9am check for security issues"
                      rows={3}
                      disabled={isInterpreting}
                    />
                    <button
                      className={`interpret-btn ${isInterpreting ? 'loading' : ''}`}
                      onClick={handleInterpret}
                      disabled={isInterpreting || !nlInput.trim()}
                      title="Interpret with AI"
                    >
                      {isInterpreting ? <span className="interpret-spinner" /> : '✨'}
                    </button>
                  </div>
                  {isInterpreting && (
                    <div className="interpreting-message">
                      <span className="interpret-spinner" />
                      Interpreting your schedule...
                    </div>
                  )}
                  {interpretError && <div className="interpret-error">{interpretError}</div>}
                </div>
                <div className="editor-actions">
                  <button onClick={resetScheduleForm}>Cancel</button>
                  <button onClick={() => setScheduleView('edit')}>Manual Entry</button>
                </div>
              </div>
            )}

            {scheduleView === 'preview' && parsedSchedule && (
              <div className="schedule-form">
                <div className="schedule-preview">
                  <div className="preview-row">
                    <span className="preview-label">Schedule</span>
                    <span className="preview-value">{parsedSchedule.cronHuman}</span>
                  </div>
                  <div className="preview-row">
                    <span className="preview-label">Task</span>
                    <span className="preview-value">{parsedSchedule.prompt}</span>
                  </div>
                  <div className="preview-row">
                    <span className="preview-label">Mode</span>
                    <span className={`schedule-mode ${parsedSchedule.mode}`}>{parsedSchedule.mode}</span>
                  </div>
                  <div className="preview-row">
                    <span className="preview-label">Name</span>
                    <span className="preview-value">{parsedSchedule.name}</span>
                  </div>
                </div>
                <div className="editor-actions">
                  <button onClick={() => setScheduleView('input')}>Back</button>
                  <button onClick={handleEditDetails}>Edit Details</button>
                  <button className="save-btn" onClick={handleConfirmSchedule}>Confirm</button>
                </div>
              </div>
            )}

            {scheduleView === 'edit' && (
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
            )}
          </div>
        )}
      </div>
    </div>
  );
}
