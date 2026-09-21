import { useCallback, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import DemoCard from "../components/learning/DemoCard";
import TenantReadinessStrip from "../components/learning/TenantReadinessStrip";
import { getLesson } from "../learning/lessonCatalog";
import { PROVENANCE } from "../learning/provenance";
import {
  getTenantReadiness,
  isObservationActionSupported,
  resetLesson,
  runLesson,
} from "../services/lessonExecutionService";
import "./StandaloneDemoLauncherPage.css";

export const SCENARIOS = Object.freeze([
  {
    id: "delegated-access",
    title: "Delegated access",
    lessonId: "delegation",
    evidenceAction: "token-exchange",
    durationMinutes: 5,
    dependencyIds: ["pingone", "mcp"],
    outcome:
      "The customer sees that the agent acts for a known person with narrower authority and a traceable actor chain.",
    script: [
      "Open the token-exchange demo and identify the person, agent, and requested tool.",
      "Run one scoped action and narrate the subject and actor relationship.",
      "Close on the narrowed audience, scope, and evidence trail rather than token contents.",
    ],
    resetBehavior:
      "Clear the captured evidence, then use the linked demo reset if its session history must also be cleared.",
  },
  {
    id: "authorize-denial",
    title: "Authorize denial",
    lessonId: "authorize",
    evidenceAction: "authorize-decision",
    durationMinutes: 4,
    dependencyIds: ["authorize"],
    outcome:
      "The customer sees policy stop an agent action before the protected tool can run.",
    script: [
      "Open the policy decision surface and choose a request that exceeds policy.",
      "Run the request and pause on the DENY result and reason.",
      "Explain that the enforcement point follows the decision instead of the model's preference.",
    ],
    resetBehavior:
      "Clear this card's evidence; restore any changed test input in the linked policy surface before the next run.",
    evidenceDetail:
      "Direct read-only recent-decision evidence; no new policy evaluation runs here.",
  },
  {
    id: "ciba-approval",
    title: "CIBA and approval",
    lessonId: "hitl-step-up",
    evidenceAction: "hitl-step-up",
    durationMinutes: 6,
    dependencyIds: ["pingone", "authorize"],
    outcome:
      "The customer sees a high-impact action pause until the right person approves it through a stronger channel.",
    script: [
      "Launch a transfer that requires human approval and show the paused agent state.",
      "Complete the CIBA or in-session approval on the user-controlled channel.",
      "Return to the original action and show that only the approved request resumes.",
    ],
    resetBehavior:
      "Clear captured evidence and cancel any pending approval in the linked demo before starting a fresh request.",
    evidenceDetail:
      "Direct read-only CIBA token-chain evidence; approval still runs in the linked demo.",
  },
  {
    id: "agent-revocation",
    title: "Agent revocation",
    lessonId: "lifecycle",
    evidenceAction: "agent-lifecycle",
    durationMinutes: 5,
    dependencyIds: ["pingone"],
    outcome:
      "The customer sees an agent identity revoked independently and the next attempted action fail closed.",
    script: [
      "Start with an active agent and establish that one governed action succeeds.",
      "Revoke the demo agent at the instance scope and point out the lifecycle change.",
      "Show the denied retry, then explain how the audit trail preserves who changed the state.",
    ],
    resetBehavior:
      "Clear launcher evidence, then restore the demo agent in the linked registry before presenting the scenario again.",
    evidenceDetail:
      "Bounded identity mapping evidence; revocation and the denied retry remain in the linked demo.",
  },
  {
    id: "mcp-discovery",
    title: "MCP discovery",
    lessonId: "mcp",
    evidenceAction: "mcp-discovery",
    durationMinutes: 4,
    dependencyIds: ["mcp"],
    outcome:
      "The customer sees tools discovered through a governed MCP boundary before any tool is invoked.",
    script: [
      "Open discovery and identify the server inventory without exposing credentials.",
      "Inspect one tool's declared capability and required input.",
      "Launch a permitted call and distinguish discovery evidence from execution evidence.",
    ],
    resetBehavior:
      "Clear captured evidence; refresh the linked inventory if the MCP topology changed during the demo.",
  },
  {
    id: "replay-defense",
    title: "Replay defense",
    lessonId: "threat-defense",
    evidenceAction: null,
    durationMinutes: 3,
    dependencyIds: ["mcp"],
    outcome:
      "The customer sees a captured proof rejected when an attacker tries to reuse it.",
    script: [
      "Open the attack-defense surface and select the replay scenario.",
      "Run the captured request a second time and pause on the rejection.",
      "Explain the binding that makes the stolen material unusable for a new request.",
    ],
    resetBehavior:
      "Clear the attack evidence. Start a new scenario for another run because the demonstrated proof is intentionally single-use.",
  },
  {
    id: "prompt-injection-defense",
    title: "Prompt-injection defense",
    lessonId: "threat-defense",
    evidenceAction: null,
    durationMinutes: 5,
    dependencyIds: ["authorize"],
    outcome:
      "The customer sees malicious instructions contained before they can expand the agent's authority.",
    script: [
      "Introduce the malicious instruction and state what action it is trying to induce.",
      "Run the scenario and show the detection or policy denial at the enforcement point.",
      "Contrast model input with the independently enforced identity, scope, and policy boundary.",
    ],
    resetBehavior:
      "Clear captured evidence and remove the malicious input from the linked workbench before the next scenario.",
  },
  {
    id: "privilege-mcp",
    title: "Privilege MCP",
    lessonId: "privilege-mcp",
    evidenceAction: "privilege-status",
    durationMinutes: 6,
    dependencyIds: ["privilege", "mcp"],
    outcome:
      "The customer sees privileged access delivered only when the agent reaches the protected MCP action.",
    script: [
      "Open the product-path demo and identify the protected MCP target.",
      "Run the action through the initialized Privilege relay and show the temporary access boundary.",
      "Close on the separation between the agent's identity and the privileged credential path.",
    ],
    resetBehavior:
      "Clear launcher evidence and end any temporary session in the linked Privilege demo before rerunning.",
    evidenceDetail:
      "Privilege relay readiness evidence; no privileged tool call or credential issuance runs here.",
  },
  {
    id: "davinci-orchestration",
    title: "DaVinci orchestration",
    lessonId: "login",
    evidenceAction: "davinci-session-status",
    durationMinutes: 7,
    dependencyIds: ["davinci", "pingone"],
    outcome:
      "The customer sees identity orchestration adapt the journey while the application keeps tokens out of browser code.",
    script: [
      "Open the login lesson and frame the user journey before starting it.",
      "Follow the DaVinci-driven steps and call out the change in orchestration state.",
      "Complete sign-in, then show the server-side session boundary and recorded evidence.",
    ],
    resetBehavior:
      "Clear captured evidence, sign out of the linked flow, and restart the journey from its first screen.",
    evidenceDetail:
      "Bounded session-status evidence; orchestration steps remain in the linked DaVinci demo.",
  },
  {
    id: "observability",
    title: "Observability",
    lessonId: "evidence-timeline",
    evidenceAction: "audit-evidence",
    durationMinutes: 4,
    dependencyIds: ["pingone"],
    outcome:
      "The customer sees identity, policy, and lifecycle evidence connected into one defensible agent activity story.",
    script: [
      "Open the lifecycle evidence view after a governed agent action.",
      "Trace the person, agent, decision, and resulting status without revealing bearer tokens.",
      "Summarize which evidence came from the live environment and which fallback remains available.",
    ],
    resetBehavior:
      "Clear the launcher evidence and reset filters in the linked evidence view; source audit records remain intact.",
    evidenceDetail:
      "Read-only token-chain evidence; records may include activity from earlier sessions.",
  },
]);

const PROVENANCE_RANK = Object.freeze({
  [PROVENANCE.SIMULATED]: 1,
  [PROVENANCE.RECORDED]: 2,
  [PROVENANCE.LIVE_LOCAL]: 3,
  [PROVENANCE.LIVE_CLOUD]: 4,
});

function lowestProvenance(dependencies, fallback) {
  return dependencies.reduce((current, item) => {
    if (!PROVENANCE_RANK[item.provenance]) return current;
    if (
      !current ||
      PROVENANCE_RANK[item.provenance] < PROVENANCE_RANK[current]
    ) {
      return item.provenance;
    }
    return current;
  }, fallback);
}

function scenarioAvailability(scenario, lesson, readinessState) {
  const dependencyMap = new Map(
    (readinessState.snapshot?.dependencies || []).map((item) => [
      item.id,
      item,
    ]),
  );
  const dependencies = scenario.dependencyIds
    .map((id) => dependencyMap.get(id))
    .filter(Boolean);
  const ready =
    readinessState.status === "loaded" &&
    dependencies.length === scenario.dependencyIds.length &&
    dependencies.every((item) => item.status === "available");
  const evidenceSupported = isObservationActionSupported(
    scenario.evidenceAction,
  );
  const evidenceDetail = evidenceSupported
    ? scenario.evidenceDetail ||
      "A direct, read-only evidence observation is connected for this scenario."
    : "No scenario-specific evidence check is connected. Launch the demo and inspect evidence in that surface.";

  if (ready) {
    return {
      available: true,
      evidenceSupported,
      evidenceDetail,
      dependencies,
      provenance: lowestProvenance(dependencies, lesson.provenance.primary),
      detail: "Available from the current readiness checks.",
    };
  }

  const unavailable = dependencies
    .filter((item) => item.status !== "available")
    .map((item) => item.label);
  return {
    available: false,
    evidenceSupported,
    evidenceDetail,
    dependencies,
    provenance: lesson.fallback.provenance,
    detail: `${unavailable.join(", ") || "Live prerequisites"} unavailable. ${lesson.fallback.label} is the declared fallback and has not been started.`,
  };
}

export default function StandaloneDemoLauncherPage({
  loadReadiness = getTenantReadiness,
  executeLesson = runLesson,
  resetExecution = resetLesson,
  readinessPollIntervalMs = 30000,
}) {
  const [activeCategory, setActiveCategory] = useState("All demos");
  const [readinessState, setReadinessState] = useState({
    status: "loading",
    snapshot: null,
  });
  const [runResults, setRunResults] = useState({});
  const [actionStates, setActionStates] = useState({});
  const generations = useRef({});

  const scenarios = useMemo(
    () =>
      SCENARIOS.map((scenario) => ({
        scenario,
        lesson: getLesson(scenario.lessonId),
      })).filter((entry) => entry.lesson),
    [],
  );
  const categories = useMemo(
    () => [
      "All demos",
      ...new Set(scenarios.map((entry) => entry.lesson.category)),
    ],
    [scenarios],
  );
  const visibleScenarios = scenarios.filter(
    (entry) =>
      activeCategory === "All demos" ||
      entry.lesson.category === activeCategory,
  );

  const captureReadiness = useCallback(async () => {
    try {
      const snapshot = await loadReadiness();
      setReadinessState({ status: "loaded", snapshot });
      return snapshot;
    } catch (error) {
      setReadinessState({ status: "error", snapshot: null });
      throw error;
    }
  }, [loadReadiness]);

  const handleCheckEvidence = async (entry) => {
    const { scenario, lesson } = entry;
    if (!scenario.evidenceAction) return;
    const generation = (generations.current[scenario.id] || 0) + 1;
    generations.current[scenario.id] = generation;
    setActionStates((current) => ({
      ...current,
      [scenario.id]: "checking",
    }));
    try {
      const result = await executeLesson(lesson.id, {
        mode: "standalone",
        action: scenario.evidenceAction,
      });
      if (generations.current[scenario.id] !== generation) return;
      const observed = result?.result?.status === "observed";
      setRunResults((current) => ({
        ...current,
        [scenario.id]: observed ? result : null,
      }));
      setActionStates((current) => ({
        ...current,
        [scenario.id]: observed ? "observed" : "no-evidence",
      }));
    } catch {
      if (generations.current[scenario.id] !== generation) return;
      setActionStates((current) => ({
        ...current,
        [scenario.id]: "check-error",
      }));
    }
  };

  const handleReset = async (entry) => {
    const { scenario, lesson } = entry;
    generations.current[scenario.id] =
      (generations.current[scenario.id] || 0) + 1;
    setActionStates((current) => ({
      ...current,
      [scenario.id]: "resetting",
    }));
    try {
      await resetExecution(lesson.id);
      setRunResults((current) => {
        const next = { ...current };
        delete next[scenario.id];
        return next;
      });
      setActionStates((current) => ({
        ...current,
        [scenario.id]: "reset",
      }));
    } catch {
      setActionStates((current) => ({
        ...current,
        [scenario.id]: "reset-error",
      }));
    }
  };

  return (
    <div className="standalone-demo-launcher">
      <header className="standalone-demo-launcher__intro">
        <div>
          <p className="standalone-demo-launcher__kicker">
            AI Security Academy
          </p>
          <h1>Standalone demo launcher</h1>
          <p>
            Choose a short customer story, verify its source, and open the live
            surface without carrying the full guided journey into the room.
          </p>
        </div>
        <nav aria-label="Learning navigation">
          <Link to="/academy/journey">Return to guided journey</Link>
          <Link to="/learning">Learning hub</Link>
        </nav>
      </header>

      <TenantReadinessStrip
        loadReadiness={captureReadiness}
        pollIntervalMs={readinessPollIntervalMs}
      />

      <nav
        className="standalone-demo-launcher__filters"
        aria-label="Demo categories"
      >
        {categories.map((category) => (
          <button
            key={category}
            type="button"
            aria-pressed={activeCategory === category}
            onClick={() => setActiveCategory(category)}
          >
            {category}
          </button>
        ))}
      </nav>

      <p className="standalone-demo-launcher__count" role="status">
        Showing {visibleScenarios.length} of {scenarios.length} demos
      </p>

      <div className="standalone-demo-launcher__grid">
        {visibleScenarios.map((entry) => (
          <DemoCard
            key={entry.scenario.id}
            scenario={entry.scenario}
            lesson={entry.lesson}
            availability={scenarioAvailability(
              entry.scenario,
              entry.lesson,
              readinessState,
            )}
            observedResult={runResults[entry.scenario.id]}
            actionState={actionStates[entry.scenario.id]}
            onCheckEvidence={() => handleCheckEvidence(entry)}
            onReset={() => handleReset(entry)}
          />
        ))}
      </div>
    </div>
  );
}
