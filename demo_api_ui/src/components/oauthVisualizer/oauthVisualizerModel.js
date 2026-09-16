export const OAUTH_VISUALIZER_STORAGE_KEY = "ba_oauth_visualizer_config";

export const OAUTH_VISUALIZER_FLOWS = [
  { id: "authorization-code", section: "Grant Types", name: "Authorization Code", description: "A user authorizes a client, which exchanges a code for tokens.", rfcRef: "RFC 6749 §4.1", arrows: [1, 2, 3, 4], steps: ["Build authorization request", "Receive authorization code", "Exchange code for tokens"] },
  { id: "authorization-code-pkce", section: "Grant Types", name: "Authorization Code + PKCE", description: "Authorization Code protected by a proof key for public clients.", rfcRef: "RFC 7636", arrows: [1, 2, 3, 4], steps: ["Create verifier and challenge", "Receive authorization code", "Exchange code with verifier"] },
  { id: "authorization-code-par", section: "Grant Types", name: "Authorization Code + PAR", description: "Push authorization parameters before redirecting the user.", rfcRef: "RFC 9126", arrows: [1, 2, 3, 4, 5], steps: ["Push authorization request", "Redirect user", "Exchange returned code"] },
  { id: "implicit", section: "Grant Types", name: "Implicit", description: "Legacy browser flow returning a token from the authorization endpoint.", rfcRef: "RFC 6749 §4.2", arrows: [1, 2, 3], steps: ["Build authorization request", "Receive token redirect"] },
  { id: "client-credentials", section: "Grant Types", name: "Client Credentials", description: "Machine-to-machine access with no user involved.", rfcRef: "RFC 6749 §4.4", arrows: [1, 2, 3, 4], steps: ["Authenticate client", "Receive access token", "Call protected resource"] },
  { id: "device", section: "Grant Types", name: "Device Authorization", description: "A constrained device obtains a user code and polls for tokens.", rfcRef: "RFC 8628", arrows: [1, 2, 3, 4], steps: ["Request device code", "User authorizes device", "Poll token endpoint"] },
  { id: "device-pkce", section: "Grant Types", name: "Device Authorization + PKCE", description: "Device authorization with a proof key.", rfcRef: "RFC 8628", arrows: [1, 2, 3, 4], steps: ["Create verifier", "Request device code", "Poll token endpoint"] },
  { id: "refresh-token", section: "Grant Types", name: "Refresh Token", description: "Exchange a refresh token for a new access token.", rfcRef: "RFC 6749 §6", arrows: [1, 2], steps: ["Present refresh token", "Receive refreshed access token"] },
  { id: "jwt-bearer", section: "Grant Types", name: "JWT Bearer", description: "Exchange a signed JWT assertion for an access token.", rfcRef: "RFC 7523", arrows: [1, 2], steps: ["Create JWT assertion", "Exchange assertion"] },
  { id: "saml-bearer", section: "Grant Types", name: "SAML 2.0 Bearer", description: "Exchange a SAML assertion for an access token.", rfcRef: "RFC 7522", arrows: [1, 2], steps: ["Present SAML assertion", "Receive access token"] },
  { id: "resource-owner-password", section: "Grant Types", name: "Resource Owner Password", description: "Legacy direct credential exchange for a user token.", rfcRef: "RFC 6749 §4.3", arrows: [1, 2], steps: ["Present user credentials", "Receive access token"] },
  { id: "token-exchange-impersonation", section: "Token Exchange", name: "Token Exchange — Impersonation", description: "Exchange a subject token for a token representing the subject.", rfcRef: "RFC 8693", arrows: [1, 2, 3], steps: ["Present subject token", "Authorize exchange", "Receive exchanged token"] },
  { id: "token-exchange-delegation", section: "Token Exchange", name: "Token Exchange — Delegation", description: "Exchange a subject token while preserving the acting party.", rfcRef: "RFC 8693", arrows: [1, 2, 3, 4], steps: ["Present subject and actor", "Authorize delegation", "Receive delegated token"] },
].map((flow) => ({
  ...flow,
  diagram: `sequenceDiagram\n    participant User as User / Agent\n    participant App as Client App\n    participant AS as Authorization Server\n    participant RS as Resource Server\n    User->>App: ${flow.steps[0]}\n    App->>AS: ${flow.steps[0]}\n    AS-->>App: ${flow.steps[1]}\n    App->>RS: Protected request\n    RS-->>App: Protected response`,
}));

export function createInitialRun(flow) {
  return { flowId: flow.id, status: "idle", activeStepId: null, selectedStepId: flow.steps[0] || null, completed: [], error: null, details: {} };
}

export function getStepId(flow, index) {
  return flow.steps[index] || null;
}

export function getStepStatus(run, stepId) {
  if (run.error?.stepId === stepId) return "error";
  if (run.activeStepId === stepId) return "running";
  if (run.completed.includes(stepId)) return "done";
  return "pending";
}

export function getDiagramArrowIndexes(flow, stepIndex) {
  const count = Math.max(flow.steps.length, 1);
  const start = Math.floor((stepIndex * flow.arrows.length) / count);
  const end = Math.max(start + 1, Math.floor(((stepIndex + 1) * flow.arrows.length) / count));
  return flow.arrows.slice(start, end);
}

export function startRun(run) {
  return { ...run, status: "running", activeStepId: getStepId(OAUTH_VISUALIZER_FLOWS.find((flow) => flow.id === run.flowId) || { steps: [] }, 0), error: null, completed: [], details: {} };
}

export function completeStep(run, stepId, details = {}) {
  const completed = run.completed.includes(stepId) ? run.completed : [...run.completed, stepId];
  return { ...run, status: completed.length >= (run.stepCount || completed.length) ? "complete" : "running", activeStepId: null, selectedStepId: stepId, completed, details: { ...run.details, [stepId]: details } };
}

export function failStep(run, stepId, error) {
  return { ...run, status: "error", activeStepId: null, selectedStepId: stepId, error: { stepId, message: error?.message || String(error) } };
}
