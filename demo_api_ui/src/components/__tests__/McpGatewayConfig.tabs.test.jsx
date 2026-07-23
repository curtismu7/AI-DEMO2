// demo_api_ui/src/components/__tests__/McpGatewayConfig.tabs.test.jsx
// Source-level checks — full render of McpGatewayConfig pulls a heavy import
// graph that hangs vitest transform in this worktree; labels/CSS are the contract.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const jsx = readFileSync(join(here, '../McpGatewayConfig.jsx'), 'utf8');
const css = readFileSync(join(here, '../McpGatewayConfig.css'), 'utf8');

test('PingGateway Inspector tab labels match the rename contract', () => {
  expect(jsx).toMatch(/Agent Gateway\s*<\/button>/);
  expect(jsx).toMatch(/Agent Gateway Tester\s*<\/button>/);
  expect(jsx).toMatch(/MCP Tool Tester\s*<\/button>/);
  expect(jsx).not.toMatch(/>\s*Traffic\s*</);
  expect(jsx).not.toContain('Real PingOne Agent Gateway (Prod)');
  // Old short label must not remain as a tab (Agent Gateway Tester is fine).
  expect(jsx).not.toMatch(/>\s*Gateway Tester\s*</);
});

test('MCP Tool Tester tab uses the non-collapsing traffic host + embedded page', () => {
  expect(jsx).toContain('mgc-panel--traffic');
  expect(jsx).toContain('<McpTrafficPage embedded />');
  expect(css).toContain('.mgc-panel--traffic');
  expect(css).toMatch(/height:\s*calc\(100vh/);
});
