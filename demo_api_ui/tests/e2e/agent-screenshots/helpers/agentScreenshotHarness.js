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
  { id: 'llamacpp',     label: 'llama.cpp'     },
  { id: 'claude',       label: 'Claude'        },
  { id: 'helix_google', label: 'Helix'         },
  { id: 'gemini',       label: 'Google Gemini' },
];

const SHOT_ROOT = path.resolve(__dirname, '..', '__screenshots__');

const BUBBLE = '.banking-agent-msg.assistant .banking-agent-msg-bubble';

// Thrown when a chip is present but disabled (the Authorize/tools fetch failed,
// so the chip renders `disabled` + `...--unverified`). Clicking it would spin
// until the test timeout; captureChip catches this and records a blocked cell.
class ChipDisabledError extends Error {}

// Poll for a NEW assistant bubble (count > before) up to timeoutMs. Returns
// true if one appeared, false on timeout — never throws, so callers decide
// whether a missing response is fatal or just a recorded skip.
async function waitForNewBubble(page, before, timeoutMs) {
  try {
    await expect
      .poll(async () => page.locator(BUBBLE).count(), { timeout: timeoutMs })
      .toBeGreaterThan(before);
    return true;
  } catch {
    return false;
  }
}

async function setAgentMode(page, modeId) {
  const res = await page.request.post('/api/langchain/config', {
    data: { agent_mode: modeId },
  });
  if (!res.ok()) throw new Error(`setAgentMode ${modeId} failed: ${res.status()}`);
  const body = await res.json();
  return body.agent_mode || modeId;
}

// Switch the session's active vertical (banking -> retail/healthcare/etc.).
// Mirrors the admin UI's handleSwitchVertical: POST /api/verticals/active then
// reload so the new vertical's manifest + chips hydrate. Best-effort — returns
// false if the switch is rejected (e.g. not permitted for this user) so the
// caller can record the vertical as unavailable rather than crash. NOTE: this
// path is unverified against a live multi-vertical stack; confirm when running.
async function setVertical(page, verticalId) {
  const res = await page.request.post('/api/verticals/active', { data: { id: verticalId } });
  if (!res.ok()) return false;
  await page.goto('/dashboard', { waitUntil: 'domcontentloaded' });
  return true;
}

// Map mode id -> the low-level provider name the BFF resolves it to.
const PROVIDER_BY_MODE = { llamacpp: 'llamacpp', claude: 'anthropic', helix_google: 'helix', gemini: 'google' };

async function modeAvailable(page, modeId) {
  // Use the per-provider status endpoint (not /config/status). /config/status
  // only emits key_set flags for helix/openai/anthropic/anthropic-lmstudio, so
  // it would wrongly report google and llamacpp as always-unconfigured. The
  // per-provider endpoint runs getProviderStatus, which covers all four.
  const provider = PROVIDER_BY_MODE[modeId] || modeId;
  const res = await page.request.get(`/api/langchain/provider/${provider}/status`);
  if (!res.ok()) return false;
  const body = await res.json();
  return body.configured === true;
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
  // A tool-backed chip is disabled when the Authorize/tools fetch failed
  // (class ...--unverified, `disabled` attribute). Clicking it would retry
  // until the test timeout, so detect it and signal a blocked capture.
  if (await chip.first().isDisabled().catch(() => false)) {
    const reason = (await chip.first().getAttribute('title')) || 'chip disabled (authorize unverified)';
    throw new ChipDisabledError(reason);
  }
  // Bound the click: a tool-backed chip can flip to disabled mid-click when the
  // Authorize/tools fetch resolves after load (TOCTOU). Without a timeout,
  // Playwright retries the click on the now-disabled element for the full test
  // timeout. On failure, re-check disabled state and record a blocked skip.
  try {
    await chip.first().click({ timeout: 8000 });
  } catch (err) {
    if (await chip.first().isDisabled().catch(() => false)) {
      const reason = (await chip.first().getAttribute('title')) || 'chip disabled (authorize unverified)';
      throw new ChipDisabledError(reason);
    }
    throw err;
  }
}

async function captureChip(page, { vertical, chipId, chipLabel, modeId }) {
  const dir = path.join(SHOT_ROOT, vertical, chipId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${modeId}.png`);
  const rel = path.relative(SHOT_ROOT, file);

  if (!(await modeAvailable(page, modeId))) {
    return { modeId, file: rel, text: '', skipped: true, reason: 'provider unconfigured' };
  }

  await setAgentMode(page, modeId);
  const panel = await ensureAgentReady(page);
  const bubblesBefore = await page.locator(BUBBLE).count();

  try {
    await clickChip(page, chipLabel);
  } catch (err) {
    if (err instanceof ChipDisabledError) {
      return { modeId, file: rel, text: '', skipped: true, reason: err.message };
    }
    throw err;
  }

  // Some chips prefill the NL input instead of sending (Check balance,
  // Transfer, etc.). If no bubble started shortly and the input holds text,
  // submit it explicitly so the agent actually responds.
  const started = await waitForNewBubble(page, bubblesBefore, 5000);
  if (!started) {
    const input = page.locator('input.ba-input');
    if ((await input.count()) && (await input.inputValue().catch(() => ''))) {
      await input.press('Enter');
    }
  }

  // Wait for the response to settle (LLM round-trip can be slow). A mode that
  // never answers is recorded as a skip rather than failing the whole run.
  const answered = await waitForNewBubble(page, bubblesBefore, 60000);
  if (!answered) {
    return { modeId, file: rel, text: '', skipped: true, reason: 'no response (timeout)' };
  }

  const lastBubble = page.locator(BUBBLE).last();
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

module.exports = { MODES, SHOT_ROOT, setAgentMode, setVertical, modeAvailable, ensureAgentReady, clickChip, captureChip, assertInDomain, writeManifest };
