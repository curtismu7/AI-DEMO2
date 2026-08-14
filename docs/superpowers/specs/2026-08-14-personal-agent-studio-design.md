# Personal Agent Studio — Design Spec

**Date:** 2026-08-14  
**Route:** `/personal-agent`  
**Feature flag:** `ff_personal_agent_studio`  
**Track:** Agentic (side nav, alongside Agent Lifecycle and A2A Delegation)

---

## Problem

UC38 (Personal Agent Concierge) exists as a chip in the Airlines vertical but has no dedicated surface to tell the full story:

> "We don't control the agent the user is running. We control the gates it must pass through."

The current demo shows MFA + RFC 8693 delegation inline in the chat window — the security story is buried in the Flow Inspector. There is no visual proof that the agent client is a separate, independent entity, and no way to show that the same gates fire regardless of which AI client the user chooses (Claude, ChatGPT, Gemini, or Privilege).

---

## Goals

1. Make the agent client visually independent from the app (real separate browser window).
2. Show three security gates firing live as the agent sends messages.
3. Let the presenter switch client skins (Privilege, Claude-look, GPT-look, Gemini-look) to prove the gates are client-agnostic.
4. Provide a "movie roll" replay of the token chain for explanation mode.
5. Give the use case its own side-nav entry so the full demo can start from one place.

---

## Layout — three states

### State 1: Full Agent (default)

Full-width agent client. No security rail. This is the "user's view" — what the end user sees when they open their AI assistant.

```
┌──────────────────────────────────────────────────────────────────┐
│ [Privilege] [Claude] [ChatGPT] [Gemini]      [⊟ Split] [⤢ Pop Out] │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   Full-width agent client (Privilege skin by default)            │
│   • Header: logo + title + "Pop Out" button inline               │
│   • Chat history + typing animation                              │
│   • Input with send                                              │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### State 2: Split (after clicking ⊟ Split)

Agent client left (~55%), security rail right (~45%). Both visible simultaneously. The presenter narrates what the rail shows while the agent runs.

```
┌─────────────────────────┬───────────────────────────────────────┐
│  Agent client           │  Security Gates                       │
│  (resizable)            │  🔐 MFA AuthN          ✅ PASS        │
│                         │  🪟 Gateway Token      ⟳ CHECKING    │
│                         │  ✅ P1AZ Authorize     — WAITING      │
│                         │  ─────────────────────────────────    │
│                         │  [RFC 8693 act claim badge]           │
│                         │  [token events scroll]                │
│                         │  [▶ Replay]                           │
└─────────────────────────┴───────────────────────────────────────┘
```

### State 3: Popped Out (after clicking ⤢ Pop Out)

`window.open()` launches a real browser window (480×700) containing only the agent client — no nav, no page shell, no security rail. The main page transitions to full-width security rail.

```
Main page:                          New OS window:
┌─────────────────────────────┐     ┌──────────────────────┐
│  Security Gates (full width)│     │  Privilege AI Agent  │
│  🔐 MFA AuthN      ✅       │     │  [chat UI only]      │
│  🪟 Gateway Token  PERMIT   │     │  ● Live              │
│  ✅ P1AZ Authorize PERMIT   │     │                      │
│  [token events]             │     │  [messages]          │
│  [act claim]                │     │  [input]             │
│  [▶ Replay]                 │     └──────────────────────┘
│                             │
│  "Agent active in external  │
│   window — events live"     │
└─────────────────────────────┘
```

**Demo moment:** Presenter pops the Privilege window to a second monitor. Audience sees the agent typing on one screen, the three security gates lighting up on the other. The point — *we don't control that window; we control what it must pass through* — is self-evident.

---

## Client skins

Four skins. Same backend. Same MCP gateway. Same security gates. Different brand chrome.

| Skin | Colors | Logo | Subtitle bar |
|---|---|---|---|
| Privilege | Ping blue (`#0073e6`) | Ping P mark | "Connected to Airlines MCP · MFA verified" |
| Claude | Rust/amber (`#d97941`) | "C" gradient circle | "claude-sonnet-4-5 ▾" |
| ChatGPT | OpenAI green (`#10a37f`) | OpenAI SVG mark | "GPT-4o ▾" |
| Gemini | Google gradient | "G" gradient square | "Gemini 2.5 Pro ▾" |

Skins apply: header background, logo, title color, chat bubble colors, input area, typing dot color. The chat input hint for non-Privilege skins reads: *"[Brand] does not control what this message can access — see security rail →"*

Light and dark mode apply on top of skins via CSS custom properties on `:root.light`.

---

## Security rail

Always visible in Split and Popped-Out states.

### Three gates

Each gate is a card with: icon · name · description · live status badge.

