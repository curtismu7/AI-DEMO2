# CI Build-and-Push to GHCR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a merge to main build and push immutable `sha-<commit>` images to GHCR for every service whose source changed, and give `se-update-code.sh` a `--promote <sha>` that retags and rolls in seconds.

**Architecture:** `se-update-code.sh` becomes the single authority for the service map — its four existing name lookups plus a new `source_dir()` — exposed as JSON via `--print-map`. A CI job on `push: main` path-filters the merge, joins against that map, and builds a matrix of images on native arm64 runners. CI never writes `:latest` and holds no cluster credentials; promotion stays a deliberate human command.

**Tech Stack:** Bash 3.2 (macOS-compatible, no `declare -A`), Node 22 CommonJS with `node --test`, GitHub Actions, `docker compose build` (Compose owns each service's build context and dockerfile path), `docker buildx imagetools` for registry-side retagging.

**Spec:** [docs/superpowers/specs/2026-08-28-ci-build-push-images-design.md](../specs/2026-08-28-ci-build-push-images-design.md)

## Global Constraints

- **Worktree only.** A hard-block hook denies `Write`/`Edit` in the main checkout. Stage explicitly with `git add <paths>`, never `git add -A`.
- **`se-update-code.sh` is Bash 3.2 compatible** — no `declare -A`, no associative arrays. Every map is a `case` statement. Follow the existing four.
- **`--print-map` must run with no `.env`, no Docker, and no cluster access.** It must short-circuit *before* line ~150's `NS="$(derive_ns)"`, which calls `die` when `PING_EMAIL` and `demo_api_server/.env` are both absent — exactly the CI runner's situation.
- **`--print-map` emits image NAMES, not full URIs.** CI composes the registry prefix from `github.repository_owner`, so the command needs no `GITHUB_OWNER` detection.
- **CI never writes `:latest`** and the workflow holds no kubectl credentials.
- **Every `ALL_KEYS` key must resolve in all five lookups.** `llm` was missing from `ALL_KEYS` for one PR (#2495 → #2505); `agent-service` was missing before it. Task 2 makes that a gate.
- **Node hygiene scripts take no dependencies** — root `node_modules` is not installed in CI's hygiene job. Parse with `fs` + string/regex, like `check-compose-services-registered.js`.
- **Never conclude from a piped command's exit status** — `cmd | tail` reports `tail`'s status. Redirect to a file and read it, or check `${PIPESTATUS[0]}`.
- **Emoji allowlist:** `⚠️` `✅` `❌` `🔐` `✕` `✓` `👤` `🔑` `🪟` `📚` only.

---

## File Structure

**Create**
| File | Responsibility |
|---|---|
| `scripts/ci-build-matrix.js` | Join changed paths against `--print-map`; emit the GH Actions matrix. |
| `scripts/ci-build-matrix.test.js` | `node --test` unit tests for the join. |
| `scripts/check-service-map-complete.js` | Hygiene gate: five-lookup completeness + `serverInventory` cross-check. |
| `scripts/check-service-map-complete.test.js` | `node --test` tests for the gate itself. |

**Modify**
| File | Change |
|---|---|
| `se-update-code.sh` | Add `source_dir()`, `--print-map`, `--promote`. |
| `package.json:11` | Add the new check to `hygiene:check`. |
| `.github/workflows/ci.yml` | Add the `build-images` job. |

---

## Task 1: `source_dir()` and `--print-map`

The map CI consumes. Ships value alone — `--print-map` is a useful inventory command regardless of CI.

**Files:**
- Modify: `se-update-code.sh` (add `source_dir()` after `k8s_dep()` ~line 122; add the `--print-map` branch after `ALL_KEYS` ~line 128)

**Interfaces:**
- Produces: `./se-update-code.sh --print-map` writes a JSON array to stdout and exits 0. Each element is
  `{ "key": string, "sourceDir": string, "composeService": string, "ghcrImage": string, "localImage": string, "k8sDeployment": string }`,
  one per `ALL_KEYS` key, in `ALL_KEYS` order.

- [ ] **Step 1: Add the `source_dir()` map**

In `se-update-code.sh`, immediately after the closing `}` of `k8s_dep()` (~line 122), add. The values come from the header comment at the top of this same file, which already documents each service's directory:

```bash
# Source directory per service, for CI's path filter. A fifth map rather than a
# join against data/serverInventory.js because that join fails for exactly one
# service — the BFF is `demo-api-server` to Compose but `api-server` to
# serverInventory. A join that works for 13 of 14 and silently drops the most
# important one is worse than no join. check-service-map-complete.js
# cross-checks these values against serverInventory so the two cannot drift.
source_dir() {
  case "$1" in
    bff)      echo "demo_api_server" ;;
    frontend) echo "demo_api_ui" ;;
    mcp)      echo "oauth-mcp" ;;
    gateway)  echo "demo_mcp_gateway" ;;
    agent)    echo "langchain_agent" ;;
    agentsvc) echo "demo_agent_service" ;;
    authz)    echo "demo_authz_server" ;;
    mastra)   echo "mastra_agent" ;;
    openai)   echo "openai_agent" ;;
    pydantic) echo "pydantic_agent" ;;
    hitl)     echo "demo_hitl_service" ;;
    invest)   echo "demo_mcp_resource_server" ;;
    mortgage) echo "demo_api_resource_server" ;;
    llm)      echo "demo_llm_proxy" ;;
    *)        echo "" ;;
  esac
}
```

- [ ] **Step 2: Add the `--print-map` branch**

Immediately after the `ALL_KEYS="..."` line (~line 128) and **before** the `GITHUB_OWNER` block. Placement is load-bearing: `derive_ns()` at ~line 150 calls `die` without `PING_EMAIL` or `demo_api_server/.env`, and a CI runner has neither.

```bash
# --print-map: emit the service map as JSON and exit. Must run BEFORE the
# GITHUB_OWNER and derive_ns() blocks below — CI has no .env, and derive_ns
# dies without one. Emits image NAMES, not URIs; the caller owns the registry
# prefix, so this command needs no GitHub owner and no network.
if [[ "${1:-}" == "--print-map" ]]; then
  printf '['
  sep=""
  for key in $ALL_KEYS; do
    printf '%s{"key":"%s","sourceDir":"%s","composeService":"%s","ghcrImage":"%s","localImage":"%s","k8sDeployment":"%s"}' \
      "$sep" "$key" "$(source_dir "$key")" "$(compose_svc "$key")" \
      "$(ghcr_img "$key")" "$(local_img "$key")" "$(k8s_dep "$key")"
    sep=","
  done
  printf ']\n'
  exit 0
fi
```

- [ ] **Step 3: Verify it runs without any environment**

```bash
cd /absolute/path/to/worktree
env -u PING_EMAIL -u SE_NAMESPACE ./se-update-code.sh --print-map > /tmp/map.json
echo "exit: $?"
node -e "const m=require('/tmp/map.json'); console.log('entries:', m.length); console.log(JSON.stringify(m.find(e=>e.key==='bff')));"
```

Expected: exit 0, `entries: 14`, and the bff record reading
`{"key":"bff","sourceDir":"demo_api_server","composeService":"demo-api-server","ghcrImage":"ai-demo-demo-api-server","localImage":"ai-demo-se-demo-api-server","k8sDeployment":"demo-api-server"}`.

`env -u` matters: it proves the command works in CI's environment, not just yours.

- [ ] **Step 4: Verify every key resolves in every field**

```bash
node -e "
const m = require('/tmp/map.json');
const bad = m.filter(e => Object.values(e).some(v => !v));
console.log(bad.length === 0 ? 'all 6 fields populated for all keys' : 'EMPTY FIELDS: ' + JSON.stringify(bad));
process.exit(bad.length ? 1 : 0);
"
```

Expected: `all 6 fields populated for all keys`, exit 0. Task 2 turns this into a permanent gate.

- [ ] **Step 5: Commit**

```bash
git add se-update-code.sh
git commit -m "feat(se-deploy): source_dir map and --print-map JSON output

CI needs path -> image. The four existing lookups give the names; source_dir
adds the path, beside them rather than joined from serverInventory — that
join fails for exactly one service (BFF: demo-api-server vs api-server) and
silently dropping the most-used service is worse than no join.

--print-map short-circuits before derive_ns(), which dies without a .env,
because the CI runner has none. It emits image names rather than URIs so it
needs no GITHUB_OWNER and no network."
```

---

## Task 2: The completeness gate

Makes the `ALL_KEYS` omission class impossible. `llm` was missing for one PR; `agent-service` before it. Twice is a pattern.

**Files:**
- Create: `scripts/check-service-map-complete.js`
- Create: `scripts/check-service-map-complete.test.js`
- Modify: `package.json:11` (`hygiene:check`)

**Interfaces:**
- Consumes: `./se-update-code.sh --print-map` (Task 1).
- Produces: `main()` returning `0` on pass, `1` on failure; `module.exports = { main }`. Same shape as `scripts/check-llm-host-residency.js`.

- [ ] **Step 1: Write the failing test**

Create `scripts/check-service-map-complete.test.js`:

```js
'use strict';

/**
 * The gate exists because a key present in four maps and missing from the
 * fifth is invisible: `se-update-code.sh <key>` works while the build-all and
 * roll-all loops silently skip it. That shipped twice — agent-service, then
 * llm (#2495 fixed in #2505).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { checkMap } = require('./check-service-map-complete');

const GOOD = [
  { key: 'bff', sourceDir: 'demo_api_server', composeService: 'demo-api-server',
    ghcrImage: 'ai-demo-demo-api-server', localImage: 'ai-demo-se-demo-api-server',
    k8sDeployment: 'demo-api-server' },
];
const INVENTORY = { demo_api_server: 'api-server' };

test('passes a complete map', () => {
  assert.deepStrictEqual(checkMap(GOOD, INVENTORY), []);
});

test('fails a key with an empty field — the ALL_KEYS omission class', () => {
  const bad = [{ ...GOOD[0], k8sDeployment: '' }];
  const errs = checkMap(bad, INVENTORY);
  assert.strictEqual(errs.length, 1);
  assert.match(errs[0], /bff/);
  assert.match(errs[0], /k8sDeployment/);
});

test('fails a sourceDir that is not a real directory in the inventory', () => {
  const bad = [{ ...GOOD[0], sourceDir: 'demo_api_serverrr' }];
  const errs = checkMap(bad, INVENTORY);
  assert.strictEqual(errs.length, 1);
  assert.match(errs[0], /demo_api_serverrr/);
});

test('accepts the documented BFF naming mismatch without special-casing it away', () => {
  // serverInventory calls this directory's service `api-server`; Compose calls
  // it `demo-api-server`. The gate checks the DIRECTORY exists in the
  // inventory, never that the service names agree — that is the mismatch the
  // whole design routes around.
  assert.deepStrictEqual(checkMap(GOOD, INVENTORY), []);
});

test('reports every offending key, not just the first', () => {
  const bad = [
    { ...GOOD[0], key: 'a', ghcrImage: '' },
    { ...GOOD[0], key: 'b', sourceDir: '' },
  ];
  assert.strictEqual(checkMap(bad, INVENTORY).length, 2);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /absolute/path/to/worktree
node --test scripts/check-service-map-complete.test.js
```

Expected: FAIL — `Cannot find module './check-service-map-complete'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/check-service-map-complete.js`:

```js
#!/usr/bin/env node
// scripts/check-service-map-complete.js
'use strict';

/**
 * Static hygiene: every service key resolves in ALL FIVE lookups, and every
 * declared sourceDir is a directory data/serverInventory.js also knows about.
 *
 * Why this gate exists: a key present in four maps and missing from the fifth
 * is invisible. `se-update-code.sh <key>` keeps working while the build-all
 * and roll-all loops silently skip it — so the path you test is the one that
 * was never broken. That shipped twice: agent-service, then llm (#2495,
 * fixed #2505). The comment above ALL_KEYS documented the trap both times and
 * documentation did not stop it, so it becomes a check.
 *
 * Reads serverInventory.js as TEXT rather than require()ing it: root
 * node_modules is not installed in CI's hygiene job, and that module pulls in
 * the BFF's dependency graph. Same dependency-free approach as
 * check-compose-services-registered.js.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIELDS = ['key', 'sourceDir', 'composeService', 'ghcrImage', 'localImage', 'k8sDeployment'];

/** sourceDir -> service key, parsed from data/serverInventory.js source text. */
function readInventory() {
  const src = fs.readFileSync(
    path.join(ROOT, 'demo_api_server', 'data', 'serverInventory.js'), 'utf8',
  );
  const out = {};
  // Entries are object literals carrying both fields; pair them per entry so a
  // key from one entry cannot bind to a sourceDir from another.
  for (const block of src.split('{').slice(1)) {
    const key = block.match(/key:\s*'([^']+)'/);
    const dir = block.match(/sourceDir:\s*'([^']+)'/);
    if (key && dir) out[dir[1]] = key[1];
  }
  return out;
}

/**
 * @param {object[]} map entries from `se-update-code.sh --print-map`
 * @param {Record<string,string>} inventory sourceDir -> serverInventory key
 * @returns {string[]} one message per problem; empty means pass
 */
function checkMap(map, inventory) {
  const errors = [];
  for (const entry of map) {
    for (const field of FIELDS) {
      if (!entry[field]) {
        errors.push(
          `service "${entry.key || '(unnamed)'}" has an empty ${field} — ` +
          'a key missing from one lookup is silently skipped by build-all and roll-all',
        );
      }
    }
    if (entry.sourceDir && !inventory[entry.sourceDir]) {
      errors.push(
        `service "${entry.key}" declares sourceDir "${entry.sourceDir}", which ` +
        'data/serverInventory.js does not list — one of the two has drifted',
      );
    }
  }
  return errors;
}

function main() {
  const raw = execFileSync(path.join(ROOT, 'se-update-code.sh'), ['--print-map'], {
    encoding: 'utf8',
    env: { ...process.env, PING_EMAIL: '', SE_NAMESPACE: '' },
  });
  const map = JSON.parse(raw);
  if (map.length === 0) {
    console.error('[service-map] FAIL — --print-map returned no services; parser or ALL_KEYS is broken');
    return 1;
  }
  const errors = checkMap(map, readInventory());
  if (errors.length) {
    for (const e of errors) console.error('[service-map] FAIL —', e);
    return 1;
  }
  console.log(`[service-map] OK — ${map.length} services, all five lookups resolve, sourceDirs match serverInventory`);
  return 0;
}

if (require.main === module) {
  process.exit(main());
}

module.exports = { main, checkMap, readInventory };
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test scripts/check-service-map-complete.test.js
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Run the gate against the real map**

```bash
node scripts/check-service-map-complete.js
echo "exit: $?"
```

Expected: `[service-map] OK — 14 services, all five lookups resolve, sourceDirs match serverInventory`, exit 0.

- [ ] **Step 6: Prove the gate actually catches the bug it exists for**

Temporarily remove `llm` from `ALL_KEYS` in `se-update-code.sh`, then:

```bash
node scripts/check-service-map-complete.js; echo "exit: $?"
```

Expected: the count drops to 13 and the run still passes — **which is the gate's real limitation, and you must see it.** The gate catches a key present in `ALL_KEYS` but missing from a lookup; it cannot catch a key deleted from `ALL_KEYS` entirely, because `ALL_KEYS` *is* its iteration source.

Now do the inverse — restore `ALL_KEYS` and instead delete the `llm)` line from `k8s_dep()`:

```bash
node scripts/check-service-map-complete.js; echo "exit: $?"
```

Expected: FAIL naming `llm` and `k8sDeployment`, exit 1. Restore the line.

Record both outcomes in your report. The second is what the gate guarantees; the first is what it does not, and pretending otherwise is how a gate becomes decoration.

- [ ] **Step 7: Wire it into hygiene:check**

In `package.json:11`, insert immediately after `node scripts/check-compose-services-registered.js &&`:

```
node scripts/check-service-map-complete.js && node --test scripts/check-service-map-complete.test.js &&
```

- [ ] **Step 8: Run the full hygiene gate**

```bash
npm run hygiene:check > /tmp/hyg.txt 2>&1; echo "exit: $?"; tail -3 /tmp/hyg.txt
```

Expected: exit 0, `RESULT pass=28 fail=0` or higher.

- [ ] **Step 9: Commit**

```bash
git add scripts/check-service-map-complete.js scripts/check-service-map-complete.test.js package.json
git commit -m "feat(hygiene): gate that every service key resolves in all five lookups

A key present in four maps and missing from the fifth is invisible:
se-update-code.sh <key> works while build-all and roll-all silently skip it.
Shipped twice — agent-service, then llm (#2495, fixed #2505). The comment
above ALL_KEYS documented the trap both times; documentation did not stop it.

Also cross-checks each source_dir against data/serverInventory.js so the
fifth map cannot drift from the inventory the Servers page already reads."
```

---

## Task 3: The matrix script

Pure function over inputs: no network, no git, no Docker. That is what makes it testable before the workflow that calls it exists.

**Files:**
- Create: `scripts/ci-build-matrix.js`
- Create: `scripts/ci-build-matrix.test.js`

**Interfaces:**
- Consumes: the `--print-map` JSON shape (Task 1).
- Produces: `buildMatrix(map, changedPaths)` → `{ include: [{ key, ghcrImage, composeService, localImage, context }] }`, deduped, in `ALL_KEYS` order. `context` equals `sourceDir` and is used for logging only — the build itself goes through Compose, which owns the real context and dockerfile paths.

- [ ] **Step 1: Write the failing test**

Create `scripts/ci-build-matrix.test.js`:

```js
'use strict';

/**
 * The join CI depends on. Tested exhaustively here because the workflow that
 * calls it cannot be tested until it is merged — GitHub runs the pushed
 * workflow, so the first real run is the merge itself.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { buildMatrix } = require('./ci-build-matrix');

const MAP = [
  { key: 'bff', sourceDir: 'demo_api_server', composeService: 'demo-api-server',
    ghcrImage: 'ai-demo-demo-api-server', localImage: 'x', k8sDeployment: 'demo-api-server' },
  { key: 'frontend', sourceDir: 'demo_api_ui', composeService: 'ui',
    ghcrImage: 'ai-demo-frontend', localImage: 'x', k8sDeployment: 'frontend' },
  { key: 'llm', sourceDir: 'demo_llm_proxy', composeService: 'llm-proxy',
    ghcrImage: 'ai-demo-llm-proxy', localImage: 'x', k8sDeployment: 'llm-proxy' },
];

test('selects the one service whose directory changed', () => {
  const m = buildMatrix(MAP, ['demo_llm_proxy/router.js']);
  assert.deepStrictEqual(m.include.map((e) => e.key), ['llm']);
});

test('maps the UI to ai-demo-frontend, not ai-demo-ui', () => {
  // The irregular name. A prefix rule over composeService would produce
  // "ai-demo-ui", which does not exist in GHCR — the image would build and
  // push under a name nothing pulls.
  const m = buildMatrix(MAP, ['demo_api_ui/src/App.js']);
  assert.strictEqual(m.include[0].ghcrImage, 'ai-demo-frontend');
  assert.strictEqual(m.include[0].composeService, 'ui');
  assert.strictEqual(m.include[0].context, 'demo_api_ui');
});

test('selects several services when the change spans them', () => {
  const m = buildMatrix(MAP, ['demo_api_server/server.js', 'demo_api_ui/src/App.js']);
  assert.deepStrictEqual(m.include.map((e) => e.key), ['bff', 'frontend']);
});

test('lists a service once however many of its files changed', () => {
  const m = buildMatrix(MAP, [
    'demo_api_server/server.js',
    'demo_api_server/routes/a.js',
    'demo_api_server/routes/b.js',
  ]);
  assert.strictEqual(m.include.length, 1);
});

test('returns an empty matrix when no service owns the changed paths', () => {
  // Docs and specs must not trigger a 14-image build.
  const m = buildMatrix(MAP, ['README.md', 'docs/superpowers/specs/x.md']);
  assert.deepStrictEqual(m.include, []);
});

test('does not match a directory that merely shares a prefix', () => {
  // demo_api_server must not claim demo_api_server_extra/.
  const m = buildMatrix(MAP, ['demo_api_server_extra/file.js']);
  assert.deepStrictEqual(m.include, []);
});

test('ignores an exact-name file that is not inside the directory', () => {
  const m = buildMatrix(MAP, ['demo_api_server']);
  assert.deepStrictEqual(m.include, []);
});

test('preserves ALL_KEYS order regardless of changed-path order', () => {
  const m = buildMatrix(MAP, ['demo_llm_proxy/a.js', 'demo_api_server/b.js']);
  assert.deepStrictEqual(m.include.map((e) => e.key), ['bff', 'llm']);
});

test('treats an empty changed-path list as build nothing', () => {
  // An unresolvable base resolves to no paths. Building nothing is recoverable
  // by hand; a surprise 14-image build on a force-push is not what anyone asked
  // for.
  assert.deepStrictEqual(buildMatrix(MAP, []).include, []);
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
node --test scripts/ci-build-matrix.test.js
```

Expected: FAIL — `Cannot find module './ci-build-matrix'`.

- [ ] **Step 3: Write the implementation**

Create `scripts/ci-build-matrix.js`:

```js
#!/usr/bin/env node
// scripts/ci-build-matrix.js
'use strict';

/**
 * Join a merge's changed paths against the service map and emit a GitHub
 * Actions matrix of images to build.
 *
 * Pure with respect to its inputs — no network, no git, no Docker — because
 * the workflow that calls it cannot be tested until it is merged. Everything
 * that is not YAML is therefore tested here.
 *
 * Usage (in CI):
 *   ./se-update-code.sh --print-map > map.json
 *   node scripts/ci-build-matrix.js map.json changed.txt >> "$GITHUB_OUTPUT"
 */

const fs = require('fs');

/**
 * @param {object[]} map from `se-update-code.sh --print-map`
 * @param {string[]} changedPaths repo-relative paths changed by the merge
 * @returns {{include: {key:string, ghcrImage:string, composeService:string, context:string}[]}}
 */
function buildMatrix(map, changedPaths) {
  const include = [];
  for (const entry of map) {
    if (!entry.sourceDir) continue;
    // The trailing slash is the whole guard: without it "demo_api_server"
    // also claims "demo_api_server_extra/file.js".
    const prefix = `${entry.sourceDir}/`;
    const touched = changedPaths.some((p) => p.startsWith(prefix));
    if (!touched) continue;
    include.push({
      key: entry.key,
      ghcrImage: entry.ghcrImage,
      composeService: entry.composeService,
      // The build runs through docker compose, which owns the real build
      // context and dockerfile path — those vary per service and are NOT
      // derivable from sourceDir (the BFF builds from the repo root).
      localImage: entry.localImage,
      context: entry.sourceDir,
    });
  }
  return { include };
}

function main(argv) {
  const [mapFile, changedFile] = argv;
  const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'));
  const changedPaths = fs.readFileSync(changedFile, 'utf8')
    .split('\n').map((l) => l.trim()).filter(Boolean);
  const matrix = buildMatrix(map, changedPaths);
  console.log(`matrix=${JSON.stringify(matrix)}`);
  console.log(`any=${matrix.include.length > 0}`);
  console.error(
    matrix.include.length
      ? `[ci-build-matrix] building: ${matrix.include.map((e) => e.key).join(', ')}`
      : '[ci-build-matrix] no service source changed — building nothing',
  );
  return 0;
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)));
}

