// banking_api_server/services/agentIdentityStore.js
/**
 * Persists human user → PingOne "agent representative" mapping (local file).
 * Used when provisioning a PingOne directory user that represents the banking agent
 * for a given principal, with a custom attribute pointing at the human user's subject.
 */
'use strict';

const fs = require('fs').promises;
const path = require('path');

const FILE = path.join(__dirname, '..', 'data', 'persistent', 'agentIdentityMappings.json');

let cache = null;

async function load() {
  if (cache) return cache;
  try {
    const raw = await fs.readFile(FILE, 'utf8');
    cache = JSON.parse(raw);
  } catch (e) {
    if (e.code === 'ENOENT') cache = { mappings: [] };
    else throw e;
  }
  return cache;
}

async function save(data) {
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(data, null, 2), 'utf8');
  cache = data;
}

/**
 * Upsert mapping: principalPingOneSub is the human user's `sub` from OIDC.
 */
async function upsertMapping({
  principalPingOneSub,
  principalUsername,
  principalEmail,
  pingoneAgentUserId,
  pingoneAgentUsername,
  customAttributeName,
  customAttributeValue,
}) {
  const data = await load();
  const idx = data.mappings.findIndex((m) => m.principalPingOneSub === principalPingOneSub);
  const row = {
    principalPingOneSub,
    principalUsername: principalUsername || '',
    principalEmail: principalEmail || '',
    pingoneAgentUserId: pingoneAgentUserId || '',
    pingoneAgentUsername: pingoneAgentUsername || '',
    customAttributeName: customAttributeName || '',
    customAttributeValue: customAttributeValue || principalPingOneSub,
    updatedAt: new Date().toISOString(),
  };
  if (idx >= 0) data.mappings[idx] = row;
  else data.mappings.push(row);
  await save(data);
  return row;
}

async function getByPrincipalSub(principalPingOneSub) {
  const data = await load();
  return data.mappings.find((m) => m.principalPingOneSub === principalPingOneSub) || null;
}

module.exports = {
  upsertMapping,
  getByPrincipalSub,
};
