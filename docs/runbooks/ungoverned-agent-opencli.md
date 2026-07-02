# Runbook — The Ungoverned Agent (OpenCLI + containerized sidecar)

**Purpose.** Show the "before" picture the demo's Agent Gateway solves: an AI
agent that rides the user's own logged-in browser session and moves money
through the bank UI with full user power — no agent identity, scope, consent, or
audit. Then run the same transfer through the governed agent and contrast the two.

The punchline lives in the BFF, not in any tool: every transaction records the
caller's `clientType` (`ai_agent` when it carries the agent scope + `act` claim;
`enduser` for a plain session cookie). A session-riding transfer is therefore
recorded as **indistinguishable from the human**. The page at `/ungoverned-agent`
(also listed on **Use Cases → Learn → "The Ungoverned Agent (OpenCLI)"**) has a
live "Recent transfers" widget that badges each transfer by `clientType`.

There are two ways to run the ungoverned side:
- **Part A — live, on the presenter's host:** real OpenCLI driving real Chrome.
- **Part A′ — reproducible, in the cluster:** a headless `ungoverned-agent`
  container (no presenter install). Use either or both.

---

## Prerequisites

- The demo stack running (`./run-docker.sh`), UI at `https://localhost:4000`.
- A seeded demo customer to sign in as: **`john.doe` / `password123`**
  (override via `SEED_CUSTOMER_PASSWORD` on the api-server). `john.doe` has a
  checking and a savings account — the transfer moves money between the two.
- Keep the amount **under the $250 HITL threshold** for the ungoverned run so it
  completes without a consent challenge (that's the point — nothing stops it).
- Open two tabs on the page for the reveal: the banking `/dashboard` and
  `/ungoverned-agent` (widget visible).

---

## Part A — Ungoverned, live (OpenCLI on the host)

OpenCLI needs desktop Chrome + its Browser Bridge extension + a local daemon; it
**cannot run headless or in Docker** — that limitation is itself part of the
story (it rides a *real* logged-in browser).

1. Install OpenCLI on the presenter's machine per the upstream README
   (<https://github.com/jackwener/OpenCLI>), including the Browser Bridge
   extension. To let an agent drive it: `npx skills add jackwener/opencli`.
2. In Chrome, sign in to the bank at `https://localhost:4000` as `john.doe` and
   open the `/dashboard` tab.
3. In a terminal beside the browser, tell the agent (Claude Code / Cursor with
   the opencli skill) in plain language:
   > "On the open banking dashboard tab, transfer $50 from checking to savings."
4. Watch the agent drive the logged-in tab and submit the transfer. It succeeds —
   no permission prompt, no scoped token.
5. **Reveal:** switch to `/ungoverned-agent`. The new transfer is badged
   **"Direct user session"**. Open `/monitoring` and the token-chain views —
   there is no actor token, no Authorize decision, no HITL, nothing agent-shaped.
   From the bank's side, *John did it.*

**Talking point:** this is a popular, shipping tool (25.9k★). The agent had every
privilege John has and could have drained the account; there's no way to scope,
consent, audit, or revoke it short of killing John's own session.

---

## Part A′ — Ungoverned, reproducible (containerized sidecar)

A headless-Playwright `ungoverned-agent` service **reuses a signed-in customer's
session** and drives the same transfer form. It runs **inside the cluster**,
beside the governed gateway — even here it's still just the user's session.

> **The bank APIs require a real PingOne customer session** (the demo does not
> use password grant, so a local username/password login can authenticate a
> session but cannot call the banking APIs). Give the sidecar a real session,
> which is exactly the point — a session-riding agent needs nothing more than
> the human's cookie:
>
> 1. Sign in at `https://localhost:4000` as a customer (PingOne "Customer Sign
>    In"). In DevTools → Application → Cookies, copy the **`connect.sid`** value.
> 2. Pass it to the sidecar as `UNGOV_SESSION_COOKIE` (recommended — the headless
>    browser literally rides that session and drives the UI). Alternatively pass a
>    customer OAuth bearer token as `UNGOV_ACCESS_TOKEN`.

**Docker Compose** (gated behind the `demo-attack` profile so it never
auto-starts):

```bash
UNGOV_SESSION_COOKIE='<connect.sid value>' docker compose run --rm ungoverned-agent
```

Optional overrides: `UNGOV_ACCESS_TOKEN`, `UNGOV_AMOUNT`, `UNGOV_DESCRIPTION`,
`UNGOV_UI_URL` (default `https://ui:4000`). `UNGOV_ALLOW_LOCAL_LOGIN=true` enables
the local-login path for dev deployments that accept local sessions (the default
PingOne-gated stack does not).

**Kubernetes** (one-shot Job; opt-in — `deploy.sh` does not apply it):

```bash
docker build -t ai-demo-ungoverned-agent:latest ./demo_ungoverned_agent
# kind: kind load docker-image ai-demo-ungoverned-agent:latest
kubectl apply -f k8s/80-ungoverned-agent-job.yaml
kubectl -n ai-demo logs job/ungoverned-agent -f
kubectl -n ai-demo delete job/ungoverned-agent   # before re-running
```

The container logs each step and ends with the `clientType` the demo recorded
(expected: a **direct user session**, not `ai_agent`). The same amber
**"Direct user session"** badge appears in the widget.

---

## Part B — Governed (the contrast)

1. In the bank UI, open the embedded banking agent and ask it to make the same
   transfer (e.g. "transfer $50 to my savings").
2. The governed path runs: RFC 8693 token exchange (agent acting-as John),
   narrowed `banking:write` scope, a PingOne Authorize **PERMIT**, and an
   agent-attributed audit event.
3. **Reveal:** the widget badges this transfer **"Governed agent (act-as chain)"**
   (with `acting as <agent>` when an actor claim is present). The token-chain and
   `/monitoring` views now show the full delegation and decision.
4. *(Optional)* Ask for a transfer **over $250** to trip the HITL threshold and
   show the human-in-the-loop consent challenge (HTTP 428) blocking the agent
   mid-flight — a control the ungoverned path has no equivalent for.

---

## Reset & troubleshooting

- **Reset:** transfers just move money between John's own accounts; balances
  restore from the seed on a fresh stack, or transfer back to rebalance.
- **Widget shows "Sign in as a bank customer":** the page polls
  `/api/transactions/my`, which needs a customer session — sign in as `john.doe`
  (the admin account won't work; it's `requireNotAdmin`).
- **Sidecar can't reach the UI:** confirm `UI_URL` — `https://ui:4000` on the
  Compose `ai-demo` network, `https://frontend:4000` in k8s. The container
  ignores the self-signed cert automatically.
- **Sidecar login fails:** the seed password must match `SEED_CUSTOMER_PASSWORD`
  on the api-server (default `password123`); override `UNGOV_DEMO_PASS`.
- **OpenCLI "can't run headless":** expected — it requires desktop Chrome. Use
  the containerized sidecar (Part A′) for a headless/reproducible run.

---

## Why it matters (OWASP)

The session-riding pattern leaves these OWASP "Securing Agentic Applications"
threats un-mitigated — the ones the governed path closes:
**T2 Tool Misuse · T3 Privilege Compromise · T8 Repudiation · T9 Identity
Spoofing.** See the full mapping at `/owasp`.
