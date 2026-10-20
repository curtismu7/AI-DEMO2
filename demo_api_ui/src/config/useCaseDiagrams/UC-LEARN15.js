/**
 * UC-LEARN15 — Jev decision model, System One vs System Two. One signed-out
 * teaching page runs the same text through keyword rules and through Jev side
 * by side: threshold sliders turn one score into Allow / Step-up / Deny, two
 * bake-offs score the hand-labelled set, and the fourth panel sends the
 * identical question through LangChain's OpenAIDecisions client — same
 * backend, the framework is plumbing, not a second opinion.
 */
import { PARTICIPANT_GROUPS as G } from "./palette";

const NODES = [
  { id: "user", group: "user", label: "Alice (presenter)", sub: ["signed out", "learning track"], x: 40, y: 150, detail: "Opens a teaching page, not an agent turn — the link runs signed out, so nothing here touches her tokens or consents." },
  { id: "page", group: "agent", label: "Jev learning page", sub: ["/jev-learning", "four panels"], x: 340, y: 150, detail: "Runs the same text through keyword rules and Jev side by side; the badge states which mode ran; the threshold sliders are the policy, live." },
  { id: "bff", group: "gateway", label: "Demo BFF", sub: ["scenario lock", "heuristic baseline"], x: 640, y: 150, detail: "Owns the question definitions — the request may only pick a scenario and supply text — runs the keyword baseline itself, rate-limited to 20 req/min." },
  { id: "lc", group: "agent", label: "LangChain agent", sub: ["OpenAIDecisions", "internal-secret gate"], x: 940, y: 150, detail: "Panel four sends the identical question through langchain_openai.decisions.OpenAIDecisions — same backend, framework is plumbing, not a second opinion." },
  { id: "von", group: "external", label: "Jev model (Von)", sub: ["typed answer", "noul / choice"], x: 1240, y: 150, detail: "TypeSafe-compatible decision server: POST /v1/systemone answers a typed noul P(yes) or a choice with confidence — a number, never prose." },
];

const EDGES = [
  ["user", "page", "signed out", { detail: "This is a teaching page, not an agent turn — no session, no token, nothing to authorize." }],
  ["page", "bff", "System One vs Two", { detail: "One press runs both columns: the BFF executes the keyword regex itself, then forwards the same state to Jev." }],
  ["bff", "lc", "panel four", { detail: "The fourth panel re-sends the identical question via the proxy route; the agent's gate accepts only the internal gateway secret." }],
  ["lc", "von", "OpenAI -> Von", { detail: "LangChain speaks the OpenAI Decisions dialect; the client translates it onto Von's wire shape — the same three verbatim questions." }],
  ["von", "user", "the threshold lesson", { detail: "P(yes) returns typed — then the slider decides; the model is one input, policy keeps a deterministic floor no score can lower." }],
];

