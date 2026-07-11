// demo_api_ui/tests/e2e/evidence-screenshots.real.spec.js
'use strict';
/**
 * Evidence screenshots — UI-driven proof that each agent mode returns
 * correct responses (LLM test plan, Part A probes).
 *
 * For each mode in E2E_EVIDENCE_MODES (default "heuristics,llamacpp"):
 *   1. Selects the mode in the in-panel AgentModeSelector. A disabled option
 *      (provider down) FAILS the test — per the fail-loud contract that is a
 *      finding, not a skip.
 *   2. Runs three probes through the real chat input, verifying the SAME
 *      interaction being screenshotted: the /api/demo-agent/nl response
 *      (routing source + resolved action + provider actually sent) and, for
 *      tool probes, the /api/mcp/tool response (RFC 8693 exchange in
 *      tokenEvents, pipeline status 200|403|428).
 *   3. Writes evidence only AFTER assertions pass, so an evidence file
 *      existing implies a verified-correct response:
 *        <dir>/<mode>/picker.png                (mode committed in the UI)
 *        <dir>/<mode>/<probe>-response.png      (full page: prompt + answer)
 *        <dir>/<mode>/<probe>-tokens.png        (chat pane incl. RFC events)
 *
 * Run (stack up per README, real-login env set — auto-skips otherwise):
 *   E2E_EVIDENCE_MODES=heuristics,llamacpp,claude,helix_google \
 *     npm run test:e2e:evidence
 *
 * Env:
 *   E2E_EVIDENCE_MODES  comma-separated mode ids (see MODES below)
 *   E2E_EVIDENCE_DIR    output root (default evidence/<date>)
 */
const path = require('path');
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');
const { activateVertical } = require('./helpers/chipPipeline');

// Keep in sync with src/config/agentModes.js (ESM — not require()able from
// this CJS spec). Mode id -> provider string the UI sends on /nl requests
// (AIAgent sends `activeLlmProvider || "heuristic"`).
const MODE_PROVIDER = {
  heuristics: 'heuristic',
  llamacpp: 'llamacpp',
  claude: 'anthropic',
  helix_google: 'helix',
};

const MODES = (process.env.E2E_EVIDENCE_MODES || 'heuristics,llamacpp')
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

const EVIDENCE_ROOT =
  process.env.E2E_EVIDENCE_DIR ||
  path.resolve(__dirname, '../../evidence', new Date().toISOString().slice(0, 10));

// The full banking chip matrix (test plan Part B) — one probe per chips10
// entry in config/verticals/banking/manifest.json, exercised as typed
// messages through the real chat input.
//
// kinds:
//  - tool: must resolve to expectedAction, call expectedTool through the MCP
//    pipeline with status 200, and render a non-error reply — in EVERY mode.
//  - hitl: same, but the pipeline must return 428 and surface the consent
//    step (the 🔐 interruption IS the expected result; we screenshot it and
//    dismiss).
//  - reasoning: LLM-analysis intents (no deterministic tool). Heuristics mode
//    must reply with the graceful needs-an-LLM message; LLM modes must render
//    a non-error reasoning reply.
const PROBES = [
  {
    id: 'bk1-accounts',
    message: 'show my accounts',
    expectedAction: 'accounts',
    expectedTool: 'get_my_accounts',
    kind: 'tool',
  },
  {
    id: 'bk2-balance',
    // The bare manifest phrase "what is my balance" triggers the agent's
    // which-account clarification (a reply, not a tool call); name the
    // account so the probe deterministically reaches the MCP pipeline.
    message: 'what is my checking balance',
    expectedAction: 'balance',
    expectedTool: 'get_account_balance',
    kind: 'tool',
  },
  {
    id: 'bk3-transactions',
    message: 'recent transactions',
    expectedAction: 'transactions',
    expectedTool: 'get_my_transactions',
    kind: 'tool',
  },
  {
    id: 'bk4-transfer',
    message: 'transfer $100 from checking to savings',
    expectedAction: 'transfer',
    expectedTool: 'create_transfer',
    kind: 'tool',
  },
  {
    id: 'bk-hitl-transfer500',
    message: 'transfer $500 from checking to savings',
    expectedAction: 'transfer',
    expectedTool: 'create_transfer',
    kind: 'hitl',
  },
  {
    id: 'bk5-deposit',
    message: 'deposit $50 into savings',
    expectedAction: 'deposit',
    expectedTool: 'create_deposit',
    kind: 'tool',
  },
  {
    id: 'bk6-withdraw',
    message: 'withdraw $40 from checking',
    expectedAction: 'withdraw',
    expectedTool: 'create_withdrawal',
    kind: 'tool',
  },
  {
    id: 'bk7-mortgage',
    message: 'show my mortgage',
    expectedAction: 'mortgage_demo',
    expectedTool: 'show_mortgage',
    // mortgage_demo's UX is a page NAVIGATION to /path/mortgage after the
    // tool call (like dual_token_demo) — there is no chat reply to await.
    kind: 'navigate',
    expectedPath: '/path/mortgage',
  },
  {
    id: 'bk8-categories',
    message: 'What are my biggest categories',
    expectedAction: 'spending_summary',
    kind: 'tool-clientside', // analyzed client-side over get_my_transactions
  },
  {
    id: 'bk9-unusual',
    message: 'Check for unusual patterns',
    kind: 'reasoning',
  },
  {
    id: 'bk10-afford',
    message: 'Could my savings cover a big upcoming expense?',
    kind: 'reasoning',
  },
  {
    id: 'bk-direct-accounts',
    message: 'get my accounts',
    expectedAction: 'accounts',
    expectedTool: 'get_my_accounts',
    kind: 'tool',
  },
];

