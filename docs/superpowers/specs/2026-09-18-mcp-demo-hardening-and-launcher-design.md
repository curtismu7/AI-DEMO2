# MCP Recovery Hardening and Demo Launcher

## Problem

The local LibreChat demo can display a persisted `503` when an MCP gateway is unavailable. The current recovery control can reconnect and clear the failed assistant message, but it needs stronger lifecycle guarantees before the demo is handed to other operators. The demo also needs a reliable, unauthenticated starting point that explains how to bring up LibreChat, confirm dependencies, and run the supported scenarios.

## Goals

- Make MCP error recovery bounded, race-safe, observable, and conservative about clearing persisted errors.
- Start a fresh MCP connection automatically from the recovery action, including the OAuth flow when the server requires authentication.
- Provide a local operator page that explains the demo and exposes safe start/open/health actions.
- Keep Docker privileges, PingOne credentials, browser tokens, and destructive operations out of the browser page.
- Preserve the existing LibreChat, BFF, MCP gateway, and PingOne boundaries.

## Non-goals

- Changing PingOne client registration, scopes, redirect URIs, or production deployment topology.
- Adding a general-purpose process-management API to LibreChat.
- Making the browser page responsible for starting Docker containers.
- Replacing the existing LibreChat UI or demo data.

## Proposed architecture

### 1. MCP recovery controller

Add a small recovery controller around the existing LibreChat MCP server manager. It will:

1. Accept the current conversation, failed message, and selected MCP server names.
2. Ignore empty names and deduplicate servers.
3. Reject a second click while the first recovery is in flight.
4. Reinitialize each selected server once with a bounded timeout.
5. Treat OAuth-required results as an authentication state, not as a successful reconnect.
6. Delete the failed assistant message only when every selected server has reconnected successfully.
7. Leave the message visible with an actionable failure state when no server is selected, authentication is required, the request times out, or any server fails.

The message deletion remains scoped to the current conversation and message ID, uses the authenticated session, and is safe to repeat if the message has already been removed. No error text or tokens will be sent to a new endpoint.

The controller will not retry indefinitely. A user can explicitly invoke recovery again after a failed attempt. This prevents an unavailable gateway from creating an OAuth or reconnect loop.

### 2. Local demo launcher

Add a small static operator page under the repository’s demo documentation/launcher surface, plus a local launcher command that:

- Starts the supported local stack using the existing project entry point.
- Opens or prints the launcher URL.
- Leaves process control in the shell, where Docker permissions and environment files already exist.

The page will use read-only HTTP health checks and links. It will contain:

- A readiness checklist for LibreChat, MongoDB, the MCP gateway, authorization service, and JWT verifier.
- Buttons for `Check services`, `Open LibreChat`, and a clearly labeled `Start LibreChat` instruction/action that points operators to the local launcher command rather than attempting privileged browser execution.
- The canonical local URL and an explicit note to use `local.ping-devops.com:4000` for browser auth flows.
- A short explanation of PingOne sign-in, MCP server selection, the Policy Guardrails agent, and the recovery control.
- A scenario table covering the normal banking flow, rentals flow, authorization-denied/403 lesson, and expected gateway outage/503 lesson.
- Copyable prompts and an operator troubleshooting sequence.

The page will not embed secrets, expose access tokens, accept arbitrary shell commands, or proxy arbitrary URLs. Health checks will be allowlisted to known local service URLs and will report unavailable services without leaking response bodies.

### 3. Startup and status contract

The launcher command will use existing Compose/profile configuration rather than duplicating service definitions. It will return non-zero when required startup or health checks fail, print the failing service, and avoid claiming readiness until the MCP gateway dependency is healthy. The page’s status view is informational and must not be treated as the readiness gate for scripts.

## Error handling

- Empty MCP selection: retain the error and explain that a server must be selected.
- OAuth required: retain the error and show the reconnect/authentication action; do not delete the failed message.
- Timeout or network failure: retain the error, show a retry action, and include the affected server name without credentials.
- Partial reconnect: retain the error and report which server failed.
- Delete failure after successful reconnect: retain the error and report that the connection is healthy but cleanup failed, so the operator can retry safely.
- Stale UI: clear local state only after the server confirms deletion; refresh should not recreate a deleted message.

## Testing and verification

### Recovery

- Unit tests for deduplication and empty selections.
- Controller tests for duplicate clicks, timeout, OAuth-required, partial failure, all-success, and delete failure.
- Existing LibreChat client tests plus production build.
- Container inspection confirming the patched recovery control is present.

### Launcher

- Script tests for command construction, failure propagation, and readiness gating.
- Static page smoke test for required copy, links, allowed health targets, and no secret-bearing fields.
- Local health verification with the MCP gateway and auth dependencies running.

### Acceptance checklist

- A fresh local start reports the stack not-ready until the gateway is healthy.
- LibreChat opens from the launcher and can complete PingOne sign-in.
- Selecting a healthy MCP server exposes tools and runs a supported prompt.
- A simulated 503 offers recovery; recovery reconnects once and clears only after success.
- An authentication failure remains visible and does not silently delete the failed message.
- Refreshing after a successful recovery does not restore the old error.

## Files and boundaries

Expected changes are limited to:

- LibreChat client override and focused tests for recovery.
- A local launcher script and its focused tests.
- A static demo/operator page and documentation.
- Existing compose/startup integration only where needed to call the supported stack entry point.

No OAuth provider or production gateway configuration changes are part of this design.
