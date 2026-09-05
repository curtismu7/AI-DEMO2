'use strict';

/**
 * openapiFromRoutes.js
 *
 * Builds an OpenAPI 3.1 document by introspecting the live Express app rather
 * than from per-route annotations. The BFF mounts ~165 route files plus inline
 * routes in server.js; annotating each one would be a repo-wide diff that goes
 * stale the first time somebody adds a route without touching a comment.
 * Introspection cannot go stale by construction — the running router IS the
 * source of truth.
 *
 * What it cannot infer: request/response schemas and prose. Those come from
 * config/openapi-overlay.json, keyed "METHOD /path", merged on top. That keeps
 * enrichment optional and out of the route files.
 */

const listEndpoints = require('express-list-endpoints');

/**
 * Middleware names that mean "not reachable anonymously". Most are the
 * `const authenticateToken = ...` style declarations in middleware/auth.js;
 * the rest are locally-declared, route-level guards (e.g.
 * `function requireAdminSession(req, res, next) { ... }` in routes/*.js) with
 * equivalent semantics — Function.prototype.name matches either way, and
 * express-list-endpoints reports route-level handlers by name regardless of
 * which file declared them.
 */
const AUTH_MIDDLEWARE = {
    authenticateToken: 'session',
    requireSession: 'session',
    requireAdmin: 'admin',
    requireAuth: 'session',
    requireSignedInSession: 'session',
    requireAdminSession: 'admin',
    requireAdminAccess: 'admin',
    requireAdminWrite: 'admin',
    requireAdminOrUnconfigured: 'admin',
};

const SECURITY_SCHEMES = {
    session: {
        type: 'apiKey',
        in: 'cookie',
        name: 'connect.sid',
        description: 'BFF session cookie, set by the PingOne sign-in flow.',
    },
    admin: {
        type: 'apiKey',
        in: 'cookie',
        name: 'connect.sid',
        description: 'BFF session cookie belonging to a user with the admin role.',
    },
};

/**
 * Collect app-level auth gates applied via `app.use('/prefix', authenticateToken, ...)`.
 *
 * express-list-endpoints only reports route-level handlers, so mount-level auth
 * is invisible to it — most of this app's auth is mount-level, and taking its
 * output at face value would label every admin endpoint "public". Rather than
 * decode each mount regexp back into a path, keep the regexp and let Express's
 * own matcher decide which endpoints sit under it.
 *
 * `fast_slash` marks a pathless `app.use(fn)`, which matches everything.
 */
function collectMountGates(app) {
    const stack = app?._router?.stack || [];
    const gates = [];
    for (const layer of stack) {
        const kind = AUTH_MIDDLEWARE[layer?.name];
        if (!kind || !layer.regexp || layer.regexp.fast_slash) continue;
        gates.push({ kind, regexp: layer.regexp });
    }
    return gates;
}

/** `/api/accounts/:id` -> `/api/accounts/{id}` */
function toOpenApiPath(expressPath) {
    return expressPath.replace(/:([A-Za-z0-9_]+)\??/g, '{$1}');
}

function pathParameters(openApiPath) {
    return [...openApiPath.matchAll(/\{([A-Za-z0-9_]+)\}/g)].map((m) => ({
        name: m[1],
        in: 'path',
        required: true,
        schema: { type: 'string' },
    }));
}

/** First segment after /api, else the first segment. Used to group in the UI. */
function tagFor(openApiPath) {
    const segments = openApiPath.split('/').filter(Boolean);
    if (segments[0] === 'api') segments.shift();
    const tag = segments[0] || 'root';
    return tag.startsWith('{') ? 'root' : tag;
}

function securityFor(endpoint, gates, openApiPath) {
    const kinds = new Set();
    for (const name of endpoint.middlewares || []) {
        if (AUTH_MIDDLEWARE[name]) kinds.add(AUTH_MIDDLEWARE[name]);
    }
    for (const gate of gates) {
        if (gate.regexp.test(endpoint.path)) kinds.add(gate.kind);
    }
    // `admin` implies a session, so listing both would be noise.
    if (kinds.has('admin')) kinds.delete('session');
    return [...kinds].map((kind) => ({ [kind]: [] }));
}

