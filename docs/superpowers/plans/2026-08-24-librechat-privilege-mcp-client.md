# LibreChat Privilege MCP Client Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a standalone `librechat/` Docker Compose stack (LibreChat + MongoDB) configured to reach this repo's Privilege-agentless MCP door (`https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp`) via LibreChat's native OAuth Authorization Code + PKCE, with its chat LLM pointed at this repo's local `:8090` LLM proxy — proving that `get_my_accounts` (Super Sports vertical) returns real account data through LibreChat's own browser-based sign-in.

**Architecture:** Two new files plus a checked-in `.env` template — `librechat/docker-compose.yml` (LibreChat `api` + MongoDB only, no meilisearch/rag_api/vectordb), `librechat/librechat.yaml` (one custom OpenAI-compatible endpoint, one `mcpServers` entry), `librechat/.env.example`. No new backend code — this is deployment/config of a third-party open-source app, matching the spec's own framing. The stack stays outside `run-docker.sh`'s primary compose, per this repo's "one stack, one owner" convention.

**Tech Stack:** Docker Compose, LibreChat (`registry.librechat.ai/danny-avila/librechat-dev:latest` — verify this is still the current tag at implementation time; LibreChat's registry/tagging has moved before), MongoDB pinned to `mongo:4.4.18` (AVX-free, Apple-Silicon-safe), `librechat.yaml` schema `version: 1.3.14` (verify against the pinned image's expected schema version at implementation time).

**Spec:** `docs/superpowers/specs/2026-08-24-librechat-dual-door-mcp-client-design.md` — **read the corrected version**, not the file as it currently sits on this branch. This worktree's copy still shows the file as originally written in PR #2332; the correction landed in PR #2335 (merged to `main` as commit `3a0d6da9e4b092b41cf7e6eb73b852c739a6998e`) and is not yet an ancestor of this branch. Fetch the corrected text with:
```bash
git show 3a0d6da9e4b092b41cf7e6eb73b852c739a6998e:docs/superpowers/specs/2026-08-24-librechat-dual-door-mcp-client-design.md
```
The correction rescopes the spec to Privilege-only (no Agent Gateway/WebSocket phase — LibreChat's WS transport has no auth wiring in its source) and fixes the target Privilege application name to `external` (not `cmuir`). This plan implements the corrected spec's §2–§6 only.

## Resolved open questions (spec §7)

The corrected spec leaves two open questions for this plan to resolve. Both are resolved here with sourced evidence, not guessed:

1. **Which LibreChat services are required to boot MCP support?** Only `api` and `mongodb`. Verified against LibreChat's live `docker-compose.yml` (`danny-avila/LibreChat`, fetched today): `meilisearch` has no hard dependency from `api` (it's referenced only when `SEARCH=true`, which defaults to `false` in `.env.example`); `vectordb` is only a dependency of `rag_api`; `rag_api` is listed in `api`'s `depends_on:` but that's a plain list (no `condition: service_healthy`), and it exists purely to support the RAG/file-embedding feature, which is never invoked by an MCP tool call. This plan's `docker-compose.yml` (Task 1) is authored fresh with just the two required services, rather than cloning LibreChat's full compose + override files — simpler for a two-service stack we fully own.
2. **Concrete host/network path from LibreChat's container to `:8090`?** `http://host.docker.internal:8090/v1`, using `extra_hosts: ["host.docker.internal:host-gateway"]`. This is not a new pattern — it's the exact mechanism this repo's own `docker-compose.yml` already uses for the same LLM proxy (e.g. `AGENT_LLM_BASE_URL: "http://host.docker.internal:8090/v1"` at `docker-compose.yml:1124`, and the `promptfoo-step-narration` service at `docker-compose.yml:1828-1830` using the identical `http://host.docker.internal:8090/v1` + `extra_hosts: ["host.docker.internal:host-gateway"]` pair). `demo_mcp_gateway` (port 3005) is irrelevant to this plan — the Agent Gateway door is out of scope per the corrected spec.

## Judgment call: OAuth registration order for Task 5 (documented, not silent)

The spec's §4 says LibreChat's Privilege `mcpServers` entry uses "RFC 9728 discovery if the Privilege gateway advertises protected-resource metadata, otherwise manual OAuth config with the registered client." Two facts found during this planning pass make the discovery path worth trying **first**, ahead of any manual PingOne client registration:

- `privilege/AGENTLESS-CONFIGURATION.md:246` documents that an unauthenticated `initialize` call against `/external/mcp` returns `HTTP 401` "advertising protected-resource metadata and `/external/authorize`" — i.e. the gateway does expose RFC 9728 discovery today.
- The same file's `2026-08-24` entry (§ "banking flow verified end-to-end through a second application (`external`)") records a **same-day, live, verified** success: "real PingOne login as `demoUser` → Privilege OAuth (PKCE, **DCR**) → policy-enforced RBAC → routed to `mcp-server` → `get_my_accounts` returned real account data" — proving a client can reach this exact door via Dynamic Client Registration against the gateway, with no manually pre-registered, per-client PingOne app.

