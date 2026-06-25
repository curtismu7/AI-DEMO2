# Smart Health Diagnostic Panel — Server Check Modal

**Date:** 2026-06-23  
**Status:** Design  
**Scope:** Enhance DemoServerCheckModal with root-cause diagnostics and ordered recovery suggestions

---

## Overview

When services fail to start, users currently see a modal listing commands but no guidance on *why* services are down or *which to fix first*. This design adds a diagnostic panel that:

1. **Diagnoses** — analyzes logs, health endpoints, and process state to identify root causes
2. **Prioritizes** — orders services by dependency chain (fix this → then that)
3. **Suggests** — recommends specific recovery commands for each failure

**User journey:** "Services down" modal appears → user scrolls to "Why are services down?" panel → sees "Port 3001 conflict, try this command" → copies command → services recover.

---

## Architecture

### Backend: New Endpoint `/api/health/demo-diagnostics`

**Route:** `POST /api/health/demo-diagnostics` (or `GET` if stateless)

**Input:** None (or optional `{services: ["api_server", "mcp_server"]}` to limit scope)

**Output:**
```json
{
  "timestamp": "2026-06-23T10:15:30Z",
  "diagnostics": [
    {
      "key": "api_server",
      "name": "Banking API Server",
      "up": false,
      "rootCause": "EADDRINUSE: port 3001 already listening",
      "logSnippet": "Error: listen EADDRINUSE :::3001",
      "suggestedFix": "./run-docker.sh restart --aggressive demo-api-server",
      "priority": 1,
      "dependsOn": null
    },
    {
      "key": "mcp_server",
      "name": "Banking MCP Server",
      "up": false,
      "rootCause": "ECONNREFUSED: upstream (api_server) not healthy",
      "logSnippet": "connect ECONNREFUSED 127.0.0.1:3001",
      "suggestedFix": "Fix Banking API Server first (see above)",
      "priority": 2,
      "dependsOn": "api_server"
    }
  ],
  "analysisMs": 523
}
```

### Implementation Strategy

**Phase 1: Log Analysis**
- Read `/tmp/demo-api.log`, `/tmp/mcp-server.log`, etc. (last 100 lines)
- Pattern-match against known error signatures (see Diagnostic Rules)
- Extract error message and line context

**Phase 2: Health Check Fallback**
- Call existing `/api/health/demo-status` endpoint
- If BFF is down, skip this phase
- Extract HTTP status + response body (timeouts, 5xx, etc.)

**Phase 3: Process State**
- Check if service processes exist (`ps aux | grep`)
- Check if ports are listening (`lsof -i :PORT`)
- Detect zombie processes or hung listeners

**Execution:** All three phases run in parallel; combine results by priority.

---

## Frontend: Diagnostic Panel Component

### Structure

**Location in Modal:** After individual server cards, before footer

**Visibility:** Only renders if `diagnostics.length > 0`

**Component Tree:**
```
<DiagnosticPanel>
  <PanelHeader>
    Why are services down?  [▼ collapse]
  </PanelHeader>
  
  <DiagnosticList>
    {diagnostics.map(d => (
      <DiagnosticItem key={d.key}>
        <ServiceName>{d.name}</ServiceName>
        <CauseRow>
          Cause: {d.rootCause}  [show log snippet]
        </CauseRow>
        <ActionRow>
          Fix: {d.suggestedFix}  [copy button]
        </ActionRow>
        {d.dependsOn && (
          <DependencyNote>
            (Blocked by {dependencyName} — fix that first)
          </DependencyNote>
        )}
      </DiagnosticItem>
    ))}
  </DiagnosticList>
  
  <PanelFooter>
    Analysis took {analysisMs}ms
  </PanelFooter>
</DiagnosticPanel>
```

### Styling

- **Panel container:** light red/amber background (`#fff5f5` or `#fffbeb`), matching existing server card errors
- **Service name:** bold, same color as server card headers
- **Root cause:** monospace font, gray text, with subtle code-block background
- **Suggested fix:** same copy-button styling as deployment commands above
- **Dependency note:** italic, smaller font, lighter color

### Interactivity

1. **Expand/collapse:** Click header to toggle panel visibility (persists across polls)
2. **Copy fix:** Click copy button next to command (same 2-second flash as deployment commands)
3. **Show log snippet:** Click "show log snippet" link → inline <pre> expands with last 5 lines of error context

### Polling Integration

