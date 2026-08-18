// Do the hops actually RENDER, on a live run, in the layout the demo uses?
//
//   cd demo_api_ui && npm run test:e2e:real -- chain-hops-visible
//
// Second half of chain-hops-reachable.real.spec.js. That one proves the gateway
// PRODUCES the evidence; this proves a person watching the screen can SEE it.
// Neither implies the other:
//
//   #1951  evidence produced, rendered into TraceStepCard — a component the
//          dashboard's split3 focus mode never mounts. Correct data, blank UI.
//   #1966  evidence produced, but the Exchange hop read "in flight" forever
//          because the step model keyed on a field live runs leave null.
//
// FocusModeChainRenders.test.jsx asserts the same DOM but feeds the store a
// FIXTURE — which is exactly what let #1966's first fix pass its test and change
// nothing on screen: the test SET outcome:"ok" while real runs leave it null.
// Here the store is filled by a real round trip, so the values are whatever the
// stack actually produces.
//
// WHAT THIS CAN AND CANNOT ASSERT — read before adding to it.
// Typed chat on /dashboard goes to POST /api/agent/run (AG-UI) and the model
// decides whether to call a tool. It frequently does not: a live run of "show my
// invoices" produced 9 chain nodes, a tools/list challenge, an LLM node reading
// `tokens used prompt 0`, and NO tools/call and NO gateway hop. So the
// tools/call and gateway hops cannot be asserted from this surface without
// making the test flaky — their absence here means the run did not exercise
// them, not that they failed to render.
//
// The deterministic alternative would be the chip path (forceHeuristic), but
// /dashboard currently renders zero .ba-action-chip elements, so there is
// nothing to click. Until a deterministic UI trigger exists, this asserts the
// discovery leg — which IS deterministic, because the SPA runs discovery on
// load — and REPORTS the rest. The API-level counterpart covers the tool-call
// leg with forceHeuristic, where determinism is available.
//
// Selectors verified against TokenChainNodeRail.jsx (.tcnr-node) and
// StepDetailPanel.jsx (.sdp-stage). StepDetailPanel is the SHARED sheet both
// rails render; TraceStepCard and the .tctr-* tree are not mounted here at all.
'use strict';
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');

const PROMPT = 'show my invoices';

/** Close any OTP / consent modal — .dm-backdrop silently eats clicks on the input. */
async function dismissDialogs(page) {
  for (let i = 0; i < 3; i++) {
    const backdrop = page.locator('.dm-backdrop');
    if (!(await backdrop.first().isVisible().catch(() => false))) return;
    const otpCancel = page.locator('.otp-step-up-modal__btn-cancel');
    if (await otpCancel.first().isVisible().catch(() => false)) {
      await otpCancel.first().click().catch(() => {});
    } else {
      await page.keyboard.press('Escape').catch(() => {});
    }
    await page.waitForTimeout(700);
  }
}

/** Every chain node's text, for assertions and for failure messages. */
const nodeTexts = (page) =>
  page.$$eval('.tcnr-node', (ns) => ns.map((n) => n.textContent.trim().replace(/\s+/g, ' ')));

