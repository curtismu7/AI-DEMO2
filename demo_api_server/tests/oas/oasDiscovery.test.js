'use strict';
const { getOperations, getOperation, getMockResponse } = require('../../services/oasDiscovery');

describe('getOperations', () => {
  test('returns all 5 operations without filter', () => {
    expect(getOperations()).toHaveLength(5);
  });

  test('each op has required fields', () => {
    for (const op of getOperations()) {
      expect(op).toHaveProperty('method');
      expect(op).toHaveProperty('path');
      expect(op).toHaveProperty('operationId');
      expect(op).toHaveProperty('summary');
      expect(op).toHaveProperty('permission');
      expect(op).toHaveProperty('scope');
      expect(op).toHaveProperty('tags');
    }
  });

  test('filters by tag (case-insensitive)', () => {
    const ops = getOperations('users');
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every(op => op.tags.some(t => t.toLowerCase().includes('users')))).toBe(true);
  });

  test('filters by path fragment', () => {
    const ops = getOperations('applications');
    expect(ops.length).toBeGreaterThan(0);
    expect(ops.every(op => op.path.includes('applications'))).toBe(true);
  });
});

describe('getOperation', () => {
  test('returns op by operationId', () => {
    const op = getOperation('listUsers');
    expect(op).not.toBeNull();
    expect(op.operationId).toBe('listUsers');
    expect(op.path).toBe('/v1/environments/{environmentId}/users');
    expect(op.method).toBe('GET');
  });

  test('returns null for unknown operationId', () => {
    expect(getOperation('doesNotExist')).toBeNull();
  });
});

describe('getMockResponse', () => {
  test('listUsers returns embedded users array', () => {
    const resp = getMockResponse('listUsers', {});
    expect(resp._embedded).toBeDefined();
    expect(Array.isArray(resp._embedded.users)).toBe(true);
    expect(resp._embedded.users.length).toBeGreaterThan(0);
    expect(resp._embedded.users[0]).toHaveProperty('id');
    expect(resp._embedded.users[0]).toHaveProperty('username');
  });

  test('createUser returns created user with id and status', () => {
    const resp = getMockResponse('createUser', { username: 'bob', email: 'bob@example.com' });
    expect(resp.id).toBeDefined();
    expect(resp.username).toBe('bob');
    expect(resp.status).toBe('created');
  });

  test('getUser returns single user', () => {
    const resp = getMockResponse('getUser', { userId: 'user-001' });
    expect(resp.id).toBeDefined();
    expect(resp.username).toBeDefined();
  });

  test('listApplications returns embedded applications array', () => {
    const resp = getMockResponse('listApplications', {});
    expect(resp._embedded).toBeDefined();
    expect(Array.isArray(resp._embedded.applications)).toBe(true);
  });

  test('getEnvironment returns environment object', () => {
    const resp = getMockResponse('getEnvironment', {});
    expect(resp.id).toBeDefined();
    expect(resp.name).toBeDefined();
    expect(resp.type).toBeDefined();
  });

  test('unknown operationId returns error object', () => {
    const resp = getMockResponse('unknownOp', {});
    expect(resp.error).toBeDefined();
  });
});