LibreChat's own MCP docs state plainly: "If no client id & client secret is provided, Dynamic Client Registration (DCR) will be used." Combined with the two facts above, Task 5 tries LibreChat's `mcpServers.privilege` with **no `oauth:` block at all** first — letting LibreChat's native discovery + DCR handle the entire flow, exactly as already proven against this same gateway/application today. A manually-registered PingOne OIDC client (the spec's original framing) is the documented fallback if DCR fails, but this repo's docs don't currently describe a working per-consumer manual registration procedure for this gateway (the one "PingOne OIDC application" registration section in `AGENTLESS-CONFIGURATION.md` is the **gateway's own shared** login client, `a6219652-...`, used for every downstream consumer — not a per-client pattern) — so that fallback is scoped as a debugging step in Task 5, not a pre-built alternate task.

## Global Constraints

- Standalone stack under `librechat/`, kept outside `run-docker.sh`'s primary compose (spec §2, non-goal).
- No secrets committed. `librechat/.env` is real and gitignored — already covered by this repo's root `.gitignore` (`**/.env`, line 4), no gitignore change needed. Only `librechat/.env.example` (a template, no real values) is committed.
- Point the chat LLM at the existing `demo_llm_proxy/` on `:8090` — no new API keys, no new cost (spec §3).
- Target Privilege application is `external`, not `cmuir` — `cmuir` authenticates but routes to a different backend (`pingone-mcp-server-2`) that does not serve banking tools (spec §4, corrected).
- Manual testing only, Super Sports vertical, matching this repo's default-vertical convention (spec §6). No unit tests — this is third-party app deployment/config, not code this repo owns.

---

## Task 1: `librechat/docker-compose.yml` — minimal Apple-Silicon-safe stack

**Files:**
- Create: `librechat/docker-compose.yml`

**Interfaces:**
- Produces: a `docker compose -f librechat/docker-compose.yml` project with services `api` (port `3080`) and `mongodb`, consumed by Tasks 2–5 (all `docker compose` commands in this plan assume this file).

- [ ] **Step 1: Write the compose file**

```yaml
# librechat/docker-compose.yml
#
# Standalone LibreChat + MongoDB stack for the Privilege-agentless MCP client
# proof (docs/superpowers/specs/2026-08-24-librechat-dual-door-mcp-client-design.md).
# Deliberately NOT part of this repo's root docker-compose.yml / run-docker.sh —
# exploratory client tooling, not a demo-facing service.
#
# ponytail: only `api` + `mongodb` are defined. LibreChat's own vendor compose
# also ships meilisearch/vectordb/rag_api for search+RAG; none of that is
# needed to boot MCP support (SEARCH=false by default, RAG is opt-in and
# unrelated to tool calls) — add them back only if a future feature in this
# stack actually needs search or file-embedding RAG.
services:
  api:
    container_name: librechat
    image: registry.librechat.ai/danny-avila/librechat-dev:latest
    ports:
      - "3080:3080"
    depends_on:
      - mongodb
    extra_hosts:
      # Reach the host-run LLM proxy (demo_llm_proxy/, :8090) the same way
      # this repo's own docker-compose.yml does for the identical proxy
      # (see docker-compose.yml:1124, :1828-1830).
      - "host.docker.internal:host-gateway"
    volumes:
      - type: bind
        source: ./.env
        target: /app/.env
      - type: bind
        source: ./librechat.yaml
        target: /app/librechat.yaml
      - librechat-data:/app/data
    restart: unless-stopped

  mongodb:
    container_name: librechat-mongodb
    # mongo:8.0.20 (LibreChat's vendor default) requires AVX instructions.
    # Docker Desktop on Apple Silicon runs amd64 images under emulation,
    # which does not support AVX, and the container crash-loops on startup.
    # mongo:4.4.18 is LibreChat's own documented AVX-free fallback
    # (docker-compose.override.yml.example, "OLDER CPU WITHOUT AVX SUPPORT").
    image: mongo:4.4.18
    command: mongod --noauth
    volumes:
      - librechat-mongo-data:/data/db
    restart: unless-stopped

volumes:
  librechat-data:
  librechat-mongo-data:
```

- [ ] **Step 2: Validate the compose file**

Run: `docker compose -f librechat/docker-compose.yml config`
Expected: prints the fully-resolved config with no errors (this also catches YAML typos and missing env-var-file references before any container starts).

- [ ] **Step 3: Commit**

```bash
git add librechat/docker-compose.yml
git commit -m "feat(librechat): add minimal Apple-Silicon-safe compose stack"
```

---

## Task 2: `librechat/.env.example` — secrets template

**Files:**
- Create: `librechat/.env.example`

**Interfaces:**
- Produces: the variable names Task 1's `api` service expects at `/app/.env`, and that Task 3's `librechat.yaml` references via `${VAR}` substitution.

- [ ] **Step 1: Write the template**

```bash
# librechat/.env.example
# Copy to librechat/.env and fill in real values. librechat/.env is
# gitignored by this repo's root .gitignore (**/.env) — never commit it.

# --- Server ---
HOST=0.0.0.0
PORT=3080
DOMAIN_CLIENT=http://localhost:3080
DOMAIN_SERVER=http://localhost:3080

# --- MongoDB ---
# Docker network service name, NOT 127.0.0.1 — the api and mongodb
# containers share librechat/docker-compose.yml's default network.
MONGO_URI=mongodb://mongodb:27017/LibreChat

# --- Session/credential secrets ---
# LibreChat will auto-generate temporary values into .env.temp if these are
# left blank, but that regenerates (and invalidates existing sessions/stored
# credentials) on every container recreate. Generate persistent values once:
#   openssl rand -hex 32   (JWT_SECRET, JWT_REFRESH_SECRET)
#   openssl rand -hex 16   (CREDS_IV)
#   openssl rand -hex 32   (CREDS_KEY)
JWT_SECRET=
JWT_REFRESH_SECRET=
CREDS_KEY=
CREDS_IV=

# --- Search (left off — meilisearch is not part of this stack, see Task 1) ---
SEARCH=false

# --- Privilege MCP OAuth fallback (Task 5) ---
# Only needed if LibreChat's zero-config DCR flow against
# https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp fails and a
# manually-registered PingOne OIDC client becomes necessary. Leave blank for
# the first attempt — librechat.yaml's mcpServers.privilege entry has no
# oauth: block by default, so these are unused unless that block is added.
# PRIVILEGE_MCP_CLIENT_ID=
# PRIVILEGE_MCP_CLIENT_SECRET=
```

- [ ] **Step 2: Commit**

```bash
git add librechat/.env.example
git commit -m "feat(librechat): add .env template for secrets and Mongo/server config"
```

---

## Task 3: `librechat/librechat.yaml` — custom LLM endpoint + Privilege MCP server

**Files:**
- Create: `librechat/librechat.yaml`

**Interfaces:**
- Consumes: `CREDS_KEY`/`CREDS_IV` etc. from Task 2's `.env` (LibreChat decrypts/encrypts stored keys with these — no direct reference from this file).
- Produces: the `mcpServers.privilege` entry Task 5's manual OAuth flow drives, and the `Local LLM Proxy` custom endpoint Task 4/5 select as the chat model.

- [ ] **Step 1: Write the config**

```yaml
# librechat/librechat.yaml
# For schema reference: https://www.librechat.ai/docs/configuration/librechat_yaml
version: 1.3.14
cache: true

endpoints:
  custom:
    - name: 'Local LLM Proxy'
      # demo_llm_proxy/ router.js — no auth check on any route, so any
      # non-empty apiKey value works (LibreChat requires the field to be set).
      apiKey: 'none'
      # host.docker.internal — see Task 1's extra_hosts entry and this
      # repo's own docker-compose.yml:1828 for the identical pattern.
      baseURL: 'http://host.docker.internal:8090/v1'
      models:
        # The proxy classifies every request by prompt content (or by an
        # exact model-name match it recognizes) to pick a tier — it does
        # not require this name to match anything real, so a single
        # placeholder is sufficient. See demo_llm_proxy/router.js's
        # classFromModel()/classifyText().
        default:
          - 'demo-llm-proxy'
        fetch: false
      titleConvo: true
      titleModel: 'demo-llm-proxy'

mcpServers:
  privilege:
    type: streamable-http
    url: 'https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp'
    # No oauth: block — see this plan's "Judgment call" section above.
    # LibreChat's native RFC 9728 discovery + Dynamic Client Registration
    # against the gateway's /external/authorize is tried first.
    timeout: 60000
```

- [ ] **Step 2: Validate the YAML parses**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('librechat/librechat.yaml'))" && echo OK`
Expected: `OK` (catches indentation/syntax errors before the container tries to load it — LibreChat itself only reports config errors in its startup logs, which is a slower feedback loop).

