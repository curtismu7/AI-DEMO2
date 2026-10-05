import {
  ADMIN_PRIMARY_USE_CASE_IDS,
  CIAM_AGENT_TYPE_USE_CASE_IDS,
  DEMO_ADVANCED_USE_CASE_IDS,
  DEMO_PRIMARY_USE_CASE_IDS,
  DEMO_SUB_STEP_IDS,
  EXTRA_STEP_GROUPS,
  PRIVILEGE_USE_CASE_IDS,
} from './demoUseCaseSteps';

// Presenter-facing step number for a use case id. The UCxx ids are internal and
// stay as they are; this is the number people read. It mirrors the numbering in
// DemoStepsDropdown: the groups run on from one another (script, agent types,
// Privilege), counting each full list. An id that appears in two groups keeps
// its first number. Admin ids (ADMINn) never collide with the banking ones, so
// no vertical is needed to look a number up.
const NUMBERS = new Map();
const add = (ids, offset) =>
  ids.forEach((id, i) => {
    if (!NUMBERS.has(id)) NUMBERS.set(id, offset + i + 1);
  });

const script = [...DEMO_PRIMARY_USE_CASE_IDS, ...DEMO_ADVANCED_USE_CASE_IDS];
add(script, 0);
add(CIAM_AGENT_TYPE_USE_CASE_IDS, script.length);
let next = script.length + CIAM_AGENT_TYPE_USE_CASE_IDS.length;
add(PRIVILEGE_USE_CASE_IDS, next);
next += PRIVILEGE_USE_CASE_IDS.length;
for (const group of EXTRA_STEP_GROUPS) {
  add(group.ids, next);
  next += group.ids.length;
}
add(ADMIN_PRIMARY_USE_CASE_IDS, 0);

// A lettered sub-step shares its parent's number and reads "25A".
const SUB_LABELS = new Map();
for (const [parent, sub] of Object.entries(DEMO_SUB_STEP_IDS)) {
  const n = NUMBERS.get(parent);
  if (n) { NUMBERS.set(sub, n); SUB_LABELS.set(sub, `${n}A`); }
}

/** "25A" for a lettered sub-step, otherwise the plain number. */
export const demoStepLabel = (id) => SUB_LABELS.get(id) ?? NUMBERS.get(id);

export const demoStepNumber = (id) => NUMBERS.get(id);

/** "Step 27 · UC43", or just "UC43" for an id that is not a demo step. */
export const stepLabel = (id) => {
  const n = demoStepLabel(id);
  return n ? `Step ${n} · ${id}` : id;
};
