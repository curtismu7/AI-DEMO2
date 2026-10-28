# Embedded flow diagram standards

For every diagram built with `EmbeddedFlowDiagram` (a config in `demo_api_ui/src/config/*Diagram.js`
with `GROUPS`, `NODES`, `EDGES`, `STEPS`). Reference example: `PF_TOKEN_DIAGRAM` in
`config/privilegePfTokenDemo.js`. The structure is enforced by `config/__tests__/embeddedDiagrams.test.js`.

## Every arrow has a number and a name

- Arrows are numbered by their position in `EDGES`. The number sits on the line in an orange badge.
- Every arrow also has a **name**: the third field of `E(from, to, 'name')`. On the line the badge and the
  name read as one pill, for example `2  tools/list + JWT`. The step chips under the diagram repeat it as
  `2  Demo BFF -> P1 Privilege Agent App pftoken / tools/list + JWT`.
- The name says what travels or what happens: a call (`tools/list + JWT`), a decision (`verify`, `match`),
  a result (`ALLOW`, `DENY`). Never blank (a test fails), never just `step` or an arrow.
- Keep it to about 40 characters so the pill fits on the line. Put detail in the step card instead.
- The name has to read well after the two node names, because the chip shows it that way.

## Every step has a card

- One step per arrow group, in order; every arrow is covered by a step.
- `title`: what happens, as a sentence fragment ("The token goes to the P1 Privilege Agent App").
- `what`: the facts, with the real names and values.
- `why`: why it matters, or what goes wrong when it fails.

## Nodes and groups

- Node label short (about 30 characters), two short `sub` lines at most.
- One group per kind of actor; the legend under the diagram comes from `GROUPS`.
- Names follow the naming rules (for example "P1 Privilege Agent App", not "door").

## Controls

`EmbeddedFlowDiagram` already provides the four required controls: movable boxes, Simulate, Reset and
the speed control. Do not hand-roll a diagram without them.

## Adding one

1. Copy the shape of `PF_TOKEN_DIAGRAM`.
2. Register the config in `config/__tests__/embeddedDiagrams.test.js` (unique nodes, valid edges, steps
   cover every edge, every arrow named).
3. Add it to the page, the `/diagrams` index and the Learning Hub, as for any diagram.
4. Open it in a real browser and click Simulate: you should see `Step 1 / N` and the pill moving along
   the arrows.
