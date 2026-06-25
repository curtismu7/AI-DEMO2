'use strict';

const fs = require('fs');
const path = require('path');
const { createBffClient, setVertical, restoreVertical } = require('../helpers/bffClient');

const VERTICAL = 'sporting-goods';
const STATIC_CONFIG = JSON.parse(
  fs.readFileSync(path.resolve(__dirname, `../../../config/verticals/${VERTICAL}/manifest.json`), 'utf8')
);

describe(`Vertical manifest — ${VERTICAL} (real)`, () => {
  let client;
  let manifest;

  beforeAll(async () => {
    skipIfNoSession();
    client = createBffClient('enduser');
    await setVertical(client, VERTICAL);
    const r = await client.get('/api/verticals/me');
    manifest = r.data;
  });

  afterAll(async () => {
    await restoreVertical(client);
  });

  it('GET /api/verticals/me returns id=sporting-goods', () => {
    expect(manifest.activeId).toBe(VERTICAL);
  });

  it('manifest terminology matches config/verticals/sporting-goods.json', () => {
    const term = manifest.pageManifest?.terminology;
    expect(term).toBeDefined();
    expect(term.account).toBe(STATIC_CONFIG.terminology.account);
    expect(term.accounts).toBe(STATIC_CONFIG.terminology.accounts);
    expect(term.transaction).toBe(STATIC_CONFIG.terminology.transaction);
  });

  it('manifest identity matches config/verticals/sporting-goods.json', () => {
    const id = manifest.pageManifest?.identity;
    expect(id).toBeDefined();
    expect(id.displayName).toBe(STATIC_CONFIG.identity.displayName);
  });
});
