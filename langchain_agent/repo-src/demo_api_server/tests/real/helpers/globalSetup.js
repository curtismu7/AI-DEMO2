'use strict';

const fs   = require('fs');
const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../../../.env'), override: false });

const { resolveSession, SESSION_CACHE } = require('./session');
const { createBffClient }               = require('./bffClient');
const { bootstrapFixtures }             = require('./fixtures');

const FIXTURES_CACHE = path.resolve(__dirname, '../../../.test-fixtures.json');
const VERTICALS = ['banking', 'retail', 'sporting-goods', 'healthcare', 'workforce', 'admin'];

module.exports = async function globalSetup() {
  if (process.env.RUN_REAL_TESTS !== 'true') return;

  console.log('[globalSetup] Resolving sessions...');

  const enduserCookie = await resolveSession('enduser');
  const adminCookie   = await resolveSession('admin') || enduserCookie;

  const cache = {
    enduser: enduserCookie || 'skip',
    admin:   adminCookie   || 'skip',
  };
  fs.writeFileSync(SESSION_CACHE, JSON.stringify(cache, null, 2));

  if (!enduserCookie) {
    console.warn('[globalSetup] No valid session found — all real tests will be skipped');
    return;
  }

  console.log('[globalSetup] Bootstrapping fixtures for all verticals...');

  const adminClient = createBffClient('admin');

  const results = await Promise.all(
    VERTICALS.map(v =>
      bootstrapFixtures(adminClient, v)
        .then(f => { console.log(`[globalSetup] Fixtures ready: ${v}`); return [v, f]; })
        .catch(e => { console.error(`[globalSetup] Fixture bootstrap failed for ${v}: ${e.message}`); return [v, { error: e.message }]; })
    )
  );

  const fixtures = Object.fromEntries(results);
  fs.writeFileSync(FIXTURES_CACHE, JSON.stringify(fixtures, null, 2));
  console.log('[globalSetup] Done.');
};
