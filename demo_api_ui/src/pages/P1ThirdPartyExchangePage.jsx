// /p1-third-party-exchange: PingOne token exchange with third-party signed JWTs as actor tokens. A mock: no PingOne call.
// Pick an issuer (PingFederate, Okta, Auth0, Microsoft, RFC 9068, another PingOne), change the trusted issuer settings and
// the token state, and see the checks, the request, the decoded tokens, the attribute mapping and the issued token.
import React, { useMemo, useState } from 'react';
import PageHeader from '../components/common/PageHeader';
import SequenceFlowDiagram from '../components/SequenceFlowDiagram';
import {
  ADMIN_FACTS, API_SAMPLES, COMPARE_COLUMNS, COMPARE_ROWS, DIAGRAM_DETAILS, DIAGRAM_LANES, EVIDENCE, NOT_SHOWN, P1_ISSUER, STEPS,
  TOKEN_STATES, TRUSTED_ISSUER_DEFAULTS, VENDORS, applyMapping, buildWire, collapseJwts, exchangeDiagram, findJwts, KEY_CLAIMS, relTime, TIME_CLAIMS, requestText, resultClaims, subjectClaims, validateExchange,
} from '../config/p1ThirdPartyExchange';
import './P1ThirdPartyExchangePage.css';

const SETUP_DOC = 'docs/runbooks/p1-third-party-token-exchange.md';

function Tag({ kind }) {
  return <span className={`p1x-tag p1x-tag--${kind}`} title={EVIDENCE[kind].note}>{EVIDENCE[kind].label}</span>;
}

const copy = (text) => { try { navigator.clipboard?.writeText(text); } catch { /* clipboard blocked: the text is on screen */ } };

function CopyBtn({ text, label = 'Copy' }) {
  return <button type="button" className="p1x-copy" onClick={() => copy(text)}>{label}</button>;
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

const readPref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
const savePref = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* blocked storage: the switch still works for this visit */ } };

