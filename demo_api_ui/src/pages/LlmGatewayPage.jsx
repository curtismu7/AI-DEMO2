// demo_api_ui/src/pages/LlmGatewayPage.jsx
//
// The LLM Gateway console. Its subject is the PingOne Privilege VIRTUAL KEY: what
// each lane is allowed to reach, and what the gateway decided about the last call.
//
// Deliberately a separate page from the AI Agent Gateway Client. That page is about
// the MCP TOOL path — doors, tools, RPC, token chain — and already runs a three-pane
// layout with two tab strips; this needs three panes of its own, and answers a
// different question (what may this key do?) about a different subject (the prompt).
//
// Honesty rule for this screen: it claims to show governance, so it may not present
// a number as a Privilege cap unless it is one. The rate/token figures come from the
// PROVIDER (passed through the gateway) and are labelled as such. Spend is not shown
// at all — Privilege exposes no per-key usage endpoint today, and an invented meter
// would discredit the one thing this page exists to prove.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useThemeOptional } from '../context/ThemeContext';
import useDividerDrag from '../hooks/useDividerDrag';
import { ATTACK_CATEGORIES, GUARDRAIL_ATTACKS } from '../config/guardrailAttackCatalog';
import JsonHighlight from '../components/shared/JsonHighlight';
import GatewayVerdicts from '../components/GatewayVerdicts';
import './LlmGatewayPage.css';

const API_BASE = process.env.REACT_APP_API_URL || '/api/privilege-mcp';

// An upstream that fails before this app does answers with an HTML error page, not
// JSON — nginx, an ingress, a load balancer. That body went verbatim into the turn
// and the Reason field, so a dead backend read as 400 characters of nginx
// boilerplate sitting where the model’s answer belongs. Keep the one line that
// carries the meaning (the <title>, where every such page puts "502 Bad Gateway")
// and hand the body back for the details toggle. Done here, in the one helper every
// call goes through, rather than at the two call sites that happened to show it.
const HTML_BODY_RE = /^\s*(?:<!doctype|<html\b)/i;

function summarizeHtmlError(body, status) {
  const title = (body.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1];
  const server = (body.match(/<center>\s*([^<\s]+\/[\d.]+)\s*<\/center>/i) || [])[1];
  const what = (title || `HTTP ${status}`).trim();
  return `${what} \u2014 an HTML error page from ${server ? server.trim() : 'an upstream'}, not a model reply.`;
}

function api(path, options = {}) {
  return fetch(`${API_BASE}${path}`, {
    method: options.method || 'GET',
    headers: { 'Content-Type': 'application/json' },
    body: options.body ? JSON.stringify(options.body) : undefined,
    credentials: 'include',
  }).then(async (r) => {
    const text = await r.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!r.ok) {
      const body = data.error || text || `HTTP ${r.status}`;
      const isHtml = typeof body === 'string' && HTML_BODY_RE.test(body);
      const err = new Error(isHtml ? summarizeHtmlError(body, r.status) : body);
      if (isHtml) err.rawBody = body;
      err.status = r.status;
      if (data.code) err.code = data.code;
      if (data.reason) {
        // The BFF passes the upstream body through here too, so the Reason row was
        // showing the same wall of markup the turn was.
        const htmlReason = typeof data.reason === 'string' && HTML_BODY_RE.test(data.reason);
        if (htmlReason && !err.rawBody) err.rawBody = data.reason;
        err.reason = htmlReason ? summarizeHtmlError(data.reason, r.status) : data.reason;
      }
      if (data.provider) err.provider = data.provider;
      if (data.route) err.route = data.route;
      if (data.latencyMs !== undefined) err.latencyMs = data.latencyMs;
      if (data.reachedProvider !== undefined) err.reachedProvider = data.reachedProvider;
      if (data.providerLimits) err.providerLimits = data.providerLimits;
      throw err;
    }
    return data;
  });
}

const TITLES = {
  anthropic: 'Anthropic', google: 'Google', openai: 'OpenAI',
  lmstudio: 'LM Studio (local)', llamacpp: 'llama.cpp (local)',
};

