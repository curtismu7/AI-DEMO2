'use strict';

/**
 * Resolves which agent framework handles a `POST /api/agent/run` request when
 * `llm_framework` is set to `'auto'`. Only langchain remains — it implements
 * the same `POST /run` contract that the previously supported frameworks
 * (openai_agents, mastra, pydantic_ai) used to share before they were removed.
 */

const FRAMEWORKS = ['langchain'];

async function selectFramework() {
  return FRAMEWORKS[0];
}

module.exports = { selectFramework, FRAMEWORKS };
