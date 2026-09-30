# External agent registers via CIMD — PingFederate lane beside the mock PingOne lane

Status: draft for review. Extends UC43 (`consumer-partner-agent-cimd-registration`); no new use-case ID.

## Goal

A CIAM story: a customer uses an external AI agent (not ours). The agent discovers how to reach the protected resource, identifies itself by its own metadata URL, is registered on first contact, and ends up linked to that customer. Show real PingFederate CIMD next to the existing mock PingOne CIMD, on the CIMD panel and in UC43.

Specs in play (state them correctly in the UI): RFC 9728 (Protected Resource Metadata) is the discovery entry; RFC 8414 (AS metadata) advertises support; CIMD is the IETF draft `draft-ietf-oauth-client-id-metadata-document` (not an RFC); RFC 7591 is the DCR comparison.

## Story (UC43, per lane)

1. Signed-in customer opens Agent Builder, chooses "Connect an external agent", picks the agent (stand-in "Acme Travel Agent"; LibreChat optional, see Open items).
2. **Discovery (RFC 9728):** the agent calls the protected resource without a token, gets `401` with `WWW-Authenticate: Bearer resource_metadata="..."`, fetches the Protected Resource Metadata, reads `authorization_servers`. For the PingFederate lane that list names the PF issuer; for the mock lane it stays PingOne (current behaviour).
3. **AS check (RFC 8414):** the agent fetches the AS metadata and looks for `client_id_metadata_document_supported`.
4. **Registration lane:**
   - Mock PingOne: today's facade (BFF registers via Management API), badged `mock`.
   - PingFederate: `client_id` = the agent's metadata URL; PF fetches it, creates an ephemeral client, customer consents. Badged `pingfederate`.
5. The agent is recorded in the inventory, owner = the customer, `engine` = `mock` | `pingfederate`.

## Components

- **Stand-in external agent (server):** own metadata route and redirect callback under a distinct path from the first-party `pf-ai-agent` client, so it reads as third-party. Metadata route records each fetch (time, user agent) as evidence that PF really fetched it.
- **PRM for the PF lane (server):** a second Protected Resource Metadata document (and matching `401` challenge) whose `authorization_servers` is the PF issuer. The existing PingOne PRM in `routes/protectedResourceMetadata.js` is unchanged.
- **PF lane flow:** reuse `pfAiAgentCimdService` begin/complete, parameterised by which agent's metadata URL and callback to use. Do not fork it.
- **Registration record:** existing `agentRegistryService` record gains `engine`.
- **CimdSimPanel (UI):** the "PingOne" tab becomes an engine comparison (mock PingOne | PingFederate). Simulate gets an engine selector; the PF variant shows real evidence (the recorded fetch, the real redirect) instead of the scripted step. Mock copy ("PingOne does not natively fetch CIMD") stays.
- **Agent Builder (UI):** lane picker on the external-agent flow.
- **Skill:** a short `pingfederate-cimd` skill (CIMD Settings enable, CIMD Policy with a metadata-URL pattern matching the agent's URL, same style as `pingfederate-id-jag`), copied to `se-skills-export/`.

## Honesty rules

- PF lane not configured: lane disabled with the reason. Never fall back to the mock while labelled real.
- The engine badge is always shown and always true.

## Out of scope

- Using the PF-issued token against the BFF banking API (its audience checks trust PingOne; the PF path there is ID-JAG). The demo stops at registration, consent and token issuance evidence.
- Changing login, session, or token-exchange code.

## Testing

- jest: stand-in metadata/callback routes, PRM variant and challenge, parameterised PF flow, registration `engine`. Scoped runs only.
- vitest: CimdSimPanel engine comparison and selector, Agent Builder lane picker; `npm run build`.
- Live: pin `stack:generation`, Super Sports vertical, drive both lanes.
- `npm run authz:verify` and the use-case generation checks if UC43's source-of-truth entries change.

## Open items (verify before or during build)

1. Does PingFederate 13.1 advertise `client_id_metadata_document_supported` in its AS metadata? The fetched PF docs do not say. If not, the AS-check step (3) shows it as "not advertised" for the PF lane rather than faking it.
2. LibreChat: spike whether it can start authorization with a URL `client_id`. If not, drop that variant and say so.
3. CIMD policy URL pattern must match the stand-in's metadata URL on the deployed host (PF requires https except loopback).
4. A live PF lane needs a reachable PingFederate 13.1 with CIMD enabled; without one, only the disabled state and unit tests can be verified.
