'use strict';

const fs    = require('fs');
const path  = require('path');
const https = require('https');
const axios = require('axios');

const { BFF_BASE } = require('./constants');

const SESSION_CACHE  = path.resolve(__dirname, '../../../.test-session.json');
const FIXTURES_CACHE = path.resolve(__dirname, '../../../.test-fixtures.json');

module.exports = async function globalTeardown() {
  if (process.env.RUN_REAL_TESTS !== 'true') return;

  // Restore banking vertical (in case a suite crashed without afterAll running)
  try {
    if (fs.existsSync(SESSION_CACHE)) {
      const cache  = JSON.parse(fs.readFileSync(SESSION_CACHE, 'utf8'));
      const cookie = cache.enduser;
      if (cookie && cookie !== 'skip') {
        const httpsAgent = new https.Agent({ rejectUnauthorized: false });
        await axios.post(`${BFF_BASE}/api/verticals/active`,
          { id: 'banking' },
          { httpsAgent, headers: { Cookie: cookie }, validateStatus: () => true });
      }
    }
  } catch (e) {
    console.warn('[globalTeardown] Could not restore banking vertical:', e.message);
  }

  for (const f of [SESSION_CACHE, FIXTURES_CACHE]) {
    try { fs.unlinkSync(f); } catch (_) {}
  }

  console.log('[globalTeardown] Done.');
};
