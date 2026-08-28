# CI build-and-push to GHCR — design

**Date:** 2026-08-28
**Status:** approved, not yet implemented

## Why

Nothing in CI builds the service images. k8s **manifests** apply straight to the
cluster, but **code** needs a build-and-push, so a merge to main leaves SE running
whatever image someone last built by hand.

Two incidents on 2026-08-27, one merge apart:

- The agentic control plane page merged and stayed invisible on SE for hours.
- `1d00d41b3` ("llm-proxy liveness") added the `/livez` handler its own k8s probe
  needed. The manifest reached the cluster; the handler did not. **361 probe
  failures, 121 restarts, 8 hours** — from a fix that was already written.

The second is the shape that matters: the gap does not merely delay features, it
can make an already-merged fix look like a live outage.

## Decisions

1. **CI pushes immutable `sha-<commit>` tags. It never writes `:latest`.**
2. **Promotion stays a human action** — `se-update-code.sh --promote <sha>`.
3. **Path-filtered:** a merge builds only the services whose source changed.
4. **One file owns the service map.** `se-update-code.sh` already holds four
   name lookups; the path becomes the fifth, beside them and gated against
   `serverInventory`. CI re-encodes nothing.
5. **arm64 native.** `ubuntu-24.04-arm`, matching the cluster.

### Why not push `:latest` (the seemingly safer option)

Every SE deployment is `imagePullPolicy: Always` (verified across all 22
deployments, 2026-08-27). Pushing `:latest` does not move a running pod — but the
*next restart of any pod, for any reason*, pulls whatever was last merged.

So `:latest`-on-merge is a **deferred deploy with unpredictable timing**. The
llm-proxy crash loop is the worst case made concrete: it restarted every ~90
seconds for 8 hours. With a moving `:latest` it would have been pulling and
running whatever was newest on main, unattended, all night, skipping merges
nobody chose to deploy.

Immutable SHA tags make a push inert by construction. Nothing on SE can change
until a human names a SHA.

### Why not auto-rollout

It closes the gap completely and deterministically, and it is the largest blast
radius: every merge restarts SE services with no human in the loop, voiding any
demo in progress on a **shared** cluster. Rejected on that basis alone.

## 1. The matrix

**`se-update-code.sh` grows `--print-map`**, emitting one record per `ALL_KEYS`
key as JSON on stdout: the four existing lookups plus a new `source_dir()`. CI
consumes that and re-encodes nothing, so the script that actually deploys stays
the single authority for every name it uses.

| field | from | provides |
|---|---|---|
| `key` | `ALL_KEYS` | the shortcut, and the iteration set |
| `sourceDir` | **new** `source_dir()` | which changed paths belong to this service |
| `composeService` | `compose_svc` | what to build |
| `ghcrImage` | `ghcr_img` | what to push |
| `k8sDeployment` | `k8s_dep` | what to roll on promote |

### Why `source_dir()` is a fifth map rather than a join

The obvious design — join `serverInventory.sourceDir` on the compose service
name — fails on exactly one service, and it is the most-used one. The BFF is
`demo-api-server` to Compose and `api-server` to `serverInventory`; every other
service joins cleanly. Verified 2026-08-28: one mismatch out of fourteen.

A join that works for thirteen and silently drops the BFF is worse than no join.
Special-casing it is the same one-irregular-name trap this spec warns about two
paragraphs down. So the path lives beside the four names it must agree with, in
the file that already documents it in its own header comment
(`# bff  demo_api_server → ai-demo-demo-api-server → demo-api-server`), and
§4's guardrail cross-checks it against `serverInventory` so the two cannot drift.

### The names are irregular — the join must be read, not computed

There is no prefix rule. The UI is `ui` in `serverInventory` and in Compose, but
`ai-demo-frontend` in GHCR — not `ai-demo-ui`. The BFF is `api-server` in
`serverInventory`, `demo-api-server` in Compose, `ai-demo-demo-api-server` in
GHCR, and `demo-api-server` as the k8s deployment.

Deriving any of these by string munging is the same class of bug as the
`Demo AI App -` vs `Super Banking` scope lookup fixed on 2026-08-27, which made
every identity in the agent registry read as unverified. The join is a lookup,
and a test asserts the irregular cases explicitly.

### `ALL_KEYS` is the iteration source

