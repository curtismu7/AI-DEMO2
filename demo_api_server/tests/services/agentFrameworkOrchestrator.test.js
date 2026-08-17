'use strict';

jest.mock('../../services/llamacppLlmService', () => ({ callLlamaCpp: jest.fn() }));

const { callLlamaCpp } = require('../../services/llamacppLlmService');
const { selectFramework, FRAMEWORKS } = require('../../services/agentFrameworkOrchestrator');

function jsonReply(obj) {
  return JSON.stringify(obj);
}

describe('agentFrameworkOrchestrator.selectFramework', () => {
  beforeEach(() => {
    callLlamaCpp.mockReset();
  });

  test('LLM success: returns the framework the LLM picked', async () => {
    callLlamaCpp.mockResolvedValueOnce(
      jsonReply({ framework: 'mastra', reasoning: 'demo variety' }),
    );

    const result = await selectFramework({ message: 'what is my balance', vertical: 'super_sports' });

    expect(result).toBe('mastra');
  });

  test('LLM returns an invalid framework name: falls back to a value from FRAMEWORKS', async () => {
    callLlamaCpp.mockResolvedValueOnce(jsonReply({ framework: 'not_a_real_framework', reasoning: 'oops' }));

    const result = await selectFramework({ message: 'transfer $50', vertical: 'super_sports' });

    expect(FRAMEWORKS).toContain(result);
  });

  test('LLM call throws: falls back to a value from FRAMEWORKS', async () => {
    callLlamaCpp.mockRejectedValueOnce(new Error('proxy unreachable'));

    const result = await selectFramework({ message: 'transfer $50', vertical: 'super_sports' });

    expect(FRAMEWORKS).toContain(result);
  });

  test('fallback round-robins across all four frameworks over repeated failures', async () => {
    callLlamaCpp.mockRejectedValue(new Error('proxy unreachable'));

    const results = [];
    for (let i = 0; i < FRAMEWORKS.length; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      results.push(await selectFramework({ message: 'hi', vertical: 'super_sports' }));
    }

    expect(new Set(results).size).toBe(FRAMEWORKS.length);
  });
});
