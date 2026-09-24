# PF Standard Two-Exchange Design

## Goal

Make ordinary PingFederate demo runs follow the same two-hop RFC 8693 delegation contract as PingOne. Keep PingFederate-only endpoint, client-authentication, and policy-derived audience details inside a PF provider adapter. The explicit PF ID-JAG demo remains a separate run-selected path.

## Token contract

For a given standard demo step, both providers must preserve the user `sub`, issue an ordinary access token (never ID-JAG), target the same effective final resource audience, and carry the same requested tool scopes (subject to documented provider policy limits). Both flows must include the two exchange hops: user token plus agent actor token to an intermediate token, then intermediate token plus MCP-service actor token to the final delegated token. The final `act` chain must identify the same semantic roles. Literal issuer, token IDs, timestamps, and provider client identifiers may differ.

The current P1 path remains authoritative for scope selection, intermediate/final audience intent, and the exchange sequence. PF has separate exchange policies/clients and may derive the output `aud` from policy rather than request parameters. Those differences belong in the provider adapter and deployment policy configuration; they must not change the contract visible to the tool gateway. PF accepts the same nested MCP-service → AI-agent actor claim or documented flat AI-agent `act.sub` shape that P1 can emit.

## Provider boundary

Add a PF standard exchange adapter that resolves PF-specific exchange clients and actor clients, obtains PF client-credentials tokens, and performs each RFC 8693 hop with PF-specific request options. The shared orchestration continues to decide the use-case scopes, intermediate and final audience intent, event lifecycle, subject preservation, final audience validation, audit event, and TraT/RAR/DPoP handling.

PF configuration must independently describe the first-hop exchanger, second-hop exchanger, AI-agent actor, MCP-service actor, intermediate audience, final-audience policy, and each required token endpoint authentication method. The first and second exchange policies must accept access-token subjects and actor tokens and produce access-token results. The final policy must map both actor levels when PF supports the configured attribute contract. Configuration validation fails closed when any required client, policy target, or audience is missing.

## Isolation and failure handling

- PingOne continues through its existing path without changed credentials, scopes, or policy selection.
- PF ID-JAG continues only for the explicit Enterprise-Managed MCP use case; no ordinary PF run can reach it.
- No fallback to PingOne credentials or a simulated exchange is allowed in PF mode.
- Each hop is recorded distinctly; an error names the failing hop and prevents dispatching a token from the earlier hop.
- Raw subject, actor, or exchanged tokens remain inside the BFF.

## Verification

Add tests first for the normalized two-hop contract and provider separation. Test both calls, subject-token chaining, actors, requested scopes, effective final audience, access-token typing, and no ID-JAG selection for standard PF. Keep PingOne regression tests and ID-JAG tests passing. Run focused BFF tests, then the repository-required broader auth checks if the focused tests reveal shared regressions. A live PF standard-step smoke run is required before claiming external PF policy parity; unit tests cannot prove deployed PF policy mappings.

## External configuration boundary

PingFederate supports access-token-to-access-token exchange and optional actor tokens through per-client token-exchange processor policies. Updating application code alone cannot guarantee the final nested actor claim: the PF clients and policies must be configured and verified in the live environment. Do not silently claim parity if those external policy mappings are absent.
