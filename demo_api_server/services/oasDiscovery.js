'use strict';
const spec = require('../config/oas/pingone-fragment.json');

// Maps x-permission role label → OAuth scope enforced at the MCP gateway
const PERMISSION_SCOPE_MAP = {
  'Identity Admin':    'read',
  'Environment Admin': 'read',
};

function getOperations(filter) {
  const ops = [];
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = pathItem[method];
      if (!op) continue;
      if (filter) {
        const f = filter.toLowerCase();
        const matchesTag  = (op.tags || []).some(t => t.toLowerCase().includes(f));
        const matchesPath = path.toLowerCase().includes(f);
        if (!matchesTag && !matchesPath) continue;
      }
      ops.push({
        method:      method.toUpperCase(),
        path,
        operationId: op.operationId,
        summary:     op.summary,
        permission:  op['x-permission'] || null,
        scope:       PERMISSION_SCOPE_MAP[op['x-permission']] || 'read',
        publicApi:   op['x-public-api'] || null,
        tags:        op.tags || [],
      });
    }
  }
  return ops;
}

function getOperation(operationId) {
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete']) {
      const op = pathItem[method];
      if (op && op.operationId === operationId) {
        return {
          method:      method.toUpperCase(),
          path,
          operationId: op.operationId,
          summary:     op.summary,
          permission:  op['x-permission'] || null,
          scope:       PERMISSION_SCOPE_MAP[op['x-permission']] || 'read',
          tags:        op.tags || [],
          parameters:  op.parameters || [],
          security:    op.security || spec.security || [],
        };
      }
    }
  }
  return null;
}

const MOCK_ENV_ID = 'env-a1b2c3d4-demo';
const MOCK_USERS = [
  { id: 'user-001', username: 'alice.demo',  email: 'alice@example.com',  enabled: true,  createdAt: '2024-01-15T08:00:00Z' },
  { id: 'user-002', username: 'bob.demo',    email: 'bob@example.com',    enabled: true,  createdAt: '2024-02-10T09:30:00Z' },
  { id: 'user-003', username: 'carol.demo',  email: 'carol@example.com',  enabled: false, createdAt: '2024-03-05T11:00:00Z' },
];
const MOCK_APPS = [
  { id: 'app-001', name: 'Demo AI App - User Login',      type: 'WEB_APP', enabled: true },
  { id: 'app-002', name: 'Demo AI App - MCP Gateway',     type: 'WORKER',  enabled: true },
  { id: 'app-003', name: 'Demo AI App - Token Exchanger', type: 'WORKER',  enabled: true },
];

function getMockResponse(operationId, params) {
  switch (operationId) {
    case 'listUsers':
      return { _embedded: { users: MOCK_USERS }, count: MOCK_USERS.length, size: MOCK_USERS.length };
    case 'createUser':
      return {
        id:        'user-' + String(Date.now()).slice(-6),
        username:  (params && params.username) || 'new.user',
        email:     (params && params.email)    || 'new@example.com',
        enabled:   true,
        createdAt: new Date().toISOString(),
        status:    'created',
      };
    case 'getUser': {
      const found = MOCK_USERS.find(u => u.id === (params && params.userId)) || MOCK_USERS[0];
      return found;
    }
    case 'listApplications':
      return { _embedded: { applications: MOCK_APPS }, count: MOCK_APPS.length };
    case 'getEnvironment':
      return { id: MOCK_ENV_ID, name: 'Demo Environment', type: 'SANDBOX', region: 'NA' };
    default:
      return { error: `unknown operationId: ${operationId}` };
  }
}

module.exports = { getOperations, getOperation, getMockResponse };
