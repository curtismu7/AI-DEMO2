'use strict';

/**
 * A 428 elicitation_required response is a distinct precondition from HITL
 * consent — PingOne Authorize's ELICITATION obligation (see
 * demo_mcp_gateway/src/middleware/authorizeMcpRequest.ts). It must be tagged
 * so mcpToolRegistry.js can translate it into its own structured result
 * instead of misrouting it into the generic HITL consent-modal flow.
 */

jest.mock('axios');
jest.mock('../../services/configStore', () => ({
  getEffective: jest.fn((k) => null),
}));

const axios = require('axios');
const { callToolViaGateway } = require('../../services/mcpGatewayClient');

test('a 428 elicitation_required response is tagged .elicitation with the prompt/id in .rpcData', async () => {
  axios.post = jest.fn().mockResolvedValue({
    status: 428,
    headers: {},
    data: {
      error: 'elicitation_required',
      message: 'Confirm create_withdrawal?',
      elicitation_id: 'elic-1',
      prompt: 'Confirm create_withdrawal?',
      tool_name: 'create_withdrawal',
      expires_in: 120,
    },
  });

  await expect(
    callToolViaGateway('https://api.ping.demo:3005', 'bearer-tok', 'create_withdrawal', {}, {})
  ).rejects.toMatchObject({
    code: 'mcp_tool_error',
    httpStatus: 428,
    elicitation: true,
    rpcData: {
      elicitationId: 'elic-1',
      prompt: 'Confirm create_withdrawal?',
      toolName: 'create_withdrawal',
      expiresIn: 120,
    },
  });
});

test('a 428 elicitation_required response is NOT tagged .hitl (distinct from consent)', async () => {
  axios.post = jest.fn().mockResolvedValue({
    status: 428,
    headers: {},
    data: {
      error: 'elicitation_required',
      elicitation_id: 'elic-2',
      prompt: 'Confirm?',
      tool_name: 'create_withdrawal',
      expires_in: 120,
    },
  });

  await expect(
    callToolViaGateway('https://api.ping.demo:3005', 'bearer-tok', 'create_withdrawal', {}, {})
  ).rejects.not.toMatchObject({ hitl: true });
});
