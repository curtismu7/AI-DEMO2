'use strict';

/**
 * A2A parity — every customer vertical can tell the agent-to-agent story.
 *
 * Verticals are ENUMERATED from config/verticals/<id>/manifest.json, never
 * hardcoded. Vertical eleven fails here the day its manifest lands rather than
 * shipping with the demo's headline delegation story missing; replacing the walk
 * with a literal array removes the only thing this suite is for.
 *
 * "Customer vertical" is DERIVED, not authored: a manifest that lists a
 * `sensitive_*` tool in `groups.restrictedTools` is declaring that it ships
 * privileged data behind a group gate. That is precisely the data the vertical's
 * A2A specialist (config/a2aSpecialists.js) exists to fetch under a nested
 * RFC 8693 act chain — so a vertical making that declaration must also ship the
 * chip that reaches it. Without the chip the gate is unfalsifiable: retail,
 * sporting-goods and workforce each declared a restricted sensitive tool that no
 * chip dispatched, so nothing ever exercised the gate on them.
 *
 * The reverse direction is checked too, off the specialist registry, because a
 * vertical can acquire a specialist before it acquires a `groups` block.
 *
 * Every assertion has a revert-to-RED case at the bottom, driving the SAME
 * verdict function over a MUTATED copy of the live manifests — a gate that has
 * never been watched to go red is not evidence.
 */

const fs = require('node:fs');
const path = require('node:path');

const { verticalManifest } = require('../services/verticalManifest');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');
// The SAME action -> tool resolver `npm run intents:check` uses. Reused rather
// than reimplemented so a chip cannot pass here and fail there.
const { resolveToolForAction } = require('../scripts/gen-intent-topology');
const { verticalsWithSpecialist } = require('../config/a2aSpecialists');

const VERTICALS_DIR = path.join(__dirname, '..', 'config', 'verticals');
const SENSITIVE_NAME = /sensitive/i;
const A2A_CHIP_ID = /-a2a$/;

verticalManifest.init();

/** Every vertical that has a manifest, with it parsed. */
function readManifests() {
  const out = [];
  for (const vertical of fs.readdirSync(VERTICALS_DIR).sort()) {
    const p = path.join(VERTICALS_DIR, vertical, 'manifest.json');
    if (!fs.existsSync(p)) continue;
    out.push({ vertical, manifest: JSON.parse(fs.readFileSync(p, 'utf8')) });
  }
  return out;
}

/** The group-gated `sensitive_*` tools a manifest declares. */
function sensitiveRestrictedTools(manifest) {
  const restricted = manifest.groups?.restrictedTools || {};
  return Object.keys(restricted).filter((t) => SENSITIVE_NAME.test(t));
}

function entryFor({ vertical, manifest }) {
  return {
    vertical,
    manifest,
    chips: manifest.dashboard?.chips10 || [],
    sensitiveTools: sensitiveRestrictedTools(manifest),
  };
}

/** Customer verticals, derived: those declaring a group-gated sensitive tool. */
function customerVerticals() {
  return readManifests().map(entryFor).filter((v) => v.sensitiveTools.length > 0);
}

const CUSTOMER = customerVerticals();
const a2aChipsOf = (entry) => entry.chips.filter((c) => A2A_CHIP_ID.test(String(c.id || '')));

/** The heuristic action the production parser reaches for a phrase. */
function heuristicAction(message, vertical) {
  const parsed = parseHeuristic(message, vertical, resolveVerticalCtx(vertical));
  return parsed?.banking?.action || parsed?.action || null;
}

/**
 * The whole verdict for one vertical, as ONE function, so the revert-to-RED
 * cases drive exactly the code the live assertions do. Returns null when the
 * vertical is at parity, otherwise the reason it is not.
 */
function a2aVerdict(entry) {
  const chips = a2aChipsOf(entry);
  if (chips.length !== 1) {
    return `${entry.vertical}: expected exactly one *-a2a chip, found ${chips.length}`;
  }
  const chip = chips[0];
  if (!entry.sensitiveTools.includes(chip.tool)) {
    return `${entry.vertical}: ${chip.id} declares "${chip.tool}", which is not one of its own group-gated sensitive tools [${entry.sensitiveTools.join(', ')}]`;
  }
  // Not "resolves to something" — resolves to THIS chip's tool. A phrase that
  // dead-ends, or that another heuristic claims first, is caught here.
  const action = heuristicAction(chip.message, entry.vertical);
  const { tool } = resolveToolForAction(action, entry.vertical, entry.manifest);
  if (tool !== chip.tool) {
    return `${entry.vertical}: "${chip.message}" resolves to ${JSON.stringify(tool)}, not the declared "${chip.tool}"`;
  }
  return null;
}