// Rendered-reply failure signatures: if the chat delta or an error toast
// matches, the "answer" was an error card, not a result — FAIL even when the
// network hops looked plausible.
const REPLY_ERROR_RE =
  /unknown action|policy denied|denied by gateway|forbidden by gateway|could not parse|mcp_error|error_description/i;
const NEEDS_LLM_RE = /needs an llm mode/i;

const unknown = MODES.filter((m) => !MODE_PROVIDER[m]);
if (unknown.length) {
  throw new Error(
    `E2E_EVIDENCE_MODES contains unknown mode(s): ${unknown.join(', ')} — ` +
      `valid: ${Object.keys(MODE_PROVIDER).join(', ')}`,
  );
}

/** Same panel-or-FAB race as banking-agent.spec.js ensureAgentReady. */
async function ensureAgentReady(page) {
  const panel = page.locator('.banking-agent-panel');
  if (await panel.isVisible().catch(() => false)) return panel;
  const fab = page.locator('.banking-agent-fab');
  await Promise.race([
    panel.waitFor({ state: 'visible', timeout: 25000 }).catch(() => {}),
    fab.first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {}),
  ]);
  if (!(await panel.isVisible().catch(() => false)) && (await fab.count())) {
    await fab.first().click();
  }
  await expect(panel).toBeVisible({ timeout: 20000 });
  return panel;
}

/**
 * Turn on the "Show RFC token-event messages" header switch so the tokens
 * screenshot includes the RFC 8693 events inline in the chat. Best-effort:
 * evidence is still valid without it (tokenEvents are asserted from the
 * network response), so a missing/relocated toggle is not a failure.
 */
async function enableRfcInfo(panel) {
  try {
    const toggle = panel.locator('[title*="RFC token-event"] input[type="checkbox"]');
    if ((await toggle.count()) && !(await toggle.first().isChecked())) {
      await toggle.first().click({ force: true });
    }
  } catch (_) {
    /* non-fatal — see docblock */
  }
}

/**
 * Send one probe through the chat input and assert correctness from the
 * network responses behind that exact interaction, then screenshot.
 */
