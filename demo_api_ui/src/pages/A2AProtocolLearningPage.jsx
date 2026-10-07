// demo_api_ui/src/pages/A2AProtocolLearningPage.jsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SignInPrompt from '../components/SignInPrompt';
import { useThemeOptional } from '../context/ThemeContext';
import { buildA2aChainDetail } from '../utils/a2aChainDetail';
import { A2A_RECORDED_RUN } from '../data/a2aRecordedRun';
import A2AFlowVisualizer from '../components/A2AFlowVisualizer';
import RelatedLearningRail from '../components/learning/RelatedLearningRail';
import { EDU } from '../components/education/educationIds';
import { RUN_PROVENANCE } from '../config/agentTerminology';
import {
  fetchA2aSpecialistRegistry,
  specialistOptionLabel,
} from '../services/a2aSpecialistRegistry';
import {
  buildA2aTeachingPanes,
  summarizeAgentCard,
  summarizeActChain,
  LAYER,
} from './a2aTeachingPanes';
import {
  A2A_IMPLEMENTATION_STATUS,
  A2A_LATEST_LESSONS,
  A2A_STEP_EXPLANATIONS,
  A2A_TRAINING_REFERENCES,
} from './a2aLearningLessons';
import {
  A2A_SECTION_IDS,
  persistFoldedSections,
  readFoldedSections,
} from '../utils/a2aSectionFold';
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

const A2A_EDUCATION_LINKS = [
  {
    panelId: EDU.A2A_DELEGATION,
    tabId: 'what',
    label: 'A2A delegation',
    detail: 'Connect nested act claims, protocol messages, and policy.',
    ariaLabel: 'Open A2A delegation in Education Hub',
  },
  {
    panelId: EDU.TOKEN_FLOW,
    tabId: 'act-chain',
    label: 'Nested token flow',
    detail: 'Follow scope narrowing and actor depth across both agents.',
    ariaLabel: 'Open nested token flow in Education Hub',
  },
  {
    panelId: EDU.PINGONE_AUTHORIZE,
    tabId: 'policy-mcp',
    label: 'Authorize policy',
    detail: 'Inspect the decision over user and agent-chain context.',
    ariaLabel: 'Open A2A authorization policy in Education Hub',
  },
];

const A2A_APP_LINKS = [
  {
    to: '/delegation-chain-value',
    label: 'Delegation Chain Value',
    detail: 'Use the short business-value explanation for the same chain.',
    ariaLabel: 'Open Delegation Chain Value',
  },
  {
    to: '/ai-products/privilege-a2a',
    label: 'Privilege for AI — A2A',
    detail: 'Connect this implementation to the Ping product story.',
    ariaLabel: 'Open Privilege for AI A2A',
  },
  {
    to: '/transaction-trace',
    label: 'Transaction trace',
    detail: 'Review the exchange, decision, and tool evidence together.',
    ariaLabel: 'Open the A2A transaction trace',
  },
];

const A2A_EXTERNAL_LINKS = [
  {
    href: 'https://a2a-protocol.org/latest/specification/',
    label: 'A2A specification',
    detail: 'The current Agent2Agent protocol specification.',
    ariaLabel: 'Read the A2A specification',
  },
  {
    href: 'https://a2a-protocol.org/latest/tutorials/',
    label: 'A2A tutorials',
    detail: 'Official hands-on clients, servers, and multi-agent examples.',
    ariaLabel: 'Open the official A2A tutorials',
  },
  {
    href: 'https://www.rfc-editor.org/rfc/rfc8693',
    label: 'RFC 8693',
    detail: 'The token-exchange standard behind delegated identity.',
    ariaLabel: 'Read RFC 8693 for A2A delegation',
  },
];

function Json({ value }) {
  return <pre className="a2l-json">{JSON.stringify(value, null, 2)}</pre>;
}

