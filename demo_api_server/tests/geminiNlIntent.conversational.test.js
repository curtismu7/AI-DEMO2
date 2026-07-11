'use strict';

/**
 * Regression — llama.cpp and MLX conversational answers must be wrapped in the
 * same { kind:'education', message } envelope every other provider uses, not
 * returned as a bare string. llama.cpp is the default backend; a raw string
 * reaches the SPA where an intent object is expected and renders as a blank /
 * broken agent bubble.
 */

jest.mock('../services/llamacppLlmService', () => ({
  callLlamaCpp: jest.fn().mockResolvedValue('The sky is blue because of Rayleigh scattering.'),
}));
jest.mock('../services/mlxLlmService', () => ({
  callMlx: jest.fn().mockResolvedValue('Clouds form when water vapor condenses.'),
}));

const { parseNaturalLanguage } = require('../services/geminiNlIntent');

// An open, non-actionable question so the heuristic returns kind:none and the
// conversational LLM path runs.
const OPEN_Q = 'in one sentence, why is the daytime sky blue?';

describe('geminiNlIntent conversational envelope (llama.cpp / MLX)', () => {
  test('llamacpp answer is an education object, not a raw string', async () => {
    const out = await parseNaturalLanguage(OPEN_Q, { vertical: 'banking' }, 'llamacpp');
    expect(out.result).toBeDefined();
    expect(typeof out.result).toBe('object');
    expect(out.result.kind).toBe('education');
    expect(typeof out.result.message).toBe('string');
    expect(out.result.message).toContain('Rayleigh');
  });

  test('mlx answer is an education object, not a raw string', async () => {
    const out = await parseNaturalLanguage(OPEN_Q, { vertical: 'healthcare' }, 'mlx');
    expect(typeof out.result).toBe('object');
    expect(out.result.kind).toBe('education');
    expect(out.result.message).toContain('condenses');
  });
});
