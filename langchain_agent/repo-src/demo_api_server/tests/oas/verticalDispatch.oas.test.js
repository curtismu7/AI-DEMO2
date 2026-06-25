'use strict';
/**
 * Integration smoke: exercises full BFF dispatch without an HTTP server.
 * Chain: verticalDispatch → pingone-admin plugin → oasDiscovery
 */
const { verticalManifest } = require('../../services/verticalManifest');
const verticalDispatch = require('../../services/verticalDispatch');

// Mirror server startup: loader must populate its cache before isPluginToolName
// iterates listAll(). Without init(), the cache is empty and returns false.
beforeAll(() => { verticalManifest.init(); });

describe('pingone-admin vertical dispatch', () => {
  test('discover_oas_operations returns ops via verticalDispatch', async () => {
    const result = await verticalDispatch.executeToolFor(
      'pingone-admin', 'discover_oas_operations', {}, { userId: 'test-user' }
    );
    expect(result.render).toBe('discover_oas_operations');
    expect(Array.isArray(result.result.operations)).toBe(true);
    expect(result.result.operations.length).toBeGreaterThan(0);
  });

  test('call_pingone_operation listUsers returns fieldList result', async () => {
    const result = await verticalDispatch.executeToolFor(
      'pingone-admin', 'call_pingone_operation', { operationId: 'listUsers' }, { userId: 'test-user' }
    );
    expect(result.result.operationId).toBe('listUsers');
    expect(result.result.oasPath).toBe('/v1/environments/{environmentId}/users');
    expect(result.render).toBe('call_pingone_operation');
  });

  test('discover_oas_operations is recognized as a plugin tool', () => {
    expect(verticalDispatch.isPluginToolName('discover_oas_operations')).toBe(true);
  });

  test('call_pingone_operation is recognized as a plugin tool', () => {
    expect(verticalDispatch.isPluginToolName('call_pingone_operation')).toBe(true);
  });
});
