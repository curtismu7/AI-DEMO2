// Focused regression tests for the two router bugs:
//   1. cross-class swaps must serialize (never overlap and unload each other)
//   2. smallestLoadedCovering must never substitute UP onto the pin-only tier
//
// router.js guards its runtime side effects behind `require.main === module`, so
// requiring it here binds no ports and starts no timers — we exercise the pure
// functions directly. FIX 1's swap loop makes real localhost HTTP calls, so we
// stand up mock servers on the tier ports and a mock tier-manager.

const test = require('node:test');
const assert = require('node:assert');
const http = require('http');

const TIER_PORTS = [8091, 8096, 8093]; // must match TIERS in router.js
const MGR_PORT = 18097;

let router;
const servers = [];
let ensure; // { active, maxActive, calls[] }

function listen(port, handler) {
  return new Promise((resolve, reject) => {
    const s = http.createServer(handler);
    s.once('error', reject);
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

test.before(async () => {
  // Point the router at our mocks and clear any pin/resident/host overrides.
  process.env.LLAMA_HOST = '127.0.0.1';
  process.env.TIER_MANAGER_URL = `http://127.0.0.1:${MGR_PORT}`;
  delete process.env.LLAMA_TIER1_HOST;
  delete process.env.LLAMA_TIER3_HOST;
  delete process.env.LLAMA_TIER5_HOST;
  delete process.env.LLM_PROXY_PIN_TIER;
  delete process.env.LLM_PROXY_RESIDENT_TIERS;

  ensure = { active: 0, maxActive: 0, calls: [] };

  // Mock tier-manager: records ensure concurrency, responds after a short delay
  // so overlapping calls (the bug) would be observable as maxActive > 1.
  servers.push(await listen(MGR_PORT, (req, res) => {
    const u = new URL(req.url, 'http://x');
    if (u.pathname === '/ensure') {
      ensure.active += 1;
      ensure.maxActive = Math.max(ensure.maxActive, ensure.active);
      ensure.calls.push(u.searchParams.get('port'));
      setTimeout(() => {
        ensure.active -= 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: true }));
      }, 60);
      return;
    }
    res.writeHead(404);
    res.end();
  }));

  // Mock tier /health endpoints so swapTo's post-ensure probe resolves.
  for (const port of TIER_PORTS) {
    servers.push(await listen(port, (req, res) => {
      if (req.url === '/health') { res.writeHead(200); res.end('ok'); return; }
      res.writeHead(404); res.end();
    }));
  }

  router = require('./router.js');
});

test.after(async () => {
  await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
});

// ── FIX 1: cross-class swaps serialize ──────────────────────────────────────

test('concurrent cross-class swaps do not overlap (serialized ensure)', async () => {
  const { swapTo } = router;
  ensure.calls.length = 0;
  ensure.maxActive = 0;

  // class 1 (gpt-oss :8096) and class 0 (phi :8091) requested simultaneously.
  const [r1, r0] = await Promise.allSettled([swapTo(1), swapTo(0)]);

  assert.strictEqual(r1.status, 'fulfilled', 'first swap should resolve');
  assert.strictEqual(r0.status, 'fulfilled', 'second swap should resolve (not clobbered)');
  assert.strictEqual(ensure.maxActive, 1, 'tier-manager ensure calls must never overlap');
  assert.deepStrictEqual([...ensure.calls].sort(), ['8091', '8096'], 'both classes swapped exactly once');
});

test('same-class concurrent swaps coalesce to a single ensure', async () => {
  const { swapTo } = router;
  ensure.calls.length = 0;

  const a = swapTo(1);
  const b = swapTo(1);
  assert.strictEqual(a, b, 'same-class concurrent asks return the identical promise');
  await Promise.all([a, b]);
  assert.deepStrictEqual(ensure.calls, ['8096'], 'coalesced to one ensure');
});

// ── FIX 2: pin-only tier excluded from health-based substitution ────────────

test('smallestLoadedCovering never substitutes UP onto the pin-only tier', () => {
  const { smallestLoadedCovering, TIERS } = router;
  // 0=phi(8091) 1=gpt-oss(8096) 2=llama-3-groq(8093, pinOnly)
  assert.strictEqual(TIERS[2].pinOnly, true, 'pin-only marker present on :8093');

  TIERS[0].healthy = false;
  TIERS[1].healthy = false; // the intended class-1 tier is down
  TIERS[2].healthy = true;  // only the pin-only tier is healthy

  assert.strictEqual(
    smallestLoadedCovering(1),
    null,
    'a class-1 route must NOT fall onto the unproven :8093',
  );
});

test('smallestLoadedCovering returns the pin-only tier only when targeted exactly', () => {
  const { smallestLoadedCovering, TIERS } = router;
  TIERS[0].healthy = false;
  TIERS[1].healthy = false;
  TIERS[2].healthy = true;

  // class 2 == an explicit pin (LLM_PROXY_PIN_TIER=8093) or model= pin.
  assert.strictEqual(
    smallestLoadedCovering(2),
    TIERS[2],
    'an explicit class-2 route may use :8093',
  );
});

test('smallestLoadedCovering still substitutes UP onto non-pin tiers', () => {
  const { smallestLoadedCovering, TIERS } = router;
  TIERS[0].healthy = false;
  TIERS[1].healthy = true; // gpt-oss healthy
  TIERS[2].healthy = true;

  assert.strictEqual(
    smallestLoadedCovering(1),
    TIERS[1],
    'class-1 served by gpt-oss (:8096) as before',
  );
  assert.strictEqual(
    smallestLoadedCovering(0),
    TIERS[1],
    'class-0 substitutes UP onto the loaded gpt-oss, not the pin-only tier',
  );
});
