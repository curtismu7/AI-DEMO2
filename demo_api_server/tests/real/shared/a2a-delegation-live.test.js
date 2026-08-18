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
const { verticalsWithSpecialist } = require('../../../config/a2aSpecialists');
const { resolveUseCase } = require('../../../config/useCases.js');

const DENY_MARKERS = /denied by an authorization policy|insufficient scope|mcp_error|gateway_error|upstream error|could not be completed/i;

describe('A2A UC2 sensitive-delegation — every vertical, real pipeline (real)', () => {
  let client;
  let sessionOk = true;

  beforeAll(async () => {
    skipIfNoSession();
    try {
      client = createBffClient('enduser');
    } catch (_e) {
      sessionOk = false;
    }
  });

  afterAll(async () => {
    if (client) await client.post('/api/verticals/active', { id: 'banking' }).catch(() => {});
  });

  for (const vertical of verticalsWithSpecialist()) {
    const chipText = resolveUseCase('UC2', vertical).trigger.text;

    it(`${vertical}: "${chipText}" delegates and returns real data, not a DENY`, async () => {
      if (!sessionOk) {
        console.warn(`[a2a-live] no session — skipping ${vertical}`);
        return;
      }

      const activated = await client.post('/api/verticals/active', { id: vertical })
        .then((r) => [200, 204].includes(r.status))
        .catch(() => false);
      if (!activated) {
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
    });
  }
});