async function runProbe(page, panel, mode, probe) {
  const dir = path.join(EVIDENCE_ROOT, mode);
  const messages = panel.locator('.banking-agent-messages');
  const beforeLen = ((await messages.innerText().catch(() => '')) || '').length;

  // A prior HITL probe's OTP/step-up modal can open a beat after its
  // dismissal ran — sweep any lingering dialog before touching the input.
  await dismissDialogs(page);

  const input = panel.locator('input.ba-input');
  await expect(input, 'chat input visible').toBeVisible();
  await input.click();
  await input.fill(probe.message);

  const nlPromise = page.waitForResponse(
    (r) => r.url().includes('/api/demo-agent/nl') && r.request().method() === 'POST',
    { timeout: 90_000 },
  );
  // Tool/HITL probes traverse dispatchNlResult -> POST /api/mcp/tool. Register
  // the wait BEFORE pressing Enter so a fast pipeline can't slip past it.
  const mcpPromise =
    probe.kind === 'tool' || probe.kind === 'hitl' || probe.kind === 'navigate'
      ? page.waitForResponse(
          (r) => r.url().includes('/api/mcp/tool') && r.request().method() === 'POST',
          { timeout: 90_000 },
        )
      : null;
  await input.press('Enter');

  // Hop 1: NL routing — status, provider actually sent, resolved action.
  const nlResp = await nlPromise;
  expect(nlResp.status(), `${mode}/${probe.id}: /nl status`).toBe(200);
  const sentProvider = nlResp.request().postDataJSON()?.provider;
  expect(
    sentProvider,
    `${mode}/${probe.id}: request carried the mode's provider (mode really active)`,
  ).toBe(MODE_PROVIDER[mode]);
  const nlBody = await nlResp.json().catch(() => ({}));
  console.log(
    `${mode}/${probe.id}: source=${nlBody?.source} kind=${nlBody?.result?.kind} ` +
      `action=${nlBody?.result?.banking?.action || nlBody?.result?.action || '-'}`,
  );
  if (probe.expectedAction) {
    const action = nlBody?.result?.banking?.action || nlBody?.result?.action;
    expect(action, `${mode}/${probe.id}: resolved action`).toBe(probe.expectedAction);
  }

  // Hop 2 (tool probes): MCP pipeline — expected status + RFC 8693 exchange.
  if (mcpPromise) {
    const mcpResp = await mcpPromise;
    if (probe.expectedTool) {
      const mcpReqBody = JSON.stringify(mcpResp.request().postDataJSON() || {});
      expect(
        mcpReqBody.includes(probe.expectedTool),
        `${mode}/${probe.id}: mcp/tool call targets ${probe.expectedTool} (body: ${mcpReqBody.slice(0, 120)})`,
      ).toBe(true);
    }
    // Strict per-kind status: a customer operating on their OWN data must get
    // 200; only the HITL chip may (must) return the 428 consent challenge.
    // The old 200|403|428 tolerance let a gateway policy DENY masquerade as a
    // pass while the rendered "answer" was an error card.
    const wantStatus = probe.kind === 'hitl' ? 428 : 200;
    const mcpStatus = mcpResp.status();
    expect(
      mcpStatus,
      `${mode}/${probe.id}: mcp/tool pipeline status`,
    ).toBe(wantStatus);
    const mcpBody = await mcpResp.json().catch(() => ({}));
    const tokenEvents = mcpBody.tokenEvents || [];
    // Same exchange heuristic as chipPipeline.assertMcpPipelineCustomerProof.
    const sawExchange = tokenEvents.some(
      (e) =>
        e?.claims?.act ||
        /exchang|mcp.*token|delegat/i.test(`${e?.label || ''} ${e?.explanation || ''}`),
    );
    expect(tokenEvents.length, `${mode}/${probe.id}: token chain updated`).toBeGreaterThan(0);
    expect(sawExchange, `${mode}/${probe.id}: RFC 8693 exchange in tokenEvents`).toBe(true);
  }

  // Navigation probes: the tool's UX is a route change, not a chat reply —
  // proof is landing on the destination page after the verified tool call.
  if (probe.kind === 'navigate') {
    await page.waitForURL(`**${probe.expectedPath}**`, { timeout: 30_000 });
    await page.waitForTimeout(800); // let the destination page render
    await page.screenshot({ path: path.join(dir, `${probe.id}-response.png`), fullPage: true });
    console.log(`${mode}/${probe.id}: navigated to ${probe.expectedPath} — evidence written to ${dir}`);
    await page.goBack();
    await ensureAgentReady(page);
    return;
  }

  // Rendered answer: the chat grew by more than the echoed prompt — i.e. a
  // reply bubble exists. (For HITL the consent step may render as a modal
  // instead of chat text, so accept either.)
  const consentUi = page.locator(
    '[class*="consent"], [class*="otp"], [class*="Consent"], [class*="hitl"]',
  );
  await expect
    .poll(
      async () => {
        const len = ((await messages.innerText().catch(() => '')) || '').length;
        if (len > beforeLen + probe.message.length) return true;
        if (probe.kind === 'hitl') {
          return (await consentUi.first().isVisible().catch(() => false)) || null;
        }
        return null;
      },
      { timeout: 60_000, message: `${mode}/${probe.id}: reply rendered in chat` },
    )
    .toBe(true);
  await page.waitForTimeout(500); // let streaming/entry animations settle

  // The reply must be a RESULT, not an error card — and no error toast. This
  // is what catches "Gateway Policy Denied" / "Unknown action" renders that
  // plausible network hops would otherwise sneak past.
  const afterText = (await messages.innerText().catch(() => '')) || '';
  const delta = afterText.slice(beforeLen);
  const tail = JSON.stringify(delta.slice(-200));
  if (probe.kind === 'reasoning' && mode === 'heuristics') {
    expect(
      NEEDS_LLM_RE.test(delta) || /could not parse/i.test(delta),
      `${mode}/${probe.id}: graceful needs-an-LLM reply in heuristics mode (tail: ${tail})`,
    ).toBe(true);
  } else {
    expect(
      REPLY_ERROR_RE.test(delta),
      `${mode}/${probe.id}: rendered reply is not an error card (tail: ${tail})`,
    ).toBe(false);
  }
  expect(
    await page.locator('.Toastify__toast--error').count(),
    `${mode}/${probe.id}: no error toast`,
  ).toBe(0);

  // Assertions passed — now (and only now) write the evidence.
  await page.screenshot({ path: path.join(dir, `${probe.id}-response.png`), fullPage: true });
  await messages.screenshot({ path: path.join(dir, `${probe.id}-tokens.png`) });
  console.log(`${mode}/${probe.id}: evidence written to ${dir}`);

  // HITL: the consent interruption is captured above — the OTP step-up modal
  // may open with a delay, so wait for it and cancel it explicitly before the
  // next probe (its .dm-backdrop otherwise intercepts every click).
  if (probe.kind === 'hitl') {
    const otpCancel = page.locator('.otp-step-up-modal__btn-cancel');
    await otpCancel.waitFor({ state: 'visible', timeout: 10_000 }).catch(() => {});
    await dismissDialogs(page);
  }
}

