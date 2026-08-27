'use strict';

/**
 * axiosDefaults — give every axios call a timeout, so one with none fails in
 * seconds instead of hanging until the OS TCP timeout (minutes).
 *
 * Why a default rather than 78 edits: measured 2026-08-27, 78 of 236 axios call
 * sites in services/, routes/ and middleware/ supply no `timeout:` — 50 of them
 * in the three PingOne-calling files (pingoneManagementService 19,
 * agentBuilderService 18, oauthService 13). Those sit on paths a user is waiting
 * on.
 *
 * axios applies `defaults.timeout` ONLY where a request supplies none, so every
 * deliberate value keeps working untouched (the existing range runs 2.5s to
 * 180s, and the long ones are all explicit). One line covers the 78, covers any
 * call added later, and cannot typo its way through a dozen files.
 *
 * The trade is that a call site no longer shows its own timeout. That is worth
 * it here: the alternative is 78 hand edits across PingOne-facing services, and
 * a missed one stays a hang.
 *
 * 45s is deliberately generous — this converts "hangs forever" into "fails
 * eventually", and is not a latency budget. Anything needing a tighter bound
 * should say so at the call site, as ~150 calls already do.
 */
const axios = require('axios');

const DEFAULT_TIMEOUT_MS = 45_000;

/**
 * Idempotent: safe if bootstrap runs more than once.
 *
 * Tolerates a client with no `defaults`. Suites that `jest.mock('axios')` get a
 * stub without it, and several of those require server.js — assigning through
 * undefined there threw at bootstrap and took the whole suite down with an
 * error that looks nothing like a timeout change. A mocked axios issues no real
 * requests, so having no default is the right outcome, not a degraded one.
 *
 * @param {object} [client] axios-like; injectable so the mocked shape is testable.
 * @returns {number|null} the applied timeout, or null when there was nothing to apply.
 */
function applyAxiosDefaults(client = axios) {
  if (!client || !client.defaults) return null;
  client.defaults.timeout = DEFAULT_TIMEOUT_MS;
  return client.defaults.timeout;
}

module.exports = { DEFAULT_TIMEOUT_MS, applyAxiosDefaults };
