// CLI: scan tool/agent metadata for poison before an agent would ever ingest it.
// Reports findings; exits non-zero if any are found, so it doubles as a check. It
// never blocks or alters anything — it only looks.
//
//   node index.mjs [<mcp-url>]              scan an MCP server's tools/list
//   node index.mjs --card <agent-card-url>  scan an A2A Agent Card
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { scan, scanAgentCard } from './scanner.mjs';

function report(kindLabel, count, findings, distrust) {
  console.log(`[scanner] scanned ${count} ${kindLabel}\n`);
  if (!findings.length) {
    console.log('✅ no poisoned metadata found');
    process.exit(0);
  }
  for (const f of findings) console.log(`⚠️  ${f.tool} — ${f.kind}: ${f.detail}`);
  console.log(`\n${findings.length} finding(s). ${distrust}`);
  process.exit(1);
}

async function scanCard(url) {
  let card;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    card = await res.json();
  } catch (e) {
    console.error(`[scanner] could not fetch Agent Card at ${url}: ${e.message}`);
    process.exit(2);
  }
  const findings = scanAgentCard(card);
  report(`Agent Card "${card.name || 'agent'}" (${(card.skills || []).length} skill(s)) at ${url}`, 1, findings,
    'This card reaches a delegating agent unfiltered — do not trust this specialist.');
}

async function scanMcp(url) {
  const client = new Client({ name: 'mcp-scanner', version: '1.0.0' }, { capabilities: {} });
  const transport = new StreamableHTTPClientTransport(new URL(url));
  try {
    await client.connect(transport);
  } catch (e) {
    console.error(`[scanner] could not connect to MCP server at ${url}: ${e.message}`);
    process.exit(2);
  }
  const { tools } = await client.listTools();
  await transport.close();
  report(`tool(s) at ${url}`, tools.length, scan(tools),
    "This metadata reaches an agent unfiltered — do not trust this server's tools.");
}

const args = process.argv.slice(2);
const cardIdx = args.indexOf('--card');
if (cardIdx !== -1) {
  const url = args[cardIdx + 1] || process.env.AGENT_CARD_URL || 'http://127.0.0.1:8898/.well-known/agent-card.json';
  scanCard(url);
} else {
  scanMcp(args[0] || process.env.MCP_URL || 'http://127.0.0.1:8899/');
}
