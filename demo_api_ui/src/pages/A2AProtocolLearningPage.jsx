// demo_api_ui/src/pages/A2AProtocolLearningPage.jsx
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import SignInPrompt from '../components/SignInPrompt';
import { useThemeOptional } from '../context/ThemeContext';
import { buildA2aChainDetail } from '../utils/a2aChainDetail';
import { A2A_RECORDED_RUN } from '../data/a2aRecordedRun';
import A2AFlowVisualizer from '../components/A2AFlowVisualizer';
import A2aStageTimings from '../components/A2aStageTimings';
import A2aDocsLinks from '../components/shared/A2aDocsLinks';
import RelatedLearningRail from '../components/learning/RelatedLearningRail';
import { EDU } from '../components/education/educationIds';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, CardGrid, Card, StatusChip, KvList,
} from '../components/pingUi';
import {
  fetchA2aSpecialistRegistry,
  specialistOptionLabel,
} from '../services/a2aSpecialistRegistry';
import {
  buildA2aTeachingPanes,
  summarizeAgentCard,
  summarizeActChain,
  LAYER,
  PROVENANCE,
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
import PageAgentModeToggle, { usePageAgentMode } from '../components/shared/PageAgentModeToggle';
import './A2AProtocolLearningPage.css';

/**
 * A2A walkthrough — the concept, a real run, and the actual artifacts.
 *
 * Layout follows the Ping UI Standard through the shared primitives (components/pingUi,
 * docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv, P7 chips, P9 buttons.
 * P9 "one primary per view": "Run the delegation" (section 4) is the primary in every state. Everything
 * else is a secondary: the no-bearer probe, Expand/Collapse all, the theme toggle and the diagram's step
 * buttons. The sign-in strip that appears after a 401 is the shared SignInPrompt (its own navy fill, not
 * Ping Red), so "Run the delegation" stays the only primary then too.
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

// What a pane IS, in words. A pane built from a recorded run says so: "Recorded" is never green, and a
// live-http pane inside a recorded run was not made by this browser.
const PANE_KIND = {
  [PROVENANCE.RECONSTRUCTED]: 'Reconstructed',
  [PROVENANCE.DECODED]: 'Decoded claims',
  [PROVENANCE.LIVE]: 'HTTP on the wire',
  [PROVENANCE.IN_PROCESS]: 'In-process',
};

function paneChipWord(provenance, recorded) {
  const kind = PANE_KIND[provenance] || 'Evidence';
  return recorded ? `Recorded · ${kind}` : kind;
}

// The shared pane caption says "made from your browser just now" for live-http panes. In a run that came
// from the BFF (or a recording of one) that is not true, so the page restates it.
function paneCaption(pane, recorded) {
  if (pane.provenance !== PROVENANCE.LIVE) return pane.caption;
  return recorded
    ? 'A recorded copy of an HTTP exchange captured with this run. Your browser did not send it.'
    : 'An HTTP exchange made by the BFF during this run. Your browser did not send it.';
}

// The page owns which sections are folded (and remembers it); FoldSection reads it.
const SectionFoldContext = createContext(null);

// Each section is a native <details> (P3 section: heading + lede). The heading names the landmark.
function FoldSection({ id, num, title, lead, children }) {
  const fold = useContext(SectionFoldContext);
  const headId = `${id}-h`;
  return (
    <details
      className="a2l-section"
      id={id}
      aria-labelledby={headId}
      open={fold ? !fold.folded.includes(id) : true}
      onToggle={fold ? (e) => fold.setSectionOpen(id, e.currentTarget.open) : undefined}
    >
      <summary className="a2l-summary">
        <h2 id={headId} className="pu-h2 a2l-h2"><span className="a2l-num">{num}</span>{title}</h2>
      </summary>
      {lead && <p className="pu-lede">{lead}</p>}
      {children}
    </details>
  );
}

const STATE_CHIPS = {
  supported: { tone: 'neutral', word: 'Supported' },
  next: { tone: 'info', word: 'Next' },
};

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

  // Each step keeps its own result: the probe and the run never share state.
  const [probe, setProbe] = useState(null);

  const [run, setRun] = useState(null);
  const [runVertical, setRunVertical] = useState(null);
  const [running, setRunning] = useState(false);
  const [agentMode, setAgentMode] = usePageAgentMode('a2a-protocol-learning');
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
    if (probe?.pending) return; // aria-disabled keeps focus on the button; the click is ignored
    setProbe({ pending: true, vertical });
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
      setProbe({ status: res.status, body, vertical });
    } catch (err) {
      setProbe({ error: err.message, vertical });
    }
  }, [vertical, probe]);

  // ── Sections 4-6: the delegation itself ────────────────────────────────────
  const runDelegation = useCallback(async () => {
    if (running) return; // aria-disabled keeps focus on the button; the click is ignored
    setRunning(true); setRunError(null); setNeedsAuth(false);
    try {
      await fetch('/api/a2a/init', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      const res = await fetch('/api/a2a/message', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: A2A_RECORDED_RUN.message, vertical, mode: agentMode }),
      });
      if (res.status === 401) { setNeedsAuth(true); return; }
      const data = await res.json();
      // The failure paths still return tokenEvents — render what we got rather
      // than blanking, a partial chain is the most instructive thing there is.
      setRun(data);
      setRunVertical(vertical);
      if (!data?.tokenEvents?.length) {
        setRunError(data?.delegationDecision?.reason || data?.error || 'No token events returned');
      }
    } catch (err) {
      setRunError(err.message);
    } finally {
      setRunning(false);
    }
  }, [vertical, agentMode, running]);

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
  const recordedLine = `captured ${A2A_RECORDED_RUN.capturedAt} for ${A2A_RECORDED_RUN.vertical}`;

  // The Agent Card status comes from what the page actually checked: the fetch returned JSON, or it did not.
  const cardPending = !cardLive && !cardError && !card;
  let cardStatus;
  if (cardLive) {
    cardStatus = { tone: 'ok', word: 'Live fetch', text: 'Your browser fetched this card unauthenticated from the running BFF.' };
  } else if (cardPending) {
    cardStatus = { tone: 'neutral', word: 'Fetching', text: 'Asking the BFF for the card.' };
  } else if (card) {
    cardStatus = { tone: 'neutral', word: 'Recorded copy', text: `The live fetch failed (${cardError}), so this is the card recorded with the sample run, not one fetched now.` };
  } else {
    cardStatus = { tone: 'warn', word: 'Unavailable', text: `The live fetch failed (${cardError}) and there is no recorded card for this vertical.` };
  }

  const runChip = running
    ? { tone: 'neutral', word: 'Running', text: 'Waiting for the BFF to answer.' }
    : isReplay
      ? { tone: 'neutral', word: 'Recorded run', text: `Sections 5 and 6 show a run ${recordedLine}. It is not your run.` }
      : { tone: 'info', word: 'Live run', text: `Sections 5 and 6 show the run this app's BFF returned just now for ${runVertical || vertical}.` };

  let probeStatus = null;
  if (probe?.pending) probeStatus = { tone: 'neutral', word: 'Sending', text: 'Posting a JSON-RPC call with no Authorization header.' };
  else if (probe?.error) probeStatus = { tone: 'warn', word: 'No answer', text: `The probe did not complete: ${probe.error}` };
  else if (probe?.status) {
    probeStatus = probe.status === 401 || probe.status === 403
      ? { tone: 'ok', word: 'Refused', text: `The endpoint answered HTTP ${probe.status} to a call with no bearer.` }
      : { tone: 'warn', word: 'Unexpected', text: `The endpoint answered HTTP ${probe.status}, not the 401 or 403 this lesson expects.` };
  }

  return (
    <SectionFoldContext.Provider value={foldValue}>
      <PingPage className="a2l-page">
        <SimBanner data-testid="a2l-banner">
          <strong>{isReplay ? 'RECORDED RUN' : 'LIVE RUN'}</strong> — Section 2 is a real HTTP request your browser
          makes to this app&apos;s BFF when the page loads, and the button in section 3 sends another. Sections 4 to 6 show{' '}
          {isReplay
            ? `a run ${recordedLine}`
            : 'the run this app’s BFF returned for you just now'}
          . The hop between the two agents runs in-process unless <code>A2A_PROTOCOL_HTTP=1</code>, request panes are
          reconstructed summaries, and raw tokens never reach the browser. Section 7 lists what this page is not.
        </SimBanner>
        <PageHeader
          eyebrow="Learn · Agents"
          title="Agent-to-Agent (A2A), end to end"
          summary="One generalist agent hands work to a specialist. This page shows the real artifacts at every hop — the tokens, the Agent Card, and the JSON-RPC call — using this demo's own agent."
          actions={(
            <button
              type="button"
              onClick={toggleDarkMode}
              className="pu-btn"
              title="Switch this page between light and dark"
              aria-pressed={darkMode}
              data-testid="a2l-theme-toggle"
            >
              Dark mode
            </button>
          )}
        />
        <PageFrame>
          <Card tone="neutral" className="a2l-controls" data-testid="a2l-controls">
            <div className="a2l-controls__row">
              <div className="a2l-controls__field">
                <label className="pu-label" htmlFor="a2l-vertical">Specialist agent</label>
                <select
                  id="a2l-vertical"
                  className="pu-select"
                  value={vertical}
                  onChange={(e) => setVertical(e.target.value)}
                >
                  {specialistOptions.map((specialist) => (
                    <option key={specialist.vertical} value={specialist.vertical}>
                      {specialistOptionLabel(specialist)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="pu-actions a2l-foldbar">
                <button type="button" className="pu-btn" onClick={() => setFolded([])}>Expand all</button>
                <button type="button" className="pu-btn" onClick={() => setFolded(A2A_SECTION_IDS)}>Collapse all</button>
              </div>
            </div>
          </Card>

          <FoldSection
            id="layers"
            num="1"
            title="Two different things are called &ldquo;A2A&rdquo;"
            lead="Keeping these apart is most of the battle. This demo runs both, and they authenticate differently."
          >
            <CardGrid>
              <Card title="Identity — RFC 8693 delegation">
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
                <p className="pu-note">Layer 1 · <code>a2aDelegationService</code></p>
              </Card>
              <Card title="Wire protocol — Linux Foundation A2A">
                <p>
                  How the two agents talk. An Agent Card advertises the specialist&apos;s
                  skills and protocol metadata; a JSON-RPC <code>message/send</code> carries the task.
                  Agent Cards describe capability and protocol metadata; they do not grant authority.
                  The handoff uses an HTTP bearer credential. In this demo it is the user-bound
                  Exchange #1 token, which already carries <code>act: generalist</code> — not the
                  Exchange #2 downstream tool token.
                </p>
                <p className="pu-note">Layer 2 · <code>@a2a-js/sdk</code> · <code>/a2a/specialists</code></p>
              </Card>
            </CardGrid>
            <p className="pu-note a2l-links">
              Deeper on the concept: <Link to="/delegation-chain-value">Delegation Chain Value</Link>
              {' · '}
              <a href="https://a2a-protocol.org/latest/" target="_blank" rel="noreferrer">A2A learning hub</a>
              {' · '}
              <a href="https://a2a-protocol.org/latest/specification/" target="_blank" rel="noreferrer">A2A spec</a>
              {' · '}
              <a href="https://datatracker.ietf.org/doc/html/rfc8693" target="_blank" rel="noreferrer">RFC 8693</a>
            </p>
          </FoldSection>

          <FoldSection
            id="card"
            num="2"
            title="Layer 2 — discovery: the Agent Card"
            lead="Public by design. The card needs no sign-in, so this page asks for it as soon as it loads."
          >
            <Card tone={cardLive ? 'live' : 'neutral'} title="Agent Card" data-testid="a2l-card">
              <p className="pu-status-line" role="status" data-testid="a2l-card-status">
                <StatusChip tone={cardStatus.tone}>{cardStatus.word}</StatusChip>
                {cardStatus.text}
              </p>
              <p className="pu-note"><code>GET /a2a/specialists/{vertical}/.well-known/agent-card.json</code></p>
              {cardSummary && (
                <KvList
                  items={[
                    {
                      label: 'Agent',
                      value: (
                        <>
                          {cardSummary.name} <span className="a2l-meta">v{cardSummary.version}</span>
                        </>
                      ),
                    },
                    {
                      label: 'Skills',
                      value: cardSummary.skillDetails?.length ? (
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
                      ),
                    },
                    { label: 'Security', value: cardSummary.securitySchemes.join(', ') || '—' },
                    { label: 'Binding', value: `${cardSummary.protocolBinding ?? ''} ${cardSummary.protocolVersion ?? ''}`.trim() || '—' },
                  ]}
                />
              )}
              {card
                ? <Json value={card} />
                : (!cardPending && <p className="pu-note pu-empty">No Agent Card is available for this vertical.</p>)}
            </Card>
          </FoldSection>

          <FoldSection
            id="gate"
            num="3"
            title="Layer 2 — the bearer gate, proven"
            lead="The card is public. The endpoint it advertises is not. Send a JSON-RPC call with no Authorization header and watch it refuse."
          >
            <Card tone={probe?.status ? 'live' : 'neutral'} title="No-bearer probe" data-testid="a2l-probe">
              <div className="pu-actions">
                <button
                  type="button"
                  className="pu-btn"
                  onClick={probeWithoutBearer}
                  aria-disabled={probe?.pending ? 'true' : undefined}
                  data-testid="a2l-probe-btn"
                >
                  {probe?.pending ? 'Sending…' : 'Send without a bearer'}
                </button>
              </div>
              <div role="status" data-testid="a2l-probe-status">
                {probeStatus && (
                  <p className="pu-status-line">
                    <StatusChip tone={probeStatus.tone}>{probeStatus.word}</StatusChip>
                    {probeStatus.text}
                  </p>
                )}
              </div>
              {probe?.status && (
                <>
                  <p className="pu-note">
                    <code>POST /a2a/specialists/{probe.vertical}</code> — no Authorization header. A real HTTP request,
                    made from your browser just now. HTTP {probe.status}.
                  </p>
                  <Json value={probe.body} />
                </>
              )}
              {!probe && <p className="pu-note pu-empty">Nothing sent yet.</p>}
            </Card>
          </FoldSection>

          <FoldSection
            id="run"
            num="4"
            title="Layer 1 — run the delegation"
            lead="Minting real PingOne tokens on your behalf needs a signed-in session. Signed out, everything below is a recorded run of exactly this flow."
          >
            <Card tone={isReplay ? 'neutral' : 'live'} title="Delegation run" data-testid="a2l-run">
              <p className="pu-status-line" role="status" data-testid="a2l-run-status">
                <StatusChip tone={runChip.tone}>{runChip.word}</StatusChip>
                {runChip.text}
              </p>
              <div className="a2l-runbar">
                <PageAgentModeToggle mode={agentMode} onChange={setAgentMode} disabled={running} />
                <button
                  type="button"
                  className="pu-btn pu-btn--primary"
                  onClick={runDelegation}
                  aria-disabled={running ? 'true' : undefined}
                  data-testid="a2l-run-btn"
                >
                  {running ? 'Running…' : 'Run the delegation'}
                </button>
              </div>
              {needsAuth && (
                <SignInPrompt
                  variant="strip"
                  message="Running the delegation mints real PingOne tokens, so it needs a signed-in session. The recorded run below shows the same flow."
                />
              )}
              {runError && (
                <p className="pu-status-line" role="alert">
                  <StatusChip tone="danger">Run failed</StatusChip>
                  {runError}
                </p>
              )}
            </Card>
            {detail.present && (
              <A2AFlowVisualizer
                pingStyle
                tokenEvents={events}
                labels={{
                  generalist: detail.generalist || 'Generalist Agent',
                  specialist: detail.specialist || 'Specialist',
                }}
              />
            )}
          </FoldSection>

          <FoldSection
            id="identity"
            num="5"
            title="Layer 1 — the token chain, hop by hop"
            lead="Two client_credentials tokens and two RFC 8693 exchanges. Read the scope shrink and the act nesting."
          >
            {(actChain || !isReplay) && (
              <Card title="Act chain" data-testid="a2l-act-chain">
                <p className="pu-status-line">
                  <StatusChip tone={isReplay ? 'neutral' : 'info'}>{isReplay ? 'Recorded run' : 'Live run'}</StatusChip>
                  {isReplay ? `Captured ${A2A_RECORDED_RUN.capturedAt}.` : 'From the run above.'}
                </p>
                {actChain && (
                  <KvList
                    items={[
                      {
                        label: 'act depth',
                        value: (
                          <>
                            {actChain.depth} <span className="a2l-meta">what Authorize sees as ActChainDepth</span>
                          </>
                        ),
                      },
                      { label: 'specialist', value: <code>{actChain.specialist || '—'}</code> },
                      { label: 'acting for', value: <code>{actChain.generalist || '—'}</code> },
                      { label: 'scope at the specialist', value: <code>{actChain.scope || '—'}</code> },
                      { label: 'tool', value: <code>{actChain.tool || '—'}</code> },
                    ]}
                  />
                )}
                {!isReplay && <A2aStageTimings timings={run?.delegationDecision?.timings} />}
              </Card>
            )}
            {identityPanes.map((p) => <Pane key={p.key} pane={p} recorded={isReplay} />)}
          </FoldSection>

          <FoldSection
            id="wire"
            num="6"
            title="Layer 2 — the handoff on the wire"
            lead="A separate bearer, the card that was discovered, and the JSON-RPC message itself."
          >
            {widePanes.length
              ? widePanes.map((p) => <Pane key={p.key} pane={p} recorded={isReplay} />)
              : <p className="pu-note pu-empty">This run has no wire-protocol events.</p>}
          </FoldSection>

          <FoldSection id="caveats" num="7" title="What this page is not">
            <Card tone="neutral">
              <ul className="a2l-caveats">
                <li>
                  The exchange <b>request</b> panes are reconstructed parameter summaries, not
                  captured HTTP bodies. Token values are deliberately omitted —
                  {' '}<code>has_actor_token: true</code> stands in for them.
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
                  {' '}<code>live-http</code>.
                </li>
              </ul>
            </Card>
          </FoldSection>

          <FoldSection
            id="latest-guidance"
            num="8"
            title="What the current A2A guidance adds"
            lead="This demo proves a secure one-shot handoff. The current protocol guidance gives us the next lessons—and a clear boundary around what is implemented today."
          >
            <CardGrid>
              {A2A_LATEST_LESSONS.map((lesson) => (
                <Card key={lesson.id} title={lesson.title}>
                  <p>{lesson.body}</p>
                  <a
                    href={lesson.href}
                    target="_blank"
                    rel="noreferrer"
                    aria-label={`Read the official lesson: ${lesson.title}`}
                  >
                    Read the official lesson
                  </a>
                </Card>
              ))}
            </CardGrid>
            <h3 className="pu-h3 a2l-subhead">Follow the delegation step by step</h3>
            <p className="pu-note">
              The live token-chain events on this page are PingOne-backed. PingFederate also supports
              RFC 8693 token exchange, but it must be configured on the PF authorization server and
              the exchanging OAuth clients. A successful browser login and a working agent-token
              exchange are separate checks; this walkthrough does not claim that its live chain ran on PF.
            </p>
            <CardGrid>
              {A2A_STEP_EXPLANATIONS.map((step) => (
                <Card key={step.id} title={step.title}>
                  <p>{step.body}</p>
                  <p className="pu-note a2l-links">
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
                </Card>
              ))}
            </CardGrid>
            <Card tone="neutral" title="Implementation status" data-testid="a2l-status-card">
              <ul className="a2l-status-list">
                {A2A_IMPLEMENTATION_STATUS.map((item) => {
                  const chip = STATE_CHIPS[item.state] || { tone: 'neutral', word: item.state };
                  return (
                    <li key={item.id}>
                      <StatusChip tone={chip.tone}>{chip.word}</StatusChip>
                      <span><b>{item.label}</b> — {item.detail}</span>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </FoldSection>

          <Card tone="neutral" className="a2l-docs">
            <A2aDocsLinks />
          </Card>

          <RelatedLearningRail
            id="a2a-protocol"
            educationLinks={A2A_EDUCATION_LINKS}
            appLinks={A2A_APP_LINKS}
            externalLinks={A2A_EXTERNAL_LINKS}
          />
        </PageFrame>
      </PingPage>
    </SectionFoldContext.Provider>
  );
}

// Defined after the page so the pattern check sees the page's banner before the first <Card>.
function Pane({ pane, recorded }) {
  return (
    <Card tone={pane.failed ? 'danger' : 'neutral'} className="a2l-pane">
      <div className="a2l-pane-head">
        <h3 className="pu-h3 a2l-pane-title">{pane.title}</h3>
        <span className="a2l-pane-chips">
          {pane.failed && <StatusChip tone="danger">Failed</StatusChip>}
          <StatusChip tone="neutral">{paneChipWord(pane.provenance, recorded)}</StatusChip>
        </span>
      </div>
      <p className="pu-note">{paneCaption(pane, recorded)}</p>
      {pane.note && <p className="pu-note a2l-pane-note">{pane.note}</p>}
      {pane.cardUrl && <p className="pu-note"><code>{pane.cardUrl}</code></p>}
      <Json value={pane.body} />
    </Card>
  );
}
