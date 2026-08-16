'use strict';

/**
 * Item 3 (correlation propagation): gateway tool-call audit events shipped to
 * the BFF's LMDB must carry the request's correlation id, so a denied/failed
 * tool call can be reconstructed across BFF → gateway → authz. recordGatewayAudit
 * defaults correlationId from the correlation ALS context unless the caller set
 * one, so neither the WS nor the HTTP audit call site needs to thread it.
 */

import axios from 'axios';
import * as transactionHop from '../src/transactionHop';
import {
  recordGatewayAudit,
  scopeAlertDetails,
  httpScopeAlertDetails,
} from '../src/gatewayAudit';
import { runWithCorrelation } from '../src/correlationContext';
import type { GatewayConfig } from '../src/config';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

const config = {
  bffInternalIdTokenUrl: 'http://bff.local/internal/id-token',
  bffInternalSecret: 's3cret',
} as unknown as GatewayConfig;

function lastBody(): Record<string, unknown> {
  return mockedAxios.post.mock.calls[0][1] as Record<string, unknown>;
}

describe('recordGatewayAudit — correlation id on audit events', () => {
  beforeEach(() => {
    mockedAxios.post.mockReset();
    mockedAxios.post.mockResolvedValue({ status: 200 } as never);
  });

  it('stamps the active correlation id onto the audit event', () => {
    runWithCorrelation('cid-audit-789', () =>
      recordGatewayAudit({ operation: 'create_transfer', outcome: 'failure' }, config),
    );
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockedAxios.post.mock.calls[0][0]).toBe('http://bff.local/internal/mcp-audit');
    expect(lastBody().correlationId).toBe('cid-audit-789');
    expect(lastBody().operation).toBe('create_transfer');
    expect(lastBody().outcome).toBe('failure');
  });

  it('preserves a caller-provided correlation id over the ALS context', () => {
    runWithCorrelation('cid-from-als', () =>
      recordGatewayAudit(
        { operation: 'get_accounts', outcome: 'success', correlationId: 'cid-explicit' },
        config,
      ),
    );
    expect(lastBody().correlationId).toBe('cid-explicit');
  });

  it('leaves correlationId undefined when no context is active', () => {
    recordGatewayAudit({ operation: 'get_accounts', outcome: 'success' }, config);
    expect(lastBody().correlationId).toBeUndefined();
  });
});

describe('recordGatewayAudit — details forwarded into the ledger hop (no divergence from mcpAuditStore)', () => {
  let emitHopSpy: jest.SpyInstance;

  beforeEach(() => {
    mockedAxios.post.mockReset();
    mockedAxios.post.mockResolvedValue({ status: 200 } as never);
    emitHopSpy = jest.spyOn(transactionHop, 'emitHop').mockImplementation(() => {});
  });

  afterEach(() => {
    emitHopSpy.mockRestore();
  });

  it('forwards the same details object built for mcpAuditStore into the emitHop details field', () => {
    const details = {
      httpStatus: 403,
      dpop_bound: true,
      dpop_verified: true,
      alert: true,
      reason: 'insufficient_scope',
      requiredScopes: ['transfers:write'],
      missingScopes: ['transfers:write'],
      availableScopes: ['accounts:read'],
    };
    runWithCorrelation('cid-details-1', () =>
      recordGatewayAudit({ operation: 'create_transfer', outcome: 'failure', details }, config),
    );
    expect(emitHopSpy).toHaveBeenCalledTimes(1);
    const hopArg = emitHopSpy.mock.calls[0][0];
    expect(hopArg.details).toEqual(details);
    expect(hopArg.details).toEqual(lastBody().details);
  });

  it('omits details from the hop when the audit event carries none', () => {
    runWithCorrelation('cid-details-2', () =>
      recordGatewayAudit({ operation: 'get_accounts', outcome: 'success' }, config),
    );
    const hopArg = emitHopSpy.mock.calls[0][0];
    expect(hopArg.details).toBeUndefined();
  });
});

// Scenario 4 — insufficient-scope denials become "unauthorized tool" audit alerts.
describe('scopeAlertDetails — WS JSON-RPC -32005', () => {
  it('flags an alert with required/missing/available scopes', () => {
    const alert = scopeAlertDetails(-32005, {
      tool: 'delete_customer',
      requiredScopes: ['admin:delete'],
      missingScopes: ['admin:delete'],
      availableScopes: ['read'],
    });
    expect(alert).toMatchObject({
      alert: true,
      reason: 'insufficient_scope',
      requiredScopes: ['admin:delete'],
      missingScopes: ['admin:delete'],
      availableScopes: ['read'],
      tool: 'delete_customer',
    });
  });

  it('returns null for non-scope errors and missing data', () => {
    expect(scopeAlertDetails(-32002, { tool: 'x' })).toBeNull();
    expect(scopeAlertDetails(-32005, undefined)).toBeNull();
    expect(scopeAlertDetails(undefined, { tool: 'x' })).toBeNull();
  });
});

describe('httpScopeAlertDetails — HTTP 403 insufficient_scope', () => {
  it('parses required_scope from the HttpMCPTransport body', () => {
    const body = JSON.stringify({
      error: 'insufficient_scope',
      required_scope: 'admin:delete',
      tool: 'delete_customer',
    });
    const alert = httpScopeAlertDetails(403, body);
    expect(alert).toMatchObject({
      alert: true,
      reason: 'insufficient_scope',
      requiredScopes: ['admin:delete'],
      tool: 'delete_customer',
    });
  });

  it('returns null for non-403 or non-scope bodies', () => {
    expect(httpScopeAlertDetails(200, 'ok')).toBeNull();
    expect(httpScopeAlertDetails(403, JSON.stringify({ error: 'hitl_required' }))).toBeNull();
  });
});
