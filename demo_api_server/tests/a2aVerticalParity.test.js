'use strict';

/**
 * A2A parity — every vertical that gates privileged data can tell the
 * agent-to-agent story.
 *
 * Verticals are ENUMERATED from config/verticals/<id>/manifest.json, never
 * hardcoded. Vertical eleven fails here the day its manifest lands rather than
 * shipping with the demo's headline delegation story missing; replacing the walk
 * with a literal array removes the only thing this suite is for.
 *
 * The population is DERIVED, not authored: a manifest that lists a `sensitive_*`
 * tool in `groups.restrictedTools` is declaring that it ships privileged data
 * behind a group gate. That is precisely the data the vertical's A2A specialist
 * (config/a2aSpecialists.js) exists to fetch under a nested RFC 8693 act chain —
 * so a vertical making that declaration must also ship the chip that reaches it.
 * Without the chip the gate is unfalsifiable: retail, sporting-goods and workforce
 * each declared a restricted sensitive tool that no chip dispatched, so nothing
 * ever exercised the gate on them.
 *
 * This used to be called "customer vertical", and `admin` landing in it made that
 * label wrong rather than the derivation wrong. Re-read every assertion against an
 * admin vertical before renaming: each one — one *-a2a chip, naming this manifest's
 * own group-gated sensitive tool, a phrase the production parser routes to that
 * tool, a plugin that advertises and answers it — is a statement about the
 * declaration, not about who the end user is. So the population is unchanged and
 * the name now says what it selects. `admin` is deliberately held to exactly the
 * same standard: it gates privileged data, so it owes the same proof.
 *
 * The reverse direction is checked too, off the specialist registry, because a
 * vertical can acquire a specialist before it acquires a `groups` block.
 *
 * ── The third direction: silence is not an answer ───────────────────────────────
 *
 * Both directions above only see verticals that already SAID something. A vertical
 * that ships no sensitive tool and no specialist used to be invisible here, so
 * "this one has no A2A" and "this one was forgotten" were indistinguishable — the
 * same shape as a test that could never run, or a ledger that only ever said PASS.
 *
 * So every vertical in the switcher (verticalManifest.list(), i.e. one a user can
 * actually select) must EITHER be at A2A parity OR carry a declared
 * `a2aExemption` in its own manifest, with a reason. pingone-admin is the one
 * exemption today and its reason is written next to it. Delete that block and this
 * gate goes red demanding A2A — the exception cannot rot into an absence. And a new
 * vertical cannot inherit it: the schema requires the literal `exempt: true` plus a
 * reason long enough to have to say something (schema.js A2aExemptionSchema), so an
 * exemption has to be argued for, per vertical.
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

/** Derived population: every vertical declaring a group-gated `sensitive_*` tool. */
function gatedSensitiveVerticals() {
  return readManifests().map(entryFor).filter((v) => v.sensitiveTools.length > 0);
}

const GATED = gatedSensitiveVerticals();

/**
 * A well-formed, declared exemption — the ONLY thing that excuses a vertical from
 * A2A. Deliberately strict about shape as well as presence: `exempt` must be the
 * literal `true` and the reason must actually say something, so no partially
 * copied block and no truthy accident earns it. Mirrors schema.js so this gate
 * still discriminates when driven over a mutated manifest that never went through
 * the resolver.
 */
function declaredExemption(manifest) {
  const ex = manifest?.a2aExemption;
  if (!ex || ex.exempt !== true) return null;
  if (typeof ex.reason !== 'string' || ex.reason.trim().length < 120) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ex.declaredOn || ''))) return null;
  return ex;
}
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

const cases = GATED.map((e) => [e.vertical, e]);

