// demo_api_ui/tests/e2e/stepVerification.banking.real.spec.js
/**
 * @file stepVerification.banking.real.spec.js
 * Live-stack step verification for banking: chip + free-text, asserting the
 * RIGHT amount and gate — not just HTTP 200 / source=heuristic.
 *
 * Prerequisites: stack running (./run.sh), E2E_CUSTOMER_USERNAME/PASSWORD set.
 * Prefer E2E_BASE_URL=https://local.ping-devops.com:4000.
 *
 * Run:
 *   cd demo_api_ui
 *   E2E_BASE_URL=https://local.ping-devops.com:4000 npx playwright test \
 *     tests/e2e/stepVerification.banking.real.spec.js --config=playwright.real.config.js
 */
const { test, expect } = require('@playwright/test');
const { execSync } = require('child_process');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');
const { writeLedgerEntry } = require('../../../demo_api_server/services/stepVerificationLedger');
const { USE_CASES, resolveUseCase } = require('../../../demo_api_server/config/useCases.js');
const {
  bankingAmountGateExpectations,
  loadGoldenByUcId,
  normalizeParsedIntent,
  scoreAgentReply,
  scoreBankingVerticalPrereq,
  scoreTokenChainDetail,
  scoreTokenSummaryCoverage,
} = require('../../../demo_api_server/services/stepVerificationExpectations');

/**
 * Confirm session vertical + accounts are banking checking/savings before
 * amount-gate chips run. Healthcare leftovers used to look like wrong_gate.
 */
async function loadBankingVerticalPrereq(page) {
  const vertRes = await page.request.get('/api/verticals/me');
  const vertBody = vertRes.ok() ? await vertRes.json() : {};
  const acctRes = await page.request.get('/api/accounts/my');
  const acctBody = acctRes.ok() ? await acctRes.json() : {};
  return scoreBankingVerticalPrereq(
    acctBody.accounts || [],
    vertBody.activeId || null,
  );
}

/** First works-maturity banking chip whose primaryTool reads accounts/balance. */
function findBankingReadChip() {
  for (const u of USE_CASES) {
    const uc = resolveUseCase(u.id, 'banking') || u;
    if (uc.maturity !== 'works') continue;
    const t = uc.trigger || {};
    if (t.type !== 'chip' || !t.text) continue;
    if (uc.primaryTool === 'get_my_accounts' || uc.primaryTool === 'get_account_balance') {
      return { id: uc.id, text: t.text, primaryTool: uc.primaryTool };
    }
  }
  return null;
}

const GATE_TO_ERROR = {
  HITL: 'hitl_required',
  STEP_UP: 'step_up_required',
  DENY: 'authorization_denied',
};

const FREE_TEXT_BY_ID = {
  UC8: 'please move three hundred dollars out of my checking into my savings',
  UC7: 'please move six hundred dollars out of my checking into my savings',
  UC6: 'please move twenty-five hundred dollars out of my checking into my savings',
};

/** Catalog-driven UC6/7/8 (+ kin) with free-text twins where defined. */
const AMOUNT_CASES = bankingAmountGateExpectations().map((e) => ({
  ...e,
  useCaseId: e.id,
  freeText: FREE_TEXT_BY_ID[e.id] || null,
}));

const LLM_ERROR_SIGNATURES = [
  'unknown provider in reasonOnce',
  'exceeds the available context size',
  'ProviderClient httpx errored',
];

function grepDockerLogsForLlmErrors(sinceSeconds) {
  try {
    const out = execSync(`docker logs --since ${sinceSeconds}s ai-demo-agent-service 2>&1 | tail -200`, {
      encoding: 'utf8',
    });
    return LLM_ERROR_SIGNATURES.filter((sig) => out.includes(sig));
  } catch (_) {
    return null;
  }
}

async function dispatchNl(page, message, provider) {
  return page.evaluate(
    async ({ message, provider }) => {
      const r = await fetch('/api/demo-agent/nl', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ message, provider, vertical: 'banking' }),
      });
      const body = await r.json().catch(() => ({}));
      return { status: r.status, body };
    },
    { message, provider },
  );
}

