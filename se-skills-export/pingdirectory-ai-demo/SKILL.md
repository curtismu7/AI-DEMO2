---
name: pingdirectory-ai-demo
description: Use when connecting AI-DEMO2 or another Ping Identity demo to PingDirectory for LDAP identity lookup, user or group data, schema, replication, TLS, or directory operations.
---

# PingDirectory integration

Use this skill for PingDirectory directory-server configuration and application integration. Confirm the deployed edition, version, topology, and whether the target is PingDirectory or PingDirectoryProxy before following version-specific guidance.

## Workflow

1. Start at `https://docs.pingidentity.com/llms.txt`, then follow the PingDirectory docset to the matching release. Use official documentation for command syntax, configuration properties, schema behavior, replication, and upgrade procedures; do not copy commands from another release without checking.
2. Identify the application flow and directory role: source of identity data, lookup/authentication endpoint, group membership, provisioning target, or proxy. In AI-DEMO2, no PingDirectory service or adapter is currently part of the documented runtime; do not assume PingOne Management API calls can be redirected to LDAP.
3. Agree on the LDAP/LDAPS endpoint, base DN, bind identity and least privilege, attribute mapping, group model, search scope/filter, timeout, and certificate trust. Use parameterized LDAP filters and escape user-controlled values. Avoid broad subtree scans for interactive requests.
4. Keep bind credentials in the service's secret configuration, use TLS with certificate validation, and return only the attributes the caller needs. Do not log credentials, full directory records, or sensitive filters.
5. Before writes, schema changes, index changes, replication edits, or upgrades, inspect the exact target and impact. Preserve a recoverable backup and a rollback path; do not mutate a live directory unless the user explicitly requested it.
6. Test successful and missing-user/group lookups, malformed input, denied bind/search, timeout, and TLS failure. Verify connection reuse and bounded latency for request paths.

## AI-DEMO2 boundary

The BFF is the application's identity boundary. Add a dedicated adapter/service and explicit configuration if a future feature needs directory access; do not connect the browser or model runtime directly to LDAP. Update the service's `.env.example`, tests, and deployment config only when that integration is actually requested.
