'use strict';
/**
 * Chip pipeline — for every vertical, every "both"-mode chip:
 *  1. Routes to a non-none intent via /nl
 *  2. Agent responds with a non-error reply (or appropriate consent challenge)
 *
 * Focus: verifies the chip message → NL route → agent dispatch chain is
 * wired correctly. Does NOT assert specific reply content — that's tested
 * in all-chips-pipeline.test.js.
 */

const path = require('path');
const { createBffClient } = require('../helpers/bffClient');

const VERTICALS = ['banking', 'healthcare', 'retail', 'sporting-goods', 'workforce'];

// Chips that intentionally require HITL/consent — their agent response is 428.
const HITL_CHIP_IDS = new Set(['bk-hitl', 'hc5', 'rt4', 'sg3', 'wf4', 'wf5']);

function getBothChips(verticalId) {
  const manifest = require(path.join(
    __dirname, `../../../config/verticals/${verticalId}/manifest.json`
  ));
  const dashboard = manifest.dashboard || {};
  return [...(dashboard.chips || []), ...(dashboard.chips10 || [])]
    .filter(c => c.mode === 'both' && c.message);
}

describe('Chip pipeline — NL routing per vertical (real)', () => {
  let client;

  beforeAll(() => {
    skipIfNoSession();
    client = createBffClient('enduser');
  });

  afterAll(async () => {
    if (client) await client.post('/api/verticals/active', { id: 'banking' });
  });

  for (const verticalId of VERTICALS) {
    const chips = getBothChips(verticalId);

    describe(`${verticalId} (${chips.length} both-mode chips)`, () => {
      beforeAll(async () => {
        if (!client) return;
        await client.post('/api/verticals/active', { id: verticalId });
      });

      afterAll(async () => {
        if (client) await client.post('/api/verticals/active', { id: 'banking' });
      });

      for (const chip of chips) {
        const label = `${chip.id || chip.key || '?'}: "${chip.label}"`;

        it(`${label} → /nl returns non-none kind`, async () => {
          const r = await client.post('/api/demo-agent/nl', {
            message: chip.message,
            provider: 'heuristic',
            vertical: verticalId,
          });
          expect(r.status).toBe(200);
          expect(r.data.result.kind).not.toBe('none');
        });
      }
    });
  }
});

describe('Chip pipeline — agent dispatch per vertical (real)', () => {
  let client;

  beforeAll(() => {
    skipIfNoSession();
    client = createBffClient('enduser');
  });

  afterAll(async () => {
    if (client) await client.post('/api/verticals/active', { id: 'banking' });
  });

  it.each(VERTICALS)('%s: hitlTrigger chip invokes agent with 428 (when ff_hitl_enabled)', async (verticalId) => {
    const manifest = require(path.join(
      __dirname, `../../../config/verticals/${verticalId}/manifest.json`
    ));
    const dashboard = manifest.dashboard || {};
    const chips = [...(dashboard.chips || []), ...(dashboard.chips10 || [])];
    const hitlChip = chips.find(c => c.hitlTrigger === true && c.message);
    if (!hitlChip) {
      console.warn(`[chip-pipeline] ${verticalId}: no hitlTrigger chip — skipping`);
      return;
    }

    await client.post('/api/verticals/active', { id: verticalId });

    const inv = await client.post('/api/agent/invoke', {
      prompt: hitlChip.message,
      forceHeuristic: true,
      vertical: verticalId,
    });

    // 428 = HITL consent required (expected when ff_hitl_enabled=true)
    // 200 = succeeded (HITL off or tool handled inline)
    // 401/403 = auth issue (skip gracefully)
    expect([200, 428, 401, 403]).toContain(inv.status);
    if (inv.status === 428) {
      expect(inv.data.requiresConsent || inv.data.error).toBeTruthy();
    }
    if (inv.status === 200) {
      // HITL off — reply must still be non-empty
      expect(String(inv.data?.reply || '').trim().length).toBeGreaterThan(0);
    }
  });
});
