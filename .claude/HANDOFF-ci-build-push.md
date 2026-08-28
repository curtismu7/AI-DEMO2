# CI build-and-push to GHCR — status and remaining work

**Updated:** 2026-08-28
**Shipped:** PRs #2525, #2529, #2533 — all merged.
**Blocked on:** one GitHub settings change, described below. Nothing else.

---

## What this solves

A merge to main used to leave the SE cluster running whatever image someone last
built by hand — k8s *manifests* apply straight to the cluster, but *code* needs a
build-and-push, and nothing in CI did it. That gap crash-looped `llm-proxy` on SE for
8 hours on 2026-08-27 with only half the merge deployed.

Now: a merge builds only the services whose source changed and pushes immutable
`sha-<commit>` tags. CI **never** writes `:latest` and holds no cluster credentials.
`./se-update-code.sh --promote <sha>` retags registry-side and rolls — the one
deliberate human step that moves SE.

| Piece | Where |
|---|---|
| `source_dir()` + `--print-map` (service map as JSON) | `se-update-code.sh` |
| Hygiene gate — every `ALL_KEYS` key resolves in all five lookups, every `sourceDir` exists on disk | `scripts/check-service-map-complete.js` |
| Pure join: changed paths → images to build | `scripts/ci-build-matrix.js` |
| The two CI jobs | `.github/workflows/build-images.yml` |
| `--promote <sha> [key...]` | `se-update-code.sh` |

---

## THE ONE THING BLOCKING IT

Every `push-image` job fails at the final step:

```
denied: permission_denied: write_package
```

**Cause.** The `ai-demo-*` packages are owned by the *user account*, created by
hand-pushes from a laptop. GitHub Actions authenticates as the *repository* via
`GITHUB_TOKEN`, and a user-owned package grants no repository write access by
default. All 14 packages report `repository: None` — they are linked to nothing.

This is **not** about visibility. Visibility governs pull; this governs push.
`ai-demo-frontend` is public and fails identically.

**Fix — once per package, UI only.** There is no REST endpoint for it.

1. `https://github.com/users/curtismu7/packages/container/<package>/settings`
2. **Manage Actions access**
3. **Add Repository** → `AI-DEMO2`
4. Change its role from the default **Read** to **Write** — *this step is easy to
   miss, and Read alone fails with the same message.*

The 14 packages the matrix can build:

`ai-demo-demo-api-server`, `ai-demo-frontend`, `ai-demo-mcp-server`,
`ai-demo-mcp-gateway`, `ai-demo-agent-service`, `ai-demo-authz-server`,
`ai-demo-mastra-agent`, `ai-demo-openai-agent`, `ai-demo-pydantic-agent`,
`ai-demo-hitl-service`, `ai-demo-mcp-invest`, `ai-demo-mortgage-service`,
`ai-demo-langchain-agent`, `ai-demo-llm-proxy`

**To verify after granting** — no commit needed, the matrix is already correct:

```bash
gh run rerun 33165014221 --failed
gh run watch 33165014221 --exit-status
```

That run is merge `09a755c10`, whose matrix correctly selected `llm` alone.

---

## Verified working (measured 2026-08-28, not assumed)

| Property | Evidence |
|---|---|
| Job fires on merge, in its own SHA-keyed concurrency group | run 33165014221 on `09a755c10` |
| Matrix selects exactly the changed service | `[ci-build-matrix] building: llm` for a `demo_llm_proxy/`-only change |
| Non-service changes build nothing | `[ci-build-matrix] no service source changed` for a workflow-only merge |
| Compose builds and `docker tag` resolves the map's `localImage` | same run, step succeeded before the push |
| **`:latest` never moves** | `sha256:76fc7bb2…` identical before and after every run today |
| **`imagetools create` works and is fast** | **1.2s**, and the log reads `copying sha256:db20e433…` — it *copies* the manifest rather than re-resolving, so a multi-arch image survives. vs ~16 min for a rebuild. |
| `langchain-agent` builds in CI | built to completion locally after the preflight; both generated-file COPY layers resolved |

Only the final `docker push` is unproven, and only because of the grant.

---

## Remaining after the grant

1. Re-run the failed job (command above); confirm `sha-09a755c10…` exists in GHCR.
2. Re-check `:latest` is still `sha256:76fc7bb2…`.
3. `./se-update-code.sh --promote <full-40-char-sha> llm` — full SHA; it now rejects
   a short one rather than blaming CI.
4. Confirm SE actually serves it:
   ```bash
   kubectl --context us exec -n ping-devops-cmuir deploy/demo-api-server -- \
     sh -c 'curl -s -o /dev/null -w "/livez -> %{http_code}\n" http://llm-proxy:8090/livez'
   ```
   Expect `200`. **A green rollout is not evidence the new image serves traffic** — on
   2026-08-27 `successfully rolled out` was reported while the pod was still the old
   crash-looping one.

No image exists for any commit merged before the grant, so those SHAs stay
unpromotable. The first promotable commit is the first service-touching merge after
access is granted.

---

## Lessons worth keeping

**`cancel-in-progress: false` does not stop a run being cancelled.** GitHub allows
only ONE PENDING run per concurrency group; a newer pending run *evicts* the older
one regardless of that setting, which only protects a run already in progress. This
killed #2525's own build: it queued at 10:21:42 behind an in-progress run and was
cancelled at 10:25:16, one second after the next merge queued, with zero jobs started.
Fixed in #2529 by giving `build-images.yml` its own group keyed by `github.sha`.

**A GHCR "version" is a digest, not a tag.** Two tags on one digest are one version,
and the delete API deletes *versions*. Deleting what looks like a throwaway tag can
delete the image `:latest` points at. There is a stray `probe-delete-me` tag on
`ai-demo-llm-proxy` sharing `:latest`'s digest — harmless, remove via the Versions UI
if it bothers you, but **do not** delete that version via API.

---

## Known gaps, deliberately not fixed (both in `TECH_DEBT.md`)

- **Shared root files never trigger a build.** Six services build from `context: .`
  and COPY root-level inputs (`scope-topology.json`, `docs/`, `mcp-tool-schemas.json`)
  belonging to no `sourceDir`. A merge touching only those builds nothing. Not fixed
  because encoding root-file→service deps would be a fifteenth copy of the service
  map. Mitigation: `--promote` *dies* rather than promoting stale, so the commit is
  unpromotable, not silently stale.
- **A sixth service map outside the gate:** `k8s/aws/deploy.sh`'s `IMAGE_MAP`.

## Two things for a human to decide

- **Agent Builder is reachable by any signed-in user**, including on the shared SE
  cluster, where it creates and deletes real PingOne applications in tenant
  `01d89b06`. Requested deliberately — but it is a live authz widening in a shared
  environment.
- **~350 local `worktree-*` branches**, ~100 auto-generated. A sweep is probably due
  (a prior one freed 72 GB by classifying with `git cherry` rather than
  commits-ahead), but it is a destructive bulk operation on shared state.