/** Close any open modal (OTP step-up / consent) so the chat input is clickable. */
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

test.describe('evidence screenshots — agent modes (real)', () => {
  test.skip(!requireRealLoginEnv(), 'Requires E2E_CUSTOMER_* env vars');
  test.describe.configure({ mode: 'serial', timeout: 240_000 });

  let ctx;
  let page;
  let panel;
  const restoreFlags = {};
  let pickerHydrated = false;

  test.beforeAll(async ({ browser }) => {
    // ignoreHTTPSErrors: local stack serves a mkcert cert Playwright's TLS
    // client doesn't trust (same rationale as all-chips-pipeline.real.spec.js).
    ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    page = await ctx.newPage();
    await loginAsCustomer(page); // leaves page on /dashboard

    // E2E_UI_UNDER_TEST: serve evidence from a different UI build (e.g. a
    // worktree dev server on :3000 with a fix under test) while the OAuth
    // flow still lands on the stack's configured client URL. The BFF only
    // validates the session cookie's value, so transplant it to the
    // UI-under-test origin and continue there. API-level asserts keep using
    // ctx.request against the login origin.
    const uiUnderTest = process.env.E2E_UI_UNDER_TEST || null;
    if (uiUnderTest) {
      const u = new URL(uiUnderTest);
      const cookies = await ctx.cookies();
      await ctx.addCookies(
        cookies.map((c) => ({
          name: c.name,
          value: c.value,
          domain: u.hostname,
          path: '/',
          secure: u.protocol === 'https:',
          httpOnly: c.httpOnly,
          sameSite: 'Lax',
        })),
      );
      await page.goto(`${uiUnderTest.replace(/\/$/, '')}/dashboard`);
      await page.waitForSelector(
        '[class*="dashboard"], .banking-agent-panel, .banking-agent-fab',
        { timeout: 30_000 },
      );
    }

    await activateVertical(ctx.request, 'banking');

    // Pin flags for a deterministic run (save originals, restore in afterAll —
    // same save/flip/restore pattern as all-chips-pipeline's helix_base_url):
    //  - ff_agui_enabled=false: with AG-UI on, typed messages stream via
    //    POST /api/agent/run (SSE) and never hit the /nl + /api/mcp/tool
    //    contract this spec asserts.
    //  - ff_authorize_simulated=true: this deployment has no
    //    PINGONE_AUTHORIZE_MCP_DECISION_ENDPOINT_ID and failover=deny, so
    //    every real-P1AZ MCP tool call fails closed with 503. The simulated
    //    engine is the designed education-mode fallback and still evaluates
    //    a real policy (403 paths stay reachable).
    const PIN_FLAGS = { ff_agui_enabled: false, ff_authorize_simulated: true };
    const flagsResp = await ctx.request.get('/api/admin/feature-flags');
    if (flagsResp.ok()) {
      const flags = (await flagsResp.json())?.flags || [];
      const updates = {};
      for (const [id, want] of Object.entries(PIN_FLAGS)) {
        const f = flags.find((x) => x.id === id);
        const current = f && (f.value === true || f.value === 'true');
        if (f && current !== want) {
          updates[id] = want;
          restoreFlags[id] = current;
        }
      }
      if (Object.keys(updates).length) {
        const patch = await ctx.request.patch('/api/admin/feature-flags', {
          data: { updates },
        });
        expect(patch.ok(), `flags pinned for evidence run: ${JSON.stringify(updates)}`).toBe(true);
        // The panel reads flags on mount — reload so the pinned state is live.
        await page.reload();
      }
    }

    panel = await ensureAgentReady(page);
    await enableRfcInfo(panel);
  });

  test.afterAll(async () => {
    if (Object.keys(restoreFlags).length) {
      await ctx.request
        .patch('/api/admin/feature-flags', { data: { updates: restoreFlags } })
        .catch(() => {});
    }
    await ctx?.close().catch(() => {});
  });

  for (const mode of MODES) {
    test(`${mode}: mode selectable (fail-loud if provider down) — picker evidence`, async () => {
      const modeSelect = panel.locator('select.ams-select').first();
      await expect(modeSelect, 'AgentModeSelector rendered in panel header').toBeVisible();
      const option = modeSelect.locator(`option[value="${mode}"]`);
      expect(await option.count(), `${mode}: option exists in picker`).toBe(1);
      expect(
        await option.isDisabled(),
        `${mode}: provider reachable (disabled option = provider down — fix the provider, do not skip)`,
      ).toBe(false);
      // On first load the select renders the client default and then hydrates
      // from GET /api/langchain/config/status — wait for picker/server
      // agreement ONCE so the first mode change isn't raced by hydration
      // flipping the value back. (Only once: after we commit a change, the
      // select intentionally diverges from the server's env-pinned agent_mode
      // — AGENT_MODE in the container env always wins getEffective() reads,
      // so server state is not a usable signal after the first commit.)
      if (!pickerHydrated) {
        await expect
          .poll(
            async () => {
              const r = await ctx.request.get('/api/langchain/config/status');
              const server = (await r.json().catch(() => ({})))?.agent_mode;
              return server && (await modeSelect.inputValue()) === server;
            },
            { timeout: 15_000, message: `${mode}: picker hydrated from server` },
          )
          .toBe(true);
        pickerHydrated = true;
      }
      // Mode changes commit asynchronously (POST /api/langchain/config). Wait
      // for the commit response before any probe types a message, or the
      // request races out with the old provider. The authoritative per-mode
      // proof is runProbe's assertion that each /nl request carries the
      // mode's provider — /nl resolves body.provider first, so the env-pinned
      // server agent_mode does not affect routing.
      if ((await modeSelect.inputValue()) !== mode) {
        const commit = page.waitForResponse(
          (r) =>
            r.url().includes('/api/langchain/config') &&
            r.request().method() === 'POST',
          { timeout: 15_000 },
        );
        await modeSelect.selectOption(mode);
        await commit;
        await page.waitForTimeout(300); // let the shared hook broadcast fan out
      }
      await expect(modeSelect).toHaveValue(mode);
      await panel.screenshot({ path: path.join(EVIDENCE_ROOT, mode, 'picker.png') });
    });

    for (const probe of PROBES) {
      test(`${mode}: ${probe.id} — "${probe.message}"`, async () => {
        test.setTimeout(240_000); // llamacpp responses can take a minute+

        // The picker rehydrates to the server's env-pinned agent_mode after a
        // panel remount (e.g. the mortgage navigation probe's page round
        // trip) — re-commit the mode rather than hard-failing, then assert.
        // A DEAD mode still fails here: selectOption on a disabled option
        // throws and the committed value never matches.
        const sel = panel.locator('select.ams-select').first();
        // Stabilization loop: a hydration GET that was in flight during the
        // remount can land AFTER our commit and overwrite the shared mode
        // state — keep re-selecting until the value HOLDS through a settle
        // window. A dead mode still fails: its option is disabled, so
        // selectOption throws and the poll never reaches `mode`.
        await expect
          .poll(
            async () => {
              if ((await sel.inputValue()) !== mode) {
                const commit = page
                  .waitForResponse(
                    (r) => r.url().includes('/api/langchain/config') && r.request().method() === 'POST',
                    { timeout: 10_000 },
                  )
                  .catch(() => {});
                await sel.selectOption(mode).catch(() => {});
                await commit;
              }
              await page.waitForTimeout(600); // outlast any late hydration write
              return sel.inputValue();
            },
            { timeout: 30_000, message: `${mode}: picker stable on mode before probe` },
          )
          .toBe(mode);
        await runProbe(page, panel, mode, probe);
      });
    }
  }
});