// A sanitize is the one Privilege verdict that arrives with HTTP 200 and no error
// body — the gateway rewrites the matched values inside the reply as
// [REDACTED:<kind>] and says nothing else. Counting those markers is the only
// signal the caller has, and without it a redacted answer renders under
// "Privilege passed the prompt through", which is the opposite of what happened.
const REDACTION_RE = /(\[REDACTED(?::[^\]]*)?\])/gi;
function countRedactions(text) {
  return typeof text === 'string' ? (text.match(REDACTION_RE) || []).length : 0;
}

// The markers are the demo's payoff — the only place the gateway's work shows up
// in the caller's own text — and they were being left to be spotted inside a wall
// of prose. Splitting on the capture group alternates [text, marker, text, ...],
// so odd indices are the markers; <mark> carries the meaning, the stylesheet the
// colour. No early return: an unredacted reply just splits into one part.
function renderReply(text) {
  if (typeof text !== 'string') return text;
  return text.split(REDACTION_RE).map((part, i) => (
    i % 2 ? <mark key={i} className="lgw-redacted">{part}</mark> : part
  ));
}

// Which layer refused. The pair this page exists to separate is "Privilege stopped
// it" (403, never reached the model) and "the provider credential behind the virtual
// key is dead" (502, reached it and was rejected) — identical-looking in a raw log.
function classify(err) {
  if (err.code === 'llm_bad_route') return { verdict: 'Route rejected', tone: 'bad', layer: 'client' };
  if (err.code === 'llm_policy_denied') return { verdict: 'Denied by policy', tone: 'warn', layer: 'Privilege' };
  if (err.code === 'llm_rate_limited') return { verdict: 'Rate limited by policy', tone: 'warn', layer: 'Privilege' };
  if (err.status === 503) return { verdict: 'Not configured', tone: 'bad', layer: 'this app' };
  // A 502 covers two different stories: the model answered with a refusal, or the
  // call never got there at all (DNS, refused, reset). `reachedProvider` rides on
  // the error body and is the only thing that separates them — without it a local
  // lane whose port was closed reads as "the provider refused", which is a claim
  // about a conversation that never happened.
  if (err.status === 502) {
    return err.reachedProvider === false
      ? { verdict: 'Could not reach the model', tone: 'bad', layer: 'transport' }
      : { verdict: 'Provider refused', tone: 'bad', layer: 'provider' };
  }
  return { verdict: `HTTP ${err.status || '?'}`, tone: 'bad', layer: 'unknown' };
}

// The one question this page is asked out loud every time it is driven: "how do I
// know if Privilege stopped it or the model did?" The dl below carries the evidence
// (refused-by, reached-the-model, latency) but reads as one field among eight, so
// the answer gets its own headline above the fold. `provider` names the model so a
// refusal reads "Anthropic stopped this", not the abstract "provider".
function attribution(decision, isLocal) {
  const model = TITLES[decision.provider] || decision.provider;
  if (decision.tone === 'ok') {
    if (decision.redactions > 0) {
      const n = decision.redactions;
      return {
        who: '\ud83d\udd10 Privilege redacted the reply',
        note: `${model} answered, and Privilege removed ${n} matched value${n === 1 ? '' : 's'} from the text before it reached you. The prompt itself was passed through.`,
      };
    }
    return isLocal
      ? { who: `${model} answered`, note: 'No policy layer on this lane — the model decided on its own.' }
      : { who: `${model} answered`, note: 'Privilege passed the prompt through. A refusal in the text above is the model\u2019s own.' };
  }
  if (decision.layer === 'Privilege') {
    return { who: '\ud83d\udd10 Privilege stopped this', note: 'The prompt never reached the model. Nothing was sent, nothing was billed.' };
  }
  if (decision.layer === 'transport') {
    return {
      who: `${model} could not be reached`,
      note: isLocal
        ? 'The call never connected, so nothing refused it — this lane has no policy layer in front of it anyway.'
        : 'The call never connected. Nothing was sent to the model and nothing was billed.',
    };
  }
  if (decision.layer === 'provider') {
    return isLocal
      ? { who: `${model} stopped this`, note: 'No policy layer on this lane — the refusal came from the model itself.' }
      : { who: `${model} stopped this`, note: 'Privilege passed the prompt through — the refusal came from the provider.' };
  }
  return { who: `Stopped by ${decision.layer}`, note: 'The call never reached Privilege or the model.' };
}

