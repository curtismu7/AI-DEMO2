'use strict';

/**
 * Regression — POST /api/path/vertical-tool must run the CALLER's vertical for a
 * tool name shared across verticals, not an arbitrary readdir winner. Before the
 * fix, a plain name→id map meant e.g. a healthcare `view_billing` executed
 * university's implementation (returning tuition data), and a banking `deposit`
 * ran investment's.
 *
 * auth is mocked to a pass-through; verticalDispatch.executeToolFor is mocked to
 * capture the vertical it was dispatched with; configStore.getEffective is spied
 * to control the active vertical.
 */

const express = require('express');
const request = require('supertest');

jest.mock('../../middleware/auth', () => ({
  authenticateToken: (req, _res, next) => { req.user = { id: 'u1', role: 'user' }; next(); },
}));
jest.mock('../../services/verticalDispatch', () => ({
  executeToolFor: jest.fn(async (vertical) => ({ result: { vertical }, render: 'text' })),
}));

const configStore = require('../../services/configStore');
const verticalDispatch = require('../../services/verticalDispatch');
const { verticalManifest } = require('../../services/verticalManifest');
const verticalToolRouter = require('../../routes/verticalTool');

function appWithActive(activeVertical) {
  jest.spyOn(configStore, 'getEffective').mockImplementation((k) =>
    (k === 'active_vertical' ? activeVertical : undefined));
  // resolveVertical() reads verticalManifest.resolver.activeIdFor(req) FIRST and only
  // falls back to configStore. activeIdFor -> activeId() -> store.getActiveId() (LMDB),
  // so on any machine with a persisted active_vertical the configStore spy above never
  // takes effect and this suite silently asserts against real LMDB state — passing on a
  // fresh clone, failing wherever the demo has been run. Pin the resolver too.
  jest.spyOn(verticalManifest.resolver, 'activeIdFor').mockReturnValue(activeVertical);
  const app = express();
  app.use('/api/path', verticalToolRouter);
  return app;
}

const dispatchedVertical = () => verticalDispatch.executeToolFor.mock.calls[0][0];

describe('POST /api/path/vertical-tool — shared-name vertical resolution', () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  test('shared name runs the ACTIVE vertical (healthcare), not the readdir winner', async () => {
    await request(appWithActive('healthcare')).post('/api/path/vertical-tool').send({ name: 'view_billing' });
    expect(dispatchedVertical()).toBe('healthcare');
  });

  test('same shared name resolves to university when that is active', async () => {
    await request(appWithActive('university')).post('/api/path/vertical-tool').send({ name: 'view_billing' });
    expect(dispatchedVertical()).toBe('university');
  });

  test('shared name whose owners exclude the active vertical → a deterministic owner, never the active', async () => {
    await request(appWithActive('banking')).post('/api/path/vertical-tool').send({ name: 'view_billing' });
    expect(['healthcare', 'university']).toContain(dispatchedVertical());
    expect(dispatchedVertical()).not.toBe('banking');
  });

  test('body.vertical hint wins when it legitimately owns the tool', async () => {
    await request(appWithActive('healthcare'))
      .post('/api/path/vertical-tool')
      .send({ name: 'view_billing', vertical: 'university' });
    expect(dispatchedVertical()).toBe('university');
  });

  test('unique tool ignores the active vertical and runs its owner', async () => {
    // view_records is defined only by healthcare
    await request(appWithActive('banking')).post('/api/path/vertical-tool').send({ name: 'view_records' });
    expect(dispatchedVertical()).toBe('healthcare');
  });
});
