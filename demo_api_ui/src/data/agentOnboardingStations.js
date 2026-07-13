// agentOnboardingStations.js — short display labels for the box keys used in
// agentOnboardingFlows.js, for views that need one label per component rather
// than the full box content (the subway-map walkthrough). The box+arrow
// diagram (AgentOnboardingFlowDiagram.jsx / ROWS) does not use this file.
export const STATION_LABELS = {
  "entry-user": "Enterprise User",
  "entry-dev": "Developer",
  "entry-admin": "Admin",
  "agent-studio": "Agent Studio",
  orchestration: "Orchestration",
  "privileges-gw": "Privileges Gateway",
  pinggateway: "PingGateway",
  pingauthorize: "PingAuthorize",
  "privilege-discovery": "Browser/Device Discovery",
  "cloud-discovery-iga": "Cloud Discovery",
  "iga-ai": "IGA for AI",
  runtime: "Enterprise Runtime",
};

// Collapses a flow's steps into subway "stations" — one slot per run of
// consecutive steps sharing the same primary key (step.activeCardKeys[0]).
// Non-consecutive repeats (e.g. IGA visited twice, later, in Story B) get
// their own later slot, so the line always advances forward.
export function collapseStations(steps) {
  const slots = [];
  const slotForStep = [];
  steps.forEach((step) => {
    const key = step.activeCardKeys[0];
    if (slots.length === 0 || slots[slots.length - 1] !== key) slots.push(key);
    slotForStep.push(slots.length - 1);
  });
  return { slots, slotForStep };
}
