# Learning Hub standalone (catalog E1) and demo shelf (E2): extraction manifest, content-pack format, merge, RAG

Read-only research, 2026-10-20. Paths are absolute or relative to `/Users/cmuir/Development/AI-DEMO2` (call it APP) and `/Users/cmuir/Development/id-jag-standalone` (call it KIT). Nothing in either repo was edited. Items I could not verify are marked UNVERIFIED.

Artifacts produced beside this report (scratchpad `research/pack/`):
- `/private/tmp/claude-502/-Users-cmuir--agents/c7c590a7-9b81-4772-8e0c-fb0d6aba0c83/scratchpad/research/pack/content-pack.schema.json` (JSON Schema 2020-12 draft)
- `/private/tmp/claude-502/-Users-cmuir--agents/c7c590a7-9b81-4772-8e0c-fb0d6aba0c83/scratchpad/research/pack/id-jag.pack.json` (worked example, generated from the kit's real data, 20,150 bytes)
- `/private/tmp/claude-502/-Users-cmuir--agents/c7c590a7-9b81-4772-8e0c-fb0d6aba0c83/scratchpad/research/pack/gen-example.mjs` (generator and validator)

## 0. Key findings (read this first)

1. **There are two different "Learning Hubs" in APP, and they should not be extracted the same way.**
   - The **interactive Hub**: `demo_api_ui/src/components/LearningHub.tsx` (37 KB, 996 lines). It is a hard-coded list of categories and cards (`LEARNING_CATEGORIES`, line 130) whose click actions (`categoryActionMap`, line 641) navigate to ~50 AI-DEMO2 routes, open education drawers (`openEdu(EDU.*)`), start the demo tour, or open the welcome wizard. It is almost entirely AI-DEMO2 coupling. It is not extractable as-is; it must be replaced by a data-driven shell.
   - The **static mirror**: `demo_api_ui/public/learning-mirror/` (3.0 MB, 51 HTML pages, `demo-links.js`, `assets/app.css`, `architecture/`), produced by `scripts/export-learning-hub.mjs` from `scripts/learning-hub-manifest.json` (43 page entries, 15 `skip`). It is self-contained HTML that can be shipped as-is for the AI-DEMO2 topics, but each page carries AI-DEMO2 route links (`demo-links.js` `TOPIC_ROUTES`).
2. **The kit already has the right seed for the pack.** KIT's Learn page (`web/src/pages/LearnPage.jsx`, 5,143 bytes) is a three-tab data-driven page (Docs, Glossary, Library) fed by `web/src/data/terms.json` (18 terms, 4,237 bytes) and `web/src/data/sources.json` (37 sources, 10,149 bytes). APP's `demo_api_ui/src/pages/IdJagLearnPage.jsx` (5,134 bytes) is a near-copy that reads the vendored `idJagTerms.json` / `idJagSources.json`. So the proven pattern is: kit is source of truth, files flow by hash-manifest sync (`scripts/sync-to-app.mjs`). The content pack generalizes exactly that, one level up.
3. **The RAG part is the only heavy piece** and, as built, it needs 5 containers (Weaviate, llama.cpp embeddings, Tika, `demo-mcp-code-search`, plus a llama.cpp chat model for answers). It cannot run standalone and offline without work; section 5 proposes a lexical-first design that drops Tika and Weaviate for packs.
4. **`scripts/check-learning-sync.js` is NOT a general Hub check.** It only checks the Jev demo gallery (`jevDemoContent.js` GALLERY vs ARTICLES vs `AdminSideNav.jsx` vs `docs/reference/jev-demo-urls.md`). The real Hub/diagram/demo "synced trio" rule is enforced by convention plus the mirror contract tests (`demo_api_ui/public/learning-mirror/learningMirror{DemoLinks,Links,Index,IndexDemoLinks}.test.js`) and the manifest skips.
5. **Doctor output format does not exist yet.** KIT has no doctor code on `main`; branch `feat/doctor` currently holds only a registration commit ("Add registration requests with admin approval (server)", 5 files: `server/src/registrations.js` etc.), and I found no file named doctor on it. So the shelf's status contract in section 4 is a proposal that Phase 0.7 should adopt, not something to read off existing code.

## 1. Inventory of Learning Hub files, size and AI-DEMO2 coupling

Sizes are bytes from `wc -c` unless stated. Coupling: H = high (cannot move without rewrite), M = medium (generic core plus AI-DEMO2 wiring), L = low (moves with small edits), N = none.

### 1a. Interactive Hub UI (APP `demo_api_ui/src/`)

| File | Size | Coupling | Notes |
|---|---|---|---|
| `components/LearningHub.tsx` | 37,385 (996 lines) | H | Imports `EducationUIContext`, `DemoTourContext`, `EDU` ids, `TokenChainTraceRail`, `ThemeContext`, `demoStepNumbers`, `useCaseDiagrams`, `diagramLinks` (lines 1-13). `LESSON_REGISTRY` (line 40), `RECOMMENDED_PATH` (75), `LEARNING_CATEGORIES` (130), `categoryActionMap` (641). Search, status chips (LIVE / SIMULATED / REFERENCE) and recommended path are reusable ideas; the data is not. |
| `components/LearningHub.css` | 18,742 (828 lines) | M | Theming ratchet test (`components/__tests__/themingRatchet.test.js`) forces tokens; would need the kit's `console.css` tokens instead. |
| `components/LearningHubAgent.tsx` | 4,886 | M | Chat box over code search, collection `"ai-demo2-learning-hub"` hard-coded (`askCodeSearch(value, "ai-demo2-learning-hub", 8)`); 10 canned prompts all say "Learning Hub". Needs `useSessionToken` (guest gating). |
| `components/LearningHubDocuments.tsx` | 4,737 | M | Document search + "Answer with sources" + admin upload; depends on `useSessionToken`. Generic otherwise. |
| `services/documentRagAPI.js` | 1,988 | L | Pure fetch wrapper over `/api/document-rag/{search,answer,documents,index,jobs}`; default collection `learning-hub`. |
| `services/codeSearchAPI.js` | not measured | M | `askCodeSearch` (line 44). |
| `pages/IdJagLearnPage.jsx` | 5,134 | L | Vendored copy of the kit's Learn page. |
| `data/idJagCore.manifest.json` | not measured | N | Hash manifest written by `sync-to-app.mjs`; names the kit commit and the hash of each vendored file. |
| 7 test files `components/__tests__/LearningHub*.test.tsx` + `LearningHub{Agent,Documents}.test.tsx` | n/a | H | Assert AI-DEMO2 cards (jev, obo, spiffe, vectorrag, agentGateway, trainingPath). Do not extract. |
| `components/education/*` (69 files, 1.2 MB) | 1.2 MB | H | The education drawer content behind `openEdu(EDU.*)`. This is what the exporter captures to HTML. |

### 1b. Static mirror and exporter (APP)

| File | Size | Coupling | Notes |
|---|---|---|---|
| `demo_api_ui/public/learning-mirror/` | 3.0 MB: 51 `.html`, `assets/` 1.2 MB, `architecture/` 80 KB, `demo-links.js`, `demo-learning-hub.png` | M | Self-contained pages; `demo-links.js` maps `data-demo-topic` slugs to AI-DEMO2 routes (e.g. `"agent-gateway": "/agent-gateway-inspector"`). |
| `scripts/export-learning-hub.mjs` | 19,747 (489 lines) | H | Playwright capture of the running stack at `https://api.ping.demo:4000/learning` (hard-coded, line 31). Has `PROTECTED_FILES`, `KNOWN_APP_ONLY_CARDS`, and a Gartner licensing guard that aborts if any page matches `/gartner/i` (lines 388-393). Not needed for packs (pack content is authored data, not captured). |
| `scripts/learning-hub-manifest.json` | 7,882 | H | 43 page entries (`file`, `title`, `card`, optional `tabs`, `drawer`, `skipTabs`, `skip`, `intro`). `skip` marks cards that now navigate to routed pages. Gotcha: keep compact one-line format (memory note `ai-demo2-learning-export-gotchas.md`). |
| `scripts/index-learning-hub-documents.mjs` | 1,754 | L | Seed importer: walks `LEARNING_HUB_ROOT` (default `learning/`), base64s `.html .md .txt .pdf .docx`, POSTs to `DOCUMENT_RAG_URL` (default `http://localhost:8095`) `/documents/index`, collection `learning-hub`. Note `APP/learning/` does not exist in this checkout (ls failed); the source dir would be the mirror or a generated one. UNVERIFIED which dir CI/SE uses. |
| `scripts/check-learning-sync.js` | 2,432 | N | Jev gallery only (see finding 4). |
| `package.json` script | n/a | N | `"export:learning": "node scripts/export-learning-hub.mjs"` (line 80). I found no `check:learning` or `index:learning` script entries. |

### 1c. Document RAG back end (APP)

| File | Size | Coupling | Notes |
|---|---|---|---|
| `demo_api_server/routes/documentRag.js` | 4,632 (90 lines) | M | BFF proxy to `MCP_CODE_SEARCH_URL` (default `http://localhost:8095`). `/answer` retrieves via `/documents/search` then calls `callLlamaCpp` from `services/llamacppLlmService` with a "cite [n]" system prompt. `/index` and delete require `requireAdmin` from `middleware/auth`. |
| `demo_mcp_code_search/src/server.ts` | 10,599 | L | Express: `/health`, `/codebases`, `/index`, `/search`, `/code`, `/documents`, `/documents/index`, `/documents/jobs/:id`, `DELETE /documents/:id`, `POST /documents/search` (line 225). |
| `demo_mcp_code_search/src/weaviateStore.ts` | 19,360 | M | Class `LearningHubDocumentChunk`; bring-your-own vectors (`vectorizer: 'none'`); has a key-backfill migration (lines 173-215) that a fresh standalone does not need. |
| `demo_mcp_code_search/src/documentExtractor.ts` | 2,310 | L | Tika client: `PUT {TIKA_URL}/rmeta/text`, reads `X-TIKA:content`. |
| `demo_mcp_code_search/src/documentChunker.ts` | 2,077 | N | Pure: 3,500-char target, 400 overlap, splits pages on form feed, captures `#` headings as `section`. Fully reusable. |
| `demo_mcp_code_search/src/embeddings.ts` | 3,083 | L | OpenAI-compatible `/v1/embeddings` client, batches of 8, truncates to 3,500 chars; default model `nomic-embed-text-v1.5` (`index.ts` line 17). |
| `docker-compose.yml` lines 2355-2475 | n/a | M | Profile `rag`: `weaviate` (`semitechnologies/weaviate:latest`), `embeddings` (`ghcr.io/ggml-org/llama.cpp:server`, `-hf nomic-ai/nomic-embed-text-v1.5-GGUF:Q8_0`, port 8084), `demo-mcp-code-search` (port 8095), `tika` (`apache/tika:3.2.2.0-full`). |
| `planning/PLAN-learning-hub-document-rag-tika.md` | 20,610 | n/a | Design doc; status line says the MVP path was implemented 2026-09-20. |

### 1d. Kit's Learn (KIT)

| File | Size | Notes |
|---|---|---|
| `web/src/pages/LearnPage.jsx` | 5,143 | Tabs: Docs (links to `/guides#…`, `/`, `/trusted-idps`, `/inspect`, and `/diagram/<mode>` from `PLAYGROUND_DIAGRAM_MODES`), Glossary (search + `#term-<id>` anchors), Library (kind filter + status badge + checked date). No router: `web/src/main.jsx` lines 11-18 pick the page by `window.location.pathname`. |
| `web/src/data/terms.json` | 4,237 | 18 entries, keys exactly `id`, `term`, `definition`. |
| `web/src/data/sources.json` | 10,149 | 37 entries, keys exactly `id title url kind use status checked`. Status counts: read 33, verified 2, search-only 2. 11 kinds (Server 7, Ping docs 5, Client 5, Test tool 5, Vendor 5, Spec 2, Index 2, Sample 2, Article 2, Tutorial 1, Glossary 1). |
| `web/src/pages/GuidesPage.jsx` | n/a | `GUIDES` array (6 guides). Contains a hard-coded PF URL `https://cmuir-pf.ping-devops.com` (the `KIT` const). That string must not enter a pack or the base. |
| `scripts/sync-to-app.mjs` | n/a | `FILES` list maps kit path to app path (includes `terms.json` to `idJagTerms.json`); writes `demo_api_ui/src/data/idJagCore.manifest.json`; `--check` exits 1 on any hash difference; refuses to run if the kit files are uncommitted. This is the template for pack sync. |

## 2. Extraction manifest (style of `editions/*.json` and `scripts/export-edition.js`)

### 2a. How the edition mechanism works (what to copy)

- `editions/pingone.json` / `pingfederate.json` / `gitleaks.toml`. Manifest keys: `name`, `repo`, `provider`, `remove` (paths; trailing `/` means a directory prefix), `dropUseCases`, and for the PingOne edition `keep` (grouped paths with a reason) and `keepIgnore` (`{regex, reason}`).
- `scripts/export-edition.js` (335 lines): reads a git ref with `git ls-tree`, so it exports committed content only; refuses a destination inside the source repo or non-empty; **fails if a `remove` pattern matches nothing** (drift guard); `checkManifestCoverage` fails if a PF-named file is neither removed nor in `keep`; substitutes forbidden values (from env `EDITION_FORBIDDEN_STRINGS`, comma-separated) with fixed-length placeholders (fake UUIDs `00000000-0000-4000-8000-0000000000NN`, or `EDITION-PLACEHOLDER-N`), then `checkForbidden` proves none remain and fails if the env var is unset; then gates: relative-imports, removed-path-references, gitleaks (and `checkNoGitleaksConfig`), jest scope.
- The forbidden values live in the environment, never in a committed file. That is the design property to keep: the manifest names the mechanism, not the secrets.

### 2b. Proposed `editions/learning-hub.json` (an "extraction" manifest, new file for a new repo `learning-hub-demo`)

Same key vocabulary, plus `include`, `rewrite` and `replace` (the edition export only subtracts; the Hub extract must also add and replace, because the Hub shell is rewritten).

```json
{
  "name": "learning-hub-demo",
  "repo": "learning-hub-demo",
  "extract": "from-appsource-once",
  "include": [
    "demo_mcp_code_search/src/documentChunker.ts",
    "demo_mcp_code_search/src/documentChunker.test.ts",
    "demo_mcp_code_search/src/embeddings.ts",
    "demo_mcp_code_search/src/embeddings.test.ts",
    "demo_api_ui/src/services/documentRagAPI.js",
    "demo_api_ui/src/services/documentRagAPI.test.js",
    "demo_api_ui/public/learning-mirror/assets/app.css",
    "demo_api_ui/public/learning-mirror/architecture/"
  ],
  "includeAdapted": [
    { "from": "demo_api_ui/src/components/LearningHubDocuments.tsx", "note": "drop useSessionToken guest gating; read auth from base" },
    { "from": "demo_api_ui/src/components/LearningHubAgent.tsx", "note": "collection id from pack config, prompts from packs" },
    { "from": "demo_api_server/routes/documentRag.js", "note": "replace requireAdmin/callLlamaCpp imports with base equivalents" },
    { "from": "demo_mcp_code_search/src/server.ts", "note": "keep /health and /documents/* only; drop /index /search /code /codebases" },
    { "from": "demo_mcp_code_search/src/documentExtractor.ts", "note": "optional: only if a Tika profile is on" },
    { "from": "scripts/index-learning-hub-documents.mjs", "note": "read pack documents[] instead of a learning/ dir" },
    { "from": "demo_api_ui/src/pages/IdJagLearnPage.jsx", "note": "becomes the generic Learn tabs; data from merged packs" }
  ],
  "rewrite": [
    { "path": "LearningHub shell", "why": "replace LearningHub.tsx (H coupling) with a pack-driven card grid; keep only the search box, status chips and recommended-path idea" }
  ],
  "remove": [
    "demo_api_ui/src/components/LearningHub.tsx",
    "demo_api_ui/src/components/LearningHub.css",
    "demo_api_ui/src/components/__tests__/LearningHub.jev.test.tsx",
    "demo_api_ui/src/components/__tests__/LearningHub.obo.test.tsx",
    "demo_api_ui/src/components/__tests__/LearningHub.spiffe.test.tsx",
    "demo_api_ui/src/components/__tests__/LearningHub.vectorrag.test.tsx",
    "demo_api_ui/src/components/__tests__/LearningHub.agentGateway.test.tsx",
    "demo_api_ui/src/components/__tests__/LearningHub.trainingPath.test.tsx",
    "demo_api_ui/src/components/education/",
    "demo_api_ui/public/learning-mirror/demo-links.js",
    "scripts/export-learning-hub.mjs",
    "scripts/learning-hub-manifest.json",
    "scripts/check-learning-sync.js",
    "demo_mcp_code_search/src/weaviateStore.ts",
    "demo_mcp_code_search/src/weaviateStore.migration.test.ts"
  ],
  "dropMirrorPages": {
    "policy": "ship NONE of the 51 mirror pages in v1; each is AI-DEMO2 education content wired to AI-DEMO2 routes. Re-admit pages one at a time as an AI-DEMO2 demo pack that declares them.",
    "alwaysExclude": ["machine-iam-survey", "machine-iam-for-agentic-ai.html"],
    "licensingGuard": "reuse the exporter's /gartner/i abort (export-learning-hub.mjs lines 388-393) as a gate on every pack document"
  },
  "keepIgnore": [
    { "regex": "^docs/", "reason": "docs may name AI-DEMO2 as history" }
  ]
}
```

Notes on that manifest:
- `machine-iam-for-agentic-ai.html` and `machine-iam-survey` are listed because the exporter treats `machine-iam-survey` as an excluded Gartner-licensed item (`exclude` in `learning-hub-manifest.json`, line 3) and lists `machine-iam-for-agentic-ai.html` among `PROTECTED_FILES`. I did not open either file to see their content. UNVERIFIED that the second one is licensed; excluding both is the safe default.
- `weaviateStore.ts` is removed (not adapted) because section 5 recommends a different store; this is a decision, not a requirement.
- The edition exporter's "remove pattern matched nothing" rule should be kept, so a rename in APP fails the extract loudly. Because standalones are edited directly after the initial extract (family plan decision 3), this manifest runs **once**; after that the Hub repo is the source of truth, so the per-edition `checkManifestCoverage` is not needed.

### 2c. Forbidden strings and gates for the Hub repo

| Gate | Mechanism | Source to reuse |
|---|---|---|
| AI-DEMO2 PingOne env ID, client IDs, secrets | env `EDITION_FORBIDDEN_STRINGS` (comma separated), `applySubstitutions` then `checkForbidden`; fails if the env var is unset | `scripts/export-edition.js` lines ~173-176, 240 |
| Host names | add literal patterns: `api.ping.demo` (exporter hard-codes `https://api.ping.demo:4000`), `cmuir-pf.ping-devops.com` (KIT `GuidesPage.jsx`), `local.procyon.ai`, `openam-jgcten` (AIC tenant in memory note) | grep gate, not env, because these are not secrets |
| Gartner / licensed text | `/gartner/i` abort on any pack document or mirror page | `export-learning-hub.mjs` 388-393 |
| Secrets | gitleaks (note APP has 41k historic findings; use a fresh repo with a fresh config) | `editions/gitleaks.toml` |
| Dead references | relative-imports and removed-path-references gates | `export-edition.js` `checkRelativeImports`, `checkRemovedPathReferences` |
| Raw tokens | pack validator rejects any string matching a JWT shape `eyJ[A-Za-z0-9_-]{10,}\.` in any field | new, 5 lines |

I did not read the real forbidden values and did not print any.

## 3. Content-pack format

### 3a. Design rules

1. **Data, not code.** One JSON file per demo repo, `content-pack.json` at repo root, schema id `demo-content-pack/1`. The kit's two existing data files are the glossary and sources arrays verbatim, so the ID-JAG kit migrates by wrapping, not rewriting.
2. **Namespaced by pack id.** Term `id-jag.id-jag`, card `id-jag.playground`. Stored ids stay short inside the pack; the Hub prefixes on merge, so collisions between repos are impossible.
3. **Pointers, not copies, for stories and diagrams.** A pack lists the story id and the one-line takeaway; the story file stays at `stories/<id>.json` (family-stories rule 7: stories are data and the talk-track panel, Simulate, mock mode and the Learn pack all read the same file). Diagrams are routes into the demo, not images (all diagrams are ReactFlow per memory note `diagrams-are-reactflow.md`; never mermaid).
4. **Links are relative to the demo's `baseUrl`.** The Hub or shelf supplies the base (default `http://localhost:<port>`); no tenant URLs or IDs in a pack.
5. **Carries its own provenance**: `source.repo` + `source.commit`. Mirrors the `idJagCore.manifest.json` pattern (kit commit plus hashes).
6. **Synced-trio gate lives in the demo repo**: a pack test fails if a card's `href` route, a `diagrams[].href` mode, or a `story` is not present in the demo (diagram/demo/Hub trio, memory note `diagram-demo-learninghub-sync.md`).

### 3b. Fields

| Field | Required | Meaning |
|---|---|---|
| `schema` | yes | constant `demo-content-pack/1` |
| `id`, `title`, `version` | yes | slug, display name, semver of the pack content |
| `source` | no | `{repo, commit, generated}` |
| `demo` | yes | `{id, name, catalog (e.g. C1), baseUrl?, doctor?, tags?}`; `doctor` is the path the shelf polls (section 4) |
| `glossary[]` | yes | `{id, term, definition, aliases?}` (kit's shape plus optional aliases) |
| `sources[]` | yes | `{id, title, url, kind, use, status(verified/read/search-only/not-read), checked(YYYY-MM-DD)}` (kit's shape exactly) |
| `cards[]` | yes | Learn index cards: `{id, label, description?, group(setup/try-it/concept/reference), action{type route/external, href}, terms[]?, story?}` |
| `diagrams[]` | no | `{id, label, href, mode?}` |
| `stories[]` | no | `{id (S##), title, say?, file?}` |
| `documents[]` | no | optional RAG corpus files shipped with the pack: `{id, path, title, sourceId?}` |

The full schema is in `content-pack.schema.json` (strict: `additionalProperties: false` throughout, so typos fail).

### 3c. Worked example (generated from real kit data)

`id-jag.pack.json` was produced by `gen-example.mjs` reading `KIT/web/src/data/terms.json` and `sources.json` directly, plus the 6 guides from `GuidesPage.jsx` `GUIDES` and the 4 diagram modes (`mock`, `pf-as`, `pf-pf`, `byo`, from `idJagPlaygroundDiagrams.js` lines 33/69/112/151). Result (actually run):

```
schema valid: true
cross-refs: ok
counts { terms: 18, sources: 37, cards: 9, diagrams: 4 }
```

Negative test (actually run): deleting `sources[0].status` and setting `cards[0].group` to `bogus` made validation fail with `/sources/0 must have required property 'status'` and `/cards/0/group must be equal to one of the allowed values`.

Excerpt:

```json
{
  "schema": "demo-content-pack/1", "id": "id-jag", "title": "ID-JAG", "version": "0.1.0",
  "source": { "repo": "cmuir_pingcorp/id-jag-standalone", "commit": "<main sha>", "generated": "2026-10-20" },
  "demo": { "id": "id-jag-standalone", "name": "ID-JAG playground", "catalog": "C1",
            "baseUrl": "http://localhost:5173", "doctor": "/api/doctor", "tags": ["tokens","pingfederate","mcp"] },
  "glossary": [ { "id": "id-jag", "term": "ID-JAG", "definition": "Identity Assertion JWT Authorization Grant: ..." } ],
  "sources":  [ { "id": "ietf-draft", "title": "IETF draft-ietf-oauth-identity-assertion-authz-grant (-04)", "kind": "Spec", "status": "read", "checked": "2026-10-18", "url": "...", "use": "..." } ],
  "cards": [ { "id": "playground", "label": "ID-JAG Playground", "group": "try-it",
               "action": { "type": "route", "href": "/" },
               "terms": ["id-jag","token-exchange","jwt-bearer-grant"], "story": "S11" } ],
  "diagrams": [ { "id": "flow-pf-pf", "label": "pf-pf diagram", "href": "/diagram/pf-pf", "mode": "pf-pf" } ],
  "stories": [ { "id": "S11", "title": "Lena from Acme reads a shared dataset", "say": "No shared passwords, no duplicate accounts, and we still decide.", "file": "stories/S11.json" } ]
}
```

Caveats on the example, stated plainly:
- `source.commit` is `git rev-parse main` of the kit, which is local `main`, and the family plan says local `main` is 2 PRs behind origin (plan Phase 0 intro). So the SHA is the local one.
- `demo.baseUrl` `http://localhost:5173` is a placeholder (Vite default); I did not verify the kit's real dev port. `demo.doctor` `/api/doctor` is a placeholder for the 0.7 `doctor` command; it does not exist yet. Both UNVERIFIED.
- `stories/S11.json` does not exist in the kit (`ls KIT/stories` is absent). S11 is the ID-JAG story in `planning/standalone-demo-stories.md` line 81 ("Lena from Acme reads a shared dataset", Demos: C1) and its `say` is copied from there. The pointer is forward-looking until Phase 0.5 creates story files.
- The `card.terms` mapping and `group` assignment were authored by me for the example; the kit's Learn page has no such mapping today, so it is new content a human should check.
- The schema was validated with Ajv 8.20.0 from APP's `node_modules` with `validateFormats: false` (`ajv-formats` is not installed there). So `format: uri` and `format: date` are NOT enforced in my run; the production validator must add `ajv-formats` or use patterns.

### 3d. Migrating the kit's existing `LearnPage.jsx`

Change `LearnPage` to import the merged-pack accessor (`web/src/data/pack.js` re-exporting `content-pack.json`) instead of `terms.json` / `sources.json`. Keep `#term-<id>` anchors (they are linked from playground steps, per the comment at the top of `LearnPage.jsx`). Update `sync-to-app.mjs` `FILES` to ship `content-pack.json` rather than two data files, and keep the hash-manifest check. This is a small change but it touches APP's `check-id-jag-core.js` expectations, so do it in the same PR in both repos.

## 4. Merging packs from many repos, and the shelf (E2) status lights

### 4a. Merge

- **Where packs live**: each demo repo ships `content-pack.json` at its root and serves it at `GET /content-pack.json` on its running instance (so the shelf can read a live demo). A static copy is also vendored into the Hub repo under `packs/<id>.json` by a `sync-packs.mjs` that works like `sync-to-app.mjs` (copy, hash manifest, `--check` in CI). Rationale: matches the family plan's "template repo + hash-manifest sync, no npm registry, no git subtree".
- **Merge algorithm** (`merge-packs.mjs`, build time and at runtime):
  1. Validate each pack against the schema, then run cross-reference checks (card terms exist, card story exists in `stories[]`). Reject the pack, not the whole Hub, on failure; show the pack as "invalid" on the shelf.
  2. Namespace every id with `<pack.id>.`.
  3. **Glossary**: group terms by case-folded `term` (and `aliases`). If two packs define the same term, show one entry with each pack's definition under a "per demo" subheading, never silently pick one (the ID-JAG `dpop` and a future DPoP tester will both define DPoP; "Don't silently pick one path"). Link anchors stay `#term-<pack>.<id>`.
  4. **Sources**: dedupe by normalized `url`; keep the worst `status` and the oldest `checked` among duplicates so a stale or unverified copy is never promoted (the kit's stated principle: "Every source says how far we checked it and when, so nobody repeats a guess as fact").
  5. **Cards, diagrams, stories**: concatenate, tag with `demo.id` and `catalog`. The Hub's Learn index groups by `group`, then by demo.
  6. **Cross-demo links**: a card `href` is resolved against that demo's `baseUrl`; if the demo is not running, the link is shown disabled with the shelf status (below), not as a dead link.
- **Version skew**: packs carry `schema` and `version`; the Hub supports `demo-content-pack/1` and refuses unknown majors.

### 4b. Shelf (E2) status lights, fed by each demo's doctor

Family plan row E2: "One page: every demo, status light (ready / needs setup / broken), start button". Phase 0.7: "`doctor` command: Checks tenant, ports, certs, env, backend reachability; names the fix; green on a good setup".

Proposed contract (to be adopted by 0.7; I could not find an existing format, so UNVERIFIED against any code):

```json
// doctor --json, and GET <baseUrl>/api/doctor
{ "schema": "demo-doctor/1", "demo": "id-jag-standalone", "at": "2026-10-20T12:00:00Z",
  "mode": "mock|live", "checks": [
    { "id": "ports", "status": "pass|warn|fail", "message": "5173, 8080 free", "fix": "stop whatever uses 8080" },
    { "id": "pf-reachable", "status": "fail", "message": "PF admin API not reachable", "fix": "set PF_ADMIN_URL in .env" } ] }
```

Light mapping (computed by the shelf, not by the demo):

| Light | Rule |
|---|---|
| ready (green) | doctor reachable, no `fail`, mode `live` or mock explicitly chosen |
| needs setup (amber) | no `.env` / `customer.config` yet, or only `warn`, or a `fail` whose check is in a "setup" category (missing env var, no tenant configured) |
| broken (red) | container not running or doctor unreachable after the demo claims to be started, or a `fail` in a runtime category (backend unreachable, bad cert) |
| unknown (grey) | demo repo not cloned / not started; show the one-command setup instead of a start button |

Shelf data flow: the shelf holds a registry of demos (id, repo, default port, start command, pack path). For each, `GET <baseUrl>/api/doctor` with a 2-second timeout, plus `docker ps` name check for the container (OrbStack, never Docker Desktop). Existing code worth reusing: `scripts/demo-launcher-server.mjs` in APP already implements a loopback-only launcher that polls readiness probes, with statuses `idle`/`starting`/`ready`/`failed`/`unavailable` (lines ~181-311) and `docs/demo-launcher/index.html` as its page; it binds loopback only (line 32) which is the right default for the shelf's start button. I read only the head of this file, so its reusability beyond "pattern to copy" is UNVERIFIED.

Security note for the start button: it must only run the fixed command registered per demo (as the launcher does with "fixed local startup"), never a command taken from a pack.

## 5. RAG Q&A: what it needs to run standalone and offline

### 5a. Current pipeline (as built in APP)

`LearningHubDocuments` -> `/api/document-rag/*` (`routes/documentRag.js`) -> `demo-mcp-code-search:8095` -> Tika (`/rmeta/text`) -> `chunkDocument` -> embeddings (llama.cpp `/v1/embeddings`, `nomic-embed-text-v1.5`) -> Weaviate (BYO vectors) ; answer = top-k chunks -> `callLlamaCpp` with "answer only from the passages, cite [n]" prompt.

Runtime requirements, from `docker-compose.yml` 2355-2475:
- 4 containers: Weaviate, llama.cpp embeddings, `demo-mcp-code-search`, Tika (`apache/tika:3.2.2.0-full`, image size UNVERIFIED but "full" is the large variant).
- A chat model served by llama.cpp for `/answer`, reached via `services/llamacppLlmService` (default URL and model not read; UNVERIFIED).
- The embeddings container downloads the model at first start via `-hf nomic-ai/nomic-embed-text-v1.5-GGUF:Q8_0` into volume `embed-models`, so a first run needs network, and `start_period: 180s`. Embedding is slow on CPU: comments in `embeddings.ts` say ~2-3 s per chunk on the SE CPU embedder.
- BFF auth: indexing and delete need `requireAdmin`; search and answer need a signed-in session in the UI (`LearningHubDocuments` disables controls for guests).

### 5b. What breaks standalone and offline

| Problem | Why | Fix |
|---|---|---|
| Network on first run | HF model download; `weaviate:latest` unpinned | pre-pull images and bake the GGUF into a volume or the image; pin Weaviate |
| Weight | 4 containers for a corpus of ~100 KB of markdown | drop Weaviate and Tika for pack content (below) |
| Tika not needed | packs ship markdown/text already; Tika matters only for user-uploaded PDF/DOCX | make Tika an optional `--profile upload` |
| Answer needs an LLM | `/answer` requires llama.cpp chat | fall back to "extractive answer": return the top passages with citations and no generated text; label it as such |
| Auth coupling | `requireAdmin`, `useSessionToken` | in the Hub repo, search/answer open on localhost; index from pack files at startup, admin upload optional |
| Collection naming | `learning-hub` and `ai-demo2-learning-hub` hard-coded | pack id as collection or one collection with `pack` metadata |
| Weaviate migration code | 40 lines of key backfill irrelevant to a fresh install | not carried over |

### 5c. Recommended standalone design (smallest thing that works offline)

1. **Lexical first.** Chunk `documents[]` plus glossary definitions and `cards[].description` with the existing `documentChunker.ts` (pure, 2 KB). Rank with BM25 in process (SQLite FTS5 or a 100-line in-memory index). No embeddings, no vector DB, no network. For a corpus this small BM25 over a glossary plus guides answers "what is jti replay" well.
2. **Optional semantic layer** behind an env flag: if `EMBEDDING_URL` is set, embed chunks with the existing `embeddings.ts` and store vectors in a flat JSON/SQLite file with brute-force cosine (a few thousand chunks is milliseconds). This replaces Weaviate. Re-evaluate Weaviate only if corpora exceed ~50k chunks.
3. **Optional generated answer** behind `LLM_URL` (llama.cpp or any OpenAI-compatible endpoint); without it, return extractive citations. Keep the existing system prompt that forbids invented citations.
4. **Citations point into packs**: `source_url` = card route or `documents[].sourceId` -> `sources[]` entry, so an answer's citation can show the source's `status` ("Read", "Verified by us", "Search only") from the library. That is a feature the current APP RAG does not have and it fits the kit's honesty principle.
5. **Offline test**: CI runs search with network disabled and asserts the pack's own glossary question returns the right term (APP's jest network guard note, `ai-demo2-jest-network-guard.md`, shows sockets are blocked in tests; mirror that so offline is enforced, not assumed).

If the user wants the existing architecture kept intact instead, minimum standalone = compose profile with the 4 containers + chat model, pre-baked model volume, and the auth shims. That is the heavier option and contradicts "cheaper and faster" in the family plan goal.

## 6. Estimate and risks

### Estimate (agent-sessions; one session = one focused agent run with review)

| Piece | Sessions |
|---|---|
| Pack schema, validator, merge script, ID-JAG pack + sync, kit `LearnPage` migration (both repos, one PR each) | 2 |
| Hub shell repo: card grid, Learn tabs (docs/glossary/library), search, status chips, ReactFlow-free (it only links to diagrams) | 2 |
| Extraction run: manifest, forbidden-string/host gates, `documentChunker` + `documentRagAPI` + adapted server, tests | 2 |
| Lexical RAG + extractive answers + offline CI test | 1.5 |
| Optional embeddings/LLM layers | 1 |
| Shelf (E2): registry, doctor polling, lights, start button, based on the launcher pattern | 2 |
| Mirror-page re-admission as AI-DEMO2 demo pack(s) (optional, later) | 2+ |
| **Total core (without optional rows)** | **about 9.5 sessions; about 6.5 for pack + Hub + RAG-lexical, shelf separate** |

Biggest assumption: Phase 0.7 `doctor` ships a JSON output close to the proposed contract, and Phase 0.5 creates `stories/<id>.json`. If either slips, the shelf lights and the story pointers are stubs. Second assumption: v1 ships **no** AI-DEMO2 mirror pages (51 pages, 3 MB, all wired to AI-DEMO2 routes).

### Risks (ranked)

1. **Scope trap: porting `LearningHub.tsx`.** 996 lines of AI-DEMO2 wiring look like "the Hub" but are not extractable; porting it drags EducationUIContext, DemoTourContext, EDU ids, useCaseDiagrams and 7 tests. Mitigation: rewrite as data-driven; keep only ideas.
2. **Secret and licensed-content leakage.** APP has had 41k gitleaks findings and a rotation (memory `ai-demo2-secret-rotation-2026-10.md`); the exporter has a Gartner licensing guard because licensed text reached pages before. Mitigation: extract into a fresh repo, env-supplied forbidden strings, host-name grep, `/gartner/i` gate on every pack document, no mirror pages in v1. Also the kit's own `GuidesPage.jsx` embeds a real PF hostname that would ride into any pack built from it.
3. **Pack drift from the demo** (the synced-trio failure). A card can point at a route or diagram mode that no longer exists. Mitigation: each demo repo's CI test resolves every `href`, `mode` and `story` in its pack against its own routes.
4. **Pack format churn.** If 20+ repos adopt `demo-content-pack/1` and the schema must change, every repo moves. Mitigation: strict schema with a `schema` version, additive-only minor changes, base-sync carries the validator.
5. **Term collisions and stale sources** when merging many repos; handled by showing per-demo definitions and keeping the worst `status` / oldest `checked`, but needs a UI decision from the user.
6. **Shelf start button runs commands.** Must be loopback-only and fixed-command-only.
7. **Doctor contract not yet real.** Lights are only as honest as each doctor; a doctor that returns green on mock mode while live is misconfigured would mislead an SE in front of a customer. Mitigation: doctor reports `mode`, and the shelf shows it next to the light.
8. **Generated-answer honesty.** An LLM answer over a tiny corpus can sound authoritative on something the corpus does not say. Keep the "answer only from passages / say so plainly" prompt and show extractive citations by default.

## 7. Things I did not verify

- Whether `APP/learning/` exists on any machine (absent in this checkout), so the real input dir for `index-learning-hub-documents.mjs` is unknown.
- The default URL and model of `callLlamaCpp` (`services/llamacppLlmService`), and the size of `apache/tika:3.2.2.0-full`.
- The kit's real dev port, and whether any doctor code exists on a branch other than `feat/doctor` (that branch has none that I found).
- Contents of mirror pages `machine-iam-for-agentic-ai.html` and `machine-iam-survey` (excluded by name only).
- `demo-launcher-server.mjs` beyond its first ~320 lines.
- Memory notes were read as given (`ai-demo2-learning-export-gotchas.md`, `diagram-demo-learninghub-sync.md`); I did not re-verify their claims against git history.
