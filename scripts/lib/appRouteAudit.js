'use strict';

/**
 * Reads the auth guard React actually applies to every route in App.js.
 *
 * A line-window regex gets this wrong: 30 of the admin routes carry no guard of
 * their own and inherit one from a `<RequireAdminLogin>` ancestor, so a flat
 * scan reports them public. Walking the JSX tree is the only way to attribute
 * an ancestor's guard to the routes inside it — and a gate that under-reports
 * an admin route as public is worse than no gate.
 *
 * Guard shapes in App.js today:
 *   <RequireAdminLogin user={user}>…</RequireAdminLogin>   -> admin
 *   loading ? null : user ? (…) : <Navigate to="/" replace/> -> user
 *   user ? <A/> : <B/>  (no redirect)                      -> soft
 *   anything else                                          -> public
 */

const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');

/**
 * @babel/parser is not a direct dependency of this package. It is present in
 * demo_api_server (via jest) and demo_api_ui (via vite), and CI's gates job
 * installs demo_api_server. Resolve across all three and fail loudly rather
 * than letting the gate skip itself — a gate that silently passes when its
 * parser is missing is the failure mode this whole file exists to prevent.
 */
function loadParser(root) {
  // createRequire, not require.resolve({ paths }). This file sits at the repo
  // ROOT (scripts/lib/), where CI installs no node_modules — and jest resolves
  // from the requiring file's directory, not the test's package, so under jest
  // every root-relative lookup missed while the plain-node CLI gate resolved
  // fine. createRequire anchors resolution to a package that really has the
  // dependency and uses Node's own resolver, so both contexts agree.
  const candidates = [
    path.join(root, 'demo_api_server'),
    path.join(root, 'demo_api_ui'),
    root,
  ];
  for (const base of candidates) {
    try {
      return createRequire(path.join(base, 'package.json'))('@babel/parser');
    } catch (_) { /* try the next one */ }
  }
  throw new Error(
    '@babel/parser not found. Looked in: '
    + candidates.join(', ')
    + '. Run `npm install --prefix demo_api_server` (CI does this in the gates job).',
  );
}

/** Guard a single element contributes to everything inside it. */
function inheritedGuardFor(node) {
  if (node.type !== 'JSXElement') return null;
  const name = node.openingElement.name;
  const tag = name.type === 'JSXIdentifier' ? name.name : '';
  return tag === 'RequireAdminLogin' ? 'admin' : null;
}

/** Guard expressed inside a Route's own `element={…}` expression. */
function guardFromElementExpression(exprSrc) {
  if (!exprSrc) return null;
  if (/RequireAdminLogin/.test(exprSrc)) return 'admin';
  const testsUser = /\buser\s*(\?|&&)/.test(exprSrc);
  if (!testsUser) return null;
  // Only a redirect makes it a real gate; `user ? <A/> : <B/>` renders either way.
  return /<Navigate\s+to="\/"/.test(exprSrc) ? 'user' : 'soft';
}

function strongest(a, b) {
  const rank = { public: 0, soft: 1, user: 2, admin: 3 };
  return (rank[a] ?? 0) >= (rank[b] ?? 0) ? a : b;
}

/**
 * @param {string} appJsPath absolute path to App.js
 * @param {string} root repo root (for parser resolution)
 * @returns {{ path: string, level: 'public'|'soft'|'user'|'admin', line: number }[]}
 */
function auditAppRoutes(appJsPath, root) {
  const parser = loadParser(root);
  const src = fs.readFileSync(appJsPath, 'utf8');
  const ast = parser.parse(src, {
    sourceType: 'module',
    plugins: ['jsx', 'classProperties', 'optionalChaining', 'nullishCoalescingOperator'],
  });

  const routes = [];

  function walk(node, inherited) {
    if (!node || typeof node !== 'object') return;
    let nextInherited = inherited;

    if (node.type === 'JSXElement') {
      const contributed = inheritedGuardFor(node);
      if (contributed) nextInherited = strongest(inherited || 'public', contributed);

      const name = node.openingElement.name;
      const tag = name.type === 'JSXIdentifier' ? name.name : '';
      if (tag === 'Route') {
        let routePath = null;
        let own = null;
        for (const attr of node.openingElement.attributes) {
          if (attr.type !== 'JSXAttribute') continue;
          if (attr.name.name === 'path' && attr.value?.type === 'StringLiteral') {
            routePath = attr.value.value;
          }
          if (attr.name.name === 'element' && attr.value?.type === 'JSXExpressionContainer') {
            own = guardFromElementExpression(src.slice(attr.value.expression.start, attr.value.expression.end));
          }
        }
        if (routePath) {
          routes.push({
            path: routePath,
            level: strongest(own || 'public', inherited || 'public'),
            line: src.slice(0, node.start).split('\n').length,
          });
        }
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end') continue;
      const child = node[key];
      if (Array.isArray(child)) {
        for (const c of child) walk(c, nextInherited);
      } else if (child && typeof child.type === 'string') {
        walk(child, nextInherited);
      }
    }
  }

  walk(ast, null);
  return routes;
}

/**
 * Every route tree in the app, with the education sub-tree's relative paths
 * resolved. EducationRoutes.js owns its own <Routes>, so `/architecture/*` in
 * App.js is one entry there and six real surfaces here.
 * @param {string} root repo root
 * @returns {{ path: string, level: string, line: number, file: string }[]}
 */
function auditRouteTrees(root) {
  const trees = [
    { file: 'demo_api_ui/src/App.js', prefix: '' },
    { file: 'demo_api_ui/src/routes/EducationRoutes.js', prefix: '/architecture/' },
  ];
  const out = [];
  for (const { file, prefix } of trees) {
    const abs = path.join(root, file);
    if (!fs.existsSync(abs)) continue;
    for (const r of auditAppRoutes(abs, root)) {
      // App.js declares the mount point as `/architecture/*`; the real surfaces
      // are the children, so drop the wildcard rather than list it twice.
      if (prefix && r.path === '*') continue;
      out.push({ ...r, path: prefix ? prefix + r.path.replace(/^\//, '') : r.path, file });
    }
  }
  return out;
}

module.exports = { auditAppRoutes, auditRouteTrees };
