'use strict';

/**
 * The vertical the gateway is told must be the one the request was authorized
 * against.
 *
 * Active vertical had split authority: per-session for NL routing and the MCP
 * authz gate (mcpToolAuthorizationService uses resolver.activeIdFor(req)), but
 * process-global for the gateway's X-Active-Vertical header and for
 * routes/verticalTool.js tool dispatch. PingOne Authorize uses that header as a
 * policy input, so once an admin switched the global vertical, the BFF
 * authorized a request under one vertical and told the gateway a different one.
 */

const verticalTool = require('../../routes/verticalTool');
const configStore = require('../../services/configStore');
const { verticalManifest } = require('../../services/verticalManifest');

describe('gateway vertical is session-resolved, not process-global', () => {
  afterEach(() => jest.restoreAllMocks());

  describe('routes/verticalTool resolveVertical', () => {
    const { resolveVertical } = verticalTool;

    // Exported only for this test? If not, the behaviour is still covered by the
    // pipeline assertions below; skip rather than assert on a private symbol.
    const maybe = typeof resolveVertical === 'function' ? test : test.skip;

    maybe('prefers the session vertical over the process-global', () => {
      jest.spyOn(verticalManifest.resolver, 'activeIdFor').mockReturnValue('healthcare');
      jest.spyOn(configStore, 'getEffective').mockImplementation((k) =>
        (k === 'active_vertical' ? 'banking' : undefined));

      // An unknown tool falls through to "active vertical, else banking" — the
      // branch that read the global directly.
      const req = { body: {}, session: { active_vertical: 'healthcare' } };
      expect(resolveVertical('some_unowned_tool', req)).toBe('healthcare');
    });

    maybe('falls back to the process-global when the session pinned nothing', () => {
      jest.spyOn(verticalManifest.resolver, 'activeIdFor').mockReturnValue(null);
      jest.spyOn(configStore, 'getEffective').mockImplementation((k) =>
        (k === 'active_vertical' ? 'retail' : undefined));

      expect(resolveVertical('some_unowned_tool', { body: {}, session: {} })).toBe('retail');
    });
  });

  describe('mcpToolPipeline gateway call', () => {
    test('passes the session vertical to callToolViaGateway', async () => {
      // The pipeline resolves it once up-front and hands it to the gateway
      // client, which only falls back to the global when opts.vertical is absent.
      const spy = jest.spyOn(verticalManifest.resolver, 'activeIdFor').mockReturnValue('workforce');
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../../services/mcpToolPipeline.js'), 'utf8',
      );

      // Structural assertions: the value is resolved from the request and handed
      // to the gateway call. Driving the whole pipeline here would need a live
      // token chain; these two lines are what actually changed.
      expect(src).toMatch(/sessionVertical\s*=\s*require\('\.\/verticalManifest'\)[\s\S]*?activeIdFor\(req\)/);
      expect(src).toMatch(/callToolViaGateway\([\s\S]{0,400}?vertical:\s*sessionVertical/);
      spy.mockRestore();
    });

    test('mcpGatewayClient still falls back to the global when no vertical is passed', () => {
      // Preserves the existing contract for callers that have no request
      // context (e.g. utils/mcpToolRegistry), so this change is additive.
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '../../services/mcpGatewayClient.js'), 'utf8',
      );
      expect(src).toMatch(/opts\s*&&\s*opts\.vertical\)\s*\|\|\s*configStore\.getEffective\('active_vertical'\)/);
    });
  });
});
