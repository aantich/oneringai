/**
 * RoutinesPanel - Chat sidebar panel for routine browsing and execution monitoring
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Badge, ProgressBar, Spinner } from 'react-bootstrap';
import { ArrowLeft, Play, Square, CheckCircle, XCircle, Clock, AlertTriangle, Loader } from 'lucide-react';
import type { RoutineDefinition } from 'oneringai';
import type { TabState } from '../hooks/useTabContext';

type PanelView = 'list' | 'detail' | 'execution';

interface RoutinesPanelProps {
  instanceId?: string | null;
  routineExecution?: TabState['routineExecution'];
}

export function RoutinesPanel({ instanceId, routineExecution }: RoutinesPanelProps): React.ReactElement {
  const [view, setView] = useState<PanelView>(routineExecution ? 'execution' : 'list');
  const [routines, setRoutines] = useState<RoutineDefinition[]>([]);
  const [selectedRoutine, setSelectedRoutine] = useState<RoutineDefinition | null>(null);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState(false);

  // Auto-switch to execution view when execution starts
  useEffect(() => {
    if (routineExecution && routineExecution.status === 'running') {
      setView('execution');
    }
  }, [routineExecution]);

  // Load routines
  useEffect(() => {
    (async () => {
      try {
        const result = await window.hosea.routine.list();
        setRoutines(result);
      } catch (error) {
        console.error('Failed to load routines:', error);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSelectRoutine = useCallback(async (id: string) => {
    try {
      const routine = await window.hosea.routine.get(id);
      if (routine) {
        setSelectedRoutine(routine);
        setView('detail');
      }
    } catch (error) {
      console.error('Failed to load routine:', error);
    }
  }, []);

  const handleExecute = useCallback(async () => {
    if (!instanceId || !selectedRoutine) return;
    setExecuting(true);
    try {
      await window.hosea.routine.execute(instanceId, selectedRoutine.id);
      // Execution state will flow via StreamChunk events and update routineExecution
    } catch (error) {
      console.error('Failed to execute routine:', error);
    } finally {
      setExecuting(false);
    }
  }, [instanceId, selectedRoutine]);

  const handleCancel = useCallback(async () => {
    if (!instanceId) return;
    try {
      await window.hosea.routine.cancelExecution(instanceId);
    } catch (error) {
      console.error('Failed to cancel execution:', error);
    }
  }, [instanceId]);

  const handleBack = () => {
    if (view === 'detail') {
      setView('list');
      setSelectedRoutine(null);
    } else if (view === 'execution' && routineExecution?.status !== 'running') {
      setView('list');
    }
  };

  // ============ List View ============
  if (view === 'list') {
    return (
      <div className="routines-panel">
        <div className="routines-panel__header">
          <span className="fw-medium">Routines</span>
          <Badge bg="secondary" pill>{routines.length}</Badge>
        </div>
        {loading ? (
          <div className="text-center py-3">
            <Spinner animation="border" size="sm" />
          </div>
        ) : routines.length === 0 ? (
          <div className="text-center py-4 text-muted">
            <p className="small mb-1">No routines found</p>
            <p className="small">Create routines from the Routines page</p>
          </div>
        ) : (
          <div className="routines-panel__list">
            {routines.map(routine => (
              <div
                key={routine.id}
                className="routines-panel__item"
                onClick={() => handleSelectRoutine(routine.id)}
              >
                <div className="d-flex justify-content-between align-items-start">
                  <span className="fw-medium small">{routine.name}</span>
                  <Badge bg="secondary" pill style={{ fontSize: '0.65rem' }}>{routine.tasks.length}</Badge>
                </div>
                {routine.description && (
                  <small className="text-muted d-block text-truncate">{routine.description}</small>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Show execution status banner if running */}
        {routineExecution?.status === 'running' && (
          <div
            className="routines-panel__execution-banner"
            onClick={() => setView('execution')}
          >
            <div className="d-flex align-items-center gap-2">
              <Loader size={14} className="spin" />
              <span className="small fw-medium">{routineExecution.routineName}</span>
            </div>
            <ProgressBar
              now={routineExecution.progress}
              variant="primary"
              animated
              style={{ height: 4 }}
              className="mt-1"
            />
          </div>
        )}
      </div>
    );
  }

  // ============ Detail View ============
  if (view === 'detail' && selectedRoutine) {
    const canExecute = !!instanceId && !routineExecution?.status;

    return (
      <div className="routines-panel">
        <div className="routines-panel__header">
          <Button variant="link" size="sm" className="p-0 text-decoration-none" onClick={handleBack}>
            <ArrowLeft size={14} className="me-1" /> Back
          </Button>
        </div>

        <div className="routines-panel__detail">
          <h6 className="mb-1">{selectedRoutine.name}</h6>
          {selectedRoutine.version && <small className="text-muted d-block mb-2">v{selectedRoutine.version}</small>}
          {selectedRoutine.description && <p className="small mb-3">{selectedRoutine.description}</p>}

          {/* Tags */}
          {selectedRoutine.tags && selectedRoutine.tags.length > 0 && (
            <div className="d-flex flex-wrap gap-1 mb-3">
              {selectedRoutine.tags.map(tag => (
                <Badge key={tag} bg="info" style={{ fontSize: '0.65rem' }}>{tag}</Badge>
              ))}
            </div>
          )}

          {/* Tasks */}
          <div className="mb-3">
            <span className="small fw-medium">Tasks ({selectedRoutine.tasks.length})</span>
            <div className="mt-1">
              {selectedRoutine.tasks.map((task, idx) => (
                <div key={idx} className="d-flex align-items-start gap-2 py-1 border-bottom" style={{ fontSize: '0.8rem' }}>
                  <Badge bg="secondary" pill className="mt-1" style={{ fontSize: '0.6rem', minWidth: 20 }}>{idx + 1}</Badge>
                  <div>
                    <span className="fw-medium">{task.name}</span>
                    {task.dependsOn && task.dependsOn.length > 0 && (
                      <div className="d-flex gap-1 mt-1">
                        {task.dependsOn.map(dep => (
                          <Badge key={dep} bg="light" text="dark" style={{ fontSize: '0.6rem' }}>
                            depends: {dep}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Instructions preview */}
          {selectedRoutine.instructions && (
            <div className="mb-3">
              <span className="small fw-medium">Instructions</span>
              <div className="small text-muted mt-1" style={{
                maxHeight: 100,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                fontSize: '0.75rem',
                background: 'var(--bg-secondary, #f8f9fa)',
                padding: 8,
                borderRadius: 4,
              }}>
                {selectedRoutine.instructions}
              </div>
            </div>
          )}

          {/* Execute button */}
          <Button
            variant="primary"
            className="w-100"
            onClick={handleExecute}
            disabled={!canExecute || executing}
          >
            {executing ? (
              <><Spinner animation="border" size="sm" className="me-1" /> Starting...</>
            ) : (
              <><Play size={14} className="me-1" /> Execute</>
            )}
          </Button>
          {!instanceId && (
            <small className="text-muted d-block text-center mt-1">Open a chat tab to execute routines</small>
          )}
          {routineExecution?.status === 'running' && (
            <small className="text-warning d-block text-center mt-1">Agent is busy with another routine</small>
          )}
        </div>
      </div>
    );
  }

  // ============ Execution View ============
  if (routineExecution) {
    const isRunning = routineExecution.status === 'running';
    const taskEntries = Array.from(routineExecution.tasks.entries());

    return (
      <div className="routines-panel">
        <div className="routines-panel__header">
          {!isRunning && (
            <Button variant="link" size="sm" className="p-0 text-decoration-none" onClick={handleBack}>
              <ArrowLeft size={14} className="me-1" /> Back
            </Button>
          )}
          <span className="fw-medium small">{routineExecution.routineName}</span>
          <ExecutionStatusBadge status={routineExecution.status} />
        </div>

        {/* Progress */}
        <div className="px-3 py-2">
          <div className="d-flex justify-content-between align-items-center mb-1">
            <small className="text-muted">Progress</small>
            <small className="fw-medium">{Math.round(routineExecution.progress)}%</small>
          </div>
          <ProgressBar
            now={routineExecution.progress}
            variant={routineExecution.status === 'failed' ? 'danger' : routineExecution.status === 'completed' ? 'success' : 'primary'}
            animated={isRunning}
            style={{ height: 6 }}
          />
        </div>

        {/* Task Cards */}
        <div className="routines-panel__tasks">
          {taskEntries.map(([taskId, task]) => (
            <div key={taskId} className="routines-panel__task-card">
              <div className="d-flex align-items-center gap-2">
                <TaskStatusIcon status={task.status} />
                <span className="small fw-medium flex-grow-1">{task.name}</span>
              </div>
              {task.output && (
                <small className="text-muted d-block mt-1" style={{
                  maxHeight: 60,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  fontSize: '0.7rem',
                }}>
                  {task.output}
                </small>
              )}
              {task.error && (
                <small className="text-danger d-block mt-1" style={{ fontSize: '0.7rem' }}>
                  {task.error}
                </small>
              )}
            </div>
          ))}
        </div>

        {/* Step Log */}
        {routineExecution.steps.length > 0 && (
          <div className="routines-panel__steps">
            <small className="fw-medium px-3 d-block mb-1">Execution Log</small>
            <div className="routines-panel__step-log">
              {routineExecution.steps.slice(-20).map((step, idx) => (
                <div key={idx} className="routines-panel__step">
                  <small className="text-muted" style={{ fontSize: '0.65rem' }}>
                    {new Date(step.timestamp).toLocaleTimeString()}
                  </small>
                  <small style={{ fontSize: '0.7rem' }}>
                    <span className="fw-medium">{step.taskName}</span>: {step.type}
                    {step.data && step.type === 'validation' && (
                      <span className="ms-1">
                        (score: {(step.data as any).score}, {(step.data as any).passed ? 'passed' : 'failed'})
                      </span>
                    )}
                  </small>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cancel button */}
        {isRunning && (
          <div className="p-3">
            <Button variant="outline-danger" size="sm" className="w-100" onClick={handleCancel}>
              <Square size={12} className="me-1" /> Cancel Execution
            </Button>
          </div>
        )}
      </div>
    );
  }

  // Fallback: no execution, no detail — go back to list
  return (
    <div className="routines-panel text-center py-4">
      <Button variant="link" onClick={() => setView('list')}>Back to list</Button>
    </div>
  );
}

// ============ Helper Components ============

function ExecutionStatusBadge({ status }: { status: string }): React.ReactElement {
  const variants: Record<string, string> = {
    running: 'primary',
    completed: 'success',
    failed: 'danger',
    cancelled: 'warning',
  };
  return <Badge bg={variants[status] || 'secondary'} style={{ fontSize: '0.65rem' }}>{status}</Badge>;
}

function TaskStatusIcon({ status }: { status: string }): React.ReactElement {
  switch (status) {
    case 'running':
      return <Loader size={14} className="text-primary spin" />;
    case 'completed':
      return <CheckCircle size={14} className="text-success" />;
    case 'failed':
      return <XCircle size={14} className="text-danger" />;
    case 'skipped':
      return <AlertTriangle size={14} className="text-warning" />;
    default:
      return <Clock size={14} className="text-muted" />;
  }
}