test.describe('token-chain hops are visible on screen after a live run', () => {
  test.describe.configure({ timeout: 240_000 });

  test('a real run renders its hops in focus mode', async ({ page }) => {
    test.skip(!requireRealLoginEnv(), 'Skipped: E2E_CUSTOMER_USERNAME/PASSWORD not set');
    await loginAsCustomer(page);
    await page.goto('/dashboard');

    const panel = page.locator('.banking-agent-panel');
    await expect(panel, 'agent panel on /dashboard').toBeVisible({ timeout: 30_000 });
    await dismissDialogs(page);

    // Record the agent traffic. Without it, a run that never called a tool is
    // indistinguishable from a chain that failed to render.
    const calls = [];
    page.on('response', (r) => {
      const u = r.url();
      if (/\/api\/(demo-agent\/nl|mcp\/tool|agent\/(invoke|run))/.test(u)) {
        const line = `${r.status()} ${u.replace(/^https?:\/\/[^/]+/, '')}`;
        calls.push(line);
        // Logged as they land: expect.poll's `message` is NOT evaluated when it
        // is a function, so a failure prints the source of the diagnostic
        // instead of its value. Learned the slow way.
        console.log(`[ui] call ${line}`);
      }
    });

    const input = panel.locator('input.ba-input');
    await expect(input, 'chat input visible').toBeVisible();
    await input.click();
    await input.fill(PROMPT);
    await input.press('Enter');

    // `Browser` and `Prompt` nodes are seeded the moment you type, so waiting
    // for "any node" returns instantly against an empty run. Wait for the reply
    // hop, which only a completed round trip produces.
    const deadline = Date.now() + 120_000;
    let texts = [];
    while (Date.now() < deadline) {
      texts = await nodeTexts(page);
      if (texts.some((t) => /Reply|Gateway/i.test(t))) break;
      await page.waitForTimeout(2_000);
    }

    // Hand-rolled loop rather than expect.poll so the node list is dumped on the
    // FAILING path too. "Four wrong guesses before dumping the DOM" is the
    // recorded cost of not doing this.
    console.log(`[ui] agent calls: ${calls.join(', ') || 'none'}`);
    console.log(`[ui] ${texts.length} chain nodes:`);
    for (const t of texts) console.log(`[ui]   ${t}`);

    expect(
      calls.some((c) => /agent\/(run|invoke)|mcp\/tool/.test(c)),
      'the message reached the agent — with no agent call, nothing downstream ' +
        'could render and the rest of this test would be meaningless',
    ).toBe(true);

    // The question this work started from: "we call once for the tool list, get
    // 401, then call again after authn — I don't see 2 calls." The challenge and
    // the authorized retry must appear as SEPARATE nodes, not collapse into one.
    const joined = texts.join(' | ');
    expect(joined, 'the tools/list 401 challenge renders as its own hop').toMatch(/tools\/list 401/);
    expect(joined, 'the authorized tools/list renders as a separate hop')
      .toMatch(/tools\/list(?!\s*401)/);

    // Reported, not asserted — see the header. These need a tool call, and typed
    // chat does not reliably produce one.
    for (const [re, what] of [
      [/tools\/call 401/, 'tools/call 401 challenge'],
      [/Gateway/i, 'gateway hop'],
    ]) {
      console.log(`[ui] ${re.test(joined) ? 'present' : 'ABSENT '} ${what}`);
    }

    // Observed on every run of this path: the chain ends with Reply rendered
    // while Exchange still reads "in flight" — a hop that never resolves on a
    // finished run. Not asserted because it is not yet decided what it SHOULD
    // say when no tool call happened and no exchange was ever needed. Tracked in
    // TECH_DEBT (2026-08-18). Surfaced here so it cannot quietly become normal.
    const stuck = texts.filter((t) => /Exchange/i.test(t) && /in flight/i.test(t));
    if (stuck.length && /Reply/i.test(joined)) {
      console.log(`[ui] UNRESOLVED after reply: ${stuck.join(' | ')}`);
    }

    // #1951: when a gateway hop IS present, its filter stages must reach the
    // SHARED detail sheet. Skipped rather than failed when the run produced no
    // gateway hop, for the reason in the header.
    const gateway = page.locator('.tcnr-node', { hasText: /Gateway/i }).first();
    if (await gateway.isVisible().catch(() => false)) {
      await gateway.click();
      const stageNames = await page.$$eval('.sdp-stage', (ls) =>
        ls.map((l) => l.textContent.trim().replace(/\s+/g, ' ')));
      console.log(`[ui] ${stageNames.length} gateway stages:`);
      for (const s of stageNames) console.log(`[ui]   ${s}`);
      expect(stageNames.length, 'gateway filter stages reached StepDetailPanel')
        .toBeGreaterThan(0);
    } else {
      console.log('[ui] no gateway hop in this run — filter-stage rendering not exercised');
    }
  });
});
