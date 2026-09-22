// demo_api_server/tests/verticalMeThemeMerge.route.test.js
'use strict';

// Since T2 the theme-zone merge happens inside resolver.resolve() (single merge
// point), not in the /me route. These tests pin the route as pure pass-through:
// whatever scope.resolveForRequest returns (already theme-merged) is served,
// with guest masking intact.

const _baseManifest = () => ({
  theme: { cssVars: { '--app-primary-red': '#b91c1c', '--theme-accent': '#2563eb' } },
});

let mockScopeResponse = null;
const makeScope = (overrides) => ({
  activeId: 'banking',
  pageManifest: _baseManifest(), // fresh object per call (mirrors structuredClone)
  isAdmin: false,
  ...overrides,
});

jest.mock('../services/verticalManifest', () => ({
  verticalManifest: {
    list: () => [],
    scope: {
      resolveForRequest: () => mockScopeResponse,
    },
  },
}));

const request = require('supertest');
const express = require('express');
const router = require('../routes/verticalManifest');

function buildApp({ user } = { user: { id: 'u1', role: 'user' } }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = user; next(); });
  app.use('/api/verticals', router);
  return app;
}

beforeEach(() => { mockScopeResponse = makeScope(); });

describe('GET /api/verticals/me theme handling', () => {
  test('serves the resolver-merged manifest untouched', async () => {
    const res = await request(buildApp()).get('/api/verticals/me').expect(200);
    expect(res.body.pageManifest.theme.cssVars).toEqual({
      '--app-primary-red': '#b91c1c',
      '--theme-accent': '#2563eb',
    });
  });

  test('no route-level merge: a manifest whose theme is absent stays absent', async () => {
    mockScopeResponse = makeScope({ pageManifest: {} });
    const res = await request(buildApp()).get('/api/verticals/me').expect(200);
    expect(res.body.pageManifest.theme).toBeUndefined();
  });

  test('guest gets only identity + theme from the merged manifest', async () => {
    mockScopeResponse = makeScope({
      pageManifest: {
        identity: { displayName: 'Bank' },
        theme: { cssVars: { '--theme-accent': '#merged' } },
        demoUsers: [{ username: 'x' }],
      },
    });
    const res = await request(buildApp({ user: null })).get('/api/verticals/me').expect(200);
    expect(res.body.pageManifest).toEqual({
      identity: { displayName: 'Bank' },
      theme: { cssVars: { '--theme-accent': '#merged' } },
    });
  });
});