describe('A2A parity across every vertical that gates a sensitive tool', () => {
  it('derives the population from the manifests, and finds enough to prove anything', () => {
    // A broken walk returns [] and every it.each below silently runs zero cases.
    expect(GATED.length).toBeGreaterThanOrEqual(9);
    expect(readManifests().length).toBeGreaterThan(GATED.length);
  });

  // `admin` is IN this population, held to the same standard as the nine that were
  // here first. Pinned, because its entry is the whole reason the derivation was
  // re-read — a later `groups` edit that quietly drops it out of scope would
  // otherwise look like nothing happened.
  it('includes the admin vertical, not only the customer-facing ones', () => {
    expect(GATED.map((e) => e.vertical)).toContain('admin');
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

/**
 * The third direction. GATED and verticalsWithSpecialist() only ever see verticals
 * that already said something; this one indicts silence.
 */
describe('no vertical in the switcher is silently without A2A', () => {
  const AT_PARITY = new Set([...GATED.map((e) => e.vertical), ...verticalsWithSpecialist()]);

  /** null when the vertical is accounted for, otherwise why it is not. */
  function accountedFor({ vertical, manifest }) {
    if (AT_PARITY.has(vertical)) return null;
    const ex = declaredExemption(manifest);
    if (ex) return null;
    return `${vertical}: ships no A2A specialist and no group-gated sensitive tool, and declares no a2aExemption. `
      + 'Either give it the specialist chain the other verticals have, or declare the exemption in its manifest with the reason.';
  }

  const listed = () => verticalManifest.list()
    .map((v) => readManifests().find((m) => m.vertical === v.id))
    .filter(Boolean);

  it('finds the switcher verticals, so the cases below are not empty', () => {
    expect(listed().length).toBeGreaterThanOrEqual(10);
  });

  it.each(listed().map((m) => [m.vertical, m]))(
    '%s either has A2A or declares an exemption — never neither',
    (_vertical, m) => {
      expect(accountedFor(m)).toBeNull();
    },
  );

  it('pingone-admin is the declared exemption, and it says why', () => {
    const m = readManifests().find((x) => x.vertical === 'pingone-admin');
    const ex = declaredExemption(m.manifest);
    expect(ex).toBeTruthy();
    // The reason has to carry the actual argument, not a placeholder — these are
    // the two facts a future contributor needs before "fixing" it for symmetry.
    expect(ex.reason).toMatch(/MCP explorer/i);
    expect(ex.reason).toMatch(/no (local data store|sensitive per-user record)/i);
    // …and it must not have quietly acquired the thing it says it does not have.
    expect(GATED.map((e) => e.vertical)).not.toContain('pingone-admin');
    expect(verticalsWithSpecialist()).not.toContain('pingone-admin');
  });

  it('the exemption survives schema resolution — it is not silently stripped', () => {
    expect(verticalManifest.resolver.resolve('pingone-admin').a2aExemption?.exempt).toBe(true);
  });

  it('REVERT-TO-RED: deleting the exemption makes the gate demand A2A', () => {
    const m = readManifests().find((x) => x.vertical === 'pingone-admin');
    const stripped = { vertical: m.vertical, manifest: { ...m.manifest, a2aExemption: undefined } };
    expect(accountedFor(stripped)).toMatch(/declares no a2aExemption/);
  });

  it.each([
    ['exempt is truthy but not the literal true', { exempt: 'yes', reason: 'x'.repeat(200), declaredOn: '2026-08-03' }],
    ['reason is a placeholder', { exempt: true, reason: 'TODO', declaredOn: '2026-08-03' }],
    ['no declaredOn date', { exempt: true, reason: 'x'.repeat(200) }],
    ['empty block', {}],
  ])('REVERT-TO-RED: a malformed exemption earns nothing (%s)', (_label, a2aExemption) => {
    const m = readManifests().find((x) => x.vertical === 'pingone-admin');
    expect(accountedFor({ vertical: m.vertical, manifest: { ...m.manifest, a2aExemption } }))
      .toMatch(/declares no a2aExemption/);
  });

  it('REVERT-TO-RED: a NEW vertical cannot inherit the exemption', () => {
    // Same shape a brand-new manifest would have: no groups, no specialist, no
    // exemption of its own. It must be indicted by name.
    const fresh = { vertical: 'brand-new-vertical', manifest: { id: 'brand-new-vertical', dashboard: { chips10: [] } } };
    expect(accountedFor(fresh)).toMatch(/^brand-new-vertical: ships no A2A specialist/);
  });
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