module.exports = { buildMatrix, main };
```

- [ ] **Step 4: Run to verify they pass**

```bash
node --test scripts/ci-build-matrix.test.js
```

Expected: PASS, 9 tests.

- [ ] **Step 5: Verify against the real map end to end**

```bash
./se-update-code.sh --print-map > /tmp/map.json
printf 'demo_llm_proxy/router.js\ndocs/readme.md\n' > /tmp/changed.txt
node scripts/ci-build-matrix.js /tmp/map.json /tmp/changed.txt
```

Expected on stdout: `matrix={"include":[{"key":"llm","ghcrImage":"ai-demo-llm-proxy","composeService":"llm-proxy","context":"demo_llm_proxy"}]}` and `any=true`; on stderr `building: llm`.

- [ ] **Step 6: Commit**

```bash
git add scripts/ci-build-matrix.js scripts/ci-build-matrix.test.js
git commit -m "feat(ci): matrix builder joining changed paths to GHCR images

Pure over its inputs so it is testable before the workflow that calls it
exists — a workflow change cannot be verified until it merges, so everything
that is not YAML is tested here.

Pins the irregular join (demo_api_ui -> ai-demo-frontend, not ai-demo-ui),
prefix-collision safety, and empty-input meaning build nothing."
```

---

## Task 4: The workflow job

**Files:**
- Modify: `.github/workflows/ci.yml` (append a job at the end)

**Interfaces:**
- Consumes: `scripts/ci-build-matrix.js` (Task 3), `./se-update-code.sh --print-map` (Task 1).

- [ ] **Step 1: Add the job**

Append to `.github/workflows/ci.yml`. Note `if: github.event_name == 'push'` — this must not run on pull requests, where the merge commit does not exist yet:

```yaml
  build-images:
    name: Build and push service images
    # Merges only. On a PR there is no merged commit to tag, and CI must not
    # push images for code that may never land.
    if: github.event_name == 'push'
    runs-on: ubuntu-24.04-arm
    permissions:
      contents: read
      packages: write
    outputs:
      any: ${{ steps.matrix.outputs.any }}
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Collect changed paths
        id: changed
        run: |
          # github.event.before is all-zeroes for a force-push or a first push.
          # Build nothing rather than everything: a missed build is recoverable
          # by hand, a surprise 14-image build is noise nobody asked for.
          BEFORE="${{ github.event.before }}"
          if [ -z "$BEFORE" ] || [ "$BEFORE" = "0000000000000000000000000000000000000000" ] \
             || ! git cat-file -e "$BEFORE^{commit}" 2>/dev/null; then
            echo "[changed] unresolvable base '$BEFORE' — building nothing" >&2
            : > changed.txt
          else
            git diff --name-only "$BEFORE" "${{ github.sha }}" > changed.txt
          fi
          wc -l < changed.txt

      - name: Compute build matrix
        id: matrix
        run: |
          ./se-update-code.sh --print-map > map.json
          node scripts/ci-build-matrix.js map.json changed.txt >> "$GITHUB_OUTPUT"

  push-image:
    name: ${{ matrix.key }}
    needs: build-images
    if: needs.build-images.outputs.any == 'true'
    runs-on: ubuntu-24.04-arm
    permissions:
      contents: read
      packages: write
    strategy:
      fail-fast: false
      matrix: ${{ fromJSON(needs.build-images.outputs.matrix) }}
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build via compose, then push the sha tag
        # Build through docker compose, NOT a bare buildx with an assumed
        # context. Build contexts vary and cannot be derived from sourceDir:
        # demo-api-server uses `context: .` (the repo root, because the BFF
        # references scope-topology.json and docs/) with
        # `dockerfile: demo_api_server/Dockerfile`, while llm-proxy uses
        # `context: ./demo_llm_proxy` with `dockerfile: Dockerfile`. Encoding
        # those in the service map would be a sixth and seventh copy of what
        # docker-compose.yml already owns. Compose knows them; use Compose.
        #
        # --profile demo-auth: authz-server and mcp-gateway sit behind that
        # profile and are silently skipped without it — the same trap
        # se-update-code.sh documents in build_and_push().
        #
        # -p ai-demo-se matches SE_COMPOSE_PROJECT so the local tag equals the
        # map's localImage, including llm-proxy's explicit `image:` override.
        #
        # NEVER :latest. Every SE deployment is imagePullPolicy: Always, so a
        # moving :latest means the next restart of any pod — a crash, an
        # eviction, a drain — silently pulls whatever was last merged. An
        # immutable sha tag is inert until a human promotes it.
        run: |
          set -euo pipefail
          URI="ghcr.io/${{ github.repository_owner }}/${{ matrix.ghcrImage }}:sha-${{ github.sha }}"
          docker compose -p ai-demo-se -f docker-compose.yml --profile demo-auth \
            build "${{ matrix.composeService }}"
          docker tag "${{ matrix.localImage }}:latest" "$URI"
          docker push "$URI"
