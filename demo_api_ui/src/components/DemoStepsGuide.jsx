import { DEMO_PRIMARY_USE_CASE_IDS } from "../config/demoUseCaseSteps";
import { DEMO_STEP_GUIDES } from "../config/demoStepGuides";

const FIELDS = [
  ["what", "What"],
  ["why", "Why"],
  ["businessValue", "Business value"],
  ["howToRun", "How to run it"],
];

export default function DemoStepsGuide() {
  const steps = DEMO_PRIMARY_USE_CASE_IDS.filter((id) => DEMO_STEP_GUIDES[id]);
  return (
    <div>
      <p>The presenter demo steps in walkthrough order. The same steps are in the Demo steps menu.</p>
      <ol className="page-guide__steps">
        {steps.map((id) => {
          const s = DEMO_STEP_GUIDES[id];
          return (
            <li key={id}>
              <strong>
                {id}: {s.title}
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
    </div>
  );
}
