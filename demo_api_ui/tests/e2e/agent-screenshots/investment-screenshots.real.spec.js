// demo_api_ui/tests/e2e/agent-screenshots/investment-screenshots.real.spec.js
// Real-UI (no mock) screenshots of the investment agent response across the 4
// LLM modes. SKIPPED automatically when real-login credentials are not set.
// NOTE: the investment manifest's dashboard.chips10 defines only ONE well-formed
// chip ("Portfolio status", message "show portfolio status"), so this vertical
// captures a single chip. Add more here if the manifest gains more chips10.
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('../helpers/realLogin');
const { MODES, setVertical, captureChip, assertInDomain, writeManifest } = require('./helpers/agentScreenshotHarness');

const VERTICAL = 'investment';
const CHIPS = [
  { chipId: 'portfolio_status', chipLabel: 'Portfolio status', present: [/portfolio|holding|position|invest|balance|value/i], absent: [/checking|order|reward|appointment|deductible/i] },
];

test.describe('investment agent — 4-mode screenshots', () => {
  test.skip(!requireRealLoginEnv(), 'real-login env not set');
  test.setTimeout(240000);

  test('capture all chips across all modes', async ({ page }) => {
    await loginAsCustomer(page);
    // The session must be on the investment vertical for its chips to render.
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
