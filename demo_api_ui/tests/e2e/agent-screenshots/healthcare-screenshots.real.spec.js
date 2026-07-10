// demo_api_ui/tests/e2e/agent-screenshots/healthcare-screenshots.real.spec.js
// Real-UI (no mock) screenshots of the healthcare agent response across the 4
// LLM modes. SKIPPED automatically when real-login credentials are not set.
// Chips mirror the healthcare manifest's dashboard.chips10 (emoji-free entries).
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('../helpers/realLogin');
const { MODES, setVertical, captureChip, assertInDomain, writeManifest } = require('./helpers/agentScreenshotHarness');

const VERTICAL = 'healthcare';
const CHIPS = [
  { chipId: 'my_records',      chipLabel: 'My records',      present: [/record|medical|health|chart/i],       absent: [/checking|savings|order|reward|portfolio/i] },
  { chipId: 'my_appointments', chipLabel: 'My appointments', present: [/appointment|visit|clinic|schedule/i],  absent: [/checking|order|reward|portfolio/i] },
  { chipId: 'check_coverage',  chipLabel: 'Check coverage',  present: [/coverage|insurance|plan|benefit/i],    absent: [/order|reward|portfolio/i] },
];

test.describe('healthcare agent — 4-mode screenshots', () => {
  test.skip(!requireRealLoginEnv(), 'real-login env not set');
  test.setTimeout(240000);

  test('capture all chips across all modes', async ({ page }) => {
    await loginAsCustomer(page);
    // The session must be on the healthcare vertical for its chips to render. If the
    // switch is rejected (e.g. not permitted for this user), skip rather than
    // timing out on banking chips that do not match.
    const switched = await setVertical(page, VERTICAL);
    test.skip(!switched, 'could not switch to the healthcare vertical');

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
