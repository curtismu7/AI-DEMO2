# Plan: OAuth/OIDC Teaching Agent (on the AI-Demo platform)

**Goal:** An agent whose job is to **teach and explain OAuth 2.0 / 2.1 and OIDC**, using the
servers and assets AI-Demo already has.
**Core realization:** AI-Demo is already a teaching platform — it has the explainers, the live
visualizations, and the real operations. **It's missing the teacher.** This plan adds that agent
persona and wires it to the existing assets. We build a *conductor*, not an orchestra.
**Status:** Plan (no code yet). Date: June 2026.

---

## 0. Why this is mostly wiring, not building

AI-Demo already contains three complete teaching layers. The teaching agent's only job is to drive
them at the right moment.

| Layer | What exists today | Count |
|-------|-------------------|-------|
| **EXPLAIN** | Education panels via `EducationUIContext.open(EDU.*)` | 39 panels |
| | RFC reference (`SPEC_GUIDE`), claim glossary (`CLAIM_GLOSSARY`) | 30+ RFCs, 29 claims |
| **SHOW** | Live Token Chain (`TokenChainDisplay`, `TokenDiffPanel`, `UnifiedTokenFlowInspector`) | real RFC 8693 hops |
| **DEMONSTRATE** | Real ops: scope denial (403), token exchange, HITL (428), introspection | ~13 concept→op mappings |
| **ROUTE** | Education-intent path already exists in the NL router (`parseEducation`, `VALID_EDU_PANELS`) | reusable |
| **HOST** | Vertical/persona architecture (manifest + plugin + Helix directive) | reusable |

The teaching agent is a new **persona** that conducts these. Nothing new in the OAuth plumbing.

---

## 1. Insertion point: an `oauth-teaching` vertical (persona overlay)

AI-Demo's verticals are **persona overlays**, not separate apps — same agent, tools, MCP, session;
only the system-prompt flavor + tools + heuristics change. That's exactly the seam a teaching agent
needs.

**Why a vertical (vs. a mode flag or inline-in-banking):**
- Reuses BFF routing, session, token chain, consent — zero new infrastructure.
- Isolates the teacher persona/heuristics from banking (no cognitive bleed).
- One-place change: `systemPromptFlavor` resolution in the BFF already threads to every runtime
  (LangChain/OpenAI/Mastra/Pydantic) — so the teacher works across all four for free.

**Files (create):**
- `demo_api_server/config/verticals/oauth-teaching/manifest.json` — identity, teacher persona, greeting, chips
- `demo_api_server/config/verticals/oauth-teaching/index.js` — plugin: `getTools()`, `getHeuristics()`, `getSystemPrompt()`, `executeTool()`

**Files (edit):**
- `demo_api_server/services/nlIntentParser.js` — add `oauth-teaching` to `THEME_VOCAB` (teach/explain/show phrases)
- `docs/HELIX_AGENT_DIRECTIVES.json` — add `themes["oauth-teaching"]` LLM directive
- `demo_api_ui/...` chat UI — interpret teaching directives (open panel / show chain) — see §4

> The persona terminology overlay: `account → concept`, `transaction → flow`, `agent → OAuth Teacher`.

---

## 2. The teaching agent's three verbs

Every teaching turn composes three capabilities, escalating from words to live proof:

```
EXPLAIN   → say it (text) + cite the RFC (SPEC_GUIDE) + define the claim (CLAIM_GLOSSARY)
SHOW      → open the matching education panel (EDU.*) and/or the flow diagram
DEMONSTRATE → trigger a REAL operation and surface the result in the Token Chain UI
```

The agent decides how far to escalate based on the learner ("explain scopes" → EXPLAIN+SHOW;
"prove scopes are enforced" → DEMONSTRATE).

---

## 3. Teaching tools the plugin exposes (`getTools()`)

These are thin tools; most delegate to assets that already exist.

| Tool | Does | Backed by (existing) |
|------|------|----------------------|
| `explain_concept(topic)` | Returns explanation + RFC cite + claim defs | `SPEC_GUIDE`, `CLAIM_GLOSSARY` |
| `open_education_panel(edu_id, tab?)` | Emits directive → UI opens `EDU.*` | `EducationUIContext`, `educationIds.js` |
| `show_flow_diagram(flow)` | Opens diagram panel | `EDU.FLOW_DIAGRAMS`, `EDU.TOKEN_FLOW` |
| `inspect_token(which)` | Decodes a session/exchanged token, shows claims | `POST /api/token-display/decode` |
| `demonstrate_token_exchange()` | Triggers a real RFC 8693 exchange, surfaces hops | `agentMcpTokenService`, `TokenChainDisplay`/`TokenDiffPanel` |
| `demonstrate_scope_denial(tool)` | Calls a tool with insufficient scope → real 403 | `BankingToolProvider`, `scope-topology.json` |
| `demonstrate_hitl(amount)` | High-value action → real 428 → approve → retry | HITL service, `mcpToolAuthorizationService` |
| `show_token_chain()` | Surfaces the live chain for the current session | `GET /api/token-chain` |

