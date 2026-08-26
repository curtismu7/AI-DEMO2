/**
 * @file uiProbe.js
 * @description The settle contract for ad-hoc Playwright probes against the live stack.
 *
 * WHY THIS EXISTS (TECH_DEBT 2026-08-18). Two false findings came out of one
 * session, and both were the same mistake — a probe whose negative result is
 * indistinguishable from a broken feature:
 *
 *   1. A route was reported as rendering blank (0 characters, 0 buttons). It was
 *      not blank; the probe sampled before React settled. With a longer wait the
 *      same route rendered 1381 characters and 16 buttons.
 *   2. A signed-call verification produced no tool call, and the absence of
 *      gateway traffic was nearly read as "the fix did not work". The probe had
 *      submitted a retail phrase into a session that had resolved to the banking
 *      vertical, so nothing matched.
 *
 * The contract this file enforces is: **a probe proves it reached a usable page,
 * on the vertical it thinks it is on, BEFORE it is allowed to report what it did
 * or did not find.** Everything here throws rather than returning a falsy value,
 * because a falsy return is exactly what gets written up as a finding.
 *
 * NEVER use `networkidle` on this app. It does not fire — the app holds an SSE
 * connection open for the whole session, so `waitForLoadState('networkidle')`
 * burns its timeout and then either throws or (worse) is caught and ignored.
 * That is why every ad-hoc script has invented its own wait, and why they
 * disagree with each other.
 *
 * Sign-in is NOT here: `realLogin.js` already owns it (the BFF redirect, since
 * the top-nav Sign In button is 0x0 headless). Use both together.
 *
 *   const { loginAsCustomer } = require('./realLogin');
 *   const { settle, requireVertical } = require('./uiProbe');
 *
 *   await loginAsCustomer(page);
 *   await page.goto(`${base}/dashboard`);
 *   const seen = await settle(page);            // throws if it never renders
 *   await requireVertical(page, 'sporting-goods');  // throws if resolved elsewhere
 *   // only now is an assertion about the page meaningful
 */

'use strict';

const DEFAULTS = {
  // A rendered page in this app is never this small. The floor is deliberately
  // low: it is here to catch "nothing rendered", not to assert page content.
  minChars: 200,
  // A usable surface always has at least one control. 0 buttons on a settled
  // page is the signature of the shell mounting without its children.
  minButtons: 1,
  // Total budget before we declare the probe unsettled.
  timeoutMs: 20_000,
  // The page must hold steady this long. React renders in bursts; sampling once
  // over a threshold catches a mid-burst frame that then changes again.
  quietMs: 750,
  pollMs: 250,
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Thrown when the page never reached a usable state. NOT a finding about the app. */
class ProbeNotSettled extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'ProbeNotSettled';
    this.detail = detail;
  }
}

/** Thrown when the session resolved to a different vertical than the probe assumed. */
class WrongVertical extends Error {
  constructor(message, detail) {
    super(message);
    this.name = 'WrongVertical';
    this.detail = detail;
  }
}

/** One sample of what is actually on screen. */
async function measure(page) {
  return page.evaluate(() => ({
    chars: ((document.body && document.body.innerText) || '').trim().length,
    buttons: document.querySelectorAll('button, [role="button"], a[href]').length,
    path: window.location.pathname,
  }));
}

/**
 * Wait until the page has really rendered and then stopped changing.
 *
 * Resolves with the final measurement. Throws ProbeNotSettled if the thresholds
 * were never met inside the budget — so `const seen = await settle(page)` can
 * never hand back a zero that reads like a finding.
 *
 * @returns {Promise<{chars:number, buttons:number, path:string}>}
 */
async function settle(page, options = {}) {
  const opt = { ...DEFAULTS, ...options };
  const deadline = Date.now() + opt.timeoutMs;
  let last = null;
  let stableSince = null;

  while (Date.now() < deadline) {
    const now = await measure(page);
    const bigEnough = now.chars >= opt.minChars && now.buttons >= opt.minButtons;

    if (bigEnough && last && now.chars === last.chars && now.buttons === last.buttons) {
      // Unchanged since the previous sample — start (or continue) the quiet clock.
      if (stableSince === null) stableSince = Date.now();
      if (Date.now() - stableSince >= opt.quietMs) return now;
    } else {
      // Either still below the floor, or it moved. Either way, not quiet yet.
      stableSince = null;
    }

    last = now;
    await sleep(opt.pollMs);
  }

  const detail = last || { chars: 0, buttons: 0, path: 'unknown' };
  throw new ProbeNotSettled(
    `Probe did not settle within ${opt.timeoutMs}ms on ${detail.path} ` +
      `(last seen: ${detail.chars} chars, ${detail.buttons} controls; ` +
      `needed >=${opt.minChars} chars and >=${opt.minButtons} controls, stable for ${opt.quietMs}ms).\n` +
      'This is NOT a finding about the page — the probe never got a usable sample. ' +
      'Raise timeoutMs, or check that the stack is up and the session is signed in, then re-run.',
    detail,
  );
}

/**
 * The vertical the SESSION resolved to — not the one the probe assumed.
 * Read through the page so the browser context's cookies are used.
 *
 * @returns {Promise<string|null>}
 */
async function activeVertical(page) {
  return page.evaluate(async () => {
    const res = await fetch('/api/verticals/active', { credentials: 'include' });
    if (!res.ok) return null;
    const body = await res.json().catch(() => ({}));
    return body && body.id ? body.id : null;
  });
}

/**
 * Assert the session is on the vertical this probe was written for.
 *
 * This is the guard for false finding #2: submitting a retail phrase into a
 * banking session matches nothing, and the resulting absence of tool traffic
 * looks exactly like a broken feature. Throwing here names the real cause.
 */
async function requireVertical(page, expected) {
  const actual = await activeVertical(page);
  if (actual === expected) return actual;
  throw new WrongVertical(
    `Session resolved to vertical "${actual === null ? 'none' : actual}", but this probe ` +
      `assumes "${expected}". Any phrase it submits will match nothing, and the absence of ` +
      'tool traffic would look like a broken feature rather than a mis-targeted probe.\n' +
      `Switch first: POST /api/verticals/active {"id":"${expected}"}.`,
    { expected, actual },
  );
}

module.exports = {
  settle,
  activeVertical,
  requireVertical,
  measure,
  ProbeNotSettled,
  WrongVertical,
  DEFAULTS,
};
