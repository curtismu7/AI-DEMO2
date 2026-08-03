# Privilege MCP — what is done, and the two console steps left

Companion to [`PRIVILEGE-MCP.md`](PRIVILEGE-MCP.md), which explains the architecture and
protocols. This page is the short version: where the demo stands, and exactly what has to
be clicked in the PingOne Privilege console to finish it.

Written 2026-08-02.

---

## The one-paragraph version

The Privilege MCP Gateway is a security proxy that sits in front of an MCP server. Your
demo's client page talks to the gateway, the gateway decides whether each tool call is
allowed (policy you author in the console), records the session, and forwards what it
permits to `mcp-server`. Everything on **our** side of that picture now works. The gateway
is running, enrolled, and holding an open command stream to PingOne. What is missing is on
**their** side: the console does not yet have an application telling the gateway *which MCP
server to front*, so the gateway has nothing to serve on port 8680.

---

## What is already fixed (nothing for you to do here)

| | Was | Now |
|---|---|---|
| Enrollment token | expired 2026-08-01T13:23:48Z | fresh token installed, gateway enrolled |
| Compose gateway service | crash-looped on every boot | starts and stays up |
| Failure reporting | upstream 401 shown as HTTP 500 | real status passes through |

The Compose bug is worth one line, because it explains why this never worked: the
enrollment token was mounted **read-only**, but the proxy rewrites that file at startup and
writes its certificates next to it. It died instantly every time, and because it logs to
`/var/log/procyon` instead of stdout, `docker logs` showed nothing at all. Fixed in PR #1211.

---

## What you need to do — two steps in the PingOne Privilege console

Both are console-only. Nothing in the repo can do them, and no test can cover them.

### Step 1 — delete the stale gateway node

Two proxy nodes are registered under the same address, and the live one logs a conflict
about it. The old one is from yesterday's hand-run container.

1. PingOne Privilege console → **Cloud > Gateways**
2. Open the gateway **`cmuir-mcpgw`** (proxy cluster **`ai-demo-se`**)
3. In its node list, find the node whose ID starts with **`9a8bddf5`**
   (full: `9a8bddf5-1dc6-4d3c-93c9-69fc2e2df587`, registered 2026-08-01T22:55Z)
4. Delete that node

Keep the node **`e40f4540-ac21-47f4-bfc0-47a41adb8022`** — that is the live one, registered
today at 10:32Z.

### Step 2 — attach an MCP Server application

This is the missing piece. The gateway is connected but has not been told what to front, so
port 8680 answers nothing.

1. PingOne Privilege console → **AI Security > Agentic Apps** → **Add Application**
2. Choose the **MCP Server** tile → **Integrate**
3. Fill in:

   | Field | Value |
   |---|---|
   | Frontend URL | `https://local.ping-devops.com:8680` |
   | MCP Server URL | `http://mcp-server:8080/mcp` |
   | Mesh Cluster | `ai-demo-se` (the gateway from step 1) |

   *Frontend URL* is where clients reach the gateway. *MCP Server URL* is where the gateway
   forwards permitted calls — that hostname is Docker service DNS, resolved inside the
   compose network, so it is correct as written and is not reachable from your browser.
4. Author the tool policy you want to demo, and enable **session recording** if the demo
   should show it.

That policy is the demo's payload: a DENY authored here is what makes the "Privilege
blocked the agent" moment real rather than simulated.

---

## Then tell me, and I take it from there

Once both steps are done I will:

1. Confirm the gateway starts serving — `https://local.ping-devops.com:8680` should stop
   refusing connections, and the proxy log should stop reporting
   `Error sending update to mesh controller: … not found`.
2. Repoint `PRIVILEGE_MCPGW_URL` from the cloud API to the gateway frontend. It is currently
   `https://privilege.pingone.com/api/mcp`, which is a tenant API, not a gateway — that is
   why every call returns `401 User is not authorized`.
3. Re-run the full flow: sign in with Privilege, `tools/list`, then call a tool, and report
   what policy did.

---

## Time limit

The enrollment token you pasted expires **2026-08-02T12:22:37Z**. The proxy holds it in a
writable volume and can renew itself while running, but if it lapses before the gateway is
fully wired, generate another from the console wizard
([`ping-mcpgw/RENEW-TOKEN.md`](../ping-mcpgw/RENEW-TOKEN.md)) and I will reinstall it.

## If the stack is down when you look

Something outside this session has torn the Compose stack down several times today. To
bring it back, from the repo root:

```sh
docker compose up -d                              # core stack
docker compose --profile mcpgw up -d ping-mcpgw   # the Privilege gateway
```

The gateway is behind the `mcpgw` profile, so a plain `docker compose up -d` does **not**
start it.
