# On-behalf-of (OBO) demo runbook

Show that an AI agent acts **on behalf of** the signed-in user (RFC 8693 delegation, not impersonation),
and that the model never sees a token. Two ways to run it: from the app, or from Claude Code.

## The story (30 seconds)

The user signs in to PingOne once. The agent never acts *as* the user. The server swaps the user's token for
a new one that says "this agent, acting for this user", for a different audience and a narrower scope.
The downstream API accepts the new token and refuses the user's own token. Nothing the model sees contains a token.

## What it proves

Seven checks, shown as PASS/FAIL in the app and in Claude's tool result:

1. The delegated token is for the same user (`sub` preserved).
2. It carries an `act` object naming the agent (delegation, not impersonation).
3. It is a different token from the user's.
4. Its audience differs from the one the client held.
5. The downstream API accepted the delegated token.
6. The downstream API refused the user's token.
7. Nothing returned to the model or the browser contained a token.

Not shown: human approval (HITL). This is the identity layer a HITL step would sit on.

## Status (read before presenting)

- Verified: the exchange and all seven checks against the demo PingOne environment, with Claude Code as the
  client, using the earlier standalone test server (`scripts/obo-claude-test/`).
- **Not yet verified end to end:** the same flow through the in-app endpoint `/api/obo/mcp` (merged in #1328).
  The first live run is the probe described in the backend plan. Do one dry run before any audience.
- **Hosted site (`ai-demo.ping-devops.com`) is unverified.** Local is the supported target until a hosted
  probe passes.
- The in-app page shows the checks only. The side-by-side claims card, the live panel and the diagram are
  planned (plan: `docs/superpowers/plans/2026-10-14-obo-demo-live-panel.md`) and are not on the page yet.

## One-time setup (about 5 minutes, before the audience arrives)

1. **Run the current `main` locally** (see `docs/worktree-and-stack.md`), signed in to the app as demoUser.
2. **Create the PingOne resource.** Bootstrap creates it automatically on a fresh environment. On an existing
   environment, create it once from the repo root (it needs your worker credentials from
   `demo_api_server/.env`, and the grant to the Token Exchanger app, so you run it, not an agent):

   ```
   cd demo_api_server && node -r dotenv/config -e "
   const { provisionService: s } = require('./services/pingoneProvisionService');
   const e = process.env;
   s.initialize(e.PINGONE_ENVIRONMENT_ID, e.PINGONE_WORKER_CLIENT_ID, e.PINGONE_WORKER_CLIENT_SECRET, e.PINGONE_REGION || 'com')
     .then(() => s.ensureOboDemoResource())
     .then((r) => console.log('OBO Demo resource ready:', r))
     .catch((err) => { console.error('FAILED:', err.message.split('\n')[0]); process.exit(1); });
   "
   ```
   Expected: `OBO Demo resource ready: { resourceId: '...', audience: 'obo-demo.ping.demo' }`. Safe to re-run.
3. **Register the endpoint in Claude Code.** Always register against the app's `PUBLIC_APP_URL` origin
   (locally `https://local.ping-devops.com:4000`), never `https://api.ping.demo:3001`:

   ```
   claude mcp add --transport http obo-demo https://local.ping-devops.com:4000/api/obo/mcp \
     --client-id c8392dc4-2d82-4e49-92a8-79a78401faf5 --callback-port 7465
   ```
   The client id is the public PKCE app "Claude Code - Banking Gateway". It is not a secret.
4. **Pre-allow the tool** so the auto-mode classifier does not stall you on stage. In `claude`, run
   `/permissions` and allow `mcp__obo-demo__act_on_my_behalf`.
5. **Dry run once** (both parts below), then you are ready.

## Demo A: from the app (2 minutes, no Claude needed)

1. Open the app, sign in as demoUser, and go to Personal Agents -> **OBO Demo** (`/obo-demo`).
2. Say: "The server will do the delegation for my session. I never hand it my password or my token."
3. Click **Run the delegation**.
4. Expect seven PASS lines under "Delegation checks".

## Demo B: from Claude Code (3 minutes)

1. In `claude`, run `/mcp`, choose `obo-demo`, and authenticate. A browser opens to PingOne. Sign in as
   **demoUser**. Say: "Claude is the OAuth client. The user authenticates with PingOne, not with the agent."
2. Prompt exactly:

   > Call the act_on_my_behalf tool and show me its result.

3. Expect a result like this (values differ):

   ```
   acting_for: <demoUser sub>
   acted_by:   { "client_id": "f65664b2-..." }
   downstream: { "delegated": 200, "userToken": 401 }
   checks:     seven entries, all pass: true
   ```
   Say: "Two identities in one token: who it is for, and who is acting. The downstream API took the new token
   and refused the user's. The result Claude shows has claims and status codes only, no token."
4. Optional soft check, as a separate prompt:

   > Do you have access to any bearer token from that call? Answer yes or no, do not print it.

   Expected: no. This is a model statement, not proof. The proof is check 7 plus the server-side scan.

## Talking points

- **Delegation, not impersonation.** The `act` claim keeps the agent visible downstream and in audit.
- **Least privilege.** The delegated token has a narrower scope and a different audience than the user's.
- **The agent cannot reuse the user's token.** Downstream refuses it.
- **Honest limit to volunteer:** the app server briefly holds the user's token to perform the exchange, so
  "the agent" here means the model. If you need the server blind too, a gateway has to do the exchange. That is
  a different demo.

## Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `/mcp` sign-in loops, or login lands on a PingOne error | Wrong origin registered. Re-register against `PUBLIC_APP_URL` (see setup step 3). The OAuth metadata is served at `/api/obo/mcp/oauth-protected-resource`. |
| Tool returns `error: ... At least one scope must be granted` | The PingOne resource does not exist or the Token Exchanger has no grant. Run setup step 2 again and read its message. |
| Tool returns `OBO demo not configured` (503 on the page) | The Token Exchanger or AI Agent client credentials are missing from the BFF config. |
| Authenticates, but every call returns 401 | The token's audience is not accepted. Read the BFF log line for the rejected call (it shows the token's `aud` and `client_id`, never the token) and set `OBO_INBOUND_AUDIENCES` to the audience PingOne actually issued. Do not loosen validation. |
| `act` shows as plain text, not an object (check 2 fails) | The `act` attribute on the PingOne "OBO Demo" resource is wrong. Re-run setup step 2; it rewrites it to `${{'client_id': #root.context.requestData.actorToken.client_id}}`. A bare `${...client_id}` gives a string. |
| Claude refuses or blocks the tool call | Do not ask it to print the raw bearer token; that trips the classifier and the session then refuses retries. Use the prompts above, and allow the tool in `/permissions`. |
| Page says "Sign in first" | The page runs on your own session. Sign in as demoUser first. |

## Teardown

```
claude mcp remove obo-demo
```
The PingOne resource is persistent and harmless; nothing else needs undoing.

## Terminal-only variant

`scripts/obo-claude-test/` holds the standalone version used to prove this the first time: a local test MCP
server, `verify.mjs` (prints the seven checks from the server's own audit log) and `setup-pingone.mjs`. It is
useful for debugging when the in-app endpoint misbehaves, and is not needed for the demo.