```

- [ ] **Step 2: Add the matrix output to the first job**

The `build-images` job above declares only `any` in `outputs`. Add `matrix` beside it so `push-image` can consume it:

```yaml
    outputs:
      any: ${{ steps.matrix.outputs.any }}
      matrix: ${{ steps.matrix.outputs.matrix }}
```

- [ ] **Step 3: Validate the YAML parses**

```bash
node -e "
const fs=require('fs');
const src=fs.readFileSync('.github/workflows/ci.yml','utf8');
for (const j of ['build-images:','push-image:']) {
  if (!src.includes(j)) { console.error('MISSING job', j); process.exit(1); }
}
console.log('both jobs present');
"
python3 -c "import sys;sys.exit(0)" && python3 - <<'PY'
import subprocess, sys
r = subprocess.run(['python3','-c','import yaml,sys;yaml.safe_load(open(".github/workflows/ci.yml"));print("YAML parses")'],
                   capture_output=True, text=True)
print(r.stdout or r.stderr)
sys.exit(0 if 'YAML parses' in r.stdout else 1)
PY
```

Expected: `both jobs present` and `YAML parses`. If PyYAML is absent the second block reports the import error — install it or validate with `gh workflow view` after pushing; do not skip validation silently.

- [ ] **Step 4: Confirm every composeService is buildable and its local tag matches the map**

The build step relies on two things Compose owns: that each `composeService` has a
`build:` section, and that building it under `-p ai-demo-se` produces exactly the
tag the map calls `localImage`. Verify both, without building:

```bash
docker compose -p ai-demo-se -f docker-compose.yml --profile demo-auth config --format json \
  > /tmp/cfg.json 2>/dev/null; echo "config exit: $?"