/** A copy whose chips10 can be mutated without touching the live data. */
const mutable = (entry) => ({ ...entry, chips: entry.chips.map((c) => ({ ...c })) });
const a2aChipIn = (entry) => entry.chips.find((c) => A2A_CHIP_ID.test(String(c.id || '')));

const cases = CUSTOMER.map((e) => [e.vertical, e]);

describe('A2A parity across every customer vertical', () => {
  it('derives the customer verticals from the manifests, and finds enough to prove anything', () => {
    // A broken walk returns [] and every it.each below silently runs zero cases.
    expect(CUSTOMER.length).toBeGreaterThanOrEqual(9);
    expect(readManifests().length).toBeGreaterThan(CUSTOMER.length);
  });

  it.each(cases)(
    '%s ships an *-a2a chip that dispatches its own group-gated sensitive tool',
    (_vertical, entry) => {
      expect(a2aVerdict(entry)).toBeNull();
    },
  );

  it.each(verticalsWithSpecialist())(
    '%s has a registered A2A specialist, so it must ship an *-a2a chip',
    (vertical) => {
      const found = readManifests().find((m) => m.vertical === vertical);
      expect(found).toBeDefined();
      expect(a2aChipsOf(entryFor(found)).map((c) => c.id)).toHaveLength(1);
    },
  );
});

describe('the *-a2a chip reaches a real tool, not just a declared name', () => {
  it.each(cases)(
    "%s's vertical plugin advertises the tool the phrase resolves to",
    (vertical, entry) => {
      const chip = a2aChipIn(entry);
      const plugin = verticalManifest.plugins.get(vertical);
      expect(plugin).toBeDefined();
      expect(plugin.getTools().map((t) => t.name)).toContain(heuristicAction(chip.message, vertical));
    },
  );

  it.each(cases)(
    "%s's sensitive tool runs — it is a real action, not a name nothing answers to",
    async (vertical, entry) => {
      const chip = a2aChipIn(entry);
      const plugin = verticalManifest.plugins.get(vertical);
      const out = await plugin.executeTool(heuristicAction(chip.message, vertical), {}, { userId: 'demoUser' });
      // An undeclared action returns `{ result: { error: 'unknown <x> action: …' } }`.
      // A tool the plugin hands to the MCP executor legitimately returns no local
      // payload, and that IS a dispatch — so only the unknown-action shape fails.
      const err = out?.result?.error;
      expect(String(err || '')).not.toMatch(/unknown/i);
    },
  );
});

describe('the gate goes RED when the *-a2a chip is reverted', () => {
  it.each(cases)('%s FAILS once its *-a2a chip is removed', (_vertical, entry) => {
    const reverted = mutable(entry);
    reverted.chips = reverted.chips.filter((c) => !A2A_CHIP_ID.test(String(c.id || '')));
    expect(a2aVerdict(reverted)).toMatch(/expected\sexactly\sone\s\*-a2a\schip,\sfound\s0/);
  });

  it.each(cases)('%s FAILS once its *-a2a chip stops naming a sensitive tool', (_vertical, entry) => {
    const reverted = mutable(entry);
    a2aChipIn(reverted).tool = 'jwt_decode_full';
    expect(a2aVerdict(reverted)).toMatch(/not\sone\sof\sits\sown\sgroup-gated\ssensitive\stools/);
  });

  it.each(cases)('%s FAILS once its *-a2a phrase stops routing to that tool', (_vertical, entry) => {
    const reverted = mutable(entry);
    // A phrase no vertical heuristic claims — the chip would dead-end without an LLM.
    a2aChipIn(reverted).message = 'zzzz plugh xyzzy';
    expect(a2aVerdict(reverted)).toMatch(/resolves\sto\snull,\snot\sthe\sdeclared/);
  });
});
