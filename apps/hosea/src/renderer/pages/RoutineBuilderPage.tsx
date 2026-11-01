/**
 * RoutineBuilderPage - Create and edit routine definitions
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Button, Form, Badge, Accordion, Alert, Spinner } from 'react-bootstrap';
import { ArrowLeft, Plus, Trash2, GripVertical, Save, X, ChevronDown, ChevronUp } from 'lucide-react';
import { useNavigation } from '../hooks/useNavigation';
import type { RoutineDefinitionInput } from 'oneringai';

interface TaskInputState {
  key: string; // local key for React rendering
  name: string;
  description: string;
  dependsOn: string[];
  suggestedTools: string[];
  expectedOutput: string;
  maxAttempts: number;
  validationEnabled: boolean;
  completionCriteria: string[];
  minScore: number;
}

function createEmptyTask(): TaskInputState {
  return {
    key: `task-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
    name: '',
    description: '',
    dependsOn: [],
    suggestedTools: [],
    expectedOutput: '',
    maxAttempts: 3,
    validationEnabled: false,
    completionCriteria: [],
    minScore: 0.7,
  };
}

export function RoutineBuilderPage(): React.ReactElement {
  const { state: navState, goBack, navigate } = useNavigation();
  const routineId = navState.params.id;
  const isNew = routineId === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Basic info
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [author, setAuthor] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [tags, setTags] = useState<string[]>([]);

  // Instructions
  const [instructions, setInstructions] = useState('');

  // Tasks
  const [tasks, setTasks] = useState<TaskInputState[]>([createEmptyTask()]);

  // Settings
  const [concurrency, setConcurrency] = useState<'sequential' | 'parallel' | 'auto'>('auto');
  const [allowDynamicTasks, setAllowDynamicTasks] = useState(false);
  const [requiredToolsInput, setRequiredToolsInput] = useState('');
  const [requiredPluginsInput, setRequiredPluginsInput] = useState('');

  // Debounced validation
  const validateTimer = useRef<ReturnType<typeof setTimeout>>();

  // Load existing routine
  useEffect(() => {
    if (isNew || !routineId) return;
    (async () => {
      try {
        const routine = await window.hosea.routine.get(routineId);
        if (!routine) {
          navigate('routines');
          return;
        }
        setName(routine.name);
        setDescription(routine.description);
        setVersion(routine.version || '1.0.0');
        setAuthor(routine.author || '');
        setTags(routine.tags || []);
        setInstructions(routine.instructions || '');
        // Map PlanConcurrency to our simple UI model
        if (routine.concurrency) {
          setConcurrency(routine.concurrency.maxParallelTasks === 1 ? 'sequential' : 'parallel');
        } else {
          setConcurrency('auto');
        }
        setAllowDynamicTasks(routine.allowDynamicTasks || false);
        setRequiredToolsInput((routine.requiredTools || []).join(', '));
        setRequiredPluginsInput((routine.requiredPlugins || []).join(', '));
        setTasks(routine.tasks.map(t => ({
          key: `task-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
          name: t.name,
          description: t.description,
          dependsOn: t.dependsOn || [],
          suggestedTools: t.suggestedTools || [],
          expectedOutput: t.expectedOutput || '',
          maxAttempts: t.maxAttempts || 3,
          validationEnabled: !!t.validation,
          completionCriteria: t.validation?.completionCriteria || [],
          minScore: t.validation?.minCompletionScore ? t.validation.minCompletionScore / 100 : 0.7,
        })));
      } catch (error) {
        console.error('Failed to load routine:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, [routineId, isNew, navigate]);

  // Build the RoutineDefinitionInput from state
  const buildInput = useCallback((): RoutineDefinitionInput => {
    const requiredTools = requiredToolsInput.split(',').map(s => s.trim()).filter(Boolean);
    const requiredPlugins = requiredPluginsInput.split(',').map(s => s.trim()).filter(Boolean);

    return {
      id: isNew ? undefined : routineId,
      name: name.trim(),
      description: description.trim(),
      version: version.trim() || undefined,
      author: author.trim() || undefined,
      tags: tags.length > 0 ? tags : undefined,
      instructions: instructions.trim() || undefined,
      concurrency: concurrency === 'auto' ? undefined : {
        maxParallelTasks: concurrency === 'sequential' ? 1 : 5,
        strategy: 'fifo' as const,
      },
      allowDynamicTasks,
      requiredTools: requiredTools.length > 0 ? requiredTools : undefined,
      requiredPlugins: requiredPlugins.length > 0 ? requiredPlugins : undefined,
      tasks: tasks.map(t => ({
        name: t.name.trim(),
        description: t.description.trim(),
        dependsOn: t.dependsOn.length > 0 ? t.dependsOn : undefined,
        suggestedTools: t.suggestedTools.length > 0 ? t.suggestedTools : undefined,
        expectedOutput: t.expectedOutput.trim() || undefined,
        maxAttempts: t.maxAttempts,
        validation: t.validationEnabled ? {
          completionCriteria: t.completionCriteria.filter(c => c.trim()),
          minCompletionScore: Math.round(t.minScore * 100),
          skipReflection: false,
        } : undefined,
      })),
    };
  }, [name, description, version, author, tags, instructions, concurrency, allowDynamicTasks, requiredToolsInput, requiredPluginsInput, tasks, isNew, routineId]);

  // Debounced validation
  useEffect(() => {
    if (!name.trim()) return;
    clearTimeout(validateTimer.current);
    validateTimer.current = setTimeout(async () => {
      const input = buildInput();
      if (!input.name || input.tasks.some(t => !t.name || !t.description)) return;
      const result = await window.hosea.routine.validate(input);
      setValidationError(result.valid ? null : result.error || 'Validation failed');
    }, 500);
    return () => clearTimeout(validateTimer.current);
  }, [buildInput, name]);

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    setValidationError(null);
    try {
      const input = buildInput();
      // Quick validation
      const validation = await window.hosea.routine.validate(input);
      if (!validation.valid) {
        setValidationError(validation.error || 'Validation failed');
        setSaving(false);
        return;
      }
      const result = await window.hosea.routine.save(input);
      setSaveSuccess(true);
      // If new, update the URL to edit mode
      if (isNew) {
        navigate('routine-builder', { id: result.id });
      }
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  // Task management
  const addTask = () => setTasks(prev => [...prev, createEmptyTask()]);

  const removeTask = (idx: number) => {
    setTasks(prev => prev.filter((_, i) => i !== idx));
  };

  const updateTask = (idx: number, updates: Partial<TaskInputState>) => {
    setTasks(prev => prev.map((t, i) => i === idx ? { ...t, ...updates } : t));
  };

  const moveTask = (idx: number, direction: 'up' | 'down') => {
    setTasks(prev => {
      const newTasks = [...prev];
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= newTasks.length) return prev;
      [newTasks[idx], newTasks[targetIdx]] = [newTasks[targetIdx], newTasks[idx]];
      return newTasks;
    });
  };

  // Tag management
  const handleTagKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tag = tagsInput.trim().replace(/,/g, '');
      if (tag && !tags.includes(tag)) {
        setTags(prev => [...prev, tag]);
      }
      setTagsInput('');
    }
  };

  const removeTag = (tag: string) => setTags(prev => prev.filter(t => t !== tag));

  // Suggested tools badge input helper
  const handleToolsKeyDown = (idx: number, e: React.KeyboardEvent<HTMLElement>, currentInput: string, setInput: (v: string) => void) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const tool = currentInput.trim().replace(/,/g, '');
      if (tool) {
        const task = tasks[idx];
        if (!task.suggestedTools.includes(tool)) {
          updateTask(idx, { suggestedTools: [...task.suggestedTools, tool] });
        }
        setInput('');
      }
    }
  };

  // Completion criteria input helper
  const addCriteria = (idx: number) => {
    const task = tasks[idx];
    updateTask(idx, { completionCriteria: [...task.completionCriteria, ''] });
  };

  const updateCriteria = (taskIdx: number, criteriaIdx: number, value: string) => {
    const task = tasks[taskIdx];
    const updated = [...task.completionCriteria];
    updated[criteriaIdx] = value;
    updateTask(taskIdx, { completionCriteria: updated });
  };

  const removeCriteria = (taskIdx: number, criteriaIdx: number) => {
    const task = tasks[taskIdx];
    updateTask(taskIdx, { completionCriteria: task.completionCriteria.filter((_, i) => i !== criteriaIdx) });
  };

  if (loading) {
    return (
      <div className="page">
        <div className="page__content page__content--centered">
          <Spinner animation="border" size="sm" /> Loading routine...
        </div>
      </div>
    );
  }

  const otherTaskNames = (idx: number) => tasks.filter((_, i) => i !== idx).map(t => t.name).filter(Boolean);

  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-left">
          <Button variant="outline-secondary" size="sm" onClick={goBack}>
            <ArrowLeft size={16} />
          </Button>
          <h2 className="page__title">{isNew ? 'New Routine' : 'Edit Routine'}</h2>
        </div>
        <div className="page__header-right">
          <Button variant="outline-secondary" onClick={() => navigate('routines')}>Cancel</Button>
          <Button variant="primary" onClick={handleSave} disabled={saving || !name.trim()}>
            {saving ? <><Spinner animation="border" size="sm" className="me-1" /> Saving...</> : <><Save size={16} className="me-1" /> Save</>}
          </Button>
        </div>
      </div>

      <div className="page__content">
        {validationError && <Alert variant="danger" className="mb-3" dismissible onClose={() => setValidationError(null)}>{validationError}</Alert>}
        {saveSuccess && <Alert variant="success" className="mb-3">Routine saved successfully!</Alert>}

        <div style={{ maxWidth: 900 }}>
        {/* Basic Info */}
        <section className="mb-4">
          <h5>Basic Info</h5>
          <div className="row g-3">
            <div className="col-12 col-md-8">
              <Form.Group>
                <Form.Label>Name <span className="text-danger">*</span></Form.Label>
                <Form.Control value={name} onChange={e => setName(e.target.value)} placeholder="e.g., Research & Report" />
              </Form.Group>
            </div>
            <div className="col-12 col-md-4">
              <Form.Group>
                <Form.Label>Version</Form.Label>
                <Form.Control value={version} onChange={e => setVersion(e.target.value)} placeholder="1.0.0" />
              </Form.Group>
            </div>
            <div className="col-12">
              <Form.Group>
                <Form.Label>Description</Form.Label>
                <Form.Control as="textarea" rows={2} value={description} onChange={e => setDescription(e.target.value)} placeholder="What this routine accomplishes..." />
              </Form.Group>
            </div>
            <div className="col-12 col-md-6">
              <Form.Group>
                <Form.Label>Author</Form.Label>
                <Form.Control value={author} onChange={e => setAuthor(e.target.value)} placeholder="Your name" />
              </Form.Group>
            </div>
            <div className="col-12 col-md-6">
              <Form.Group>
                <Form.Label>Tags</Form.Label>
                <div className="d-flex flex-wrap gap-1 mb-1">
                  {tags.map(tag => (
                    <Badge key={tag} bg="info" className="d-flex align-items-center gap-1">
                      {tag}
                      <X size={10} style={{ cursor: 'pointer' }} onClick={() => removeTag(tag)} />
                    </Badge>
                  ))}
                </div>
                <Form.Control
                  value={tagsInput}
                  onChange={e => setTagsInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  placeholder="Type tag and press Enter"
                  size="sm"
                />
              </Form.Group>
            </div>
          </div>
        </section>

        {/* Instructions */}
        <section className="mb-4">
          <h5>Instructions</h5>
          <Form.Control
            as="textarea"
            rows={4}
            value={instructions}
            onChange={e => setInstructions(e.target.value)}
            placeholder="Additional instructions injected into the system prompt when this routine runs..."
          />
        </section>

        {/* Tasks */}
        <section className="mb-4">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h5 className="mb-0">Tasks ({tasks.length})</h5>
            <Button variant="outline-primary" size="sm" onClick={addTask}>
              <Plus size={14} className="me-1" /> Add Task
            </Button>
          </div>

          <Accordion>
            {tasks.map((task, idx) => (
              <TaskEditor
                key={task.key}
                index={idx}
                task={task}
                otherTaskNames={otherTaskNames(idx)}
                onUpdate={(updates) => updateTask(idx, updates)}
                onRemove={() => removeTask(idx)}
                onMove={(dir) => moveTask(idx, dir)}
                canMoveUp={idx > 0}
                canMoveDown={idx < tasks.length - 1}
                onAddCriteria={() => addCriteria(idx)}
                onUpdateCriteria={(ci, v) => updateCriteria(idx, ci, v)}
                onRemoveCriteria={(ci) => removeCriteria(idx, ci)}
                onToolsKeyDown={handleToolsKeyDown}
              />
            ))}
          </Accordion>
        </section>

        {/* Settings */}
        <section className="mb-4">
          <h5>Settings</h5>
          <div className="row g-3">
            <div className="col-12 col-md-4">
              <Form.Group>
                <Form.Label>Concurrency</Form.Label>
                <Form.Select value={concurrency} onChange={e => setConcurrency(e.target.value as any)}>
                  <option value="sequential">Sequential</option>
                  <option value="parallel">Parallel</option>
                  <option value="auto">Auto (dependency-based)</option>
                </Form.Select>
              </Form.Group>
            </div>
            <div className="col-12 col-md-4">
              <Form.Group>
                <Form.Label>Required Tools</Form.Label>
                <Form.Control
                  value={requiredToolsInput}
                  onChange={e => setRequiredToolsInput(e.target.value)}
                  placeholder="tool1, tool2"
                  size="sm"
                />
                <Form.Text className="text-muted">Comma-separated tool names</Form.Text>
              </Form.Group>
            </div>
            <div className="col-12 col-md-4">
              <Form.Group>
                <Form.Label>Required Plugins</Form.Label>
                <Form.Control
                  value={requiredPluginsInput}
                  onChange={e => setRequiredPluginsInput(e.target.value)}
                  placeholder="working_memory"
                  size="sm"
                />
                <Form.Text className="text-muted">Comma-separated plugin names</Form.Text>
              </Form.Group>
            </div>
            <div className="col-12">
              <Form.Check
                type="switch"
                label="Allow dynamic tasks (LLM can add/modify tasks during execution)"
                checked={allowDynamicTasks}
                onChange={e => setAllowDynamicTasks(e.target.checked)}
              />
            </div>
          </div>
        </section>
        </div>
      </div>
    </div>
  );
}

