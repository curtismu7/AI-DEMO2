import {
  ADMIN_PRIMARY_USE_CASE_IDS,
  CIAM_AGENT_TYPE_USE_CASE_IDS,
  DEMO_ADVANCED_USE_CASE_IDS,
  DEMO_PRIMARY_USE_CASE_IDS,
  EXTRA_STEP_GROUPS,
  PRIVILEGE_USE_CASE_IDS,
} from "../config/demoUseCaseSteps";
import { demoStepNumber, stepLabel } from "../config/demoStepNumbers";
import { DEMO_STEP_GUIDES } from "../config/demoStepGuides";

const FIELDS = [
  ["what", "What"],
  ["why", "Why"],
  ["businessValue", "Business value"],
  ["howToRun", "How to run it"],
];

// Each id is listed once, in the group where it first gets its number.
const inGroup = (ids, from, to) =>
  ids.filter((id) => DEMO_STEP_GUIDES[id] && demoStepNumber(id) > from && demoStepNumber(id) <= to);
const script = [...DEMO_PRIMARY_USE_CASE_IDS, ...DEMO_ADVANCED_USE_CASE_IDS];
const ciamEnd = script.length + CIAM_AGENT_TYPE_USE_CASE_IDS.length;

const base = [
  { label: "Presenter script", ids: inGroup(script, 0, script.length) },
  { label: "Agent types", ids: inGroup(CIAM_AGENT_TYPE_USE_CASE_IDS, script.length, ciamEnd) },
  { label: "Privilege", ids: inGroup(PRIVILEGE_USE_CASE_IDS, ciamEnd, ciamEnd + PRIVILEGE_USE_CASE_IDS.length) },
  ...EXTRA_STEP_GROUPS.map((g) => ({ label: g.label, ids: g.ids.filter((id) => DEMO_STEP_GUIDES[id]) })),
  { label: "PingOne Admin vertical", ids: ADMIN_PRIMARY_USE_CASE_IDS.filter((id) => DEMO_STEP_GUIDES[id]) },
];

// The menu repeats a step under every group it belongs to (A2A collects steps
// listed elsewhere); the guide explains each step once, where it first appears.
const shown = new Set();
export const GUIDE_GROUPS = base
  .map((g) => ({ ...g, ids: g.ids.filter((id) => !shown.has(id) && shown.add(id)) }))
  .filter((g) => g.ids.length > 0);

export default function DemoStepsGuide() {
  return (
    <div>
      <p>The demo steps in the same order and numbering as the Demo steps menu.</p>
      {GUIDE_GROUPS.map((group) => (
        <section key={group.label}>
          <h3>{group.label}</h3>
          <ol className="page-guide__steps page-guide__steps--plain">
            {group.ids.map((id) => {
              const s = DEMO_STEP_GUIDES[id];
              return (
                <li key={id}>
                  <strong>
                    {stepLabel(id)}: {s.title}
                  </strong>
                  {FIELDS.map(([key, label]) => (
                    <p key={key}>
                      <em>{label}.</em> {s[key]}
                    </p>
                  ))}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
