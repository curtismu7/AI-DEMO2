# MCP Runtime Discovery and Dashboard Inventory

## Status

Design approved in conversation; implementation has not started.

## Problem

The dashboard needs to show both operational state and security posture for MCP
servers running in the local environment, arbitrary host processes, and
explicitly supplied remote URLs. The repository already contains an MCP
Inspector that can connect to configured HTTP or stdio servers and an MCP
scanner that evaluates tool metadata. Neither component discovers unknown
servers or produces a durable inventory for the dashboard.

The solution must not require authentication to the discovered MCP endpoints.
It must never execute tools during discovery, and it must not turn the dashboard
or BFF into an unrestricted host or network scanner.

## Goals

- Discover local Compose services and configured local listeners.
- Discover likely MCP-related host processes and MCP client configuration entries.
- Probe explicit remote URLs without credentials.
- Identify MCP protocol version, server identity, capabilities, tools, health,
  latency, and reachability.
- Detect changes and security findings in tool descriptions and input schemas.
- Present one normalized inventory to the existing dashboard/API.
- Preserve a clear distinction between observed facts, inferred candidates, and
  successful MCP probes.

## Non-goals

- Discovering arbitrary servers across the public internet.
- Guessing or collecting credentials, cookies, bearer tokens, or API keys.
- Calling MCP tools, prompts, resources, or completions as part of discovery.
- Attaching to an already-running stdio process and taking over its stdin/stdout.
- Replacing the official MCP Registry or managing/deploying MCP servers.
- Providing a complete vulnerability scanner or security certification.

## Key protocol constraint

MCP protocol discovery identifies an endpoint after a client can reach it; it is
not service location. HTTP/SSE/Streamable HTTP candidates can be probed. A
running stdio process can be identified from process and configuration metadata,
but it cannot be safely interrogated unless it was launched under a supervisor
that explicitly exposes an inspection channel. Such entries are shown as
`candidate` or `unprobed`, never as healthy MCP servers.

## Proposed architecture

```text
host / Docker / configured remote URLs
              |
              v
       mcp-discovery-agent
   candidate sources + policy
              |
              v
       safe MCP metadata probe
   discover/initialize + tools/list
              |
              +--> existing mcp-scanner
              |
              v
       normalized inventory API
              |
              v
        BFF/dashboard read path
```

### 1. Discovery agent

Add a standalone local agent under `standalone/` with a read-only HTTP API and a
periodic scan loop. The agent owns host and network access; the dashboard only
reads inventory records.

Candidate sources:

- Docker Compose service/container metadata and labels.
- Host process table and command lines, using platform-specific adapters.
- Local listening sockets from `lsof`/`netstat`-equivalent adapters.
- Known MCP client configuration files, read-only and path-allowlisted.
- Explicit remote URL configuration.
- Optional explicitly enabled CIDR and port ranges, disabled by default.

Every candidate records its source and confidence. Candidate discovery is
separate from MCP verification so a visible process is not presented as a
confirmed server.

### 2. Safe metadata probe

For each eligible HTTP-like candidate, use the existing Inspector transport
patterns and perform only:

1. TCP/HTTP reachability check with strict timeout and response-size limits.
2. MCP `server/discover` when supported.
3. Legacy MCP `initialize` fallback when required.
4. `tools/list`.
5. Optional standard health endpoint when the candidate declares one.

The probe sends no authentication headers, follows only bounded redirects, and
does not call tools or other potentially side-effecting methods. Probe failures
are classified (`unreachable`, `tls_error`, `protocol_error`, `auth_required`,
`timeout`, `not_mcp`) instead of collapsed into a generic offline state.

### 3. Security analysis

Pass the returned tool metadata through the existing `mcp-scanner` heuristics.
Store findings as evidence attached to the specific scan, including finding
kind, tool/argument, detail, and scanner version. Also compute a stable metadata
hash so schema or description drift is visible even when no heuristic finding is
present.

The dashboard must label these as heuristic findings, not proof of safety or
malice.

### 4. Inventory API

The agent exposes read-only endpoints conceptually equivalent to:

- `GET /health`
- `GET /api/inventory`
- `GET /api/inventory/:id`
- `POST /api/scan` to request a bounded rescan

The BFF should proxy or periodically ingest this data rather than granting the
browser direct access to host discovery capabilities. No endpoint should accept
credentials or arbitrary tool-invocation requests.

## Normalized inventory record