`--print-map` iterates `ALL_KEYS`, which is also what the build-all and roll-all
loops use. A key absent there is invisible to a full deploy — `llm` was missing
for exactly one PR (#2495 → #2505) and the comment above the list already
documented that trap from a previous occurrence. CI inheriting `ALL_KEYS` means
one list governs all three, and the guardrail below makes an omission loud.

## 2. The workflow

New job in `.github/workflows/ci.yml`, on `push: branches: [main]` — a trigger
the workflow already has.

```
runs-on: ubuntu-24.04-arm
```

Native arm64. The SE nodes are arm64 (verified 2026-08-27) and so are the images;
that is why hand-building from an Apple Silicon Mac has worked. A default amd64
runner would need QEMU, and a cold BFF build already takes ~16 minutes unemulated.
arm64 runners are free on this public repo.

Steps:

1. **`dorny/paths-filter` with `base: ${{ github.event.before }}`.**
   The existing `changes:` job path-filters **only** on `pull_request`; on push it
   sets every output `true`. So this job needs its own filter — reusing those
   outputs would build everything on every merge.
2. **A node script** joins the filter result against `--print-map` and emits a
   matrix of `{ key, ghcrImage, context }`.
3. **Matrix job per service:** build through `docker compose build <service>`
   under `-p ai-demo-se --profile demo-auth`, then `docker tag` the resulting
   local image to `ghcr.io/<owner>/<image>:sha-<commit>` and push it.

   Compose owns the build, deliberately. A service's build context is **not**
   its source directory: `demo-api-server` builds from the repo root (the BFF
   reads `scope-topology.json` and `docs/`) with
   `dockerfile: demo_api_server/Dockerfile`, while `llm-proxy` builds from
   `./demo_llm_proxy`. Putting context and dockerfile in the service map would
   be a sixth and seventh copy of what `docker-compose.yml` already holds, and
   `--profile demo-auth` is required or `authz-server` and `mcp-gateway` are
   silently skipped — the trap `se-update-code.sh` already documents.
4. **No `:latest` write. No rollout. No kubectl.** The workflow needs no cluster
   credentials at all, which is itself a property worth keeping.

**First-merge behaviour:** `github.event.before` is a real commit for ordinary
merges. For a force-push or an initial push it can be all-zeroes; the script
treats an unresolvable base as "build nothing" and logs why, rather than
defaulting to building everything. A missed build is recoverable by hand; a
surprise 14-image build on a force-push is noise nobody asked for.

## 3. `se-update-code.sh --promote <sha> [key...]`

```bash
docker buildx imagetools create \
  -t ghcr.io/<owner>/<image>:latest \
  ghcr.io/<owner>/<image>:sha-<commit>
kubectl rollout restart deployment/<dep> -n "$NS"
kubectl rollout status  deployment/<dep> -n "$NS" --timeout=180s
```

`imagetools create` retags **registry-side**: no pull, no rebuild, seconds rather
than ~16 minutes. It also copies the manifest rather than re-resolving it, so a
multi-arch image survives intact — a naive `pull && tag && push` from an arm64
Mac would silently narrow the manifest to one platform.

**With no keys named,** it promotes every image in `ALL_KEYS` that actually
carries that SHA tag, and **reports the ones that do not**. Promoting a commit
that only touched the BFF therefore rolls only the BFF, and an image CI never
built is named out loud instead of passing silently.

**It refuses to promote a SHA whose tag is absent** rather than no-op'ing. Two
separate silent no-ops cost hours on 2026-08-27 (the demo-flag reset, and
`restart` keeping stale layers), and both were invisible in a long log.

**Rollback is `--promote <older-sha>`** — the same path, no rebuild.

## 4. Guardrail

A hygiene assertion with two halves, joining the existing checks in
`npm run hygiene:check`:

1. **Every `ALL_KEYS` key resolves in all five lookups** — `source_dir`,
   `compose_svc`, `ghcr_img`, `local_img`, `k8s_dep`. A key present in four and
   missing from the fifth is exactly how `llm` was silently skipped by full
   deploys for a PR, and how `agent-service` was before it. Twice is a pattern,
   so it gets a gate rather than a third comment.
2. **Every `source_dir()` value matches `serverInventory`'s `sourceDir` for that
   service** — except the one documented BFF mismatch (`api-server` vs
   `demo-api-server`), which the check names explicitly rather than skipping
   silently. This is what stops the fifth map drifting from the inventory the
   Servers page and `/api/health/inventory` already read.

A directory rename then fails a check instead of quietly building nothing.

## 5. Verification

**A workflow change cannot be fully tested before it merges** — GitHub runs the
pushed workflow, so the first real run is the merge. Everything that is not YAML
is testable beforehand, and is:

- **Matrix script unit tests**, fixtures of changed paths → expected matrix:
  a path in no service (empty matrix), a path in two services, a shared root file,
  an unresolvable base, and the irregular `ui → ai-demo-frontend` join — the case a
  prefix rule gets wrong.
- **`--print-map` test:** all four lookups resolve for every `ALL_KEYS` key, and
  the JSON parses.
- **The guardrail is its own test.**
- **`imagetools create` is proven against an existing image before anything
  depends on it.** It is the linchpin of "promote is fast"; asserting it is not
  the same as knowing it.
- **End-to-end after merge:** trivial change to one service → exactly one image
  builds, the SHA tag exists, `:latest` is unchanged, then `--promote` moves SE.

## Out of scope

- **Auto-rollout on merge.** Rejected above.
- **Changing `imagePullPolicy`.** `Always` is what makes promote work without
  pinning digests; changing it is a separate decision with its own consequences.
- **Building images the SE cluster does not run** (llama tiers, OpenSearch,
  Weaviate, Grafana, Jaeger). They are third-party or rarely rebuilt.
- **A CI job that deploys.** The workflow deliberately holds no cluster
  credentials.
