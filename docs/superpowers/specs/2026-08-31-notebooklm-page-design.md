# NotebookLM docs-oracle page — design

**Date:** 2026-08-31
**Status:** approved, not yet implemented

## Context

Ping's product documentation is too large to hold in context, and `CLAUDE.md`
carries a standing rule to start from `docs.pingidentity.com/llms.txt` rather
than guessing a docs URL. A NotebookLM notebook built from those docs answers
questions with citations grounded in the real pages, and does the expensive
reading on Google's infrastructure rather than against the Anthropic token
budget.

A CLI path already exists and works: `~/.claude/scripts/ping-docs-notebook.sh`
builds a notebook from a docset, and notebook `85be9575-8876-4284-9cfc-d74debb75788`
("Ping Docs — privilege", 75 pages) answers today. This design surfaces that
capability in the demo UI as a page.

### Why this needs a bridge at all

`notebooklm-py` authenticates with Google cookies stored on the **host** at
`~/.notebooklm/profiles/default/storage_state.json`. The BFF is containerised
(`ai-demo-api-server`) and has no `notebooklm` binary. Something must cross the
host/container boundary, and that choice is the substance of this design.

### Accepted risk

NotebookLM is an **unofficial** API driven by personal Google cookies with a
15–20 minute keepalive. It will break without notice, and it cannot work on the
SE cluster without injecting those cookies as a secret. This was raised and the
live-page approach was chosen deliberately. The design therefore treats
unavailability as a normal, expected state rather than an error path.

## Scope

**In:** list notebooks, list a notebook's sources, ask a question, render the
answer with citations resolved back to `docs.pingidentity.com` URLs.

**Out:** creating or deleting notebooks, adding or removing sources, artifact
generation (audio, video, slide decks, quizzes, mind maps), notes, labels,
sharing, and `notebooklm-mcp` registration. The existing bundler script is not
modified.

Read-only is a security property, not just a scope cut: no write endpoint is
proxied, so an expired or hijacked session cannot mutate the user's Google data
through this page.

## Architecture

```text
browser ──► BFF (ai-demo-api-server) ──► notebooklm sidecar ──► Google
            /api/notebooklm/*            :8099, bearer         (host cookies
            admin-gated                  internal network       via bind mount)
```

### 1. `notebooklm` sidecar — `docker-compose.yml`

A new service, built from a small dedicated Dockerfile:

- Base `python:3.14-slim`, `pip install 'notebooklm-py[server]'`
- Bind mount `${HOME}/.notebooklm:/root/.notebooklm` **read-write** — the
  keepalive rotates `__Secure-1PSIDTS` and must persist the rotated jar
- `NOTEBOOKLM_SERVER_HOST=0.0.0.0` and `NOTEBOOKLM_SERVER_ALLOW_EXTERNAL_BIND=1`
  — the server refuses to leave loopback without the explicit opt-in
- `NOTEBOOKLM_SERVER_PORT=8000` (the package default; verified in
  `notebooklm/server/__main__.py`)
- `NOTEBOOKLM_SERVER_TOKEN` — bearer guard, shared with the BFF
- **No `ports:` stanza.** The container holds live Google session cookies; it is
  reachable only on the internal compose network and never published to the host.
- Bind mount `${HOME}/.cache/ping-docs:/bundles:ro` — read-only, needed for
  citation resolution (see below)

Per the repo's compose conventions the token is delivered via `env_file`, never
`environment:` — an `environment:` entry overrides `env_file` for the same key
even when absent, which is the failure the compose-env-shadow hygiene check
exists to catch.

### 2. BFF route — `demo_api_server/routes/notebooklmRoutes.js` (new)

Follows the existing flat `routes/*.js` convention.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/notebooklm/notebooks` | list notebooks |
| GET | `/api/notebooklm/notebooks/:id/sources` | list that notebook's sources |
| POST | `/api/notebooklm/ask` | `{ notebookId, question }` → cited answer |

The route proxies to `http://notebooklm:8099` with the bearer and returns a
normalised shape. It maps upstream failures to a 503 carrying a machine-readable
`reason` (`sidecar_unreachable`, `auth_expired`, `upstream_error`) so the page can
say which one happened instead of showing a generic failure.

