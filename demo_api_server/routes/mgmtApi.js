const { Router } = require('express');
const pingOneClientService = require('../services/pingOneClientService');
const { managementService } = require('../services/pingoneManagementService');

const ENV = process.env.PINGONE_ENVIRONMENT_ID || '<env>';
const REGION = process.env.PINGONE_REGION || 'com';
const API_BASE = `https://api.pingone.${REGION}/v1/environments/${ENV}`;

// Allow-list. read: fn(svc) -> service result. create: {create, del, idOf} for
// the create->delete round-trip. curl: fn(params) -> the equivalent curl string
// (token ALWAYS redacted as $TOKEN).
const OPERATIONS = {
  apps_list: {
    group: 'Applications', label: 'List Applications', method: 'GET',
    path: '/applications', mutates: false, params: [],
    read: (svc) => svc.getApplications(),
    listKey: 'applications',
  },
  apps_create: {
    group: 'Applications', label: 'Create Application', method: 'POST',
    path: '/applications', mutates: true, cleanup: true,
    params: [
      { name: 'name', type: 'text', default: 'demo-mgmt-api-<ts>' },
      { name: 'type', type: 'select', options: ['SINGLE_PAGE_APP', 'WEB_APP', 'WORKER'], default: 'SINGLE_PAGE_APP' },
    ],
    create: (svc, p) => svc.createApplication(p.name, 'Headless demo (auto-deleted)', p.type, ['authorization_code'], ['https://local.ping-devops.com:4000/callback']),
    del: (svc, id) => svc.deleteApplication(id),
    body: (p) => ({ name: p.name, type: p.type, protocol: 'OPENID_CONNECT', grantTypes: ['AUTHORIZATION_CODE'] }),
  },
  users_list: {
    group: 'Users', label: 'List Users', method: 'GET',
    path: '/users?limit=20', mutates: false, params: [],
    read: (svc) => svc.getUsers(20), listKey: 'users',
  },
  users_create: {
    group: 'Users', label: 'Create User', method: 'POST',
    path: '/users', mutates: true, cleanup: true,
    params: [
      { name: 'email', type: 'text', default: 'demo-mgmt-api-<ts>@example.com' },
      { name: 'populationId', type: 'select', optionsFrom: 'populations_list' },
    ],
    create: (svc, p) => svc.createUser({ populationId: p.populationId, username: p.email, email: p.email }),
    del: (svc, id) => svc.deleteUser(id),
    body: (p) => ({ population: { id: p.populationId }, username: p.email, email: p.email }),
  },
  populations_list: {
    group: 'Populations', label: 'List Populations', method: 'GET',
    path: '/populations', mutates: false, params: [],
    read: (svc) => svc.getPopulations(), listKey: 'populations',
  },
};

function buildCurl(op, params = {}) {
  const url = `${API_BASE}${op.path.startsWith('/') ? op.path : '/' + op.path}`;
  if (op.method === 'GET') {
    return `curl -X GET '${url}' -H 'Authorization: Bearer $TOKEN'`;
  }
  const body = op.body ? JSON.stringify(op.body(params)) : '{}';
  return `curl -X POST '${url}' -H 'Authorization: Bearer $TOKEN' -H 'Content-Type: application/json' -d '${body}'`;
}

async function ensureManagement() {
  const workerToken = await pingOneClientService.getManagementToken();
  managementService.initialize(workerToken);
}

const router = Router();

router.get('/operations', (_req, res) => {
  res.json(
    Object.entries(OPERATIONS).map(([key, op]) => ({
      key, group: op.group, label: op.label, method: op.method, path: op.path,
      mutates: Boolean(op.mutates), cleanup: Boolean(op.cleanup), params: op.params || [],
    }))
  );
});

router.post('/run', async (req, res) => {
  const { operationKey, params = {} } = req.body || {};
  const op = OPERATIONS[operationKey];
  if (!op) return res.status(400).json({ error: 'unknown_operation', operationKey });

  const curl = buildCurl(op, params);
  try {
    await ensureManagement();
  } catch (e) {
    return res.json({ operation: op.label, curl, steps: [{ label: 'auth', status: 500, body: { error: String(e.message || e) } }], response: null });
  }

  // Read-only
  if (!op.mutates) {
    const result = await op.read(managementService);
    const ok = result.success !== false;
    return res.json({
      operation: op.label, curl,
      steps: [{ label: `${op.method} ${op.path}`, status: ok ? 200 : 502, body: result }],
      response: result,
    });
  }

  // Create -> delete round-trip
  const created = await op.create(managementService, params);
  if (created.success === false || !created.id) {
    return res.json({
      operation: op.label, curl,
      steps: [{ label: `POST ${op.path}`, status: 502, body: created }],
      response: created, cleanedUp: false, leakedId: null,
    });
  }
  const id = created.id;
  const del = await op.del(managementService, id);
  const cleanedUp = del.success !== false;
  return res.json({
    operation: op.label, curl,
    steps: [
      { label: `POST ${op.path}`, status: 201, body: created },
      { label: `DELETE ${op.path}/${id}`, status: cleanedUp ? 204 : 502, body: del },
    ],
    response: created,
    cleanedUp,
    leakedId: cleanedUp ? null : id,
    ...(cleanedUp ? {} : { warning: `⚠️ cleanup failed — leaked ${operationKey} id ${id}` }),
  });
});

module.exports = router;
