'use strict';
const { getOperations, getOperation, getMockResponse } = require('../../../services/oasDiscovery');

const tools = [
  {
    name: 'discover_oas_operations',
    description: 'Read the PingOne OpenAPI 3.1 spec to discover available API operations, their x-permission annotations, and required OAuth scopes.',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', description: 'Optional: filter by tag (e.g. "Users") or path fragment (e.g. "applications")' },
      },
    },
    scopes: ['read'],
    authz: {},
  },
  {
    name: 'call_pingone_operation',
    description: 'Execute a PingOne API operation by operationId discovered from the OpenAPI spec.',
    inputSchema: {
      type: 'object',
      properties: {
        operationId: { type: 'string', description: 'OAS operationId (e.g. listUsers, createUser, listApplications, getEnvironment)' },
        parameters:  { type: 'object', description: 'Operation parameters as key-value pairs' },
      },
      required: ['operationId'],
    },
    scopes: ['read'],
    authz: {},
  },
  { name: 'api_key_demo',    description: 'Demo API-key path.',                inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
  { name: 'dual_token_demo', description: 'Demo access and ID token path.',    inputSchema: { type: 'object', properties: {} }, scopes: ['read'], authz: {} },
];

function summaryForResponse(operationId, raw) {
  switch (operationId) {
    case 'listUsers':        return `${raw._embedded.users.length} users found`;
    case 'createUser':       return `User ${raw.username} created (id: ${raw.id})`;
    case 'getUser':          return `User: ${raw.username} (${raw.email})`;
    case 'listApplications': return `${raw._embedded.applications.length} applications found`;
    case 'getEnvironment':   return `${raw.name} — ${raw.type}, region ${raw.region}`;
    default:                 return JSON.stringify(raw).slice(0, 120);
  }
}

async function execute(name, params, _ctx) {
  switch (name) {
    case 'discover_oas_operations': {
      const operations = getOperations(params && params.filter);
      return { result: { operations }, render: 'discover_oas_operations' };
    }
    case 'call_pingone_operation': {
      const operationId = params && params.operationId;
      if (!operationId) {
        return { result: { error: 'operationId is required' }, render: 'text' };
      }
      const op = getOperation(operationId);
      if (!op) {
        return { result: { error: `Unknown operationId: ${operationId}. Call discover_oas_operations to see valid ids.` }, render: 'text' };
      }
      const raw = getMockResponse(operationId, (params && params.parameters) || {});
      return {
        result: {
          operationId:     op.operationId,
          oasPath:         op.path,
          permission:      op.permission,
          scopeRequired:   op.scope,
          responseSummary: summaryForResponse(operationId, raw),
        },
        render: 'call_pingone_operation',
      };
    }
    case 'api_key_demo':
    case 'dual_token_demo':
      return { result: { message: `${name} is not available in this vertical` }, render: 'text' };
    default:
      return { result: { error: `unknown tool: ${name}` }, render: 'text' };
  }
}

module.exports = { tools, execute };
