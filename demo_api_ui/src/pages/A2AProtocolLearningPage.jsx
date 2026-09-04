// demo_api_ui/src/pages/A2AProtocolLearningPage.jsx
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SignInPrompt from '../components/SignInPrompt';
import ThemeToggle from '../components/common/ThemeToggle';
import { buildA2aChainDetail } from '../utils/a2aChainDetail';
import { A2A_RECORDED_RUN } from '../data/a2aRecordedRun';
import {
  buildA2aTeachingPanes,
  summarizeAgentCard,
  summarizeActChain,
  LAYER,
} from './a2aTeachingPanes';
import './A2AProtocolLearningPage.css';

/**
 * A2A walkthrough — the concept, a real run, and the actual artifacts.
 *
 * Raw `fetch` rather than apiClient on purpose (same as IntentBindingLearningPage):
 * a 401 here is an EXPECTED state we render inline as a sign-in prompt, and
 * apiClient would raise the global session-expired banner over the page.
 *
 * Everything is fetched SAME-ORIGIN. /a2a/ is proxied by vite.config.js and
 * nginx.conf for exactly this page — without those the card request is answered
 * with the SPA's own index.html, so a 200 is not enough: we require a JSON
 * content-type before believing it.
 */

const DEFAULT_VERTICAL = 'sporting-goods';

/** Verticals that have an A2A specialist. Mirrors config/a2aSpecialists.js. */
const A2A_VERTICALS = [
  ['sporting-goods', 'Super Sports · Membership Specialist'],
  ['banking', 'Super Banking · Investment Advisor'],
  ['healthcare', 'Healthcare · Records Specialist'],
  ['retail', 'Retail · Purchase History Specialist'],
  ['workforce', 'Workforce · Payroll Specialist'],
  ['government', 'Government · Tax Records Specialist'],
  ['university', 'University · Financial Aid Specialist'],
  ['manufacturing', 'Manufacturing · Supplier Contract Specialist'],
  ['investment', 'Investment · Holdings Specialist'],
  ['airlines', 'Airlines · Passenger Records Specialist'],
];

function Json({ value }) {
  return <pre className="a2l-json">{JSON.stringify(value, null, 2)}</pre>;
}

function ProvenanceChip({ provenance }) {
  return <span className={`a2l-prov a2l-prov--${provenance}`}>{provenance}</span>;
}

function Pane({ pane }) {
  return (
    <div className={`a2l-pane${pane.failed ? ' a2l-pane--failed' : ''}`}>
      <div className="a2l-pane-head">
        <span className="a2l-pane-title">{pane.title}</span>
        <ProvenanceChip provenance={pane.provenance} />
      </div>
      <p className="a2l-pane-caption">{pane.caption}</p>
      {pane.note && <p className="a2l-pane-note">{pane.note}</p>}
      {pane.cardUrl && <p className="a2l-pane-url"><code>{pane.cardUrl}</code></p>}
      <Json value={pane.body} />
    </div>
  );
}

function Section({ id, num, title, lead, children }) {
  return (
    <section className="a2l-section" id={id}>
      <h2 className="a2l-h2"><span className="a2l-num">{num}</span>{title}</h2>
      {lead && <p className="a2l-lead">{lead}</p>}
      {children}
    </section>
  );
}

