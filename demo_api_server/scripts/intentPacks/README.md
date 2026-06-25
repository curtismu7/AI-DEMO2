# Intent Packs — efficient, declarative intent expansion

Adding agent intents to a plugin vertical used to mean hand-editing 6 files per
intent (seed, tools defs + execute case, heuristic, render, directive shape +
intent map, eval). This makes it **one JSON file + one command**, idempotent and
eval-gated, and works for **any** plugin vertical.

## Add or update intents

1. Edit `config/verticals/<vertical>/intents.pack.json` (create if absent). See
   the schema in `applyIntentPack.js` header. One entry per intent.
2. Apply:
   ```
   node scripts/intentPacks/applyIntentPack.js <vertical>
   ```
   Re-running is safe (idempotent) — it updates the managed regions in place.
   Use `--dry` to preview which files would change.
3. Gate:
   ```
   node scripts/intentPacks/routingEval.js <vertical>            # heuristic layer (CI-safe)
   node scripts/intentPacks/routingEval.js <vertical> --provider=auto --all   # LLM + long tail
   ```
   Exit 0 only at 100%. Fix collisions by tightening a `heuristicRegex` or
   reordering entries in the pack (pack order = heuristic specificity), then
   re-apply + re-eval.

## What it writes (uniform anchors every plugin shares)

| File | How | Idempotent by |
|---|---|---|
| `seed.json` | adds each intent's `seedRows` under `arr` | key (array name) |
| `tools.js` | tool defs after `const tools = [`; execute cases after `switch (name) {` | `/* PACK:... */` marker regions |
| `index.js` | heuristics after `const HEURISTICS = [` (top = most specific) | marker region |
| `manifest.json` | render descriptor after `"render": {` | skip-if-action-present |
| `docs/HELIX_AGENT_DIRECTIVES.json` | shape + INTENT MAP line in the `<vertical>` theme (created if absent) | skip-if-action-present |
| `routing.fixture.json` | per-vertical eval fixture | pack-owned, overwritten |

Write intents are self-contained in `tools.js` (find-by-id + `Object.assign`
on the seed array) — **no `data.js` / store-method changes**. The id arrives as
the schema param (LLM path) or `params.recordId` (heuristic `extractsRecordId`);
the single alias lives in the generated case.

## Heuristic-backed vs directive-only

- `needsHeuristic: true` → adds a regex (zero-latency, asserted by the default
  eval). Use for the common/chip intents.
- `needsHeuristic: false` → directive-only long tail. Routed by the LLM via the
  directive; validated only under `--provider=auto --all`. Keeps the heuristic
  collision surface small.

## Notes

- The applier never touches another vertical or shared routing code
  (`nlIntentParser.js`); blast radius is one vertical's files + that vertical's
  theme block.
- Banking is the baseline (`kind:'banking'`) and is **not** a pack target.
