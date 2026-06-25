// banking_api_server/services/pingoneBootstrapService.js
'use strict';

/**
 * PingOne tenant bootstrap: plan text, Management API probe, and optional run
 * (create OIDC apps + directory users from example manifest).
 *
 * Worker token: uses pingOneClientService.getManagementToken() → pingone_client_id/secret
 * (Config, CIMD, or PINGONE_MANAGEMENT_CLIENT_* env). Not the Authorize worker
 * (PINGONE_AUTHORIZE_WORKER_*) unless you deliberately use the same PingOne app.
 */

const fs = require('fs').promises;
const path = require('path');
const axios = require('axios');
const configStore = require('./configStore');
const pingOneClientService = require('./pingOneClientService');

/**
 * Build human-readable bootstrap steps from a manifest object (no API calls).
 * @param {object} manifest
 * @returns {string[]}
 */
function planStepsFromManifest(manifest) {
  if (!manifest || typeof manifest !== 'object') {
    return ['Invalid manifest: expected a JSON object.'];
  }
  const steps = [];
  const v = manifest.version != null ? String(manifest.version) : '?';
  steps.push(`Manifest version ${v}${manifest.about ? ` — ${manifest.about}` : ''}`);

  if (manifest.publicUrlTemplate) {
    steps.push(`Set production URL from template: ${manifest.publicUrlTemplate}`);
    steps.push('Register matching redirect URIs on admin and user OIDC apps (see Application Configuration).');
  }

  const rs = manifest.resourceServer;
  if (rs?.name) {
    steps.push(`Resource server: create "${rs.name}"${rs.audience ? ` (audience ${rs.audience})` : ''}.`);
    const sc = Array.isArray(rs.scopes) ? rs.scopes.length : 0;
    if (sc > 0) {
      steps.push(`Attach ${sc} custom scope(s) to the resource and map them to OIDC apps.`);
    }
  }

  const apps = manifest.applications && typeof manifest.applications === 'object'
    ? manifest.applications
    : {};
  for (const [key, app] of Object.entries(apps)) {
    if (!app || typeof app !== 'object') continue;
    const name = app.name || key;
    const type = app.type || 'WEB_APP';
    steps.push(`Application [${key}]: ${name} (${type})${app.note ? ` — ${app.note}` : ''}`);
  }

  const users = Array.isArray(manifest.demoUsers) ? manifest.demoUsers : [];
  if (users.length > 0) {
    steps.push(`Directory users: create ${users.length} demo user(s) (${users.map(u => u.username).filter(Boolean).join(', ') || 'see manifest'}).`);
  }

  steps.push('Full automated provisioning: npm run setup:fresh (repo root) — apps, resources, scopes, demo users, .env.');
  steps.push('Use Admin → Demo data → bootstrap Authorize decision endpoints when the Authorize worker is configured.');
  steps.push('Legacy manifest preview: npm run pingone:bootstrap:legacy-manifest (add --probe once Management API worker credentials are configured). Full provisioner: npm run pingone:bootstrap.');

  return steps;
}

/**
 * Load and parse a manifest file from disk.
 * @param {string} filePath absolute or relative path
 * @returns {Promise<object>}
 */
