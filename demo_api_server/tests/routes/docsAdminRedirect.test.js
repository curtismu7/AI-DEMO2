'use strict';
/**
 * The doc pages (/api/docs, /api/reference) open in a bare tab with no SPA, so
 * requireAdmin's JSON 403 renders as a dead page — reported live on the SE
 * cluster 2026-09-05 ("insufficient_scope: Admin access required"). This
 * middleware redirects a signed-in non-admin into the SPA so the app can show
 * the admin-required modal.
 *
 * It is a PRE-check, not a replacement: requireAdmin still sits behind it in
 * every chain. These tests pin the two things that would make that unsafe —
 * letting a non-admin through, and turning the return path into an open
 * redirect.
 */
const { makeDocsAdminRedirect } = require('../../lib/docsAdminRedirect');
const { BANKING_SCOPES } = require('../../config/scopes');

// Stands in for the app's real sanitizePostLoginReturnPath: same contract —
// same-origin path or null.
const sanitize = (url) => (typeof url === 'string' && url.startsWith('/') && !url.startsWith('//') ? url : null);

function run(user, originalUrl = '/api/reference') {
    const mw = makeDocsAdminRedirect(sanitize);
    const req = { user, originalUrl, path: '/api/reference' };
    const res = { redirected: null, redirect(loc) { this.redirected = loc; } };
    let nexted = false;
    mw(req, res, () => { nexted = true; });
    return { nexted, redirected: res.redirected };
}

describe('docs admin redirect', () => {
    test('admin by role passes through to requireAdmin', () => {
        const { nexted, redirected } = run({ role: 'admin', scopes: [] });
        expect(nexted).toBe(true);
        expect(redirected).toBeNull();
    });

    test('admin by scope passes through to requireAdmin', () => {
        const { nexted, redirected } = run({ role: 'user', scopes: [BANKING_SCOPES.ADMIN] });
        expect(nexted).toBe(true);
        expect(redirected).toBeNull();
    });

    test('signed-in non-admin is redirected to the SPA with the wanted path', () => {
        const { nexted, redirected } = run({ role: 'user', scopes: ['banking:read'] });
        expect(nexted).toBe(false);
        expect(redirected).toBe('/?adminRequired=%2Fapi%2Freference');
    });

    test('no user falls through so requireAdmin still owns the 401', () => {
        // Must not redirect: an unauthenticated caller is authenticateToken's
        // and requireAdmin's business, and swallowing it here would mask a 401
        // as a UI nudge.
        const { nexted, redirected } = run(undefined);
        expect(nexted).toBe(true);
        expect(redirected).toBeNull();
    });

    test('a hostile originalUrl cannot become an open redirect', () => {
        // sanitize() rejects it, so the middleware must fall back to req.path
        // rather than interpolating attacker input into the Location header.
        const { redirected } = run({ role: 'user', scopes: [] }, 'https://evil.example.com/steal');
        expect(redirected).toBe('/?adminRequired=%2Fapi%2Freference');
        expect(redirected).not.toContain('evil.example.com');
    });

    test('a protocol-relative originalUrl cannot become an open redirect', () => {
        const { redirected } = run({ role: 'user', scopes: [] }, '//evil.example.com/steal');
        expect(redirected).toBe('/?adminRequired=%2Fapi%2Freference');
        expect(redirected).not.toContain('evil.example.com');
    });
});
