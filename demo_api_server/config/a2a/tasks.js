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

function buildCoordinatorTask(agent, vertical, tools, message) {
  return {
    description:
      `The "${vertical}" vertical's specialist agent can perform these tools: ${JSON.stringify(tools)}\n\n` +
      `User message: "${message}"\n\n` +
      'Recommend which ONE tool from the list best matches the request.\n' +
      'Respond with JSON: { "tool": string, "reasoning": string }',
    expected_output:
      'A JSON recommendation naming exactly one tool from the provided list, with reasoning.',
    agent,
  };
}

module.exports = {
  buildDecisionTask,
  buildCoordinatorTask,
};
