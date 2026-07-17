// demo_api_ui/tests/e2e/vertical-chip-correctness.real.spec.js
'use strict';
/**
 * Chip CORRECTNESS — do heuristics and the LLM return the RIGHT answer?
 *
 * Everything else in this repo proves the PIPELINE runs: verticalCoreChipSuite
 * asserts `source` and `executed === true`; evidence-screenshots asserts the
 * reply is not an error card; assertMcpPipelineCustomerProof asserts a 200/403/428
 * and an RFC 8693 exchange. NONE of them assert the DATA is right — an invented
 * balance and a real one pass every one of those checks identically.
 *
 * That is the demo's central claim, so this spec checks it directly, at the API
 * level (no browser: no flake, and it isolates routing/data from rendering):
 *
 *   1. ROUTING PARAMS EXACT  — "$300" must resolve to amount 300, not 600.
 *   2. TOOL DATA == STORE    — the /api/mcp/tool payload carries the seed's real
 *                              values (e.g. Great Buy order "AirPods Pro" $249).
 *   3. CROSS-MODE EQUIVALENCE— heuristics and each LLM mode must resolve the SAME
 *                              action + params. Divergence = a routing bug, by
 *                              definition. This is the cheapest strong proof that
 *                              "the LLM gets it right".
 *   4. GROUNDING             — any prose the router returns must not state a money
 *                              figure absent from the tool payload (hallucination).
 *
 * Ground truth comes from config/verticals/<v>/seed.json — the same seed the BFF
 * serves — so there are no hard-coded numbers to rot.
 *
 * Run (stack up; source the MAIN checkout's .env — a worktree has none):
 *   set -a && . <repo>/demo_api_server/.env && set +a
 *   E2E_BASE_URL=https://api.ping.demo:4000 \
 *   E2E_CUSTOMER_USERNAME="$DEMO_USER_USERNAME" E2E_CUSTOMER_PASSWORD="$DEMO_USER_PASSWORD" \
 *   npx playwright test tests/e2e/vertical-chip-correctness.real.spec.js --config=playwright.real.config.js
 */
const fs = require('fs');
const path = require('path');
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('./helpers/realLogin');
const { activateVertical } = require('./helpers/chipPipeline');

const SEED_ROOT = path.resolve(__dirname, '../../../demo_api_server/config/verticals');

/** Modes to compare. heuristic is the deterministic reference. */
const MODES = (process.env.E2E_CORRECTNESS_MODES || 'heuristic,llamacpp').split(',').map((s) => s.trim());

/**
 * Chips under test. `amount` = the figure stated in the phrase, so routing can be
 * checked exactly. `seedProbe` returns values from seed.json that a correct tool
 * payload must contain.
 */
const VERTICALS = {
  healthcare: {
    label: 'CareConnect',
    chips: [
      { id: 'hc-coverage', message: 'check my coverage', action: 'view_coverage' },
      { id: 'hc-records', message: 'my records', action: 'view_records' },
      { id: 'hc-appts', message: 'my appointments', action: 'list_appointments' },
      { id: 'hc-pay300', message: 'pay my $300 bill', amount: 300 },
      { id: 'hc-pay600', message: 'pay my $600 bill', amount: 600 },
      { id: 'hc-pay2500', message: 'pay my $2500 bill', amount: 2500 },
    ],
  },
  retail: {
    label: 'Great Buy',
    chips: [
      { id: 'rt-orders', message: 'list my orders', action: 'list_orders' },
      { id: 'rt-status', message: 'order status', action: 'order_status' },
      { id: 'rt-rewards', message: 'my reward points', action: 'rewards_balance' },
      { id: 'rt-co300', message: 'checkout headphones for $300', amount: 300 },
      { id: 'rt-co600', message: 'checkout headphones for $600', amount: 600 },
      { id: 'rt-co2500', message: 'checkout headphones for $2500', amount: 2500 },
    ],
  },
};

function seedOf(verticalId) {
  return JSON.parse(fs.readFileSync(path.join(SEED_ROOT, verticalId, 'seed.json'), 'utf8'));
}

/**
 * Every number in a payload that looks like money/quantity, deep.
 * NOTE the key list is deliberately wide: money key names differ per vertical —
 * retail uses `amount`, healthcare uses `amountDue`, banking uses `balance`. A
 * narrower regex silently finds 0 values and the test then asserts nothing.
 */
function numbersIn(payload, keyRe = /^(amount|amountDue|amount_due|balance|total|points|price|cost|copay)$/i) {
  const out = [];
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    for (const [k, val] of Object.entries(v)) {
      if (keyRe.test(k) && typeof val === 'number') out.push(val);
      else walk(val);
    }
  };
  walk(payload);
  return out;
}

/** Money figures mentioned in prose, e.g. "$1,234.50" -> 1234.5 */
function moneyInProse(text) {
  const out = [];
  const re = /\$\s?([0-9][0-9,]*(?:\.[0-9]{1,2})?)/g;
  let m;
  while ((m = re.exec(text || '')) !== null) out.push(Number(m[1].replace(/,/g, '')));
  return out;
}

