'use strict';

async function startSegment(name, fn) {
  try {
    const newrelic = require('newrelic');
    return await newrelic.startSegment(name, true, fn);
  } catch (_) {
    return fn();
  }
}

module.exports = {
  startSegment,
  pingOneAuthenticate:  (fn) => startSegment('PingOne/Authenticate', fn),
  tokenExchangeSubject: (fn) => startSegment('TokenExchange/SubjectToken', fn),
  tokenExchangeActor:   (fn) => startSegment('TokenExchange/ActorToken', fn),
  mcpToolCall:          (fn) => startSegment('MCP/ToolCall', fn),
  p1azAuthorize:        (fn) => startSegment('P1AZ/Authorize', fn),
  hitlRequest:          (fn) => startSegment('HITL/RequestApproval', fn),
  hitlAwait:            (fn) => startSegment('HITL/AwaitDecision', fn),
  attackSimVerdict:     (fn) => startSegment('AttackSim/Verdict', fn),
};
