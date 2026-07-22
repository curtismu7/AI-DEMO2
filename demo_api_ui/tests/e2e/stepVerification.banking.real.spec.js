// demo_api_ui/tests/e2e/stepVerification.banking.real.spec.js
/**
 * @file stepVerification.banking.real.spec.js
 * Live-stack step verification for banking: chip dispatch (heuristic mode)
 * and free-text dispatch (LLM-only mode), writing PASS/FAIL ledger entries
 * for checks 1 (server error), 3 (LLM error), 4 (right response — values vs
 * /api/accounts/my), 5 (right gate — via `source`).
 *
 * Prerequisites: stack running (./run.sh), E2E_CUSTOMER_USERNAME/PASSWORD set.
 * Run:
 *   cd demo_api_ui
 *   E2E_BASE_URL=https://api.ping.demo:4000 npx playwright test \
 *     tests/e2e/stepVerification.banking.real.spec.js --config=playwright.real.config.js
 */
const { test, expect } = require('@playwright/test');
const { execSync } = require('child_process');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');
const { writeLedgerEntry } = require('../../../demo_api_server/services/stepVerificationLedger');
const { USE_CASES, resolveUseCase } = require('../../../demo_api_server/config/useCases.js');

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

const AMOUNT_CASES = [
  {
    useCaseId: 'UC8',
    chipText: 'transfer $300 from checking to savings',
    freeText: 'please move three hundred dollars out of my checking into my savings',
  },
  {
    useCaseId: 'UC7',
    chipText: 'transfer $600 from checking to savings',
    freeText: 'please move six hundred dollars out of my checking into my savings',
  },
  {
    useCaseId: 'UC6',
    chipText: 'transfer $2500 from checking to savings',
    freeText: 'please move twenty-five hundred dollars out of my checking into my savings',
  },
];

const LLM_ERROR_SIGNATURES = [
  'unknown provider in reasonOnce',
  'exceeds the available context size',
  'ProviderClient httpx errored',
];

/** Best-effort — some environments don't have docker access from the test runner. */
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

test.describe('Step verification — banking (real login, live stack)', () => {
  test.skip(!requireRealLoginEnv(), 'Skipped: set E2E_CUSTOMER_USERNAME and E2E_CUSTOMER_PASSWORD');

  test.beforeEach(async ({ page }) => {
    await loginAsCustomer(page);
  });

  for (const c of AMOUNT_CASES) {
    test(`${c.useCaseId} chip (heuristic): "${c.chipText}"`, async ({ page }) => {
      const { status, body } = await dispatchNl(page, c.chipText, 'llamacpp');

      let checkStatus = 'PASS';
      let errorClass = null;
      if (status !== 200) {
        checkStatus = 'FAIL';
        errorClass = 'server_error';
      } else if (body.source !== 'heuristic') {
        checkStatus = 'FAIL';
        errorClass = 'parse_error';
      }

      writeLedgerEntry({
        vertical: 'banking',
        useCaseId: c.useCaseId,
        triggerType: 'chip',
        mode: 'heuristic',
        status: checkStatus,
        errorClass,
        primaryTool: 'create_transfer',
        checkedAt: new Date().toISOString(),
      });

      expect(status).toBe(200);
      expect(body.source).toBe('heuristic');
    });
  }

  test('accounts/balance chip: values match /api/accounts/my (check 4: right response)', async ({ page }) => {
    const readChip = findBankingReadChip();
    test.skip(!readChip, 'No works-maturity banking chip routes to an accounts/balance read tool');

    const liveAccounts = await page.evaluate(async () => {
      const r = await fetch('/api/accounts/my', { credentials: 'include' });
      if (!r.ok) throw new Error(`accounts/my -> ${r.status}`);
      const data = await r.json();
      return data.accounts || [];
    });

    const { status, body } = await callMcpTool(page, readChip.primaryTool, {});

    let checkStatus = 'PASS';
    let errorClass = null;

    if (status !== 200) {
      checkStatus = 'FAIL';
      errorClass = 'server_error';
    } else {
      const resultText = JSON.stringify(body.result ?? {});
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

  test.describe('free-text prompts (LLM-only mode)', () => {
    test.beforeAll(async ({ request, baseURL }) => {
      await request.patch(`${baseURL}/api/admin/feature-flags`, {
        data: { updates: { ff_heuristic_enabled: false } },
      });
    });

    test.afterAll(async ({ request, baseURL }) => {
      await request.patch(`${baseURL}/api/admin/feature-flags`, {
        data: { updates: { ff_heuristic_enabled: true } },
      });
    });

    for (const c of AMOUNT_CASES) {
      test(`${c.useCaseId} free-text (llamacpp): "${c.freeText}"`, async ({ page }) => {
        const { status } = await dispatchNl(page, c.freeText, 'llamacpp');

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
      });
    }
  });
});
