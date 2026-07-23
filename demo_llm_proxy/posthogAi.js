// demo_llm_proxy/posthogAi.js
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/** Soft-load POSTHOG_* from nearby .env files when not already in process.env. */
function softLoadPosthogEnv() {
  if (process.env.POSTHOG_API_KEY) return;
  const candidates = [
    path.join(__dirname, '..', 'demo_api_server', '.env'),
    path.join(__dirname, '..', '.env'),
  ];
  for (const file of candidates) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      const m = line.match(/^(POSTHOG_API_KEY|POSTHOG_HOST)\s*=\s*(.*)$/);
      if (!m) continue;
      if (process.env[m[1]]) continue;
      process.env[m[1]] = m[2].trim().replace(/^['"]|['"]$/g, '');
    }
    if (process.env.POSTHOG_API_KEY) return;
  }
}

softLoadPosthogEnv();

const API_KEY = process.env.POSTHOG_API_KEY || '';
const HOST = (process.env.POSTHOG_HOST || 'https://us.i.posthog.com').replace(/\/+$/, '');

let client = null;
let missingWarned = false;

/** Return a PostHog Node client, or null when unconfigured. */
function getClient() {
  if (!API_KEY) {
    if (!missingWarned && process.env.NODE_ENV !== 'production') {
      missingWarned = true;
      console.warn(
        '[llm-proxy] POSTHOG_API_KEY variable required by PostHog is missing or un-configured, this causes events to be silently missed. This error stops appearing once POSTHOG_API_KEY is configured',
      );
    }
    return null;
  }
  if (client) return client;
  try {
    const { PostHog } = require('posthog-node');
    client = new PostHog(API_KEY, {
      host: HOST,
      enableExceptionAutocapture: true,
    });
    const shutdown = async () => {
      try {
        await client.shutdown();
      } catch {
        /* ignore */
      }
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    return client;
  } catch (err) {
    console.warn(`[llm-proxy] posthog-node unavailable: ${err.message}`);
    return null;
  }
}

/**
 * Parse OpenAI-compatible JSON or SSE body for model + token usage.
 * @param {Buffer|string} body
 * @returns {{ model: string|null, inputTokens: number|null, outputTokens: number|null, stream: boolean }}
 */
function parseUsageFromBody(body) {
  const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
  const out = { model: null, inputTokens: null, outputTokens: null, stream: false };
  if (!text) return out;

  // Non-stream JSON
  if (text.trimStart().startsWith('{')) {
    try {
      const json = JSON.parse(text);
      out.model = typeof json.model === 'string' ? json.model : null;
      const u = json.usage || {};
      if (Number.isFinite(u.prompt_tokens)) out.inputTokens = u.prompt_tokens;
      if (Number.isFinite(u.completion_tokens)) out.outputTokens = u.completion_tokens;
      return out;
    } catch {
      /* fall through to SSE */
    }
  }

  // SSE: data: {...}\n\n — prefer last chunk with usage
  out.stream = text.includes('data:');
  let lastUsage = null;
  let lastModel = null;
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data:')) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === '[DONE]') continue;
    try {
      const json = JSON.parse(payload);
      if (typeof json.model === 'string') lastModel = json.model;
      if (json.usage) lastUsage = json.usage;
    } catch {
      /* ignore bad chunk */
    }
  }
  out.model = lastModel;
  if (lastUsage) {
    if (Number.isFinite(lastUsage.prompt_tokens)) out.inputTokens = lastUsage.prompt_tokens;
    if (Number.isFinite(lastUsage.completion_tokens)) out.outputTokens = lastUsage.completion_tokens;
  }
  return out;
}

/**
 * Extract model name from the buffered request body (metadata only).
 * @param {Buffer|string|null} bodyBuffer
 * @returns {string|null}
 */
function modelFromRequest(bodyBuffer) {
  if (!bodyBuffer || !bodyBuffer.length) return null;
  try {
    const parsed = JSON.parse(bodyBuffer.toString('utf8'));
    return typeof parsed.model === 'string' ? parsed.model : null;
  } catch {
    return null;
  }
}

/**
 * Capture one $ai_generation for an LLM proxy hop (metadata only — no prompts).
 * @param {object} opts
 */
function captureGeneration(opts) {
  const ph = getClient();
  if (!ph) return;

  const {
    distinctId = 'llm-proxy',
    traceId = crypto.randomUUID(),
    requestModel = null,
    responseBody = Buffer.alloc(0),
    latencySec = null,
    httpStatus = null,
    tierName = null,
    streamHint = false,
    timeToFirstTokenSec = null,
  } = opts || {};

  const usage = parseUsageFromBody(responseBody);
  const model = usage.model || requestModel || tierName || 'unknown';
  const properties = {
    $ai_trace_id: traceId,
    $ai_model: model,
    $ai_provider: 'local-llm-proxy',
    $ai_stream: Boolean(usage.stream || streamHint),
  };
  if (Number.isFinite(usage.inputTokens)) properties.$ai_input_tokens = usage.inputTokens;
  if (Number.isFinite(usage.outputTokens)) properties.$ai_output_tokens = usage.outputTokens;
  if (Number.isFinite(latencySec)) properties.$ai_latency = latencySec;
  if (Number.isFinite(timeToFirstTokenSec)) properties.$ai_time_to_first_token = timeToFirstTokenSec;
  if (Number.isFinite(httpStatus)) properties.$ai_http_status = httpStatus;
  if (tierName) properties.$ai_proxy_tier = tierName;

  try {
    ph.capture({
      distinctId: String(distinctId),
      event: '$ai_generation',
      properties,
    });
  } catch (err) {
    console.warn(`[llm-proxy] posthog capture failed: ${err.message}`);
  }
}

module.exports = {
  getClient,
  parseUsageFromBody,
  modelFromRequest,
  captureGeneration,
  softLoadPosthogEnv,
};