// ============ Task Editor Sub-Component ============

interface TaskEditorProps {
  index: number;
  task: TaskInputState;
  otherTaskNames: string[];
  onUpdate: (updates: Partial<TaskInputState>) => void;
  onRemove: () => void;
  onMove: (dir: 'up' | 'down') => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onAddCriteria: () => void;
  onUpdateCriteria: (idx: number, value: string) => void;
  onRemoveCriteria: (idx: number) => void;
  onToolsKeyDown: (idx: number, e: React.KeyboardEvent<HTMLElement>, currentInput: string, setInput: (v: string) => void) => void;
}

function TaskEditor({
  index, task, otherTaskNames, onUpdate, onRemove, onMove, canMoveUp, canMoveDown,
  onAddCriteria, onUpdateCriteria, onRemoveCriteria, onToolsKeyDown,
}: TaskEditorProps): React.ReactElement {
  const [toolInput, setToolInput] = useState('');

  return (
    <Accordion.Item eventKey={String(index)}>
      <Accordion.Header>
        <div className="d-flex align-items-center gap-2 flex-grow-1 me-2">
          <GripVertical size={14} className="text-muted" />
          <span className="badge bg-secondary rounded-pill">{index + 1}</span>
          <span>{task.name || <em className="text-muted">Untitled Task</em>}</span>
          {task.dependsOn.length > 0 && (
            <Badge bg="outline-info" className="border" style={{ fontSize: '0.65rem' }}>
              depends on {task.dependsOn.length}
            </Badge>
          )}
        </div>
      </Accordion.Header>
      <Accordion.Body>
        <div className="row g-2">
          <div className="col-12 d-flex justify-content-end gap-1 mb-1">
            <Button variant="outline-secondary" size="sm" onClick={() => onMove('up')} disabled={!canMoveUp}>
              <ChevronUp size={12} />
            </Button>
            <Button variant="outline-secondary" size="sm" onClick={() => onMove('down')} disabled={!canMoveDown}>
              <ChevronDown size={12} />
            </Button>
            <Button variant="outline-danger" size="sm" onClick={onRemove}>
              <Trash2 size={12} /> Remove
            </Button>
          </div>

          <div className="col-12 col-md-8">
            <Form.Group>
              <Form.Label className="small">Name <span className="text-danger">*</span></Form.Label>
              <Form.Control size="sm" value={task.name} onChange={e => onUpdate({ name: e.target.value })} placeholder="Task name" />
            </Form.Group>
          </div>
          <div className="col-12 col-md-4">
            <Form.Group>
              <Form.Label className="small">Max Attempts</Form.Label>
              <Form.Control size="sm" type="number" min={1} max={10} value={task.maxAttempts} onChange={e => onUpdate({ maxAttempts: parseInt(e.target.value) || 3 })} />
            </Form.Group>
          </div>
          <div className="col-12">
            <Form.Group>
              <Form.Label className="small">Description <span className="text-danger">*</span></Form.Label>
              <Form.Control as="textarea" rows={2} size="sm" value={task.description} onChange={e => onUpdate({ description: e.target.value })} placeholder="What the agent should accomplish..." />
            </Form.Group>
          </div>
          <div className="col-12">
            <Form.Group>
              <Form.Label className="small">Expected Output</Form.Label>
              <Form.Control size="sm" value={task.expectedOutput} onChange={e => onUpdate({ expectedOutput: e.target.value })} placeholder="Describe what a successful output looks like" />
            </Form.Group>
          </div>

          {/* Dependencies */}
          <div className="col-12 col-md-6">
            <Form.Group>
              <Form.Label className="small">Dependencies</Form.Label>
              {otherTaskNames.length > 0 ? (
                <div className="d-flex flex-wrap gap-1">
                  {otherTaskNames.map(tn => (
                    <Badge
                      key={tn}
                      bg={task.dependsOn.includes(tn) ? 'primary' : 'light'}
                      text={task.dependsOn.includes(tn) ? 'light' : 'dark'}
                      style={{ cursor: 'pointer', fontSize: '0.7rem' }}
                      onClick={() => {
                        const deps = task.dependsOn.includes(tn)
                          ? task.dependsOn.filter(d => d !== tn)
                          : [...task.dependsOn, tn];
                        onUpdate({ dependsOn: deps });
                      }}
                    >
                      {tn}
                    </Badge>
                  ))}
                </div>
              ) : (
                <small className="text-muted d-block">No other tasks defined yet</small>
              )}
            </Form.Group>
          </div>

          {/* Suggested Tools */}
          <div className="col-12 col-md-6">
            <Form.Group>
              <Form.Label className="small">Suggested Tools</Form.Label>
              <div className="d-flex flex-wrap gap-1 mb-1">
                {task.suggestedTools.map(tool => (
                  <Badge key={tool} bg="info" className="d-flex align-items-center gap-1" style={{ fontSize: '0.7rem' }}>
                    {tool}
                    <X size={8} style={{ cursor: 'pointer' }} onClick={() => onUpdate({ suggestedTools: task.suggestedTools.filter(t => t !== tool) })} />
                  </Badge>
                ))}
              </div>
              <Form.Control
                size="sm"
                value={toolInput}
                onChange={e => setToolInput(e.target.value)}
                onKeyDown={e => onToolsKeyDown(index, e, toolInput, setToolInput)}
                placeholder="Type tool name and press Enter"
              />
            </Form.Group>
          </div>

          {/* Validation */}
          <div className="col-12">
            <Form.Check
              type="switch"
              label="Enable validation"
              checked={task.validationEnabled}
              onChange={e => onUpdate({ validationEnabled: e.target.checked })}
              className="mb-2"
            />
            {task.validationEnabled && (
              <div className="ps-3 border-start">
                <div className="d-flex justify-content-between align-items-center mb-1">
                  <Form.Label className="small mb-0">Completion Criteria</Form.Label>
                  <Button variant="outline-secondary" size="sm" onClick={onAddCriteria} style={{ fontSize: '0.7rem' }}>
                    <Plus size={10} /> Add
                  </Button>
                </div>
                {task.completionCriteria.map((criteria, ci) => (
                  <div key={ci} className="d-flex gap-1 mb-1">
                    <Form.Control
                      size="sm"
                      value={criteria}
                      onChange={e => onUpdateCriteria(ci, e.target.value)}
                      placeholder="e.g., Output contains a summary section"
                    />
                    <Button variant="outline-danger" size="sm" onClick={() => onRemoveCriteria(ci)}>
                      <X size={10} />
                    </Button>
                  </div>
                ))}
                <Form.Group className="mt-2">
                  <Form.Label className="small">Min Score (0-1)</Form.Label>
                  <Form.Control
                    size="sm"
                    type="number"
                    min={0}
                    max={1}
                    step={0.1}
                    value={task.minScore}
                    onChange={e => onUpdate({ minScore: parseFloat(e.target.value) || 0.7 })}
                    style={{ width: 100 }}
                  />
                </Form.Group>
              </div>
            )}
          </div>
        </div>
      </Accordion.Body>
    </Accordion.Item>
  );
}
