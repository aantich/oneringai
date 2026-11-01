/**
 * RoutinesPage - List and manage routine definitions
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Button, Form, Badge, Spinner } from 'react-bootstrap';
import { Plus, Search, Grid, List, Copy, Trash2, Edit, Tag, Clock } from 'lucide-react';
import { useNavigation } from '../hooks/useNavigation';
import type { RoutineDefinition } from 'oneringai';

type ViewMode = 'card' | 'list';
type SortBy = 'name' | 'updatedAt';

export function RoutinesPage(): React.ReactElement {
  const { navigate } = useNavigation();
  const [routines, setRoutines] = useState<RoutineDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('updatedAt');
  const [viewMode, setViewMode] = useState<ViewMode>('card');
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const loadRoutines = useCallback(async () => {
    setLoading(true);
    try {
      const options = search.trim() ? { search: search.trim() } : undefined;
      const result = await window.hosea.routine.list(options);
      setRoutines(result);
    } catch (error) {
      console.error('Failed to load routines:', error);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    loadRoutines();
  }, [loadRoutines]);

  const sorted = [...routines].sort((a, b) => {
    if (sortBy === 'name') return a.name.localeCompare(b.name);
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });

  const handleDelete = async (id: string) => {
    try {
      await window.hosea.routine.delete(id);
      setRoutines(prev => prev.filter(r => r.id !== id));
      setDeleteConfirmId(null);
    } catch (error) {
      console.error('Failed to delete routine:', error);
    }
  };

  const handleDuplicate = async (id: string) => {
    try {
      await window.hosea.routine.duplicate(id);
      loadRoutines();
    } catch (error) {
      console.error('Failed to duplicate routine:', error);
    }
  };

  const handleEdit = (id: string) => {
    navigate('routine-builder', { id });
  };

  const handleCreate = () => {
    navigate('routine-builder', { id: 'new' });
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  };

  return (
    <div className="page">
      <div className="page__header">
        <div className="page__header-left">
          <div>
            <h2 className="page__title">Routines</h2>
            <p className="page__subtitle">Create and manage automated task workflows</p>
          </div>
        </div>
        <div className="page__header-right">
          <Button variant="primary" onClick={handleCreate}>
            <Plus size={16} className="me-1" /> New Routine
          </Button>
        </div>
      </div>

      <div className="page__content">
      {/* Toolbar */}
      <div className="d-flex gap-2 mb-3 align-items-center">
        <div className="position-relative flex-grow-1" style={{ maxWidth: 400 }}>
          <Search size={14} className="position-absolute" style={{ top: 10, left: 10, color: 'var(--text-muted)' }} />
          <Form.Control
            type="text"
            placeholder="Search routines..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 32 }}
            size="sm"
          />
        </div>
        <Form.Select
          size="sm"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortBy)}
          style={{ width: 'auto' }}
        >
          <option value="updatedAt">Last Modified</option>
          <option value="name">Name</option>
        </Form.Select>
        <div className="btn-group btn-group-sm">
          <Button
            variant={viewMode === 'card' ? 'primary' : 'outline-secondary'}
            onClick={() => setViewMode('card')}
            size="sm"
          >
            <Grid size={14} />
          </Button>
          <Button
            variant={viewMode === 'list' ? 'primary' : 'outline-secondary'}
            onClick={() => setViewMode('list')}
            size="sm"
          >
            <List size={14} />
          </Button>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" size="sm" /> Loading...
        </div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-5">
          <p className="text-muted mb-3">
            {search ? 'No routines match your search.' : 'No routines yet. Create your first routine to automate multi-step tasks.'}
          </p>
          {!search && (
            <Button variant="primary" onClick={handleCreate}>
              <Plus size={16} className="me-1" /> Create Routine
            </Button>
          )}
        </div>
      ) : viewMode === 'card' ? (
        <div className="row g-3">
          {sorted.map(routine => (
            <div key={routine.id} className="col-12 col-md-6 col-lg-4">
              <div
                className="card h-100"
                style={{ cursor: 'pointer', transition: 'border-color 0.15s' }}
                onClick={() => handleEdit(routine.id)}
              >
                <div className="card-body">
                  <div className="d-flex justify-content-between align-items-start mb-2">
                    <h6 className="card-title mb-0">{routine.name}</h6>
                    <Badge bg="secondary" pill>{routine.tasks.length} tasks</Badge>
                  </div>
                  {routine.description && (
                    <p className="card-text text-muted small mb-2" style={{
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                      overflow: 'hidden',
                    }}>
                      {routine.description}
                    </p>
                  )}
                  <div className="d-flex flex-wrap gap-1 mb-2">
                    {routine.tags?.slice(0, 3).map(tag => (
                      <Badge key={tag} bg="info" className="fw-normal" style={{ fontSize: '0.7rem' }}>
                        <Tag size={10} className="me-1" />{tag}
                      </Badge>
                    ))}
                  </div>
                  <div className="d-flex justify-content-between align-items-center">
                    <small className="text-muted">
                      <Clock size={12} className="me-1" />{formatDate(routine.updatedAt)}
                    </small>
                    <div className="d-flex gap-1" onClick={e => e.stopPropagation()}>
                      <Button variant="outline-secondary" size="sm" onClick={() => handleDuplicate(routine.id)} title="Duplicate">
                        <Copy size={12} />
                      </Button>
                      {deleteConfirmId === routine.id ? (
                        <>
                          <Button variant="danger" size="sm" onClick={() => handleDelete(routine.id)}>Confirm</Button>
                          <Button variant="outline-secondary" size="sm" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
                        </>
                      ) : (
                        <Button variant="outline-danger" size="sm" onClick={() => setDeleteConfirmId(routine.id)} title="Delete">
                          <Trash2 size={12} />
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="list-group">
          {sorted.map(routine => (
            <div
              key={routine.id}
              className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
              style={{ cursor: 'pointer' }}
              onClick={() => handleEdit(routine.id)}
            >
              <div className="d-flex align-items-center gap-3 flex-grow-1 min-width-0">
                <div className="flex-grow-1 min-width-0">
                  <div className="d-flex align-items-center gap-2">
                    <span className="fw-medium">{routine.name}</span>
                    <Badge bg="secondary" pill className="small">{routine.tasks.length} tasks</Badge>
                  </div>
                  {routine.description && (
                    <small className="text-muted text-truncate d-block">{routine.description}</small>
                  )}
                </div>
              </div>
              <div className="d-flex align-items-center gap-2" onClick={e => e.stopPropagation()}>
                <small className="text-muted text-nowrap">{formatDate(routine.updatedAt)}</small>
                <Button variant="outline-secondary" size="sm" onClick={() => handleEdit(routine.id)}>
                  <Edit size={12} />
                </Button>
                <Button variant="outline-secondary" size="sm" onClick={() => handleDuplicate(routine.id)}>
                  <Copy size={12} />
                </Button>
                {deleteConfirmId === routine.id ? (
                  <>
                    <Button variant="danger" size="sm" onClick={() => handleDelete(routine.id)}>Confirm</Button>
                    <Button variant="outline-secondary" size="sm" onClick={() => setDeleteConfirmId(null)}>Cancel</Button>
                  </>
                ) : (
                  <Button variant="outline-danger" size="sm" onClick={() => setDeleteConfirmId(routine.id)}>
                    <Trash2 size={12} />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
