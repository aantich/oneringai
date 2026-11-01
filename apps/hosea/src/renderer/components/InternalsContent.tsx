/**
 * InternalsContent — Thin wrapper around shared LookInsidePanel.
 *
 * Manages IPC data fetching, auto-refresh, memory value lazy-loading,
 * and the "View Full Context" modal. All rendering is delegated to
 * the shared Hosea local UI components.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Spinner, Modal, Button } from 'react-bootstrap';
import { RefreshCw } from 'lucide-react';
import { LookInsidePanel, ViewContextContent } from '../../ui/index.js';
import type { IContextSnapshot, IViewContextData } from '../../ui/index.js';

interface InternalsContentProps {
  /** Optional instanceId for multi-tab support. If null, uses legacy single agent. */
  instanceId?: string | null;
}

export function InternalsContent({ instanceId }: InternalsContentProps): React.ReactElement {
  const [snapshot, setSnapshot] = useState<IContextSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [memoryValues, setMemoryValues] = useState<Map<string, unknown>>(new Map());
  const [loadingMemoryKey, setLoadingMemoryKey] = useState<string | null>(null);
  const [showContextModal, setShowContextModal] = useState(false);
  const [viewContextData, setViewContextData] = useState<IViewContextData | null>(null);
  const [viewContextLoading, setViewContextLoading] = useState(false);
  const [isCompacting, setIsCompacting] = useState(false);

  // Fetch snapshot via IPC
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const data = instanceId !== undefined
        ? await window.hosea.internals.getAllForInstance(instanceId ?? null)
        : await window.hosea.internals.getAll();
      setSnapshot(data);
    } catch (error) {
      console.error('Failed to fetch internals:', error);
    } finally {
      setLoading(false);
    }
  }, [instanceId]);

  // Auto-refresh polling
  useEffect(() => {
    fetchData();
    if (autoRefresh) {
      const interval = setInterval(fetchData, 2000);
      return () => clearInterval(interval);
    }
  }, [autoRefresh, fetchData]);

  // Memory value lazy-load on click
  const handleMemoryEntryClick = useCallback(async (key: string) => {
    if (memoryValues.has(key)) {
      // Toggle off — remove the value so it collapses
      setMemoryValues((prev) => {
        const next = new Map(prev);
        next.delete(key);
        return next;
      });
      return;
    }
    try {
      setLoadingMemoryKey(key);
      const value = instanceId !== undefined
        ? await window.hosea.internals.getMemoryValueForInstance(instanceId ?? null, key)
        : await window.hosea.internals.getMemoryValue(key);
      setMemoryValues((prev) => {
        const next = new Map(prev);
        next.set(key, value);
        return next;
      });
    } catch (error) {
      console.error('Failed to fetch memory value:', error);
    } finally {
      setLoadingMemoryKey(null);
    }
  }, [memoryValues, instanceId]);

  // View Full Context modal
  const handleViewFullContext = useCallback(async () => {
    setShowContextModal(true);
    setViewContextLoading(true);
    try {
      const data = await window.hosea.internals.getPreparedContext(instanceId ?? undefined);
      setViewContextData(data);
    } catch (error) {
      console.error('Failed to fetch prepared context:', error);
    } finally {
      setViewContextLoading(false);
    }
  }, [instanceId]);

  // Force compaction
  const handleForceCompact = useCallback(async () => {
    try {
      setIsCompacting(true);
      const result = instanceId !== undefined
        ? await window.hosea.internals.forceCompactForInstance(instanceId ?? null)
        : await window.hosea.internals.forceCompact();
      if (result.success) {
        fetchData();
      } else {
        console.error('Force compact failed:', result.error);
      }
    } catch (error) {
      console.error('Failed to force compact:', error);
    } finally {
      setIsCompacting(false);
    }
  }, [fetchData, instanceId]);

  return (
    <>
      <LookInsidePanel
        snapshot={snapshot}
        loading={loading && !snapshot}
        agentName={snapshot?.agentId}
        className="hosea-look-inside"
        onViewFullContext={handleViewFullContext}
        onForceCompaction={
          (snapshot?.budget?.utilizationPercent ?? 0) >= 50 ? handleForceCompact : undefined
        }
        onMemoryEntryClick={handleMemoryEntryClick}
        memoryEntryValues={memoryValues}
        loadingMemoryKey={loadingMemoryKey}
        headerActions={
          <div className="internals-content__actions">
            <button
              className={`internals-panel__action-btn ${autoRefresh ? 'active' : ''}`}
              onClick={() => setAutoRefresh(!autoRefresh)}
              title={autoRefresh ? 'Auto-refresh ON' : 'Auto-refresh OFF'}
            >
              <RefreshCw size={14} className={autoRefresh ? 'spinning' : ''} />
            </button>
            <button
              className="internals-panel__action-btn"
              onClick={fetchData}
              disabled={loading}
              title="Refresh now"
            >
              {loading ? <Spinner animation="border" size="sm" /> : <RefreshCw size={14} />}
            </button>
          </div>
        }
        defaultExpanded={['context', 'tools']}
      />
      <Modal
        show={showContextModal}
        onHide={() => setShowContextModal(false)}
        size="xl"
        dialogClassName="context-modal"
        contentClassName="context-modal__content"
      >
        <Modal.Header closeButton>
          <Modal.Title>Full Prepared Context</Modal.Title>
        </Modal.Header>
        <Modal.Body className="context-modal__body">
          <ViewContextContent
            data={viewContextData}
            loading={viewContextLoading}
            onCopyAll={() => {
              if (viewContextData?.rawContext) {
                navigator.clipboard.writeText(viewContextData.rawContext);
              }
            }}
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowContextModal(false)}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              if (viewContextData?.rawContext) {
                navigator.clipboard.writeText(viewContextData.rawContext);
              }
            }}
            disabled={!viewContextData?.rawContext}
          >
            Copy All
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
