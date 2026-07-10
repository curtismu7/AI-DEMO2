// demo_api_ui/tests/e2e/agent-screenshots/banking-screenshots.real.spec.js
// Real-UI (no mock) screenshots of the banking agent response across 4 LLM modes.
// SKIPPED automatically when real-login credentials are not set.
const { test, expect } = require('@playwright/test');
const { loginAsCustomer, requireRealLoginEnv } = require('../helpers/realLogin');
const { MODES, captureChip, assertInDomain, writeManifest } = require('./helpers/agentScreenshotHarness');

const VERTICAL = 'banking';
const CHIPS = [
  { chipId: 'my_accounts',   chipLabel: 'My accounts',       present: [/account|checking|savings|balance/i], absent: [/loyalty|order #|appointment|portfolio/i] },
  { chipId: 'check_balance', chipLabel: 'Check balance',     present: [/balance|\$/i],                        absent: [/loyalty|appointment|portfolio/i] },
  { chipId: 'transactions',  chipLabel: 'Recent transactions', present: [/transaction|payment|deposit|withdraw/i], absent: [/loyalty|appointment/i] },
];

test.describe('banking agent — 4-mode screenshots', () => {
  test.skip(!requireRealLoginEnv(), 'real-login env not set');
  test.setTimeout(240000);

  test('capture all chips across all modes', async ({ page }) => {
    await loginAsCustomer(page);
    await page.goto('/dashboard');

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

    // At least one mode produced a non-skipped capture.
    const anyCaptured = rows.some((r) => r.cells.some((c) => !c.skipped));
    expect(anyCaptured).toBe(true);
  });
});
