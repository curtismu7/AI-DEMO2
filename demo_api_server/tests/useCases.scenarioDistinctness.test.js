/**
 * Scenario-distinctness + map-completeness gates.
 *
 * THE BUG THIS EXISTS TO PREVENT
 *
 * `perVertical: READ_PER_VERTICAL` was the default for UC33 and UC28. It is a
 * SILENT fallback: a vertical with no override still resolves to a real chip and
 * a real tool, so every existing gate — routing, coverage, primaryTool drift,
 * step-verification — stayed green while the scenario demonstrated NOTHING.
 *
 * UC33's whole point is that delegated proof travels to a tool that is NOT the
 * everyday read. UC28's whole point is a tool that can FILE a request but cannot
 * GRANT it. Resolve either onto the vertical's read tool and the chip runs, the
 * ledger says PASS, and the demo silently repeats UC1.
 *
 * That is exactly what shipped: 7 of 9 verticals had both collapsed onto UC1's
 * read tool, and nothing in the repo could see it. These tests make the collapse
 * a build failure instead of an invisible content gap.
 *
 * WHY A SEPARATE FILE: useCases.primaryTool.test.js asks "does the chip route to
 * the tool we stored?" — a consistency question. This asks "is the stored tool
 * the RIGHT KIND of tool for what this use case claims to prove?" — a semantic
 * one. A catalog can be perfectly self-consistent and still demo the wrong thing.
 */
const {
  VERTICALS,
  resolveUseCase,
  READ_PRIMARY_TOOL_BY_VERTICAL,
  AMOUNT_PRIMARY_TOOL_BY_VERTICAL,
  A2A_PRIMARY_TOOL_BY_VERTICAL,
  SECOND_PRODUCT_TOOL_BY_VERTICAL,
  REQUEST_ONLY_TOOL_BY_VERTICAL,
  REQUEST_ONLY_NOT_APPLICABLE,
} = require('../config/useCases.js');
const { verticalManifest } = require('../services/verticalManifest');
const { parseHeuristic, resolveVerticalCtx } = require('../services/nlIntentParser');

/** Non-banking verticals. Banking's values live on the catalog's base entries. */
const NON_BANKING = VERTICALS.filter((v) => v !== 'banking');

describe('UC33 demonstrates a SECOND product, never a repeat of UC1', () => {
  test.each(VERTICALS)('%s — UC33 tool differs from the read tool', (vertical) => {
    const uc1 = resolveUseCase('UC1', vertical);
    const uc33 = resolveUseCase('UC33', vertical);
    if (uc33.primaryTool === uc1.primaryTool) {
      throw new Error(
        `${vertical}: UC33 resolves to "${uc33.primaryTool}" — the SAME tool as UC1. ` +
          `UC33 claims delegated proof travels to a less-common product; pointing it at the ` +
          `everyday read makes it a duplicate of UC1 that demos nothing, while every other ` +
          `gate stays green. Give the vertical an entry in SECOND_PRODUCT_TOOL_BY_VERTICAL ` +
          `(useCases.js) — every vertical already owns an api_key feature tool via its ` +
          `manifest featurePage.mcpTool.`,
      );
    }
  });
});

describe('UC28 demonstrates a REQUEST-ONLY tool, never a repeat of UC1', () => {
  test.each(VERTICALS)('%s — UC28 tool differs from the read tool, or is declared N/A', (vertical) => {
    if (vertical in REQUEST_ONLY_NOT_APPLICABLE) return; // declared + justified below
    const uc1 = resolveUseCase('UC1', vertical);
    const uc28 = resolveUseCase('UC28', vertical);
    if (uc28.primaryTool === uc1.primaryTool) {
      throw new Error(
        `${vertical}: UC28 resolves to "${uc28.primaryTool}" — the SAME tool as UC1. ` +
          `UC28 (Air Canada pattern) needs a tool that FILES a request and structurally ` +
          `cannot GRANT it; a read tool proves no boundary. Add the vertical to ` +
          `REQUEST_ONLY_TOOL_BY_VERTICAL, or — if it genuinely has no such tool yet — to ` +
          `REQUEST_ONLY_NOT_APPLICABLE with a reason.`,
      );
    }
  });

  test('every N/A entry carries a real justification', () => {
    for (const [vertical, reason] of Object.entries(REQUEST_ONLY_NOT_APPLICABLE)) {
      if (typeof reason !== 'string' || reason.trim().length < 20) {
        throw new Error(
          `REQUEST_ONLY_NOT_APPLICABLE["${vertical}"] must explain WHY and what would fix it. ` +
            `An empty or throwaway reason turns the opt-out back into the silent fallback ` +
            `this gate replaced.`,
        );
      }
    }
  });

  test('a vertical is never in BOTH the tool map and the N/A list', () => {
    const both = Object.keys(REQUEST_ONLY_NOT_APPLICABLE).filter((v) => v in REQUEST_ONLY_TOOL_BY_VERTICAL);
    expect(both).toEqual([]);
  });
});

