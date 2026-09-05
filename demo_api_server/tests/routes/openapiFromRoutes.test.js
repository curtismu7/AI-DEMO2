'use strict';
/**
 * The OpenAPI document is introspected from the live router, so most of what
 * could break here is silent: a spec that omits auth, or an overlay key that
 * stops matching a route after somebody renames it. Both produce a page that
 * still renders and still looks right.
 *
 * The auth assertions are the important ones. express-list-endpoints reports
 * only route-level handlers, so mount-level `app.use('/x', authenticateToken,
 * ...)` — which is how most of this app is gated — is invisible to it. Taking
 * its output at face value labels every admin endpoint public.
 */
const request = require('supertest');
const app = require('../../server');
const { buildSpec } = require('../../lib/openapiFromRoutes');
const overlay = require('../../config/openapi-overlay.json');

const built = buildSpec(app, { overlay });
const spec = built.spec;

describe('OpenAPI document generated from the Express router', () => {
  test('produces a 3.1 document with paths', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths).length).toBeGreaterThan(100);
  });

  test('every path is OpenAPI-normalised, not an Express pattern', () => {
    const bad = Object.keys(spec.paths).filter((p) => !p.startsWith('/') || p.includes(':'));
    expect(bad).toEqual([]);
  });

  test('declares a relative server so "Try it out" stays same-origin', () => {
    // Absolute :3001 here would send the browser off the UI origin, where the
    // BFF session cookie does not exist, and every call would 401.
    expect(spec.servers).toEqual([{ url: '/', description: 'This origin' }]);
  });

  test('every path parameter is declared', () => {
    const missing = [];
    for (const [path, operations] of Object.entries(spec.paths)) {
      const expected = [...path.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => m[1]);
      for (const [verb, operation] of Object.entries(operations)) {
        const declared = (operation.parameters || [])
          .filter((p) => p.in === 'path')
          .map((p) => p.name);
        for (const name of expected) {
          if (!declared.includes(name)) missing.push(`${verb.toUpperCase()} ${path} -> ${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('auth inference', () => {
  test('GET /api/accounts reports admin, not session-only', () => {
    // Was gated by an inline `if (req.user.role !== 'admin')` check, invisible
    // to AUTH_MIDDLEWARE — the generated spec used to report this route as
    // merely session-gated while the overlay's prose next to it already said
    // "admin only", disagreeing with its own structured security field. Now
    // named requireAdminRole, recognized the same way requireAdmin is, and
    // de-duplicated against the mount-level session gate (admin implies it).
    expect(spec.paths['/api/accounts'].get.security).toEqual([{ admin: [] }]);
  });

  test('a mount-level requireAdmin gate is reported as admin', () => {
    // /api/admin/mgmt-api is gated ONLY by app.use(..., requireAdmin, ...).
    // Verified by disabling collectMountGates: this goes red with
    // `Received: undefined` while the rest of the suite stays green.
    const adminOps = Object.entries(spec.paths)
      .filter(([path]) => path.startsWith('/api/admin/mgmt-api'))
      .flatMap(([, operations]) => Object.values(operations));
    expect(adminOps.length).toBeGreaterThan(0);
    for (const operation of adminOps) {
      expect(operation.security).toEqual([{ admin: [] }]);
    }
  });

  test('both doc renderers and the spec itself are admin-gated', () => {
    // The spec enumerates every endpoint the BFF exposes, and both renderers
    // offer "Try it out" against a live session — so all three are admin-only.
    // /api/docs is app.use()-mounted (swagger-ui serves static assets) and so is
    // not a router route; the two that ARE routes must both report admin.
    expect(spec.paths['/api/openapi.json'].get.security).toEqual([{ admin: [] }]);
    expect(spec.paths['/api/reference'].get.security).toEqual([{ admin: [] }]);
  });

  test('a public route carries no security', () => {
    expect(spec.paths['/api/use-cases'].get.security).toBeUndefined();
  });

  test('route-level guards declared outside middleware/auth.js are still recognized', () => {
    // AUTH_MIDDLEWARE originally only knew the shared middleware/auth.js
    // exports. Several routes declare their own equivalent guard function
    // (e.g. `function requireAdminSession(req, res, next) { ... }`) — before
    // those names were added, these routes reported as unauthenticated.
    expect(spec.paths['/api/path/apikey-info'].get.security).toEqual([{ session: [] }]);
    expect(spec.paths['/api/security/dashboard'].get.security).toEqual([{ admin: [] }]);
  });

  test('names every security scheme it references', () => {
    const declared = Object.keys(spec.components.securitySchemes);
    const used = new Set();
    for (const operations of Object.values(spec.paths)) {
      for (const operation of Object.values(operations)) {
        for (const requirement of operation.security || []) {
          Object.keys(requirement).forEach((k) => used.add(k));
        }
      }
    }
    expect(used.size).toBeGreaterThan(0);
    expect([...used].filter((k) => !declared.includes(k))).toEqual([]);
  });
});

describe('/api/reference CSP allowlist', () => {
  // Scalar's page is a static HTML shell whose <script> tag loads its whole
  // UI from cdn.jsdelivr.net client-side (server.js's /api/reference route
  // comment). Without that origin in helmet's script-src, the browser blocks
  // it and the page renders blank — reported live on the SE cluster
  // (2026-09-05) after the route itself started working. helmet runs before
  // auth, so this is visible on the 401 too — no admin session needed.
  //
  // Parsed into a directive -> source-list map so each assertion checks the
  // SPECIFIC directive the browser actually enforces, not just "the string
  // cdn.jsdelivr.net appears somewhere in the header" (which every directive
  // added below would satisfy even if it landed in the wrong one).
  function parseCsp(header) {
    const directives = {};
    for (const part of (header || '').split(';')) {
      const tokens = part.trim().split(/\s+/).filter(Boolean);
      if (!tokens.length) continue;
      directives[tokens[0]] = tokens.slice(1);
    }
    return directives;
  }

  let csp;
  beforeAll(async () => {
    const res = await request(app).get('/api/reference');
    csp = parseCsp(res.headers['content-security-policy']);
  });

  test('scriptSrc allows cdn.jsdelivr.net (the bundle itself)', () => {
    expect(csp['script-src']).toContain('https://cdn.jsdelivr.net');
  });

  // Reported live 2026-09-05: with the script itself allowed, the page
  // rendered but its dark-mode toggle never appeared — the browser console
  // showed a blocked sourcemap fetch (connect-src), blocked webfont loads
  // (font-src), and a blocked blob: iframe (falls back to default-src, which
  // does not cover the blob: scheme).
  test('connectSrc allows cdn.jsdelivr.net (the bundle\'s sourcemap fetch)', () => {
    expect(csp['connect-src']).toContain('https://cdn.jsdelivr.net');
  });

  test('fontSrc allows cdn.jsdelivr.net (the bundle\'s webfonts)', () => {
    expect(csp['font-src']).toContain('https://cdn.jsdelivr.net');
  });

  test('frameSrc allows blob: (the bundle\'s sandboxed "Try it" iframe)', () => {
    expect(csp['frame-src']).toContain('blob:');
  });
});

describe('doc pages redirect to admin login when signed out', () => {
  // Reported live 2026-09-05: all three doc pages open in a bare browser tab
  // via window.open (no SPA/login-modal loaded there), so authenticateToken's
  // usual JSON 401 body read as a dead page instead of a sign-in prompt.
  // These requests carry no session cookie at all (supertest default), the
  // same "genuinely signed out" case that was reported — not the separate
  // signed-in-but-non-admin case, which still gets requireAdmin's 403 JSON
  // unchanged (not exercised here; that code path itself did not change).
  test.each([
    ['/api/reference', '%2Fapi%2Freference'],
    ['/api/openapi.json', '%2Fapi%2Fopenapi.json'],
    ['/api/docs', '%2Fapi%2Fdocs'],
  ])('%s redirects to admin login with return_to', async (path, encodedReturnTo) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/api/auth/oauth/login?return_to=${encodedReturnTo}`);
  });
});

describe('overlay', () => {
  test('every overlay route key still matches a real route', () => {
    // This is the anti-rot guard: rename a route and the overlay entry for it
    // fails here instead of silently disappearing from the docs.
    expect(built.unmatchedOverlayKeys).toEqual([]);
  });

  test('overlay prose replaces the generated placeholder', () => {
    expect(spec.paths['/api/accounts'].get.summary).toBe('List all accounts (admin only)');
    expect(spec.paths['/api/accounts'].get.responses['200']).toBeDefined();
  });

  test('overlay query parameters do not displace generated path parameters', () => {
    const names = spec.paths['/api/accounts'].get.parameters.map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['limit', 'offset']));
  });

  test('editor notes and route keys stay out of the document root', () => {
    expect(spec._comment).toBeUndefined();
    expect(spec['GET /api/accounts']).toBeUndefined();
  });
});
