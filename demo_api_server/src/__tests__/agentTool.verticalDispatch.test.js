'use strict';

const verticalDispatch = require('../../services/verticalDispatch');

jest.mock('../../services/verticalDispatch', () => ({
  isPluginToolName: jest.fn((name) => name === 'view_coverage' || name === 'lookup_customer'),
}));

describe('agentTool plugin-tool detection', () => {
  it('isPluginToolName identifies vertical and admin plugin tools', () => {
    expect(verticalDispatch.isPluginToolName('view_coverage')).toBe(true);
    expect(verticalDispatch.isPluginToolName('lookup_customer')).toBe(true);
  });

  it('isPluginToolName returns false for banking MCP registry tools only', () => {
    expect(verticalDispatch.isPluginToolName('get_my_accounts')).toBe(false);
  });
});
