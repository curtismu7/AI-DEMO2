'use strict';
/**
 * Vertical switching — loads every vertical and verifies:
 *  1. The active vertical changes (identity, terminology, chips)
 *  2. Every vertical's chips array is non-empty
 *  3. Each vertical has at least one hitlTrigger chip
 *  4. Switching back to banking restores the banking manifest
 */

const path = require('path');
const { createBffClient } = require('../helpers/bffClient');

const VERTICALS = ['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce'];

describe('Vertical switching — manifest + chips change per vertical (real)', () => {
  let client;

  beforeAll(() => {
    skipIfNoSession();
    client = createBffClient('enduser');
  });

  afterAll(async () => {
    if (client) await client.post('/api/verticals/active', { id: 'banking' });
  });

  it.each(VERTICALS)('%s: switching sets activeId and returns non-empty manifest', async (verticalId) => {
    const r = await client.post('/api/verticals/active', { id: verticalId });
    expect([200, 204]).toContain(r.status);

    const me = await client.get('/api/verticals/me');
    expect(me.status).toBe(200);
    expect(me.data.activeId).toBe(verticalId);

    const manifest = me.data.pageManifest;
    expect(manifest).toBeDefined();
    expect(manifest.id).toBe(verticalId);
    expect(manifest.identity).toBeDefined();
    expect(manifest.identity.displayName).toBeDefined();
    expect(manifest.terminology).toBeDefined();
    expect(manifest.terminology.account).toBeDefined();
  });

  it.each(VERTICALS)('%s: manifest has chips array with at least 5 chips', async (verticalId) => {
    await client.post('/api/verticals/active', { id: verticalId });
    const me = await client.get('/api/verticals/me');
    const manifest = me.data.pageManifest;

    const dashboard = manifest.dashboard || {};
    const chips = [...(dashboard.chips || []), ...(dashboard.chips10 || [])];
    expect(chips.length).toBeGreaterThanOrEqual(5);
  });

  it.each(VERTICALS)('%s: manifest has at least one hitlTrigger chip', async (verticalId) => {
    await client.post('/api/verticals/active', { id: verticalId });
    const me = await client.get('/api/verticals/me');
    const manifest = me.data.pageManifest;

    // Read from static manifest file (hitlTrigger is a manifest-level field)
    const staticManifest = require(path.join(
      __dirname, `../../../config/verticals/${verticalId}/manifest.json`
    ));
    const dashboard = staticManifest.dashboard || {};
    const chips = [...(dashboard.chips || []), ...(dashboard.chips10 || [])];
    const hitlChips = chips.filter(c => c.hitlTrigger === true);
    expect(hitlChips.length).toBeGreaterThanOrEqual(1);
  });

  it('switching verticals changes displayName', async () => {
    await client.post('/api/verticals/active', { id: 'banking' });
    const bankingMe = await client.get('/api/verticals/me');
    const bankingName = bankingMe.data.pageManifest?.identity?.displayName;

    await client.post('/api/verticals/active', { id: 'healthcare' });
    const healthcareMe = await client.get('/api/verticals/me');
    const healthcareName = healthcareMe.data.pageManifest?.identity?.displayName;

    expect(bankingName).not.toBe(healthcareName);
  });

  it('switching verticals changes terminology', async () => {
    await client.post('/api/verticals/active', { id: 'banking' });
    const bankingMe = await client.get('/api/verticals/me');
    const bankingTerm = bankingMe.data.pageManifest?.terminology?.account;

    await client.post('/api/verticals/active', { id: 'healthcare' });
    const healthcareMe = await client.get('/api/verticals/me');
    const healthcareTerm = healthcareMe.data.pageManifest?.terminology?.account;

    // Banking uses "account", healthcare uses something patient-related
    expect(bankingTerm).not.toBe(healthcareTerm);
  });

  it('switching back to banking restores banking manifest', async () => {
    await client.post('/api/verticals/active', { id: 'workforce' });
    await client.post('/api/verticals/active', { id: 'banking' });
    const me = await client.get('/api/verticals/me');
    expect(me.data.activeId).toBe('banking');
    expect(me.data.pageManifest?.id).toBe('banking');
  });
});