./se-update-code.sh --print-map > /tmp/map.json
node -e "
const cfg = require('/tmp/cfg.json').services;
const map = require('/tmp/map.json');
const problems = [];
for (const e of map) {
  const svc = cfg[e.composeService];
  if (!svc)        { problems.push(e.key + ': no compose service ' + e.composeService); continue; }
  if (!svc.build)  { problems.push(e.key + ': ' + e.composeService + ' has no build section'); continue; }
  const expected = e.localImage + ':latest';
  if (svc.image && svc.image !== expected) {
    problems.push(e.key + ': compose image ' + svc.image + ' != map localImage ' + expected);
  }
}
console.log(problems.length ? 'PROBLEMS:\n  ' + problems.join('\n  ')
                            : 'all ' + map.length + ' services build, local tags match the map');
process.exit(problems.length ? 1 : 0);
"
```

Expected: `all 14 services build, local tags match the map`.

If a service reports a tag mismatch, its `localImage` in `local_img()` is wrong for
the SE project — that is the same class as llm-proxy's explicit `image:` override,
already special-cased there. **Stop and report** rather than adjusting the workflow
to paper over it: `docker tag` on a name Compose never produced fails with
"No such image", which is how this surfaces at runtime.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "feat(ci): build and push sha-tagged images on merge to main

Closes the gap that caused both of 2026-08-27's SE incidents: k8s manifests
apply straight to the cluster while code needs a build and push, so a merged
llm-proxy liveness handler crash-looped SE for 8 hours with only half of it
deployed.

Never writes :latest. Every SE deployment is imagePullPolicy: Always, so a
moving tag is a deferred deploy with unpredictable timing. Runs on arm64
runners matching the cluster, and holds no cluster credentials."
```

