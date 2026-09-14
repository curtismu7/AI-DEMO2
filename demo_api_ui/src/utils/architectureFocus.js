// Derives a legible per-subsystem slice of docs/diagrams/architecture.mmd for
// the System Architecture page's "Focus" selector — client-side, from the
// SAME source the full diagram renders from, so there is no second copy of
// the topology to drift stale (unlike the four now-hidden alternate views
// under docs/diagrams/HIDDEN_DIAGRAMS.md, all retired for exactly that).

export const FOCUS_GROUPS = {
  frontend: {
    label: "Frontend & Auth",
    subgraphs: ["UI"],
    nodes: ["AdminBrowser", "CustomerBrowser"],
  },
  bff: {
    label: "BFF & Gateways",
    subgraphs: ["API", "Gateway"],
    nodes: ["PingGW", "Vault", "AGUIRoutes", "AgentTokenSvc", "AuthzMock"],
  },
  mcp: {
    label: "MCP Servers & Agents",
    subgraphs: ["MCP", "Agent", "ResourceServer"],
    nodes: [
      "AgentService",
      "A2AOrch",
      "Specialist",
      "MCPInvestSvc",
      "MortgageSvc",
      "HITLSvc",
      "LLM",
      "WeatherMcp",
      "MastraAgent",
    ],
  },
  pingone: {
    label: "PingOne Cloud",
    subgraphs: ["PingOneCloud", "PingOneAuthorize"],
    nodes: [],
  },
};

// A node/edge label can carry a real embedded newline (e.g. the
// IntrospectionHealth->OIDC_AS edge). Collapse any line left with an
// unterminated quoted string into the next one so every statement ends up
// on a single physical line before the rest of the parsing below, which
// scans line-by-line.
function joinMultilineLabels(source) {
  const rawLines = source.split("\n");
  const joined = [];
  let buffer = null;
  for (const line of rawLines) {
    if (buffer !== null) {
      buffer += ` ${line.trim()}`;
    } else {
      buffer = line;
    }
    const quoteCount = (buffer.match(/"/g) || []).length;
    if (quoteCount % 2 === 0) {
      joined.push(buffer);
      buffer = null;
    }
  }
  if (buffer !== null) joined.push(buffer);
  return joined.join("\n");
}

// Finds a top-level `subgraph ID[...] ... end` block (nested subgraphs and
// all) and returns its lines verbatim, or null if ID isn't declared.
function extractSubgraphBlock(lines, subgraphId) {
  const startRe = new RegExp(`^\\s*subgraph\\s+${subgraphId}\\b`);
  const start = lines.findIndex((l) => startRe.test(l));
  if (start === -1) return null;

  let depth = 0;
  for (let i = start; i < lines.length; i++) {
    if (/^\s*subgraph\b/.test(lines[i])) depth++;
    if (/^\s*end\s*$/.test(lines[i])) {
      depth--;
      if (depth === 0) return lines.slice(start, i + 1);
    }
  }
  return null; // unbalanced — treat as not found rather than guess
}

// ponytail: assumes a loose (non-subgraph) node's whole declaration is one
// physical line — true for every node in FOCUS_GROUPS today (all use <br/>,
// not a real newline). If a future loose node switches to a real multi-line
// label, extend joinMultilineLabels' reach here too.
function extractNodeLine(lines, nodeId) {
  const re = new RegExp(`^\\s*${nodeId}[\\[\\(]`);
  return lines.find((l) => re.test(l)) || null;
}

// Node ids this block itself declares (skips the `subgraph ID[...]` header
// and `direction …` lines — neither is followed by a bracket/paren).
function collectDeclaredIds(lines) {
  const ids = [];
  const re = /^\s*([A-Za-z0-9_]+)[\[\(]/;
  for (const line of lines) {
    const m = line.match(re);
    if (m) ids.push(m[1]);
  }
  return ids;
}

const EDGE_RE =
  /^\s*([A-Za-z0-9_]+)\s*(?:-->|-\.->)\s*(?:\|.*?\|)?\s*([A-Za-z0-9_]+)\s*$/;
const CLASS_RE = /^\s*class\s+([A-Za-z0-9_,]+)\s+(\S+)\s*$/;

/**
 * Slices docs/diagrams/architecture.mmd down to one subsystem for the
 * System Architecture page's Focus selector.
 *
 * @param {string} source - full architecture.mmd text
 * @param {keyof FOCUS_GROUPS} focusKey
 * @returns {string} a standalone Mermaid flowchart source
 */
export function buildFocusDiagram(source, focusKey) {
  const group = FOCUS_GROUPS[focusKey];
  if (!group) {
    throw new Error(`Unknown architecture focus: "${focusKey}"`);
  }

  const lines = joinMultilineLabels(source).split("\n");

  const blockLines = [];
  for (const subgraphId of group.subgraphs) {
    const block = extractSubgraphBlock(lines, subgraphId);
    if (block) blockLines.push(...block);
  }

  const looseLines = [];
  for (const nodeId of group.nodes) {
    const line = extractNodeLine(lines, nodeId);
    if (line) looseLines.push(line);
  }

  const knownIds = new Set([
    ...group.subgraphs,
    ...group.nodes,
    ...collectDeclaredIds(blockLines),
  ]);

  const edgeLines = lines.filter((line) => {
    const m = line.match(EDGE_RE);
    return m ? knownIds.has(m[1]) || knownIds.has(m[2]) : false;
  });

  const classDefLines = lines.filter((l) => /^\s*classDef\b/.test(l));

  const classLines = [];
  for (const line of lines) {
    const m = line.match(CLASS_RE);
    if (!m) continue;
    const ids = m[1].split(",").filter((id) => knownIds.has(id));
    if (ids.length > 0) classLines.push(`class ${ids.join(",")} ${m[2]}`);
  }

  return [
    "flowchart TB",
    `%% Focus: ${group.label}`,
    ...blockLines,
    ...looseLines,
    ...edgeLines,
    ...classDefLines,
    ...classLines,
  ].join("\n");
}
