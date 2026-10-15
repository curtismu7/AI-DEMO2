'use strict';

/**
 * Shrink the reason-loop request for the local llama.cpp tier.
 *
 * That tier is CPU-bound (~21 prompt tokens/s measured) with a few thousand tokens of context, so every prompt
 * token costs real seconds. Hosted lanes keep the full tool list and history; llama.cpp gets the few tools the
 * question points at and a short history tail.
 */

const LLAMACPP_MAX_TOOLS = 5;
const LLAMACPP_HISTORY_BUDGET = 600;

const wordsOf = (text) => new Set(String(text || '').toLowerCase().match(/[a-z]{3,}/g) || []);

// Score a tool by how many of the question's words appear in its name or description.
function selectTools(tools, message, max = LLAMACPP_MAX_TOOLS) {
  if (!Array.isArray(tools) || tools.length <= max) return tools;
  const asked = wordsOf(message);
  const scored = tools.map((tool, index) => {
    const name = tool?.name || tool?.function?.name || '';
    const description = tool?.description || tool?.function?.description || '';
    const toolWords = wordsOf(`${name.replace(/_/g, ' ')} ${description}`);
    let score = 0;
    asked.forEach((word) => { if (toolWords.has(word)) score += 1; });
    return { tool, index, score };
  });
  // Best matches first; ties (and the no-match case) keep the original order.
  return scored.sort((a, b) => b.score - a.score || a.index - b.index).slice(0, max).map((s) => s.tool);
}

module.exports = { selectTools, LLAMACPP_MAX_TOOLS, LLAMACPP_HISTORY_BUDGET };