/** Overlay wins on conflict; plain objects merge, everything else replaces. */
function deepMerge(base, overlay) {
    if (!isPlainObject(base) || !isPlainObject(overlay)) return overlay;
    const out = { ...base };
    for (const [key, value] of Object.entries(overlay)) {
        out[key] = key in base ? deepMerge(base[key], value) : value;
    }
    return out;
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * @param {import('express').Application} app
 * @param {object} [options]
 * @param {object} [options.overlay] parsed config/openapi-overlay.json
 * @returns {{ spec: object, unmatchedOverlayKeys: string[] }}
 */
function buildSpec(app, options = {}) {
    const overlay = options.overlay || {};
    const gates = collectMountGates(app);
    const paths = {};
    // Express supports wildcards and raw regexp mounts; OpenAPI has no way to
    // express them. Skipping is right, but silently skipping would read as
    // "these endpoints don't exist" — surface the count in the document.
    const skipped = [];

    for (const endpoint of listEndpoints(app)) {
        if (/[*(]/.test(endpoint.path)) {
            skipped.push(endpoint.path);
            continue;
        }
        const openApiPath = toOpenApiPath(endpoint.path);
        const parameters = pathParameters(openApiPath);
        const security = securityFor(endpoint, gates, openApiPath);
        const tag = tagFor(openApiPath);

        paths[openApiPath] = paths[openApiPath] || {};
        for (const method of endpoint.methods) {
            const verb = method.toLowerCase();
            if (verb === 'head') continue; // Express registers HEAD alongside GET
            const operation = {
                tags: [tag],
                summary: `${method} ${openApiPath}`,
                responses: { default: { description: 'Undocumented — see the overlay to describe this response.' } },
            };
            if (parameters.length) operation.parameters = parameters;
            if (security.length) operation.security = security;

            const overlayKey = `${method} ${endpoint.path}`;
            const merged = overlay[overlayKey]
                ? deepMerge(operation, overlay[overlayKey])
                : operation;
            // deepMerge replaces arrays wholesale, so an overlay that documents a
            // query parameter would otherwise drop the generated path parameters
            // and leave an invalid document behind. Put back anything it lost.
            if (parameters.length) {
                const present = new Set((merged.parameters || []).map((p) => `${p.in}:${p.name}`));
                merged.parameters = [
                    ...parameters.filter((p) => !present.has(`path:${p.name}`)),
                    ...(merged.parameters || []),
                ];
            }
            paths[openApiPath][verb] = merged;
        }
    }

    const overlayRouteKeys = Object.keys(overlay).filter((k) => /^[A-Z]+ \//.test(k));
    const knownKeys = new Set();
    for (const endpoint of listEndpoints(app)) {
        for (const method of endpoint.methods) knownKeys.add(`${method} ${endpoint.path}`);
    }
    const unmatchedOverlayKeys = overlayRouteKeys.filter((k) => !knownKeys.has(k));

    const spec = {
        openapi: '3.1.0',
        info: {
            title: 'Banking Demo BFF API',
            version: '1.0.0',
            description:
                'Generated by introspecting the running Express router, so it always matches the '
                + 'deployed routes. Summaries and schemas come from config/openapi-overlay.json.',
        },
        // Relative so "Try it out" stays same-origin: reached through the UI at
        // :4000 the session cookie applies, which it would not against :3001.
        servers: [{ url: '/', description: 'This origin' }],
        components: { securitySchemes: SECURITY_SCHEMES },
        paths,
    };
    if (skipped.length) {
        spec.info.description
            += ` ${skipped.length} wildcard/regexp route(s) are omitted — OpenAPI cannot express them.`;
        spec['x-skipped-paths'] = skipped;
    }

    return { spec: deepMerge(spec, stripRouteKeys(overlay)), unmatchedOverlayKeys };
}

/**
 * Overlay entries keyed "METHOD /path" are per-operation and already applied;
 * `_`-prefixed keys are notes for whoever edits the file. Everything else is
 * merged into the document root.
 */
function stripRouteKeys(overlay) {
    return Object.fromEntries(
        Object.entries(overlay).filter(
            ([key]) => !/^[A-Z]+ \//.test(key) && !key.startsWith('_'),
        ),
    );
}

module.exports = { buildSpec, AUTH_MIDDLEWARE, toOpenApiPath };
