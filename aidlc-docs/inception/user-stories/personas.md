# Personas

## P1 — Demo presenter (primary)
- **Role**: Runs the banking demo for an audience
- **Goal**: Show a narrow read-only MCP tool + chip without auth surprises
- **Needs**: Predictable chip label, human-readable result, no JSON dump

## P2 — Authenticated retail user
- **Role**: Logged-in customer using the AI assistant
- **Goal**: See a friendly account nickname quickly
- **Needs**: Works without typing accountId; sensible fallback if nickname missing

## P3 — Agent integrator (secondary)
- **Role**: Builds or tests LangChain / external agent against MCP
- **Goal**: Call `get_account_nickname` via gateway with `read` scope
- **Needs**: Stable tool schema; optional `accountId`; documented fallback rules
