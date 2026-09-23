'use strict';

/**
 * A2A UC2 sensitive-delegation coverage — every vertical, real pipeline (real).
 *
 * all-chips-pipeline.test.js proves a chip ROUTES (kind !== 'none') and, for
 * mcp-pipeline chips, that /agent/invoke returns one of [200, 428, 403] — it
 * never inspects the REPLY. The 2026-07-27 A2A outage (gateway mTLS half
 * missing, then two separate scope gates rejecting a2aDelegatedScope) shipped
 * with that suite fully green the entire time: the broken response was still
 * HTTP 200 (executeA2aDelegation catches the gateway 502 and packages it into
 * an ok-status JSON body with an error field), so status-only assertions never
 * saw it. This suite closes that hole by asserting the REPLY CONTENT for every
 * vertical's UC2 sensitive-delegation chip.
 *
 * Skips (not fails) when the session couldn't be established — same
 * convention as the rest of tests/real/. (A2A delegation is always on;
 * ff_a2a_delegation was removed.)
 */

const { createBffClient } = require('../helpers/bffClient');
const { verticalsWithSpecialist, specialistForVertical } = require('../../../config/a2aSpecialists');
const { resolveUseCase } = require('../../../config/useCases.js');
const {
  assertActiveProvider,
  assertProviderIssuer,
  assertVerticalActivated,
} = require('../helpers/a2aProviderMatrix');

const DENY_MARKERS = /denied by an authorization policy|insufficient scope|mcp_error|gateway_error|upstream error|could not be completed/i;
const EXPECTED_PROVIDER = String(process.env.A2A_EXPECTED_OAUTH_PROVIDER || '').trim().toLowerCase();

function tokenEventById(events, id) {
  return (events || []).find((event) => event.id === id);
}

describe('A2A UC2 sensitive-delegation — every vertical, real pipeline (real)', () => {
  let enduserClient;
  let adminClient;
  let sessionOk = true;

  beforeAll(async () => {
    if (!EXPECTED_PROVIDER) skipIfNoSession();
    if (EXPECTED_PROVIDER && !['pingone', 'pingfederate'].includes(EXPECTED_PROVIDER)) {
      throw new Error('A2A_EXPECTED_OAUTH_PROVIDER must be pingone or pingfederate');
    }
    if (EXPECTED_PROVIDER) {
      const activeProvider = require('../../../services/configStore').getOAuthProvider();
      assertActiveProvider(EXPECTED_PROVIDER, activeProvider);
    }
    try {
      enduserClient = createBffClient('enduser');
      if (EXPECTED_PROVIDER) {
        adminClient = createBffClient('admin');
        const [adminProbe, enduserProbe] = await Promise.all([
          adminClient.get('/api/admin/stats'),
          enduserClient.get('/api/admin/stats'),
        ]);
        if (adminProbe.status !== 200) {
          throw new Error(`admin persona failed role probe (HTTP ${adminProbe.status})`);
        }
        if (enduserProbe.status !== 403) {
          throw new Error(`enduser persona failed isolation probe (HTTP ${enduserProbe.status})`);
        }
      }
    } catch (err) {
      if (EXPECTED_PROVIDER) throw new Error(`${EXPECTED_PROVIDER} A2A provider-matrix run requires valid enduser and dedicated admin login sessions: ${err.message}`);
      sessionOk = false;
    }
  });

  afterAll(async () => {
    await Promise.all([enduserClient, adminClient]
      .filter(Boolean)
      .map((client) => client.post('/api/verticals/active', { id: 'banking' }).catch(() => {})));
  });

  for (const vertical of verticalsWithSpecialist()) {
    const chipText = resolveUseCase('UC2', vertical).trigger.text;

    it(`${EXPECTED_PROVIDER || 'configured provider'} / ${vertical}: "${chipText}" completes both exchanges and returns tool data`, async () => {
      if (!sessionOk) {
        console.warn(`[a2a-live] no session — skipping ${vertical}`);
        return;
      }

      const client = EXPECTED_PROVIDER && vertical === 'admin' ? adminClient : enduserClient;

      const activated = await client.post('/api/verticals/active', { id: vertical })
        .then((r) => [200, 204].includes(r.status))
        .catch(() => false);
      if (!activated) {
        assertVerticalActivated(false, EXPECTED_PROVIDER, vertical);
        console.warn(`[a2a-live] cannot switch live to '${vertical}' — skipping`);
        return;
      }

      const inv = await client.post('/api/agent/invoke', { prompt: chipText, forceHeuristic: true, vertical });

      // Real content assertion — the whole point of this suite. A transport or
      // scope failure surfaces as HTTP 200 with a denial-shaped reply, so the
      // status code alone (as in all-chips-pipeline.test.js) cannot catch it.
      expect(inv.status).toBe(200);
      const reply = String(inv.data.reply || '');
      expect(reply).not.toMatch(DENY_MARKERS);

      if (EXPECTED_PROVIDER) {
        const events = inv.data.tokenEvents || [];
        const userEvent = tokenEventById(events, 'user-token');
        const configuredIssuer = require('../../../services/oauthEndpointResolver').getIssuer();
        assertProviderIssuer(EXPECTED_PROVIDER, userEvent?.claims?.iss, configuredIssuer);

        for (const [id, status] of [
          ['a2a-agent1-actor', 'acquired'],
          ['a2a-exchange1', 'exchanged'],
          ['a2a-agent2-actor', 'acquired'],
          ['a2a-exchange2', 'exchanged'],
          ['tool-dispatched', 'success'],
        ]) {
          expect(tokenEventById(events, id)?.status).toBe(status);
        }

        const specialistTool = specialistForVertical(vertical)?.tools?.[0];
        const toolsCalled = (inv.data.toolsCalled || []).map((tool) =>
          typeof tool === 'string' ? tool : tool?.name || tool?.tool,
        );
        expect(toolsCalled).toContain('delegate_to_specialist');
        expect(tokenEventById(events, 'a2a-exchange2')?.a2aTool).toBe(specialistTool);
        expect(inv.data.success).toBe(true);
        expect(reply).toMatch(/^Delegation complete/);
        expect(reply.trim().length).toBeGreaterThan(0);
      }
    });
  }
});
