'use strict';

// Live PingFederate readback for the readiness audit. Read-only: GETs against
// the Admin API with the administrator account. It returns normalized,
// secret-free views; the audit compares them with the committed baseline in
// config/demoReadinessPingFederateProfiles.json.

const https = require('node:https');
const PF_PROFILES = require('../config/demoReadinessPingFederateProfiles.json');

// provision-a2a-sp-connections.sh names every A2A connection with this prefix.
const A2A_CONNECTION_PREFIX = 'aiDemoA2a';

function adminGet(url, { headers, insecure, signal }) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers, rejectUnauthorized: !insecure, signal }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => {
        try { resolve({ status: response.statusCode, body: text ? JSON.parse(text) : {} }); } catch { reject(new Error('PingFederate Admin API returned a non-JSON response')); }
      });
    });
    request.on('error', (error) => reject(new Error('PingFederate Admin API request failed: ' + (error.code || error.message))));
  });
}

function sameSet(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && expected.every((entry) => actual.includes(entry));
}

/** Names of the baseline fields the live view does not match. Arrays compare as sets. */
function baselineMismatches(expected = {}, actual = {}) {
  return Object.entries(expected)
    .filter(([name, value]) => (Array.isArray(value) ? !sameSet(actual?.[name], value) : actual?.[name] !== value))
    .map(([name]) => name);
}

function createPingFederateReader({ env = process.env, get = adminGet, profiles = PF_PROFILES } = {}) {
  async function read(signal) {
    const base = String(env.PINGFEDERATE_ADMIN_API_BASE || '').replace(/\/$/, '');
    const password = env.PINGFEDERATE_ADMIN_PASSWORD;
    if (!base || !password) throw new Error('PingFederate Admin API credentials are unavailable');
    const headers = {
      Authorization: 'Basic ' + Buffer.from((env.PINGFEDERATE_ADMIN_USER || 'administrator') + ':' + password).toString('base64'),
      'X-XSRF-Header': 'PingFederate',
    };
    // The local admin console serves a self-signed certificate; verification is
    // skipped only when the operator says so, and only for these reads.
    const insecure = env.PINGFEDERATE_ADMIN_TLS_INSECURE === '1';
    const items = async (resource) => {
      const { status, body } = await get(base + '/' + resource, { headers, insecure, signal });
      if (status !== 200) throw new Error('PingFederate Admin API read returned HTTP ' + status);
      return body.items || [];
    };
    const [clients, managers, connections, adapters, detailTypes] = await Promise.all([
      items('oauth/clients'), items('oauth/accessTokenManagers'), items('idp/spConnections'),
      items('idp/adapters'), items('oauth/authorizationDetailTypes'),
    ]);
    const managerField = (manager, name) => (manager.configuration?.fields || []).find((field) => field.name === name)?.value || null;
    return {
      clients: Object.fromEntries(clients.map((client) => [client.clientId, {
        grantTypes: [...(client.grantTypes || [])].sort(),
        defaultAccessTokenManagerRef: client.defaultAccessTokenManagerRef?.id || null,
        restrictToDefaultAccessTokenManager: Boolean(client.restrictToDefaultAccessTokenManager),
        tokenExchangeProcessorPolicyRef: client.tokenExchangeProcessorPolicyRef?.id || null,
        restrictedScopes: [...(client.restrictedScopes || [])].sort(),
      }])),
      accessTokenManagers: Object.fromEntries(managers.map((manager) => [manager.id, {
        issuer: managerField(manager, 'Issuer Claim Value'),
        audience: managerField(manager, 'Audience Claim Value'),
      }])),
      connections: connections.map((connection) => ({
        id: connection.id,
        resourceUris: connection.oauthTokenExchangeSettings?.resourceUris || [],
        idJagEnabled: Boolean(connection.oauthTokenExchangeSettings?.idJagEnabled),
        policies: (connection.oauthTokenExchangeSettings?.processorPolicyMappings || []).map((mapping) => mapping.processorPolicyRef?.id),
      })),
      adapterPlugins: adapters.map((adapter) => adapter.pluginDescriptorRef?.id || ''),
      rarDetailTypes: detailTypes.map((item) => item.type || item.name || item.id).filter(Boolean).sort(),
    };
  }

  // One read per reader: the audit asks for the families once and each role once.
  let snapshot = null;
  const load = (signal) => {
    if (!snapshot) snapshot = read(signal).catch((error) => { snapshot = null; throw error; });
    return snapshot;
  };

  // The live, comparable view of one role. `objectId` is either a literal
  // client ID or the name of the setting that holds it.
  function roleView(role, profile, view) {
    const client = view.clients[env[profile.objectId] || profile.objectId];
    const connectionsWhere = (match) => {
      const selected = view.connections.filter(match);
      return {
        resourceUris: selected.flatMap((connection) => connection.resourceUris).sort(),
        idJagEnabled: selected.length > 0 && selected.every((connection) => connection.idJagEnabled),
      };
    };
    if (role === 'a2a-specialist') {
      const a2a = connectionsWhere((connection) => connection.id.startsWith(A2A_CONNECTION_PREFIX));
      return { present: a2a.resourceUris.length > 0, ...a2a };
    }
    if (role === 'uc40-native-id-jag') {
      return { present: Boolean(client), ...client,
        ...connectionsWhere((connection) => Boolean(client) && connection.policies.includes(client.tokenExchangeProcessorPolicyRef)) };
    }
    if (role === 'davinci-login') {
      return { present: Boolean(client), davinciAdapterConfigured: view.adapterPlugins.some((id) => /davinci/i.test(id)) };
    }
    if (role === 'rar') return { present: Boolean(client), rarDetailTypes: view.rarDetailTypes };
    return { present: Boolean(client), ...client };
  }

  async function readProfile({ role, profile, signal } = {}) {
    return roleView(role, profile, await load(signal));
  }

  async function readConfiguration({ signal } = {}) {
    const view = await load(signal);
    const roles = Object.entries(profiles.roles || {}).filter(([, profile]) => profile.baseline);
    const family = (selected) => {
      if (!selected.length) return { status: 'blocked', reason: 'no committed PingFederate baseline covers this family' };
      const mismatched = Object.fromEntries(selected
        .map(([role, profile]) => [role, baselineMismatches(profile.baseline, roleView(role, profile, view))])
        .filter(([, fields]) => fields.length));
      return { status: Object.keys(mismatched).length ? 'fail' : 'pass', observed: { mismatched } };
    };
    const managers = Object.entries(profiles.accessTokenManagers || {});
    const mismatchedManagers = Object.fromEntries(managers
      .map(([id, expected]) => [id, baselineMismatches(expected, view.accessTokenManagers[id])])
      .filter(([, fields]) => fields.length));
    return {
      clientGrantProcessorAtm: family(roles.filter(([, profile]) => profile.kind === 'oauth-client' && profile.baseline.grantTypes)),
      specialistResourceUriIdJag: family(roles.filter(([role]) => role === 'a2a-specialist')),
      davinciClientAdapter: family(roles.filter(([role]) => role === 'davinci-login')),
      jwksAudience: managers.length
        ? { status: Object.keys(mismatchedManagers).length ? 'fail' : 'pass', observed: { mismatched: mismatchedManagers } }
        : { status: 'blocked', reason: 'no committed PingFederate baseline covers this family' },
    };
  }

  return { readConfiguration, readProfile };
}

module.exports = { createPingFederateReader, baselineMismatches };