const walk = [
  {
    title: "A link, not a chip", label: "signed out",
    nodes: ["user", "page"], edges: [0],
    lines: [{ who: "Presenter", text: "This is a teaching page, not an agent turn — no session, no token, nothing to authorize. The only honesty control is the badge." }],
    tech: [
      { t: "API", c: "GET /jev-learning — public teaching page, renders signed out" },
      { t: "POLICY", c: "badge must state the mode: Live / Recorded / Simulated — not configured" },
    ],
  },
  {
    title: "One press, two deciders", label: "System One vs Two",
    nodes: ["page", "bff"], edges: [1],
    lines: [{ who: "Demo BFF", text: "One press runs both columns: the BFF executes the keyword regex itself so bake-off numbers come from one implementation, then forwards the same state to Jev (jevService -> POST openrouter.ai/api/alpha/decisions, or the keyless Von container)." }],
    tech: [
      { t: "API", c: "POST /api/demo/jev/evaluate {scenario:'risk', state:'Send $9,500 to a new payee overseas, it is urgent'}" },
      { t: "POLICY", c: "scenario lock: question text lives in jevService.js, state capped at 2,000 chars, 20 req/min" },
    ],
  },
  {
    title: "Same question, through LangChain", label: "panel four",
    nodes: ["bff", "lc"], edges: [2],
    lines: [{ who: "Demo BFF", text: "The fourth panel re-sends the identical question via the proxy route; the agent's :8888 gate accepts only the internal gateway secret header." }],
    tech: [
      { t: "API", c: "POST /api/demo/jev/langchain -> agent POST :8888/jev/evaluate, header x-internal-gateway-secret" },
      { t: "A2A", c: "BFF-to-agent proxy; SCENARIO_KEYS whitelist blocks it as a generic POST-through" },
    ],
  },
  {
    title: "Dialect translation", label: "OpenAI -> Von",
    nodes: ["lc", "von"], edges: [3],
    lines: [{ who: "OpenAIDecisions", text: "LangChain speaks the OpenAI Decisions dialect; the client translates it onto Von's wire shape — the same three verbatim questions as the Node service." }],
    tech: [
      { t: "API", c: "POST /v1/systemone — predicate/choice translated to noul/choice, list answers re-keyed to a dict" },
      { t: "TOKEN", c: "dummy key local-von-no-key keeps ambient OPENAI_API_KEY out of the Von Authorization header" },
    ],
  },
  {
    title: "Score in, policy out", label: "the threshold lesson",
    nodes: ["von", "user"], edges: [4],
    lines: [{ who: "Presenter", text: "P(yes) returns typed — then the slider decides: below 0.4 allow, 0.4–0.9 step-up, at 0.9 deny. The model is one input; policy keeps a deterministic floor no score can lower." }],
    tech: [
      { t: "TOKEN", c: "answer: {type:'noul', noul:0.93} — a number, not prose" },
      { t: "POLICY", c: "decide(): P >= denyAt -> deny, >= stepUpAt -> step-up, else allow" },
    ],
  },
];

// Per-step detail. Forms mirror routes/jev.js (POST /api/demo/jev/evaluate and /langchain) and the keyless Von wire shape.
const steps = [
  {
    beats: [0],
    detail: {
      form: "GET /jev-learning\n\n(public teaching page: no session, no Authorization header)",
    },
  },
  {
    beats: [1],
    detail: {
      form: "POST /api/demo/jev/evaluate\nContent-Type: application/json\n\n{ \"scenario\": \"risk\", \"state\": \"Send $9,500 to a new payee overseas, it is urgent\" }\n\n-> { \"scenario\": \"risk\", \"jev\": { mode, model, latencyMs, answer }, \"heuristic\": { latencyMs, answer } }",
    },
  },
  {
    beats: [2],
    detail: {
      form: "POST /api/demo/jev/langchain\nContent-Type: application/json\n\n{ \"scenario\": \"risk\", \"state\": \"Send $9,500 to a new payee overseas, it is urgent\" }\n\nBFF -> agent:\nPOST {LANGCHAIN_AGENT_HTTP_URL}/jev/evaluate\nx-internal-gateway-secret: <internal gateway secret>\n\n{ \"scenario\": \"risk\", \"state\": \"...\" }",
    },
  },
  {
    beats: [3],
    detail: {
      form: "POST {VON_URL}/v1/systemone\nAuthorization: Bearer local-von-no-key\nContent-Type: application/json\n\n(OpenAIDecisions predicate/choice is translated to Von's noul/choice shape;\nthe same three verbatim questions as the Node service)",
    },
  },
  {
    beats: [4],
    detail: {
      form: "{ \"answer\": { \"type\": \"noul\", \"noul\": 0.93 } }\n\ndecide(P):\n  P >= denyAt   -> deny\n  P >= stepUpAt -> step-up\n  else          -> allow",
    },
  },
];

export default {
  id: "UC-LEARN15",
  result: { label: "INFO", tone: "info" },
  pingStyle: true,
  GROUPS: G,
  NODES,
  EDGES,
  walk,
  steps,
};
