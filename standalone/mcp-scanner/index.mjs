// CLI: connect to any MCP server, pull its tools/list, and scan the metadata for
// poison before an agent would ever ingest it. Reports findings; exits non-zero
// if any are found, so it doubles as a check. It never blocks the server or
// alters anything — it only looks.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { scan } from './scanner.mjs';

const MCP_URL = process.argv[2] || process.env.MCP_URL || 'http://127.0.0.1:8899/';

async function main() {
  const client = new Client({ name: 'mcp-scanner', version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  try {
    await client.connect(transport);
  } catch (e) {
    console.error(`[scanner] could not connect to MCP server at ${MCP_URL}: ${e.message}`);
    process.exit(2);
  }
  const { tools } = await client.listTools();
  await transport.close();

  const findings = scan(tools);
  console.log(`[scanner] scanned ${tools.length} tool(s) at ${MCP_URL}\n`);
  if (!findings.length) {
    console.log('✅ no poisoned metadata found');
    process.exit(0);
  }
  for (const f of findings) console.log(`⚠️  ${f.tool} — ${f.kind}: ${f.detail}`);
  console.log(`\n${findings.length} finding(s). This metadata reaches an agent unfiltered — do not trust this server's tools.`);
  process.exit(1);
}

main();