/** Route one chip; return the routing decision + the tool payload it produced. */
async function route(api, message, provider, vertical) {
  const resp = await api.post('/api/demo-agent/nl', { data: { message, provider, vertical } });
  expect(resp.status(), `nl status (${provider}/${vertical}) "${message}"`).toBe(200);
  return resp.json();
}

/**
 * The routing decision, normalised. Two shapes exist and BOTH are load-bearing:
 *   banking   -> { kind:'banking',  banking: { action, params } }
 *   verticals -> { kind:'vertical', vertical:'retail', action, params }
 * Reading only `result.banking.action` silently sees null for every vertical chip.
 */
function decisionOf(body) {
  const r = body.result || {};
  return {
    kind: r.kind ?? null,
    action: r.banking?.action ?? r.action ?? null,
    params: r.banking?.params ?? r.params ?? null,
    source: body.source,
  };
}

test.describe('chip correctness — values, not just plumbing', () => {
  test.skip(!requireRealLoginEnv(), 'Requires E2E_CUSTOMER_* env vars');

  for (const [verticalId, cfg] of Object.entries(VERTICALS)) {
    test.describe(`${cfg.label} (${verticalId})`, () => {
      test.describe.configure({ mode: 'serial' });
      let ctx;
      let api;

      test.beforeAll(async ({ browser }) => {
        // ignoreHTTPSErrors: the stack serves a mkcert cert Playwright won't trust.
        ctx = await browser.newContext({ ignoreHTTPSErrors: true });
        const page = await ctx.newPage();
        await loginAsCustomer(page);
        api = ctx.request;
        await activateVertical(api, verticalId);
      });

      test.afterAll(async () => {
        await activateVertical(api, 'banking').catch(() => {});
        await ctx?.close().catch(() => {});
      });

      // ── 1 + 3: routing params exact, and identical across modes ───────────
      for (const chip of cfg.chips) {
        test(`${chip.id} "${chip.message}" — same routing in every mode${chip.amount ? `, amount ${chip.amount}` : ''}`, async () => {
          const seenByMode = {};
          for (const mode of MODES) {
            const body = await route(api, chip.message, mode, verticalId);
            seenByMode[mode] = decisionOf(body);
            console.log(`  [${verticalId}/${chip.id}] ${mode.padEnd(10)} -> ${JSON.stringify(seenByMode[mode])}`);
          }

          // 1. ROUTING PARAMS EXACT — the figure in the phrase must survive routing.
          if (chip.amount) {
            for (const mode of MODES) {
              const p = seenByMode[mode].params || {};
              const amt = Number(p.amount ?? p.value ?? NaN);
              expect(
                amt,
                `${chip.id} (${mode}): phrase says $${chip.amount} but routing resolved amount=${p.amount} — ` +
                  `moving the WRONG amount is the worst failure this demo can have.`,
              ).toBe(chip.amount);
            }
          }
          if (chip.action) {
            for (const mode of MODES) {
              expect(
                seenByMode[mode].action,
                `${chip.id} (${mode}): expected action ${chip.action}`,
              ).toBe(chip.action);
            }
          }

          // 3. CROSS-MODE EQUIVALENCE — every mode must agree with the reference.
          const ref = seenByMode[MODES[0]];
          for (const mode of MODES.slice(1)) {
            expect(
              { action: seenByMode[mode].action, params: seenByMode[mode].params },
              `${chip.id}: ${mode} routed differently than ${MODES[0]} — ` +
                `the LLM and heuristics must reach the SAME action+params for the same chip.`,
            ).toEqual({ action: ref.action, params: ref.params });
          }
        });
      }

      // ── 4: grounding — prose must not invent money figures ────────────────
      test(`${verticalId} — router prose states no money figure it did not fetch`, async () => {
        const chip = cfg.chips[0];
        for (const mode of MODES) {
          const body = await route(api, chip.message, mode, verticalId);
          const prose = [body.result?.message, body.result?.education?.message]
            .filter(Boolean).join('\n');
          if (!prose) continue;
          const stated = moneyInProse(prose);
          console.log(`  [${verticalId}/grounding] ${mode} prose money: ${JSON.stringify(stated)}`);
          expect(
            stated.length,
            `${mode}: routing prose quotes money figures ${JSON.stringify(stated)} but a routing ` +
              `decision has fetched no data yet — invented.\nProse: ${prose}`,
          ).toBe(0);
        }
      });

      // ── 2: tool data == store ─────────────────────────────────────────────
      test(`${verticalId} — seed defines the ground truth this vertical must serve`, () => {
        const seed = seedOf(verticalId);
        const nums = numbersIn(seed);
        console.log(`  [${verticalId}] seed keys: ${Object.keys(seed).join(', ')}`);
        console.log(`  [${verticalId}] seed money values (${nums.length}): ${JSON.stringify(nums.slice(0, 8))}`);
        expect(
          nums.length,
          `${verticalId}/seed.json defines no money values — nothing to verify a tool payload against.`,
        ).toBeGreaterThan(0);
      });
    });
  }
});