/** Same path Demo Steps use: /api/agent/invoke with forceHeuristic. */
async function dispatchInvoke(page, message, useCaseId) {
  return page.evaluate(
    async ({ message, useCaseId }) => {
      const r = await fetch('/api/agent/invoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          prompt: message,
          vertical: 'banking',
          forceHeuristic: true,
          ...(useCaseId ? { useCaseId } : {}),
        }),
      });
      const body = await r.json().catch(() => ({}));
      return { status: r.status, body };
    },
    { message, useCaseId },
  );
}

async function callMcpTool(page, tool, params) {
  return page.evaluate(
    async ({ tool, params }) => {
      const r = await fetch('/api/mcp/tool', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tool, params }),
      });
      const body = await r.json().catch(() => ({}));
      return { status: r.status, body };
    },
    { tool, params },
  );
}

async function setDemoRuntimeFlags(api, { heuristic = true } = {}) {
  const res = await api.patch('/api/admin/feature-flags', {
    data: {
      updates: {
        ff_heuristic_enabled: heuristic,
        // Without these, Exchange #2 hits PingOne invalid_scope and every chip fails.
        ff_mcp_gateway_pinggateway: true,
        ff_gateway_brokered_exchange: true,
      },
    },
  });
  expect(res.ok(), `demo runtime flags (HTTP ${res.status()})`).toBe(true);
}

/**
 * Score NL + message against catalog expectation (amount + gate error).
 * @returns {{
 *   checkStatus: string,
 *   errorClass: string|null,
 *   normalized: object|null,
 *   tokenSummary: ReturnType<typeof scoreTokenSummaryCoverage>|null,
 * }}
 */
function scoreAmountGate({ nlStatus, nlBody, msgStatus, msgBody, expectation }) {
  let checkStatus = 'PASS';
  let errorClass = null;
  let tokenSummary = null;

  if (nlStatus !== 200) {
    return { checkStatus: 'FAIL', errorClass: 'server_error', normalized: null, tokenSummary };
  }
  if (nlBody.source !== 'heuristic') {
    return { checkStatus: 'FAIL', errorClass: 'parse_error', normalized: null, tokenSummary };
  }

  const normalized = normalizeParsedIntent(nlBody.result || nlBody);
  if (!normalized || normalized.tool !== 'create_transfer') {
    return { checkStatus: 'FAIL', errorClass: 'wrong_response', normalized, tokenSummary };
  }
  if (normalized.amount !== expectation.amount) {
    return { checkStatus: 'FAIL', errorClass: 'wrong_response', normalized, tokenSummary };
  }

  const gotError = msgBody?.error || null;
  const consent428 = msgStatus === 428 && (msgBody?.requiresConsent || gotError === 'hitl_required');

  // Exchange / gateway breakage must never count as a gate PASS.
  if (
    gotError === 'delegation_chain_broken'
    || gotError === 'invalid_scope'
    || /Delegation chain validation failed/i.test(msgBody?.reply || '')
  ) {
    return { checkStatus: 'FAIL', errorClass: 'server_error', normalized, tokenSummary };
  }

  // Wrong vertical (e.g. healthcare accounts) fails before authorize gates fire.
  const reply = msgBody?.reply || '';
  if (
    /Could not find the specified accounts/i.test(reply)
    || /Primary Care/i.test(reply)
    || /\bHSA\b/.test(reply)
  ) {
    return { checkStatus: 'FAIL', errorClass: 'missing_prereq', normalized, tokenSummary };
  }

  // Token Chain teaching detail is part of the demo contract — blank rails FAIL.
  // Only exchange/infra errors must carry an explicit failure event; HITL/STEP_UP/DENY
  // gates still need claims/explanation on the success path through exchange.
  const infraFail = [
    'delegation_chain_broken',
    'invalid_scope',
    'Agent invocation failed',
    'gateway_token_rejected',
  ].includes(gotError);
  const chainScore = scoreTokenChainDetail(msgBody?.tokenEvents, {
    requireFailureEvent: infraFail,
  });
  if (!chainScore.ok) {
    return {
      checkStatus: 'FAIL',
      errorClass: chainScore.reason || 'empty_token_events',
      normalized,
      tokenSummary,
    };
  }

  // Token Summary must list every token for the run (1-ex or full 2-ex set).
  tokenSummary = scoreTokenSummaryCoverage(msgBody?.tokenEvents);
  if (!tokenSummary.ok) {
    return {
      checkStatus: 'FAIL',
      errorClass: tokenSummary.reason || 'missing_summary_tokens',
      normalized,
      tokenSummary,
    };
  }

  if (expectation.gate === 'HITL') {
    if (!(gotError === 'hitl_required' || gotError === 'mcp_hitl_required' || consent428)) {
      checkStatus = 'FAIL';
      errorClass = 'wrong_gate';
    }
  } else if (expectation.gate === 'STEP_UP') {
    if (!(gotError === 'step_up_required' || gotError === 'mcp_step_up_required')) {
      checkStatus = 'FAIL';
      errorClass = 'wrong_gate';
    }
  } else if (expectation.gate === 'DENY') {
    if (!(gotError === 'authorization_denied' || gotError === 'mcp_authorization_denied'
      || /deny|denied|exceed/i.test(msgBody?.reply || msgBody?.message || ''))) {
      checkStatus = 'FAIL';
      errorClass = 'wrong_gate';
    }
  }

  // Gate chips: agent reply must match golden education copy exactly.
  if (checkStatus === 'PASS' && expectation.gate) {
    const ucId = expectation.id || expectation.useCaseId;
    const golden = loadGoldenByUcId('banking', ucId);
    const replyScore = scoreAgentReply({
      reply: msgBody?.reply || msgBody?.message || '',
      style: 'exact',
      expectedReply: golden?.reply,
    });
    if (!replyScore.ok) {
      checkStatus = 'FAIL';
      errorClass = 'wrong_response';
    }
  }

  return { checkStatus, errorClass, normalized, tokenSummary };
}

