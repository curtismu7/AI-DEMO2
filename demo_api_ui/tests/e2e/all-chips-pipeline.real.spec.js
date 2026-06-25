// banking_api_ui/tests/e2e/all-chips-pipeline.real.spec.js
'use strict';
/**
 * All-chips routing + non-skippable pipeline — REAL login, real Helix.
 *
 * Conditions:
 *   1. Heuristics-only        provider='auto', ff_heuristic_enabled stays true
 *   2. Helix-only             provider='helix' (real Helix)
 *   3. Helix-fails → fallback  helix_base_url set to a dead URL; provider='helix'
 *
 * Skip-proof: customer asserts token-chain + tokenEvents (runChip);
 * admin context corroborates Authorize + gateway (assertAdminPipelineEvents).
 *
 * Requires: ./run-demo.sh stack up, real-login env vars set. Auto-skips otherwise.
 */
const { test, expect, request } = require('@playwright/test');
const {
  loginAsCustomer,
  loginAsAdmin,
  requireRealLoginEnv,
  requireAdminLoginEnv,
} = require('./helpers/realLogin');
const { runChip, assertAdminPipelineEvents, activateVertical } = require('./helpers/chipPipeline');
const { heuristicChips, allChips } = require('../../../demo_api_server/scripts/extractChips');

const BASE = process.env.E2E_BASE_URL || 'https://api.ping.demo:3001';

