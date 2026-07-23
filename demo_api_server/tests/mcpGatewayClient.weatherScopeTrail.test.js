// demo_api_server/tests/mcpGatewayClient.weatherScopeTrail.test.js
'use strict';

const {
  _extractGatewayDenyFields,
  _syntheticWeatherScopeTrail,
  _trailWithWeatherFallback,
} = require('../services/mcpGatewayClient');

describe('mcpGatewayClient weather-scope TraceRail trail', () => {
  test('extracts message from JSON-RPC 403 body (tx-weather-scope.groovy shape)', () => {
    const fields = _extractGatewayDenyFields({
      jsonrpc: '2.0',
      id: 1,
      error: {
        code: -32000,
        message: 'Agent Gateway: weather scope restricted to Texas (demo policy) — city not recognized as Texas',
      },
    });
    expect(fields.message).toMatch(/weather scope restricted to Texas/);
    expect(fields.errorCode).toBe('jsonrpc_-32000');
  });

  test('synthesizes filter trail when X-Gw-Audit-Trail is absent', () => {
    const msg = 'Agent Gateway: weather scope restricted to Texas (demo policy) — city not recognized as Texas';
    const trail = _syntheticWeatherScopeTrail(msg, 'get_weather');
    expect(trail.denyingFilter).toBe('tx-weather-scope.groovy');
    expect(trail.mcpAudit.how.result).toBe('blocked');
    expect(trail.filterChain).toContain('TxWeatherScope');
  });

  test('merges synthetic filter onto a parsed trail missing mcpAudit', () => {
    const msg = 'Agent Gateway: weather capability disabled (ff_weather_mcp_showcase is off)';
    const merged = _trailWithWeatherFallback({ introspection: { active: true } }, msg, 'get_weather');
    expect(merged.introspection.active).toBe(true);
    expect(merged.denyingFilter).toBe('tx-weather-scope.groovy');
    expect(merged.mcpAudit.eventName).toBe('PING-GATEWAY-WEATHER-SCOPE');
  });
});
