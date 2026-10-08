// stepDiagrams.js — the registry behind "Open diagram" (Mission Control step
// header and cards) and the explain modal's diagram section. One diagram per
// demo step, keyed by presenter step number (demoStepNumbers.js). A step has a
// diagram or it doesn't: nothing renders a placeholder, and coverage grows by
// adding one entry + one scene here.
//
// `render(st)` receives the walkthrough-state function from the same player the
// Demo arch slides use, so scenes light their hops with the existing classes.
import { StepDelegatedAccessScene, DELEGATED_ACCESS_META } from '../components/StepDiagramScenes';
import { StepHitlConsentScene, HITL_CONSENT_META } from '../components/StepDiagramScenes';
import { StepMfaStepUpScene, MFA_STEPUP_META } from '../components/StepDiagramScenes';
import { StepParRarScene, PAR_RAR_META } from '../components/StepDiagramScenes';

export const stepDiagramPath = (step) => `/step-diagrams/${step}`;

export const STEP_DIAGRAMS = [
  {
    step: 2,
    id: 'UC1',
    title: 'Delegated access (consent only)',
    path: stepDiagramPath(2),
    meta: DELEGATED_ACCESS_META,
    render: StepDelegatedAccessScene,
  },
  {
    step: 3,
    id: 'UC8',
    title: '✦ MCP App · transfer approval',
    path: stepDiagramPath(3),
    meta: HITL_CONSENT_META,
    render: StepHitlConsentScene,
  },
  {
    step: 4,
    id: 'UC7',
    title: 'MFA step-up (HITL)',
    path: stepDiagramPath(4),
    meta: MFA_STEPUP_META,
    render: StepMfaStepUpScene,
  },
  {
    step: 5,
    id: 'UC14b',
    title: 'PAR + RAR intent verified (PERMIT)',
    path: stepDiagramPath(5),
    meta: PAR_RAR_META,
    render: StepParRarScene,
  },
];

/** The diagram registered for a presenter step number, if any. */
export const stepDiagramFor = (step) => STEP_DIAGRAMS.find((d) => d.step === step);
