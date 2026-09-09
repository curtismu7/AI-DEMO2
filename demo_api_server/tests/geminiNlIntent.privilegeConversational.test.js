'use strict';

/**
 * An open question under a Privilege provider must be answered THROUGH the
 * Privilege lane, not dropped to the heuristic floor. Before this the
 * conversational branch listed every provider except the two Privilege ids,
 * so ff_privilege_llm_first would have routed intents through Privilege and
 * open questions around it.
 *
 * setup.js resets the module registry after each test, so the mocked lane and
 * the parser are required together inside each test. Each test asks a
 * different question because parseNaturalLanguage caches answers by message.
 */

jest.mock('../services/privilegeLlmProxyService', () => ({
  callPrivilegeGemini: jest.fn().mockResolvedValue('The sky is blue because of Rayleigh scattering.'),
  callPrivilegeClaude: jest.fn().mockResolvedValue('Clouds form when water vapor condenses.'),
}));

function load() {
  const lane = require('../services/privilegeLlmProxyService');
  const { parseNaturalLanguage } = require('../services/geminiNlIntent');
  return { ...lane, parseNaturalLanguage };
}

describe('geminiNlIntent conversational answers via Privilege', () => {
  test('privilege_llm answers the open question through the Gemini lane', async () => {
    const { parseNaturalLanguage, callPrivilegeGemini } = load();
    const out = await parseNaturalLanguage('in one sentence, why is the daytime sky blue?', { vertical: 'banking' }, 'privilege_llm');
    expect(out.source).toBe('privilege_llm_fallback');
    expect(out.result.kind).toBe('education');
    expect(out.result.message).toContain('Rayleigh');
    expect(callPrivilegeGemini).toHaveBeenCalled();
  });

  test('privilege_claude answers the open question through the Claude lane', async () => {
    const { parseNaturalLanguage, callPrivilegeClaude } = load();
    const out = await parseNaturalLanguage('in one sentence, how do clouds form?', { vertical: 'banking' }, 'privilege_claude');
    expect(out.source).toBe('privilege_claude_fallback');
    expect(out.result.kind).toBe('education');
    expect(out.result.message).toContain('condenses');
    expect(callPrivilegeClaude).toHaveBeenCalled();
  });

  test('a policy denial on the open question surfaces instead of hiding behind heuristics', async () => {
    const { parseNaturalLanguage, callPrivilegeGemini } = load();
    callPrivilegeGemini.mockRejectedValue(Object.assign(new Error('blocked'), { code: 'llm_policy_denied' }));
    await expect(parseNaturalLanguage('in one sentence, why is the ocean salty?', { vertical: 'banking' }, 'privilege_llm'))
      .rejects.toMatchObject({ code: 'llm_policy_denied' });
  });
});
