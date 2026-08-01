# Renew Expired Privilege Proxy Token

The enrollment token (`ping-mcpgw/config/proxy-token`) expired **2026-07-31T13:51:03 UTC**.
The proxy won't connect until it's replaced.

## Step 1 — Get a fresh token

1. Go to **https://console.pingone.com** → sign in
2. Navigate to **Cloud > Gateways**
3. Find gateway **cmuir-mcpgw**
4. Click **Add Node** (or refresh icon on the existing node row)
5. Copy the `ENV_PROXY_TOKEN=eyJ...` JWT from the wizard

## Step 2 — Save the token

```bash
printf '%s' 'eyJ...<paste full JWT>' > ping-mcpgw/config/proxy-token
```

This file is gitignored — never commit it.

## Step 3 — Clear stale enrollment state

The Docker volume has old `proxy-config.data`. The proxy ignores the new token
unless this is removed.

```bash
docker compose --profile mcpgw stop ping-mcpgw
docker volume rm ai-demo2_mcpgw-ssl 2>/dev/null || true
```

## Step 4 — Restart

```bash
export PRIVILEGE_PROXY_TOKEN="$(cat ping-mcpgw/config/proxy-token)"
./run-docker.sh optional start mcpgw
```

## Step 5 — Verify

```bash
docker logs ai-demo-ping-mcpgw 2>&1 | grep -iE "enrolled|connected|ready|error"
```

Should show "enrolled" or "connected".

## Step 6 — End-to-end test

1. Browse to `https://local.ping-devops.com:4000/privilege-mcp-client`
2. Sign in as `cmuir+ssoEndUser@pingone.com`
3. Call a tool

If you get **"User is not authorized"** — the proxy is healthy but the user
needs a policy in the Privilege console:
AI Security → Agentic Apps → your MCP App → Policies.

## Key gotcha

The `mcpgw-ssl` volume is the #1 reason re-enrollment silently fails.
The proxy always prefers persisted state over the token file — **you must
delete the volume before re-enrolling**.

## Error: 500 "not found" on enrollment

```
Error connecting to https://privilege.pingone.com: HTTP error: 500 Internal Server Error
"error": "not found", "code": 2, "message": "not found"
```

This means the **node referenced by the token was deleted** on the Privilege side.
The token contains a `nodeId` that no longer exists in the gateway's node list.

**Fix:** Go to the Privilege console → Cloud > Gateways → open your gateway →
click **Add Node** to generate a fresh token for a *new* node. If the gateway
itself was deleted, recreate it first (Add New → Add via Docker).

The token issued 2026-08-01 (nodeId `affdbc0f-...`) hit this exact error.

## Error: "Unauthorized" on MCP server discovery

After successful enrollment, the Privilege console shows:

```
Error discovering MCP server: calling "initialize": sending "initialize": Unauthorized
```

This means the proxy connected to the control plane but the **upstream MCP server
rejected the forwarded request**. Two causes:

### Cause A — mTLS is enabled on the MCP server

The Privilege proxy doesn't carry the gateway mTLS client cert. The MCP server
drops the connection as unauthorized.

```bash
# Check:
docker exec ai-demo-mcp-server env | grep MCP_MTLS

# Fix — disable mTLS for the Privilege path:
MCP_MTLS_ENABLED=false docker compose up -d --no-deps mcp-server
```

### Cause B — MCP Server URL points at PingGateway instead of the MCP server

The MCP server allows **unauthenticated** `initialize` and `tools/list` calls
(discovery methods). But if the MCP Application in the Privilege console has its
**MCP Server URL** pointed at PingGateway (`http://ping-gateway:8080/mcp` or
`https://api.ping.demo:3036/mcp`), the gateway enforces its own token validation
and returns 401 — the Privilege proxy has no delegated token for PingGateway.

**Fix in the Privilege console:**
1. Go to **AI Security → Agentic Apps** → your MCP Server app
2. Set **MCP Server URL** to `http://mcp-server:8080/mcp` (internal compose DNS,
   bypasses PingGateway — Privilege IS the security boundary, not PingGateway)
3. **Auth Mode**: Static Token (leave the value blank) or None
4. Click **Discover** — tools should appear within ~30s

> **Key insight:** Do NOT stack Privilege behind PingGateway. The Privilege proxy
> must hit the MCP server directly. PingGateway and Privilege are alternative
> gateways — use one or the other for a given request path, not both.

### After discovery succeeds

Once tools are discovered:
1. Create a **Policy** in the MCP App → assign to user `cmuir+ssoEndUser@pingone.com`
2. Enable **Session Recording** if you want the demo to show recorded sessions
3. Test from the UI at `/privilege-mcp-client`

## Check current token expiry

```bash
cat ping-mcpgw/config/proxy-token | cut -d. -f2 | base64 -d 2>/dev/null | python3 -c "
import sys, json, datetime
d = json.loads(sys.stdin.read())
exp = datetime.datetime.fromtimestamp(d['exp'], tz=datetime.timezone.utc)
now = datetime.datetime.now(tz=datetime.timezone.utc)
status = 'EXPIRED' if now > exp else 'valid'
print(f'{status} — expires {exp.isoformat()} ({\"%.1f\" % ((exp-now).total_seconds()/3600)}h from now)')
"
```