export default function A2AProtocolLearningPage() {
  const [vertical, setVertical] = useState(DEFAULT_VERTICAL);

  const [card, setCard] = useState(null);
  const [cardLive, setCardLive] = useState(false);
  const [cardError, setCardError] = useState(null);

  const [probe, setProbe] = useState(null);

  const [run, setRun] = useState(null);
  const [running, setRunning] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [runError, setRunError] = useState(null);

  // ── Section 2: the Agent Card, live and unauthenticated ────────────────────
  useEffect(() => {
    let cancelled = false;
    setCard(null); setCardLive(false); setCardError(null);
    (async () => {
      try {
        const res = await fetch(
          `/a2a/specialists/${encodeURIComponent(vertical)}/.well-known/agent-card.json`,
          { credentials: 'omit', headers: { Accept: 'application/json' } },
        );
        // A 200 is NOT enough. Without the /a2a/ proxy this request is answered
        // by the SPA shell with 200 text/html, and a naive res.ok would render a
        // "live" chip over an HTML body.
        const ct = res.headers.get('content-type') || '';
        if (!res.ok || !ct.includes('json')) {
          throw new Error(`${res.status} ${ct || 'no content-type'}`);
        }
        const json = await res.json();
        if (cancelled) return;
        setCard(json); setCardLive(true);
      } catch (err) {
        if (cancelled) return;
        setCardError(err.message);
        // Fall back to the recorded card so the section still teaches.
        setCard(vertical === A2A_RECORDED_RUN.vertical ? A2A_RECORDED_RUN.agentCard : null);
        setCardLive(false);
      }
    })();
    return () => { cancelled = true; };
  }, [vertical]);

  // ── Section 3: prove the wire hop is gated ─────────────────────────────────
  const probeWithoutBearer = useCallback(async () => {
    setProbe({ pending: true });
    try {
      const res = await fetch(`/a2a/specialists/${encodeURIComponent(vertical)}`, {
        method: 'POST',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json', 'A2A-Version': '1.0' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: '1', method: 'message/send',
          params: { message: { role: 'user', parts: [{ kind: 'text', text: 'hello' }], messageId: 'probe' } },
        }),
      });
      let body;
      try { body = await res.json(); } catch { body = { note: 'non-JSON response' }; }
      setProbe({ status: res.status, body });
    } catch (err) {
      setProbe({ error: err.message });
    }
  }, [vertical]);

  // ── Sections 4-6: the delegation itself ────────────────────────────────────
  const runDelegation = useCallback(async () => {
    setRunning(true); setRunError(null); setNeedsAuth(false);
    try {
      await fetch('/api/a2a/init', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const res = await fetch('/api/a2a/message', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: A2A_RECORDED_RUN.message, vertical }),
      });
      if (res.status === 401) { setNeedsAuth(true); return; }
      const data = await res.json();
      // The failure paths still return tokenEvents — render what we got rather
      // than blanking, a partial chain is the most instructive thing there is.
      setRun(data);
      if (!data?.tokenEvents?.length) {
        setRunError(data?.delegationDecision?.reason || data?.error || 'No token events returned');
      }
    } catch (err) {
      setRunError(err.message);
    } finally {
      setRunning(false);
    }
  }, [vertical]);

  // Live run when we have one, the recorded run otherwise.
  const isReplay = !run?.tokenEvents?.length;
  const events = isReplay ? A2A_RECORDED_RUN.tokenEvents : run.tokenEvents;
  const detail = useMemo(() => buildA2aChainDetail(events), [events]);
  const panes = useMemo(() => buildA2aTeachingPanes(detail), [detail]);
  const actChain = useMemo(() => summarizeActChain(detail), [detail]);
  const cardSummary = useMemo(() => summarizeAgentCard(card), [card]);

  const identityPanes = panes.filter((p) => p.layer === LAYER.IDENTITY);
  const widePanes = panes.filter((p) => p.layer === LAYER.WIRE);
  const replayNote = isReplay
    ? `Recorded run · captured ${A2A_RECORDED_RUN.capturedAt} · ${A2A_RECORDED_RUN.vertical}`
    : null;

  return (
    <div className="a2l-page">
      <header className="a2l-header">
        <div className="a2l-header-row">
          <h1 className="a2l-h1">Agent-to-Agent (A2A), end to end</h1>
          <ThemeToggle />
        </div>
        <p className="a2l-sub">
          One generalist agent hands work to a specialist. This page shows the real
          artifacts at every hop — the tokens, the Agent Card, and the JSON-RPC call —
          using this demo&apos;s own agent.
        </p>
        <label className="a2l-vertical">
          <span>Specialist</span>
          <select value={vertical} onChange={(e) => setVertical(e.target.value)}>
            {A2A_VERTICALS.map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>
      </header>

      <Section
        id="layers"
        num="1"
        title="Two different things are called &ldquo;A2A&rdquo;"
        lead="Keeping these apart is most of the battle. This demo runs both, and they authenticate differently."
      >
        <div className="a2l-layers">
          <div className="a2l-layer">
            <h3>Identity — RFC 8693 delegation</h3>
            <p>
              Who is acting for whom. PingOne mints a token whose <code>act</code> claim
              nests: the specialist acting for the generalist acting for the user. Scope
              narrows at each hop. This is what PingOne Authorize decides over.
            </p>
            <p className="a2l-meta">Layer 1 · <code>a2aDelegationService</code></p>
          </div>
          <div className="a2l-layer">
            <h3>Wire protocol — Linux Foundation A2A</h3>
            <p>
              How the two agents talk. An Agent Card advertises the specialist&apos;s
              skills; a JSON-RPC <code>message/send</code> carries the task. It
              authenticates with its <strong>own</strong> PingOne bearer — not the
              nested-<code>act</code> token.
            </p>
            <p className="a2l-meta">Layer 2 · <code>@a2a-js/sdk</code> · <code>/a2a/specialists</code></p>
          </div>
        </div>
        <p className="a2l-links">
          Deeper on the concept: <Link to="/delegation-chain-value">Delegation Chain Value</Link>
          {' · '}
          <a href="https://a2a-protocol.org/v1.0.0/specification/" target="_blank" rel="noreferrer">A2A spec</a>
          {' · '}
          <a href="https://datatracker.ietf.org/doc/html/rfc8693" target="_blank" rel="noreferrer">RFC 8693</a>
        </p>
      </Section>

      <Section
        id="card"
        num="2"
        title="Layer 2 — discovery: the Agent Card"
        lead="Public by design. Your browser just fetched this, unauthenticated, from the running BFF."
      >
        <p className="a2l-status">
          {cardLive
            ? <span className="a2l-prov a2l-prov--live-http">live</span>
            : <span className="a2l-prov a2l-prov--replay">recorded</span>}
          {' '}
          <code>GET /a2a/specialists/{vertical}/.well-known/agent-card.json</code>
          {cardError && <span className="a2l-err"> — live fetch failed: {cardError}</span>}
        </p>
        {cardSummary && (
          <ul className="a2l-facts">
            <li><b>Agent</b> {cardSummary.name} <span className="a2l-meta">v{cardSummary.version}</span></li>
            <li><b>Skills</b> {cardSummary.skills.join(', ') || '—'}</li>
            <li><b>Security</b> {cardSummary.securitySchemes.join(', ') || '—'}</li>
            <li><b>Binding</b> {cardSummary.protocolBinding} {cardSummary.protocolVersion}</li>
          </ul>
        )}
        {card ? <Json value={card} /> : <p className="a2l-empty">No A2A specialist is configured for this vertical.</p>}
      </Section>

      <Section
        id="gate"
        num="3"
        title="Layer 2 — the bearer gate, proven"
        lead="The card is public. The endpoint it advertises is not. Send a JSON-RPC call with no Authorization header and watch it refuse."
      >
        <button type="button" className="a2l-btn" onClick={probeWithoutBearer}>
          Send without a bearer
        </button>
        {probe?.pending && <p className="a2l-status">Sending…</p>}
        {probe?.status && (
          <div className="a2l-pane">
            <div className="a2l-pane-head">
              <span className="a2l-pane-title">POST /a2a/specialists/{vertical} — no Authorization header</span>
              <span className="a2l-prov a2l-prov--live-http">live-http</span>
            </div>
            <p className="a2l-pane-caption">
              A real HTTP request, made from your browser just now. HTTP {probe.status}.
            </p>
            <Json value={probe.body} />
          </div>
        )}
        {probe?.error && <p className="a2l-err">Probe failed: {probe.error}</p>}
      </Section>

      <Section
        id="run"
        num="4"
        title="Layer 1 — run the delegation"
        lead="Minting real PingOne tokens on your behalf needs a signed-in session. Signed out, everything below is a recorded run of exactly this flow."
      >
        <div className="a2l-runbar">
          <button type="button" className="a2l-btn a2l-btn--primary" onClick={runDelegation} disabled={running}>
            {running ? 'Running…' : 'Run the delegation'}
          </button>
          {replayNote && <span className="a2l-prov a2l-prov--replay">{replayNote}</span>}
          {!isReplay && <span className="a2l-prov a2l-prov--live-http">live run</span>}
        </div>
        {needsAuth && (
          <SignInPrompt
            variant="strip"
            message="Running the delegation mints real PingOne tokens, so it needs a signed-in session. The recorded run below shows the same flow."
          />
        )}
        {runError && <p className="a2l-err">{runError}</p>}
        {detail.present && (
          <pre className="a2l-diagram">{detail.diagramLines.join('\n')}</pre>
        )}
      </Section>

      <Section
        id="identity"
        num="5"
        title="Layer 1 — the token chain, hop by hop"
        lead="Two client_credentials tokens and two RFC 8693 exchanges. Read the scope shrink and the act nesting."
      >
        {actChain && (
          <ul className="a2l-facts">
            <li><b>act depth</b> {actChain.depth} <span className="a2l-meta">what Authorize sees as ActChainDepth</span></li>
            <li><b>specialist</b> <code>{actChain.specialist || '—'}</code></li>
            <li><b>acting for</b> <code>{actChain.generalist || '—'}</code></li>
            <li><b>scope at the specialist</b> <code>{actChain.scope || '—'}</code></li>
            <li><b>tool</b> <code>{actChain.tool || '—'}</code></li>
          </ul>
        )}
        {identityPanes.map((p) => <Pane key={p.key} pane={p} />)}
      </Section>

      <Section
        id="wire"
        num="6"
        title="Layer 2 — the handoff on the wire"
        lead="A separate bearer, the card that was discovered, and the JSON-RPC message itself."
      >
        {widePanes.length
          ? widePanes.map((p) => <Pane key={p.key} pane={p} />)
          : <p className="a2l-empty">This run has no wire-protocol events.</p>}
      </Section>

      <Section id="caveats" num="7" title="What this page is not">
        <ul className="a2l-caveats">
          <li>
            The exchange <b>request</b> panes are reconstructed parameter summaries, not
            captured HTTP bodies. Token values are deliberately omitted —
            <code>has_actor_token: true</code> stands in for them.
          </li>
          <li>
            The exchange <b>response</b> panes are decoded JWT claims. Raw tokens never
            leave the BFF, so there is no body to show.
          </li>
          <li>
            The wire hop runs <b>in-process</b> by default, so no HTTP crosses the wire
            unless <code>A2A_PROTOCOL_HTTP=1</code>. Each pane says which happened.
          </li>
          <li>
            Sections 2 and 3 <b>are</b> real HTTP, made from your browser, and are marked
            <code>live-http</code>.
          </li>
        </ul>
      </Section>
    </div>
  );
}