---

## Task 5: `--promote`

**Files:**
- Modify: `se-update-code.sh` (add the `--promote` branch after `NS="$(derive_ns)"` ~line 150, before the build-input preflight)

**Interfaces:**
- Consumes: `ghcr_img` / `k8s_dep` / `ALL_KEYS`, and images pushed by Task 4.
- Produces: `./se-update-code.sh --promote <sha> [key...]` — retags `sha-<commit>` to `latest` registry-side and rolls the matching deployments.

- [ ] **Step 1: Verify `imagetools create` works against GHCR before building on it**

This is the linchpin of "promote is seconds, not minutes". Prove it with an image that already exists:

```bash
gh auth token | docker login ghcr.io -u "$(gh api user --jq .login)" --password-stdin
docker buildx imagetools inspect ghcr.io/curtismu7/ai-demo-llm-proxy:latest > /tmp/it.txt 2>&1
echo "exit: $?"; head -4 /tmp/it.txt
```

Expected: exit 0 and a manifest digest. If `imagetools` is unavailable or GHCR rejects it, **stop and report** — the whole promote design rests on registry-side retagging, and a `pull && tag && push` fallback would silently narrow a multi-arch manifest to one platform.

- [ ] **Step 2: Add the `--promote` branch**

Insert immediately after `NS="$(derive_ns)"` and `SERVICE="${1:-}"` (~line 151), before the build-input preflight:

