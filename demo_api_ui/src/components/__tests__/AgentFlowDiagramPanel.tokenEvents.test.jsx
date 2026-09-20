// demo_api_ui/src/components/__tests__/AgentFlowDiagramPanel.tokenEvents.test.jsx
import { render, screen } from '@testing-library/react';
import { A2AProtocolTrace, TokenEventCard } from '../AgentFlowDiagramPanel';

const EVENT = {
  id: 'exchanged-token',
  tokenType: 'exchanged_token',
  label: 'Delegated MCP token',
  timestamp: '2026-07-22T12:00:00.000Z',
  status: 'done',
  explanation: 'BFF exchanged subject + actor for a delegated token.',
  exchangeRequest: { grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange', audience: 'mcpgateway' },
  claims: { sub: 'user-1', act: { sub: 'agent-1' }, scope: 'gateway:mcp:invoke' },
  tokenSub: 'user-1',
  tokenAct: { client_id: 'agent-1' },
};

test('shows exchange request and claims inline without requiring a click', () => {
  render(<TokenEventCard event={EVENT} resolvedIdentity={null} />);
  expect(screen.getByText(/BFF exchanged subject/i)).toBeInTheDocument();
  expect(screen.getByText('API Request')).toBeInTheDocument();
  expect(screen.getByText(/token-exchange/)).toBeInTheDocument();
  expect(screen.getByText('Token Claims (Response)')).toBeInTheDocument();
  expect(screen.getAllByText(/gateway:mcp:invoke/).length).toBeGreaterThan(0);
  expect(document.querySelector('.afd-tc-pill--aud')?.textContent).toMatch(/mcpgateway/);
  expect(document.querySelector('.afd-tc-pill--scope')?.textContent).toMatch(/gateway:mcp:invoke/);
  expect(screen.queryByRole('button')).toBeNull();
});

test('surfaces error pill and hop narrative on exchange-failed', () => {
  render(
    <TokenEventCard
      event={{
        id: 'exchange-failed',
        label: 'Exchange failed',
        timestamp: '2026-07-22T12:00:00.000Z',
        status: 'failed',
        pingoneError: 'invalid_scope',
      }}
      resolvedIdentity={null}
    />,
  );
  expect(document.querySelector('.afd-tc-pill--error')?.textContent).toMatch(/invalid_scope/);
  expect(screen.getByText(/Token exchange failed/i)).toBeInTheDocument();
});

test('shows A2A request and response boundaries in the legacy flow panel', () => {
  render(
    <A2AProtocolTrace
      events={[
        { id: 'a2a-agent-card', agentName: 'Investment Advisor', cardUrl: '/agent-card', agentCard: { name: 'Investment Advisor' } },
        { id: 'a2a-protocol-message', status: 'completed', agentName: 'Investment Advisor', mode: 'http', protocolRequest: { method: 'message/send' }, protocolResponse: { result: { status: 'completed' } } },
      ]}
    />,
  );
  expect(screen.getByRole('region', { name: 'A2A protocol trace' })).toBeInTheDocument();
  expect(screen.getByText(/Request: POST message\/send/)).toBeInTheDocument();
  expect(screen.getByText(/Response: result/)).toBeInTheDocument();
  expect(screen.getByText(/No access token crosses/)).toBeInTheDocument();
});
