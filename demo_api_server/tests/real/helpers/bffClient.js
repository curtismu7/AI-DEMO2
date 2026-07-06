'use strict';

const axios = require('axios');
const fs    = require('fs');
const path  = require('path');

const { BFF_BASE, httpsAgent } = require('./constants');

const SESSION_CACHE  = path.resolve(__dirname, '../../../.test-session.json');
const FIXTURES_CACHE = path.resolve(__dirname, '../../../.test-fixtures.json');

const verticalStack = [];

function loadSession(persona = 'enduser') {
  if (!fs.existsSync(SESSION_CACHE)) throw new Error('No .test-session.json — run globalSetup first');
  const cache = JSON.parse(fs.readFileSync(SESSION_CACHE, 'utf8'));
  const cookie = cache[persona];
  if (!cookie || cookie === 'skip') throw new Error(`No valid session for persona '${persona}'`);
  return cookie;
}

function createBffClient(persona = 'enduser') {
  const cookie = loadSession(persona);
  return axios.create({
    baseURL: BFF_BASE,
    httpsAgent,
    headers: { Cookie: cookie },
    validateStatus: () => true,
  });
}

async function setVertical(client, verticalId) {
  const current = await client.get('/api/verticals/me');
  verticalStack.push(current.data?.activeId || 'banking');
  await client.post('/api/verticals/active', { id: verticalId });
}

async function restoreVertical(client) {
  if (!client) return; // beforeAll threw (no session) — nothing to restore
  const prev = verticalStack.pop() || 'banking';
  await client.post('/api/verticals/active', { id: prev });
}

function loadFixtures() {
  if (!fs.existsSync(FIXTURES_CACHE)) throw new Error('No .test-fixtures.json — run globalSetup first');
  return JSON.parse(fs.readFileSync(FIXTURES_CACHE, 'utf8'));
}

/** Normalize account type strings for case-insensitive lookup (CHECKING vs checking). */
function normalizeAccountType(value) {
  return String(value || '').trim().toLowerCase();
}

/** Find an account id by type across API field naming variants. */
function findAccountId(accounts, type) {
  if (!Array.isArray(accounts)) return undefined;
  const want = normalizeAccountType(type);
  const match = accounts.find((a) => {
    const raw = a.accountType ?? a.account_type ?? a.type;
    return normalizeAccountType(raw) === want;
  });
  return match?.id;
}

module.exports = {
  createBffClient,
  setVertical,
  restoreVertical,
  loadFixtures,
  findAccountId,
  BFF_BASE,
};
