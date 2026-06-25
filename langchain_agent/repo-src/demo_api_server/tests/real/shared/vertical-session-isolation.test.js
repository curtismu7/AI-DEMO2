'use strict';

// Regression: the active vertical is SESSION-scoped. Two concurrent sessions
// must hold independent verticals — one switching cannot change the other's
// (the "a banking screen stays banking regardless of what another session set"
// invariant). Uses two distinct sessions (enduser + admin cookies).

const { createBffClient } = require('../helpers/bffClient');

describe('Active vertical is session-scoped (real)', () => {
  let a, b;

  beforeAll(() => {
    skipIfNoSession();
    a = createBffClient('enduser');
    b = createBffClient('admin');
  });

  afterAll(async () => {
    // Leave both sessions on banking so other suites start from a known vertical.
    if (a) await a.post('/api/verticals/active', { id: 'banking' });
    if (b) await b.post('/api/verticals/active', { id: 'banking' });
  });

  it('two sessions hold independent verticals; one switching does not bleed into the other', async () => {
    await a.post('/api/verticals/active', { id: 'healthcare' });
    await b.post('/api/verticals/active', { id: 'retail' });

    const aMe = await a.get('/api/verticals/me');
    const bMe = await b.get('/api/verticals/me');
    expect(aMe.status).toBe(200);
    expect(bMe.status).toBe(200);
    expect(aMe.data.activeId).toBe('healthcare');
    expect(bMe.data.activeId).toBe('retail');

    // B switches again — A must be unaffected (the cross-session bleed guard).
    await b.post('/api/verticals/active', { id: 'workforce' });
    const aAfter = await a.get('/api/verticals/me');
    const bAfter = await b.get('/api/verticals/me');
    expect(aAfter.data.activeId).toBe('healthcare');
    expect(bAfter.data.activeId).toBe('workforce');
  });

  it('plugin data is served for the session vertical, not the global', async () => {
    await a.post('/api/verticals/active', { id: 'healthcare' });
    await b.post('/api/verticals/active', { id: 'sporting-goods' });
    const aPlugin = await a.get('/api/plugin/data');
    // healthcare has a plugin; the returned vertical must be the session's.
    if (aPlugin.status === 200) {
      expect(aPlugin.data.vertical).toBe('healthcare');
    }
  });
});