```json
{
  "id": "stable-source-and-endpoint-id",
  "displayName": "MCP Banking Server",
  "source": "compose-service|host-process|listener|client-config|remote-url",
  "confidence": "observed|inferred|configured",
  "location": "local|remote",
  "transport": "streamable-http|sse|stdio|unknown",
  "endpoint": "https://example.invalid/mcp",
  "process": { "pid": 1234, "command": "redacted-or-safe-command" },
  "container": { "name": "ai-demo-mcp-server", "service": "mcp-server" },
  "status": "healthy|degraded|offline|candidate|unprobed",
  "probe": {
    "lastAttemptAt": "2026-09-18T00:00:00.000Z",
    "lastSuccessAt": "2026-09-18T00:00:00.000Z",
    "latencyMs": 42,
    "errorCode": null
  },
  "serverInfo": { "name": "example", "version": "1.0.0" },
  "protocolVersion": "2026-07-28",
  "capabilities": {},
  "tools": [],
  "toolMetadataHash": "sha256:...",
  "securityFindings": [],
  "lastSeenAt": "2026-09-18T00:00:00.000Z"
}
```

Sensitive command-line arguments, environment variables, headers, and query
parameters must be redacted before persistence or dashboard delivery.

## Dashboard behavior

The operational view should show:

- total candidates versus verified MCP servers;
- healthy, degraded, offline, candidate, and unprobed counts;
- local versus remote and transport breakdown;
- server identity, endpoint, source, capabilities, tool count, latency, and
  last-seen time;
- a per-server probe error and evidence trail.

The security view should show:

- findings by category, with severity only when supplied by the scanner or a
  later policy layer;
- affected tool and argument;
- metadata drift since the previous successful scan;
- remote endpoints observed in schemas;
- servers that require authentication or violate the no-auth probe policy;
- an explicit heuristic disclaimer.

The dashboard must not offer a “call tool” action from this inventory surface.
Inspection and invocation remain separate capabilities in the existing Inspector
flow.

## Safety and policy controls

- No credentials, cookies, or authorization headers are accepted by discovery.
- Default remote targets are explicit URLs only.
- CIDR/port scanning is opt-in, bounded, rate-limited, and disabled by default.
- Treat locally discovered loopback/private targets as local-scope candidates;
  they are allowed only through the local discovery adapters and never through
  a browser-supplied remote URL.
- Block link-local, cloud metadata, loopback, and private-network destinations
  for remote URL probes unless the operator explicitly enables the corresponding
  remote-target policy.
- Re-check redirect destinations against the same target policy.
- Enforce DNS resolution and connection timeouts, response-size limits, and
  concurrency limits to reduce SSRF and resource-exhaustion risk.
- Do not expose Docker socket access to the BFF or browser.
- Bind the agent to loopback by default and require an explicit deployment
  setting for a network-reachable agent.
- Redact secrets and high-cardinality process data in logs.
- Treat all server-provided descriptions, instructions, and serverInfo values as
  untrusted display data.

## Error handling and lifecycle

Discovery is best-effort and idempotent. One failed candidate must not prevent
other candidates from being inventoried. Records remain visible with the last
successful observation and a current probe status. A candidate is removed only
after a configurable retention period, not after one failed scan.

The agent should expose scan generation and timestamps so the dashboard can
distinguish stale data from a completed scan. A manual rescan is asynchronous and
returns a scan identifier rather than blocking the browser request.

## Testing strategy

- Unit-test each candidate source with fixture process/config/socket data.
- Unit-test target-policy enforcement, redirect checks, redaction, and timeout
  handling.
- Use MCP fixture servers for modern discovery, legacy initialize, HTTP errors,
  auth-required responses, malformed metadata, and slow responses.
- Reuse scanner fixtures for clean metadata, hidden instructions, exfil sinks,
  and metadata drift.
- Contract-test the normalized inventory API and status/error vocabulary.
- Test that discovery never emits `tools/call` or accepts credential fields.
- Test dashboard rendering for mixed candidate, healthy, offline, remote, and
  security-finding records.

## Success criteria

- The dashboard can list all configured Compose MCP services and explicitly
  configured remote URLs without authentication.
- Host-process and listening-port candidates are visible with honest confidence
  and probe status.
- Verified HTTP MCP servers show protocol identity, capabilities, tools, health,
  latency, and last-seen data.
- Stdio candidates are never falsely shown as healthy when they cannot be
  interrogated.
- Security findings and metadata changes are visible per server.
- Discovery cannot invoke tools, exfiltrate credentials, or make unrestricted
  arbitrary network requests.
- The existing Inspector and scanner behavior remains intact.

## Implementation sequencing

1. Define the inventory schema, target policy, and redaction helpers.
2. Implement HTTP/Streamable HTTP metadata probing using existing Inspector
   transport behavior.
3. Add Compose/configured URL candidate sources.
4. Add host process and listening socket adapters with candidate-only semantics.
5. Integrate the scanner and metadata hash/diff tracking.
6. Expose the read-only inventory API and wire the BFF read path.
7. Add the dashboard operational and security views.
8. Run focused service/UI tests plus topology and hygiene checks for changed
   surfaces.