| # | Name | What it checks | Source |
|---|---|---|---|
| 1 | AuthN: MFA Required | `req.user.acr` matches `/multi.factor\|mfa/i` | BFF `agentInvokeRoute.js` |
| 2 | Gateway: Token Validation | Audience, `act` claim presence, RFC 7662 introspection | `demo_mcp_gateway` |
| 3 | PingOne Authorize | Personal-agent policy: agent identity + loyalty tier + action scope | P1AZ |

Status values: `WAITING` (grey) → `CHECKING…` (blue pulse) → `PERMIT` (green) / `DENY` (red).

### RFC 8693 act claim badge

Persistent box below the gates showing the decoded delegated token shape:

```json
{
  "sub": "user:alice@demo.ping",
  "act": { "sub": "agent:privilege-ai-7f2a" },
  "scope": "airlines:read airlines:write",
  "acr": "urn:acr:mfa"
}
```

### Token event scroll

Live feed of `tokenEvents` from the BFF — same events as the Flow Inspector but scoped to this session. Auto-scrolls as events arrive.

### Replay button

Replays the last session's events in slow motion (350ms stagger per event, gate status badges re-animate in sequence). The "movie roll" — lets the presenter walk the audience through what happened after the fact.

---

## Pop-out window

`window.open('', '_blank', 'width=480,height=700,left=200,top=100,resizable=yes')` followed by `document.write()` injecting a self-contained HTML page.

The pop-out window:
- Receives the active skin and theme (light/dark) from the parent at open time.
- Has a green "● Live" badge in its header.
- Shows the conversation already in progress (greeting + user message + typing animation).
- Typing animation resolves to an in-character agent response after 2s.
- Input works — sends a message, gets a contextual reply.
- Has no knowledge of the parent's security rail — it is genuinely a standalone window.

When the pop-out is opened, the main page transitions to State 3 (full-width security rail) and shows: *"Agent active in external window — token events live."*

---

## UC38 tile integration

The existing UC38 tile in the foundations use-case grid gets a **"Launch Studio →"** button (secondary action below the chip trigger). Clicking it navigates to `/personal-agent?vertical=airlines&flag=ff_personal_agent_concierge`, which pre-selects the Airlines vertical, auto-arms the flag, and focuses the Privilege skin.

The chip trigger on the UC38 tile continues to work as before (fires directly into the chat without navigating away), for users who want the inline Flow Inspector experience instead.

---

## Side nav entry

New item in the **Agentic** nav section:

```
Agentic
  Agent Lifecycle
  A2A Delegation
  Personal Agent        ← new
```

Route: `/personal-agent`. No auth guard (same pattern as `/pingcli`).

---

## Feature flag

`ff_personal_agent_studio` (boolean, default off). Hides the nav entry and the "Launch Studio →" button on the UC38 tile when off. The existing `ff_personal_agent_concierge` flag continues to gate the chip/BFF delegation path independently.

---

## Files touched

| File | Change |
|---|---|
| `demo_api_ui/src/pages/PersonalAgentStudioPage.jsx` | New — the studio page (all three states) |
| `demo_api_ui/src/pages/PersonalAgentClientWindow.jsx` | New — minimal page rendered into pop-out window (or served at `/personal-agent/client`) |
| `demo_api_ui/src/components/SecurityRail.jsx` | New — three gates + act badge + token event scroll + replay |
| `demo_api_ui/src/components/AgentClientSkin.jsx` | New — renders one of four skins given `skin` + `theme` props |
| `demo_api_ui/src/App.js` | Add `/personal-agent` route (public, no auth) |
| `demo_api_ui/src/components/AdminSideNav.jsx` | Add nav item under Agentic, gated by `ff_personal_agent_studio` |
| `demo_api_server/routes/featureFlags.js` | Add `ff_personal_agent_studio` to `FLAG_REGISTRY` |
| `demo_api_server/config/useCases.js` | Add `studioPath` field to UC38 entry |
| `demo_api_ui/src/config/demoUseCaseSteps.js` | No change — UC38 already in primary list |

No BFF changes beyond the flag registration. Token events already flow through the existing `buildTokenEvent` + Flow Inspector pipeline; the security rail subscribes to the same SSE/polling endpoint.

---

## Not in scope

- Real-time WebSocket channel between pop-out window and parent page (token events arrive on the parent via the existing polling mechanism; the pop-out is a display-only mock of an external client).
- Actual Claude/GPT/Gemini API connections — skins are UI chrome only, all calls go to the same BFF agent invoke endpoint.
- Mobile layout.
- The "chaining / movie roll" beyond the Replay button on the security rail (multi-use-case chain is a separate feature).
