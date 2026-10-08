# Use-case diagram standards

How to author a diagram for a demo use case (`config/useCaseDiagrams/<UCID>.js`).
The drift test (`useCaseDiagrams.drift.test.js`) enforces most of this; the rest
is what keeps the demo's diagrams looking like one system.

## Config contract

- One file per UC, default export: `{ id, result, GROUPS, NODES, EDGES, walk }`.
- `id` is the UC id exactly as it appears in `demoUseCaseSteps.js`.
- `result`: `{ label, tone }`, tone one of `ok | warn | err | info`.
- Title, description, business value are NEVER copied in — the page imports them
  from `demoStepGuides.js`; the demo step number from `demoStepNumbers.js`.

## Layout

- Participants left→right in call order, one row: `x` increasing per node, same
  `y` (use `y: 150`). A return hop (e.g. MFA prompt going back to the user) uses
  `opts.vertical`.
- `x` values from this grid: 40, 340, 640, 940, 1240 (5 nodes max; 3–4 nodes
  start at 40 and use the same spacing).
- Node `label` ≤ 20 chars; nuances go in `sub` lines (each ≤ 24 chars) and
  `detail` (one sentence).

## Palette

- Every node's `group` is a key from `palette.js` (`user, agent, gateway,
  pingone, resource, external`). Never invent a per-diagram color. A new
  participant role starts in `palette.js`.

## Walk beats

- One walk step per edge, in edge order; every edge appears exactly once.
- `title` ≤ 30 chars is the reel card; `label` is the spoken beat; `lines[]`
  carry who-says-what for the reel details row.
- `tech[]` are the wire rows shown in the details panel. Tags, exactly:
  `API` (an HTTP call), `TOKEN` (token contents/transforms), `A2A` (card
  discovery, delegation), `POLICY` (authorize decisions, scope checks).
  One line per artifact, `c` ≤ 90 chars, arrow "->" not "→" (mono font).

## Result

- The verdict pill tone: PERMIT -> ok, STEP-UP/CONSENT/THROTTLED -> warn,
  DENY/BLOCKED -> err, LEARN/OBSERVED/APPROVED -> info.

## Adding a diagram

1. Copy `UC6.js` (smallest) as the skeleton.
2. Fill NODES/EDGES/walk; the config test asserts structure.
3. Remove the UC id from PENDING in `useCaseDiagrams.drift.test.js` — the
   ratchet test then requires it to be authored.
4. Add it to the registry `index.js` and the config's own test file.
