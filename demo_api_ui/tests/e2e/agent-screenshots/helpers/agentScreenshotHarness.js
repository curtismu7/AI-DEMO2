// demo_api_ui/tests/e2e/agent-screenshots/helpers/agentScreenshotHarness.js
//
// Reusable harness for capturing the Agent UI response across the four LLM
// modes, per use-case chip, in the real UI (no mocks). Selectors mirror the
// live agent panel used in banking-agent.real.spec.js:
//   panel:            .banking-agent-panel
//   chip button:      .banking-chips-dropdown__button (label text)
//   assistant bubble: .banking-agent-msg.assistant .banking-agent-msg-bubble
const fs = require('fs');
const path = require('path');
const { expect } = require('@playwright/test');

const MODES = [
  { id: 'llamacpp',     label: 'llama.cpp'  },
  { id: 'claude',       label: 'Claude'     },
  { id: 'helix_google', label: 'Helix'      },
  { id: 'google',       label: 'Google API' },
];

const SHOT_ROOT = path.resolve(__dirname, '..', '__screenshots__');

async function setAgentMode(page, modeId) {
  const res = await page.request.post('/api/langchain/config', {
    data: { agent_mode: modeId },
  });
  if (!res.ok()) throw new Error(`setAgentMode ${modeId} failed: ${res.status()}`);
  const body = await res.json();
  return body.agent_mode || modeId;
}

async function modeAvailable(page, modeId) {
  const res = await page.request.get('/api/langchain/config/status');
  if (!res.ok()) return false;
  const body = await res.json();
  // Map mode id -> provider key used by key_set (helix_google -> helix).
  const providerByMode = { llamacpp: 'llamacpp', claude: 'anthropic', helix_google: 'helix', google: 'google' };
  const provider = providerByMode[modeId] || modeId;
  return !!(body.key_set && body.key_set[provider] === true);
}

async function ensureAgentReady(page) {
  const panel = page.locator('.banking-agent-panel');
  if (await panel.isVisible().catch(() => false)) return panel;
  const fab = page.locator('.banking-agent-fab');
  await Promise.race([
    panel.waitFor({ state: 'visible', timeout: 25000 }).catch(() => {}),
    fab.first().waitFor({ state: 'visible', timeout: 25000 }).catch(() => {}),
  ]);
  if (!(await panel.isVisible().catch(() => false)) && (await fab.count())) {
    await fab.first().click();
  }
  await expect(panel).toBeVisible({ timeout: 20000 });
  return panel;
}

async function clickChip(page, chipLabel) {
  // Open the chips dropdown if the buttons aren't already visible.
  const chip = page.locator('.banking-chips-dropdown__button', { hasText: chipLabel });
  if (!(await chip.first().isVisible().catch(() => false))) {
    const trigger = page.locator('button', { hasText: /Actions|Chips|Quick/i }).first();
    if (await trigger.isVisible().catch(() => false)) await trigger.click();
  }
  await expect(chip.first()).toBeVisible({ timeout: 10000 });
  await chip.first().click();
}

async function captureChip(page, { vertical, chipId, chipLabel, modeId }) {
  const dir = path.join(SHOT_ROOT, vertical, chipId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${modeId}.png`);
  const rel = path.relative(SHOT_ROOT, file);

  if (!(await modeAvailable(page, modeId))) {
    return { modeId, file: rel, text: '', skipped: true };
  }

  await setAgentMode(page, modeId);
  const panel = await ensureAgentReady(page);
  const bubblesBefore = await page.locator('.banking-agent-msg.assistant .banking-agent-msg-bubble').count();

  await clickChip(page, chipLabel);

  // Wait for a NEW assistant bubble to settle.
  await expect
    .poll(async () => page.locator('.banking-agent-msg.assistant .banking-agent-msg-bubble').count(),
      { timeout: 45000 })
    .toBeGreaterThan(bubblesBefore);

  const lastBubble = page.locator('.banking-agent-msg.assistant .banking-agent-msg-bubble').last();
  await expect(lastBubble).toBeVisible();
  const text = (await lastBubble.innerText()).trim();

  await panel.screenshot({ path: file });
  return { modeId, file: rel, text, skipped: false };
}

function assertInDomain(text, { present = [], absent = [] }) {
  for (const re of present) {
    if (!re.test(text)) throw new Error(`in-domain check: expected /${re.source}/ in: ${text.slice(0, 200)}`);
  }
  for (const re of absent) {
    if (re.test(text)) throw new Error(`cross-domain leak: found /${re.source}/ in: ${text.slice(0, 200)}`);
  }
}

function writeManifest(vertical, rows) {
  const dir = path.join(SHOT_ROOT, vertical);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ vertical, rows }, null, 2));
}

module.exports = { MODES, SHOT_ROOT, setAgentMode, modeAvailable, ensureAgentReady, clickChip, captureChip, assertInDomain, writeManifest };
