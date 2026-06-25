'use strict';
const plugin = require('../../config/verticals/pingone-admin/index');

test('plugin exports required interface', () => {
  expect(typeof plugin.getManifest).toBe('function');
  expect(typeof plugin.getTools).toBe('function');
  expect(typeof plugin.getHeuristics).toBe('function');
  expect(typeof plugin.getSystemPrompt).toBe('function');
  expect(typeof plugin.executeTool).toBe('function');
  expect(typeof plugin.getAuthz).toBe('function');
});

test('getTools returns discover_oas_operations and call_pingone_operation', () => {
  const names = plugin.getTools().map(t => t.name);
  expect(names).toContain('discover_oas_operations');
  expect(names).toContain('call_pingone_operation');
});

test('executeTool discover_oas_operations returns all operations', async () => {
  const { result, render } = await plugin.executeTool('discover_oas_operations', {}, {});
  expect(render).toBe('discover_oas_operations');
  expect(Array.isArray(result.operations)).toBe(true);
  expect(result.operations.length).toBeGreaterThanOrEqual(5);
  expect(result.operations[0]).toHaveProperty('method');
  expect(result.operations[0]).toHaveProperty('permission');
});

test('executeTool discover_oas_operations with filter returns subset', async () => {
  const { result } = await plugin.executeTool('discover_oas_operations', { filter: 'Users' }, {});
  expect(result.operations.every(op => op.tags.includes('Users'))).toBe(true);
});

test('executeTool call_pingone_operation listUsers returns fieldList result', async () => {
  const { result, render } = await plugin.executeTool('call_pingone_operation', { operationId: 'listUsers' }, {});
  expect(render).toBe('call_pingone_operation');
  expect(result.operationId).toBe('listUsers');
  expect(result.oasPath).toBe('/v1/environments/{environmentId}/users');
  expect(result.permission).toBe('Identity Admin');
  expect(result.responseSummary).toMatch(/user/i);
});

test('executeTool call_pingone_operation createUser returns confirmation', async () => {
  const { result, render } = await plugin.executeTool('call_pingone_operation', {
    operationId: 'createUser',
    parameters: { username: 'test.alice', email: 'test.alice@example.com' },
  }, {});
  expect(render).toBe('call_pingone_operation');
  expect(result.responseSummary).toBeDefined();
});

test('executeTool call_pingone_operation unknown operationId returns error', async () => {
  const { result } = await plugin.executeTool('call_pingone_operation', { operationId: 'nonExistent' }, {});
  expect(result.error).toBeDefined();
});

test('executeTool unknown tool name returns error', async () => {
  const { result } = await plugin.executeTool('unknown_tool', {}, {});
  expect(result.error).toBeDefined();
});

test('getHeuristics includes OAS discovery and call patterns', () => {
  const heuristics = plugin.getHeuristics();
  expect(Array.isArray(heuristics)).toBe(true);
  expect(heuristics.some(h => h.action === 'discover_oas_operations')).toBe(true);
  expect(heuristics.some(h => h.action === 'call_pingone_operation')).toBe(true);
});
