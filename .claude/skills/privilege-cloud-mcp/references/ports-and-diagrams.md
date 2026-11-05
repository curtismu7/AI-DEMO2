# Proxy ports and Ping's SE diagrams

Referenced from SKILL.md. 8623 is the MCP+OAuth frontend on `mcpgw` (current
binary); the `cyonproxy` table is kept for history. Also: three divergences
between Ping's SE networking diagram and our deployment.

## Reading Ping's SE diagrams — three divergences from our deployment

Ping's "Priv Networking" diagram is a K8s reference topology, not our deployment.
Copying values off it sends requests to the wrong place. It is also worth noting
that the diagram **documents its own failure**, and the cause is visible in the
picture:

```
Ingress publishes    https://cj-mcpgw.ping-devops.com:443
Gateway listens      http://mcpgw.ping-devops-cjmuir.svc.cluster.local:8680   (in-cluster only)
Priv Agent dials     https://cj-mcpgw.ping-devops.com:8680   -> "Failed to connect"
```

External hostname, internal port — nothing public listens on 8680, the Ingress
terminates 443. Stacked on that, `https://` against a listener the same diagram
labels `http://`. Our agentless path (nginx :443 → proxy plain HTTP) is the same
shape as their *working* leg, so this failure is not ours — but the three
differences below are:

| Their diagram | Ours | Trap |
|---|---|---|
| Gateway on `:8680` | MCP frontend on `:8620` | `8680` is `cyonproxy --help`'s documented `-listen` default (see `docker-compose.yml`); we run `-listen` on 8623 and the MCP frontend `-alp-port` on 8620. Their `:8680` box fills the role our 8620 does. **Settle ports by probing, never by reading their diagram** |
| MCP server `http://…/sse`, no port | `http://mcp-server:8080/mcp` | Different MCP transport — SSE vs streamable HTTP. Pasting their URL shape into the console's MCP Server URL field breaks tool discovery |
| gRPC to `proxy-us-west-2.privilege.pingone.com` | `grpc.privilege.pingone.com:443`; `CNTRLUrl=https://privilege.pingone.com` in `procyon-guest-agent.env` | Three different control-plane names in play. If egress is allowlisted to only one, a regional endpoint is blocked — and that presents exactly like the diagram's "Failed to connect" |

The diagram also puts the **Priv Agent** in the client position. That is consistent
with the Agent being a device-bound mTLS product (see "The PingOne token wall"):
Ping's reference topology shows no PingOne-OAuth MCP client at all. Read that as
evidence the token path is an unsupported topology, not as something we
misconfigured.

## Proxy ports — 8623 is the MCP+OAuth frontend on `mcpgw` (current binary)

⚠️ **This flipped with the 2026-08-12 binary swap.** On the previous binary
(`cyonproxy`) 8620 was correct and 8623 was the mTLS mesh port — that table is kept
below for history. Do not mix the two tables up.

### Current binary: `mcpgw`

| Port | Flag | Purpose |
|------|------|---------|
| **8623** | `-mcpgw` | **The MCP+OAuth frontend. Plain HTTP, emits the WWW-Authenticate challenge.** Point nginx / the BFF / k8s Service here |
| 8680 | `-listen` | Mesh, by default on this binary (differs from `cyonproxy`'s `:8680` *-alp-port* default — a coincidence of the same number meaning something else) |
| 8620 | `-alp-port` | Untested on `mcpgw`. Was the frontend on `cyonproxy`; do not assume it still is |
| 8690 | `-medusa` | gRPC tunnel (also the node's `NodeURL`) |
| 8090 | `-debug-port` | Debug API, loopback only |

Settle it by probing, never by reading vendor material or by carrying over the
`cyonproxy` table below:

```bash
curl -i -X POST http://localhost:8623/mcp -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}'
# HTTP/1.1 401 Unauthorized
# www-authenticate: Bearer realm="MCP OAuth Server", ...      <- the gateway. This is the frontend.
```

A `www-authenticate` header on that 401 is the positive signal you are on the right
port. (Verified live against another engineer's cluster running this same image by
digest — not yet re-verified against our own enrollment.)

Listing what actually binds (busybox has no `ss`/`netstat`, and `awk` here lacks
`strtonum`, so parse the hex on the host):

```bash
docker exec ai-demo-ping-mcpgw cat /proc/net/tcp /proc/net/tcp6 > /tmp/t.txt
python3 -c "
print(sorted({int(f[1].rsplit(':',1)[1],16) for f in
  (l.split() for l in open('/tmp/t.txt')) if len(f)>3 and f[3]=='0A'}))"
```

### Previous binary: `cyonproxy` — kept for history, do not use for `mcpgw`

| Port | Flag | Purpose |
|------|------|---------|
| 8620 | `-alp-port` | The MCP frontend on `cyonproxy`. Plain HTTP |
| 8623 | `-listen` | Mesh on `cyonproxy`. Speaks **mTLS** and rejects everything else |
| 8690 | `-medusa` | gRPC tunnel (also the node's `NodeURL`) |
| 8090 | `-debug-port` | Debug API, loopback only |

This table was wrong until 2026-08-08 and cost hours twice, for the same reason a
naive port-number carryover from `cyonproxy` to `mcpgw` would cost hours now. Two
traps that applied to `cyonproxy`:

- Ping's SE deck says *"proxy forwards to MCPGW runtime, often 8623 in field
  examples."* Not true of `cyonproxy`.
- Pointing nginx at 8623 (on `cyonproxy`) yielded a bare **502** with the real cause
  only in the nginx error log (`SSL_read() failed … tlsv13 alert certificate
  required`). The response body said nothing.

Do **not** try to fix a `tlsv13 alert certificate required` response by giving the
port a server certificate. That was tried on `cyonproxy`'s mesh port (PR #1465,
reverted by #1466): mounting `/procyon/ssl/mcpgw-cert.pem` + `mcpgw-key.pem` changed
nothing. A mesh/`-listen` port requires mTLS by design, full stop — on whichever
binary is running.
