'use strict';

const fs   = require('fs');
const path = require('path');

const SESSION_CACHE = path.resolve(__dirname, '../../../.test-session.json');

global.skipIfNoSession = function skipIfNoSession(persona = 'enduser') {
  if (!fs.existsSync(SESSION_CACHE)) {
    console.warn(`[suiteSetup] No .test-session.json — skipping suite`);
    // Throwing inside beforeAll causes jest-circus to skip afterAll cleanly.
    throw new Error('SKIP: no .test-session.json');
  }
  const cache = JSON.parse(fs.readFileSync(SESSION_CACHE, 'utf8'));
  if (!cache[persona] || cache[persona] === 'skip') {
    console.warn(`[suiteSetup] No session for '${persona}' — skipping suite`);
    throw new Error(`SKIP: no valid session for '${persona}'`);
  }
};
