import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createInventoryStore } from './src/store.mjs';
import { defaultScanOptions, runScan } from './src/scanner.mjs';
import { createDiscoveryServer } from './src/server.mjs';

const execFile = promisify(nodeExecFile);
const config = defaultScanOptions();
const store = createInventoryStore({ filePath: config.filePath });
const scan = () => runScan({ ...config, execFile, store });

if (process.argv.includes('--scan-once')) {
  console.log(JSON.stringify(await scan(), null, 2));
  process.exit(0);
}

const port = Number(process.env.MCP_DISCOVERY_PORT || 3910);
const server = createDiscoveryServer({ store, scan });
server.listen(port, process.env.MCP_DISCOVERY_HOST || '127.0.0.1', () => {
  console.log(`MCP discovery agent listening on http://127.0.0.1:${port}`);
  void scan().catch((error) => console.error(`[mcp-discovery] initial scan failed: ${error.message}`));
});
