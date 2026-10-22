'use strict';
/** rar-permit sim: a gateway ELICITATION is confirmed once and retried, like the agent's confirmation modal. */
const { _elicitationConfirmArgs } = require('../services/attackSimulatorService').__test;

describe('_elicitationConfirmArgs', () => {
  test('an elicitation error with an id yields the echo-back args', () => {
    const err = Object.assign(new Error('Confirm'), { elicitation: true, gatewayErrorCode: 'elicitation_required', rpcData: { elicitationId: 'el-1' } });
    expect(_elicitationConfirmArgs(err)).toEqual({ _elicitation_id: 'el-1', _elicitation_confirmed: true });
  });
  test('an elicitation error with NO id cannot be confirmed', () => {
    expect(_elicitationConfirmArgs(Object.assign(new Error('x'), { elicitation: true, rpcData: {} }))).toBeNull();
  });
  test('a genuine denial is never auto-confirmed', () => {
    expect(_elicitationConfirmArgs(Object.assign(new Error('denied'), { code: 'mcp_tool_error', httpStatus: 403 }))).toBeNull();
    expect(_elicitationConfirmArgs(null)).toBeNull();
  });
  test('step-up and HITL challenges are not elicitations', () => {
    expect(_elicitationConfirmArgs(Object.assign(new Error('s'), { stepUp: true, rpcData: { elicitationId: 'x' } }))).toBeNull();
  });
});
