'use strict';
/**
 * summarizationQueue.js — Background task queue for conversation summarization.
 *
 * Phase 2: LLM-based summaries with auto-triggers.
 * - Simple in-process queue (FIFO)
 * - Worker calls LLM proxy to generate summaries
 * - Stores results to LMDB via conversationStore
 * - Non-blocking: failures are logged, original messages preserved
 */

const conversationStore = require('./lmdb/conversationStore.lmdb');

const DEFAULT_LLM_PROXY_URL = process.env.LLM_PROXY_URL || 'http://localhost:8090';
const MAX_CONCURRENT_WORKERS = 3;
const TIMEOUT_MS = 30000; // 30s max for summary LLM call

const queue = [];
let activeWorkers = 0;

/**
 * Enqueue a summarization task.
 * @param {string} userId - user identifier
 * @param {string} vertical - vertical/context
 * @param {array} messages - messages to summarize
 * @param {number} startIdx - start index in thread
 * @param {number} endIdx - end index in thread
 * @param {string} provider - LLM provider ('anthropic' or 'lmstudio')
 */
function enqueue(userId, vertical, messages, startIdx, endIdx, provider = 'anthropic') {
  queue.push({ userId, vertical, messages, startIdx, endIdx, provider });
  process.nextTick(_processQueue);
}

/**
 * Process the next task in the queue.
 * @private
 */
async function _processQueue() {
  if (activeWorkers >= MAX_CONCURRENT_WORKERS || queue.length === 0) {
    return;
  }

  activeWorkers++;
  const task = queue.shift();

  try {
    await _processSummarization(task);
  } catch (err) {
    console.error('[summarizationQueue] Task failed:', err.message, { userId: task.userId, vertical: task.vertical });
  } finally {
    activeWorkers--;
    if (queue.length > 0) {
      process.nextTick(_processQueue);
    }
  }
}

/**
 * Execute a single summarization task.
 * @private
 */
async function _processSummarization(task) {
  const { userId, vertical, messages, startIdx, endIdx, provider } = task;

  // Build the prompt for the LLM
  const conversationText = messages
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join('\n\n');

  const systemPrompt =
    'You are a conversation summarization expert. Summarize the following banking ' +
    'conversation for context recovery. Extract key entities (account numbers, amounts, actions). ' +
    'Keep the summary concise (1-2 sentences) and focus on user intent and agent actions.';

  const userPrompt = `Summarize this conversation:\n\n${conversationText}`;

  // Call LLM proxy
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

    const response = await fetch(`${DEFAULT_LLM_PROXY_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: provider === 'anthropic' ? 'claude-sonnet-4-6' : 'local-model',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 300,
        temperature: 0,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`LLM proxy returned ${response.status}`);
    }

    const data = await response.json();
    const summaryText =
      data.choices?.[0]?.message?.content || 'Failed to generate summary';

    // Save summary to LMDB
    conversationStore.saveSummary(userId, vertical, messages, startIdx, endIdx, summaryText);
    console.log('[summarizationQueue] Summary saved', { userId, vertical, startIdx, endIdx, length: summaryText.length });
  } catch (err) {
    console.error('[summarizationQueue] LLM call failed:', err.message, { provider });
    // Fallback to extraction-based summary (Phase 1 fallback)
    conversationStore.saveSummary(userId, vertical, messages, startIdx, endIdx);
  }
}

/**
 * Get queue stats (for monitoring).
 */
function getStats() {
  return {
    queueLength: queue.length,
    activeWorkers,
    maxConcurrent: MAX_CONCURRENT_WORKERS,
  };
}

module.exports = {
  enqueue,
  getStats,
};