```bash
# ── Promote a CI-built SHA to :latest and roll ───────────────────────────────
# CI pushes immutable sha-<commit> tags and never writes :latest, so nothing on
# SE moves until this runs. imagetools retags REGISTRY-SIDE: no pull, no
# rebuild, seconds instead of ~16 minutes, and it copies the manifest rather
# than re-resolving it — a pull/tag/push from an arm64 Mac would silently
# narrow a multi-arch image to one platform.
if [[ "$SERVICE" == "--promote" ]]; then
  SHA="${2:-}"
  [[ -n "$SHA" ]] || die "Usage: ./se-update-code.sh --promote <sha> [key...]"
  shift 2
  KEYS="${*:-$ALL_KEYS}"

  info "Logging in to GHCR..."
  gh auth token | docker login ghcr.io -u "$GITHUB_OWNER" --password-stdin \
    || die "GHCR login failed — run: gh auth login"

  promoted=""; skipped=""
  for key in $KEYS; do
    g_img="$(ghcr_img "$key")"
    [[ -n "$g_img" ]] || die "Unknown service '$key'. Valid: ${ALL_KEYS}"
    src="${REGISTRY}/${g_img}:sha-${SHA}"
    if ! docker buildx imagetools inspect "$src" >/dev/null 2>&1; then
      skipped="${skipped} ${key}"
      continue
    fi
    info "Promoting ${g_img} sha-${SHA} → latest"
    docker buildx imagetools create -t "${REGISTRY}/${g_img}:latest" "$src" \
      || die "Retag failed for ${g_img}"
    promoted="${promoted} ${key}"
  done

  # A silent no-op is the failure mode this guards against: two separate ones
  # cost hours on 2026-08-27 (the demo-flag reset, and restart keeping stale
  # layers), both invisible in a long log.
  [[ -n "$promoted" ]] || die "No image carries tag sha-${SHA} — did CI build this commit?"
  [[ -n "$skipped" ]] && warn "No sha-${SHA} image for:${skipped}"

  for key in $promoted; do
    dep="$(k8s_dep "$key")"
    info "Rolling deployment/${dep} in $NS..."
    kubectl rollout restart "deployment/${dep}" -n "$NS"
    kubectl rollout status  "deployment/${dep}" -n "$NS" --timeout=180s
  done
  success "Promoted sha-${SHA}:${promoted}"
  exit 0
fi
```

