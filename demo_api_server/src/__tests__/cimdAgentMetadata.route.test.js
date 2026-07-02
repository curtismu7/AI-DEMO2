/**
 * CIMD agent metadata publisher — GET /api/cimd/agents(/:slug/client-metadata.json).
 *
 * The documents are DERIVED from repo-root scope-topology.json at request time
 * (via services/scopeTopology) so they can never drift from the SSOT.
 */
'use strict';

const express = require('express');
const request = require('supertest');

const cimdAgentMetadataRoutes = require('../../routes/cimdAgentMetadata');
const scopeTopology = require('../../services/scopeTopology');

function makeApp() {
  const app = express();
  app.use('/api/cimd', cimdAgentMetadataRoutes);
  return app;
}

describe('CIMD agent metadata routes', () => {
  test('GET /api/cimd/agents lists topology agents with their document URLs', async () => {
    const res = await request(makeApp()).get('/api/cimd/agents');

    expect(res.status).toBe(200);
    expect(res.body.mocked).toBe(true);
    expect(Array.isArray(res.body.agents)).toBe(true);

    const advisor = res.body.agents.find((a) => a.app === 'Super Banking Investment Advisor Agent');
    expect(advisor).toBeDefined();
    expect(advisor.slug).toBe('super-banking-investment-advisor-agent');
    expect(advisor.metadata_path).toBe(
      '/api/cimd/agents/super-banking-investment-advisor-agent/client-metadata.json'
    );
    // URL-shaped client_id the BFF can resolve against itself (loopback).
    expect(advisor.client_id).toMatch(/^https?:\/\/127\.0\.0\.1:\d+\/api\/cimd\/agents\//);
  });

  test('GET client-metadata.json derives the document from scope-topology.json', async () => {
    const res = await request(makeApp()).get(
      '/api/cimd/agents/super-banking-investment-advisor-agent/client-metadata.json'
    );

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);

    const doc = res.body;
    // CIMD §4: the client_id in the document is the document URL itself.
    expect(doc.client_id).toMatch(
      /\/api\/cimd\/agents\/super-banking-investment-advisor-agent\/client-metadata\.json$/
    );
    // Derived from the topology SSOT at request time.
    const entry = scopeTopology.appEntry('Super Banking Investment Advisor Agent');
    expect(doc.scope).toBe(entry.grantedScopes.join(' '));
    // The mock AS registers only grants it can actually issue (client_credentials);
    // the real AS (PingOne) handles the token_exchange leg.
    expect(doc.grant_types).toEqual(['client_credentials']);
    expect(doc.client_name).toBeTruthy();
  });

  test('unknown agent slug returns 404', async () => {
    const res = await request(makeApp()).get('/api/cimd/agents/no-such-agent/client-metadata.json');
    expect(res.status).toBe(404);
  });
});
