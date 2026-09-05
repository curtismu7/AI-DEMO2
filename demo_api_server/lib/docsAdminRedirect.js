'use strict';

const { BANKING_SCOPES } = require('../config/scopes');

/**
 * Signed in, but not an admin, on a doc page (/api/docs, /api/reference).
 *
 * requireAdmin answers that with a JSON 403 — correct for an API, useless
 * here: these pages open in a bare tab via window.open with no SPA loaded, so
 * the body renders as a dead page. This sends the browser to the SPA instead,
 * carrying the path it wanted, so the app can show its admin-required modal
 * and offer to continue afterwards.
 *
 * Mount it BEFORE requireAdmin, never instead of it. This only changes what a
 * denial LOOKS like; requireAdmin remains the real gate in every chain
 * (REGRESSION_PLAN §4, 2026-08-15 — /api/admin/scope-audit shipped without it
 * and leaked the tenant's resources). If the check here ever diverges from
 * middleware/auth.js, the original 403 still fires behind it.
 *
 * The admin signals mirror middleware/auth.js exactly: admin role OR admin
 * scope. Kept in its own module so it can be unit-tested without mocking the
 * auth middleware, which this repo's jest setup handles badly.
 *
 * @param {(url: string) => string|null} sanitizePath  the app's return-path
 *        sanitiser, injected so an attacker-supplied originalUrl cannot become
 *        an open redirect.
 */
function makeDocsAdminRedirect(sanitizePath) {
    return function redirectDocsToAdminModalIfNotAdmin(req, res, next) {
        const user = req.user;
        if (!user) return next(); // no user yet — requireAdmin owns the 401
        const scopes = user.scopes || [];
        if (user.role === 'admin' || scopes.includes(BANKING_SCOPES.ADMIN)) return next();
        const wanted = sanitizePath(req.originalUrl) || req.path;
        res.redirect(`/?adminRequired=${encodeURIComponent(wanted)}`);
    };
}

module.exports = { makeDocsAdminRedirect };
