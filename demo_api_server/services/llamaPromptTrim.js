'use strict';

// History tail replayed to the CPU-bound llama.cpp tier (~20 prompt tokens/s): short, so the cacheable
// system prompt + tools prefix dominates and only the question's own tokens are processed cold.
const LLAMACPP_HISTORY_BUDGET = 600;

module.exports = { LLAMACPP_HISTORY_BUDGET };
