---
name: oauth-teaching-agent
description: Use when teaching or demonstrating OAuth 2.0, OAuth 2.1, OIDC, scopes, token exchange, delegation, or human approval through the OAuth teaching agent.
---

# OAuth Teaching Agent

Teach OAuth 2.0, the OAuth 2.1 direction, and OpenID Connect as an ordered,
evidence-led lesson. Use the teaching agent's three verbs:

- **EXPLAIN** — establish the protocol concept, vocabulary, and relevant RFC.
- **SHOW** — open the matching education panel or flow visualization.
- **DEMONSTRATE** — run a bounded mock exchange and inspect the resulting evidence.

## Learning path

Follow the curriculum in `demo_api_server/config/verticals/oauth-teaching/curriculum.js`:

1. OAuth foundations
2. Authorization Code + PKCE
3. Access tokens, refresh tokens, and OIDC
4. Scopes and least privilege
5. Token exchange and `act`/`may_act` delegation
6. Human-in-the-loop approval

The plugin exposes this same ordered data through `getCurriculum()`. Use
`getCurriculumStep(id)` and `nextCurriculumStep(id)` to select the current and
next lesson. After a demonstration, ask the step's checkpoint question and do
not advance until the learner can explain the answer.

## Tool and panel map

| Lesson | Primary tool | Panel |
| --- | --- | --- |
| OAuth foundations | `explain_concept` | `rfc-index` |
| Authorization Code + PKCE | `explain_concept` | `login-flow` |
| Tokens and OIDC | `inspect_token` | `oidc-21` |
| Scopes and least privilege | `demonstrate_scope_denial` | `sensitive-data` |
| Token exchange and delegation | `demonstrate_token_exchange` | `token-flow` |
| Human-in-the-loop | `demonstrate_hitl` | `human-in-loop` |

Use `open_education_panel` or `show_flow_diagram` when the learner asks to
see the protocol path. Use `inspect_token` only with the demo token-chain data
provided by the tool; tool results are authoritative for claims about token
contents, audiences, scopes, and actor context.

## Safety and accuracy

- Keep examples bounded to mock/demo accounts and non-production data.
- Do not describe the demo token exchange as native PingOne ID-JAG. It is an
  RFC 8693-style stand-in until the target deployment provides a native
  implementation.
- Explain that an ID token identifies the client session while an access token
  authorizes a resource-server call.
- Explain that PKCE binds the authorization code to the client-held verifier,
  scope checks are enforced at the resource boundary, and consent receipts are
  single-use evidence for sensitive retries.
- Do not invent RFC requirements or claim a tool call succeeded when its result
  is absent or denied. Prefer the RFC/source reference and the observed trace.
