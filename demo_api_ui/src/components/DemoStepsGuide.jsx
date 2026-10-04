import {
  CIAM_AGENT_TYPE_USE_CASE_IDS,
  DEMO_ADVANCED_USE_CASE_IDS,
  DEMO_PRIMARY_USE_CASE_IDS,
  PRIVILEGE_USE_CASE_IDS,
} from "../config/demoUseCaseSteps";
import { DEMO_STEP_GUIDES } from "../config/demoStepGuides";

const FIELDS = [
  ["what", "What"],
  ["why", "Why"],
  ["businessValue", "Business value"],
  ["howToRun", "How to run it"],
];

// Step numbers mirror DemoStepsDropdown: each group continues the numbering of
// the one before it, counting the full id list (duplicates included).
const primary = [...DEMO_PRIMARY_USE_CASE_IDS, ...DEMO_ADVANCED_USE_CASE_IDS];
const ciamOffset = primary.length;
const privilegeOffset = ciamOffset + CIAM_AGENT_TYPE_USE_CASE_IDS.length;
const seen = new Set(primary);
const numbered = (ids, offset) =>
  ids.flatMap((id, i) => {
    if (seen.has(id) && offset > 0) return [];
    seen.add(id);
    return DEMO_STEP_GUIDES[id] ? [{ id, step: offset + i + 1 }] : [];
  });

export const GUIDE_GROUPS = [
  { label: "Presenter script", steps: numbered(primary, 0) },
  { label: "Agent types", steps: numbered(CIAM_AGENT_TYPE_USE_CASE_IDS, ciamOffset) },
  { label: "Privilege", steps: numbered(PRIVILEGE_USE_CASE_IDS, privilegeOffset) },
];

export default function DemoStepsGuide() {
  return (
    <div>
      <p>The demo steps in the same order and numbering as the Demo steps menu.</p>
      {GUIDE_GROUPS.map((group) => (
        <section key={group.label}>
          <h3>{group.label}</h3>
          <ol className="page-guide__steps page-guide__steps--plain">
            {group.steps.map(({ id, step }) => {
              const s = DEMO_STEP_GUIDES[id];
              return (
                <li key={id}>
                  <strong>
                    Step {step} · {id}: {s.title}
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