> `open_education_panel` rides the **existing** education-intent path: the NL router already returns
> `{ kind: 'education', edu }` and the UI already listens for education-open events. The agent emits
> the same directive shape.

---

## 4. The agent→UI directive bridge (the one wiring piece)

Agents run server-side; panels/chain render client-side. The bridge is a structured directive the
chat UI already knows how to act on.

```
Agent runtime emits (SSE / tool result):
  { type: 'teaching_directive', action: 'open_panel', panel: 'EDU.TOKEN_EXCHANGE', tab: 'diagram' }
  { type: 'teaching_directive', action: 'show_token_chain' }
        │
        ▼
Chat UI (BankingAgent.js / useAgentRun.ts) interprets it:
  open_panel       → EducationUIContext.open(EDU.X, tab)
  show_token_chain → reveal TokenChainDisplay / TokenDiffPanel
```

Precedent already in the codebase: custom events `education-open-ciba` / `education-open-cimd` and
the `parseEducation()` → `VALID_EDU_PANELS` path. We generalize this to a typed directive the
teaching agent emits. **This is the only genuinely new plumbing.**

---

## 5. Curriculum: topic → assets (what the agent teaches with)

OAuth 2.0 / 2.1 + OIDC, each mapped to a panel (EXPLAIN/SHOW) and a real op (DEMONSTRATE) when one
exists.

| Topic | Spec | EXPLAIN panel | DEMONSTRATE (real op) |
|-------|------|---------------|------------------------|
| OAuth 2.0 fundamentals | 2.0 | `RFC_INDEX`, `LOGIN_FLOW` | session login token (`inspect_token`) |
| Authorization Code + PKCE | 2.0/2.1 | `LOGIN_FLOW` | decode the real auth-code session token |
| OAuth 2.1 changes | 2.1 | `OIDC_21` (+ best practices) | contrast PKCE-mandatory / no-implicit |
| ID token vs access token | OIDC | `LOGIN_FLOW`, `TOKEN_CHAIN` | `inspect_token` both |
| Scopes & least privilege | 2.0 | `AGENTIC_*`, scope-narrowing viz | `demonstrate_scope_denial` → real 403 |
| Token Exchange (8693) | — | `RFC_8693`, `TOKEN_EXCHANGE`, `TOKEN_FLOW` | `demonstrate_token_exchange` → live hops |
| Delegation: act / may_act | — | `MAY_ACT` | inspect `act`/`may_act` in exchanged token |
| Audience narrowing (8707) | — | `TOKEN_FLOW`, `TokenDiffPanel` | show `aud` narrow across hops |
| Introspection (7662) | — | `INTROSPECTION` | introspect a token, show active/scope |
| Consent / HITL | authz | `HUMAN_IN_LOOP` | `demonstrate_hitl` → 428 → approve → retry |
| PAR (9126), RAR (9396), DPoP (9449) | adv | `PAR`, `RAR`, (DPoP panel) | explain + diagram |
| Step-up auth (9470) | — | `STEP_UP` | explain acr/max_age |

The capstone is **Token Exchange + delegation** — it ties scopes, audience, act/may_act, and the
live Token Chain into one demonstrable story.

---

## 6. The teach-by-doing loop

```
1. Learner asks ("explain scopes" / "prove token exchange narrows audience")
2. NL router tags education intent → oauth-teaching persona handles it
3. Agent EXPLAINS (text + RFC cite + claim defs)
4. Agent SHOWS (open_education_panel) — the diagram/panel appears
5. If the learner wants proof, agent DEMONSTRATES (real op) and the Token Chain updates live
6. Agent narrates what changed (aud narrowed, act added, 403 denial, 428 gate)
7. Checkpoint question; advance
```

The DEMONSTRATE step is what AI-Demo uniquely enables — real PingOne tokens, real authz decisions,
visualized live. No other surface in either repo can do this.

---

## 7. Architecture

