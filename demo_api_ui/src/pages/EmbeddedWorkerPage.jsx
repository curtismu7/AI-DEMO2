// /embedded-worker — UC45, a Website Worker embedded in a third-party SaaS app.
//
// Honesty: the CRM around the panel is a SIMULATED host app (fixed sample records, nothing is read from or
// written to a real CRM). The worker is REAL: a PingOne application registered for the signed-in user by the
// BFF (GET/POST /api/embedded-worker/*), and every message goes to the BFF's /api/agent/invoke on the engine
// chosen in the toggle (Heuristics = deterministic routing, no model call; llama.cpp = the real local model).
// The CIMD registration the BFF returns is mocked (it says so: `mocked: true`), and the page shows that.
// Every route here needs a signed-in session: signed out, the page says so and does not navigate away.
//
// Layout follows the standalone Ping UI Standard (AI-DEMO-Standalone/shared/STANDALONE-UI-PATTERNS.md) through
// the shared primitives (components/pingUi, docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards,
// P5 kv, P7 chips, P9 buttons. P9 "one primary per view state":
//   - no worker yet (checking, signed out, not created, unavailable): "Create Website Worker" is the primary.
//     While it cannot act (checking, signed out, creating) it takes aria-disabled, not disabled, so focus stays,
//     and the status line beside it gives the reason.
//   - worker registered: "Send" is the primary and the Create button is gone.
// The sample-prompt buttons and the engine toggle are secondaries / a radio group, never a primary.

import { useEffect, useRef, useState } from 'react';
import PageAgentModeToggle, { usePageAgentMode } from '../components/shared/PageAgentModeToggle';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, Card, StatusChip, KvList,
} from '../components/pingUi';
import './EmbeddedWorkerPage.css';

const USE_CASE_ID = 'saas-embedded-worker';
const TABS = ['Home', 'Accounts', 'Contacts', 'Opportunities', 'Cases', 'Reports'];
// The page sends vertical 'airlines' (the use case's primary tool is redeem_miles), so the prompts are airline ones.
const SAMPLE_PROMPTS = ['What is my miles balance?', 'Redeem 500 miles for me'];

// The engine the toggle selects. This page never probes either engine, so the wording says what the choice does and
// the banner adds that reachability is not checked (true signed out, after a failure, and while it works).
const ENGINES = {
  heuristics: 'Heuristics (deterministic routing, no model call)',
  llm: 'llama.cpp (the local model)',
};

// What the panel chip says. Only a registered worker makes the panel a live BFF call; every other state is neutral or warn.
const PANEL_CHIP = {
  loading: { tone: 'neutral', word: 'Worker not confirmed' },
  signedOut: { tone: 'warn', word: 'Signed out' },
  none: { tone: 'neutral', word: 'No worker registered' },
  ready: { tone: 'info', word: 'Live BFF call' },
  unavailable: { tone: 'neutral', word: 'Worker not confirmed' },
};

// Sending is refused only when the page KNOWS there is no usable worker. While the lookup is pending or failed the
// BFF decides (it checks the registration itself), so the page does not block a worker it could not look up.
const SEND_BLOCKED_HINT = {
  signedOut: 'You are signed out. Sign in first; no message was sent.',
  none: 'Create the Website Worker first; no message was sent.',
};

const WHO_LABEL = { user: 'You', agent: 'Worker', notice: 'Needs MFA', error: 'Error' };

// What the worker lookup returned, as the page saw it. Drives the chip, the card tone and the primary button.
const LOOKUP = {
  loading: { tone: 'neutral', word: 'Checking', note: 'Checking whether you already have a Website Worker…' },
  signedOut: { tone: 'warn', word: 'Sign in required', note: 'You are signed out. Sign in, then create or use the Website Worker. This page does not sign you in.' },
  none: { tone: 'neutral', word: 'Not created', note: 'You have no Website Worker yet. Create one to register its own PingOne identity.' },
  ready: { tone: 'ok', word: 'Registered', note: 'The BFF found your Website Worker registered in PingOne.' },
  unavailable: { tone: 'warn', word: 'Unavailable', note: 'The worker lookup failed, so the page cannot tell whether a worker exists. Try again later.' },
};

