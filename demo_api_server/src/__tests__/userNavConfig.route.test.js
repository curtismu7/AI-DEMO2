'use strict';

const express = require('express');
const request = require('supertest');
const userNavConfigRouter = require('../../routes/userNavConfig');
const configStore = require('../../services/configStore');

function makeApp(userId = 'test-user') {
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.user = { id: userId };
    next();
  });
  app.use('/api/user/nav-config', userNavConfigRouter);
  return app;
}

describe('GET /api/user/nav-config', () => {
  test('defaults to Use Cases hidden for a first-time user', async () => {
    const res = await request(makeApp('first-time-user')).get('/api/user/nav-config');
    expect(res.status).toBe(200);
    expect(res.body.hiddenLabels).toEqual(['Use Cases']);
    expect(res.body.activeConfigId).toBeNull();
  });

  test('flag OFF returns empty hiddenLabels even if prefs were saved', async () => {
    await configStore.setRaw({ ff_sidebar_customization: 'false' });
    const app = makeApp('user-flag-off');
    await request(app).put('/api/user/nav-config').send({ hiddenLabels: ['Themes'], activeConfigId: null });
    const res = await request(app).get('/api/user/nav-config');
    expect(res.body.flagOn).toBe(false);
    expect(res.body.hiddenLabels).toEqual([]);
    await configStore.setRaw({ ff_sidebar_customization: 'true' });
  });

  test('flag ON returns the stored hiddenLabels', async () => {
    await configStore.setRaw({ ff_sidebar_customization: 'true' });
    const app = makeApp('user-flag-on');
    await request(app).put('/api/user/nav-config').send({ hiddenLabels: ['Themes'], activeConfigId: null });
    const res = await request(app).get('/api/user/nav-config');
    expect(res.body.flagOn).toBe(true);
    expect(res.body.hiddenLabels).toEqual(['Themes']);
    await configStore.setRaw({ ff_sidebar_customization: 'false' });
  });
});

describe('PUT /api/user/nav-config', () => {
  test('saves hiddenLabels + activeConfigId and round-trips', async () => {
    await configStore.setRaw({ ff_sidebar_customization: 'true' });
    const app = makeApp('user-roundtrip');
    const res = await request(app)
      .put('/api/user/nav-config')
      .send({ hiddenLabels: ['Themes', 'Monitoring'], activeConfigId: 'cfg_abc' });
    expect(res.status).toBe(200);
    expect(res.body.hiddenLabels).toEqual(['Themes', 'Monitoring']);
    expect(res.body.activeConfigId).toBe('cfg_abc');
    await configStore.setRaw({ ff_sidebar_customization: 'false' });
  });

  test('rejects a non-array hiddenLabels with 400', async () => {
    const res = await request(makeApp())
      .put('/api/user/nav-config')
      .send({ hiddenLabels: 'nope' });
    expect(res.status).toBe(400);
  });

  test("does not leak one user's prefs to another", async () => {
    await configStore.setRaw({ ff_sidebar_customization: 'true' });
    const appA = makeApp('user-a');
    const appB = makeApp('user-b');
    const resPutA = await request(appA).put('/api/user/nav-config').send({ hiddenLabels: ['Themes'], activeConfigId: null });
    const resB = await request(appB).get('/api/user/nav-config');
    expect(resB.body.hiddenLabels).not.toEqual(resPutA.body.hiddenLabels);
    expect(resB.body.hiddenLabels).toEqual(['Use Cases']);
    await configStore.setRaw({ ff_sidebar_customization: 'false' });
  });
});