// What the caller will actually see, so firing a payload that produces nothing
// reads as "the model declined" rather than "the guardrail failed". Three of the
// seven produce no gateway verdict at all; saying so up front is the difference
// between a demo and an unexplained silence.
const ATTACK_EFFECT = {
  blocks: 'Privilege blocks this before the model sees it.',
  sanitizes: 'The model answers, and Privilege redacts the matched values inside the reply.',
  none: 'No Privilege verdict fires for this one — any refusal you see is the model\u2019s own.',
};

// A <select> fires no onChange when you pick the option already selected, so any
// state where the dropdown names an attack the prompt box does not hold is a dead
// end: the fix has to keep the two in step, not re-fill on re-pick. Everywhere the
// box is emptied, the selection is cleared with it.
function payloadFor(id) {
  return (GUARDRAIL_ATTACKS.find((a) => a.id === id) || {}).payload || '';
}

function Meter({ label, remaining, limit, reset }) {
  if (remaining === null || remaining === undefined || !limit) return null;
  const used = Math.max(0, limit - remaining);
  const pct = Math.min(100, Math.round((used / limit) * 100));
  return (
    <div className="lgw-meter">
      <div className="lgw-meter__row">
        <span>{label}</span>
        <span>{remaining.toLocaleString()} / {limit.toLocaleString()}</span>
      </div>
      <div className="lgw-meter__track">
        <i className={pct > 80 ? 'is-high' : ''} style={{ width: `${Math.max(pct, 1)}%` }} />
      </div>
      {reset ? <div className="lgw-meter__reset">resets in {reset}</div> : null}
    </div>
  );
}