// What the banner may say about the worker, by what the lookup actually returned.
const BANNER_WORKER = {
  loading: 'Whether you already have a Website Worker is still being checked.',
  signedOut: 'You are signed out, so no worker lookup or message can go through until you sign in.',
  none: 'You have no Website Worker yet; creating one asks the BFF to register a PingOne application for you.',
  ready: 'The Website Worker is real: a PingOne application the BFF found registered for you, and each message you send goes to the BFF.',
  unavailable: 'The worker lookup failed, so the page cannot tell whether a worker exists.',
};

function cimdLabel(cimd) {
  if (!cimd) return 'Not reported';
  if (cimd.mocked) return `Mocked (provenance only)${cimd.status ? `, ${cimd.status}` : ''}`;
  return cimd.status || 'Reported';
}

export default function EmbeddedWorkerPage() {
  const [agent, setAgent] = useState(null);
  const [lookup, setLookup] = useState('loading');
  const [agentMode, setAgentMode] = usePageAgentMode('embedded-worker');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const [created, setCreated] = useState(false);
  const [draft, setDraft] = useState('');
  const [hint, setHint] = useState('');
  const [messages, setMessages] = useState([]);
  const inputRef = useRef(null);
  const endRef = useRef(null);
  const nextId = useRef(1);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    fetch('/api/embedded-worker/state', { credentials: 'include' })
      .then((response) => {
        if (response.status === 401) return { signedOut: true };
        if (!response.ok) return { failed: true };
        return response.json();
      })
      .then((body) => {
        if (!alive.current) return;
        if (body?.signedOut) { setLookup('signedOut'); return; }
        if (body?.failed) { setLookup('unavailable'); return; }
        setAgent(body?.agent || null);
        setLookup(body?.agent ? 'ready' : 'none');
      })
      .catch(() => { if (alive.current) setLookup('unavailable'); });
    return () => { alive.current = false; };
  }, []);

  useEffect(() => { endRef.current?.scrollIntoView?.({ block: 'nearest' }); }, [messages]);

  const canCreate = lookup === 'none' || lookup === 'unavailable';

  function createWorker() {
    // aria-disabled keeps focus on the button, so the click is ignored here instead.
    if (creating || !canCreate) return;
    setCreating(true);
    setCreateError('');
    fetch('/api/embedded-worker/agent', { method: 'POST', credentials: 'include' })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (response.status === 401) throw new Error('You are signed out. Sign in, then create the worker.');
        if (!response.ok || !body?.agent) throw new Error(body?.message || body?.error || `The worker could not be created (${response.status}).`);
        return body;
      })
      .then((body) => {
        if (!alive.current) return;
        setAgent({ ...body.agent, cimd: body.cimd || body.agent.cimd });
        setLookup('ready');
        setCreated(true);
        setHint('');
        // The Create button leaves the page, so hand focus to the next step instead of dropping it.
        inputRef.current?.focus();
      })
      .catch((error) => { if (alive.current) setCreateError(error.message || 'The worker could not be created.'); })
      .finally(() => { if (alive.current) setCreating(false); });
  }

  function handleSend(prompt) {
    const id = nextId.current;
    nextId.current += 1;
    setMessages((previous) => [...previous, { id: `u${id}`, role: 'user', text: prompt }, { id: `t${id}`, role: 'agent', typing: true, text: '' }]);
    const settle = (message) => setMessages((previous) => previous.map((entry) => (entry.id === `t${id}` ? { ...message, id: `t${id}` } : entry)));
    fetch('/api/agent/invoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ prompt, vertical: 'airlines', useCaseId: USE_CASE_ID, agentMode }),
    })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.message || data.error || `Request failed (${response.status})`);
        return data;
      })
      .then((data) => settle({
        role: data.step_up_required ? 'notice' : 'agent',
        text: data.reply || 'The Website Worker completed the request.',
      }))
      .catch((error) => settle({ role: 'error', text: error.message || 'The Website Worker could not complete the request.' }));
  }

  function submit() {
    // aria-disabled keeps focus on Send, so the click is ignored here; the draft stays so nothing typed is lost.
    if (sendBlocked) {
      setHint(SEND_BLOCKED_HINT[lookup]);
      return;
    }
    const prompt = draft.trim();
    if (!prompt) {
      setHint('Type a message first, or pick a sample prompt.');
      inputRef.current?.focus();
      return;
    }
    setHint('');
    setDraft('');
    handleSend(prompt);
  }

  function fillPrompt(prompt) {
    setDraft(prompt);
    setHint('');
    inputRef.current?.focus();
  }

  const state = LOOKUP[lookup];
  const ready = lookup === 'ready';
  const panelChip = PANEL_CHIP[lookup];
  const sendBlocked = lookup === 'signedOut' || lookup === 'none';
  const cardTone = { ready: 'ok', signedOut: 'warn', unavailable: 'warn' }[lookup] || 'neutral';
  const createBlocked = creating || !canCreate;
  const statusText = creating
    ? 'Creating the Website Worker…'
    : createError || (created && ready ? 'Website Worker created. Ask it about this account below.' : state.note);

  return (
    <PingPage className="embedded-worker-page">
      <SimBanner data-testid="embedded-worker-banner">
        <strong>Simulated host app.</strong> The CRM around the panel is a simulation: its records are fixed sample data,
        and nothing is read from or written to a real CRM. {BANNER_WORKER[lookup]} Reply engine selected:{' '}
        {ENGINES[agentMode]}. This page does not check that the engine is reachable.
        {ready && agent?.cimd?.mocked ? ' The CIMD registration shown for the worker is mocked.' : ''} The worker may ask
        for multi-factor authentication before it acts.
      </SimBanner>
      <PageHeader
        eyebrow="SaaS-embedded agent"
        title="Website Worker"
        summary="Embedded in a third-party SaaS app, the worker acts for the signed-in user without becoming that user."
      />
      <PageFrame>
        <Section
          id="ew-identity"
          kicker="1 · Worker identity"
          title="The worker's own PingOne identity"
          lede="The worker is a separate PingOne application, not the customer. Create it once; the lookup below says what the BFF found."
        >
          <Card tone={cardTone} title="Website Worker registration" data-testid="embedded-worker-identity">
            <div className="pu-status-line">
              <StatusChip tone={state.tone}>{state.word}</StatusChip>
            </div>
            <KvList
              items={[
                { label: 'Name', value: agent?.name || 'No worker yet' },
                { label: 'PingOne application', value: agent?.id || 'None', mono: true },
                { label: 'CIMD registration', value: ready ? cimdLabel(agent?.cimd) : 'None' },
              ]}
            />
            {ready ? null : (
              <div className="pu-actions">
                <ActionButton main aria-disabled={createBlocked ? 'true' : undefined} onClick={createWorker}>
                  Create Website Worker
                </ActionButton>
              </div>
            )}
            <p className="pu-note" role="status" data-testid="embedded-worker-status">{statusText}</p>
          </Card>
        </Section>

        <Section
          id="ew-host"
          kicker="2 · Embedded in a host app"
          title="Simulated CRM, real worker panel"
          lede="Left: sample CRM data, simulated. Right: the real worker panel, wired to the BFF."
        >
          <div className="ew-crm" role="group" aria-label="Simulated CRM hosting the embedded Website Worker">
            <div className="ew-crm__global" aria-hidden="true">
              <span className="ew-crm__launcher"><i /><i /><i /><i /><i /><i /><i /><i /><i /></span>
              <span className="ew-crm__brand"><span className="ew-crm__cloud" />Sales Cloud-style CRM</span>
              <span className="ew-crm__search">Search records, accounts and cases…</span>
              <span className="ew-crm__avatar">👤</span>
            </div>
            <div className="ew-crm__tabs" aria-hidden="true">
              <span className="ew-crm__app">Sales</span>
              {TABS.map((tab) => (
                <span key={tab} className={`ew-crm__tab ${tab === 'Accounts' ? 'is-active' : ''}`}>{tab}</span>
              ))}
            </div>
            <div className="ew-crm__body">
              <Card tone="neutral" title="Northwind Traders" className="ew-crm__record" data-testid="embedded-worker-record">
                <div className="pu-status-line">
                  <StatusChip tone="neutral">Sample data</StatusChip>
                  <span>Account record in the simulated CRM</span>
                </div>
                <KvList
                  items={[
                    { label: 'Owner', value: 'Sam Rivera' },
                    { label: 'Stage', value: 'Renewal' },
                    { label: 'Open cases', value: '2' },
                    { label: 'Annual value', value: '$184,000' },
                  ]}
                />
              </Card>

              <Card tone={ready ? 'live' : 'neutral'} title="Embedded worker panel" className="ew-crm__panel" data-testid="embedded-worker-panel">
                <div className="pu-status-line">
                  <StatusChip tone={panelChip.tone}>{panelChip.word}</StatusChip>
                  <span className="ew-crm__engine">
                    <span>Reply engine</span>
                    <PageAgentModeToggle mode={agentMode} onChange={setAgentMode} />
                  </span>
                </div>
                <p className="pu-note ew-crm__delegated">
                  Delegation: the BFF checks the worker is registered, then exchanges the signed-in user&apos;s token for a
                  delegated one (RFC 8693) before any tool runs. This page never sees that token.
                </p>
                <div
                  className="ew-crm__chat"
                  role="log"
                  aria-live="polite"
                  aria-label="Conversation with the Website Worker"
                  tabIndex={0}
                  data-testid="embedded-worker-log"
                >
                  {messages.length === 0 ? (
                    <p className="pu-empty pu-note ew-crm__empty">
                      {ready ? 'No messages yet. Ask the worker about this account.' : 'No messages yet. Create the Website Worker first, then ask it about this account.'}
                    </p>
                  ) : null}
                  {messages.map((message) => (
                    <div key={message.id} className={`ew-crm__msg is-${message.role}`}>
                      <span className="ew-crm__speaker">{WHO_LABEL[message.role]}</span>
                      {message.typing ? 'Working…' : message.text}
                    </div>
                  ))}
                  <div ref={endRef} />
                </div>
                <div className="pu-actions ew-crm__samples">
                  {SAMPLE_PROMPTS.map((prompt) => (
                    <ActionButton key={prompt} onClick={() => fillPrompt(prompt)}>{prompt}</ActionButton>
                  ))}
                </div>
                <div className="ew-crm__compose">
                  <input
                    ref={inputRef}
                    type="text"
                    value={draft}
                    placeholder="Ask the agent about this account…"
                    aria-label="Message the Website Worker"
                    onChange={(event) => { setDraft(event.target.value); setHint(''); }}
                    onKeyDown={(event) => { if (event.key === 'Enter') submit(); }}
                  />
                  <ActionButton main={ready} aria-disabled={sendBlocked ? 'true' : undefined} onClick={submit}>Send</ActionButton>
                </div>
                <p className="pu-note ew-crm__hint" role="status" data-testid="embedded-worker-hint">{hint}</p>
              </Card>
            </div>
          </div>
        </Section>
      </PageFrame>
    </PingPage>
  );
}

// Declared after the page (hoisted) so the banner stays the first thing in the file. One button component, so the "which one is the primary right now" decision lives in a single `main` prop.
function ActionButton({ main = false, children, ...rest }) {
  return <button type="button" className={main ? 'pu-btn pu-btn--primary' : 'pu-btn'} {...rest}>{children}</button>;
}
