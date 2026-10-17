// Request path shared by all eight Jev gallery demos. Mirrors
// JevDemoGalleryPage (evaluate/batch fetch, pageMode, ESCALATE band) and
// demo_api_server/routes/jev.js + services/jevService.js.
const N = (id, group, label, sub, x, y) => ({ id, group, label, sub, x, y });
const E = (src, tgt, label, opts) => (opts ? [src, tgt, label, opts] : [src, tgt, label]);

export const JEV_GALLERY_GROUPS = {
  page: { label: 'Gallery page', bg: 'var(--th-status-info)' },
  bff: { label: 'Demo API (public, rate-limited)', bg: 'var(--th-bg-emphasis)' },
  model: { label: 'Decider', bg: 'var(--th-status-warning)' },
  human: { label: 'Person', bg: 'var(--th-text-faint)' },
};

export const JEV_GALLERY_NODES = [
  N('page', 'page', 'Demo page', ['POST /api/demo/jev/evaluate', 'or /batch (max 20 states)', 'mode: heuristics if toggled'], 0, 200),
  N('route', 'bff', 'jev route', ['limiter 20 req/min', 'scenario lock: injection,', 'intent, risk'], 340, 200),
  N('heuristic', 'model', 'Keyword heuristic', ['baseline, always computed', 'and returned beside Jev'], 680, 0),
  N('service', 'bff', 'jevService.evaluate', ['live only if OpenRouter key', 'or JEV_ENDPOINT is set'], 680, 200),
  N('jev', 'model', 'Jev / Von model', ['typesafe/jev-1.13 or local', 'JEV_ENDPOINT', 'returns answer + latency'], 1020, 200),
  N('band', 'page', 'Escalation band', ['p > 0.65 act', '0.35 to 0.65 escalate', 'p < 0.35 pass'], 340, 420),
  N('person', 'human', 'A person', ['escalated rows are', 'listed for human review'], 680, 420),
];

export const JEV_GALLERY_EDGES = [
  E('page', 'route', 'scenario + state(s)'), // 0
  E('route', 'heuristic', 'baseline answer(s) computed first'), // 1
  E('route', 'service', 'evaluate per state (batch fans out in parallel)'), // 2
  E('service', 'jev', 'live call when configured and not heuristics-only'), // 3
  E('service', 'route', 'simulated keyword answer when not configured or heuristics chosen'), // 4
  E('route', 'page', '{ jev, heuristic } side by side (400 / 502 shown inline)'), // 5
  E('page', 'band', 'noul batches (PR review, links, ...) apply the band'), // 6
  E('band', 'person', 'escalate rows go to a person'), // 7
];

export const JEV_GALLERY_STEPS = [
  { key: 'ask', edges: [0], title: 'The demo sends its state', what: 'Each demo posts a locked scenario and the text to judge to the public Jev route; the Heuristics | llama.cpp page toggle adds mode: heuristics.', why: 'One route serves all eight demos, so the lesson is the decider, not the plumbing.' },
  { key: 'decide', edges: [1, 2, 3, 4], title: 'Baseline and Jev answer the same state', what: 'The route computes the keyword heuristic first, then jevService asks Jev live, or returns the simulated heuristic answer when unconfigured or heuristics were chosen.', why: 'Simulated mode is the keyword baseline and says nothing about Jev, which the page labels with a mode badge.' },
  { key: 'compare', edges: [5], title: 'Both answers come back', what: 'The response carries Jev and the heuristic with their latencies; an upstream failure surfaces inline as a 502 message.', why: 'The side-by-side is the demo: same input, two deciders.' },
  { key: 'escalate', edges: [6, 7], title: 'Uncertain answers go to a person', what: 'Batch demos compare each probability to the escalation band and list the in-between rows as escalated to a person.', why: 'A calibrated probability lets the agent act on the clear cases and hand over only the uncertain ones.' },
];
