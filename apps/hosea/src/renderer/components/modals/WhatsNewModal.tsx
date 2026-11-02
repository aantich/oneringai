/**
 * What's New Modal - Shows release highlights after version updates
 */

import React, { useState } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import { MarkdownRenderer } from '../markdown/MarkdownRenderer';
import { whatsNewEntries } from '../../whatsnew';

interface WhatsNewModalProps {
  show: boolean;
  onClose: (dontShowAgain: boolean) => void;
}

export function WhatsNewModal({ show, onClose }: WhatsNewModalProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dontShow, setDontShow] = useState(false);
  const entry = whatsNewEntries[selectedIndex] ?? whatsNewEntries[0];

  if (!entry) {
    return <></>;
  }

  const hasPrev = selectedIndex < whatsNewEntries.length - 1;
  const hasNext = selectedIndex > 0;

  return (
    <Modal
      show={show}
      onHide={() => onClose(dontShow)}
      centered
      size="lg"
      className="whatsnew-modal"
    >
      <Modal.Header closeButton>
        <div className="d-flex align-items-center gap-3 w-100">
          <Modal.Title>What's New in hosea</Modal.Title>
          <Form.Select
            size="sm"
            style={{ width: 'auto' }}
            value={selectedIndex}
            onChange={(e) => setSelectedIndex(Number(e.target.value))}
          >
            {whatsNewEntries.map((e, i) => (
              <option key={e.version} value={i}>
                v{e.version}{i === 0 ? ' (latest)' : ''}
              </option>
            ))}
          </Form.Select>
        </div>
      </Modal.Header>
      <Modal.Body style={{ maxHeight: '60vh', overflowY: 'auto' }}>
        <MarkdownRenderer content={entry.content} />
      </Modal.Body>
      <Modal.Footer className="d-flex justify-content-between">
        <div className="d-flex gap-2 align-items-center">
          <Button
            variant="outline-secondary"
            size="sm"
            disabled={!hasPrev}
            onClick={() => setSelectedIndex((i) => i + 1)}
          >
            &larr; Older
          </Button>
          <Button
            variant="outline-secondary"
            size="sm"
            disabled={!hasNext}
            onClick={() => setSelectedIndex((i) => i - 1)}
          >
            Newer &rarr;
          </Button>
        </div>
        <div className="d-flex align-items-center gap-3">
          <Form.Check
            type="checkbox"
            id="whatsnew-dont-show"
            label="Don't show for this version"
            checked={dontShow}
            onChange={(e) => setDontShow(e.target.checked)}
          />
          <Button variant="primary" onClick={() => onClose(dontShow)}>
            Got it
          </Button>
        </div>
      </Modal.Footer>
    </Modal>
  );
}
