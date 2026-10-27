/* eslint-disable no-template-curly-in-string -- SpEL expressions are asserted as text */
import { describe, it, expect, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import P1ThirdPartyExchangePage from '../P1ThirdPartyExchangePage';
import { parseSequence } from '../../utils/parseSequence';
import {
  COMPARE_COLUMNS, COMPARE_ROWS, DIAGRAM_DETAILS, TRUSTED_ISSUER_DEFAULTS, VENDORS, applyMapping, buildWire, collapseJwts, decodeJwt, findJwts, relTime, exchangeDiagram, mockJwt, toCurl, validateExchange,
} from '../../config/p1ThirdPartyExchange';

const NOW = 1_800_000_000;
const run = (id, over = {}) => validateExchange({ vendor: VENDORS.find((v) => v.id === id), state: 'valid', settings: TRUSTED_ISSUER_DEFAULTS, assigned: true, now: NOW, ...over });

describe('validateExchange', () => {
  it('passes every vendor with the guide defaults', () => {
    for (const v of VENDORS) expect(run(v.id).ok, v.id).toBe(true);
  });
  it('fails vendors without nbf when nbf is required, passes the Microsoft ones', () => {
    const settings = { ...TRUSTED_ISSUER_DEFAULTS, nbfRequired: true };
    expect(VENDORS.filter((v) => !run(v.id, { settings }).ok).map((v) => v.id)).toEqual(['pf-cc', 'pf-oidc', 'p1', 'okta', 'auth0', 'rfc9068']);
  });
  it('fails the PingFederate client-credentials token (no iat) when iat is required', () => {
    const r = run('pf-cc', { settings: { ...TRUSTED_ISSUER_DEFAULTS, iatRequired: true } });
    expect(r.failed.id).toBe('iat');
  });
  it('refuses an unassigned issuer, an untrusted issuer, an expired token and a bad signature', () => {
    expect(run('okta', { assigned: false }).failed.id).toBe('assigned');
    expect(run('okta', { state: 'wrong-issuer' }).failed.id).toBe('issuer');
    expect(run('okta', { state: 'expired' }).failed.id).toBe('exp');
    expect(run('okta', { state: 'bad-signature' }).failed.id).toBe('signature');
  });
  it('matches audiences against string and array aud, blank accepts any', () => {
    const s = (audiences) => ({ ...TRUSTED_ISSUER_DEFAULTS, audiences });
    expect(run('okta', { settings: s('https://api.example.com') }).ok).toBe(true);
    expect(run('auth0', { settings: s('x, https://example.com/health-api') }).ok).toBe(true);
    expect(run('okta', { settings: s('other') }).failed.id).toBe('aud');
  });
  it('returns the exact PingOne refusal text measured live, as a 400 invalid_request', () => {
    const msg = (id, over) => run(id, over).error.error_description.split('.: ')[1];
    expect(run('okta', { state: 'expired' }).error).toMatchObject({ status: 400, error: 'invalid_request' });
    expect(msg('okta', { state: 'expired' })).toBe('The provided JWT has expired');
    expect(msg('okta', { state: 'bad-signature' })).toBe('JWT signature verification failed');
    expect(msg('okta', { state: 'wrong-issuer' })).toBe('The token issuer does not match any Trusted Issuer assigned to the application');
    expect(msg('okta', { assigned: false })).toBe('The token issuer does not match any Trusted Issuer for the requesting application');
    expect(msg('okta', { settings: { ...TRUSTED_ISSUER_DEFAULTS, nbfRequired: true } })).toBe('Missing nbf claim; the Trusted Issuer requires a not-before time');
    expect(msg('pf-cc', { settings: { ...TRUSTED_ISSUER_DEFAULTS, iatRequired: true } })).toBe('Missing iat claim; the Trusted Issuer requires an issued-at time');
    expect(msg('okta', { settings: { ...TRUSTED_ISSUER_DEFAULTS, audiences: 'other' } })).toBe("None of the token's aud values match the Trusted Issuer's configured audiences");
  });
  it('clock skew rescues a recently expired token only up to 60s, as measured', () => {
    const okta = VENDORS.find((v) => v.id === 'okta');
    const expiredBy = (secs, clockSkew) => validateExchange({ vendor: { ...okta, claims: (n) => ({ ...okta.claims(n), exp: n - secs }) }, state: 'valid', settings: { ...TRUSTED_ISSUER_DEFAULTS, clockSkew }, assigned: true, now: NOW }).ok;
    expect(expiredBy(30, 60)).toBe(true);
    expect(expiredBy(120, 60)).toBe(false);
    expect(expiredBy(30, 0)).toBe(false);
    expect(expiredBy(120, 999)).toBe(false);
  });
  it('maxFutureValidity refuses an exp that is too far ahead and 0 means no limit', () => {
    const okta = VENDORS.find((v) => v.id === 'okta');
    const far = { ...okta, claims: (n) => ({ ...okta.claims(n), exp: n + 86400 }) };
    const r = (maxFutureValidity) => validateExchange({ vendor: far, state: 'valid', settings: { ...TRUSTED_ISSUER_DEFAULTS, maxFutureValidity }, assigned: true, now: NOW });
    expect(r(3600).error.error_description).toContain('The exp claim exceeds the maximum allowed future validity');
    expect(r(0).ok).toBe(true);
  });
  it('ignores a missing exp only when exp is not required', () => {
    const settings = { ...TRUSTED_ISSUER_DEFAULTS, expRequired: false };
    expect(run('pf-oidc', { settings }).ok).toBe(true);
  });
});

describe('applyMapping', () => {
  it('wraps sub as an act object (guide sample A) and copies securityLevel to security (sample B)', () => {
    const cc = VENDORS.find((v) => v.id === 'pf-cc');
    expect(applyMapping(cc.mappings[0], cc.claims(NOW)).claim).toEqual({ act: { sub: 'cc_client' } });
    const id = VENDORS.find((v) => v.id === 'pf-oidc');
    expect(applyMapping(id.mappings[0], id.claims(NOW)).claim).toEqual({ security: 'Class 3' });
  });
  it('adds nothing when the source claim is absent', () => {
    expect(applyMapping({ source: 'nope', target: 'x' }, {})).toEqual({ present: false, claim: null });
  });
  it('every vendor mapping resolves against its own sample token', () => {
    for (const v of VENDORS) for (const m of v.mappings) expect(applyMapping(m, v.claims(NOW)).present, `${v.id}/${m.id}`).toBe(true);
  });
});

describe('data integrity', () => {
  it('comparison rows have one cell per column', () => {
    for (const [label, ...cells] of COMPARE_ROWS) expect(cells.length, label).toBe(COMPARE_COLUMNS.length);
  });
  it('carries no real tenant data from the guide', () => {
    const blob = JSON.stringify(VENDORS.map((v) => v.claims(NOW))) + JSON.stringify(VENDORS.map((v) => v.issuer));
    expect(blob).not.toMatch(/c6bcf635|d4229c38|imokfarm|ping-eng/);
  });
  it('mockJwt has three parts and an unverifiable signature', () => {
    const parts = mockJwt({ a: 1 }).split('.');
    expect(parts).toHaveLength(3);
    expect(parts[2]).toContain('MOCK');
  });
});

describe('buildWire: every call in full', () => {
  const wireFor = (id, over = {}) => { const r = run(id, over); return { r, w: buildWire({ vendor: VENDORS.find((v) => v.id === id), run: r, settings: TRUSTED_ISSUER_DEFAULTS, assigned: over.assigned ?? true, now: NOW }) }; };
  it('has setup and runtime calls, each with every field and a curl', () => {
    const { w } = wireFor('okta');
    expect(w.all.length).toBeGreaterThanOrEqual(9);
    for (const c of w.all) {
      for (const k of ['n', 'phase', 'label', 'method', 'url', 'requestHeaders', 'status', 'statusText', 'responseHeaders', 'responseBody', 'curl', 'evidence']) expect(c[k], `${c.n}/${k}`).toBeDefined();
      expect(c.url).toMatch(/^https:\/\//);
      expect(!(c.phase === 'setup' || /pingone/.test(c.url)) || /^https:\/\/(api|auth)\.pingone\.example\//.test(c.url), `${c.n} pingone host`).toBe(true);
      expect(JSON.stringify(c)).not.toMatch(/01d89b06|c6bcf635|imokfarm|ping-eng/);
      expect(c.curl).toContain(`curl -X ${c.method}`);
      expect(c.requestHeaders.length).toBeGreaterThan(0);
    }
    expect(w.all.map((c) => c.n)).toEqual(w.all.map((_, i) => i + 1));
  });
  it('shows the full raw tokens: nothing is truncated or a placeholder, and each decodes', () => {
    const { w, r } = wireFor('pf-cc');
    for (const t of [w.tokens.subject, w.tokens.actor, w.tokens.issued]) {
      expect(t.split('.')).toHaveLength(3);
      expect(t).not.toMatch(/[<>.]{3}|…/);
      expect(() => decodeJwt(t)).not.toThrow();
    }
    expect(decodeJwt(w.tokens.actor).payload).toEqual(r.claims);
    expect(decodeJwt(w.tokens.issued).payload.act).toEqual({ sub: 'cc_client' });
  });
  it('puts the full raw JWTs in the exchange request body and the issued JWT in the response body', () => {
    const { w } = wireFor('okta');
    const ex = w.runtime.at(-1);
    const form = new URLSearchParams(ex.requestBody);
    expect(form.get('actor_token')).toBe(w.tokens.actor);
    expect(form.get('subject_token')).toBe(w.tokens.subject);
    expect(form.get('actor_token_type')).toBe('urn:ietf:params:oauth:token-type:jwt');
    expect(JSON.parse(ex.responseBody).access_token).toBe(w.tokens.issued);
    expect(ex.requestHeaders.find(([k]) => k === 'Authorization')[1]).toMatch(/^Basic [A-Za-z0-9+/=]+$/);
  });
  it('shows the full 400 body, with no issued token, when refused', () => {
    const { w } = wireFor('okta', { state: 'expired' });
    const ex = w.runtime.at(-1);
    expect(ex.status).toBe(400);
    expect(JSON.parse(ex.responseBody).error).toBe('invalid_request');
    expect(JSON.parse(ex.responseBody).error_description).toContain('The provided JWT has expired');
    expect(w.tokens.issued).toBeNull();
  });
  it('sends the inline JWKS and the issuer settings in the trusted-issuer call, and drops the assignment when unassigned', () => {
    const { w } = wireFor('okta');
    const body = JSON.parse(w.setup[0].requestBody);
    expect(body.issuer).toBe(VENDORS.find((v) => v.id === 'okta').issuer);
    expect(typeof body.jwks).toBe('string');
    expect(JSON.parse(body.jwks).keys[0].kty).toBe('RSA');
    expect(wireFor('okta', { assigned: false }).w.setup.some((c) => /trustedIssuerAssignments/.test(c.url))).toBe(false);
  });
  it('carries the measured SpEL expressions for the mappings', () => {
    const { w } = wireFor('pf-cc');
    expect(w.setup.find((c) => /Map attribute: act/.test(c.label)).requestBody).toContain("${{'sub': #root.context.requestData.actorToken.sub}}");
  });
  it('toCurl quotes single quotes safely', () => {
    expect(toCurl({ method: 'POST', url: 'https://x.example/a', requestHeaders: [['H', "it's"]], requestBody: "a'b" })).toContain("'H: it'\\''s'");
  });
});

describe('inline token decoding', () => {
  it('finds every JWT in a urlencoded request body and in a JSON response body, decoded', () => {
    const w = buildWire({ vendor: VENDORS[0], run: run('pf-cc'), settings: TRUSTED_ISSUER_DEFAULTS, assigned: true, now: NOW });
    const ex = w.runtime.at(-1);
    const inReq = findJwts(ex.requestBody);
    expect(inReq).toHaveLength(2);
    expect(inReq.every((t) => t.ok)).toBe(true);
    expect(inReq[1].payload.sub).toBe('cc_client');
    const inRes = findJwts(ex.responseBody);
    expect(inRes).toHaveLength(1);
    expect(inRes[0].payload.act).toEqual({ sub: 'cc_client' });
    expect(inRes[0].raw).toBe(w.tokens.issued);
  });
  it('tolerates malformed tokens, huge input and non-strings without throwing', () => {
    expect(findJwts('eyJhbGciOi.eyJzdWI.sig').every((t) => t.ok === false || t.ok === true)).toBe(true);
    expect(findJwts('eyJ!!!.@@@.x')).toEqual([]);
    expect(findJwts(undefined)).toEqual([]);
    expect(findJwts('eyJabcd.eyJabcd.')[0].error).toBe('not a valid JWT');
    expect(findJwts(('eyJhbGciOi.eyJzdWIi.sig ').repeat(50))).toHaveLength(8);
    expect(findJwts(`eyJ${'a'.repeat(25000)}.eyJ${'b'.repeat(10)}.c`)[0].error).toMatch(/too long/);
  });
  it('shortens tokens only for display, keeping the full raw text recoverable', () => {
    const w = buildWire({ vendor: VENDORS[0], run: run('pf-cc'), settings: TRUSTED_ISSUER_DEFAULTS, assigned: true, now: NOW });
    const body = w.runtime.at(-1).responseBody;
    const short = collapseJwts(body);
    expect(short).toContain('chars, decoded below');
    expect(short).not.toContain(w.tokens.issued);
    expect(short.length).toBeLessThan(body.length);
    expect(body).toContain(w.tokens.issued);
  });
  it('says when a time claim is, in plain English', () => {
    expect(relTime(NOW + 3540, NOW)).toBe('in 59 min');
    expect(relTime(NOW - 120, NOW)).toBe('2 min ago');
    expect(relTime(NOW + 86400 * 2, NOW)).toBe('in 2 days');
    expect(relTime(NOW + 1, NOW)).toBe('in 1 sec');
  });
});

describe('diagram source', () => {
  it('parses for every vendor, success and failure, with a payload per message', () => {
    for (const v of VENDORS) {
      for (const state of ['valid', 'expired']) {
        const d = exchangeDiagram(v, validateExchange({ vendor: v, state, settings: TRUSTED_ISSUER_DEFAULTS, assigned: true, now: NOW }));
        const parsed = parseSequence(d.source);
        const messages = parsed.items.filter((i) => i.type === 'message').length;
        expect(messages, `${v.id}/${state}`).toBeGreaterThanOrEqual(5);
        expect(d.payloads.length, `${v.id}/${state}`).toBe(messages);
        expect(parsed.participants.map((p) => p.id)).toEqual(['A', 'V', 'P', 'R']);
      }
    }
    expect(Object.keys(DIAGRAM_DETAILS)).toEqual(['A', 'V', 'P', 'R']);
  });
});

window.scrollTo = vi.fn();

describe('P1ThirdPartyExchangePage: guided walk', () => {
  const mountAt = (n = 1) => {
    try { localStorage.clear(); } catch { /* storage unavailable in this environment: the page still works */ }
    window.history.replaceState(null, '', `#walk=${n}`);
    return render(<MemoryRouter><P1ThirdPartyExchangePage /></MemoryRouter>);
  };
  const toStep = (n) => fireEvent.click(screen.getByTestId(`p1x-rail-${n}`));
  const verdictOk = () => screen.getByTestId('p1x-verdict').dataset.ok;

  it('starts on step 1, labels itself simulated and shows the legend and the four setup steps', () => {
    mountAt(1);
    expect(screen.getByTestId('p1x-step-idea')).toBeTruthy();
    expect(screen.getByTestId('p1x-banner').textContent).toMatch(/Simulated/);
    expect(within(screen.getByTestId('p1x-legend')).getAllByText(/MEASURED|GUIDE|SAMPLE|OUR CHOICE|UNVERIFIED/).length).toBe(5);
    expect(within(screen.getByTestId('p1x-setup-steps')).getAllByRole('listitem')).toHaveLength(4);
    expect(screen.getByTestId('p1x-where').textContent).toBe('The idea');
  });
  it('shows one idea per screen: only the current step is rendered', () => {
    mountAt(2);
    expect(screen.getByTestId('p1x-step-issuer')).toBeTruthy();
    expect(screen.queryByTestId('p1x-step-idea')).toBeNull();
    expect(screen.queryByTestId('p1x-verdict')).toBeNull();
    expect(screen.queryByTestId('p1x-compare')).toBeNull();
  });
  it('Back/Next move through all 7 steps, Back is disabled on the first, and Next becomes Start over on the last', () => {
    mountAt(1);
    expect(screen.getByTestId('p1x-back').disabled).toBe(true);
    const seen = [screen.getByTestId('p1x-where').textContent];
    for (let i = 0; i < 6; i += 1) { fireEvent.click(screen.getByTestId('p1x-next')); seen.push(screen.getByTestId('p1x-where').textContent); }
    expect(seen).toEqual(['The idea', 'Pick an issuer', 'Set the trust', 'Send it', 'Read the result', 'Compare', 'What to know']);
    expect(screen.getByTestId('p1x-next').textContent).toBe('Start over');
    fireEvent.click(screen.getByTestId('p1x-next'));
    expect(screen.getByTestId('p1x-where').textContent).toBe('The idea');
  });
  it('deep links with #walk=N, and writes the hash as you move', () => {
    mountAt(5);
    expect(screen.getByTestId('p1x-step-result')).toBeTruthy();
    fireEvent.click(screen.getByTestId('p1x-back'));
    expect(window.location.hash).toBe('#walk=4');
    window.history.replaceState(null, '', '#walk=99');
    cleanup();
    render(<MemoryRouter><P1ThirdPartyExchangePage /></MemoryRouter>);
    expect(screen.getByTestId('p1x-step-know')).toBeTruthy();
  });
  it('follows a link that changes only the hash while the page is open', () => {
    mountAt(1);
    window.history.replaceState(null, '', '#walk=6');
    fireEvent(window, new HashChangeEvent('hashchange'));
    expect(screen.getByTestId('p1x-step-compare')).toBeTruthy();
  });
  it('left and right arrow keys move between steps, but not while typing in a field', () => {
    mountAt(3);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(screen.getByTestId('p1x-step-send')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(screen.getByTestId('p1x-step-trust')).toBeTruthy();
    fireEvent.keyDown(screen.getByTestId('p1x-aud'), { key: 'ArrowRight' });
    expect(screen.getByTestId('p1x-step-trust')).toBeTruthy();
  });
  it('moves focus to the new step heading', () => {
    mountAt(1);
    fireEvent.click(screen.getByTestId('p1x-next'));
    expect(screen.getByRole('heading', { name: 'Pick an issuer' })).toHaveFocus();
  });
  it('the rail marks the current step', () => {
    mountAt(4);
    expect(screen.getByTestId('p1x-rail-4').getAttribute('aria-current')).toBe('step');
    expect(screen.getByTestId('p1x-rail-3').hasAttribute('aria-current')).toBe(false);
  });

  it('keeps the choices across steps: a refusal set on step 3 is read on step 5, and Reset restores it', () => {
    mountAt(3);
    fireEvent.click(screen.getByTestId('p1x-state-expired'));
    toStep(5);
    expect(verdictOk()).toBe('false');
    expect(screen.getByTestId('p1x-error').textContent).toMatch(/invalid_request[\s\S]*The provided JWT has expired/);
    expect(screen.queryByTestId('p1x-issued')).toBeNull();
    toStep(3);
    fireEvent.click(screen.getByTestId('p1x-reset'));
    toStep(5);
    expect(verdictOk()).toBe('true');
    expect(screen.getByTestId('p1x-issued').textContent).toContain('"act"');
  });
  it('requiring nbf flips Okta to refused and picking the issuer is remembered on the next steps', () => {
    mountAt(2);
    fireEvent.click(screen.getByTestId('p1x-vendor-okta'));
    toStep(3);
    fireEvent.click(screen.getByTestId('p1x-nbf'));
    expect(screen.getByTestId('p1x-trust-body').textContent).toContain('"nbfRequired": true');
    toStep(5);
    expect(verdictOk()).toBe('false');
    expect(screen.getByTestId('p1x-error').textContent).toContain('Missing nbf claim');
    toStep(4);
    expect(screen.getByTestId('p1x-feat-10').textContent).toContain('Token exchange (refused)');
  });
  it('step 2 lists every issuer and shows the raw and decoded tokens', () => {
    mountAt(2);
    for (const v of VENDORS) expect(screen.getByTestId(`p1x-vendor-${v.id}`)).toBeTruthy();
    expect(screen.getByTestId('p1x-raw-actor-raw').textContent.split('.')).toHaveLength(3);
    expect(screen.getByTestId('p1x-raw-subject-raw').textContent.length).toBeGreaterThan(200);
    expect(within(screen.getByTestId('p1x-step-issuer')).getAllByTestId('p1x-decoded').length).toBeGreaterThan(0);
  });
  it('step 3 shows the live trusted-issuer request body for the chosen settings', () => {
    mountAt(3);
    const before = JSON.parse(screen.getByTestId('p1x-trust-body').textContent);
    expect(before.nbfRequired).toBe(false);
    fireEvent.change(screen.getByTestId('p1x-skew'), { target: { value: '45' } });
    expect(JSON.parse(screen.getByTestId('p1x-trust-body').textContent).clockSkew).toBe(45);
  });
  it('step 4 shows the diagram, the full exchange request and every API call behind a disclosure', () => {
    mountAt(4);
    expect(screen.getByTestId('p1x-request').textContent).toContain('actor_token_type=urn:ietf:params:oauth:token-type:jwt');
    expect(screen.getByTestId('p1x-feat-10-req').textContent).toMatch(/^POST https:\/\/auth\.pingone\.example\/[0-9a-f-]+\/as\/token/);
    const all = within(screen.getByTestId('p1x-wire'));
    expect(all.getByText(/Show all \d+ API calls/)).toBeTruthy();
    expect(screen.getByTestId('p1x-call-1-req').textContent).toMatch(/^POST https:\/\/api\.pingone\.example\/v1\/environments\/[0-9a-f-]+\/trustedIssuers/);
    expect(screen.getByTestId('p1x-call-1-res').textContent).toMatch(/HTTP 201 Created[\s\S]*Cache-Control: no-store/);
  });
  it('step 5 shows the issued token raw and decoded, with the checks and mapping', () => {
    mountAt(5);
    expect(verdictOk()).toBe('true');
    expect(screen.getByTestId('p1x-raw-issued-raw').textContent.split('.')).toHaveLength(3);
    expect(within(screen.getByTestId('p1x-step-result')).getAllByTestId('p1x-decoded').length).toBeGreaterThan(0);
    expect(within(screen.getByTestId('p1x-checks')).getAllByRole('row').length).toBeGreaterThan(5);
    expect(screen.getByTestId('p1x-maps').textContent).toMatch(/act/);
  });
  it('step 6 has the comparison table and step 7 says what the page does not show', () => {
    mountAt(6);
    expect(within(screen.getByTestId('p1x-compare')).getAllByRole('row').length).toBe(COMPARE_ROWS.length + 1);
    toStep(7);
    expect(screen.getByTestId('p1x-notshown').textContent).toMatch(/SUBJECT token/);
    expect(screen.getByTestId('p1x-api-issuer').textContent).toContain('"issuer"');
  });

  it('decodes tokens inline by default; the switch turns it off and is remembered', () => {
    mountAt(4);
    const sw = screen.getByTestId('p1x-decode');
    expect(sw.checked).toBe(true);
    const feat = screen.getByTestId('p1x-feat-10');
    expect(within(feat).getAllByTestId('p1x-decoded').length).toBeGreaterThan(0);
    expect(feat.textContent).toMatch(/valid, expires in 59 min|valid, expires in 1 hour/);
    expect(screen.getByTestId('p1x-feat-10-res').textContent).toContain('chars, decoded below');
    fireEvent.click(sw);
    expect(within(feat).queryAllByTestId('p1x-decoded')).toHaveLength(0);
    expect(screen.getByTestId('p1x-feat-10-res').textContent).not.toContain('chars, decoded below');
    let stored = '1';
    try { stored = localStorage.getItem('p1x-decode'); } catch { stored = '0'; }
    expect(stored).toBe('0');
  });
  it('the per-call raw toggle restores the full token in the text', () => {
    mountAt(4);
    const before = screen.getByTestId('p1x-feat-10-res').textContent;
    fireEvent.click(screen.getByTestId('p1x-feat-10-raw'));
    const after = screen.getByTestId('p1x-feat-10-res').textContent;
    expect(after).not.toContain('decoded below');
    expect(after.length).toBeGreaterThan(before.length + 500);
  });
});

describe('P1ThirdPartyExchangePage: text size control', () => {
  const mountFs = () => {
    try { localStorage.clear(); } catch { /* see above */ }
    window.history.replaceState(null, '', '#walk=1');
    return render(<MemoryRouter><P1ThirdPartyExchangePage /></MemoryRouter>);
  };
  const page = () => screen.getByTestId('p1-third-party-exchange-page');
  it('starts at 100% and steps up and down in 10% steps, announcing the value', () => {
    mountFs();
    expect(screen.getByTestId('p1x-fs-val').textContent).toBe('100%');
    expect(screen.getByTestId('p1x-fs-val').getAttribute('aria-live')).toBe('polite');
    fireEvent.click(screen.getByTestId('p1x-fs-up'));
    fireEvent.click(screen.getByTestId('p1x-fs-up'));
    expect(screen.getByTestId('p1x-fs-val').textContent).toBe('120%');
    expect(page().dataset.fs).toBe('120');
    fireEvent.click(screen.getByTestId('p1x-fs-down'));
    expect(page().dataset.fs).toBe('110');
  });
  it('stops at 80% and 170% (the buttons disable) and Reset returns to 100%', () => {
    mountFs();
    for (let i = 0; i < 12; i += 1) fireEvent.click(screen.getByTestId('p1x-fs-up'));
    expect(page().dataset.fs).toBe('170');
    expect(screen.getByTestId('p1x-fs-up').disabled).toBe(true);
    for (let i = 0; i < 12; i += 1) fireEvent.click(screen.getByTestId('p1x-fs-down'));
    expect(page().dataset.fs).toBe('80');
    expect(screen.getByTestId('p1x-fs-down').disabled).toBe(true);
    fireEvent.click(screen.getByTestId('p1x-fs-reset'));
    expect(page().dataset.fs).toBe('100');
    expect(screen.getByTestId('p1x-fs-reset').disabled).toBe(true);
  });
  it('is remembered across a reload', () => {
    mountFs();
    fireEvent.click(screen.getByTestId('p1x-fs-up'));
    fireEvent.click(screen.getByTestId('p1x-fs-up'));
    fireEvent.click(screen.getByTestId('p1x-fs-up'));
    cleanup();
    render(<MemoryRouter><P1ThirdPartyExchangePage /></MemoryRouter>);
    expect(page().dataset.fs).toBe('130');
  });
  it('ignores a corrupt stored value and keeps working when storage throws', () => {
    try { localStorage.setItem('p1x-fs', '9999'); } catch { /* ok */ }
    window.history.replaceState(null, '', '#walk=1');
    render(<MemoryRouter><P1ThirdPartyExchangePage /></MemoryRouter>);
    expect(page().dataset.fs).toBe('100');
    cleanup();
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    render(<MemoryRouter><P1ThirdPartyExchangePage /></MemoryRouter>);
    fireEvent.click(screen.getByTestId('p1x-fs-up'));
    expect(page().dataset.fs).toBe('110');
    spy.mockRestore();
  });
});
