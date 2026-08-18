#!/usr/bin/env node
/**
 * Tests for the route-guard audit behind `authz:verify`.
 * Run: node --test scripts/check-auth-requirements.test.js
 *
 * Deliberately node:test, not jest. The audit needs @babel/parser, which lives
 * in demo_api_server's tree; jest resolves modules from the requiring FILE's
 * directory (this file sits at the repo root, where CI installs nothing) and
 * honors neither `require.resolve(..., { paths })` nor `createRequire`, so the
 * suite could not load the parser no matter how it was reached — while the
 * plain-node gate resolved it fine on the same checkout. node --test runs in
 * the hygiene job, which is where the parser already is.
 *
 * If the audit under-reports a guard, `authz:verify` green-lights an admin page
 * declared public. These fixtures pin every guard shape App.js uses today.
 */
'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { auditAppRoutes } = require('./lib/appRouteAudit');

const ROOT = path.join(__dirname, '..');

/** Write a throwaway file containing `src` and audit it. */
function auditSource(src) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'route-audit-'));
  const file = path.join(dir, 'Fixture.js');
  fs.writeFileSync(file, src);
  try {
    return auditAppRoutes(file, ROOT);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function levelOf(routes, p) {
  const hit = routes.find((r) => r.path === p);
  return hit ? hit.level : undefined;
}

describe('App.js route guard audit', () => {
  it('reports an unguarded route as public', () => {
    const routes = auditSource(`
      export default function App() {
        return <Routes><Route path="/learning" element={<LearningPage />} /></Routes>;
      }
    `);
    assert.equal(levelOf(routes, '/learning'), 'public');
  });

  it('reports the loading/user/Navigate shape as a user guard', () => {
    const routes = auditSource(`
      export default function App() {
        return <Routes>
          <Route path="/check" element={loading ? null : user ? (<CheckPage />) : (<Navigate to="/" replace />)} />
        </Routes>;
      }
    `);
    assert.equal(levelOf(routes, '/check'), 'user');
  });

  it('reports the loading/user/RedirectToLogin shape as a user guard', () => {
    const routes = auditSource(`
      export default function App() {
        return <Routes>
          <Route path="/check" element={loading ? null : user ? (<CheckPage />) : (<RedirectToLogin />)} />
        </Routes>;
      }
    `);
    assert.equal(levelOf(routes, '/check'), 'user');
  });

  // The one a regex gets wrong: no guard on the Route itself, one on an
  // ancestor. 29 admin routes in App.js look exactly like this.
  it('attributes an ancestor guard to every route inside it', () => {
    const routes = auditSource(`
      export default function App() {
        return <Routes>
          <Route path="/admin" element={
            <RequireAdminLogin user={user}>
              <Routes>
                <Route path="/users" element={<Users />} />
                <Route path="/audit" element={<Audit />} />
              </Routes>
            </RequireAdminLogin>
          } />
        </Routes>;
      }
    `);
    assert.equal(levelOf(routes, '/users'), 'admin');
    assert.equal(levelOf(routes, '/audit'), 'admin');
  });

  it('treats reading `user` without redirecting as soft, not a gate', () => {
    const routes = auditSource(`
      export default function App() {
        return <Routes>
          <Route path="/accounts" element={user ? <Accounts user={user} /> : <Landing />} />
        </Routes>;
      }
    `);
    assert.equal(levelOf(routes, '/accounts'), 'soft');
  });

  it('notices a guard being removed — the drift the gate exists to catch', () => {
    const guarded = auditSource(`
      export default function App() {
        return <Routes>
          <Route path="/settings" element={<RequireAdminLogin user={user}><Settings /></RequireAdminLogin>} />
        </Routes>;
      }
    `);
    const unguarded = auditSource(`
      export default function App() {
        return <Routes><Route path="/settings" element={<Settings />} /></Routes>;
      }
    `);
    assert.equal(levelOf(guarded, '/settings'), 'admin');
    assert.equal(levelOf(unguarded, '/settings'), 'public');
  });
});

describe('the real App.js', () => {
  const routes = auditAppRoutes(path.join(ROOT, 'demo_api_ui/src/App.js'), ROOT);

  it('finds the admin console behind an admin guard', () => {
    assert.equal(levelOf(routes, '/admin'), 'admin');
    assert.equal(levelOf(routes, '/users'), 'admin');
    assert.equal(levelOf(routes, '/feature-flags'), 'admin');
  });

  it('finds the signed-in-only surfaces', () => {
    assert.equal(levelOf(routes, '/use-cases'), 'user');
    assert.equal(levelOf(routes, '/check'), 'user');
  });

  it('finds the public learning surfaces', () => {
    assert.equal(levelOf(routes, '/oauth-academy'), 'public');
    assert.equal(levelOf(routes, '/code-search'), 'public');
  });
});
