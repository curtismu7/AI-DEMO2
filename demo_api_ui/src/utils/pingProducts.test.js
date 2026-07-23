import { describe, it, expect } from 'vitest';
import {
  PING_PRODUCTS,
  productForStep,
  productForEvent,
  productsForUseCase,
} from './pingProducts';

describe('productForStep', () => {
  it('maps user-token to idp', () => {
    expect(productForStep('user-token')).toBe(PING_PRODUCTS.idp);
  });
  it('maps exchanged-token to idp', () => {
    expect(productForStep('exchanged-token')).toBe(PING_PRODUCTS.idp);
  });
  it('maps gw-introspection to gw', () => {
    expect(productForStep('gw-introspection')).toBe(PING_PRODUCTS.gw);
  });
  it('maps gw-authorize to authz', () => {
    expect(productForStep('gw-authorize')).toBe(PING_PRODUCTS.authz);
  });
  it('maps authorize-decision catalog slug to authz', () => {
    expect(productForStep('authorize-decision')).toBe(PING_PRODUCTS.authz);
  });
  it('maps mfa-challenge catalog slug to mfa', () => {
    expect(productForStep('mfa-challenge')).toBe(PING_PRODUCTS.mfa);
  });
  it('maps tool-dispatched catalog slug to gw', () => {
    expect(productForStep('tool-dispatched')).toBe(PING_PRODUCTS.gw);
  });
  it('returns null for unknown step', () => {
    expect(productForStep('unknown-xyz')).toBeNull();
  });
  it('returns null for empty string', () => {
    expect(productForStep('')).toBeNull();
  });
  it('maps a2a-agent-card to idp', () => {
    expect(productForStep('a2a-agent-card')).toBe(PING_PRODUCTS.idp);
  });

  it('maps a2a-exchange1 to idp', () => {
    expect(productForStep('a2a-exchange1')).toBe(PING_PRODUCTS.idp);
  });
  it('maps token-refresh to idp', () => {
    expect(productForStep('token-refresh')).toBe(PING_PRODUCTS.idp);
  });
});

describe('productForEvent', () => {
  it('returns mfa for tool-hitl with step_up', () => {
    expect(productForEvent({ id: 'tool-hitl', challengeType: 'step_up' })).toBe(PING_PRODUCTS.mfa);
  });
  it('returns authz for tool-hitl with consent', () => {
    expect(productForEvent({ id: 'tool-hitl', challengeType: 'consent' })).toBe(PING_PRODUCTS.authz);
  });
  it('returns authz for tool-hitl with no challengeType', () => {
    expect(productForEvent({ id: 'tool-hitl' })).toBe(PING_PRODUCTS.authz);
  });
  it('delegates non-tool-hitl ids to productForStep', () => {
    expect(productForEvent({ id: 'gw-introspection' })).toBe(PING_PRODUCTS.gw);
  });
  it('returns null for null event', () => {
    expect(productForEvent(null)).toBeNull();
  });
});

describe('productsForUseCase', () => {
  it('returns deduplicated products in registry order', () => {
    const uc = {
      evidence: { tokenChain: ['user-token', 'token-exchange', 'authorize-decision', 'tool-dispatched'] },
    };
    const result = productsForUseCase(uc);
    expect(result.map((p) => p.id)).toEqual(['idp', 'gw', 'authz']);
  });
  it('includes mfa only when mfa-challenge is in chain', () => {
    const uc = {
      evidence: { tokenChain: ['user-token', 'mfa-challenge', 'authorize-decision'] },
    };
    const result = productsForUseCase(uc);
    expect(result.map((p) => p.id)).toEqual(['idp', 'mfa', 'authz']);
  });
  it('returns empty array for empty tokenChain', () => {
    expect(productsForUseCase({ evidence: { tokenChain: [] } })).toEqual([]);
  });
  it('returns empty array for missing evidence', () => {
    expect(productsForUseCase({})).toEqual([]);
  });
  it('deduplicates -- multiple exchange steps map to one idp chip', () => {
    const uc = {
      evidence: { tokenChain: ['user-token', 'token-exchange', 'user-token'] },
    };
    const result = productsForUseCase(uc);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('idp');
  });
});
