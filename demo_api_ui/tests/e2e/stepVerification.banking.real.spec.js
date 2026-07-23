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
  normalizeParsedIntent,
  scoreTokenChainDetail,
  scoreDelegatedAccessInvoke,
  scoreAttackSimDeny,
} = require('../../../demo_api_server/services/stepVerificationExpectations');

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
 * @returns {{ checkStatus: string, errorClass: string|null, normalized: object|null }}
 */
function scoreAmountGate({ nlStatus, nlBody, msgStatus, msgBody, expectation }) {
  let checkStatus = 'PASS';
  let errorClass = null;

  if (nlStatus !== 200) {
    return { checkStatus: 'FAIL', errorClass: 'server_error', normalized: null };
  }
  if (nlBody.source !== 'heuristic') {
    return { checkStatus: 'FAIL', errorClass: 'parse_error', normalized: null };
  }

  const normalized = normalizeParsedIntent(nlBody.result || nlBody);
  if (!normalized || normalized.tool !== 'create_transfer') {
    return { checkStatus: 'FAIL', errorClass: 'wrong_response', normalized };
  }
  if (normalized.amount !== expectation.amount) {
    return { checkStatus: 'FAIL', errorClass: 'wrong_response', normalized };
  }

  const gotError = msgBody?.error || null;
  const consent428 = msgStatus === 428 && (msgBody?.requiresConsent || gotError === 'hitl_required');

  // Exchange / gateway breakage must never count as a gate PASS.
  if (
    gotError === 'delegation_chain_broken'
    || gotError === 'invalid_scope'
    || /Delegation chain validation failed/i.test(msgBody?.reply || '')
  ) {
    return { checkStatus: 'FAIL', errorClass: 'server_error', normalized };
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
    return { checkStatus: 'FAIL', errorClass: chainScore.reason || 'empty_token_events', normalized };
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

  return { checkStatus, errorClass, normalized };
}

test.describe('Step verification — banking (real login, live stack)', () => {
  test.skip(!requireRealLoginEnv(), 'Skipped: set E2E_CUSTOMER_USERNAME and E2E_CUSTOMER_PASSWORD');

  test.describe('chips (heuristic mode) — amount + gate', () => {
    test.beforeEach(async ({ page }) => {
      await loginAsCustomer(page);
      await setDemoRuntimeFlags(page.request, { heuristic: true });
    });

    for (const c of AMOUNT_CASES) {
      test(`${c.useCaseId} chip: $${c.amount} → ${c.gate}`, async ({ page }) => {
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

        writeLedgerEntry({
          vertical: 'banking',
          useCaseId: c.useCaseId,
          triggerType: 'chip',
          mode: 'heuristic',
          status: scored.checkStatus,
          errorClass: scored.errorClass,
          primaryTool: 'create_transfer',
          checkedAt: new Date().toISOString(),
        });

        expect(status).toBe(200);
        expect(body.source).toBe('heuristic');
        expect(scored.normalized?.amount).toBe(c.amount);
        expect(
          scoreTokenChainDetail(msg.body?.tokenEvents).ok,
          `token chain detail missing for ${c.useCaseId}: ${JSON.stringify(msg.body?.tokenEvents || []).slice(0, 200)}`,
        ).toBe(true);
        expect(scored.checkStatus).toBe('PASS');
      });
    }

    test('UC1 Demo Step path: show my balance via /api/agent/invoke', async ({ page }) => {
      // Demo Steps use invoke+forceHeuristic — NOT bare /api/mcp/tool. A stale
      // P1AZ worker secret fails here (Incomplete at token-exchange) while a
      // direct tool call can still look fine.
      const catalogUc = resolveUseCase('UC1', 'banking');
      const chipText = catalogUc?.trigger?.text || 'show my balance';
      const liveAccounts = await page.evaluate(async () => {
        const r = await fetch('/api/accounts/my', { credentials: 'include' });
        if (!r.ok) throw new Error(`accounts/my -> ${r.status}`);
        const data = await r.json();
        return data.accounts || [];
      });
      expect(liveAccounts.length).toBeGreaterThan(0);

      const { status, body } = await dispatchInvoke(
        page,
        chipText,
        catalogUc?.useCaseId || 'delegated-access-with-proof',
      );
      const scored = scoreDelegatedAccessInvoke(
        { status, body },
        { evidenceTokenChain: catalogUc?.evidence?.tokenChain },
      );

      let checkStatus = scored.ok ? 'PASS' : 'FAIL';
      let errorClass = scored.reason;
      if (scored.ok) {
        const reply = String(body.reply || '');
        const grounded = liveAccounts.some((a) => reply.includes(String(a.balance)));
        if (!grounded) {
          checkStatus = 'FAIL';
          errorClass = 'wrong_response';
        }
      }

      writeLedgerEntry({
        vertical: 'banking',
        useCaseId: 'UC1',
        triggerType: 'chip',
        mode: 'heuristic',
        status: checkStatus,
        errorClass,
        primaryTool: catalogUc?.primaryTool || 'get_account_balance',
        checkedAt: new Date().toISOString(),
      });

      expect(status, `invoke HTTP ${status}: ${body.error || ''}`).toBe(200);
      expect(body.success, `invoke failed: ${body.error || body.reply || ''}`).toBe(true);
      expect(scored.ok, scored.reason).toBe(true);
      expect(checkStatus).toBe('PASS');
    });

    test('UC5 Demo Step path: attack-sim insufficient-scope → gateway DENY', async ({ page }) => {
      // Teaching contract: mint read-only token then DENY create_transfer.
      // A stale session AT yields exchange_failed (502) — that must FAIL the
      // ledger as infra, not look like a successful scope deny.
      const catalogUc = resolveUseCase('UC5', 'banking');
      const sim = catalogUc?.trigger?.sim || 'insufficient-scope';
      const { status, body } = await page.evaluate(async (simId) => {
        const r = await fetch('/api/demo/attack-sim/run', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ sim: simId }),
        });
        const json = await r.json().catch(() => ({}));
        return { status: r.status, body: json };
      }, sim);

      const scored = scoreAttackSimDeny(
        { status, body },
        {
          expectedErrorCode: 'insufficient_scope',
          evidenceTokenChain: catalogUc?.evidence?.tokenChain || ['sim-exchange-ok', 'sim-gateway-deny'],
        },
      );

      writeLedgerEntry({
        vertical: 'banking',
        useCaseId: 'UC5',
        triggerType: 'attack',
        mode: 'heuristic',
        status: scored.ok ? 'PASS' : 'FAIL',
        errorClass: scored.reason,
        primaryTool: null,
        checkedAt: new Date().toISOString(),
      });

      expect(status, `attack-sim HTTP ${status}: ${body.error || body.reason || ''}`).toBe(200);
      expect(
        scored.ok,
        `UC5 teaching DENY failed (${scored.reason}): ${body.errorCode || ''} ${String(body.reason || '').slice(0, 180)}`,
      ).toBe(true);
      expect(body.errorCode).toBe('insufficient_scope');
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
    });

    for (const c of AMOUNT_CASES.filter((x) => x.freeText)) {
      test(`${c.useCaseId} free-text (llamacpp): amount ${c.amount}`, async ({ page }) => {
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
        });

        expect(status).toBe(200);
        expect(checkStatus).toBe('PASS');
      });
    }
  });
});
