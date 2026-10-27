/* eslint-disable no-template-curly-in-string -- SpEL expressions are asserted as text */
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import P1ThirdPartyExchangePage from '../P1ThirdPartyExchangePage';
import { parseSequence } from '../../utils/parseSequence';
import {
  COMPARE_COLUMNS, COMPARE_ROWS, DIAGRAM_DETAILS, TRUSTED_ISSUER_DEFAULTS, VENDORS, applyMapping, buildWire, decodeJwt, exchangeDiagram, mockJwt, toCurl, validateExchange,
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

describe('P1ThirdPartyExchangePage', () => {
  const mount = () => render(<MemoryRouter><P1ThirdPartyExchangePage /></MemoryRouter>);
  it('labels itself simulated and shows the legend', () => {
    mount();
    expect(screen.getByTestId('p1x-banner').textContent).toMatch(/Simulated/);
    expect(within(screen.getByTestId('p1x-legend')).getAllByText(/MEASURED|GUIDE|SAMPLE|OUR CHOICE|UNVERIFIED/).length).toBe(5);
  });
  it('shows the issued act claim for the default issuer and nothing when refused', () => {
    mount();
    expect(screen.getByTestId('p1x-verdict').dataset.ok).toBe('true');
    expect(screen.getByTestId('p1x-issued').textContent).toContain('"act"');
    fireEvent.click(screen.getByTestId('p1x-state-expired'));
    expect(screen.getByTestId('p1x-verdict').dataset.ok).toBe('false');
    expect(screen.queryByTestId('p1x-issued')).toBeNull();
  });
  it('requiring nbf flips Okta to refused and Reset restores it', () => {
    mount();
    fireEvent.click(screen.getByTestId('p1x-vendor-okta'));
    fireEvent.click(screen.getByTestId('p1x-nbf'));
    expect(screen.getByTestId('p1x-verdict').dataset.ok).toBe('false');
    fireEvent.click(screen.getByTestId('p1x-reset'));
    expect(screen.getByTestId('p1x-verdict').dataset.ok).toBe('true');
  });
  it('lists every issuer and the comparison table', () => {
    mount();
    for (const v of VENDORS) expect(screen.getByTestId(`p1x-vendor-${v.id}`)).toBeTruthy();
    expect(within(screen.getByTestId('p1x-compare')).getAllByRole('row').length).toBe(COMPARE_ROWS.length + 1);
  });
  it('shows the raw tokens in full and every API call on the page', () => {
    mount();
    expect(screen.getByTestId('p1x-raw-actor-raw').textContent.split('.')).toHaveLength(3);
    expect(screen.getByTestId('p1x-raw-subject-raw').textContent.length).toBeGreaterThan(200);
    expect(screen.getByTestId('p1x-raw-issued-raw')).toBeTruthy();
    const wire = screen.getByTestId('p1x-wire');
    expect(within(wire).getAllByText(/Copy/).length).toBeGreaterThan(10);
    expect(screen.getByTestId('p1x-call-1-req').textContent).toMatch(/^POST https:\/\/api\.pingone\.example\/v1\/environments\/[0-9a-f-]+\/trustedIssuers/);
    expect(screen.getByTestId('p1x-call-1-res').textContent).toMatch(/HTTP 201 Created[\s\S]*Cache-Control: no-store/);
  });
  it('shows the real PingOne error body when refused', () => {
    mount();
    fireEvent.click(screen.getByTestId('p1x-state-expired'));
    expect(screen.getByTestId('p1x-error').textContent).toMatch(/invalid_request[\s\S]*The provided JWT has expired/);
  });
  it('states what it does not show', () => {
    mount();
    expect(screen.getByTestId('p1x-notshown').textContent).toMatch(/SUBJECT token/);
  });
});
