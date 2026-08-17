'use strict';

/**
 * The route audit is the half of `authz:verify` that reads what App.js actually
 * enforces. If it under-reports a guard, the gate green-lights an admin page
 * declared public — so these fixtures pin the shapes that exist in App.js today,
 * especially the inherited one.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { auditAppRoutes } = require('../../scripts/lib/appRouteAudit');

const ROOT = path.join(__dirname, '..', '..');

/** Write a throwaway .js file containing `src` and audit it. */
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
  return routes.find((r) => r.path === p)?.level;
}

describe('App.js route guard audit', () => {
  test('an unguarded route is public', () => {
    const routes = auditSource(`
      export default function App() {
        return <Routes><Route path="/learning" element={<LearningPage />} /></Routes>;
      }
    `);
    expect(levelOf(routes, '/learning')).toBe('public');
  });

  test('the loading/user/Navigate shape is a user guard', () => {
    const routes = auditSource(`
      export default function App() {
        return <Routes>
          <Route path="/check" element={loading ? null : user ? (<CheckPage />) : (<Navigate to="/" replace />)} />
        </Routes>;
      }
    `);
    expect(levelOf(routes, '/check')).toBe('user');
  });

  // The one a regex gets wrong: no guard on the Route itself, one on an
  // ancestor. 29 admin routes in App.js look exactly like this.
  test('a guard on an ancestor applies to every route inside it', () => {
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
    expect(levelOf(routes, '/users')).toBe('admin');
    expect(levelOf(routes, '/audit')).toBe('admin');
  });

  test('reading `user` without redirecting is soft, not a gate', () => {
    const routes = auditSource(`
      export default function App() {
        return <Routes>
          <Route path="/accounts" element={user ? <Accounts user={user} /> : <Landing />} />
        </Routes>;
      }
    `);
    expect(levelOf(routes, '/accounts')).toBe('soft');
  });

  test('removing a guard changes the reported level — the drift the gate catches', () => {
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
    expect(levelOf(guarded, '/settings')).toBe('admin');
    expect(levelOf(unguarded, '/settings')).toBe('public');
  });
});

describe('the real App.js', () => {
  const routes = auditAppRoutes(path.join(ROOT, 'demo_api_ui/src/App.js'), ROOT);

  test('finds the admin console behind an admin guard', () => {
    expect(levelOf(routes, '/admin')).toBe('admin');
    expect(levelOf(routes, '/users')).toBe('admin');
    expect(levelOf(routes, '/feature-flags')).toBe('admin');
  });

  test('finds the signed-in-only surfaces', () => {
    expect(levelOf(routes, '/use-cases')).toBe('user');
    expect(levelOf(routes, '/check')).toBe('user');
  });

  test('finds the public learning surfaces', () => {
    expect(levelOf(routes, '/oauth-academy')).toBe('public');
    expect(levelOf(routes, '/code-search')).toBe('public');
  });
});
