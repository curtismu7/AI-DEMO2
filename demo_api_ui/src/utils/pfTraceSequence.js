// Turns a captured PingFederate protocol trace (the ProtocolTrace step shape:
// { id, title, request: { method, url }, response: { status } }) into Mermaid
// sequenceDiagram text, so each PF flow on PingFederateAiAgentPage shows its
// SHAPE (who calls whom, in what order) above the raw traffic. FlowDiagram
// picks SequenceFlowDiagram for sequenceDiagram text, which attaches the
// shared movie reel — the same walkable treatment the P1 flow pages use.
//
// The message label is the step's URL path (the request's most identifying
// part); the participant name is the first path segment after the prefix.
// `participants` may override names for the ids a flow uses; anything
// unrecognized still renders, as a generic participant — a new BFF step must
// not blank the diagram.

const URL_PREFIX = "/api/pf-ai-agent/";

// Which party owns each endpoint for the four PF flows this demo runs. Step
// ids are the BFF's own (see routes/pfAiAgent.js); an id missing here falls
// back to naming the participant from the URL.
const STEP_ACTORS = {
  // CIMD: browser → PF redirects happen outside the BFF; the BFF only serves
  // metadata and finishes the exchange.
  metadata: ["App (BFF)", "PingFederate"],
  authorize: ["Browser", "PingFederate"],
  callback: ["PingFederate", "Browser"],
  token: ["App (BFF)", "PingFederate"],
  // Cross-domain exchange: BFF talks to PF, then to the third-party AS.
  "pf-exchange": ["App (BFF)", "PingFederate"],
  verify: ["App (BFF)", "App (BFF)"],
  redeem: ["App (BFF)", "Third-party AS"],
  // RAR/PAR: push the details, then the browser round-trip, then redeem.
  par: ["App (BFF)", "PingFederate"],
  // CIBA: initiate + poll, with the user's device answering out of band.
  start: ["App (BFF)", "Authorization Server"],
  poll: ["App (BFF)", "Authorization Server"],
  decision: ["User device", "Authorization Server"],
};

function actorPair(step) {
  if (STEP_ACTORS[step.id]) return STEP_ACTORS[step.id];
  return ["App (BFF)", "PingFederate"];
}

function pathOf(url) {
  const raw = String(url || "");
  const i = raw.indexOf(URL_PREFIX);
  return i === -1 ? raw : raw.slice(i + URL_PREFIX.length).split("?")[0];
}

function shortLabel(step) {
  const path = pathOf(step.request?.url);
  if (!path) return step.title || step.id || "step";
  return path;
}

/**
 * @param {Array<{id?: string, title?: string, request?: {url?: string}, response?: {status?: number}}>} steps
 * @param {{ selfCall?: boolean }} opts - selfCall keeps a step whose actor pair
 *   is the same participant (the BFF's own verify step) as a message; by default
 *   a same-actor pair renders as a Note instead, which reads better.
 * @returns {string} Mermaid sequenceDiagram source, or "" for nothing to draw.
 */
export function buildSequenceFromTrace(steps, opts = {}) {
  const list = (Array.isArray(steps) ? steps : []).filter(
    (s) => s && (s.request?.url || s.title || s.id),
  );
  if (!list.length) return "";

  const names = [];
  const ensure = (name) => {
    if (!names.includes(name)) names.push(name);
  };
  const messages = [];
  const notes = [];

  for (const step of list) {
    const [from, to] = actorPair(step);
    ensure(from);
    ensure(to);
    const label = shortLabel(step);
    const status = step.response?.status ? ` (HTTP ${step.response.status})` : "";
    if (from === to && !opts.selfCall) {
      notes.push(`Note over ${from}: ${label}${status}`);
    } else {
      messages.push(`${from}->>${to}: ${label}${status}`);
    }
  }

  const lines = ["sequenceDiagram", ...messages.map((m, i) => (i === 0 ? m : m))];
  // Mermaid wants notes in flow order; interleave by emitting messages first
  // then notes keeps the lifelines readable for these short flows.
  lines.push(...notes);
  return lines.join("\n");
}

/**
 * Convenience: build the source and pass it to FlowDiagram as props.
 * Returns null when the trace has nothing renderable, so callers can skip
 * the diagram entirely instead of mounting an empty one.
 */
export function sequenceSource(steps, opts) {
  const source = buildSequenceFromTrace(steps, opts);
  return source || null;
}
