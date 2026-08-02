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
  const outPath = path.resolve(__dirname, '../../mcp-tool-schemas.json');
  fs.writeFileSync(outPath, JSON.stringify(buildToolSchemas(), null, 2) + '\n');
  console.log(`Wrote ${outPath} (${Object.keys(buildToolSchemas().tools).length} tools)`);
}
