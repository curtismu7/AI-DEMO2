'use strict';

/**
 * Live RFC 8693 verification gate (spec §4). Exchanges a real gateway-audience
 * subject token for both backend audiences against the live PingOne env and
 * asserts scopes survive.
 *
 * Usage:
 *   SUBJECT_TOKEN=<gateway-aud access token> npx ts-node --transpile-only scripts/verifyExchange.ts
 *
 * Get a SUBJECT_TOKEN from the running demo: trigger any banking chip and copy
 * the "TX token" (aud=mcpgateway.ping.demo) from the Token Chain inspector, or
 * from BFF logs. Requires demo_mcp_gateway/.env for client creds + token endpoint.
 */

import 'dotenv/config';
import * as jwt from 'jsonwebtoken';
import { loadConfig } from '../src/config';
import { McpTokenExchangeClient } from '../src/auth/McpTokenExchangeClient';

async function main() {
  const subjectToken = process.env.SUBJECT_TOKEN;
  if (!subjectToken) { console.error('Set SUBJECT_TOKEN'); process.exit(2); }
  const config = loadConfig();
  const client = new McpTokenExchangeClient(config);
  let failed = false;
  for (const backend of ['olb', 'invest'] as const) {
    try {
      const r = await client.exchangeForBackend(subjectToken, backend);
      const claims = jwt.decode(r.token) as Record<string, unknown>;
      console.log(`[${backend}] OK aud=${JSON.stringify(claims.aud)} scope="${claims.scope}"`);
      if (!String(claims.scope || '').trim()) { console.error(`[${backend}] FAIL: no scopes survived`); failed = true; }
    } catch (err) {
      const detail = (err as { response?: { data?: unknown } }).response?.data;
      console.error(`[${backend}] FAIL:`, err instanceof Error ? err.message : err, detail ?? '');
      failed = true;
    }
  }
  process.exit(failed ? 1 : 0);
}
main();
