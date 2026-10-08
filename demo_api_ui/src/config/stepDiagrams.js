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
import { StepRarViolationScene, RAR_VIOLATION_META } from '../components/StepDiagramScenes';
import { StepDpopReplayScene, DPOP_REPLAY_META } from '../components/StepDiagramScenes';
import { StepAuthzDeniedScene, AUTHZ_DENIED_META } from '../components/StepDiagramScenes';
import { StepA2aDelegationScene, A2A_DELEGATION_META } from '../components/StepDiagramScenes';
import { StepA2aOrchestratorScene, A2A_ORCHESTRATOR_META } from '../components/StepDiagramScenes';
import { StepA2aProtocolScene, A2A_PROTOCOL_META } from '../components/StepDiagramScenes';
import { StepCibaOobScene, CIBA_OOB_META } from '../components/StepDiagramScenes';

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
  {
    step: 6,
    id: 'UC14',
    title: 'PAR + RAR intent violation (DENY)',
    path: stepDiagramPath(6),
    meta: RAR_VIOLATION_META,
    render: StepRarViolationScene,
  },
  {
    step: 7,
    id: 'UC12',
    title: 'Token theft / replay defense (DPoP)',
    path: stepDiagramPath(7),
    meta: DPOP_REPLAY_META,
    render: StepDpopReplayScene,
  },
  {
    step: 8,
    id: 'UC6',
    title: 'Authz denied ($2,500 over the ceiling)',
    path: stepDiagramPath(8),
    meta: AUTHZ_DENIED_META,
    render: StepAuthzDeniedScene,
  },
  {
    step: 9,
    id: 'UC2',
    title: 'A2A delegation (nested act chain)',
    path: stepDiagramPath(9),
    meta: A2A_DELEGATION_META,
    render: StepA2aDelegationScene,
  },
  {
    step: 10,
    id: 'UC2.5',
    title: 'A2A Orchestrator (dynamic specialist pick)',
    path: stepDiagramPath(10),
    meta: A2A_ORCHESTRATOR_META,
    render: StepA2aOrchestratorScene,
  },
  {
    step: 11,
    id: 'UC2.7',
    title: 'A2A end to end (protocol + identity)',
    path: stepDiagramPath(11),
    meta: A2A_PROTOCOL_META,
    render: StepA2aProtocolScene,
  },
  {
    step: 12,
    id: 'UC22',
    title: 'CIBA out-of-band approval',
    path: stepDiagramPath(12),
    meta: CIBA_OOB_META,
    render: StepCibaOobScene,
  },
];

/** The diagram registered for a presenter step number, if any. */
export const stepDiagramFor = (step) => STEP_DIAGRAMS.find((d) => d.step === step);