- Diagnostic panel updates on the same 5-second poll interval as server status
- Shows a light loading state ("Analyzing..." or spinner) while backend processes
- If diagnostics endpoint returns 5xx or times out, silently degrade (don't show panel)

---

## Diagnostic Rules

Pattern-matching rules for common startup failures:

| Error Pattern | Root Cause Label | Suggested Fix |
|---------------|------------------|---------------|
| `EADDRINUSE.*3001` | Port 3001 already listening | `./run-docker.sh restart --aggressive demo-api-server` |
| `EADDRINUSE.*8080` | Port 8080 already listening | `./run-docker.sh restart --aggressive mcp-server` |
| `ECONNREFUSED.*3001` | Cannot connect to BFF (port 3001) | Fix Banking API Server first |
| `ECONNREFUSED.*8080` | Cannot connect to MCP server | Fix Banking MCP Server first |
| `timeout.*5000ms` | Health check timed out (5s) | `./run-docker.sh restart <service>` |
| `VAULT_PASSWORD` (missing) | Missing required env var | `export VAULT_PASSWORD=...` |
| `Cannot find module` | Build artifact missing | `./run-docker.sh build <service>` |
| `ENOTDIR.*certs` | TLS cert directory missing | `./run-docker.sh` (auto-generates) |
| `no such file` | Config file missing | Check `.env` file exists and is readable |

**Fallback:** If log doesn't match any pattern, show raw error message (first 120 chars) + generic fix ("Check logs for details")

---

## Data & State Flow

```
Modal mounts
  ↓
Poll loop (5s intervals) calls:
  1. /api/health/demo-status          (existing — service up/down)
  2. /api/health/demo-diagnostics    (new — root causes + fixes)
  ↓
Frontend receives both responses
  ↓
Render server cards (from demo-status)
Render diagnostic panel (from demo-diagnostics, if .length > 0)
  ↓
User clicks copy button on suggested fix
  ↓
User opens terminal, runs command
  ↓
5s poll interval fires again
  ↓
Backend re-analyzes, diagnostics update/disappear
```

---

## Error Handling

**Backend analysis fails:**
- If `/api/health/demo-diagnostics` returns 5xx or times out (>2s), silently skip rendering the panel
- Log the error server-side for debugging
- Modal still shows deployment commands (fallback to old behavior)

**Log files don't exist:**
- Skip log analysis phase, continue with health check + process state
- Diagnostics will be based on health endpoint data only

**Endpoint is unavailable (e.g., BFF isn't running):**
- Return empty `diagnostics: []` (or error field)
- Modal shows no diagnostic panel; user sees only deployment commands

---

## Testing Strategy

### Unit Tests (Backend)

1. **Pattern matching:** Test each diagnostic rule against sample log lines
2. **Priority sorting:** Verify dependency chain is respected (BFF before MCP)
3. **Fallback:** Test behavior when log files are missing or unreadable

### Integration Tests (E2E)

1. **Port conflict scenario:** Start service on port 3001, call `/api/health/demo-diagnostics`, verify it detects EADDRINUSE
2. **Dependency chain:** Stop BFF, call diagnostics, verify MCP shows "blocked by BFF"
3. **Recovery loop:** Diagnostics → user runs command → poll → diagnostics disappear

### Manual Testing

1. Run `./run.sh` with one service pre-failed (e.g., port already bound)
2. Observe modal appears with diagnostic panel showing the conflict
3. Confirm suggested command works and diagnostics clear on next poll

---

## Dependencies & Constraints

- **No new dependencies:** Uses existing log files and health endpoints
- **Performance:** Analysis must complete in <1s (runs in parallel, doesn't block poll)
- **Safety:** No destructive operations (diagnostics are read-only)
- **Offline mode:** Works without external calls; fully self-contained

---

## Success Criteria

1. ✅ Modal shows diagnostic panel when services are down
2. ✅ Panel identifies root cause for common failures (port conflict, timeout, missing env)
3. ✅ Services are ordered by dependency (fix BFF before MCP)
4. ✅ Suggested fixes are accurate (command runs and recovers service)
5. ✅ Users can copy fixes directly from modal
6. ✅ Panel updates automatically as services recover

---

## Future Extensions

- **Log streaming:** Show live tail of service logs in expandable section
- **Auto-fix:** Add "Attempt auto-recovery" button that runs suggested command via CLI bridge
- **Custom rules:** Allow operators to define org-specific diagnostic patterns via config file
- **Metrics:** Track most common failure modes for reporting
