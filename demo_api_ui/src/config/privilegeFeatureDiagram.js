// Builds a ReactFlow diagram config { GROUPS, NODES, EDGES, STEPS } for one Privilege feature, straight from its own
// entry in features.json: the feature in the middle, one node and one arrow per component it lists, and one walkthrough
// step per component. The step text is the sentence of "how it works" that best matches the component, so nothing here
// is a new claim. Kept identical in privilege-map (src/diagrams) and AI-DEMO2 (demo_api_ui/src/config).

export const FEATURE_GROUPS = {
  feature: { label: 'The feature', bg: 'var(--th-bg-emphasis)' },
  console: { label: 'Console', bg: 'var(--th-status-info)' },
  gateway: { label: 'Gateway and runtime', bg: 'var(--th-status-warning)' },
  policy: { label: 'Policy and guardrails', bg: 'var(--th-status-success)' },
  other: { label: 'Identity, data and logs', bg: 'var(--th-border-strong)' },
};

const KEYWORDS = [
  ['other', /\b(log|logs|audit|event|events|siem|feed|index)\b/i],
  ['policy', /(policy|policies|cedar|guard|grant|rule|detector|approval|allowlist|limit|cap\b|caps\b|claim|protection)/i],
  ['console', /(console|registry|wizard|page|hub|screen|tab\b|editor|form|view|queue)/i],
  ['gateway', /(gateway|route|proxy|door|endpoint|sensor|desktop|workstation|enclave|backend|server|sidecar)/i],
];

export function groupOf(text) {
  for (const [group, re] of KEYWORDS) if (re.test(text)) return group;
  return 'other';
}

const shorten = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

function wrap(text, width, maxLines) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let line = '';
  for (const w of words) {
    if (line && `${line} ${w}`.length > width) { lines.push(line); line = w; } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = shorten(`${lines[maxLines - 1]} …`, width); }
  return lines;
}

/** Splits "Name (detail)" or "Name: detail" into a short label and up to three lines of detail. */
export function splitComponent(text) {
  const paren = text.match(/^(.*?)\s*\((.*)\)\s*$/);
  const colon = !paren && text.includes(': ') ? [text.slice(0, text.indexOf(': ')), text.slice(text.indexOf(': ') + 2)] : null;
  const [label, rest] = paren ? [paren[1], paren[2]] : colon || [text, ''];
  return { label: shorten(label, 46), sub: rest ? wrap(rest, 34, 3) : [] };
}

const STOP = new Set(['that', 'with', 'this', 'from', 'their', 'which', 'where', 'there', 'when', 'then', 'into', 'than', 'have', 'also', 'each', 'does', 'only', 'such', 'used', 'uses', 'using', 'what', 'will', 'were', 'been', 'both', 'more', 'most']);
const tokens = (s) => new Set((s.toLowerCase().match(/[a-z0-9][a-z0-9-]{3,}/g) || []).filter((t) => !STOP.has(t)));

const sentences = (s) => s.split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter(Boolean);

function bestSentence(howSentences, component) {
  const want = tokens(component);
  let best = null;
  let bestScore = 0;
  for (const s of howSentences) {
    const have = tokens(s);
    let score = 0;
    for (const t of want) if (have.has(t)) score += 1;
    if (score > bestScore) { best = s; bestScore = score; }
  }
  return best;
}

export function buildFeatureDiagram(feature, pageTitle = '') {
  const comps = feature.components;
  const rowH = 100;
  const mid = ((comps.length - 1) * rowH) / 2;
  const NODES = [
    { id: 'feature', group: 'feature', label: shorten(feature.name, 46), sub: pageTitle ? [`Privilege Map · ${pageTitle}`] : ['Privilege Map'], x: 0, y: mid },
    ...comps.map((c, i) => {
      const { label, sub } = splitComponent(c);
      return { id: `c${i}`, group: groupOf(c), label, sub, x: 440, y: i * rowH };
    }),
  ];
  const EDGES = comps.map((c, i) => ['feature', `c${i}`, `uses ${shorten(splitComponent(c).label, 32)}`]);
  const how = sentences(feature.how);
  const whyFirst = sentences(feature.why)[0] || feature.why;
  const STEPS = comps.map((c, i) => {
    const { label } = splitComponent(c);
    return {
      key: `c${i}`,
      edges: [i],
      title: label,
      what: bestSentence(how, c) || `${label} is one of the components this feature uses.`,
      why: whyFirst,
    };
  });
  return { GROUPS: FEATURE_GROUPS, NODES, EDGES, STEPS };
}
