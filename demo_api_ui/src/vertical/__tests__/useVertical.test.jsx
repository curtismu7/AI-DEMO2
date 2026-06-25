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