async function loadManifestFromPath(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Default path to the committed example manifest (repo root /config).
 * @returns {string}
 */
function getExampleManifestPath() {
  return path.join(__dirname, '../../config/pingone-bootstrap.manifest.example.json');
}

/**
 * Probe PingOne Management API by listing OIDC applications (read-only).
 * Uses pingOneClientService (pingone_client_id / secret or equivalent stored config + env).
 * @returns {Promise<{ ok: boolean, applicationCount?: number, sample?: object[], error?: string, hint?: string }>}
 */
async function probeManagementApiAccess() {
  try {
    const apps = await pingOneClientService.listApplications();
    return {
      ok: true,
      applicationCount: apps.length,
      sample: apps.slice(0, 8).map(a => ({ name: a.name, type: a.type, id: a.id })),
    };
  } catch (err) {
    const msg = err.message || String(err);
    return {
      ok: false,
      error: msg,
      hint:
        'Configure a PingOne worker with Management API access. CIMD registration stores pingone_client_id/secret, ' +
        'or set credentials your deployment uses for client registration.',
    };
  }
}

/**
 * Whether Management API client_credentials can be obtained (no network call).
 * @returns {{ managementWorkerReady: boolean, environmentIdSet: boolean, hint: string }}
 */
function getManagementWorkerConfigStatus() {
  const envId = String(configStore.getEffective('PINGONE_ENVIRONMENT_ID') || '').trim();
  const cid = String(configStore.getEffective('PINGONE_MANAGEMENT_CLIENT_ID') || '').trim();
  const csec = String(configStore.getEffective('PINGONE_MANAGEMENT_CLIENT_SECRET') || '').trim();
  const ready = !!(envId && cid && csec);
  return {
    managementWorkerReady: ready,
    environmentIdSet: !!envId,
    hint:
      'Bootstrap run uses a PingOne app with the **client_credentials** grant and **Management API** roles ' +
      '(Applications, Users, etc.). Set **pingone_client_id** + **pingone_client_secret** in Application Configuration ' +
      '(after CIMD register) or **PINGONE_MANAGEMENT_CLIENT_ID** + **PINGONE_MANAGEMENT_CLIENT_SECRET** in env. ' +
      '**PINGONE_AUTHORIZE_WORKER_*** is only for PingOne Authorize APIs unless that same app is granted Management permissions.',
  };
}

/**
 * First population in the environment (for demo user placement).
 * @param {string} token
 * @param {string} apiRoot https://api.pingone.{region}/v1/environments/{envId}
 */
async function fetchFirstPopulationId(token, apiRoot) {
  const url = `${apiRoot}/populations`;
  const { data } = await axios.get(url, {
    headers: { Authorization: `Bearer ${token}` },
    timeout: 20000,
  });
  const pops = data?._embedded?.populations || [];
  if (!pops.length) {
    throw new Error('No populations returned from PingOne');
  }
  const preferred =
    pops.find((p) => /default/i.test(String(p.name || ''))) ||
    pops.find((p) => p.default === true) ||
    pops[0];
  return preferred.id;
}

/**
 * Create manifest applications + optional demo users (idempotent by application name / user conflicts).
 *
 * @param {object} options
 * @param {string} options.publicBaseUrl  e.g. https://banking-demo-puce.vercel.app
 * @param {boolean} [options.dryRun]
 * @param {boolean} [options.includeUsers=true]
 * @param {object} [options.manifest]
 * @returns {Promise<object>}
 */
async function runPingOneBootstrap(options = {}) {
  const publicBaseUrl = String(options.publicBaseUrl || '').trim().replace(/\/$/, '');
  const dryRun = !!options.dryRun;
  const includeUsers = options.includeUsers !== false;

  const result = {
    ok: true,
    dryRun,
    publicBaseUrl,
    steps: [],
    manualSteps: [],
    errors: [],
    worker: getManagementWorkerConfigStatus(),
  };

  if (!publicBaseUrl || !/^https:\/\//i.test(publicBaseUrl)) {
    result.ok = false;
    result.errors.push({
      phase: 'validate',
      message: 'publicBaseUrl must be an https URL (trailing slash optional).',
    });
    return result;
  }

  let manifest;
  try {
    manifest =
      options.manifest && typeof options.manifest === 'object'
        ? options.manifest
        : await loadManifestFromPath(getExampleManifestPath());
  } catch (e) {
    result.ok = false;
    result.errors.push({ phase: 'manifest', message: e.message || String(e) });
    return result;
  }

  result.manualSteps.push({
    title: 'Resource server + * scopes',
    detail:
      'Not created by this API. Add a custom resource and scopes in PingOne if you need RFC 8707 / token-exchange demos.',
  });

  let token;
  try {
    token = await pingOneClientService.getManagementToken();
  } catch (e) {
    result.ok = false;
    result.errors.push({
      phase: 'management_token',
      message: e.message || String(e),
      hint: result.worker.hint,
    });
    return result;
  }

  const envId = configStore.getEffective('PINGONE_ENVIRONMENT_ID');
  const region = configStore.getEffective('PINGONE_REGION') || 'com';
  const apiRoot = `https://api.pingone.${region}/v1/environments/${envId}`;

  let existingApps = [];
  try {
    existingApps = await pingOneClientService.listOidcApplicationsRaw();
  } catch (e) {
    result.ok = false;
    result.errors.push({ phase: 'list_applications', message: e.message || String(e) });
    return result;
  }

  const appsManifest = manifest.applications && typeof manifest.applications === 'object' ? manifest.applications : {};
  const order = ['admin_oidc', 'user_oidc', 'authorize_worker'];

  for (const key of order) {
    const spec = appsManifest[key];
    if (!spec || typeof spec !== 'object' || !spec.name) continue;

    const found = existingApps.find((a) => (a.name || '').trim() === String(spec.name).trim());
    if (found) {
      result.steps.push({
        key,
        action: 'skipped',
        name: spec.name,
        pingoneApplicationId: found.id,
      });
      continue;
    }

    if (dryRun) {
      result.steps.push({ key, action: 'would_create', name: spec.name });
      continue;
    }

    try {
      /** @type {object} */
      let metadata;
      if (key === 'admin_oidc') {
        metadata = {
          client_name: spec.name,
          application_type: 'web',
          grant_types: ['authorization_code'],
          response_types: ['code'],
          redirect_uris: [`${publicBaseUrl}/api/auth/oauth/callback`],
          token_endpoint_auth_method: 'client_secret_basic',
        };
      } else if (key === 'user_oidc') {
        metadata = {
          client_name: spec.name,
          application_type: 'web',
          grant_types: ['authorization_code'],
          response_types: ['code'],
          redirect_uris: [`${publicBaseUrl}/api/auth/oauth/user/callback`],
          token_endpoint_auth_method: 'client_secret_basic',
        };
      } else if (key === 'authorize_worker') {
        metadata = {
          client_name: spec.name,
          application_type: 'service',
          grant_types: ['client_credentials'],
          response_types: [],
          redirect_uris: [],
          token_endpoint_auth_method: 'client_secret_basic',
        };
      } else {
        continue;
      }

      const app = await pingOneClientService.createApplication(metadata);
      result.steps.push({
        key,
        action: 'created',
        name: spec.name,
        pingoneApplicationId: app.id,
        clientSecretReturned: !!app.clientSecret,
      });
      existingApps.push(app);
    } catch (e) {
      const msg =
        e.response?.data?.message ||
        e.response?.data?.error ||
        e.message ||
        String(e);
      result.ok = false;
      result.steps.push({ key, action: 'failed', name: spec.name, error: msg });
    }
  }

  if (includeUsers && Array.isArray(manifest.demoUsers) && manifest.demoUsers.length > 0) {
    let populationId = null;
    if (!dryRun) {
      try {
        populationId = await fetchFirstPopulationId(token, apiRoot);
      } catch (e) {
        result.manualSteps.push({
          title: 'Demo users',
          detail: `Could not list populations: ${e.message}. Create users manually in PingOne.`,
        });
      }
    }

    for (const u of manifest.demoUsers) {
      const username = typeof u.username === 'string' ? u.username.trim() : '';
      const email = typeof u.email === 'string' ? u.email.trim() : '';
      if (!username) continue;

      if (dryRun) {
        result.steps.push({
          key: `user:${username}`,
          action: 'would_create_user',
          username,
          email: email || null,
        });
        continue;
      }

      if (!populationId) {
        result.steps.push({
          key: `user:${username}`,
          action: 'skipped_user',
          username,
          note: 'no population id',
        });
        continue;
      }

      try {
        const resp = await axios.post(
          `${apiRoot}/users`,
          {
            username,
            email: email || `${username}@example.invalid`,
            population: { id: populationId },
            name: { given: username, family: 'Demo' },
          },
          {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            timeout: 20000,
            validateStatus: () => true,
          }
        );
        if (resp.status === 201) {
          result.steps.push({ key: `user:${username}`, action: 'created_user', username });
        } else {
          const body = resp.data;
          const txt = JSON.stringify(body || {}).toLowerCase();
          const conflict =
            resp.status === 409 ||
            (resp.status === 400 &&
              (txt.includes('unique') ||
                txt.includes('already') ||
                txt.includes('exist') ||
                txt.includes('duplicate')));
          if (conflict) {
            result.steps.push({ key: `user:${username}`, action: 'skipped_user', username });
          } else {
            result.ok = false;
            result.steps.push({
              key: `user:${username}`,
              action: 'failed_user',
              username,
              error: body?.message || body?.error || `HTTP ${resp.status}`,
            });
          }
        }
      } catch (e) {
        result.ok = false;
        result.steps.push({
          key: `user:${username}`,
          action: 'failed_user',
          username,
          error: e.message || String(e),
        });
      }
    }

    result.manualSteps.push({
      title: 'Initial passwords for demo users',
      detail:
        'PingOne create-user does not set passwords. Use Admin Console (Set password), recovery, or the import-user API.',
    });
  }

  return result;
}

module.exports = {
  planStepsFromManifest,
  loadManifestFromPath,
  getExampleManifestPath,
  probeManagementApiAccess,
  getManagementWorkerConfigStatus,
  runPingOneBootstrap,
};
