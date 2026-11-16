// demo_api_ui/src/components/__tests__/McpGatewayConfig.tabs.test.jsx
// Tab labels and CSS are source-level checks. The JSON panes are rendered for real: the heavy tab children are
// mocked so the page itself (its fetch hook, tab switch and panes) is what runs.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import McpGatewayConfig from '../McpGatewayConfig';

// The heavy tab bodies are not under test here; each is stubbed so the module graph stays small.
vi.mock('../GatewayRoutingDiagram', () => ({ default: () => null }));
vi.mock('../AgentGatewayConfigEditor', () => ({ default: () => null }));
vi.mock('../AgentGatewayLogPanel', () => ({ default: () => null }));
vi.mock('../AgentGatewayTester', () => ({ default: () => null }));
vi.mock('../InterAgentAbuseTester', () => ({ default: () => null }));
vi.mock('../McpTrafficPage', () => ({ default: () => null }));
vi.mock('../TokenSecurityTester', () => ({ default: () => null }));
vi.mock('../../context/ThemeContext', () => ({ useTheme: () => ({ darkMode: false, toggleDarkMode: () => {} }) }));

// Each pane gets a value no other pane has, so a pane wired to the wrong variable shows the wrong text.
const GATEWAY_DATA = {
  mcpMode: 'demo',
  mock: {
    running: true, devBypass: false, enabled: true, url: 'http://gw.test',
    health: { status: 'ok' },
    liveConfig: { gatewayResourceUri: 'https://live-config.example/mcp', p1azEnabled: true },
  },
  config: {
    pingOneEnvUrl: 'https://auth.example/env-1', introspectEndpoint: 'https://auth.example/env-1/as/introspect',
    upstreamMcpUrl: 'https://upstream.example/mcp', pingOneResourceId: 'res-live-preview', gatewayPublicUrl: 'https://ig.example:8443',
    mcpScope: 'mcp:invoke',
  },
  envVars: {},
  pingGatewayJson: { name: 'route-file-marker', handler: 'ReverseProxyHandler' },
  pingGatewayAdminJson: { streamingEnabled: true, adminConnector: { port: 9999 } },
};

vi.mock('../../hooks/useGatewayLiveConfig', () => ({
  useGatewayLiveConfig: () => ({ data: GATEWAY_DATA, loading: false, error: null, refetch: () => {} }),
}));

function renderTab(subtab) {
  return render(<MemoryRouter initialEntries={[`/?subtab=${subtab}`]}><McpGatewayConfig /></MemoryRouter>);
}

beforeEach(() => {
  // The panes keep the visitor's Form | JSON choice in localStorage; start every test from the default (Form).
  localStorage.clear();
});

const here = dirname(fileURLToPath(import.meta.url));
const jsx = readFileSync(join(here, '../McpGatewayConfig.jsx'), 'utf8');
const css = readFileSync(join(here, '../McpGatewayConfig.css'), 'utf8');

test('PingOne Agent Gateway Inspector tab labels match the rename contract', () => {
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

test('the Demo Agent Gateway tab shows the live gateway config as a pane, under its Copy button', () => {
  renderTab('mock');
  const pane = screen.getByRole('group', { name: 'Live gateway config' });
  expect(pane).toHaveTextContent('https://live-config.example/mcp');
  expect(pane.closest('.mgc-code-block')).toContainElement(screen.getByRole('button', { name: 'Copy live config' }));
});

test('the real-gateway tab shows the live mcp.json preview, the route file and admin.json, each with its own data', () => {
  renderTab('real');

  const preview = screen.getByRole('group', { name: 'Live mcp.json preview' });
  expect(preview).toHaveTextContent('https://auth.example/env-1');
  expect(preview).toHaveTextContent('https://upstream.example/mcp');
  expect(preview).toHaveTextContent('res-live-preview');
  expect(preview).not.toHaveTextContent('route-file-marker');

  const route = screen.getByRole('group', { name: 'mcp.json route file' });
  expect(route).toHaveTextContent('route-file-marker');
  expect(route).not.toHaveTextContent('https://auth.example/env-1');

  const admin = screen.getByRole('group', { name: 'admin.json snippet' });
  expect(admin).toHaveTextContent('streamingEnabled');
  expect(admin).toHaveTextContent('9999');
  expect(admin).not.toHaveTextContent('route-file-marker');

  // Each pane sits in the code block that carries its own Copy button.
  expect(within(preview.closest('.mgc-code-block')).getByRole('button', { name: 'Copy mcp.json' })).toBeInTheDocument();
  expect(within(route.closest('.mgc-code-block')).getByRole('button', { name: 'Copy mcp.json' })).toBeInTheDocument();
  expect(within(admin.closest('.mgc-code-block')).getByRole('button', { name: 'Copy admin.json snippet' })).toBeInTheDocument();
  // No JSON is shown through the old pre box any more.
  expect(document.querySelector('.mgc-pre--code')).toBeNull();
});

test('the pane CSS clears the floated buttons and the old pre class is gone from the page', () => {
  expect(jsx).toContain("import JsonPane from './shared/JsonPane'");
  expect(jsx).not.toContain('mgc-pre--code');
  expect(css).toMatch(/\.mgc-code-block \.jp-box\s*\{[^}]*clear:\s*both/);
});
