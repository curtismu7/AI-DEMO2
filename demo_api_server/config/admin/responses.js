'use strict';

const RESPONSES = {
  toolsUnavailable:
    'PingOne Admin tools are unavailable. Ensure the hosted PingOne MCP feature is enabled and worker credentials are configured.',
  maxIterations:
    'Agent reached maximum tool iteration limit. Please rephrase your request.',
  reasoningUnavailable:
    'PingOne Admin reasoning is temporarily unavailable.',
};

function toolsUnavailable() {
  return RESPONSES.toolsUnavailable;
}

function maxIterationsReached() {
  return RESPONSES.maxIterations;
}

function reasoningUnavailable() {
  return RESPONSES.reasoningUnavailable;
}

module.exports = { toolsUnavailable, maxIterationsReached, reasoningUnavailable };