describe('UC33 stays in sync with the manifests it borrows tools from', () => {
  // SECOND_PRODUCT_TOOL_BY_VERTICAL is not free-standing truth: each value IS the
  // vertical's manifest featurePage.mcpTool, which is what AIAgent.js actually
  // dispatches for vertical_feature_demo. If a manifest is retooled and the catalog
  // is not, UC33 would advertise a tool the client never calls.
  beforeAll(() => verticalManifest.init());

  test.each(NON_BANKING)('%s — catalog tool matches what the chip actually dispatches', (vertical) => {
    const uc33 = resolveUseCase('UC33', vertical);
    let action = null;
    try {
      const r = parseHeuristic(uc33.trigger.text, vertical, resolveVerticalCtx(vertical), {});
      action = r ? (r.banking?.action ?? r.action ?? null) : null;
    } catch (_e) {
      /* routing itself is gated by useCases.primaryTool.test.js */
    }
    // Only `vertical_feature_demo` reads the manifest at dispatch time. A vertical
    // may instead own a DEDICATED action + tool (banking: mortgage_demo ->
    // show_mortgage; sporting-goods: gear_warranty_demo -> show_gear_warranty),
    // in which case featurePage.mcpTool is a different chip's tool and comparing
    // against it would be wrong. Assert the manifest link only where it is real.
    if (action !== 'vertical_feature_demo') return;

    let manifestTool = null;
    try {
      manifestTool = (verticalManifest.resolver.resolve(vertical) || {}).featurePage?.mcpTool || null;
    } catch (_e) {
      /* resolver failure is covered by the manifest suites, not this gate */
    }
    if (!manifestTool) return;
    expect(SECOND_PRODUCT_TOOL_BY_VERTICAL[vertical]).toBe(manifestTool);
  });
});

describe('per-vertical maps cover every vertical — adding one CANNOT be forgotten', () => {
  // The propagation mechanism. Add a vertical to VERTICALS and these fail until
  // every per-vertical map has an entry, so a new vertical cannot silently ship
  // with half its use cases inheriting banking's.
  const MAPS = {
    READ_PRIMARY_TOOL_BY_VERTICAL,
    AMOUNT_PRIMARY_TOOL_BY_VERTICAL,
    A2A_PRIMARY_TOOL_BY_VERTICAL,
    SECOND_PRODUCT_TOOL_BY_VERTICAL,
  };

  test.each(Object.keys(MAPS))('%s has an entry for every non-banking vertical', (mapName) => {
    const missing = NON_BANKING.filter((v) => !MAPS[mapName][v]);
    if (missing.length) {
      throw new Error(
        `${mapName} is missing: ${missing.join(', ')}. Every vertical must store its OWN tool ` +
          `(isolation over DRY). A missing entry means that vertical's chip falls back to ` +
          `banking's tool or to its own read tool — a use case that demos the wrong thing ` +
          `while all routing gates pass.`,
      );
    }
  });

  test('UC28 coverage: every vertical is either mapped or explicitly N/A', () => {
    const unaccounted = NON_BANKING.filter(
      (v) => !(v in REQUEST_ONLY_TOOL_BY_VERTICAL) && !(v in REQUEST_ONLY_NOT_APPLICABLE),
    );
    if (unaccounted.length) {
      throw new Error(
        `UC28 has no decision recorded for: ${unaccounted.join(', ')}. Add each to ` +
          `REQUEST_ONLY_TOOL_BY_VERTICAL (it has a request-only tool) or to ` +
          `REQUEST_ONLY_NOT_APPLICABLE (it does not, yet — with a reason).`,
      );
    }
  });

  test('no map carries a vertical that is not in VERTICALS (stale entry)', () => {
    const stale = [];
    for (const [name, map] of Object.entries({ ...MAPS, REQUEST_ONLY_TOOL_BY_VERTICAL, REQUEST_ONLY_NOT_APPLICABLE })) {
      for (const v of Object.keys(map)) if (!VERTICALS.includes(v)) stale.push(`${name}.${v}`);
    }
    expect(stale).toEqual([]);
  });
});
