'use strict';

/**
 * createScope — Resolves the data shape for GET /api/verticals/me endpoint.
 *
 * Given an Express request, returns:
 * {
 *   activeId:      string | null,          // resolver.activeId() || null
 *   pageManifest:  Manifest | null,        // activeId ? resolver.resolve(activeId) : null
 *   pageMockData:  Record | null,          // activeId ? mockData from loader : null
 *   adminManifest: Manifest | null,        // isAdmin ? resolver.resolve('admin-console') : null
 *   isAdmin:       boolean,                 // req.user?.role === 'admin'
 * }
 *
 * @param {object} resolver — has activeId(), resolve(id), and loader.get(id)
 */
function createScope(resolver) {
  function resolveForRequest(req) {
    // Session-scoped: this request's session preference wins over the global.
    const activeId = (resolver.activeIdFor ? resolver.activeIdFor(req) : resolver.activeId()) || null;
    const pageManifest = activeId ? resolver.resolve(activeId) : null;
    const pageEntry = activeId ? resolver.loader.get(activeId) : null;
    const pageMockData = pageEntry ? pageEntry.mockData : null;
    const isAdmin = !!(req && req.user && req.user.role === 'admin');
    const adminManifest = isAdmin ? resolver.resolve('admin-console') : null;

    return { activeId, pageManifest, pageMockData, adminManifest, isAdmin };
  }

  return { resolveForRequest };
}

module.exports = { createScope };
