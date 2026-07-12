/**
 * Per-provider circuit breaker for NL-intent LLM calls (demo hardening
 * Phase 2). After BREAKER_THRESHOLD consecutive failures the provider is
 * skipped for BREAKER_COOLDOWN_MS — requests fall straight to the existing
 * deterministic ladder (heuristic floor / conversational fallback), exactly
 * like a provider error. SILENT by design: never touches agent mode, the
 * mode picker, or configStore; visible only in [llmContract] telemetry.
 * Half-open: after the cooldown one probe flows; failure re-opens
 * immediately, success closes fully.
 */
'use strict';

const { logMendEvent } = require('./llmResponseContract');

const BREAKER_THRESHOLD = 3;
const BREAKER_COOLDOWN_MS = 60000;

/** provider -> { failures, openUntil } */
const state = new Map();

function isOpen(provider) {
  const s = state.get(provider);
  return !!s && Date.now() < s.openUntil;
}

function recordFailure(provider) {
  const s = state.get(provider) || { failures: 0, openUntil: 0 };
  s.failures += 1;
  if (s.failures >= BREAKER_THRESHOLD) {
    s.openUntil = Date.now() + BREAKER_COOLDOWN_MS;
    logMendEvent('breaker_open', { provider, failures: s.failures, cooldownMs: BREAKER_COOLDOWN_MS });
  }
  state.set(provider, s);
}

function recordSuccess(provider) {
  state.delete(provider);
}

/** Tests only. */
function _resetAll() {
  state.clear();
}

module.exports = { isOpen, recordFailure, recordSuccess, _resetAll, BREAKER_THRESHOLD, BREAKER_COOLDOWN_MS };