function ProvenanceChip({ provenance }) {
  const label = provenance === 'live'
    ? RUN_PROVENANCE.live
    : provenance === 'mock'
      ? RUN_PROVENANCE.mock
      : RUN_PROVENANCE.recorded;
  return <span className={`a2l-prov a2l-prov--${provenance}`}>{label}</span>;
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

// The page owns which sections are folded (and remembers it); Section reads it.
const SectionFoldContext = createContext(null);

function Section({ id, num, title, lead, children }) {
  const fold = useContext(SectionFoldContext);
  return (
    <details
      className="a2l-section"
      id={id}
      open={fold ? !fold.folded.includes(id) : true}
      onToggle={fold ? (e) => fold.setSectionOpen(id, e.currentTarget.open) : undefined}
    >
      <summary className="a2l-summary">
        <h2 className="a2l-h2"><span className="a2l-num">{num}</span>{title}</h2>
      </summary>
      {lead && <p className="a2l-lead">{lead}</p>}
      {children}
    </details>
  );
}

export default function A2AProtocolLearningPage() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  const [vertical, setVertical] = useState(DEFAULT_VERTICAL);
  const [specialists, setSpecialists] = useState([]);
  const [folded, setFolded] = useState(readFoldedSections);
  useEffect(() => persistFoldedSections(folded), [folded]);
  const foldValue = useMemo(
    () => ({
      folded,
      setSectionOpen: (id, open) =>
        setFolded((prev) => {
          if (open !== prev.includes(id)) return prev;
          return open ? prev.filter((x) => x !== id) : [...prev, id];
        }),
    }),
    [folded],
  );

  const [card, setCard] = useState(null);
  const [cardLive, setCardLive] = useState(false);
  const [cardError, setCardError] = useState(null);

  const [probe, setProbe] = useState(null);

  const [run, setRun] = useState(null);
  const [running, setRunning] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);
  const [runError, setRunError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    fetchA2aSpecialistRegistry()
      .then((entries) => { if (!cancelled) setSpecialists(entries); })
      .catch(() => { if (!cancelled) setSpecialists([]); });
    return () => { cancelled = true; };
  }, []);

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

  // Keep the page usable while the public directory is unavailable. The
  // recorded card is evidence fallback, not a second specialist catalog.
  const specialistOptions = specialists.length > 0
    ? specialists
    : [{
        vertical: DEFAULT_VERTICAL,
        specialistName: A2A_RECORDED_RUN.agentCard?.name || 'Specialist agent',
        appName: A2A_RECORDED_RUN.agentCard?.name || 'Specialist agent',
      }];

  const identityPanes = panes.filter((p) => p.layer === LAYER.IDENTITY);
  const widePanes = panes.filter((p) => p.layer === LAYER.WIRE);
  const replayNote = isReplay
    ? `${RUN_PROVENANCE.recorded} · captured ${A2A_RECORDED_RUN.capturedAt} · ${A2A_RECORDED_RUN.vertical}`
    : null;

  return (
    <SectionFoldContext.Provider value={foldValue}>
    <div className="a2l-page">
      <header className="a2l-header">
        <button
          type="button"
          onClick={toggleDarkMode}
          className="a2l-theme-toggle"
          title="Switch this page between light and dark"
          aria-pressed={darkMode}
        >
          {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
        </button>
        <h1 className="a2l-h1">Agent-to-Agent (A2A), end to end</h1>
        <p className="a2l-sub">
          One generalist agent hands work to a specialist. This page shows the real
          artifacts at every hop — the tokens, the Agent Card, and the JSON-RPC call —
          using this demo&apos;s own agent.
        </p>
        <label className="a2l-vertical">
          <span>Specialist agent</span>
          <select value={vertical} onChange={(e) => setVertical(e.target.value)}>
            {specialistOptions.map((specialist) => (
              <option key={specialist.vertical} value={specialist.vertical}>
                {specialistOptionLabel(specialist)}
              </option>
            ))}
          </select>
        </label>
        <div className="a2l-foldbar">
          <button type="button" className="a2l-btn" onClick={() => setFolded([])}>Expand all</button>
          <button type="button" className="a2l-btn" onClick={() => setFolded(A2A_SECTION_IDS)}>Collapse all</button>
        </div>
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
              Agent identity and delegated authority answer who is acting for whom.{' '}
              PingOne mints a token whose <code>act</code> claim
              nests: the specialist acting for the generalist acting for the user. Scope
              narrows at each hop. This is what PingOne Authorize decides over.
            </p>
            <p>
              Agent identity, Agent runtime, and delegated authority are separate: a runtime
              can execute the flow, but only the token chain and PingOne Authorize establish
              what the call may do.
            </p>
            <p className="a2l-meta">Layer 1 · <code>a2aDelegationService</code></p>
          </div>
          <div className="a2l-layer">
            <h3>Wire protocol — Linux Foundation A2A</h3>
            <p>
              How the two agents talk. An Agent Card advertises the specialist&apos;s
              skills and protocol metadata; a JSON-RPC <code>message/send</code> carries the task.
              Agent Cards describe capability and protocol metadata; they do not grant authority.
              The handoff uses an HTTP bearer credential. In this demo it is the user-bound
              Exchange #1 token, which already carries <code>act: generalist</code> — not the
              Exchange #2 downstream tool token.
            </p>
            <p className="a2l-meta">Layer 2 · <code>@a2a-js/sdk</code> · <code>/a2a/specialists</code></p>
          </div>
        </div>
        <p className="a2l-links">
          Deeper on the concept: <Link to="/delegation-chain-value">Delegation Chain Value</Link>
          {' · '}
          <a href="https://a2a-protocol.org/latest/" target="_blank" rel="noreferrer">A2A learning hub</a>
          {' · '}
          <a href="https://a2a-protocol.org/latest/specification/" target="_blank" rel="noreferrer">A2A spec</a>
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
            <li>
              <b>Skills</b>
              {cardSummary.skillDetails?.length ? (
                <ul className="a2l-skills">
                  {cardSummary.skillDetails.map((skill) => (
                    <li key={skill.id}>
                      <span className="a2l-skill-name">{skill.name}</span>{' '}
                      <code className="a2l-meta">{skill.id}</code>
                      {skill.description && <span className="a2l-skill-text">{skill.description}</span>}
                      {skill.examples.length > 0 && (
                        <span className="a2l-skill-text">Example: {skill.examples.join('; ')}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                cardSummary.skills.join(', ') || '—'
              )}
            </li>
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
          <A2AFlowVisualizer
            tokenEvents={events}
            labels={{
              generalist: detail.generalist || 'Generalist Agent',
              specialist: detail.specialist || 'Specialist',
            }}
          />
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

      <Section
        id="latest-guidance"
        num="8"
        title="What the current A2A guidance adds"
        lead="This demo proves a secure one-shot handoff. The current protocol guidance gives us the next lessons—and a clear boundary around what is implemented today."
      >
        <div className="a2l-lesson-grid">
          {A2A_LATEST_LESSONS.map((lesson) => (
            <article className="a2l-lesson" key={lesson.id}>
              <h3>{lesson.title}</h3>
              <p>{lesson.body}</p>
              <a href={lesson.href} target="_blank" rel="noreferrer">Read the official lesson</a>
            </article>
          ))}
        </div>
        <div className="a2l-status-block">
          <h3>Follow the delegation step by step</h3>
          <p>
            The live token-chain events on this page are PingOne-backed. PingFederate also supports
            RFC 8693 token exchange, but it must be configured on the PF authorization server and
            the exchanging OAuth clients. A successful browser login and a working agent-token
            exchange are separate checks; this walkthrough does not claim that its live chain ran on PF.
          </p>
          <div className="a2l-lesson-grid">
            {A2A_STEP_EXPLANATIONS.map((step) => (
              <article className="a2l-lesson" key={step.id}>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
                <p className="a2l-links">
                  Sources:{' '}
                  {step.references.map((id, index) => {
                    const reference = A2A_TRAINING_REFERENCES[id];
                    return (
                      <React.Fragment key={id}>
                        {index > 0 && ' · '}
                        <a href={reference.href} target="_blank" rel="noopener noreferrer">
                          {reference.label}
                        </a>
                      </React.Fragment>
                    );
                  })}
                </p>
              </article>
            ))}
          </div>
        </div>
        <div className="a2l-status-block">
          <h3>Implementation status</h3>
          <ul className="a2l-status-list">
            {A2A_IMPLEMENTATION_STATUS.map((item) => (
              <li key={item.id}>
                <span className={`a2l-status-state a2l-status-state--${item.state}`}>{item.state}</span>
                <span><b>{item.label}</b> — {item.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      <RelatedLearningRail
        id="a2a-protocol"
        educationLinks={A2A_EDUCATION_LINKS}
        appLinks={A2A_APP_LINKS}
        externalLinks={A2A_EXTERNAL_LINKS}
      />
    </div>
    </SectionFoldContext.Provider>
  );
}