### 3. Page — `demo_api_ui/src/pages/NotebookLmPage.jsx` + `.css` (new)

Built on `components/shared/InspectorShell`, the existing three-column shell used
by `AgentRegistryPage.jsx`. The `inspector-template` skill covers this layout.

- **Left:** notebooks, expanding to their sources
- **Middle:** the question form
- **Right:** tabs — **Answer** · **Sources** · **Raw**

The tailored element is citation resolution — see the section below. Without it
this is a chat box; with it, it is a docs oracle.

## Citation resolution (verified, not assumed)

`ask --json` returns a `references[]` array of
`{ source_id, citation_number, cited_text }`. It carries **no page URL**, and
`source_id` is the *bundle*, identical for every citation — so the page URL has
to be recovered from `cited_text`.

`ping-docs-notebook.sh` writes a `# source: <url>` header above every page it
bundles. Resolution therefore is: normalise `cited_text`, find it in the bundle,
walk back to the nearest preceding header.

Measured against the live `Ping Docs — privilege` notebook (3 citations):

| Strategy | Resolved |
|---|---|
| Exact substring | 0 / 3 — NotebookLM collapses whitespace in `cited_text` |
| Whitespace-normalised | 2 / 3 |
| **Alphanumeric-normalised, 120-char probe** | **3 / 3, each matching exactly one location** |

Two further measured facts that shape the implementation:

- **Match uniqueness holds at 60 and 120 chars** (exactly 1 hit each). Longer
  probes are worse, not better.
- **Full `cited_text` matches 0 times for 2 of 3 citations**, because an excerpt
  can span a page boundary inside the bundle. Resolving on the *first* 120
  characters therefore attributes the citation to the page where the excerpt
  begins, which is the correct answer.

Implementation rule: normalise to lowercase alphanumerics (stripping markdown
link syntax first), probe on the first 120 characters, and **require exactly one
match**. On zero or multiple matches, render the excerpt with no link rather than
guessing — a wrong docs URL is worse than none.

### 4. Nav — all three sources of truth

Adding a page touches three files that must agree, and
`navStructureCatalog.drift.test.js` fails the build when they do not:

- `demo_api_ui/src/components/AdminSideNav.jsx` — the rendered entry
- `demo_api_ui/src/config/navStructureCatalog.js` — under the **AI Flows** group
- `demo_api_server/config/auth-requirements.json` — `"/notebooklm": "admin"`

plus the matching route guard in `App.js`. Auth level is `admin`: this is an
SE/developer tool backed by a personal Google session, not a customer path.

## Failure behaviour

Unavailability is the expected steady state on any machine that is not the
developer's laptop, so it is designed for rather than handled:

| Condition | Result |
|---|---|
| Sidecar not running | 503 `sidecar_unreachable` → "NotebookLM sidecar is not running" |
| Cookies expired | 503 `auth_expired` → "Host auth expired — run `notebooklm login`" |
| Deployed to SE k8s | service absent → same `sidecar_unreachable` path |

In every case the page renders an explicit empty state naming the cause. It never
shows an indefinite spinner and never renders placeholder or cached answers as
though they were live — consistent with the honest-empty-panels posture of
PR #2657.

## Testing

| Surface | Command |
|---|---|
| BFF route | `cd demo_api_server && CI=true npx jest routes/notebooklmRoutes --forceExit` (sidecar mocked) |
| UI | `cd demo_api_ui && npm run test:unit && npm run build` |
| Route authorisation | `npm run authz:verify` — fails if the route is missing from `auth-requirements.json` |
| Nav agreement | `navStructureCatalog.drift.test.js` — fails if the three nav SoTs disagree |

Scoped runs only. The change adds one route file and one page; it does not touch
shared middleware, so the full BFF suite is not warranted.

**Definition of done:** the page lists the `Ping Docs — privilege` notebook and
its 75 sources, answers "what is the agentless MCP gateway?" with at least one
citation that links to a real `docs.pingidentity.com` URL, and renders the named
empty state when the sidecar is stopped.

## Open question deferred

Running this on the SE cluster requires the Google cookies as a Kubernetes
secret and a keepalive CronJob. That is out of scope here; the sidecar shape was
chosen over a host-only bridge specifically so that path stays open.
