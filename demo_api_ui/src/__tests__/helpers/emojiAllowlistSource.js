import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * REGRESSION_PLAN §0 is the ONE statement of the emoji allowlist. Tests read it
 * rather than restating it — the list was written out in five places once and
 * they drifted (one listed six entries while the others listed ten), so an
 * agent reading the wrong copy stripped four legitimate emoji.
 */
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..',
);
const PLAN = path.join(REPO_ROOT, 'REGRESSION_PLAN.md');
const ANCHOR = 'Emoji rule (project-wide)';

const GLYPH =
  /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F000}-\u{1F2FF}\u{2B00}-\u{2BFF}]/gu;

/**
 * @returns {string[]} the glyphs §0 permits, in the order it lists them
 * @throws if §0 moved or lists nothing — an empty list would silently turn
 *   every allowlist check into a no-op that always passes
 */
export function readEmojiAllowlistFromPlan() {
  const lines = fs.readFileSync(PLAN, 'utf8').split('\n');
  const start = lines.findIndex((l) => l.includes(ANCHOR));
  if (start === -1) {
    throw new Error(`emoji allowlist: "${ANCHOR}" not found in REGRESSION_PLAN.md`);
  }
  const body = [];
  for (let i = start; i < lines.length; i += 1) {
    if (i > start && /^- \*\*/.test(lines[i])) break;
    body.push(lines[i]);
  }
  const found = [...new Set(body.join('\n').match(GLYPH) ?? [])];
  if (found.length < 5) {
    throw new Error(`emoji allowlist: parsed only ${found.length} glyphs — §0's format changed`);
  }
  return found;
}
