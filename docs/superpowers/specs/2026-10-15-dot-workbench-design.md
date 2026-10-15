# Dot workbench page — design

**Date:** 2026-10-15 · **Status:** draft for review · **Target mock:** `dot-persona-mock.html` (static, not in repo)

## Goal

A new in-shell page for the Dot personal agent at `/personal-agent/dot`, built to the mock and styled like `/privilege-a2a`, so Dot shows its governed behaviour the way the A2A page does: who is acting, every tool call with its verdict, and what Dot remembers.

## Why

`/personal-agent/client?skin=dot` is a bare pop-out (App.js: "no nav shell"). It is one `AgentClientSkin` chat box, so it has no side nav or header, no persona facts, no tool-call evidence and no memory panel. The A2A page shows the identity → decision → evidence story; Dot's story (own identity, own memory, Ping governs only the tool calls) has no equivalent surface.

## Scope

**In:** the new page and route; persona card; chat with tool-call cards; memory panel; "What Ping governs" panel; skin tabs; Heuristics/llama.cpp toggle; light/dark; signed-out state styled to match; tests.
**Out:** the pop-out (unchanged, it is a deliberate beside-the-main-window surface); backend changes; new routes other than the page; autonomous/scheduled Dot runs; changes to other skins' pop-outs.

## Layout (from the mock)

Inside `AppShell` (side nav + header come free). Page body:

- **Title bar** (A2A workbench shell, `PrivilegeMcpClientPage.css` classes `cur-ide`/`cur-titlebar`): "Digital Assistant", skin tabs (Privilege · Claude · ChatGPT · Gemini · Persona Agent (Dot), Dot selected; the other four link to `/personal-agent?skin=<id>`), the `PageAgentModeToggle` (key `personal-agent`, as the pop-out), and the light/dark button (same `cur_priv_theme` key and main-bar sync as `PrivilegeA2aPage`).
- **Left column:** persona card, then the chat card (messages, chips, composer).
- **Right column:** "Dot's memory" card and "What Ping governs" card.
- Below 900px the columns stack.

## Components

| Unit | Responsibility | Depends on |
|---|---|---|
| `pages/DotWorkbenchPage.jsx` | page shell, theme, skin tabs, owns chat state (`messages`, `refreshNonce`) and `handleSend` | `AppShell` (via route), `PageAgentModeToggle`, `/api/agent/invoke` |
| `components/dot/DotPersonaCard.jsx` | avatar, name, "acts as", agent identity, scopes pills | persona facts (below) |
| `components/dot/DotToolCard.jsx` | one tool call: name, scope, verdict pill, `<details>` request/response or refusal reason | a `toolCall` object (below) |
| `components/dot/DotGovernsPanel.jsx` | identity, delegation, last-3-calls tally, mode | tool-call history, persona facts, agent mode |
| `DotMemoryPanel.jsx` (existing) | memory list, forget, Reset | unchanged; `refreshNonce` prop already exists |
| `DotWorkbench.css` | teal workbench styling from the mock tokens | A2A page CSS vars |

Suggested prompts reuse the four `DOT_SUGGESTIONS` already shipped (PR #1305), moved to a shared export so the pop-out and page use one list.

## Data flow

1. `handleSend(text)` posts `{ prompt, vertical: 'airlines', agentMode }` to `/api/agent/invoke` (same call as the pop-out).
2. The response is mapped to message items:
   - `reply` → a `dot` bubble; `dotMemories` → the "remembered:" chip on that bubble and bump `refreshNonce` so the memory panel refetches.
   - each name in `toolsCalled` → a `DotToolCard` with verdict **PERMIT** (a successful reply means the gate passed).
   - HTTP **403** `intent_not_authorized` → a card for the attempted action with verdict **DENY** and `message` as the "Why it was refused" text.
   - HTTP **428** (`requiresConsent`) → a card with verdict **CONSENT** and the `message`.
   - HTTP **401** → the styled signed-out state (below), no card.
3. "Last 3 calls" in the governs panel is a tally over the last three cards.

**No backend change.** Verdicts come only from what the route already returns (status code + `toolsCalled`). The mock's per-tool request/response text is shown only when the response carries it; otherwise the `<details>` is omitted rather than invented.

## Persona facts

The mock shows "Acts as carol.nguyen · Agent identity dot-agent-7f3a · Scopes miles:read · flights:book". These are shown from real data or not at all:
- **Acts as:** the signed-in user (`user.email || user.username`), or "Not signed in".
- **Agent identity / scopes:** read from the personal-agent registration the invoke route already requires (it returns "No personal agent is registered…" when absent). If that registration is not available to the page, the card shows the identity row as "—" and omits the scopes pill; it never shows placeholder values.

## Signed-out state

An inline panel inside the chat card, in the page's own palette: "Sign in to use Dot", one line of why (Dot acts on your behalf under your identity), and the app's existing Sign in action. Replaces the unstyled raw prompt seen on the pop-out.

## Error handling

Network/5xx → an error bubble ("Dot could not complete that request") and no tool card. Memory fetch failure is already silent in `DotMemoryPanel`. Malformed response → treated as reply-only.

## Testing

vitest, written first:
- renders inside the shell route with persona card, chat, memory and governs panels;
- a successful reply with `toolsCalled` renders PERMIT cards; a mocked 403 renders a DENY card with the refusal text; a 428 renders CONSENT; a 401 renders the signed-out panel and no card;
- `dotMemories` in a reply shows the chip and refreshes memory (nonce);
- chips send the prompt; theme and mode toggles work; skin tabs link to the Studio;
- no persona placeholder values appear when registration data is absent.
Plus the new-SPA-route checklist (auth-requirements.json entry, oauth-bypass ingress, e2e storageState seed), a Learning Hub / diagram check for the Dots lesson, and a browser check on a deployed frontend.

## Risks

- Verdicts are inferred from status codes, so they are coarse (PERMIT/DENY/CONSENT); per-scope verdicts would need a backend change, deliberately deferred.
- The route is public like `/personal-agent`, so signed-out behaviour must be tested, not assumed.
- Reusing `PrivilegeMcpClientPage.css` couples the page to that sheet; if its class names change the page breaks (the A2A page already accepts this).
