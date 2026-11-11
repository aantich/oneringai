import React, { useState } from 'react';
import { Alert, Badge, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { useChatGPTStatus } from '../../hooks/useChatGPTStatus.js';
import type { ChatGPTResult } from '../../../shared/chatgpt.js';

export function ChatGPTConnection({ onChanged, showWelcome = true }: { onChanged: () => void; showWelcome?: boolean }): React.ReactElement {
  const { status, setStatus } = useChatGPTStatus();
  const [selectedId, setSelectedId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [warning, setWarning] = useState('');
  const [welcome, setWelcome] = useState(false);
  const active = status?.accounts.find(a => a.id === status.activeId);
  const account = status?.accounts.find(a => a.id === (selectedId ?? status.activeId)) ?? (status?.activeId ? undefined : status?.accounts[0]);
  async function act(operation: () => Promise<ChatGPTResult>) {
    setBusy(true); setError(''); setWarning('');
    try {
      const result = await operation();
      if (result.status) { setStatus(result.status); if (result.success) setSelectedId(result.status.activeId ?? undefined); }
      if (!result.success) setError(result.error ?? 'ChatGPT connection failed');
      if (result.warning) setWarning(result.warning);
      if (showWelcome && result.success && result.status?.usePlan && !localStorage.getItem('hosea.chatgpt.welcome')) {
        localStorage.setItem('hosea.chatgpt.welcome', '1'); setWelcome(true);
      }
      onChanged();
    } catch { setError('Could not update the ChatGPT connection. Please try again.'); }
    finally { setBusy(false); }
  }
  return <>
    <section className="card mb-4" aria-label="ChatGPT connection">
      <div className="card__body">
        <div className="d-flex flex-wrap align-items-center gap-2 mb-2">
          <h3 className="mb-0">Use your ChatGPT plan</h3>
          {status?.usePlan && <Badge bg={active?.connected && active.planEnabled ? 'success' : 'warning'}>
            {active?.connected && active.planEnabled ? 'Using ChatGPT plan' : active?.connected ? 'Plan permission required' : 'Sign-in required'}
          </Badge>}
        </div>
        <p>Sign in once to power all OpenAI agents in Hosea with your eligible ChatGPT plan. Your conversations, tools and context stay with each agent.</p>
        <p className="text-muted small">Includes eligible model requests and local tools. Media generation, voice and embeddings require separate supported credentials. Usage shares your ChatGPT allowance.</p>
        {status?.message && <Alert variant="warning">{status.message}</Alert>}
        {status && !status.available && !status.message && <Alert variant="secondary">Sign-in requires OS-encrypted credential storage and is unavailable in design preview.</Alert>}
        {error && <Alert variant="danger">{error} <Button variant="link" onClick={() => void window.hosea.chatGPT.manageUsage()}>Manage usage</Button></Alert>}
        {warning && <Alert variant="warning">{warning}</Alert>}
        {!!status?.accounts.length && <Form.Group className="mb-3">
          <Form.Label>Shared ChatGPT account</Form.Label>
          <Form.Select aria-label="Shared ChatGPT account" value={account?.id ?? ''} disabled={busy}
            onChange={event => { const id = event.target.value; setSelectedId(id); const selected = status.accounts.find(a => a.id === id); if (selected?.connected && selected.planEnabled) void act(() => window.hosea.chatGPT.select(id)); }}>
            {!status.activeId && <option value="" disabled>Select an account</option>}
            {status.accounts.map(a => <option key={a.id} value={a.id}>{a.label}{!a.connected ? ' — reconnect required' : !a.planEnabled ? ' — plan usage disabled' : ''}</option>)}
          </Form.Select>
        </Form.Group>}
        {status?.usePlan && active && account?.id !== active.id && <p className="small text-muted">Agents keep their current connection ({active.label}) until this account is connected.</p>}
        <div className="d-flex flex-wrap gap-2">
          <Button variant="dark" disabled={busy || !status?.available} onClick={() => void act(() => window.hosea.chatGPT.signIn(account?.id, !!account && !account.planEnabled))}>
            {busy && <Spinner size="sm" className="me-2"/>}{account?.connected && account.planEnabled ? 'Reconnect ChatGPT' : 'Continue with ChatGPT'}
          </Button>
          {!!status?.accounts.length && <Button variant="outline-secondary" disabled={busy || !status.available} onClick={() => void act(() => window.hosea.chatGPT.signIn())}>Add account</Button>}
          {account?.connected && <Button variant="outline-secondary" disabled={busy} onClick={() => void act(() => window.hosea.chatGPT.signOut(account.id))}>Sign out</Button>}
          {status?.usePlan && <Button variant="outline-secondary" disabled={busy} onClick={() => void act(() => window.hosea.chatGPT.useAPIKeys())}>Use configured API keys</Button>}
          <Button variant="link" onClick={() => void window.hosea.chatGPT.manageUsage()}>Manage usage</Button>
          {busy && <Button variant="link" onClick={() => void window.hosea.chatGPT.cancel()}>Cancel sign-in</Button>}
        </div>
      </div>
    </section>
    <Modal show={welcome} onHide={() => setWelcome(false)} centered>
      <Modal.Header closeButton><Modal.Title>You’re using your ChatGPT plan</Modal.Title></Modal.Header>
      <Modal.Body>Eligible AI requests from all OpenAI agents in Hosea now use your selected ChatGPT account. Review app usage and limits in ChatGPT Settings → Usage. Hosea will ask you to choose another billing method if this connection becomes unavailable.</Modal.Body>
      <Modal.Footer><Button onClick={() => setWelcome(false)}>Got it</Button></Modal.Footer>
    </Modal>
  </>;
}