test.describe('all-chips routing + non-skippable pipeline (real)', () => {
  test.skip(!requireRealLoginEnv() || !requireAdminLoginEnv(),
    'Requires E2E_CUSTOMER_* and E2E_ADMIN_* env vars');
  test.describe.configure({ mode: 'serial', timeout: 180_000 });

  let customerApi;   // APIRequestContext with customer cookies
  let adminApi;      // APIRequestContext with admin cookies
  let customerCtx;
  let adminCtx;
  let originalHelixBaseUrl;
  let helixConfigured = false;

  test.beforeAll(async ({ browser }) => {
    // ignoreHTTPSErrors: the local stack serves https://api.ping.demo via a
    // mkcert cert. Chromium trusts the mkcert CA, but Playwright's
    // APIRequestContext (ctx.request, used by runChip) is a separate Node TLS
    // client that does not — without this it rejects with "self-signed
    // certificate in certificate chain". Scoped to this spec; the strict
    // config default stays for Vercel/production targets.
    // Customer session
    customerCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const cPage = await customerCtx.newPage();
    await loginAsCustomer(cPage);
    customerApi = customerCtx.request;

    // Admin session
    adminCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const aPage = await adminCtx.newPage();
    await loginAsAdmin(aPage);
    adminApi = adminCtx.request;

    // Ensure banking vertical is active so heuristic routing works correctly.
    await activateVertical(customerApi, 'banking');

    // Capture the live helix_base_url so condition 3 can restore it.
    // Masked GET does not return secrets but helix_base_url is not masked;
    // fall back to the documented default if absent.
    const cfgResp = await adminApi.get('/api/admin/config');
    const cfg = cfgResp.ok() ? await cfgResp.json() : {};
    originalHelixBaseUrl =
      (cfg.config && cfg.config.helix_base_url) ||
      process.env.HELIX_BASE_URL ||
      'https://openam-helix.forgeblocks.com';

    // Helix precondition probe. Helix creds resolve from configStore — which
    // includes the vault-sourced HELIX_API_KEY (vaultLoader → configStore;
    // NOT process.env, Phase 269 allowlist), HELIX_* env, LLM2.json, or
    // builtin FIELD_DEFS defaults. If Helix is unconfigured the router falls
    // back to heuristic and Condition 2 would FALSELY pass — so the probe
    // MUST use a phrase the heuristic genuinely cannot resolve, forcing the
    // LLM path. NOTE: "what is the capital of France?" is NOT safe — the
    // current heuristic classifies it as a banking web_search intent and
    // returns source:'heuristic' before Helix is ever consulted (T-3:
    // heuristic always runs first and short-circuits), which falsely fails
    // this precondition even when Helix is fully configured. The phrase below
    // is empirically verified to return parseHeuristic() === none.
    const probe = await customerApi.post('/api/demo-agent/nl', {
      data: {
        message: 'Reply with exactly the single word: persimmon',
        provider: 'helix',
      },
    });
    const probeBody = probe.ok() ? await probe.json() : {};
    helixConfigured = probeBody.source === 'helix' || probeBody.source === 'helix_fallback';
  });

  test.afterAll(async () => {
    // ALWAYS restore helix_base_url, even if a condition-3 assertion threw.
    if (adminApi && originalHelixBaseUrl) {
      await adminApi.post('/api/admin/config', {
        data: { helix_base_url: originalHelixBaseUrl },
      }).catch(() => {});
    }
    await customerCtx?.close().catch(() => {});
    await adminCtx?.close().catch(() => {});
  });

  // ── Condition 1: Heuristics-only ───────────────────────────────────────────
  test('Condition 1 — Heuristics-only: every built-in HEURISTIC chip executes the full pipeline', async () => {
    for (const chip of heuristicChips) {
      const since = new Date(Date.now() - 2000).toISOString();
      const { source, executed } = await runChip(customerApi, chip, 'auto');
      expect(source, `chip ${chip.id} routed by heuristic`).toBe('heuristic');
      expect(executed, `chip ${chip.id} executed a banking tool`).toBe(true);
      await assertAdminPipelineEvents(adminApi, since, chip.id);
    }
  });

  test('Condition 1 — LLM-only chips degrade gracefully (no crash, no skipped pipeline)', async () => {
    const llm = allChips.filter((c) => c.kind === 'llm-builtin');
    for (const chip of llm) {
      const { source, result, executed, tokenEvents } = await runChip(customerApi, chip, 'auto');
      // Heuristic either matched a banking action (then it MUST have a trail)
      // or returned a non-banking result (kind:none/education) — both pass.
      if (executed) {
        expect(tokenEvents.length, `chip ${chip.id} executed → trail required`).toBeGreaterThan(0);
      } else {
        expect(['heuristic', 'helix', 'helix_fallback', 'ollama']).toContain(source);
        expect(result.kind === 'none' || result.kind === 'education' || result.kind === 'banking').toBe(true);
      }
    }
  });

  // ── Condition 2: Helix-only (real Helix) ───────────────────────────────────
  test('Condition 2 — Helix-only: every chip routes via Helix and executes the full pipeline', async () => {
    test.skip(
      !helixConfigured,
      'Helix is NOT configured (probe did not return source=helix). ' +
        'Condition 2 cannot validate Helix routing. Configure Helix via ' +
        '/setup, HELIX_API_KEY, or place LLM2.json in repo root, then re-run.',
    );

    for (const chip of allChips) {
      const since = new Date(Date.now() - 2000).toISOString();
      const { source, executed } = await runChip(customerApi, chip, 'helix');
      // With Helix confirmed live, banking chips MUST route via Helix. The
      // heuristic floor is only acceptable for chips the heuristic also
      // recognizes (it runs first by design) — but a Helix-sourced result is
      // expected for the LLM chips that the heuristic returns kind:none for.
      expect(['helix', 'helix_fallback', 'heuristic']).toContain(source);
      if (executed) {
        await assertAdminPipelineEvents(adminApi, since, chip.id);
      }
    }

    // Cross-check: at least the LLM-only chips (heuristic returns none) must
    // have been resolved by Helix, proving Helix actually did routing work.
    const llmProbe = allChips.find((c) => c.id === 'recommendations') || allChips.find((c) => c.kind === 'llm-builtin');
    const { source: llmSource } = await runChip(customerApi, llmProbe, 'helix');
    expect(
      ['helix', 'helix_fallback'],
      `LLM-only chip ${llmProbe.id} must be Helix-routed in Condition 2`,
    ).toContain(llmSource);
  });

  // ── Condition 3: Helix fails → Heuristic fallback ──────────────────────────
  test('Condition 3 — dead Helix: heuristic chips still execute via fallback', async () => {
    // Point Helix at a syntactically valid but unroutable URL.
    const setResp = await adminApi.post('/api/admin/config', {
      data: { helix_base_url: 'https://127.0.0.1:9' },
    });
    expect(setResp.ok(), 'helix_base_url override accepted').toBe(true);

    for (const chip of heuristicChips) {
      const since = new Date(Date.now() - 2000).toISOString();
      const { source, executed } = await runChip(customerApi, chip, 'helix');
      // Helix is dead → routing MUST fall back to heuristic (never a canned miss).
      expect(source, `chip ${chip.id} fell back to heuristic`).toBe('heuristic');
      expect(executed, `chip ${chip.id} still executed end-to-end`).toBe(true);
      await assertAdminPipelineEvents(adminApi, since, chip.id);
    }
    // Restore happens in afterAll regardless of assertion outcome.
  });

  // ── Negative: no-token hard-fail (fresh, unauthenticated context) ──────────
  test('No user token — pipeline hard-fails 401 before any exchange/gateway/authorize', async ({ browser }) => {
    const anonCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const anon = anonCtx.request;
    const res = await anon.post(`${BASE}/api/mcp/tool`, {
      data: { tool: 'get_my_accounts', params: {} },
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('unauthenticated');
    await anonCtx.close();
  });
});
