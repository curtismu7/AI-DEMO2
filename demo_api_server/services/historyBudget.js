'use strict';

/**
 * Keep the replayed conversation history inside a token budget.
 *
 * processAgentMessage replays the user's saved thread (up to 30 messages, saved tool results included) into
 * every reason-loop request. Measured on the live site, one Dot question became a 17,453-token request.
 * That fails outright on a model with a small context window and burns the per-minute token cap on a hosted lane.
 * The newest messages are the ones that matter, so the oldest go first. The current question is never touched.
 *
 * Token counts are an estimate (4 characters a token); the budget is a ceiling, not a promise.
 */

const DEFAULT_BUDGET_TOKENS = 2500;
// A single saved message may take at most this share of the budget before it is cut.
const MAX_SINGLE_SHARE = 0.4;
const CUT_MARKER = ' …[earlier output shortened]';

const textOf = (message) => (typeof message?.content === 'string' ? message.content : JSON.stringify(message?.content ?? ''));
const tokensOf = (message) => Math.ceil(textOf(message).length / 4);

function budgetFromEnv(env = process.env) {
  const raw = Number(env.LLM_HISTORY_TOKEN_BUDGET);
  return Number.isFinite(raw) && raw >= 0 ? raw : DEFAULT_BUDGET_TOKENS;
}

/**
 * @param {Array<{role: string, content: any}>} history  saved messages, oldest first
 * @param {number} [budgetTokens]
 * @returns {Array} the newest messages that fit, oldest first (history itself is not modified)
 */
function trimHistoryToBudget(history, budgetTokens = budgetFromEnv()) {
  if (!Array.isArray(history) || history.length === 0 || budgetTokens <= 0) return budgetTokens <= 0 ? [] : (history || []);
  const perMessageCap = Math.max(1, Math.floor(budgetTokens * MAX_SINGLE_SHARE));
  const kept = [];
  let used = 0;
  for (let i = history.length - 1; i >= 0; i -= 1) {
    let message = history[i];
    if (tokensOf(message) > perMessageCap && typeof message?.content === 'string') {
      message = { ...message, content: message.content.slice(0, perMessageCap * 4) + CUT_MARKER };
    }
    const cost = tokensOf(message);
    if (used + cost > budgetTokens) break;
    kept.push(message);
    used += cost;
  }
  return kept.reverse();
}

module.exports = { trimHistoryToBudget, budgetFromEnv, DEFAULT_BUDGET_TOKENS };
