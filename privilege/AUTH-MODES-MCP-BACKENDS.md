# Auth modes for MCP backends

October 9, 2026 · guide

What each Auth Mode on an MCP Server application sends to the *backend*, which
ones are verified on our build, and how to choose. The companion guide
[`GATEWAY-A2A-AUTH-MODES-COMPARED.md`](GATEWAY-A2A-AUTH-MODES-COMPARED.md) does
the same for the Remote-Agent half of A2A; this one is the MCP-backend half.
Auth Mode is configured per application (console, Add/Edit MCP Application) and
is **separate from how clients authenticate to the gateway** — with the one
OAuth exception below.

## The modes

| Auth Mode | What the backend receives | Verified? |
|---|---|---|
| **None** | No `Authorization` header at all. Not the caller's bearer, and nothing in its place | Yes — the default in every tested app (2026-10-02..04) |
| **Static Token** | `Authorization: Bearer <the token you configured>` | Yes — with a value (aggregate test, 2026-10-04) and empty (three live apps) |
| **User Token** | The credential stored for that user+app in the user's Privilege vault; **nothing forwarded if none is stored** | No — console description only |
| **Pass Agent Token** | The caller's workload assertion; refuses (`-32603`-style refusal in the log, `requires token-pass`) any session without one | No — for A2A it was measured refusing (2026-10-03); the MCP-backend variant is untested |
| **OAuth** | Not established on our build | **Avoid** — see the warning |

The A2A comparison's decision logic carries over: match the mode to what the
backend checks — nothing (trusts the gateway), a shared secret (Static Token),
per-user credentials (User Token), the caller's own identity (Pass Agent
Token), or its own sign-in (None + the backend does OAuth itself).

## What a tested call actually delivered (Auth Mode None)

Every header the client sent **except `Authorization` and `Accept-Encoding`**,
plus one the gateway adds: `X-Procyon-Mcp-Cap`, carrying the tools the policy
allows this user. Custom headers arrive unchanged, and `x-forwarded-for`
carries the caller's real address; `x-forwarded-host` arrives **empty** — do
not key anything on it.

That enables the pass-through pattern: the client puts a user's token in a
*custom* header, the gateway forwards it, the backend verifies it. The bearer
slot stays empty (None) or holds the shared secret (Static Token). A backend
should only trust such a header when the shared secret is also present —
otherwise anyone who can reach the backend can forge it.

## The verified instances in this stack

| Instance | Mode | Why |
|---|---|---|
| `mcp-server` (demo backend, both apps) | Static Token, **empty** | Backend runs `MCP_AUTH_DISABLED=true`; the internal hop is deliberately open, Privilege enforces policy at its own layer |
| banking-rest sidecar app | **None** | The sidecar attaches the real `X-API-Key` itself; Privilege never sees the key |
| Aggregate member (2026-10-04) | Static Token with a value | The backend expected a bearer; every tool failed `Unauthorized` under None; switching the member to Static Token (and the backend to accept it) fixed all three tools — nothing changed on the aggregate |

That last row is the pattern proof: **a backend that requires a bearer needs
its app on Static Token with that bearer**. The gateway connects to members as
the calling user; the mode decides what credential that connection carries.

## The OAuth warning

On build `v1.260906`, setting Auth Mode to OAuth on an MCP app also gated the
**client** side: a tokenless `initialize` returned 401, the console's own
discovery hit the same wall, the Tools panel went empty — and the OAuth client
credentials entered in the wizard were rejected by the gateway's own token
endpoint. Reverting to None restored discovery. Avoid OAuth mode until
re-confirmed on a newer build.

## Choosing

- **Backend trusts the gateway** (private network, `MCP_AUTH_DISABLED=true`):
  None or Static Token with an empty value — both observed working; empty
  Static Token documents the intent.
- **Backend requires one shared bearer**: Static Token with the value, and the
  backend checking it. Proven in the aggregate test.
- **Backend needs per-user credentials**: User Token is the designed mode —
  store the credential per user+app in the Privilege vault — but it is
  **untested**; verify with one user before relying on it. An empty vault
  forwards *no* credential, which fails silently as a backend auth error.
- **Backend should see the calling agent's identity**: Pass Agent Token —
  untested for MCP backends; on Remote Agents it refuses any session without a
  workload assertion (see the gap statement in
  [`WORKLOAD-IDENTITY-AGENT-CALLERS.md`](WORKLOAD-IDENTITY-AGENT-CALLERS.md)).
- **Backend does its own OAuth**: None, and let the backend verify a
  pass-through custom header, or hold the flow itself. Do not use the app's
  OAuth mode on this build.

## Verification matrix

| Claim | Source | Status |
|---|---|---|
| None sends no `Authorization`; header pass-through minus `Authorization`/`Accept-Encoding`; `X-Procyon-Mcp-Cap` added; `x-forwarded-for` real; `x-forwarded-host` empty | Measured on a live call, 2026-10-02 (`GATEWAY-REGISTERING-AN-MCP-SERVER.md`) | Verified |
| Static Token (empty) works against `MCP_AUTH_DISABLED=true` backend | Live apps `cmuir` + `external`, verified 2026-08-20/24 | Verified |
| Static Token (with value) fixes a bearer-expecting backend through an aggregate | Live test 2026-10-04 (`GATEWAY-AGGREGATE-APPS.md`) | Verified |
| User Token forwards the per-user vault credential (and nothing when absent) | Console description | Untested |
| Pass Agent Token on an MCP backend behaves as on Remote Agents | A2A refusal measured; MCP variant not | Untested |
| OAuth mode usable on the current build | Broke discovery + client access on `v1.260906` | Broken as of 2026-09-06; avoid |
