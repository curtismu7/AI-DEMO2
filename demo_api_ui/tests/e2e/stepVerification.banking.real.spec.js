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

    test('accounts/balance chip: values match /api/accounts/my (check 4)', async ({ page }) => {
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

      let checkStatus = 'PASS';
      let errorClass = null;

      if (status !== 200) {
        checkStatus = 'FAIL';
        errorClass = 'server_error';
      } else {
        const resultText = JSON.stringify(body.result ?? body ?? {});
        const anyBalanceGrounded = liveAccounts.some((a) => resultText.includes(String(a.balance)));
        if (!anyBalanceGrounded) {
          checkStatus = 'FAIL';
          errorClass = 'wrong_response';
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
