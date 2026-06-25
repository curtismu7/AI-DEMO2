// demo_api_server/tests/verticalMeThemeMerge.route.test.js
'use strict';

let mockBlob = null;
jest.mock('../services/configStore', () => ({
  get: jest.fn(() => mockBlob),
}));

const _baseManifest = () => ({
  theme: { cssVars: { '--app-primary-red': '#b91c1c', '--theme-accent': '#2563eb' } },
});
jest.mock('../services/verticalManifest', () => ({
  verticalManifest: {
    list: () => [],
    scope: {
      resolveForRequest: () => ({
        activeId: 'banking',
        pageManifest: _baseManifest(), // fresh object per call (mirrors structuredClone)
        isAdmin: false,
      }),
    },
  },
}));

const request = require('supertest');
const express = require('express');
const router = require('../routes/verticalManifest');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { req.user = { id: 'u1', role: 'user' }; next(); });
  app.use('/api/verticals', router);
  return app;
}

beforeEach(() => { mockBlob = null; });

describe('GET /api/verticals/me theme-zone merge', () => {
  test('no override → manifest cssVars unchanged', async () => {
    const res = await request(buildApp()).get('/api/verticals/me').expect(200);
    expect(res.body.pageManifest.theme.cssVars).toEqual({
      '--app-primary-red': '#b91c1c',
      '--theme-accent': '#2563eb',
    });
  });

  test('override blob is merged over manifest defaults', async () => {
    mockBlob = JSON.stringify({ '--app-primary-red': '#2563EB', '--brand-card-accent': '#7C3AED' });
    const res = await request(buildApp()).get('/api/verticals/me').expect(200);
    expect(res.body.pageManifest.theme.cssVars).toEqual({
      '--app-primary-red': '#2563EB',     // overridden
      '--theme-accent': '#2563eb',        // untouched
      '--brand-card-accent': '#7C3AED',   // added
    });
  });

  test('malformed blob is ignored (serves manifest defaults)', async () => {
    mockBlob = '{ not json';
    const res = await request(buildApp()).get('/api/verticals/me').expect(200);
    expect(res.body.pageManifest.theme.cssVars['--app-primary-red']).toBe('#b91c1c');
  });
});
