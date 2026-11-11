// /p1-third-party-exchange: PingOne token exchange with third-party signed JWTs as actor tokens. A mock: no PingOne call.
// A guided walk, one idea per screen: the idea, pick an issuer, set the trust, send it, read the result, compare, what to know.
// The choices (issuer, switches, token state) are shared across steps. Text size and token decoding are user controls.
//
// Layout follows the standalone Ping UI Standard through the shared primitives (components/pingUi,
// docs/ping-ui-primitives.md): P2 banner first, P3 frame, P4 cards, P5 kv, P7 chips, P9 buttons.
// P9 "exactly one primary per view state": the primary is the control in the bar at the bottom. In the walk it is
// Next, which becomes Start over on the last step (one element, so focus stays on it). In the one-page view there is no
// walk to advance, so that same element reads "Back to the walk". Every other button is a bordered secondary.
// The step heading is a plain h2 (not Section) because the walk moves focus to it, which needs a ref and tabIndex.
// The page function comes before the helper components so the banner is the first thing in the file the pattern check meets.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PageHeader from '../components/common/PageHeader';
import {
  PingPage, SimBanner, PageFrame, Section, CardGrid, Card, StatusChip, KvList,
} from '../components/pingUi';
import SequenceFlowDiagram from '../components/SequenceFlowDiagram';
import {
  ADMIN_FACTS, API_SAMPLES, COMPARE_COLUMNS, COMPARE_ROWS, DIAGRAM_DETAILS, DIAGRAM_LANES, EVIDENCE, NOT_SHOWN, P1_ISSUER, STEPS,
  TOKEN_STATES, TRUSTED_ISSUER_DEFAULTS, VENDORS, applyMapping, buildWire, collapseJwts, exchangeDiagram, findJwts, KEY_CLAIMS, relTime, TIME_CLAIMS, requestText, resultClaims, subjectClaims, validateExchange,
} from '../config/p1ThirdPartyExchange';
import './P1ThirdPartyExchangePage.css';

const SETUP_DOC = 'docs/runbooks/p1-third-party-token-exchange.md';
// The standalone lab app sends a real request to the visitor's own PingOne (browser-direct, secret never leaves the browser).
// Served through the shared lab-proxy; the hash selects its Real exchange tab.
const REAL_LAB = 'https://local.ping-devops.com:8443/p1-third-party-exchange/';

// Evidence label as a status chip: the word is the label, the tone only adds colour (P7). The note rides as a tooltip.
const EVIDENCE_TONE = { measured: 'info', guide: 'ok', sample: 'neutral', derived: 'warn', unverified: 'warn' };

const copy = (text) => { try { navigator.clipboard?.writeText(text); } catch { /* clipboard blocked: the text is on screen */ } };

const readPref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
const savePref = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* blocked storage: the switch still works for this visit */ } };

const WALK = [
  { id: 'idea', title: 'The idea', min: 1 },
  { id: 'issuer', title: 'Pick an issuer', min: 1 },
  { id: 'trust', title: 'Set the trust', min: 2 },
  { id: 'send', title: 'Send it', min: 2 },
  { id: 'result', title: 'Read the result', min: 1 },
  { id: 'compare', title: 'Compare', min: 2 },
  { id: 'know', title: 'What to know', min: 2 },
  { id: 'real', title: 'Try it for real', min: 3 },
];
const FS_STEPS = [80, 90, 100, 110, 120, 130, 140, 150, 160, 170];
const readStep = () => {
  try { const m = /walk=(\d+)/.exec(window.location.hash); const n = m ? Number(m[1]) : 1; return Math.min(Math.max(n, 1), WALK.length); } catch { return 1; }
};
const readAll = () => {
  try { return /walk=all/.test(window.location.hash); } catch { return false; }
};
const readFs = () => {
  try { const n = Number(localStorage.getItem('p1x-fs')); return FS_STEPS.includes(n) ? n : 100; } catch { return 100; }
};

