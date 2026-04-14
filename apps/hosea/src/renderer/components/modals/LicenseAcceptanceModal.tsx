/**
 * License Acceptance Modal - shown on first launch
 *
 * Users must accept the Everworker Commercial License before using Everworker Desktop.
 * Acceptance is persisted via electron-store so it only shows once.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';

interface LicenseAcceptanceModalProps {
  show: boolean;
  onAccept: () => void;
  onDecline: () => void;
}

const LICENSE_TEXT = `EVERWORKER COMMERCIAL LICENSE
Version 2.0, February 2026

Copyright (c) 2025-2026 Anton Antic / Everworker AI
All Rights Reserved.

This software and associated documentation files (the "Software") are proprietary and confidential. They are NOT licensed under the MIT License that covers the parent repository's core library.

By installing, copying, or otherwise using the Software, you ("Licensee") agree to be bound by the terms of this Agreement. If you do not agree, do not install or use the Software.


1. DEFINITIONS

"Software" means the proprietary applications, tools, agents, models, configurations, documentation, and all associated files, in both source and binary form.

"Output" means any data, text, code, images, actions, commands, or other results generated, suggested, or executed by the Software, including AI-generated content and autonomous agent actions.


2. GRANT OF LICENSE

This Software is licensed, not sold. Subject to compliance with this Agreement, Everworker AI grants Licensee a limited, non-exclusive, non-transferable, non-sublicensable, revocable license to:

a) Use the Software free of charge for personal, educational, evaluation, and internal business purposes
b) Make copies of the Software for reasonable backup purposes only
c) Allow Licensee's authorized employees and contractors to use the Software, provided they are bound by terms at least as restrictive as this Agreement

Everworker AI reserves the right to introduce paid tiers or usage-based pricing in the future with reasonable advance notice. Free usage shall remain available unless explicitly discontinued with at least ninety (90) days' prior notice.


3. RESTRICTIONS

Licensee may NOT:
a) Distribute, sublicense, lease, rent, lend, or transfer the Software
b) Modify, adapt, translate, or create derivative works
c) Reverse engineer, decompile, or disassemble the Software
d) Remove or alter any proprietary notices or labels
e) Use the Software to develop competing products
f) Use the Software in violation of applicable laws


4. AI OUTPUT DISCLAIMER

THE SOFTWARE UTILIZES ARTIFICIAL INTELLIGENCE AND MAY GENERATE, SUGGEST, OR AUTONOMOUSLY EXECUTE ACTIONS. EVERWORKER AI MAKES NO WARRANTY REGARDING THE ACCURACY, COMPLETENESS, RELIABILITY, SAFETY, OR FITNESS OF ANY OUTPUT.

OUTPUT MAY CONTAIN ERRORS, HALLUCINATIONS, BIASES, OR HARMFUL CONTENT. LICENSEE IS SOLELY RESPONSIBLE FOR REVIEWING AND VALIDATING ALL OUTPUT BEFORE RELIANCE OR ACTION.

LICENSEE ACKNOWLEDGES THAT AI-POWERED AGENTS MAY PERFORM AUTONOMOUS ACTIONS INCLUDING EXECUTING CODE, MODIFYING FILES, SENDING NETWORK REQUESTS, AND CONTROLLING DESKTOP INTERFACES. LICENSEE ASSUMES ALL RISK FOR SUCH ACTIONS.


5. NO WARRANTY

THE SOFTWARE IS PROVIDED "AS IS" WITHOUT WARRANTY OF ANY KIND. EVERWORKER AI DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NONINFRINGEMENT.


6. LIMITATION OF LIABILITY

EVERWORKER AI SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, CONSEQUENTIAL, OR PUNITIVE DAMAGES. TOTAL AGGREGATE LIABILITY SHALL NOT EXCEED THE GREATER OF FEES PAID IN THE PRECEDING 12 MONTHS OR USD $100.00.


7. INDEMNIFICATION

Licensee agrees to indemnify and hold harmless Everworker AI from claims arising from Licensee's use of the Software or Output generated thereby.


This is a summary of the key terms. The full license is available at:
https://github.com/aantich/oneringai/blob/main/apps/LICENSE

For licensing inquiries: anton@everworker.ai`;

export function LicenseAcceptanceModal({
  show,
  onAccept,
  onDecline,
}: LicenseAcceptanceModalProps): React.ReactElement {
  const [hasScrolledToBottom, setHasScrolledToBottom] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Track scroll position to enable the accept checkbox
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      // Consider "scrolled to bottom" when within 30px of the end
      if (scrollTop + clientHeight >= scrollHeight - 30) {
        setHasScrolledToBottom(true);
      }
    };

    el.addEventListener('scroll', handleScroll);
    // Check immediately in case content fits without scrolling
    handleScroll();
    return () => el.removeEventListener('scroll', handleScroll);
  }, [show]);

  // Reset state when modal opens
  useEffect(() => {
    if (show) {
      setHasScrolledToBottom(false);
      setAccepted(false);
    }
  }, [show]);

  return (
    <Modal
      show={show}
      onHide={onDecline}
      size="lg"
      backdrop="static"
      keyboard={false}
      centered
      className="license-modal"
    >
      <Modal.Header>
        <Modal.Title>License Agreement</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted mb-3" style={{ fontSize: '14px' }}>
          Please read and accept the Everworker Commercial License to continue using Everworker Desktop.
        </p>
        <div
          ref={scrollRef}
          style={{
            maxHeight: '400px',
            overflowY: 'auto',
            border: '1px solid var(--bs-border-color, #dee2e6)',
            borderRadius: '6px',
            padding: '16px',
            fontFamily: 'monospace',
            fontSize: '12px',
            lineHeight: '1.6',
            whiteSpace: 'pre-wrap',
            background: 'var(--bs-body-bg, #fff)',
          }}
        >
          {LICENSE_TEXT}
        </div>

        {!hasScrolledToBottom && (
          <p className="text-muted mt-2 mb-0" style={{ fontSize: '12px', fontStyle: 'italic' }}>
            Please scroll to the bottom of the license to enable acceptance.
          </p>
        )}

        <Form.Check
          type="checkbox"
          id="license-accept-checkbox"
          className="mt-3"
          label="I have read and agree to the Everworker Commercial License"
          checked={accepted}
          disabled={!hasScrolledToBottom}
          onChange={(e) => setAccepted(e.target.checked)}
          style={{ fontSize: '14px' }}
        />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={onDecline}>
          Decline
        </Button>
        <Button
          variant="primary"
          onClick={onAccept}
          disabled={!accepted}
        >
          Accept
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
