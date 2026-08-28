// banking_api_ui/src/utils/emojiAllowlist.js
/**
 * THE emoji allowlist. There is exactly one statement of it in this repo —
 * `REGRESSION_PLAN.md` §0 — and this module reads it rather than restating it.
 *
 * It used to be written out in five places (§0, CLAUDE.md, two skills, and a
 * test). They drifted: §0 listed ten, the regression-guard skill six. An agent
 * reading the skill would strip four legitimate emoji; the next agent reading
 * §0 would put them back. Copying the list again — even with a test to keep
 * the copies equal — would keep that failure mode alive, so the copies are
 * gone instead.
 *
 * Node-only (uses fs). For tests and lint scripts, not for browser bundles.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** demo_api_ui/src/utils -> repo root */
const REPO_ROOT = path.resolve(HERE, '..', '..', '..');

const PLAN = path.join(REPO_ROOT, 'REGRESSION_PLAN.md');
const ANCHOR = 'Emoji rule (project-wide)';

/** Codepoints §0 may list. Excludes U+FE0F, the variation selector. */
const GLYPH =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{2B00}-\u{2BFF}]/gu;

/**
 * Parse the allowlist out of REGRESSION_PLAN §0.
 * @returns {string[]} the permitted glyphs, in the order §0 lists them
 * @throws if §0 cannot be found or lists nothing — a silent empty list would
 *   turn every allowlist check into a no-op that always passes.
 */
export function readEmojiAllowlist() {
  const lines = fs.readFileSync(PLAN, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.includes(ANCHOR));
  if (start === -1) {
    throw new Error(
      `emojiAllowlist: "${ANCHOR}" not found in REGRESSION_PLAN.md — §0 moved or was renamed`,
    );
  }
  // The rule runs until the next bullet at the same level.
  const body = [];
  for (let i = start; i < lines.length; i += 1) {
    if (i > start && /^- \*\*/.test(lines[i])) break;
    body.push(lines[i]);
  }
  const found = [...new Set(body.join('\n').match(GLYPH) ?? [])];
  if (found.length < 5) {
    throw new Error(
      `emojiAllowlist: parsed only ${found.length} glyphs from §0 — the format changed`,
    );
  }
  return found;
}

/**
 * True when `value` contains a pictographic character §0 does not permit.
 * @param {unknown} value
 * @param {string[]} [allowed] pre-read list, to avoid re-reading per call
 */
export function hasDisallowedEmoji(value, allowed = readEmojiAllowlist()) {
  let s = String(value);
  for (const ok of allowed) s = s.split(ok).join('');
  s = s.split('️').join(''); // stranded variation selectors
  return /\p{Extended_Pictographic}/u.test(s);
}
