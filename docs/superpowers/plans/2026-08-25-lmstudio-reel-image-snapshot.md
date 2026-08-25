# LM Studio Reel Image Snapshot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put a server-rendered SVG filmstrip of the transaction trace into every façade tool result, so LM Studio's chat shows the movie reel inline instead of only a link.

**Architecture:** A pure `renderReelSvg(record)` function turns the ledger record `transactionAssembler.assemble()` already produces into a compact SVG (one row per hop, decision badge, duration). `routes/mcpFacade.js` serves it at `GET /mcp-facade/reel/:correlationId.svg` — door-agnostic, no auth (same trust as `/api/transaction-trace/embed/:cid`), rendered at *view* time so late-arriving hops (the gateway's own `gateway.authorize`) are included. The appended tool-result block gains a Markdown image line above the existing `reel_url:` line. Nothing is stored; no image libraries.

**Tech Stack:** Node 22 CommonJS, Express 4, jest + supertest (existing `demo_api_server` stack). No new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-24-lmstudio-mcp-client-design.md` §4 ("static image snapshot") and §5.3; the façade itself is `docs/superpowers/specs/2026-08-24-librechat-embedded-mcp-trace-design.md` §3–§4 (implemented in PR #2356).

## Global Constraints

- Emoji allowlist (REGRESSION_PLAN §0): the SVG uses plain text/CSS glyphs only — `✓` and `❌` are allowed; nothing else.
- The first line of the appended block must stay byte-identical: `reel_url: <url>` (LibreChat's artifact instruction keys on it, PR #2362).
- No auth on the SVG route (spec §4 of the embedded-trace design: "the id is the capability"; façade ids are random UUIDs).
- No new npm dependencies; no PNG rendering, no headless browser on the server.
- `{ error }` shape for JSON errors (demo_api_server/CLAUDE.md). The SVG route never returns JSON on the happy path — an `<img>` cannot show one.
- Run tests with `CI=true ./node_modules/.bin/jest <file> --forceExit` from `demo_api_server/` (worktree needs `bash scripts/bootstrap-worktree.sh` first; `npx jest` pulls the wrong runtime).
- Work in a worktree branch; stage files explicitly; never `git add -A`.

---

### Task 1: `renderReelSvg(record)` — pure SVG renderer

**Files:**
- Create: `demo_api_server/services/reelSvg.js`
- Test: `demo_api_server/tests/services/reelSvg.test.js`

**Interfaces:**
- Consumes: the record shape returned by `services/transactionAssembler.js` `assemble(correlationId)` → `{ correlationId, startedAt, endedAt, principal, hops: [{ seq, ts, service, phase, op?, durationMs?, status?, decision?: { outcome, by, reason?, source? }, details? }] }`, or `null`.
- Produces: `renderReelSvg(record, opts = {}) → string` (a complete `<svg …>` document). `opts.title` (string, optional) overrides the header. `record === null` renders a "waiting for the first hop" frame. `renderReelSvg.CONTENT_TYPE === 'image/svg+xml'`.

- [ ] **Step 1: Write the failing tests**

```js
'use strict';
const { renderReelSvg } = require('../../services/reelSvg');

const RECORD = {
  correlationId: 'cid-1',
  startedAt: '2026-08-25T04:00:00.000Z',
  endedAt: '2026-08-25T04:00:01.000Z',
  principal: 'user-1',
  hops: [
    { seq: 1, phase: 'ui.request', service: 'mcp-facade', op: 'tools/call get_my_accounts',
      identity: { sub: 'user-1' }, details: { doorLabel: 'Agent Gateway' } },
    { seq: 2, phase: 'gateway.authorize', service: 'mcp-gateway', op: 'get_my_accounts',
      decision: { outcome: 'permit', by: 'gateway' } },
    { seq: 3, phase: 'mcp.tool', service: 'mcp-facade', op: 'get_my_accounts', status: 'ok', durationMs: 410 },
    { seq: 4, phase: 'response', service: 'mcp-facade', op: 'tools/call', status: 'ok' },
  ],
};

describe('renderReelSvg', () => {
  test('renders one row per hop with service, phase, op and duration', () => {
    const svg = renderReelSvg(RECORD);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
    for (const h of RECORD.hops) expect(svg).toContain(`${h.service}`);
    expect(svg).toContain('gateway.authorize');
    expect(svg).toContain('410ms');
    // header names the door and the call
    expect(svg).toContain('Agent Gateway');
    expect(svg).toContain('tools/call get_my_accounts');
  });

  test('renders decision badges: PERMIT, DENY, and the inferred marker', () => {
    expect(renderReelSvg(RECORD)).toContain('✓ PERMIT');
    const denied = { ...RECORD, hops: [{ seq: 1, phase: 'gateway.authorize', service: 'mcp-facade', op: 'x',
      decision: { outcome: 'deny', by: 'Privilege agentless', reason: 'HTTP 403', source: 'inferred' } }] };
    const svg = renderReelSvg(denied);
    expect(svg).toContain('❌ DENY');
    expect(svg).toContain('inferred');
    expect(svg).toContain('HTTP 403');
  });

  test('escapes XML in hop text so a hostile tool name cannot break the document', () => {
    const nasty = { ...RECORD, hops: [{ seq: 1, phase: 'mcp.tool', service: 'mcp-facade', op: '<script>alert(1)</script>&x' }] };
    const svg = renderReelSvg(nasty);
    expect(svg).not.toContain('<script>');
    expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;&amp;x');
  });

  test('null record renders a waiting frame that is still a valid svg', () => {
    const svg = renderReelSvg(null);
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('Waiting for the first hop');
  });

  test('height grows with the number of hops', () => {
    const one = renderReelSvg({ ...RECORD, hops: RECORD.hops.slice(0, 1) });
    const four = renderReelSvg(RECORD);
    const h = (svg) => Number(svg.match(/height="(\d+)"/)[1]);
    expect(h(four)).toBeGreaterThan(h(one));
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/services/reelSvg.test.js --forceExit`
Expected: FAIL — `Cannot find module '../../services/reelSvg'`

- [ ] **Step 3: Implement the renderer**

```js
'use strict';
/**
 * reelSvg.js — server-rendered "movie reel" snapshot of one transaction.
 *
 * LM Studio renders Markdown + images in chat but has no HTML/iframe hook
 * (docs/superpowers/specs/2026-08-24-lmstudio-mcp-client-design.md §4), so the
 * façade points a Markdown image at this. Pure function: record in, SVG out.
 * Rendered at view time by routes/mcpFacade.js, so hops that land after the
 * tool result (the gateway's own gateway.authorize) are included.
 */
const W = 880;
const ROW = 44;
const TOP = 64;
const BOTTOM = 40;

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function decisionBadge(d, x, y) {
  if (!d || d.outcome === 'n/a') return '';
  const deny = d.outcome === 'deny';
  const label = deny ? '❌ DENY' : '✓ PERMIT';
  const extra = [d.source === 'inferred' ? 'inferred' : '', d.reason || ''].filter(Boolean).join(' · ');
  return `<text x="${x}" y="${y}" font-size="12" fill="${deny ? '#b42318' : '#067647'}" font-weight="600">${esc(label)}</text>`
    + (extra ? `<text x="${x + 76}" y="${y}" font-size="11" fill="#6b7280">${esc(extra)}</text>` : '');
}

function frame(height, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" `
    + `font-family="-apple-system, BlinkMacSystemFont, Segoe UI, Helvetica, Arial, sans-serif">`
    + `<rect x="0.5" y="0.5" width="${W - 1}" height="${height - 1}" rx="10" fill="#ffffff" stroke="#e5e7eb"/>`
    + body + '</svg>';
}

function renderReelSvg(record, opts = {}) {
  if (!record) {
    return frame(96,
      `<text x="24" y="40" font-size="16" font-weight="600" fill="#111827">Transaction trace</text>`
      + `<text x="24" y="68" font-size="13" fill="#6b7280">Waiting for the first hop…</text>`);
  }
  const hops = Array.isArray(record.hops) ? record.hops : [];
  const req = hops.find((h) => h.phase === 'ui.request');
  const title = opts.title
    || `Transaction trace — ${req?.op || 'external MCP call'}${req?.details?.doorLabel ? ` (${req.details.doorLabel})` : ''}`;
  const height = TOP + hops.length * ROW + BOTTOM;
  const spineX = 36;
  let body = `<text x="24" y="34" font-size="16" font-weight="600" fill="#111827">${esc(title)}</text>`;
  if (hops.length > 1) {
    body += `<line x1="${spineX}" y1="${TOP}" x2="${spineX}" y2="${TOP + (hops.length - 1) * ROW}" stroke="#d1d5db" stroke-width="2"/>`;
  }
  hops.forEach((h, i) => {
    const y = TOP + i * ROW;
    const err = h.status === 'error' || h.decision?.outcome === 'deny';
    body += `<circle cx="${spineX}" cy="${y}" r="12" fill="${err ? '#fee4e2' : '#eef2ff'}" stroke="${err ? '#b42318' : '#4f46e5'}"/>`
      + `<text x="${spineX}" y="${y + 4}" font-size="11" text-anchor="middle" fill="#111827">${h.seq ?? i + 1}</text>`
      + `<text x="60" y="${y - 2}" font-size="13" fill="#111827"><tspan font-weight="600">${esc(h.service)}</tspan>`
      + `<tspan fill="#4f46e5" dx="8" font-family="ui-monospace, Menlo, monospace" font-size="12">${esc(h.phase)}</tspan>`
      + (h.op ? `<tspan dx="8" font-family="ui-monospace, Menlo, monospace" font-size="12" fill="#374151">${esc(h.op)}</tspan>` : '')
      + '</text>'
      + decisionBadge(h.decision, 60, y + 16)
      + (Number.isFinite(h.durationMs)
        ? `<text x="${W - 24}" y="${y + 4}" font-size="12" text-anchor="end" fill="#6b7280">${h.durationMs}ms</text>` : '');
  });
  body += `<text x="24" y="${height - 14}" font-size="11" fill="#9ca3af">${esc(record.correlationId)}</text>`;
  return frame(height, body);
}

renderReelSvg.CONTENT_TYPE = 'image/svg+xml';
module.exports = { renderReelSvg };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/services/reelSvg.test.js --forceExit`
Expected: PASS, 5 tests

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/services/reelSvg.js demo_api_server/tests/services/reelSvg.test.js
git commit -m "feat(reel): renderReelSvg — server-rendered SVG filmstrip of one transaction"
```

---

### Task 2: `GET /mcp-facade/reel/:correlationId.svg`

**Files:**
- Modify: `demo_api_server/routes/mcpFacade.js` (add the route directly above the line `router.get('/:door/mcp', (req, res) => res.status(405).end());`, ~line 294; add two requires next to the existing `require('./privilegeMcpClient')` at ~line 33)
- Test: `demo_api_server/tests/routes/mcpFacade.test.js` (append a `describe`)

**Interfaces:**
- Consumes: `renderReelSvg` (Task 1); `services/transactionAssembler.js` `assemble(correlationId) → Promise<record|null>`; `services/configStore.js` `getEffective('ff_transaction_ledger')`.
- Produces: `GET /mcp-facade/reel/:correlationId.svg` → `200 image/svg+xml`, `Cache-Control: no-store` (the frame changes as hops land). Always 200 with an SVG body — a broken `<img>` is worse than a frame that says what happened. Task 3 relies on the exact path shape `/mcp-facade/reel/<cid>.svg`.

- [ ] **Step 1: Write the failing tests** (append to `tests/routes/mcpFacade.test.js`, after the existing mocks — add a mock for the assembler and configStore at the top of the file, next to the ledger mock)

```js
// top of file, next to the existing jest.mock for transactionLedger:
jest.mock('../../services/transactionAssembler', () => ({ assemble: jest.fn() }));
jest.mock('../../services/configStore', () => ({ getEffective: jest.fn(() => 'true') }));
const { assemble } = require('../../services/transactionAssembler');
const configStore = require('../../services/configStore');

// appended describe:
describe('/mcp-facade/reel/:correlationId.svg', () => {
  const RECORD = {
    correlationId: 'cid-svg', startedAt: 't', endedAt: 't', principal: 'u',
    hops: [{ seq: 1, phase: 'mcp.tool', service: 'mcp-facade', op: 'get_my_accounts', status: 'ok', durationMs: 5 }],
  };

  beforeEach(() => { configStore.getEffective.mockReturnValue('true'); });

  test('renders the record as image/svg+xml with no-store', async () => {
    assemble.mockResolvedValue(RECORD);
    const res = await request(app()).get('/mcp-facade/reel/cid-svg.svg');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/image\/svg\+xml/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.text).toContain('get_my_accounts');
    expect(assemble).toHaveBeenCalledWith('cid-svg');
  });

  test('unknown id → 200 waiting frame (an <img> cannot show a JSON 404)', async () => {
    assemble.mockResolvedValue(null);
    const res = await request(app()).get('/mcp-facade/reel/nope.svg');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Waiting for the first hop');
  });

  test('ledger feature off → 200 frame that says so', async () => {
    configStore.getEffective.mockReturnValue('false');
    const res = await request(app()).get('/mcp-facade/reel/cid-svg.svg');
    expect(res.status).toBe(200);
    expect(res.text).toContain('ff_transaction_ledger');
    expect(assemble).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/routes/mcpFacade.test.js --forceExit`
Expected: the three new tests FAIL with status 404 (Express falls through to the `/:door/...` param handler, which 404s on the unknown door `reel`); the existing tests still pass.

- [ ] **Step 3: Add the route**

Requires (next to the `privilegeMcpClient` require):

```js
const { assemble } = require('../services/transactionAssembler');
const configStore = require('../services/configStore');
const { renderReelSvg } = require('../services/reelSvg');
```

Route — place it ABOVE `router.param('door', …)`'s consumers, i.e. directly above `router.get('/:door/mcp', …)`. Because `/reel/...` would otherwise match `/:door/...`, the reel route must be registered before any `/:door/*` GET (Express matches in registration order; `router.param` only runs for routes whose pattern names `:door`, and `/reel/:correlationId.svg` does not).

```js
// GET /mcp-facade/reel/:correlationId.svg — the image the tool result embeds.
// No auth (the id is the capability, same as /api/transaction-trace/embed).
// Always answers with an SVG: an <img> cannot show a JSON error.
router.get('/reel/:correlationId.svg', async (req, res) => {
  res.set('Content-Type', renderReelSvg.CONTENT_TYPE);
  res.set('Cache-Control', 'no-store');
  if (configStore.getEffective('ff_transaction_ledger') === 'false') {
    return res.send(renderReelSvg(null, { title: 'Transaction trace — recording is off (ff_transaction_ledger)' })
      .replace('Waiting for the first hop…', 'Enable ff_transaction_ledger on the Feature Flags page to record.'));
  }
  let record = null;
  try {
    record = await assemble(req.params.correlationId);
  } catch (err) {
    console.warn('[mcpFacade] reel svg read failed:', err?.message);
  }
  return res.send(renderReelSvg(record));
});
```

Note on `.svg` in the param: Express 4's path-to-regexp treats `:correlationId.svg` as the param followed by a literal `.svg` — the param excludes the dot. Verified by the tests (`req.params.correlationId === 'cid-svg'`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/routes/mcpFacade.test.js tests/services/reelSvg.test.js --forceExit`
Expected: PASS — 14 + 5 tests

- [ ] **Step 5: Commit**

```bash
git add demo_api_server/routes/mcpFacade.js demo_api_server/tests/routes/mcpFacade.test.js
git commit -m "feat(mcp-facade): GET /mcp-facade/reel/:cid.svg — the reel as an image"
```

---

### Task 3: Render check in LM Studio (decision gate — no code)

**Files:** none. This is the spec's open risk: does LM Studio's chat render a remote `http://localhost` image the model puts in its reply?

- [ ] **Step 1: Serve the branch in the live stack**

Run from the worktree: `npm run serve:worktree here` — then `docker restart ai-demo-api-server` is NOT needed (serve:worktree recreates the BFF). Confirm: `curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3002/mcp-facade/reel/anything.svg` → `200`.

- [ ] **Step 2: Get a real correlation id**

In LM Studio (`mcp/agent-gateway` on), ask "whats my checking balance". Copy the id from the `reel_url:` line of the tool result (View details), e.g. `5e7cf5d7-…`. Check `http://localhost:3002/mcp-facade/reel/<id>.svg` opens in a browser and shows the hops.

- [ ] **Step 3: Ask the model to render the image**

Send in the same chat: `Reply with exactly this Markdown and nothing else: ![Transaction trace](http://localhost:3002/mcp-facade/reel/<id>.svg)`

Record the outcome in this file, replacing the line below:

`RESULT: <renders inline | shows alt text only | shows raw markdown> — LM Studio <version>, model <name>, 2026-08-__`

- [ ] **Step 4: Decide**

- Renders inline → continue with Task 4.
- Alt text only / raw Markdown → STOP. LM Studio does not load remote images from chat; the SVG route is still useful (the `reel_url` page can link to it), but Task 4's image line would just be noise. Commit the RESULT line, open the PR with Tasks 1–2 only, and note the finding in `docs/superpowers/specs/2026-08-24-lmstudio-mcp-client-design.md` §4.

- [ ] **Step 5: Hand the stack back**

`npm run serve:worktree main`

---

### Task 4: Image line in the tool-result block

**Files:**
- Modify: `demo_api_server/routes/mcpFacade.js` — the `parsed.result.content.push({ type: 'text', text: … })` block (~line 284, the block that starts with `` `reel_url: ${reelUrl}\n` ``)
- Modify: `demo_api_server/tests/routes/mcpFacade.test.js` — the assertion `expect(content[1].text).toMatch(/Always show this link to the user/)`
- Modify: `lmstudio/README.md` — the fenced `reel_url:` example

**Interfaces:**
- Consumes: the reel URL already computed as `reelUrl` (`${reelBase()}/transaction-trace/embed/${correlationId}`) and the façade base already computed by `facadeBase(req)` (`${req.protocol}://${req.get('host')}/mcp-facade/${req.params.door}`).
- Produces: a third line in the block: `![Transaction trace](<facade-origin>/mcp-facade/reel/<cid>.svg)` where `<facade-origin>` is `req.protocol://req.get('host')` — the origin the client already reached the façade on, so LM Studio (`http://localhost:3002`) gets a plain-HTTP image URL and LibreChat (`https://api.ping.demo:3001`) gets one its container can reach.

- [ ] **Step 1: Extend the failing test** — replace the single `Always show this link` assertion with:

```js
    const [first, hint, image] = content[1].text.split('\n');
    expect(first).toMatch(/^reel_url: https:\/\/ui\.example\/transaction-trace\/embed\/[0-9a-f-]{36}$/);
    expect(hint).toMatch(/Always show this link to the user/);
    expect(image).toMatch(/^!\[Transaction trace\]\(http:\/\/127\.0\.0\.1:\d+\/mcp-facade\/reel\/[0-9a-f-]{36}\.svg\)$/);
    expect(image).toContain(cid);
```

(`cid` is already derived two lines above from `content[1].text.split('\n')[0]`.)

- [ ] **Step 2: Run to verify it fails**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/routes/mcpFacade.test.js --forceExit`
Expected: FAIL — `image` is `undefined`

- [ ] **Step 3: Add the line**

Change the pushed block to:

```js
    const reelImage = `${req.protocol}://${req.get('host')}/mcp-facade/reel/${correlationId}.svg`;
    parsed.result.content.push({
      type: 'text',
      text: `reel_url: ${reelUrl}\n`
        + 'Transaction trace ("movie reel") for this tool call: who called, the gateway\'s '
        + 'authorization decision, the MCP request and response. Always show this link to the '
        + 'user as a clickable link so they can open it — it is part of the answer, not debug output.\n'
        + `![Transaction trace](${reelImage})`,
    });
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/routes/mcpFacade.test.js --forceExit`
Expected: PASS

- [ ] **Step 5: README** — in `lmstudio/README.md`, change the fenced example to three lines:

```text
reel_url: https://localhost:4000/transaction-trace/embed/<correlationId>
Transaction trace ("movie reel") for this tool call: … Always show this link to the user …
![Transaction trace](http://localhost:3002/mcp-facade/reel/<correlationId>.svg)
```

and add after the fence: `The image is rendered on request from the ledger, so it fills in as the hops land (the gateway's own decision arrives a beat after the tool result).`

- [ ] **Step 6: Commit**

```bash
git add demo_api_server/routes/mcpFacade.js demo_api_server/tests/routes/mcpFacade.test.js lmstudio/README.md
git commit -m "feat(mcp-facade): embed the reel as a Markdown image in every tool result"
```

---

### Task 5: Live verification, PR, deploy

**Files:** none new.

- [ ] **Step 1: Scoped tests + hygiene**

Run: `cd demo_api_server && CI=true ./node_modules/.bin/jest tests/routes/mcpFacade.test.js tests/services/reelSvg.test.js --forceExit` → PASS. Run from the worktree root: `npm run hygiene:check` → `RESULT pass=… fail=0`.

- [ ] **Step 2: Live** — `npm run serve:worktree here`; in LM Studio ask "whats my checking balance"; expected: the reply shows the balance, the "Transaction trace" link, and the filmstrip image inline. Screenshot it. Then `curl -s http://localhost:3002/mcp-facade/reel/<cid>.svg | head -c 200` shows `<svg`. Hand back: `npm run serve:worktree main`.

- [ ] **Step 3: Push + PR** (`gh pr create`, body = summary + the screenshot description + test lines; one `gh pr checks <n> --watch`).

- [ ] **Step 4: After merge** — `git -C /Users/cmuir/Development/AI-DEMO2 pull --ff-only origin main` (sync script backs off on the untracked `.vscode/mcp.json`), `docker restart ai-demo-api-server` (bind-mounted, code only), then `scripts/deploy-live.sh <prev-stamp> <merge-sha>` from a worktree cwd for the stamp. Update the memory note `project-mcp-facade-reel-2026-08-24`.

---

## Self-review

- Spec coverage: §4 "static image snapshot" → Tasks 1, 2, 4; §4's "no confirmed path to an embedded reel" risk → Task 3 gate; §5.3 "link first, evaluate the image upgrade after" → the link line stays, the image is additive.
- Placeholders: Task 3 has a RESULT line to fill — deliberate, it is the measurement.
- Type consistency: `renderReelSvg(record, opts)` and `renderReelSvg.CONTENT_TYPE` used identically in Tasks 1–2; `reelUrl`, `facadeBase`, `correlationId` names match `routes/mcpFacade.js` as merged in PRs #2356/#2361/#2362.
