# CI build-and-push to GHCR — status and remaining work

**Updated:** 2026-08-28
**Shipped:** PRs #2525, #2529, #2533, #2536, #2540, #2542 — all merged.
**State:** working end to end. One step never run — the promote against the live SE
cluster — plus two credential chores. Both below.

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

## Status: working. Two chores remain.

The pipeline builds, tags and **pushes**. Verified on run 33167899190 / merge
`622feba36`. What is left is not code:

1. **Rotate the PAT.** The token in repository secret `GHCR_TOKEN` was pasted into
   a chat transcript, so treat it as compromised regardless of how it is used.
   Revoke at `https://github.com/settings/tokens`, issue a fresh **classic** PAT
   with `write:packages`, update the secret. CI fails loudly on the guard step in
   between, so there is no silent window.
2. **Delete the `CANARY` repository secret.** It holds that same token value and
   nothing in the repo reads it — the only references anywhere are
   `CANARY_USERNAME` and `CANARY_PASSWORD`, in `canary.yml`.

### How the auth ended up as a PAT

`GITHUB_TOKEN` cannot push here. The `ai-demo-*` packages are owned by the **user
account** (created by hand-pushes from a laptop); `GITHUB_TOKEN` authenticates as
the **repository**, and a user-owned package grants it no write access. Every push
failed with `denied: permission_denied: write_package` while the build, tag and
matrix all succeeded ahead of it. Not a visibility issue — `ai-demo-frontend` is
public and failed identically.

Per-package Actions access is the least-privilege fix and was tried first. It
**could not be made to take**: the denial was byte-identical before and after, and
the setting is not observable through any API, so it could not be confirmed as
applied. **Why it did not work was never established** — that answer is on a
settings page, and if it can be made to work, reverting to `GITHUB_TOKEN` is a
two-line change.

### A trap for whoever changes this workflow next

**A re-run cannot test a change to `build-images.yml`.** GitHub re-runs use the
workflow file from the *triggering commit*, so a re-run of an old failed job
exercises the old file. Verifying any change to the login or push step needs a
fresh merge that touches a service directory. This cost a wasted cycle today.

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

| **`docker push` lands an immutable tag** | run 33167899190 / `622feba36` — `sha-622feba367f2b5ee6fb93c0fbbffca2eadc6e7cc` resolves to `sha256:ce892608...` |
| **A push does not move `:latest`** | after that push, `:latest` is still `sha256:76fc7bb2...` — a *different* digest from the tag just written |

Everything in the chain is now verified except the promote itself.

---

## The one step never run

Promoting against the live shared SE cluster. Everything upstream is verified.

1. `./se-update-code.sh --promote 622feba367f2b5ee6fb93c0fbbffca2eadc6e7cc llm`
   — full 40-char SHA; it now rejects a short one rather than blaming CI.
2. Confirm SE actually serves it:
   ```bash
   kubectl --context us exec -n ping-devops-cmuir deploy/demo-api-server -- \
     sh -c 'curl -s -o /dev/null -w "/livez -> %{http_code}\n" http://llm-proxy:8090/livez'
   ```
   Expect `200`. **A green rollout is not evidence the new image serves traffic** — on
   2026-08-27 `successfully rolled out` was reported while the pod was still the old
   crash-looping one.

Only merges after `4d9ad6d31` (the PAT fix) have images. Everything before it —
including the feature's own merge commit — is permanently unpromotable.

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