export default function P1ThirdPartyExchangePage() {
  const [step, setStep] = useState(readStep);
  const [all, setAll] = useState(readAll);
  const [fs, setFs] = useState(readFs);
  const [vendorId, setVendorId] = useState('pf-cc');
  const [state, setState] = useState('valid');
  const [settings, setSettings] = useState(TRUSTED_ISSUER_DEFAULTS);
  const [assigned, setAssigned] = useState(true);
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const [decode, setDecode] = useState(() => readPref('p1x-decode', true));
  const headingRef = useRef(null);
  const contentsRef = useRef(null);
  const first = useRef(true);
  const toggleDecode = (on) => { setDecode(on); savePref('p1x-decode', on); };

  const go = useCallback((n) => {
    const next = Math.min(Math.max(n, 1), WALK.length);
    setStep(next);
    setAll(false);
    try { window.history.replaceState(null, '', `#walk=${next}`); } catch { /* history unavailable: the walk still works */ }
  }, []);
  const toggleAll = () => {
    const next = !all;
    setAll(next);
    try { window.history.replaceState(null, '', next ? '#walk=all' : `#walk=${step}`); } catch { /* history unavailable */ }
  };
  const changeFs = (n) => {
    const next = Math.min(Math.max(n, 80), 170);
    setFs(next);
    try { localStorage.setItem('p1x-fs', String(next)); } catch { /* blocked storage: the size still applies for this visit */ }
  };

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    // A step change, or switching between the walk and the one-page view, replaces the control that was pressed:
    // put focus on the new view's heading so it does not fall back to the top of the document.
    (all ? contentsRef : headingRef).current?.focus();
    window.scrollTo?.({ top: 0 });
  }, [step, all]);
  useEffect(() => {
    const onHash = () => { setStep(readStep()); setAll(readAll()); };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  useEffect(() => {
    const onKey = (e) => {
      if (e.altKey || e.ctrlKey || e.metaKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '')) return;
      if (e.key === 'ArrowRight') go(step + 1);
      if (e.key === 'ArrowLeft') go(step - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, step]);

  const vendor = VENDORS.find((v) => v.id === vendorId);
  const run = useMemo(() => validateExchange({ vendor, state, settings, assigned, now }), [vendor, state, settings, assigned, now]);
  const subject = useMemo(() => subjectClaims(now), [now]);
  const mapped = useMemo(() => vendor.mappings.map((m) => ({ m, r: applyMapping(m, run.claims) })), [vendor, run.claims]);
  const issued = useMemo(() => resultClaims(subject, run.ok ? { claim: Object.assign({}, ...mapped.map(({ r }) => r.claim || {})) } : null, now), [subject, mapped, run.ok, now]);
  const diagram = useMemo(() => exchangeDiagram(vendor, run), [vendor, run]);
  const wire = useMemo(() => buildWire({ vendor, run, settings, assigned, now }), [vendor, run, settings, assigned, now]);
  const set = (k) => (e) => setSettings((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const reset = () => { setState('valid'); setSettings(TRUSTED_ISSUER_DEFAULTS); setAssigned(true); };
  const meta = WALK[step - 1];
  const exchangeCall = wire.runtime[wire.runtime.length - 1];

  const bodies = stepBodies({
    vendor, vendorId, setVendorId, run, subject, mapped, issued, diagram, wire, decode, toggleDecode, now,
    settings, set, assigned, setAssigned, state, setState, reset, exchangeCall,
  });
  const body = bodies[meta.id];

  const kicker = `Step ${step} of ${WALK.length} · ${meta.min} ${meta.min === 1 ? 'minute' : 'minutes'}`;
  return (
    <PingPage className="p1x-page" data-fs={fs} data-testid="p1-third-party-exchange-page">
      <SimBanner data-testid="p1x-banner">
        <strong>Simulated.</strong> Nothing on this page calls PingOne. The token checks run in your browser against rules we modelled, and every token is a mock with a signature that can never verify.
        The refusal messages and the settings behaviour are real: they were measured live against PingOne on 2026-10-27 and replayed here.
        The capability is generally available in all geographies, subject to your license entitlement. Third-party JWTs are not trusted until an administrator defines a trusted issuer and assigns it to the application.
      </SimBanner>
      <PageHeader
        eyebrow="Diagrams · PingOne"
        title="PingOne token exchange with third-party tokens"
        summary="PingOne can trust a JWT signed by another issuer and accept it in an RFC 8693 token exchange, then map its claims into the token it issues. Walk through it one idea at a time."
        back={{ to: '/diagrams', label: 'All diagrams' }}
      />

      <PageFrame>
        <div className="p1x-toolbar">
          {all ? null : <button type="button" className="pu-btn" onClick={toggleAll} data-testid="p1x-all-toggle">See everything on one page</button>}
          <div className="p1x-fsctl" role="group" aria-label="Text size" data-testid="p1x-fsctl">
            <button type="button" onClick={() => changeFs(fs - 10)} disabled={fs <= 80} aria-label="Smaller text" data-testid="p1x-fs-down">A−</button>
            <output aria-live="polite" data-testid="p1x-fs-val">{fs}%</output>
            <button type="button" onClick={() => changeFs(fs + 10)} disabled={fs >= 170} aria-label="Larger text" data-testid="p1x-fs-up">A+</button>
            <button type="button" onClick={() => changeFs(100)} disabled={fs === 100} aria-label="Reset text size" data-testid="p1x-fs-reset">Reset</button>
          </div>
        </div>

        {all ? (
          <>
            <nav className="p1x-contents" aria-label="Contents" data-testid="p1x-contents" ref={contentsRef} tabIndex={-1}>
              <strong>Everything on one page:</strong>
              {WALK.map((w, i) => (
                <button key={w.id} type="button" className="p1x-link" onClick={() => document.getElementById(`p1x-all-${w.id}`)?.scrollIntoView?.({ behavior: 'smooth' })}>{i + 1} · {w.title}</button>
              ))}
            </nav>
            {WALK.map((w, i) => (
              <div key={w.id} id={`p1x-all-${w.id}`} className="p1x-step--all" data-testid={`p1x-all-${w.id}`}>
                <Section id={`p1x-all-h-${w.id}`} kicker={`Step ${i + 1} of ${WALK.length}`} title={w.title}>
                  {bodies[w.id]}
                </Section>
              </div>
            ))}
          </>
        ) : (
          <>
            <nav className="p1x-rail" aria-label="Walk steps" data-testid="p1x-rail">
              {WALK.map((w, i) => (
                <button key={w.id} type="button" onClick={() => go(i + 1)} aria-current={i + 1 === step ? 'step' : undefined}
                  className={i + 1 < step ? 'is-done' : i + 1 === step ? 'is-on' : ''} data-testid={`p1x-rail-${i + 1}`}>
                  <i aria-hidden="true" /><span>{i + 1} · {w.title}</span>
                </button>
              ))}
            </nav>

            <section className="p1x-step" aria-labelledby="p1x-step-h" data-testid={`p1x-step-${meta.id}`}>
              <p className="pu-kicker">{kicker}</p>
              <h2 id="p1x-step-h" ref={headingRef} tabIndex={-1} className="pu-h2">{meta.title}</h2>
              {body}
            </section>

          </>
        )}
        <div className={`p1x-nav${all ? ' p1x-nav--all' : ''}`} role="group" aria-label={all ? 'Return to the walk' : 'Walk navigation'}>
          {all ? null : <button type="button" className="pu-btn" onClick={() => go(step - 1)} disabled={step === 1} data-testid="p1x-back">← Back</button>}
          {all ? null : <span className="p1x-where" data-testid="p1x-where">{meta.title}</span>}
          <button type="button" className="pu-btn pu-btn--primary" onClick={all ? toggleAll : () => go(step === WALK.length ? 1 : step + 1)} data-testid={all ? 'p1x-all-toggle' : 'p1x-next'}>
            {all ? 'Back to the walk' : step === WALK.length ? 'Start over' : 'Next →'}
          </button>
        </div>
      </PageFrame>
    </PingPage>
  );
}

function Tag({ kind }) {
  return <span className="p1x-tag" title={EVIDENCE[kind].note}><StatusChip tone={EVIDENCE_TONE[kind]}>{EVIDENCE[kind].label}</StatusChip></span>;
}

function CopyBtn({ text, label = 'Copy' }) {
  return <button type="button" className="pu-btn p1x-copy" onClick={() => copy(text)}>{label}</button>;
}

/** A raw JWT in full (never truncated), its three parts, and a copy button. */
function RawToken({ title, token, testId }) {
  if (!token) return null;
  const [h, p, sig] = token.split('.');
  return (
    <div className="p1x-token" data-testid={testId}>
      <div className="p1x-token-head"><strong>{title}</strong> <CopyBtn text={token} label="Copy token" /></div>
      <pre className="p1x-pre p1x-wrap" data-testid={`${testId}-raw`}><span className="p1x-jwt-h">{h}</span>.<span className="p1x-jwt-p">{p}</span>.<span className="p1x-jwt-s">{sig}</span></pre>
    </div>
  );
}

/** Decoded view of every JWT found in a body: header, payload, claims with readable times, expiry badge. */
function DecodedTokens({ text, where, now }) {
  const found = findJwts(text);
  if (!found.length) return null;
  return (
    <div className="p1x-decoded" data-testid="p1x-decoded">
      {found.map((t, i) => {
        if (!t.ok) return <p key={i} className="pu-note">Token {i + 1}: {t.error}. Raw text kept above.</p>;
        const exp = t.payload.exp;
        const live = typeof exp === 'number' ? exp > now : null;
        return (
          <div key={i} className="p1x-dec">
            <div className="p1x-dec-head">
              <strong>Decoded token {found.length > 1 ? i + 1 : ''}</strong> <span className="p1x-muted">({where})</span>
              {live === null ? null : <StatusChip tone={live ? 'ok' : 'danger'}>{live ? `valid, expires ${relTime(exp, now)}` : `expired ${relTime(exp, now)}`}</StatusChip>}
              <CopyBtn text={JSON.stringify(t.payload, null, 2)} label="Copy decoded payload" />
            </div>
            <div className="p1x-cols">
              <div><h5>Header</h5><pre className="p1x-pre">{JSON.stringify(t.header, null, 2)}</pre></div>
              <div><h5>Signature</h5><pre className="p1x-pre p1x-wrap">{t.signature || '(none)'}</pre></div>
            </div>
            <table className="p1x-table" aria-label="Decoded claims"><thead><tr><th>Claim</th><th>Value</th><th>In plain English</th></tr></thead>
              <tbody>
                {Object.entries(t.payload).map(([k, v]) => (
                  <tr key={k} className={KEY_CLAIMS.includes(k) ? 'p1x-req' : undefined}>
                    <td><code>{k}</code></td>
                    <td><code>{typeof v === 'string' ? v : JSON.stringify(v)}</code></td>
                    <td>{TIME_CLAIMS.includes(k) && typeof v === 'number' ? `${new Date(v * 1000).toISOString().replace('.000Z', 'Z')} (${relTime(v, now)})` : ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      })}
    </div>
  );
}

function WireCall({ c, decode, now, idPrefix = 'p1x-call-', open }) {
  const [rawOn, setRawOn] = useState(false);
  const reqFull = `${c.method} ${c.url}\n${c.requestHeaders.map(([k, v]) => `${k}: ${v}`).join('\n')}${c.requestBody ? `\n\n${c.requestBody}` : ''}`;
  const resFull = `HTTP ${c.status} ${c.statusText}\n${c.responseHeaders.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${c.responseBody}`;
  const hasTokens = findJwts(c.requestBody).length + findJwts(c.responseBody).length > 0;
  const shrink = decode && hasTokens && !rawOn;
  return (
    <details className="p1x-call" data-testid={`${idPrefix}${c.n}`} open={open ?? c.phase === 'runtime'}>
      <summary><code>{c.n}</code> {c.label} <StatusChip tone={c.status < 300 ? 'ok' : 'danger'}>{c.status} {c.statusText}</StatusChip> <Tag kind={c.evidence} /></summary>
      <p className="pu-note">{c.notes}</p>
      {hasTokens && decode ? (
        <label className="p1x-rawtoggle"><input type="checkbox" checked={rawOn} onChange={(e) => setRawOn(e.target.checked)} data-testid={`${idPrefix}${c.n}-raw`} /> Show the full raw tokens in the text below</label>
      ) : null}
      <div className="p1x-cols">
        <div>
          <h4>Request <CopyBtn text={reqFull} /></h4>
          <pre className="p1x-pre p1x-wrap" data-testid={`${idPrefix}${c.n}-req`}>{shrink ? collapseJwts(reqFull) : reqFull}</pre>
          {decode ? <DecodedTokens text={c.requestBody} where="request body" now={now} /> : null}
          <h4>curl <CopyBtn text={c.curl} /></h4>
          <pre className="p1x-pre p1x-wrap">{c.curl}</pre>
        </div>
        <div>
          <h4>Response <CopyBtn text={resFull} /> <CopyBtn text={c.responseBody} label="Copy body" /></h4>
          <pre className="p1x-pre p1x-wrap" data-testid={`${idPrefix}${c.n}-res`}>{shrink ? collapseJwts(resFull) : resFull}</pre>
          {decode ? <DecodedTokens text={c.responseBody} where="response body" now={now} /> : null}
        </div>
      </div>
    </details>
  );
}

function Json({ value, testId }) {
  return <pre className="p1x-pre" data-testid={testId}>{JSON.stringify(value, null, 2)}</pre>;
}

function DecodeSwitch({ decode, onChange }) {
  return (
    <label className="p1x-switch" data-testid="p1x-decode-switch">
      <input type="checkbox" checked={decode} onChange={(e) => onChange(e.target.checked)} data-testid="p1x-decode" />
      <span><strong>Decode tokens inline</strong> <span className="p1x-muted">(each token is shown decoded under it, so you don&apos;t need to copy it to a decoder; Copy always gives the full raw token)</span></span>
    </label>
  );
}

function stepBodies({ vendor, vendorId, setVendorId, run, subject, mapped, issued, diagram, wire, decode, toggleDecode, now, settings, set, assigned, setAssigned, state, setState, reset, exchangeCall }) {
  return {
    idea: (
      <>
        <p className="pu-lede">An app has a PingOne token for the user, and a token from somewhere else (PingFederate, Okta, Auth0, Microsoft). PingOne can now check the second one and mix what it says into the token it hands back.</p>
        <CardGrid>
          <Card tone="neutral" title="Before">
            <p className="pu-status-line"><StatusChip tone="neutral">Same environment only</StatusChip></p>
            <p>Both tokens had to come from <strong>the same PingOne environment</strong>.</p>
          </Card>
          <Card tone="ok" title="Now">
            <p className="pu-status-line"><StatusChip tone="ok">Any trusted issuer</StatusChip></p>
            <p>The second token can come from <strong>any issuer you trust</strong>, as long as it is a signed JWT.</p>
          </Card>
        </CardGrid>
        <h3 className="pu-h3 p1x-h3">Four steps to set it up <Tag kind="guide" /></h3>
        <ol className="p1x-steps" data-testid="p1x-setup-steps">
          {STEPS.map((x) => <li key={x.n}><strong>{x.title}.</strong> {x.body} <code>{x.where}</code></li>)}
        </ol>
        <p className="p1x-why"><strong>Why you care:</strong> a partner or an agent platform keeps its own identity system. You can still say who acted, without moving anyone&apos;s identities.</p>
        <details className="p1x-legend-details"><summary>How to read the labels</summary>
          <section className="p1x-legend" aria-label="Evidence labels" data-testid="p1x-legend">
            {Object.keys(EVIDENCE).map((k) => <p key={k}><Tag kind={k} /> {EVIDENCE[k].note}</p>)}
          </section>
        </details>
      </>
    ),
    issuer: (
      <>
        <p className="pu-lede">Pick an issuer. Its sample token is used for the rest of the walk.</p>
        <div role="radiogroup" aria-label="Third-party issuer" className="pu-actions">
          {VENDORS.map((v) => (
            <button key={v.id} type="button" role="radio" aria-checked={v.id === vendorId} data-testid={`p1x-vendor-${v.id}`}
              className="pu-btn p1x-vendor" onClick={() => setVendorId(v.id)}>{v.id === vendorId ? <span aria-hidden="true">✓ </span> : null}{v.name}</button>
          ))}
        </div>
        <p className="pu-note"><Tag kind={vendor.evidence} /> {vendor.note}</p>
        <DecodeSwitch decode={decode} onChange={toggleDecode} />
        <CardGrid>
          <Card title={`Actor token: ${vendor.name}`}>
            <p className="pu-status-line"><StatusChip tone="neutral">Sample</StatusChip> Mock signature, never verifiable.</p>
            <Json value={run.claims} testId="p1x-actor" />
            <RawToken title="Actor token, raw (mock signature, never verifiable)" token={wire.tokens.actor} testId="p1x-raw-actor" />
            {decode ? <DecodedTokens text={wire.tokens.actor} where="actor token" now={now} /> : null}
          </Card>
          <Card tone="neutral" title="Subject token (PingOne, placeholder values)">
            <p className="pu-status-line"><StatusChip tone="neutral">Placeholder</StatusChip> Not issued by a real tenant.</p>
            <Json value={subject} testId="p1x-subject" />
            <RawToken title="Subject token, raw (mock)" token={wire.tokens.subject} testId="p1x-raw-subject" />
          </Card>
        </CardGrid>
      </>
    ),
    trust: (
      <>
        <p className="pu-lede">The admin defines a <strong>trusted issuer</strong> and decides what to insist on. Change a switch and watch the request on the right.</p>
        <CardGrid>
          <Card>
            <fieldset className="p1x-fields">
              <legend>Trusted issuer settings <Tag kind="measured" /></legend>
              <label><input type="checkbox" checked={settings.expRequired} onChange={set('expRequired')} data-testid="p1x-exp" /> exp required</label>
              <label><input type="checkbox" checked={settings.iatRequired} onChange={set('iatRequired')} data-testid="p1x-iat" /> iat required</label>
              <label><input type="checkbox" checked={settings.nbfRequired} onChange={set('nbfRequired')} data-testid="p1x-nbf" /> nbf required</label>
              <label>Clock skew, seconds (0 to 60)
                <input type="number" min="0" max="60" value={settings.clockSkew} onChange={set('clockSkew')} data-testid="p1x-skew" />
              </label>
              <label>Max future validity, seconds (0 = no limit)
                <input type="number" min="0" value={settings.maxFutureValidity} onChange={set('maxFutureValidity')} data-testid="p1x-maxfuture" />
              </label>
              <label>Audiences (comma separated, blank accepts any)
                <input type="text" value={settings.audiences} onChange={set('audiences')} data-testid="p1x-aud" placeholder="blank" />
              </label>
              <label><input type="checkbox" checked={assigned} onChange={(e) => setAssigned(e.target.checked)} data-testid="p1x-assigned" /> Assigned to the application</label>
            </fieldset>
            <fieldset className="p1x-fields">
              <legend>Actor token state</legend>
              {TOKEN_STATES.map((t) => (
                <label key={t.id}><input type="radio" name="p1x-state" checked={state === t.id} onChange={() => setState(t.id)} data-testid={`p1x-state-${t.id}`} /> {t.label}</label>
              ))}
              <div className="pu-actions"><button type="button" className="pu-btn" onClick={reset} data-testid="p1x-reset">Reset</button></div>
            </fieldset>
          </Card>
          <Card tone="neutral" title={<>What the admin sends <Tag kind="measured" /></>}>
            <p className="pu-note pu-mono">{wire.setup[0].method} {wire.setup[0].url}</p>
            <pre className="p1x-pre p1x-wrap" data-testid="p1x-trust-body">{wire.setup[0].requestBody}</pre>
          </Card>
        </CardGrid>
      </>
    ),
    send: (
      <>
        <p className="pu-lede">One request. The third-party token goes in as the <strong>actor</strong> and must say it is a JWT.</p>
        <SequenceFlowDiagram
          key={`${vendor.id}-${run.ok}-${run.failed?.id || 'ok'}`}
          source={diagram.source}
          payloads={diagram.payloads}
          details={DIAGRAM_DETAILS}
          lanes={DIAGRAM_LANES}
          label={`Third-party token exchange: ${vendor.name}`}
        />
        <h3 className="pu-h3 p1x-h3">Token request <Tag kind="measured" /></h3>
        <pre className="p1x-pre" data-testid="p1x-request">{requestText()}</pre>
        <DecodeSwitch decode={decode} onChange={toggleDecode} />
        <WireCall key={`ex-${exchangeCall.n}`} c={exchangeCall} decode={decode} now={now} idPrefix="p1x-feat-" open />
        <details className="p1x-wire-details" data-testid="p1x-wire">
          <summary>Show all {wire.all.length} API calls, setup and runtime</summary>
          <p className="pu-note">
            All headers, the exact request and response bodies, with the raw tokens. Values are mock: the client secret is made up on purpose, the JWT signatures and the JWKS key are fake.
            Shapes follow what PingOne returned in the live run. Each call has a curl.
          </p>
          <h3 className="pu-h3 p1x-h3">Setup: what an admin creates</h3>
          {wire.setup.map((c) => <WireCall key={c.n} c={c} decode={decode} now={now} />)}
          <h3 className="pu-h3 p1x-h3">Runtime: what the application sends</h3>
          {wire.runtime.map((c) => <WireCall key={c.n} c={c} decode={decode} now={now} />)}
        </details>
      </>
    ),
    result: (
      <>
        <Card tone={run.ok ? 'ok' : 'danger'} role="status" data-testid="p1x-verdict" data-ok={String(run.ok)}>
          <p className="pu-status-line">
            <StatusChip tone={run.ok ? 'ok' : 'danger'}>{run.ok ? 'Succeeds (simulated)' : 'Refused (simulated)'}</StatusChip>
            <strong>{run.ok ? 'Simulated result: the exchange succeeds and a token is issued' : `Simulated result: the exchange is refused, ${run.failed.label}`}</strong>
            <Tag kind="measured" />
          </p>
          {run.ok ? null : <pre className="p1x-pre" data-testid="p1x-error">{`HTTP ${run.error.status}\n${JSON.stringify({ error: run.error.error, error_description: run.error.error_description }, null, 2)}`}</pre>}
          <p className="pu-note">Each refusal text is what PingOne returned for that fault, run on its own. The order PingOne checks things in is not known, so with two faults at once it may name the other one.</p>
        </Card>
        <CardGrid>
          <Card tone="neutral" title="What PingOne checked">
            <div className="p1x-scroll">
              <table className="p1x-table" data-testid="p1x-checks" aria-label="Checks on the third-party token">
                <thead><tr><th>Check</th><th>Detail</th><th>Result</th></tr></thead>
                <tbody>
                  {run.checks.map((c) => (
                    <tr key={c.id}><td>{c.label}</td><td><code>{c.detail}</code></td><td><StatusChip tone={c.ok ? 'ok' : 'danger'}>{c.ok ? 'pass' : 'fail'}</StatusChip></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card tone={run.ok ? 'ok' : 'neutral'} title="Attribute mapping on the custom resource">
            <ul className="p1x-maps" data-testid="p1x-maps">
              {mapped.map(({ m, r }) => (
                <li key={m.id}><Tag kind={m.evidence} /> {m.label}. {m.note}{' '}
                  <strong>{r.present ? 'Source claim present.' : `The token has no ${m.source}, so no claim is added.`}</strong></li>
              ))}
            </ul>
            <h3 className="pu-h3 p1x-h3">{run.ok ? 'Issued access token' : 'Nothing issued'}</h3>
            {run.ok ? <Json value={issued} testId="p1x-issued" /> : <p className="pu-note">The exchange was refused, so no token is issued.</p>}
          </Card>
        </CardGrid>
        {run.ok ? (
          <>
            <DecodeSwitch decode={decode} onChange={toggleDecode} />
            <RawToken title="Issued access token, raw (mock)" token={wire.tokens.issued} testId="p1x-raw-issued" />
            {decode ? <DecodedTokens text={wire.tokens.issued} where="issued token" now={now} /> : null}
          </>
        ) : null}
      </>
    ),
    compare: (
      <>
        <p className="pu-lede">The same idea, named differently by each issuer. The calling app id is the one you will map most. <Tag kind="sample" /></p>
        <p className="pu-note">From the comparison sheet. A dash means the sheet says not included or not defined. The sheet lists Okta aud as not found, though Okta&apos;s sample token has aud, so the sample is what the picker uses.</p>
        <Card tone="neutral">
          <div className="p1x-scroll">
            <table className="p1x-table" data-testid="p1x-compare">
              <thead><tr><th>Claim</th>{COMPARE_COLUMNS.map((c) => <th key={c}>{c}</th>)}</tr></thead>
              <tbody>
                {COMPARE_ROWS.map(([label, ...cells]) => (
                  <tr key={label}><th scope="row">{label}</th>{cells.map((c, i) => <td key={COMPARE_COLUMNS[i]} className={c === null ? 'p1x-none' : undefined}>{c === null ? '–' : <code>{c}</code>}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </>
    ),
    know: (
      <>
        <h3 className="pu-h3 p1x-h3">Admin API, permissions and licensing <Tag kind="guide" /></h3>
        <CardGrid>
          <Card tone="neutral" title="POST /trustedIssuers"><Json value={API_SAMPLES.trustedIssuer} testId="p1x-api-issuer" /></Card>
          <Card tone="neutral" title="POST /applications/<appId>/trustedIssuerAssignments"><Json value={API_SAMPLES.assignment} testId="p1x-api-assignment" /></Card>
        </CardGrid>
        <Card tone="neutral">
          <KvList items={ADMIN_FACTS.map(([label, value]) => ({ label, value }))} />
        </Card>
        <p className="pu-note">Issued tokens in the mock carry iss <code>{P1_ISSUER}</code>, a placeholder.</p>
        <Card tone="warn" role="region" aria-labelledby="p1x-notshown" data-testid="p1x-notshown">
          <h3 id="p1x-notshown" className="pu-h3">What this page does not show <Tag kind="unverified" /></h3>
          <ul>{NOT_SHOWN.map((t) => <li key={t}>{t}</li>)}</ul>
        </Card>
        <p className="pu-note">Setup steps for the lab: <code>{SETUP_DOC}</code>.</p>
      </>
    ),
    real: (
      <>
        <p className="pu-lede">This page never calls PingOne. The standalone <strong>p1-third-party-exchange</strong> lab does: it has two Real exchange tabs that send an actual RFC 8693 request to <strong>your own PingOne</strong>.</p>
        <CardGrid>
          <Card tone="ok" title="Real exchange (your browser)">
            <p className="pu-status-line"><StatusChip tone="ok">Real</StatusChip> Your browser posts straight to your PingOne token endpoint.</p>
            <p>The client secret lives only in that page&apos;s React state: no storage, no URL, no server in between. Strict URL checks allow only <code>auth.pingone.&lt;region&gt;</code> token endpoints.</p>
            <div className="pu-actions"><a className="pu-btn" href={`${REAL_LAB}#realbrowser`} target="_blank" rel="noreferrer" data-testid="p1x-real-browser">Open Real exchange (your browser) ↗</a></div>
          </Card>
          <Card tone="neutral" title="Real exchange (local)">
            <p className="pu-status-line"><StatusChip tone="neutral">Real</StatusChip> A local helper sends the request for you.</p>
            <p>Same real PingOne call, sent by the lab&apos;s local server instead of the browser. Useful when you want the exchange captured in the lab&apos;s wire view.</p>
            <div className="pu-actions"><a className="pu-btn" href={`${REAL_LAB}#reallocal`} target="_blank" rel="noreferrer" data-testid="p1x-real-local">Open Real exchange (local) ↗</a></div>
          </Card>
        </CardGrid>
        <p className="p1x-why"><strong>Before you go:</strong> you need a trusted issuer defined and assigned to a non-worker OIDC application with the token-exchange grant. Setup steps: <code>{SETUP_DOC}</code>.</p>
        <p className="pu-note">Everything before this step was simulated: the walk&apos;s refusals are replays of measured PingOne behaviour, not live results. The lab&apos;s tabs show what <em>your</em> tenant actually returns.</p>
      </>
    ),
  };
}