- [ ] **Step 3: Verify the usage guard and unknown-key guard**

```bash
./se-update-code.sh --promote; echo "exit: $?"
./se-update-code.sh --promote deadbeef notakey; echo "exit: $?"
```

Expected: the first prints the usage line and exits 1. The second logs in, then dies with `Unknown service 'notakey'` and exits 1. Neither may reach a rollout.

- [ ] **Step 4: Verify it refuses a SHA nothing carries**

```bash
./se-update-code.sh --promote 0000000000000000000000000000000000000000 llm > /tmp/promote.txt 2>&1
echo "exit: $?"; tail -3 /tmp/promote.txt
```

Expected: exit 1 with `No image carries tag sha-0000... — did CI build this commit?`, and **no rollout attempted**. Read the file — do not pipe and read the pipe's status.

- [ ] **Step 5: Verify `bash -n`**

```bash
bash -n se-update-code.sh; echo "syntax: $?"
```

Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add se-update-code.sh
git commit -m "feat(se-deploy): --promote <sha> retags a CI image and rolls

CI pushes immutable sha tags and never writes :latest, so promotion is the
one deliberate step that moves SE. imagetools retags registry-side — seconds
rather than a ~16 minute rebuild — and copies the manifest, so a multi-arch
image survives; a pull/tag/push from an arm64 Mac would narrow it silently.

