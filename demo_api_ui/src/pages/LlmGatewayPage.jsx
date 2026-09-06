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
import { useCallback, useEffect, useState } from 'react';
import { useThemeOptional } from '../context/ThemeContext';
import useDividerDrag from '../hooks/useDividerDrag';
import { ATTACK_CATEGORIES, GUARDRAIL_ATTACKS } from '../config/guardrailAttackCatalog';
import './LlmGatewayPage.css';

const API_BASE = process.env.REACT_APP_API_URL || '/api/privilege-mcp';

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
      const err = new Error(data.error || text || `HTTP ${r.status}`);
      err.status = r.status;
      if (data.code) err.code = data.code;
      if (data.reason) err.reason = data.reason;
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

const TITLES = { anthropic: 'Anthropic', google: 'Google', openai: 'OpenAI' };

// Which layer refused. The pair this page exists to separate is "Privilege stopped
// it" (403, never reached the model) and "the provider credential behind the virtual
// key is dead" (502, reached it and was rejected) — identical-looking in a raw log.
function classify(err) {
  if (err.code === 'llm_bad_route') return { verdict: 'Route rejected', tone: 'bad', layer: 'client' };
  if (err.code === 'llm_policy_denied') return { verdict: 'Denied by policy', tone: 'warn', layer: 'Privilege' };
  if (err.code === 'llm_rate_limited') return { verdict: 'Rate limited by policy', tone: 'warn', layer: 'Privilege' };
  if (err.status === 503) return { verdict: 'Not configured', tone: 'bad', layer: 'this app' };
  if (err.status === 502) return { verdict: 'Provider refused', tone: 'bad', layer: 'provider' };
  return { verdict: `HTTP ${err.status || '?'}`, tone: 'bad', layer: 'unknown' };
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
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState([]);
  const [decision, setDecision] = useState(null);
  const [limitsByLane, setLimitsByLane] = useState({});

  useEffect(() => {
    let cancelled = false;
    api('/llm/config')
      .then((cfg) => {
        if (cancelled) return;
        setGatewayUrl(cfg.gatewayUrl || '');
        setLanes(cfg.lanes || []);
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
    setLimitsByLane({});
    setPrompt('');
  }, []);

  const send = useCallback(async () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setBusy(true);
    setTurns((t) => [...t, { role: 'you', text }]);
    setPrompt('');
    try {
      const data = await api('/llm/call', { method: 'POST', body: { provider: selected, prompt: text } });
      setTurns((t) => [...t, { role: 'model', text: data.reply, tone: 'ok', provider: selected }]);
      record(selected, {
        verdict: 'Answered', tone: 'ok', layer: null,
        provider: selected, route: data.route, latencyMs: data.latencyMs,
        reachedProvider: data.reachedProvider !== false,
        reason: null, providerLimits: data.providerLimits || null,
      });
    } catch (err) {
      const { verdict, tone, layer } = classify(err);
      setTurns((t) => [...t, {
        role: 'model', tone, provider: selected,
        text: tone === 'warn' ? `Privilege denied this call. ${err.reason || err.message}` : err.message,
      }]);
      record(selected, {
        verdict, tone, layer,
        provider: err.provider || selected,
        route: err.route || (lanes.find((l) => l.provider === selected) || {}).route || '',
        latencyMs: err.latencyMs,
        reachedProvider: err.reachedProvider === true,
        reason: err.reason || err.message,
        providerLimits: err.providerLimits || null,
      });
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
                  <span className={`lgw-pill ${lane.keyConfigured ? 'is-ok' : 'is-bad'}`}>
                    {lane.keyConfigured ? 'Key set' : 'No key'}
                  </span>
                </span>
                <span className="lgw-lane__r">{lane.route}</span>
                <span className="lgw-lane__r">{lane.model}</span>
                {!lane.keyConfigured ? <span className="lgw-lane__warn">{lane.keyEnv} is not set</span> : null}
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
          <div className="lgw-turns">
            {turns.length === 0 ? (
              <p className="lgw-empty">
                Ask something through <strong>{TITLES[selected] || selected}</strong>. To see a refusal, send a
                prompt the policy is configured to stop &mdash; anything carrying obvious PII.
              </p>
            ) : null}
            {turns.map((t, i) => (
              <div key={i} className={`lgw-turn lgw-turn--${t.role}`}>
                <span className="lgw-turn__who">{t.role === 'you' ? 'You' : TITLES[t.provider] || 'Gateway'}</span>
                <div className={`lgw-turn__body${t.tone && t.tone !== 'ok' ? ` is-${t.tone}` : ''}`}>{t.text}</div>
              </div>
            ))}
            {busy ? <p className="lgw-empty">Sending through {TITLES[selected] || selected}&hellip;</p> : null}
          </div>
          <div className="lgw-attacks">
            <label htmlFor="lgw-attack">🛡 Attack library</label>
            <select
              id="lgw-attack"
              value=""
              onChange={(e) => {
                const atk = GUARDRAIL_ATTACKS.find((a) => a.id === e.target.value);
                if (atk) setPrompt(atk.payload);
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
            <button type="button" className="lgw-send" onClick={send} disabled={busy || !active?.keyConfigured}>
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </section>

        <div className="lgw-resize-handle" aria-label="Resize last decision column" {...decisionHandleProps} />

        <section className="lgw-rail lgw-rail--right" aria-label="Last decision">
          <h2 className="lgw-rail__k">Last decision</h2>
          {!decision ? (
            <p className="lgw-rail__note">Send a prompt and the gateway&rsquo;s verdict lands here.</p>
          ) : (
            <dl className="lgw-dec" data-testid="lgw-decision">
              <div>
                <dt>Verdict</dt>
                <dd><span className={`lgw-pill is-${decision.tone}`}>{decision.verdict}</span></dd>
              </div>
              {/* Only a refusal has a refuser. Rendering this row on a success read
                  "Refused by provider" under a verdict of "Answered" — caught driving
                  the live page, where it is the first thing the eye lands on. */}
              {decision.tone === 'ok' ? null : (
                <div><dt>Refused by</dt><dd>{decision.layer}</dd></div>
              )}
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
          {decision && !decision.reachedProvider ? (
            <p className="lgw-rail__note">
              The prompt stopped at the gateway. Nothing was sent to the model and nothing was billed.
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