export default function LlmGatewayPage() {
  const { darkMode, toggleDarkMode } = useThemeOptional();
  // Column widths, drag-to-resize, persisted — same primitive InspectorShell
  // already uses, not a page-local reimplementation. Right column defaults
  // wider than the old fixed 15rem (~240px): "Refused by / Route / Reached
  // the model / Reason" definition rows wrapped hard at that width.
  const { size: railWidth, handleProps: railHandleProps } = useDividerDrag({
    min: 220, max: 420, initial: 272, storageKey: 'lgw-rail-width',
  });
  const { size: decisionWidth, handleProps: decisionHandleProps } = useDividerDrag({
    // Defaults to the drag ceiling itself — widest by default, drag it
    // smaller if you want the room back for the conversation column.
    min: 260, max: 560, initial: 560, storageKey: 'lgw-decision-width', invert: true,
  });
  const [gatewayUrl, setGatewayUrl] = useState('');
  const [lanes, setLanes] = useState([]);
  const [selected, setSelected] = useState('openai');
  const [loadError, setLoadError] = useState('');
  // The dropdown's choice persists across reloads; the prompt box must be seeded
  // from the same key or the two load out of sync — select reads "Prompt Injection",
  // box is empty, and re-picking that option fires no change event.
  const [prompt, setPrompt] = useState(() => payloadFor(window.localStorage.getItem('lgw-attack-choice')));
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState([]);
  const [decision, setDecision] = useState(null);
  const [decisionView, setDecisionView] = useState('form');
  const [limitsByLane, setLimitsByLane] = useState({});
  const [selectedAttack, setSelectedAttack] = useState(() => window.localStorage.getItem('lgw-attack-choice') || '');
  // Which turn's decision is showing in the right column — defaults to the
  // most recent, but clicking an older model turn re-points it there.
  const [selectedTurnId, setSelectedTurnId] = useState(null);
  const nextTurnId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    api('/llm/config')
      .then((cfg) => {
        if (cancelled) return;
        setGatewayUrl(cfg.gatewayUrl || '');
        // The local lanes go last (after OpenAI) — no virtual key, no policy,
        // so they render with an adapted card rather than a "No key" warning.
        const locals = (cfg.locals || [])
          .map((l) => ({ provider: l.provider, route: l.route, baseUrl: l.baseUrl, isLocal: true }));
        setLanes([...(cfg.lanes || []), ...locals]);
        const firstReady = (cfg.lanes || []).find((l) => l.keyConfigured);
        if (firstReady) setSelected(firstReady.provider);
      })
      .catch((err) => { if (!cancelled) setLoadError(err.message || 'Could not read the gateway configuration.'); });
    return () => { cancelled = true; };
  }, []);

  const record = useCallback((provider, d) => {
    setDecision(d);
    if (d.providerLimits) setLimitsByLane((prev) => ({ ...prev, [provider]: d.providerLimits }));
  }, []);

  // Nothing here clears itself — turns, the last decision and the provider
  // limits meters all only ever append/replace, so a long demo session (or
  // firing several attacks from the library) leaves the conversation growing
  // with no way back to a clean slate short of reloading the page.
  const reset = useCallback(() => {
    setTurns([]);
    setDecision(null);
    setSelectedTurnId(null);
    setLimitsByLane({});
    setPrompt('');
    setSelectedAttack('');
    window.localStorage.removeItem('lgw-attack-choice');
  }, []);

  const send = useCallback(async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setTurns((t) => [...t, { id: nextTurnId.current++, role: 'you', text }]);
    setPrompt('');
    setSelectedAttack('');
    try {
      const data = await api('/llm/call', { method: 'POST', body: { provider: selected, prompt: text } });
      const redactions = countRedactions(data.reply);
      const d = {
        verdict: redactions > 0 ? 'Answered, redacted' : 'Answered', tone: 'ok', layer: null,
        redactions,
        provider: selected, route: data.route, latencyMs: data.latencyMs,
        reachedProvider: data.reachedProvider !== false,
        reason: null, providerLimits: data.providerLimits || null,
      };
      const id = nextTurnId.current++;
      setTurns((t) => [...t, { id, role: 'model', text: data.reply, tone: 'ok', provider: selected, decision: d }]);
      setSelectedTurnId(id);
      record(selected, d);
    } catch (err) {
      const { verdict, tone, layer } = classify(err);
      const d = {
        verdict, tone, layer,
        provider: err.provider || selected,
        route: err.route || (lanes.find((l) => l.provider === selected) || {}).route || '',
        latencyMs: err.latencyMs,
        reachedProvider: err.reachedProvider === true,
        reason: err.reason || err.message,
        providerLimits: err.providerLimits || null,
      };
      const id = nextTurnId.current++;
      setTurns((t) => [...t, {
        id, role: 'model', tone, provider: selected, decision: d,
        text: tone === 'warn' ? `Privilege denied this call. ${err.reason || err.message}` : err.message,
        rawBody: err.rawBody,
      }]);
      setSelectedTurnId(id);
      record(selected, d);
    } finally {
      setBusy(false);
    }
  }, [prompt, busy, selected, lanes, record]);

  const active = lanes.find((l) => l.provider === selected);

  return (
    <div className="lgw">
      <header className="lgw-bar">
        <div>
          <h1>AI Guard</h1>
          <p>Every prompt below travels through a PingOne Privilege virtual key. The provider key stays inside
            Privilege, and policy can refuse the call before the model ever sees the text.</p>
        </div>
        <div className="lgw-bar__side">
          {gatewayUrl ? <code className="lgw-origin">{gatewayUrl}</code> : null}
          <button
            type="button"
            className="lgw-theme"
            onClick={reset}
            disabled={turns.length === 0 && !decision}
            title="Clear the conversation and start over"
          >
            Reset
          </button>
          <button
            type="button"
            className="lgw-theme"
            onClick={toggleDarkMode}
            title="Switch this page between light and dark"
            aria-pressed={darkMode}
          >
            {darkMode ? '☀️ Light mode' : '🌙 Dark mode'}
          </button>
        </div>
      </header>

      {loadError ? <p className="lgw-error" role="alert">{loadError}</p> : null}

      <div
        className="lgw-body"
        style={{ gridTemplateColumns: `${railWidth}px 6px minmax(0, 1fr) 6px ${decisionWidth}px` }}
      >
        <section className="lgw-rail" aria-label="Lanes">
          <h2 className="lgw-rail__k">Lanes</h2>
          {lanes.map((lane) => {
            const limits = limitsByLane[lane.provider];
            const isOn = lane.provider === selected;
            return (
              <button
                type="button"
                key={lane.provider}
                className={`lgw-lane${isOn ? ' is-selected' : ''}`}
                aria-pressed={isOn}
                onClick={() => setSelected(lane.provider)}
              >
                <span className="lgw-lane__top">
                  <span className="lgw-lane__n">{TITLES[lane.provider] || lane.provider}</span>
                  {lane.isLocal ? (
                    <span className="lgw-pill is-ok">No key needed</span>
                  ) : (
                    <span className={`lgw-pill ${lane.keyConfigured ? 'is-ok' : 'is-bad'}`}>
                      {lane.keyConfigured ? 'Key set' : 'No key'}
                    </span>
                  )}
                </span>
                <span className="lgw-lane__r">{lane.route}</span>
                {lane.isLocal ? (
                  <span className="lgw-lane__r">{lane.baseUrl}</span>
                ) : (
                  <span className="lgw-lane__r">{lane.model}</span>
                )}
                {!lane.isLocal && !lane.keyConfigured ? <span className="lgw-lane__warn">{lane.keyEnv} is not set</span> : null}
                {limits ? (
                  <span className="lgw-lane__limits">
                    <span className="lgw-lane__limitk">Provider limits</span>
                    <Meter label="requests" remaining={limits.requestsRemaining} limit={limits.requestsLimit} reset={limits.resetRequests} />
                    <Meter label="tokens" remaining={limits.tokensRemaining} limit={limits.tokensLimit} reset={limits.resetTokens} />
                  </span>
                ) : null}
              </button>
            );
          })}
          <p className="lgw-rail__note">
            Privilege publishes no per-key usage today, so spend against the virtual key cannot be shown. The
            figures above are the provider&rsquo;s own limits, passed through the gateway.
          </p>
        </section>

        <div className="lgw-resize-handle" aria-label="Resize lanes column" {...railHandleProps} />

        <section className="lgw-main" aria-label="Conversation">
          <h2 className="lgw-rail__k lgw-main__k">Request</h2>
          <div className="lgw-turns">
            {turns.length === 0 ? (
              <p className="lgw-empty">
                {active?.isLocal ? (
                  <>Ask something through <strong>{TITLES[selected]}</strong>. This lane runs unmediated &mdash; no
                    virtual key, no Privilege policy, nothing between the prompt and the model.</>
                ) : (
                  <>Ask something through <strong>{TITLES[selected] || selected}</strong>. To see a refusal, send a
                    prompt the policy is configured to stop &mdash; anything carrying obvious PII.</>
                )}
              </p>
            ) : null}
            {turns.map((t) => (
              t.role === 'model' ? (
                <button
                  type="button"
                  key={t.id}
                  className={`lgw-turn lgw-turn--model${t.id === selectedTurnId ? ' is-selected' : ''}`}
                  aria-pressed={t.id === selectedTurnId}
                  title="Show this run's result in Last decision"
                  onClick={() => { setDecision(t.decision); setSelectedTurnId(t.id); }}
                >
                  <span className="lgw-turn__who">{TITLES[t.provider] || 'Gateway'}</span>
                  <div className={`lgw-turn__body${t.tone && t.tone !== 'ok' ? ` is-${t.tone}` : ''}`}>
                    {renderReply(t.text)}
                    {/* The page swallowed nothing — the body is still one click away,
                        which is the difference between summarising and hiding. The
                        click must not also re-select the turn behind it. */}
                    {t.rawBody ? (
                      <details className="lgw-raw" onClick={(e) => e.stopPropagation()}>
                        <summary>Show the raw error page</summary>
                        <pre>{t.rawBody}</pre>
                      </details>
                    ) : null}
                  </div>
                </button>
              ) : (
                <div key={t.id} className="lgw-turn lgw-turn--you">
                  <span className="lgw-turn__who">You</span>
                  <div className="lgw-turn__body">{t.text}</div>
                </div>
              )
            ))}
            {busy ? (
              <p className="lgw-empty lgw-busy">
                <span className="lgw-spinner" aria-hidden="true" />
                Sending through {TITLES[selected] || selected}&hellip;
              </p>
            ) : null}
          </div>
          <div className="lgw-attacks">
            <label htmlFor="lgw-attack">🛡 Attack library</label>
            <select
              id="lgw-attack"
              value={selectedAttack}
              onChange={(e) => {
                const id = e.target.value;
                setSelectedAttack(id);
                window.localStorage.setItem('lgw-attack-choice', id);
                if (id) setPrompt(payloadFor(id));
              }}
            >
              <option value="">Pick an attack to test the gateway policy…</option>
              {ATTACK_CATEGORIES.map((cat) => (
                <optgroup key={cat} label={cat}>
                  {GUARDRAIL_ATTACKS.filter((a) => a.category === cat).map((a) => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </optgroup>
              ))}
            </select>
            <span className="lgw-attacks__note">Fills the prompt below — review it, then Send.</span>
            {selectedAttack && ATTACK_EFFECT[(GUARDRAIL_ATTACKS.find((a) => a.id === selectedAttack) || {}).effect] ? (
              <span className="lgw-attacks__effect" data-testid="lgw-attack-effect">
                {ATTACK_EFFECT[(GUARDRAIL_ATTACKS.find((a) => a.id === selectedAttack) || {}).effect]}
              </span>
            ) : null}
          </div>

          <div className="lgw-composer">
            <input
              type="text"
              aria-label="Prompt"
              value={prompt}
              placeholder={`Ask through ${TITLES[selected] || selected}…`}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); send(); } }}
            />
            <button type="button" className="lgw-send" onClick={send} disabled={busy || !(active?.isLocal || active?.keyConfigured)}>
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </section>

        <div className="lgw-resize-handle" aria-label="Resize last decision column" {...decisionHandleProps} />

        <section className="lgw-rail lgw-rail--right" aria-label="Last decision">
          <div className="lgw-rail__head">
            <h2 className="lgw-rail__k">Last decision</h2>
            {decision ? (
              <div className="lgw-viewtoggle" role="group" aria-label="Decision view">
                <button
                  type="button"
                  className={decisionView === 'form' ? 'is-active' : ''}
                  aria-pressed={decisionView === 'form'}
                  onClick={() => setDecisionView('form')}
                >
                  Form
                </button>
                <button
                  type="button"
                  className={decisionView === 'json' ? 'is-active' : ''}
                  aria-pressed={decisionView === 'json'}
                  onClick={() => setDecisionView('json')}
                >
                  JSON
                </button>
              </div>
            ) : null}
          </div>
          {decision ? (
            <div className={`lgw-who is-${decision.tone}`} data-testid="lgw-who">
              <p className="lgw-who__who">{attribution(decision, active?.isLocal).who}</p>
              <p className="lgw-who__note">{attribution(decision, active?.isLocal).note}</p>
            </div>
          ) : null}
          {!decision ? (
            <p className="lgw-rail__note">Send a prompt and the gateway&rsquo;s verdict lands here.</p>
          ) : decisionView === 'json' ? (
            <pre className={`lgw-decision-json${darkMode ? ' jh-dark' : ''}`} data-testid="lgw-decision-json">
              <JsonHighlight value={decision} />
            </pre>
          ) : (
            <dl className="lgw-dec" data-testid="lgw-decision">
              <div>
                <dt>Verdict</dt>
                <dd><span className={`lgw-pill is-${decision.tone}`}>{decision.verdict}</span></dd>
              </div>
              {/* Only a refusal has a refuser, and the headline banner above already
                  names it — this row stays as the machine-readable restatement, so
                  it must never appear under a verdict of "Answered". */}
              {decision.tone === 'ok' || decision.layer === 'transport' ? null : (
                <div><dt>Refused by</dt><dd>{decision.layer}</dd></div>
              )}
              {/* The pair "which lanes are governed" answers in the abstract; this
                  answers it for the call that just happened. Local lanes never had
                  a Privilege chip to begin with — the chain just skips it. */}
              {decision.tone === 'ok' ? (
                <div>
                  <dt>Path</dt>
                  <dd>
                    <div className="lgw-path">
                      <span className="lgw-path__chip">You</span>
                      <span className="lgw-path__arrow">&rarr;</span>
                      {(lanes.find((l) => l.provider === decision.provider) || {}).isLocal ? null : (
                        <>
                          <span className="lgw-path__chip lgw-path__chip--gateway">🔐 Privilege</span>
                          <span className="lgw-path__arrow">&rarr;</span>
                        </>
                      )}
                      {/* Sits between the two actors it involves. The arrow before it
                          points back, because the redaction happened on the RETURN leg —
                          the prompt itself went out untouched, and a chip reading
                          left-to-right here would claim otherwise. */}
                      {decision.redactions > 0 ? (
                        <>
                          <span className="lgw-path__chip lgw-path__chip--redacted" title="Privilege redacted the reply on its way back from the model">
                            🛡 {decision.redactions} redacted
                          </span>
                          <span className="lgw-path__arrow">&larr;</span>
                        </>
                      ) : null}
                      <span className="lgw-path__chip lgw-path__chip--reached">{TITLES[decision.provider] || decision.provider} &#10003;</span>
                    </div>
                  </dd>
                </div>
              ) : null}
              <div><dt>Lane</dt><dd>{decision.provider}</dd></div>
              <div><dt>Route</dt><dd>{decision.route}</dd></div>
              <div>
                <dt>Reached the model</dt>
                <dd>{decision.reachedProvider ? 'yes' : 'no'}</dd>
              </div>
              {decision.reason ? <div><dt>Reason</dt><dd>{decision.reason}</dd></div> : null}
              {decision.latencyMs !== undefined && decision.latencyMs !== null
                ? <div><dt>Latency</dt><dd>{decision.latencyMs} ms</dd></div> : null}
            </dl>
          )}
          {/* Only a Privilege denial actually stopped at the gateway. A transport
              failure also never reached the model, but there was no gateway in the
              story — on a local lane there isn't one at all — so this note would be
              claiming credit for a refusal that never happened. */}
          {decision && !decision.reachedProvider && decision.layer === 'Privilege' ? (
            <p className="lgw-rail__note">
              The prompt stopped at the gateway. Nothing was sent to the model and nothing was billed.
            </p>
          ) : null}
          {/* This page can't tell a compliant reply from a refusal — both come back
              as {reply} with tone "ok". A local lane has no policy in front of it,
              so if the text above declined to answer, that was the model's own
              guardrails, not this demo's gateway. */}
          {decision && decision.tone === 'ok' && active?.isLocal ? (
            <p className="lgw-rail__note">
              This lane has no policy layer. If the reply above declined to answer, that was the model deciding — not the gateway.
            </p>
          ) : null}
        </section>

        {/* The verdicts above are already visible in the response; this panel is
            for the compliance mappings, which are not. It needs its own sign-in
            (the door offers no client-credentials grant), so it loads on demand
            rather than firing a request nobody asked for on every page view. */}
        <GatewayVerdicts />
      </div>
    </div>
  );
}
