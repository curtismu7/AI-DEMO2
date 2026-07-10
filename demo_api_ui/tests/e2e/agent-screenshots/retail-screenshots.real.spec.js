// demo_api_ui/tests/e2e/agent-screenshots/retail-screenshots.real.spec.js
// Real-UI (no mock) screenshots of the retail (Great Buy) agent response across
// the 4 LLM modes. SKIPPED automatically when real-login credentials are not set.
// Chips mirror the retail manifest's dashboard.chips10 (emoji-free entries).
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('../helpers/realLogin');
const { MODES, setVertical, captureChip, assertInDomain, writeManifest } = require('./helpers/agentScreenshotHarness');

const VERTICAL = 'retail';
const CHIPS = [
  { chipId: 'list_my_orders', chipLabel: 'List my orders',  present: [/order|purchase|delivery|shipment/i], absent: [/checking|savings|appointment|deductible|portfolio/i] },
  { chipId: 'reward_points',  chipLabel: 'My reward points', present: [/reward|points|loyalty/i],            absent: [/checking|appointment|deductible|portfolio/i] },
  { chipId: 'order_history',  chipLabel: 'Order history',    present: [/order|history|purchase/i],           absent: [/appointment|deductible|portfolio/i] },
];

test.describe('retail agent — 4-mode screenshots', () => {
  test.skip(!requireRealLoginEnv(), 'real-login env not set');
  test.setTimeout(240000);

  test('capture all chips across all modes', async ({ page }) => {
    await loginAsCustomer(page);
    // The session must be on the retail vertical for its chips to render.
    await setVertical(page, VERTICAL);

    const rows = [];
    for (const chip of CHIPS) {
      const cells = [];
      for (const mode of MODES) {
        const cell = await captureChip(page, { vertical: VERTICAL, chipId: chip.chipId, chipLabel: chip.chipLabel, modeId: mode.id });
        if (!cell.skipped && cell.text) {
          assertInDomain(cell.text, { present: chip.present, absent: chip.absent });
        }
        cells.push(cell);
      }
      rows.push({ chipId: chip.chipId, chipLabel: chip.chipLabel, cells });
    }
    writeManifest(VERTICAL, rows);

    const anyCaptured = rows.some((r) => r.cells.some((c) => !c.skipped));
    expect(anyCaptured).toBe(true);
  });
});
