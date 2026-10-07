// demo_api_ui/src/utils/__tests__/a2aChainDetail.test.js
import { describe, it, expect } from 'vitest';
import { buildA2aChainDetail, buildA2aEvidenceRows, summarizeAgentCard } from '../a2aChainDetail';

describe('summarizeAgentCard', () => {
  it('shows the card description, provider and per-skill detail with the wire binding', () => {
    const s = summarizeAgentCard({
      protocolBinding: 'JSONRPC',
      skills: ['sensitive_membership_details'],
      agentCard: {
        name: 'Membership Specialist',
        version: '1.1.0',
        description: 'Reviews membership details.',
        provider: { organization: 'Ping Identity Demo' },
        securitySchemes: { pingoneBearer: {} },
        skills: [{ id: 'sensitive_membership_details', name: 'Sensitive membership details', description: 'Calls the tool.', examples: ['review it'], tags: ['x'] }],
      },
    });
    expect(s).toMatchObject({
      name: 'Membership Specialist',
      version: '1.1.0',
      description: 'Reviews membership details.',
      provider: 'Ping Identity Demo',
      protocolBinding: 'JSONRPC',
      securitySchemes: ['pingoneBearer'],
    });
    expect(s.skills).toEqual([{ id: 'sensitive_membership_details', name: 'Sensitive membership details', description: 'Calls the tool.', examples: ['review it'] }]);
  });

  it('falls back to skill ids and the interface binding when the full card is thin', () => {
    const s = summarizeAgentCard({ agentName: 'Advisor', skills: ['a'], agentCard: { supportedInterfaces: [{ protocolBinding: 'JSONRPC' }] } });
    expect(s.skills).toEqual(['a']);
    expect(s.protocolBinding).toBe('JSONRPC');
    expect(s.name).toBe('Advisor');
  });
});

const runEvents = [
  {
    id: 'a2a-agent1-actor',
    status: 'acquired',
    claims: { client_id: 'agent1-cid', aud: 'a2a-intermediate', scope: 'agent:invoke:investment' },
    vertical: 'banking',
  },
  {
    id: 'a2a-exchange1',
    status: 'exchanged',
    exchangeRequest: {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      audience: 'a2a-intermediate',
      scope: 'agent:invoke:investment',
      has_actor_token: true,
    },
    claims: { sub: 'user-1', aud: 'a2a-intermediate', act: { sub: 'agent1-cid' } },
  },
  {
    id: 'a2a-agent2-actor',
    status: 'acquired',
    specialist: 'Investment Advisor',
    claims: { client_id: 'agent2-cid', aud: 'a2a-intermediate', scope: 'agent:invoke:investment' },
  },
  {
    id: 'a2a-exchange2',
    status: 'exchanged',
    specialist: 'Investment Advisor',
    scope: 'invest:read',
    actChainDepth: 2,
    a2aTool: 'get_portfolio_summary',
    vertical: 'banking',
    exchangeRequest: {
      grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
      audience: 'mcpgateway-a2a.ping.demo',
      scope: 'invest:read',
      has_actor_token: true,
    },
    claims: {
      aud: ['mcpgateway-a2a.ping.demo'],
      scope: 'invest:read',
      act: { sub: 'agent2-cid', act: { sub: 'agent1-cid' } },
    },
  },
  {
    id: 'a2a-agent-card',
    agentName: 'Investment Advisor',
    cardUrl: 'https://api.example/.well-known/agent-card.json',
    skills: ['get_portfolio_summary'],
    protocolBinding: 'JSONRPC',
    agentCard: { name: 'Investment Advisor', version: '1.0.0' },
  },
  {
    id: 'a2a-protocol-message',
    status: 'completed',
    agentName: 'Investment Advisor',
    mode: 'in-process',
    protocolRequest: { method: 'message/send', text: 'portfolio summary' },
    protocolResponse: { replyText: 'ok' },
  },
];

describe('buildA2aChainDetail', () => {
  it('builds diagram, hops, agent card, and protocol for a full A2A run', () => {
    const d = buildA2aChainDetail(runEvents);
    expect(d.present).toBe(true);
    expect(d.specialist).toBe('Investment Advisor');
    expect(d.tool).toBe('get_portfolio_summary');
    expect(d.diagramLines.some((l) => l.includes('Banking Agent'))).toBe(true);
    expect(d.diagramLines.some((l) => l.includes('Specialist agent'))).toBe(true);
    expect(d.diagramLines.some((l) => l.includes('Agent Card'))).toBe(true);
    expect(d.hops).toHaveLength(4);
    expect(d.hops[0].request.grant_type).toBe('client_credentials');
    expect(d.hops[1].request.has_actor_token).toBe(true);
    expect(d.hops[3].response.actChainDepth).toBe(2);
    expect(d.agentCard.skills).toEqual(['get_portfolio_summary']);
    expect(d.agentCard.card.name).toBe('Investment Advisor');
    expect(d.protocol.request.method).toBe('message/send');
    expect(d.protocol.response.replyText).toBe('ok');
  });

  it('returns present:false for empty input without throwing', () => {
    expect(buildA2aChainDetail([]).present).toBe(false);
    expect(() => buildA2aChainDetail(undefined)).not.toThrow();
  });

  it('builds source-linked identity and wire rows without exposing token values', () => {
    const rows = buildA2aEvidenceRows(runEvents);

    expect(rows.identity.map((row) => row.sourceId)).toEqual([
      'a2a-agent1-actor',
      'a2a-exchange1',
      'a2a-agent2-actor',
      'a2a-exchange2',
    ]);
    expect(rows.wire.map((row) => row.sourceId)).toEqual([
      'a2a-agent-card',
      'a2a-protocol-message',
    ]);
    expect(rows.wire[0].requestSummary).toContain('GET');
    expect(rows.wire[1].requestSummary).toContain('POST message/send');
    expect(rows.wire[1].responseSummary).toContain('result');
    expect(rows.responseBoundary).toContain('No access token');
    expect(JSON.stringify(rows)).not.toContain('eyJ');
  });
});
