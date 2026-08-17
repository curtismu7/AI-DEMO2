'use strict';

/**
 * Picks which of the four agent frameworks handles a `POST /api/agent/run`
 * request when `llm_framework` is set to `'auto'`. The four frameworks
 * (langchain, openai_agents, mastra, pydantic_ai) implement the same
 * `POST /run` contract and are functionally equivalent (see
 * docs/SERVER_CAPABILITIES.md) — there is no real per-request signal to
 * route on, so this exists to demonstrate all four in rotation rather than
 * to make a meaningful capability decision. LLM-backed with a round-robin
 * fallback on any failure, mirroring a2aOrchestratorService's LLM/heuristic
 * split.
 */

const { callLlamaCpp } = require('./llamacppLlmService');
const { repairAndParseJson } = require('./llmResponseContract');

const FRAMEWORKS = ['langchain', 'openai_agents', 'mastra', 'pydantic_ai'];

const FRAMEWORK_SCHEMA = {
  type: 'object',
  required: ['framework', 'reasoning'],
  properties: {
    framework: { type: 'string', enum: FRAMEWORKS },
    reasoning: { type: 'string' },
  },
};

let heuristicCursor = 0;

/** Round-robin fallback used when the LLM call fails or returns an invalid reply. */
function heuristicSelectFramework() {
  const framework = FRAMEWORKS[heuristicCursor % FRAMEWORKS.length];
  heuristicCursor += 1;
  return framework;
}

async function selectFramework({ message, vertical }) {
  try {
    const raw = await callLlamaCpp(
      [
        {
          role: 'system',
          content:
            'You route requests across four functionally equivalent AI agent frameworks ' +
            '(langchain, openai_agents, mastra, pydantic_ai) that all implement the same ' +
            'POST /run contract. Pick one for this request and vary your picks across ' +
            'requests to demonstrate all four frameworks in this demo.',
        },
        { role: 'user', content: `Vertical: ${vertical || 'unknown'}\nMessage: ${message}` },
      ],
      { jsonSchema: FRAMEWORK_SCHEMA },
    );
    const parsed = repairAndParseJson(raw);
    if (!parsed || !FRAMEWORKS.includes(parsed.framework)) {
      throw new Error(`agentFrameworkOrchestrator: invalid LLM reply ${JSON.stringify(parsed)}`);
    }
    return parsed.framework;
  } catch (err) {
    return heuristicSelectFramework();
  }
}

module.exports = { selectFramework, FRAMEWORKS };