Refuses a SHA no image carries rather than no-op'ing, and names the services
it skipped. Rollback is --promote <older-sha>."
```

---

## Task 6: Post-merge verification

A workflow change cannot be exercised until it merges — GitHub runs the pushed workflow. Everything above is testable beforehand; this is what remains, and it happens **after** the PR lands.

- [ ] **Step 1: Confirm the merge triggered the job**

```bash
gh run list --workflow=ci.yml --branch=main --limit 3
gh run view --job "$(gh run list --workflow=ci.yml --branch=main --limit 1 --json databaseId --jq '.[0].databaseId')" 2>&1 | head -30
```

Expected: a `Build and push service images` job. If the merge touched no service directory, it correctly builds nothing — confirm the log says `no service source changed`.

- [ ] **Step 2: Make a trivial one-service change and confirm exactly one image builds**

On a branch, add a comment line to `demo_llm_proxy/router.js`, open a PR, merge it, then:

```bash
gh run list --workflow=ci.yml --branch=main --limit 1
```

Expected: exactly one `push-image` matrix job, named `llm`.

- [ ] **Step 3: Confirm the SHA tag exists and `:latest` did NOT move**

```bash
SHA="$(git rev-parse origin/main)"
docker buildx imagetools inspect "ghcr.io/curtismu7/ai-demo-llm-proxy:sha-${SHA}" | head -3
echo "--- latest digest (must be UNCHANGED) ---"
docker buildx imagetools inspect ghcr.io/curtismu7/ai-demo-llm-proxy:latest | grep -i digest | head -1
```

Expected: the SHA tag resolves; `:latest` still points at whatever it did before the merge. **This is the property the whole design rests on** — if `:latest` moved, stop and report.

- [ ] **Step 4: Promote and confirm SE moves**

```bash
SHA="$(git rev-parse origin/main)"
./se-update-code.sh --promote "$SHA" llm > /tmp/promo.txt 2>&1
echo "exit: $?"; tail -5 /tmp/promo.txt
kubectl --context us get pods -n ping-devops-cmuir --no-headers | grep llm-proxy
```

Expected: exit 0, a new pod, `1/1 Running`, 0 restarts.

- [ ] **Step 5: Confirm the promoted code is actually running**

```bash
kubectl --context us exec -n ping-devops-cmuir deploy/demo-api-server -- \
  sh -c 'curl -s -o /dev/null -w "/livez -> %{http_code}\n" http://llm-proxy:8090/livez'
```

Expected: `200`. A green rollout is not evidence the new image serves traffic — today's `deployment "llm-proxy" successfully rolled out` was reported while the pod was still the old crash-looping one.

- [ ] **Step 6: Record the timing**

Note how long `--promote` took versus the ~16 minutes a rebuild costs. That number is the justification for the SHA-tag design; if promote is not dramatically faster, the design's premise is wrong and should be revisited.

---

## Self-Review

**Spec coverage** — every section maps to a task:

| Spec section | Task |
|---|---|
| §1 matrix, `--print-map`, `source_dir()` | 1 |
| §1 `ALL_KEYS` as iteration source | 1, 2 |
| §2 workflow, arm64, paths-filter, unresolvable base | 3 (base semantics), 4 |
| §2 never writes `:latest` | 4 (build step), 6 Step 3 (verified) |
| §3 `--promote`, imagetools, refuses missing SHA | 5 |
| §4 guardrail | 2 |
| §5 verification | 2 Step 6, 3, 5 Step 1, 6 |

**Placeholder scan** — one deliberate deviation from the spec, made while writing Task 4: the spec named `dorny/paths-filter`, but the job uses `git diff --name-only` against `github.event.before`. Reason: `paths-filter` returns booleans per named filter, which would require re-encoding all fourteen service directories in YAML — a fifteenth copy of the map, and exactly the drift this design exists to avoid. A raw diff feeds the map-driven script instead.

A second deviation, found while verifying Task 4: the spec's build step was `docker buildx build --push -t ... -f <context>/Dockerfile <context>`, which assumes a service's build context is its source directory. It is not. `demo-api-server` uses `context: .` (the repo root, because the BFF reads `scope-topology.json` and `docs/`) with `dockerfile: demo_api_server/Dockerfile`, while `llm-proxy` uses `context: ./demo_llm_proxy`. Encoding both per service would be a sixth and seventh copy of what `docker-compose.yml` already owns, so the build goes through `docker compose build` — the same path `se-update-code.sh` uses — and only the tag and push are done by hand. The spec has been corrected to match. No step defers work.

**Type consistency** — `--print-map`'s six fields are produced in Task 1 and consumed by name in Tasks 2 (`FIELDS`) and 3 (`buildMatrix`). `buildMatrix` returns `{include: [...]}` with `key` / `ghcrImage` / `composeService` / `context`, consumed by Task 4's `matrix.key`, `matrix.ghcrImage`, `matrix.context`. `checkMap(map, inventory)` and `buildMatrix(map, changedPaths)` are the only exported functions and both take the map first.

**One gap found and closed:** Task 4 assumes `<context>/Dockerfile`. Nothing in the spec establishes that, so Step 4 verifies it across all fourteen services and stops rather than guessing if it does not hold.
