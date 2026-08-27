import React from 'react';
import { render } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { VerticalContext } from '../VerticalProvider';
import { useVertical } from '../useVertical';

const MANIFEST = (id) => ({
  id, schemaVersion: 3,
  identity: { displayName: id },
  theme: { cssVars: { '--x': '#000' } },
  agent: { persona: id },
});

function Probe() {
  const v = useVertical();
  return <div>{v.agentManifest.id}|{String(v.isAdminScope)}</div>;
}

function makeTree({ user, route }) {
  const value = {
    activeId: 'banking',
    pageManifest: MANIFEST('banking'),
    pageMockData: {},
    adminManifest: user?.role === 'admin' ? MANIFEST('admin-console') : null,
    isAdmin: user?.role === 'admin',
    refetch: () => {},
  };
  return (
    <MemoryRouter initialEntries={[route]}>
      <VerticalContext.Provider value={value}>
        <Routes><Route path="*" element={<Probe />} /></Routes>
      </VerticalContext.Provider>
    </MemoryRouter>
  );
}

describe('useVertical', () => {
  test('non-admin: agentManifest = pageManifest', () => {
    const { container } = render(makeTree({ user: null, route: '/dashboard' }));
    expect(container.textContent).toBe('banking|false');
  });

  test('admin on /dashboard: agentManifest = pageManifest', () => {
    const { container } = render(makeTree({ user: { role: 'admin' }, route: '/dashboard' }));
    expect(container.textContent).toBe('banking|false');
  });

  test('admin on /admin: agentManifest = admin-console', () => {
    const { container } = render(makeTree({ user: { role: 'admin' }, route: '/admin' }));
    expect(container.textContent).toBe('admin-console|true');
  });

  test('admin on /admin/verticals: agentManifest = admin-console (nested)', () => {
    const { container } = render(makeTree({ user: { role: 'admin' }, route: '/admin/verticals' }));
    expect(container.textContent).toBe('admin-console|true');
  });
});

// VerticalProvider memoizes its own context value, but almost nothing reads the
// raw context — nearly every consumer comes through useVertical(). While this
// hook rebuilt its return on every call, that Provider-level memo reached no
// one: a React.memo'd consumer, or a useEffect deps array keyed on this output,
// still saw a new reference every render.
describe('useVertical — reference stability', () => {
  const CTX = {
    activeId: 'banking',
    pageManifest: MANIFEST('banking'),
    pageMockData: {},
    adminManifest: MANIFEST('admin-console'),
    isAdmin: true,
    verticalStatus: 'resolved',
    refetch: () => {},
  };

  // Captures every value the hook returned, in order, so identity can be
  // compared across renders.
  function makeCapturingTree(seen, { ctx = CTX, route = '/dashboard' } = {}) {
    function Capture() {
      seen.push(useVertical());
      return null;
    }
    return function Tree({ ctxValue = ctx, path = route }) {
      return (
        <MemoryRouter initialEntries={[path]}>
          <VerticalContext.Provider value={ctxValue}>
            <Routes><Route path="*" element={<Capture />} /></Routes>
          </VerticalContext.Provider>
        </MemoryRouter>
      );
    };
  }

  test('returns the SAME object across a re-render with an unchanged context', () => {
    const seen = [];
    const Tree = makeCapturingTree(seen);
    const { rerender } = render(<Tree />);
    rerender(<Tree />);

    expect(seen.length).toBeGreaterThanOrEqual(2);
    expect(seen[seen.length - 1]).toBe(seen[0]);
  });

  test('returns a NEW object when the context value actually changes', () => {
    const seen = [];
    const Tree = makeCapturingTree(seen);
    render(<Tree />);
    const before = seen[seen.length - 1];

    const nextCtx = { ...CTX, activeId: 'retail', pageManifest: MANIFEST('retail') };
    render(<Tree ctxValue={nextCtx} />);
    const after = seen[seen.length - 1];

    expect(after).not.toBe(before);
    expect(after.activeId).toBe('retail');
  });

  // The memo must not be so sticky that it misses the /admin boundary — that
  // would be a correctness bug traded for a perf win.
  test('recomputes when the route crosses into admin scope', () => {
    const seen = [];
    const Tree = makeCapturingTree(seen);
    render(<Tree path="/dashboard" />);
    expect(seen[seen.length - 1].isAdminScope).toBe(false);
    expect(seen[seen.length - 1].agentManifest.id).toBe('banking');

    render(<Tree path="/admin" />);
    expect(seen[seen.length - 1].isAdminScope).toBe(true);
    expect(seen[seen.length - 1].agentManifest.id).toBe('admin-console');
  });

  test('the no-provider fallback is a stable reference too', () => {
    const seen = [];
    function Capture() { seen.push(useVertical()); return null; }
    const Bare = () => (
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes><Route path="*" element={<Capture />} /></Routes>
      </MemoryRouter>
    );
    const { rerender } = render(<Bare />);
    rerender(<Bare />);

    expect(seen[seen.length - 1]).toBe(seen[0]);
    expect(seen[0].verticalStatus).toBe('loading');
  });
});