/** Decoded view of every JWT found in a body: header, payload, claims with readable times, expiry badge. */
function DecodedTokens({ text, where, now }) {
  const found = findJwts(text);
  if (!found.length) return null;
  return (
    <div className="p1x-decoded" data-testid="p1x-decoded">
      {found.map((t, i) => {
        if (!t.ok) return <p key={i} className="p1x-muted">Token {i + 1}: {t.error}. Raw text kept above.</p>;
        const exp = t.payload.exp;
        const live = typeof exp === 'number' ? exp > now : null;
        return (
          <div key={i} className="p1x-dec">
            <div className="p1x-dec-head">
              <strong>Decoded token {found.length > 1 ? i + 1 : ''}</strong> <span className="p1x-muted">({where})</span>
              {live === null ? null : <span className={`p1x-tag ${live ? 'p1x-tag--guide' : 'p1x-tag--unverified'}`}>{live ? `valid, expires ${relTime(exp, now)}` : `expired ${relTime(exp, now)}`}</span>}
              <CopyBtn text={JSON.stringify(t.payload, null, 2)} label="Copy decoded payload" />
            </div>
            <div className="p1x-grid">
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

function WireCall({ c, decode, now }) {
  const [rawOn, setRawOn] = useState(false);
  const reqFull = `${c.method} ${c.url}\n${c.requestHeaders.map(([k, v]) => `${k}: ${v}`).join('\n')}${c.requestBody ? `\n\n${c.requestBody}` : ''}`;
  const resFull = `HTTP ${c.status} ${c.statusText}\n${c.responseHeaders.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n${c.responseBody}`;
  const hasTokens = findJwts(c.requestBody).length + findJwts(c.responseBody).length > 0;
  const shrink = decode && hasTokens && !rawOn;
  return (
    <details className="p1x-call" data-testid={`p1x-call-${c.n}`} open={c.phase === 'runtime'}>
      <summary><code>{c.n}</code> {c.label} <span className={c.status < 300 ? 'p1x-ok' : 'p1x-bad'}>{c.status} {c.statusText}</span> <Tag kind={c.evidence} /></summary>
      <p className="p1x-muted">{c.notes}</p>
      {hasTokens && decode ? (
        <label className="p1x-rawtoggle"><input type="checkbox" checked={rawOn} onChange={(e) => setRawOn(e.target.checked)} data-testid={`p1x-call-${c.n}-raw`} /> Show the full raw tokens in the text below</label>
      ) : null}
      <div className="p1x-grid">
        <div>
          <h4>Request <CopyBtn text={reqFull} /></h4>
          <pre className="p1x-pre p1x-wrap" data-testid={`p1x-call-${c.n}-req`}>{shrink ? collapseJwts(reqFull) : reqFull}</pre>
          {decode ? <DecodedTokens text={c.requestBody} where="request body" now={now} /> : null}
          <h4>curl <CopyBtn text={c.curl} /></h4>
          <pre className="p1x-pre p1x-wrap">{c.curl}</pre>
        </div>
        <div>
          <h4>Response <CopyBtn text={resFull} /> <CopyBtn text={c.responseBody} label="Copy body" /></h4>
          <pre className="p1x-pre p1x-wrap" data-testid={`p1x-call-${c.n}-res`}>{shrink ? collapseJwts(resFull) : resFull}</pre>
          {decode ? <DecodedTokens text={c.responseBody} where="response body" now={now} /> : null}
        </div>
      </div>
    </details>
  );
}

function Json({ value, testId }) {
  return <pre className="p1x-pre" data-testid={testId}>{JSON.stringify(value, null, 2)}</pre>;
}

export default function P1ThirdPartyExchangePage() {
  const [vendorId, setVendorId] = useState('pf-cc');
  const [state, setState] = useState('valid');
  const [settings, setSettings] = useState(TRUSTED_ISSUER_DEFAULTS);
  const [assigned, setAssigned] = useState(true);
  const [now] = useState(() => Math.floor(Date.now() / 1000));
  const [decode, setDecode] = useState(() => readPref('p1x-decode', true));
  const toggleDecode = (on) => { setDecode(on); savePref('p1x-decode', on); };

  const vendor = VENDORS.find((v) => v.id === vendorId);
  const run = useMemo(() => validateExchange({ vendor, state, settings, assigned, now }), [vendor, state, settings, assigned, now]);
  const subject = useMemo(() => subjectClaims(now), [now]);
  const mapped = useMemo(() => vendor.mappings.map((m) => ({ m, r: applyMapping(m, run.claims) })), [vendor, run.claims]);
  const issued = useMemo(() => resultClaims(subject, run.ok ? { claim: Object.assign({}, ...mapped.map(({ r }) => r.claim || {})) } : null, now), [subject, mapped, run.ok, now]);
  const diagram = useMemo(() => exchangeDiagram(vendor, run), [vendor, run]);
  const wire = useMemo(() => buildWire({ vendor, run, settings, assigned, now }), [vendor, run, settings, assigned, now]);
  const set = (k) => (e) => setSettings((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const reset = () => { setState('valid'); setSettings(TRUSTED_ISSUER_DEFAULTS); setAssigned(true); };

  return (
    <main className="p1x-page" data-testid="p1-third-party-exchange-page">
      <PageHeader
        eyebrow="Diagrams · PingOne"
        title="PingOne token exchange with third-party tokens"
        summary="PingOne can trust JWTs signed by another issuer (PingFederate, Okta, Auth0, Microsoft, another PingOne environment) and accept them as the subject or actor token in an RFC 8693 token exchange. Claims from that token can then be mapped into the access token PingOne issues."
        back={{ to: '/diagrams', label: 'All diagrams' }}
      />

      <p className="p1x-banner" role="note" data-testid="p1x-banner">
        <strong>Simulated.</strong> This page makes no PingOne call, but its refusal messages and settings behaviour were measured live against PingOne on
        2026-10-27. The capability is behind a feature flag (Phase 2 of P14C-83104, for Ping staff and selected customers): the guide gives no flag name,
        so check with Ping that it is on in your environment. Setup steps:{' '}
        <code>{SETUP_DOC}</code>.
      </p>

      <section className="p1x-legend" aria-label="Evidence labels" data-testid="p1x-legend">
        {Object.keys(EVIDENCE).map((k) => <p key={k}><Tag kind={k} /> {EVIDENCE[k].note}</p>)}
      </section>

      <section className="p1x-card" aria-labelledby="p1x-steps">
        <h2 id="p1x-steps">How it is set up <Tag kind="guide" /></h2>
        <ol className="p1x-steps">
          {STEPS.map((s) => (
            <li key={s.n}><strong>{s.title}.</strong> {s.body} <code>{s.where}</code></li>
          ))}
        </ol>
      </section>

      <section className="p1x-card" aria-labelledby="p1x-try">
        <h2 id="p1x-try">Try an issuer</h2>
        <div role="radiogroup" aria-label="Third-party issuer" className="p1x-chips">
          {VENDORS.map((v) => (
            <button key={v.id} type="button" role="radio" aria-checked={v.id === vendorId} data-testid={`p1x-vendor-${v.id}`}
              className={`p1x-chip${v.id === vendorId ? ' p1x-chip--on' : ''}`} onClick={() => setVendorId(v.id)}>{v.name}</button>
          ))}
        </div>
        <p className="p1x-muted"><Tag kind={vendor.evidence} /> {vendor.note}</p>

        <div className="p1x-grid">
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
            <button type="button" className="p1x-chip" onClick={reset} data-testid="p1x-reset">Reset</button>
          </fieldset>
        </div>

        <div className={`p1x-verdict p1x-verdict--${run.ok ? 'ok' : 'bad'}`} role="status" data-testid="p1x-verdict" data-ok={String(run.ok)}>
          <strong>{run.ok ? 'Exchange succeeds: a token is issued' : `Exchange refused: ${run.failed.label}`}</strong>
          <span> <Tag kind="measured" /></span>
          {run.ok ? null : <pre className="p1x-pre" data-testid="p1x-error">{`HTTP ${run.error.status}\n${JSON.stringify({ error: run.error.error, error_description: run.error.error_description }, null, 2)}`}</pre>}
          <p className="p1x-muted">Each refusal text is what PingOne returned for that fault, run on its own. The order PingOne checks things in is not known, so with two faults at once it may name the other one.</p>
        </div>

        <table className="p1x-table" data-testid="p1x-checks" aria-label="Checks on the third-party token">
          <thead><tr><th>Check</th><th>Detail</th><th>Result</th></tr></thead>
          <tbody>
            {run.checks.map((c) => (
              <tr key={c.id}><td>{c.label}</td><td><code>{c.detail}</code></td><td className={c.ok ? 'p1x-ok' : 'p1x-bad'}>{c.ok ? 'pass' : 'fail'}</td></tr>
            ))}
          </tbody>
        </table>

        <div className="p1x-grid">
          <div>
            <h3>Token request <Tag kind="measured" /></h3>
            <pre className="p1x-pre" data-testid="p1x-request">{requestText()}</pre>
          </div>
          <div>
            <h3>Subject token (PingOne, placeholder values)</h3>
            <Json value={subject} testId="p1x-subject" />
            <RawToken title="Subject token, raw (mock)" token={wire.tokens.subject} testId="p1x-raw-subject" />
          </div>
        </div>
        <div className="p1x-grid">
          <div>
            <h3>Actor token: {vendor.name}</h3>
            <Json value={run.claims} testId="p1x-actor" />
            <RawToken title="Actor token, raw (mock signature, never verifiable)" token={wire.tokens.actor} testId="p1x-raw-actor" />
          </div>
          <div>
            <h3>Attribute mapping on the custom resource</h3>
            <ul className="p1x-maps" data-testid="p1x-maps">
              {mapped.map(({ m, r }) => (
                <li key={m.id}><Tag kind={m.evidence} /> {m.label}. {m.note}{' '}
                  <strong>{r.present ? 'Source claim present.' : `The token has no ${m.source}, so no claim is added.`}</strong></li>
              ))}
            </ul>
            <h3>{run.ok ? 'Issued access token' : 'Nothing issued'}</h3>
            {run.ok ? <Json value={issued} testId="p1x-issued" /> : <p className="p1x-muted">The exchange was refused, so no token is issued.</p>}
            {run.ok ? <RawToken title="Issued access token, raw (mock)" token={wire.tokens.issued} testId="p1x-raw-issued" /> : null}
          </div>
        </div>

        <SequenceFlowDiagram
          key={`${vendor.id}-${run.ok}-${run.failed?.id || 'ok'}`}
          source={diagram.source}
          payloads={diagram.payloads}
          details={DIAGRAM_DETAILS}
          lanes={DIAGRAM_LANES}
          label={`Third-party token exchange: ${vendor.name}`}
        />
      </section>

      <section className="p1x-card" aria-labelledby="p1x-wire" data-testid="p1x-wire">
        <h2 id="p1x-wire">Every API call, in full <Tag kind="measured" /></h2>
        <p className="p1x-muted">
          All headers, the exact request body and the exact response body, with the raw tokens. Values are mock: the client secret shown is made up on purpose,
          the JWT signatures and the JWKS key are fake. Request and response shapes follow what PingOne returned in the live run. Each call has a curl you can adapt.
        </p>
        <label className="p1x-switch" data-testid="p1x-decode-switch">
          <input type="checkbox" checked={decode} onChange={(e) => toggleDecode(e.target.checked)} data-testid="p1x-decode" />
          <span><strong>Decode tokens inline</strong> <span className="p1x-muted">(on: each token is shown decoded under its call, so you don't need to copy it to a decoder; Copy always gives the full raw token)</span></span>
        </label>
        <h3>Setup: what an admin creates</h3>
        {wire.setup.map((c) => <WireCall key={c.n} c={c} decode={decode} now={now} />)}
        <h3>Runtime: what the application sends</h3>
        {wire.runtime.map((c) => <WireCall key={c.n} c={c} decode={decode} now={now} />)}
      </section>

      <section className="p1x-card" aria-labelledby="p1x-compare">
        <h2 id="p1x-compare">What each issuer puts in its token <Tag kind="sample" /></h2>
        <p className="p1x-muted">From the comparison sheet. A dash means the sheet says not included or not defined. The sheet lists Okta aud as not found, though Okta&apos;s sample token has aud, so the sample is what the picker above uses.</p>
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
      </section>

      <section className="p1x-card" aria-labelledby="p1x-admin">
        <h2 id="p1x-admin">Admin API, permissions and licensing <Tag kind="guide" /></h2>
        <div className="p1x-grid">
          <div><h3>POST /trustedIssuers</h3><Json value={API_SAMPLES.trustedIssuer} testId="p1x-api-issuer" /></div>
          <div><h3>POST /applications/&lt;appId&gt;/trustedIssuerAssignments</h3><Json value={API_SAMPLES.assignment} testId="p1x-api-assignment" /></div>
        </div>
        <dl className="p1x-facts">
          {ADMIN_FACTS.map(([k, v]) => <React.Fragment key={k}><dt>{k}</dt><dd>{v}</dd></React.Fragment>)}
        </dl>
        <p className="p1x-muted">Issued tokens in the mock carry iss <code>{P1_ISSUER}</code>, a placeholder.</p>
      </section>

      <section className="p1x-card" aria-labelledby="p1x-notshown" data-testid="p1x-notshown">
        <h2 id="p1x-notshown">What this page does not show <Tag kind="unverified" /></h2>
        <ul>{NOT_SHOWN.map((t) => <li key={t}>{t}</li>)}</ul>
      </section>
    </main>
  );
}
