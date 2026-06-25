const { createScope } = require('../../services/verticalManifest/scope');

const M = (id) => ({ id, schemaVersion: 3, identity: { displayName: id }, theme: { cssVars: { '--x': '#000' } }, agent: { persona: 'P' } });

function makeResolver({ active = 'banking' } = {}) {
  const manifests = {
    banking: M('banking'),
    'admin-console': M('admin-console'),
    healthcare: M('healthcare'),
  };
  const mockData = {
    banking: { accounts: [{ id: 'a1' }] },
    'admin-console': {},
    healthcare: { patients: [] },
  };
  return {
    activeId: () => active,
    resolve: (id) => manifests[id] || null,
    loader: { get: (id) => manifests[id] ? { manifest: manifests[id], mockData: mockData[id] } : null },
  };
}

describe('scope.resolveForRequest', () => {
  test('unauthenticated → pageManifest set, adminManifest null', () => {
    const scope = createScope(makeResolver());
    const result = scope.resolveForRequest({ user: null });
    expect(result.activeId).toBe('banking');
    expect(result.pageManifest.id).toBe('banking');
    expect(result.pageMockData).toEqual({ accounts: [{ id: 'a1' }] });
    expect(result.adminManifest).toBeNull();
    expect(result.isAdmin).toBe(false);
  });

  test('customer role → adminManifest null', () => {
    const scope = createScope(makeResolver());
    const result = scope.resolveForRequest({ user: { role: 'customer' } });
    expect(result.adminManifest).toBeNull();
    expect(result.isAdmin).toBe(false);
  });

  test('admin role → both manifests present', () => {
    const scope = createScope(makeResolver());
    const result = scope.resolveForRequest({ user: { role: 'admin' } });
    expect(result.pageManifest.id).toBe('banking');
    expect(result.adminManifest.id).toBe('admin-console');
    expect(result.isAdmin).toBe(true);
  });

  test('no active vertical → pageManifest and pageMockData null', () => {
    const resolver = makeResolver();
    resolver.activeId = () => null;
    const scope = createScope(resolver);
    const result = scope.resolveForRequest({ user: { role: 'customer' } });
    expect(result.activeId).toBeNull();
    expect(result.pageManifest).toBeNull();
    expect(result.pageMockData).toBeNull();
  });

  test('pageMockData is null if loader has no entry for active id', () => {
    const resolver = makeResolver();
    resolver.activeId = () => 'unknown';
    resolver.resolve = () => null;
    resolver.loader = { get: () => null };
    const scope = createScope(resolver);
    const result = scope.resolveForRequest({ user: null });
    expect(result.pageMockData).toBeNull();
  });
});
