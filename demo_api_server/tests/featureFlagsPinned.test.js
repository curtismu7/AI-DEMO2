'use strict';

// serializeFlag must report pinned/pinnedBy when a flag's controlling env var
// is set — getEffective() is env-first, so such flags are UI-inert and the
// QuickFlagsPill renders them locked instead of showing a dead toggle.

jest.mock('../services/configStore', () => ({
  getEffective: jest.fn(() => undefined),
  setRaw: jest.fn(),
}));
jest.mock('../config/runtimeSettings', () => ({
  get: jest.fn(() => undefined),
  update: jest.fn(),
}));

const { FLAG_REGISTRY, serializeFlag } = require('../routes/featureFlags');

const flagById = (id) => FLAG_REGISTRY.find((f) => f.id === id);

describe('serializeFlag pinned/pinnedBy', () => {
  const ENV_KEYS = [
    'FF_MCP_GATEWAY_PINGGATEWAY',
    'FF_MCP_GATEWAY_JWKS',
    'FF_AUTHORIZE_SIMULATED',
    'FF_HEURISTIC_ENABLED',
    'CIBA_ENABLED',
  ];
  const saved = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  test('env var set -> pinned true with pinnedBy naming the var', () => {
    process.env.FF_MCP_GATEWAY_PINGGATEWAY = 'true';
    const out = serializeFlag(flagById('ff_mcp_gateway_pinggateway'));
    expect(out.pinned).toBe(true);
    expect(out.pinnedBy).toBe('FF_MCP_GATEWAY_PINGGATEWAY');
  });

  test('env var unset -> pinned/pinnedBy omitted', () => {
    const out = serializeFlag(flagById('ff_mcp_gateway_pinggateway'));
    expect(out).not.toHaveProperty('pinned');
    expect(out).not.toHaveProperty('pinnedBy');
  });

  test('empty-string env var does not pin', () => {
    process.env.FF_MCP_GATEWAY_JWKS = '';
    const out = serializeFlag(flagById('ff_mcp_gateway_jwks'));
    expect(out).not.toHaveProperty('pinned');
  });

  test('flag with no env alias never pins', () => {
    const out = serializeFlag(flagById('ff_agent_results_panel'));
    expect(out).not.toHaveProperty('pinned');
  });

  test('existing serialization fields unchanged', () => {
    const out = serializeFlag(flagById('introspectionProvider'));
    expect(out.id).toBe('introspectionProvider');
    expect(out.type).toBe('enum');
    expect(out.options).toEqual(['pinggateway', 'p1az']);
    expect(out).toHaveProperty('value');
    expect(out).toHaveProperty('defaultValue');
  });
});
