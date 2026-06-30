'use strict';

/**
 * CrewAI Task definitions for A2A delegation workflow.
 * Tasks are executed by agents in the crew to analyze and approve delegations.
 */

function buildDecisionTask(agent, message) {
  return {
    description:
      `Analyze this user message and decide whether delegation is appropriate: "${message}"\n\n` +
      'Respond with JSON: { "shouldDelegate": boolean, "reason": string, "sensitivity": "low|medium|high" }',
    expected_output:
      'A JSON decision with shouldDelegate flag, explanation, and data sensitivity assessment.',
    agent,
  };
}

function buildCoordinatorTask(agent, vertical, specialists) {
  return {
    description:
      `Given the vertical "${vertical}" with available specialists: ${JSON.stringify(specialists)}\n\n` +
      'Recommend which specialist should handle the delegated task and what minimum scopes they need.\n' +
      'Respond with JSON: { "specialist": string, "scopes": string[], "reasoning": string }',
    expected_output:
      'A JSON recommendation with specialist name, required scopes, and explanation.',
    agent,
  };
}

function buildAuthorizationTask(agent, specialist, scopes) {
  return {
    description:
      `Review this delegation request for authorization feasibility:\n` +
      `Specialist: ${specialist}\n` +
      `Requested scopes: ${scopes.join(', ')}\n\n` +
      'Determine if this delegation and scope set can be approved by PingOne Authorize (RFC 8693 chained token).\n' +
      'Respond with JSON: { "approved": boolean, "blockers": string[], "suggestedScopes": string[] }',
    expected_output:
      'A JSON review with approval status, any blockers, and suggested scope modifications.',
    agent,
  };
}

module.exports = {
  buildDecisionTask,
  buildCoordinatorTask,
  buildAuthorizationTask,
};