- [ ] **Step 3: Commit**

```bash
git add librechat/librechat.yaml
git commit -m "feat(librechat): add custom LLM endpoint and Privilege MCP server config"
```

---

## Task 4: Boot the stack and verify LibreChat loads both configs

**Files:** none (verification only — Tasks 1–3 already committed the config this task boots).

- [ ] **Step 1: Create the real `.env` from the template**

```bash
cp librechat/.env.example librechat/.env
# Fill JWT_SECRET / JWT_REFRESH_SECRET / CREDS_KEY / CREDS_IV per the
# generation commands in .env.example's comments.
```

Run this and every later step in this task from the repo root — Step 2's
`docker compose -f librechat/docker-compose.yml` path assumes it.

- [ ] **Step 2: Bring up the stack**

Run: `docker compose -f librechat/docker-compose.yml up -d`
Expected: both `librechat` and `librechat-mongodb` containers reach `Up` state (`docker compose -f librechat/docker-compose.yml ps`). If `librechat-mongodb` exits immediately, re-check Task 1's image pin (`mongo:4.4.18`) — an AVX crash is the known failure mode this pin exists to prevent.

- [ ] **Step 3: Confirm the custom endpoint and MCP server both loaded**

Run: `docker compose -f librechat/docker-compose.yml logs api > /tmp/librechat-boot.log 2>&1; grep -i -E "mcp|custom endpoint|Local LLM Proxy|privilege" /tmp/librechat-boot.log`
(redirect to a file first, then grep it — piping `logs` directly into `grep` masks a `docker compose` failure behind `grep`'s own exit status, per this repo's own rule against trusting a piped command's exit code)
Expected: log lines showing the `privilege` MCP server was registered/initialized and the `Local LLM Proxy` custom endpoint was loaded, with no YAML parse errors. (Exact log wording varies by LibreChat version — the failure mode to catch here is a startup crash or a silently-skipped config block, not a specific string match.)

- [ ] **Step 4: Confirm the UI is reachable**

Run: `curl -sS -o /dev/null -w "%{http_code}\n" http://localhost:3080`
Expected: `200`.

- [ ] **Step 5: No commit** — this task only verifies Tasks 1–3's already-committed config boots correctly. If any check fails, fix the relevant file in Tasks 1–3 (re-open that task) rather than patching around it here.

---

## Task 5: Manual end-to-end proof — Privilege OAuth + real tool call

This task is the spec's actual "done when" criterion (§4) and, like the sibling `langchain_agent` plan's final task, is **not automated** — it needs a browser, a live PingOne login, and the live Privilege gateway.

- [ ] **Step 1: Open LibreChat and select the MCP-enabled model**

Navigate to `http://localhost:3080` in a browser, create/sign in to a local LibreChat account (this is LibreChat's own account system, backed by the `mongodb` container — unrelated to PingOne), and select **Local LLM Proxy** as the chat endpoint.

- [ ] **Step 2: Trigger the Privilege MCP server's OAuth flow**

In LibreChat's MCP servers panel (or by sending a prompt that needs a tool, e.g. "What are my account balances?"), activate the `privilege` MCP server. Expected: LibreChat opens an OAuth authorization popup/redirect to PingOne's login page (via the gateway's `/external/authorize`, discovered per Task 3's config).

- [ ] **Step 2a — if the popup does not appear / errors immediately (DCR path failed):**

Check `docker compose -f librechat/docker-compose.yml logs api` for the specific OAuth/DCR error. This plan does not pre-script a fallback client registration because no verified per-consumer registration procedure exists yet for this gateway (see this plan's "Judgment call" section) — treat this as a debugging spike: confirm the `401` + protected-resource-metadata response is still present via the same probe `privilege/AGENTLESS-CONFIGURATION.md:239-244` documents:

```bash
curl -i -X POST https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  --data '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"1.0.0"}}}'
```

If that still returns `401` with discovery metadata, the gap is LibreChat-side (check its DCR request against the gateway's registration endpoint); if it returns something else, the gateway/application config has changed since this plan was written and needs re-verification against current `privilege/AGENTLESS-CONFIGURATION.md`.

- [ ] **Step 3: Sign in as the demo user**

Complete the PingOne login as the Super Sports demo user (`demoUser`, per this repo's default-vertical convention). Expected: the browser redirects back through the gateway to LibreChat's own callback (`http://localhost:3080/api/mcp/privilege/oauth/callback`) and the MCP server shows as connected/authenticated in LibreChat's UI.

- [ ] **Step 4: Confirm the tool call returns real data**

Ask the chat: "What are my account balances?" (or equivalent, prompting `get_my_accounts`). Expected: the model calls the `privilege` MCP server's `get_my_accounts` tool and the response contains real Super Sports account data — matching the same acceptance criterion already proven for this exact application via `curl`/Postman in `privilege/AGENTLESS-CONFIGURATION.md`'s `2026-08-24` entry, now proven through LibreChat's own browser-based OAuth flow instead.

- [ ] **Step 5: No commit** — verification only. A failure here means re-opening Task 3 (config) or investigating the gateway/PingOne side per Step 2a — not patching this task.
