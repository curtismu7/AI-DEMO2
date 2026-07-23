'use strict';

/**
 * Local teaching tools (oauth-teaching explain_concept, …) must execute in-process
 * via isLocalTool — never fall through to the MCP gateway (Unknown tool).
 */
const { executeBffTool, setPipelineDeps } = require('../../services/bffMcpToolExecutor');
const verticalDispatch = require('../../services/verticalDispatch');

describe('executeBffTool — local teaching tools', () => {
  afterEach(() => {
    setPipelineDeps(null);
  });

  it('findLocalToolPlugin resolves oauth-teaching explain_concept', () => {
    expect(verticalDispatch.findLocalToolPlugin('explain_concept')).toBeTruthy();
    expect(verticalDispatch.findLocalToolPlugin('get_my_accounts')).toBeNull();
  });

  it('runs explain_concept locally even when pipeline deps are wired', async () => {
    // Non-null deps would otherwise send unknown vertical tools into runMcpToolPipeline.
    setPipelineDeps({ publishPhaseToSse: jest.fn() });

    const out = await executeBffTool({
      name: 'explain_concept',
      args: { topic: 'oauth' },
      userId: 'u1',
      userToken: 'tok',
      sessionId: 's1',
      tokenEvents: [],
    });

    const parsed = JSON.parse(out);
    expect(parsed.error).toBeUndefined();
    expect(String(parsed.text || '')).toMatch(/oauth/i);
  });
});