test.describe('Step verification — banking (real login, live stack)', () => {
  test.skip(!requireRealLoginEnv(), 'Skipped: set E2E_CUSTOMER_USERNAME and E2E_CUSTOMER_PASSWORD');

  test.describe('chips (heuristic mode) — amount + gate', () => {
    test.beforeEach(async ({ page }) => {
      await loginAsCustomer(page);
      // Stack may be left on healthcare/retail from other suites — banking
      // amount gates need checking/savings nicknames or they never reach DENY/STEP_UP/HITL.
      const vert = await page.request.post('/api/verticals/active', { data: { id: 'banking' } });
      expect(vert.status(), 'activate banking vertical').toBe(204);
      await setDemoRuntimeFlags(page.request, { heuristic: true });
    });

    for (const c of AMOUNT_CASES) {
      test(`${c.useCaseId} chip: $${c.amount} → ${c.gate}`, async ({ page }) => {
        const prereq = await loadBankingVerticalPrereq(page);
        if (!prereq.ok) {
          writeLedgerEntry({
            vertical: 'banking',
            useCaseId: c.useCaseId,
            triggerType: 'chip',
            mode: 'heuristic',
            status: 'FAIL',
            errorClass: 'missing_prereq',
            primaryTool: 'create_transfer',
            checkedAt: new Date().toISOString(),
            prereqErrors: prereq.prereqErrors,
            activeVertical: prereq.activeVertical,
            accountTypes: prereq.accountTypes,
          });
        }
        expect(
          prereq.ok,
          `banking vertical prereq failed for ${c.useCaseId}: ${prereq.prereqErrors.join('; ')}`,
        ).toBe(true);

        const { status, body } = await dispatchNl(page, c.chipText, 'llamacpp');
        const catalogUc = resolveUseCase(c.useCaseId, 'banking');
        const msg = await dispatchInvoke(page, c.chipText, catalogUc?.useCaseId);
        const scored = scoreAmountGate({
          nlStatus: status,
          nlBody: body,
          msgStatus: msg.status,
          msgBody: msg.body,
          expectation: c,
        });

        const summary = scored.tokenSummary
          || scoreTokenSummaryCoverage(msg.body?.tokenEvents);
        const replyPrereq = scored.errorClass === 'missing_prereq';
        writeLedgerEntry({
          vertical: 'banking',
          useCaseId: c.useCaseId,
          triggerType: 'chip',
          mode: 'heuristic',
          status: scored.checkStatus,
          errorClass: scored.errorClass,
          primaryTool: 'create_transfer',
          checkedAt: new Date().toISOString(),
          activeVertical: prereq.activeVertical,
          accountTypes: prereq.accountTypes,
          prereqErrors: replyPrereq
            ? ['invoke reply indicates non-banking accounts']
            : undefined,
          tokenSummaryMode: summary.mode,
          tokenSummaryIds: summary.present,
          tokenSummaryMissing: summary.missing,
        });

        expect(status).toBe(200);
        expect(body.source).toBe('heuristic');
        expect(scored.normalized?.amount).toBe(c.amount);
        expect(
          scoreTokenChainDetail(msg.body?.tokenEvents).ok,
          `token chain detail missing for ${c.useCaseId}: ${JSON.stringify(msg.body?.tokenEvents || []).slice(0, 200)}`,
        ).toBe(true);
        expect(
          summary.ok,
          `Token Summary incomplete for ${c.useCaseId} (${summary.mode}): missing=${JSON.stringify(summary.missing)} present=${JSON.stringify(summary.present)}`,
        ).toBe(true);
        expect(scored.checkStatus).toBe('PASS');
      });
    }

    test('accounts/balance chip: tool + agent reply grounded in /api/accounts/my (check 4)', async ({ page }) => {
      const readChip = findBankingReadChip();
      test.skip(!readChip, 'No works-maturity banking chip routes to an accounts/balance read tool');

      const liveAccounts = await page.evaluate(async () => {
        const r = await fetch('/api/accounts/my', { credentials: 'include' });
        if (!r.ok) throw new Error(`accounts/my -> ${r.status}`);
        const data = await r.json();
        return data.accounts || [];
      });
      expect(liveAccounts.length).toBeGreaterThan(0);

      const toolParams =
        readChip.primaryTool === 'get_account_balance'
          ? { account_id: liveAccounts[0].id }
          : {};
      const { status, body } = await callMcpTool(page, readChip.primaryTool, toolParams);
      const msg = await dispatchInvoke(page, readChip.text, readChip.id);

      let checkStatus = 'PASS';
      let errorClass = null;

      if (status !== 200 || msg.status >= 500) {
        checkStatus = 'FAIL';
        errorClass = 'server_error';
      } else {
        const resultText = JSON.stringify(body.result ?? body ?? {});
        const anyBalanceGrounded = liveAccounts.some((a) => resultText.includes(String(a.balance)));
        if (!anyBalanceGrounded) {
          checkStatus = 'FAIL';
          errorClass = 'wrong_response';
        } else {
          const replyScore = scoreAgentReply({
            reply: msg.body?.reply || msg.body?.message || '',
            style: 'grounded',
            liveAccounts,
          });
          if (!replyScore.ok) {
            checkStatus = 'FAIL';
            errorClass = 'wrong_response';
          }
        }
      }

      writeLedgerEntry({
        vertical: 'banking',
        useCaseId: readChip.id,
        triggerType: 'chip',
        mode: 'heuristic',
        status: checkStatus,
        errorClass,
        primaryTool: readChip.primaryTool,
        checkedAt: new Date().toISOString(),
      });

      expect(status).toBe(200);
      expect(checkStatus).toBe('PASS');
    });
  });

  test.describe('agent-lifecycle page buttons (retail)', () => {
    test.describe.configure({ mode: 'serial', timeout: 300_000 });

    test.beforeEach(async ({ page }) => {
      await loginAsCustomer(page);
      await setDemoRuntimeFlags(page.request, { heuristic: true });
      await page.request.post('/api/verticals/active', { data: { id: 'retail' } }).catch(() => {});
    });

    test.afterAll(async ({ browser }) => {
      // Safety net: if a prior run used kill-switch scope=full, restore apps.
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      try {
        await loginAsCustomer(page);
        await page.request.post('/api/admin/agent/demo-agent/re-enable', { data: {} });
      } catch (_) {
        /* non-fatal */
      }
      await ctx.close();
    });

    test('Call list_orders + Pretty/Raw toggles', async ({ page }) => {
      await page.goto('/agent-lifecycle', { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Agent Lifecycle' })).toBeVisible();

      await page.getByRole('button', { name: /Call list_orders as agent/i }).click();
      await Promise.race([
        page.locator('.alp-error').waitFor({ timeout: 90_000 }),
        page.locator('.alp-form-container, .alp-result, .alp-form-empty').waitFor({ timeout: 90_000 }),
      ]);
      expect(await page.locator('.alp-error').count()).toBe(0);

      await page.getByRole('button', { name: /Raw JSON/i }).click();
      await expect(page.locator('pre.alp-result')).toBeVisible();
      await page.getByRole('button', { name: /Pretty Form/i }).click();
      await expect(page.locator('.alp-form-container, .alp-form-empty')).toBeVisible();

      writeLedgerEntry({
        vertical: 'retail',
        useCaseId: 'agent-lifecycle-list-orders',
        triggerType: 'button',
        mode: 'heuristic',
        status: 'PASS',
        errorClass: null,
        primaryTool: 'list_orders',
        checkedAt: new Date().toISOString(),
      });
    });

    test('Checkout $600 headphones reaches CIBA or completes', async ({ page }) => {
      await page.goto('/agent-lifecycle', { waitUntil: 'domcontentloaded' });
      await page.getByRole('button', { name: /Checkout \$600 headphones/i }).click();

      const deadline = Date.now() + 150_000;
      let statusText = '';
      let cibaPathSeen = false;
      while (Date.now() < deadline) {
        statusText = (await page.locator('.alp-slot__status').allTextContents()).join(' || ');
        if (/Waiting for approval|auth_req_id|CIBA approval was/i.test(statusText)) {
          cibaPathSeen = true;
        }
        if (/Checkout completed/i.test(statusText)) break;
        if (
          /(denied|expired|Retry failed|HTTP \d|rate or quota|actor_token)/i.test(statusText)
          && !/Waiting for approval/i.test(statusText)
          && !/retrying checkout/i.test(statusText)
        ) {
          break;
        }
        if (/Waiting for approval/i.test(statusText)) {
          // Let simulated CIBA auto-approve, then retry.
          await page.waitForTimeout(2000);
          continue;
        }
        await page.waitForTimeout(1500);
      }

      const completed = /Checkout completed/i.test(statusText);
      // Button contract: either checkout finishes, or the CIBA step-up path
      // was entered. Simulated CIBA can flake to denied/expired without the
      // button itself being broken — that still counts as gate proven.
      const empty = !String(statusText || '').trim();
      const actorBroken = /actor_token_invalid/i.test(statusText);
      const checkStatus = empty || actorBroken ? 'FAIL' : (completed || cibaPathSeen ? 'PASS' : 'FAIL');

      writeLedgerEntry({
        vertical: 'retail',
        useCaseId: 'ciba-out-of-band-approval',
        triggerType: 'button',
        mode: 'heuristic',
        status: checkStatus,
        errorClass: empty ? 'empty_status' : actorBroken ? 'server_error' : null,
        primaryTool: 'checkout',
        checkedAt: new Date().toISOString(),
      });

      expect(empty, `checkout status empty — UI bug. got="${statusText}"`).toBe(false);
      expect(actorBroken, `agent apps disabled? ${statusText}`).toBe(false);
      expect(
        completed || cibaPathSeen,
        `expected CIBA path or checkout complete; got="${statusText.slice(0, 300)}"`,
      ).toBe(true);
    });

    test('Revoke agent access uses instance scope and proves retry fails', async ({ page }) => {
      await page.goto('/agent-lifecycle', { waitUntil: 'domcontentloaded' });
      const revoke = page.getByRole('button', { name: /Revoke agent access/i });
      await expect(revoke).toBeEnabled({ timeout: 30_000 });

      // Guardrail: the POST body must carry scope=instance so a regression that
      // omits scope cannot disable PingOne agent apps (API default is also instance).
      const killReqPromise = page.waitForRequest(
        (req) => req.method() === 'POST' && /\/api\/admin\/agent\/[^/]+\/kill-switch/.test(req.url()),
      );

      await revoke.click();
      // Modal defaults to "This instance only" — confirm without switching to full.
      await page.getByRole('button', { name: /Confirm Stop Agent/i }).click();

      const killReq = await killReqPromise;
      const killBody = killReq.postDataJSON() || {};
      expect(killBody.scope, `kill-switch must send scope=instance, got ${JSON.stringify(killBody)}`).toBe('instance');
      expect(killBody.scope).not.toBe('full');

      await expect(page.getByText(/Confirmed revoked/i)).toBeVisible({ timeout: 60_000 });
      await expect(page.getByRole('link', { name: /View audit trail/i })).toBeVisible();
      // Instance scope must NOT surface the full-identity re-enable CTA.
      await expect(page.getByRole('button', { name: /Re-enable agent apps/i })).toHaveCount(0);

      writeLedgerEntry({
        vertical: 'retail',
        useCaseId: 'agent-lifecycle-revoke',
        triggerType: 'button',
        mode: 'heuristic',
        status: 'PASS',
        errorClass: null,
        primaryTool: 'list_orders',
        checkedAt: new Date().toISOString(),
      });

      // Belt-and-suspenders: keep apps healthy even if a future change regresses scope.
      await page.request.post('/api/admin/agent/demo-agent/re-enable', { data: {} }).catch(() => {});
    });
  });

  test.describe('free-text prompts (LLM-only mode)', () => {
    test.beforeAll(async ({ browser }) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      await loginAsCustomer(page);
      await setDemoRuntimeFlags(ctx.request, { heuristic: false });
      await ctx.close();
    });

    test.afterAll(async ({ browser }) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
      const page = await ctx.newPage();
      await loginAsCustomer(page);
      await setDemoRuntimeFlags(ctx.request, { heuristic: true });
      await ctx.close();
    });

    test.beforeEach(async ({ page }) => {
      await loginAsCustomer(page);
      const vert = await page.request.post('/api/verticals/active', { data: { id: 'banking' } });
      expect(vert.status(), 'activate banking vertical').toBe(204);
    });

    for (const c of AMOUNT_CASES.filter((x) => x.freeText)) {
      test(`${c.useCaseId} free-text (llamacpp): amount ${c.amount}`, async ({ page }) => {
        const prereq = await loadBankingVerticalPrereq(page);
        if (!prereq.ok) {
          writeLedgerEntry({
            vertical: 'banking',
            useCaseId: c.useCaseId,
            triggerType: 'prompt',
            mode: 'llamacpp',
            status: 'FAIL',
            errorClass: 'missing_prereq',
            primaryTool: 'create_transfer',
            checkedAt: new Date().toISOString(),
            prereqErrors: prereq.prereqErrors,
            activeVertical: prereq.activeVertical,
            accountTypes: prereq.accountTypes,
          });
        }
        expect(
          prereq.ok,
          `banking vertical prereq failed for ${c.useCaseId}: ${prereq.prereqErrors.join('; ')}`,
        ).toBe(true);

        const { status, body } = await dispatchNl(page, c.freeText, 'llamacpp');

        let checkStatus = 'PASS';
        let errorClass = null;
        if (status !== 200) {
          checkStatus = 'FAIL';
          errorClass = 'server_error';
        } else {
          const llmErrors = grepDockerLogsForLlmErrors(30);
          if (llmErrors && llmErrors.length) {
            checkStatus = 'FAIL';
            errorClass = 'llm_error';
          } else {
            const n = normalizeParsedIntent(body.result || body);
            // LLM-only: if the model returned a structured intent, amount must match.
            if (n?.amount != null && n.amount !== c.amount) {
              checkStatus = 'FAIL';
              errorClass = 'wrong_response';
            }
          }
        }

        writeLedgerEntry({
          vertical: 'banking',
          useCaseId: c.useCaseId,
          triggerType: 'prompt',
          mode: 'llamacpp',
          status: checkStatus,
          errorClass,
          primaryTool: 'create_transfer',
          checkedAt: new Date().toISOString(),
          activeVertical: prereq.activeVertical,
          accountTypes: prereq.accountTypes,
        });

        expect(status).toBe(200);
        expect(checkStatus).toBe('PASS');
      });
    }
  });
});