```
                 Learner (chat)
                      │
                      ▼
        ┌─────────────────────────────┐
        │  Agent runtime (any of 4)   │  persona = oauth-teaching systemPromptFlavor
        │  LangChain/OpenAI/Mastra/PY │
        └──────────┬──────────────────┘
                   │ teaching tools (§3) + teaching_directive (§4)
        ┌──────────┼───────────────────────────────┐
        ▼          ▼                                ▼
   EXPLAIN     SHOW                           DEMONSTRATE
   SPEC_GUIDE  EducationUIContext.open(EDU.*) real ops: token exchange / 403 / 428
   CLAIM_GLOSS 39 panels                      agentMcpTokenService, HITL, scope gate
                   │                                │
                   └──────────► Token Chain UI ◄────┘  (TokenChainDisplay / TokenDiffPanel)
```

All four agent runtimes inherit the persona via `vertical_flavor` — build once, works everywhere.

---

## 8. Files: create vs. edit

**Create**
- `demo_api_server/config/verticals/oauth-teaching/manifest.json`
- `demo_api_server/config/verticals/oauth-teaching/index.js` (plugin: teaching tools + heuristics + prompt)
- `.claude/skills/oauth-teaching-agent/SKILL.md` (how the agent should teach: the three verbs, the curriculum map, directive shapes)

**Edit (small, additive)**
- `demo_api_server/services/nlIntentParser.js` — `THEME_VOCAB['oauth-teaching']`
- `docs/HELIX_AGENT_DIRECTIVES.json` — `themes['oauth-teaching']`
- `demo_api_ui/src/components/BankingAgent.js` + `hooks/useAgentRun.ts` — interpret `teaching_directive` (open panel / show chain)

**Reuse as-is (no change)**
- All 39 education panels, `educationIds.js`, `EducationUIContext`
- `TokenChainDisplay`, `TokenDiffPanel`, `UnifiedTokenFlowInspector`, `TokenCard`
- `SPEC_GUIDE`, `CLAIM_GLOSSARY`
- `agentMcpTokenService`, `oauthService`, `tokenDisplay` routes, HITL service, scope topology
- `.claude/skills/token-education/SKILL.md` (developer reference)

---

## 9. Phasing

| Phase | Deliverable | Exit criteria |
|-------|-------------|---------------|
| P1 | `oauth-teaching` vertical: manifest + plugin + Helix directive + heuristics | Switch to vertical → agent answers in teacher persona |
| P2 | EXPLAIN: `explain_concept` + `open_education_panel` directive bridge | "Explain token exchange" opens `EDU.TOKEN_EXCHANGE` |
| P3 | SHOW: flow diagrams + `inspect_token` | "Show me the auth code flow" + decode a real token |
| P4 | DEMONSTRATE: `demonstrate_token_exchange`, `_scope_denial`, `_hitl` wired to real ops + live Token Chain | "Prove scopes are enforced" → real 403 + narration |
| P5 | Curriculum/skill: ordered path + checkpoints across OAuth 2.0/2.1 + OIDC | Agent can run the full §5 path end to end |

P1 alone gives a working teacher persona; each phase adds a verb's depth.

---

## 10. Open decisions

1. **Directive transport** — reuse the existing `education-open-*` custom-event mechanism, or add a
   typed `teaching_directive` SSE event? (Recommend: typed SSE event interpreted in `useAgentRun`,
   falling back to the custom-event path.)
2. **DEMONSTRATE safety** — the real ops (transfer/HITL) run against demo data; confirm the teaching
   vertical uses a sandbox user so demonstrations don't touch real balances. (They're mock data, but
   state it explicitly.)
3. **Where the learner runs it** — a dedicated `/learn` route mounting the agent in `oauth-teaching`
   vertical, or just the vertical switcher? (Recommend: a `/learn` entry that preselects the vertical.)
4. **Runtime** — default the teaching vertical to one runtime (LangChain) for consistency, or honor
   the global `llm_framework`? (Recommend: honor global; persona is runtime-agnostic.)

---

## 11. Relationship to the other plans

- `oauthPlayground/docs/FLOWS_REBUILD_PLAN.md` — rebuilds *real flow execution UIs* (browser, BFF).
- `oauthPlayground/docs/TEACHING_OAUTH_WITH_AGENT.md` — agent-as-guide anchored to those flow pages.
- **This plan** — the teaching agent *inside AI-Demo*, which is stronger for DEMONSTRATE because
  AI-Demo already runs real token exchange + delegation + HITL with live visualization. The two
  teaching surfaces can coexist: oauthPlayground teaches *flows*; AI-Demo teaches *agentic
  delegation + token chains* with live proof.

---

## 12. First step

P1 — scaffold the `oauth-teaching` vertical (manifest + plugin + Helix directive + heuristics) and
verify the teacher persona answers in-character across the existing chat UI. That proves the seam
before we wire the EXPLAIN/SHOW/DEMONSTRATE verbs.
