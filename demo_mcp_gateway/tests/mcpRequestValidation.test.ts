'use strict';
import { validateMethodAndShape, validateToolArgs, ALLOWED_METHODS } from '../src/validation/mcpRequestValidation';

describe('validateMethodAndShape', () => {
  it('allows the four MCP methods', () => {
    for (const m of ['initialize', 'notifications/initialized', 'tools/list']) {
      expect(validateMethodAndShape(m, undefined)).toBeNull();
    }
    expect(validateMethodAndShape('tools/call', { name: 'get_my_accounts', arguments: {} })).toBeNull();
  });
  it('rejects unknown methods with -32601', () => {
    const f = validateMethodAndShape('resources/list', undefined);
    expect(f).toMatchObject({ code: -32601 });
  });
  it('rejects tools/call without a non-empty string name', () => {
    expect(validateMethodAndShape('tools/call', {})).toMatchObject({ code: -32602 });
    expect(validateMethodAndShape('tools/call', { name: '' })).toMatchObject({ code: -32602 });
    expect(validateMethodAndShape('tools/call', { name: 42 })).toMatchObject({ code: -32602 });
  });
  it('rejects tools/call when arguments is not an object', () => {
    expect(validateMethodAndShape('tools/call', { name: 'x', arguments: 'nope' })).toMatchObject({ code: -32602 });
    expect(validateMethodAndShape('tools/call', { name: 'x', arguments: [1] })).toMatchObject({ code: -32602 });
  });
});

describe('validateToolArgs', () => {
  it('accepts valid args for a real tool', () => {
    expect(validateToolArgs('get_my_accounts', {})).toBeNull();
  });
  it('rejects schema-violating args with -32602 and validationErrors', () => {
    // special_offers schema is additionalProperties:false — any extra key violates it
    const f = validateToolArgs('special_offers', { bogus: true });
    expect(f).toMatchObject({ code: -32602 });
    expect(Array.isArray(f?.data?.validationErrors)).toBe(true);
  });
  it('fails closed on unknown tool names', () => {
    expect(validateToolArgs('not_a_real_tool', {})).toMatchObject({ code: -32602 });
  });
});
