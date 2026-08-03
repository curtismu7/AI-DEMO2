'use strict';

/**
 * genToolSchemas — regenerates the repo-root mcp-tool-schemas.json artifact
 * from the three tool-definition sources. Run: npm run gen:tool-schemas
 * The drift test (tests/toolSchemaDrift.test.ts) fails when the committed
 * artifact differs from a fresh build.
 */

import * as fs from 'fs';
import * as path from 'path';
import { BankingToolRegistry } from '../../demo_mcp_server/src/tools/BankingToolRegistry';
import { INVEST_TOOLS } from '../../demo_mcp_resource_server/src/tools/investTools';
import { AIRLINES_TOOLS } from '../../demo_mcp_resource_server/src/tools/airlinesTools';
import { GATEWAY_TOOLS } from '../src/gatewayTools';

export interface ToolSchemaEntry {
  source: 'olb' | 'invest' | 'airlines' | 'gateway';
  inputSchema: Record<string, unknown>;
}
export interface ToolSchemaArtifact {
  version: number;
  tools: Record<string, ToolSchemaEntry>;
}

// Gateway-routed demo tools with no descriptor source: they take no arguments.
const EMPTY_OBJECT_SCHEMA = { type: 'object', properties: {}, additionalProperties: false };
const EXTRA_GATEWAY_TOOLS = ['show_mortgage', 'demo_show_accounts', 'demo_show_transactions'];

export function buildToolSchemas(): ToolSchemaArtifact {
  const tools: Record<string, ToolSchemaEntry> = {};
  for (const t of BankingToolRegistry.getAllTools()) {
    tools[t.name] = { source: 'olb', inputSchema: t.inputSchema as Record<string, unknown> };
  }
  for (const t of INVEST_TOOLS) {
    tools[t.name] = { source: 'invest', inputSchema: t.inputSchema };
  }
  for (const t of AIRLINES_TOOLS) {
    tools[t.name] = { source: 'airlines', inputSchema: t.inputSchema };
  }
  for (const t of GATEWAY_TOOLS) {
    tools[t.name] = { source: 'gateway', inputSchema: t.inputSchema };
  }
  for (const name of EXTRA_GATEWAY_TOOLS) {
    if (!tools[name]) tools[name] = { source: 'gateway', inputSchema: { ...EMPTY_OBJECT_SCHEMA } };
  }
  // Deterministic key order so regenerate-and-diff is stable.
  const sorted: Record<string, ToolSchemaEntry> = {};
  for (const k of Object.keys(tools).sort()) sorted[k] = tools[k];
  return { version: 1, tools: sorted };
}

if (require.main === module) {
  // Two outputs, byte-identical (toolSchemaDrift.test.ts enforces it):
  //   repo root            — the canonical artifact (Node gateway import, BFF tests, Dockerfile COPY)
  //   ping-gateway/config/ — the copy IG's Groovy validator reads at /var/gateway/config/
  // IG gets its own copy because compose mounts ping-gateway/config as a DIRECTORY.
  // Bind-mounting the root file individually broke every /mcp POST whenever git
  // replaced it (rename = new inode, mount pins the dead one) — see REGRESSION_PLAN §4.
  const outPaths = [
    path.resolve(__dirname, '../../mcp-tool-schemas.json'),
    path.resolve(__dirname, '../../ping-gateway/config/mcp-tool-schemas.json'),
  ];
  const body = JSON.stringify(buildToolSchemas(), null, 2) + '\n';
  for (const outPath of outPaths) {
    fs.writeFileSync(outPath, body);
    console.log(`Wrote ${outPath} (${Object.keys(buildToolSchemas().tools).length} tools)`);
  }
}
