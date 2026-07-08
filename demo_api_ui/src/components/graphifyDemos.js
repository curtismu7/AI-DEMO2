// demo_api_ui/src/components/graphifyDemos.js
/**
 * Canned Graphify demos for the showcase page.
 * Captured from a live graphify-out/ snapshot — no CLI required in the browser.
 */

export const GRAPHIFY_STATS = {
  nodes: '42,521',
  edges: '57,954',
  communities: '2,703',
  extractedPct: '96%',
  inferredPct: '4%',
};

export const GRAPHIFY_DEMOS = [
  {
    id: 'query',
    verb: 'query',
    title: 'Orient — broad subgraph',
    teaching:
      'BFS from a few seed terms returns a scoped neighborhood. Agents read these files next — not the whole repo.',
    command: 'graphify query "RFC 8693 token exchange"',
    output: `Traversal: BFS depth=2 · 34 nodes (budget-capped)

NODE RFC 8693 Token Exchange Terminology Glossary
  src=docs/TOKEN_TERMINOLOGY_GLOSSARY.md
NODE RFC 8693 Token Exchange (\`RFC8693Panel\`)
  src=docs/education-panels.md
NODE Token Exchange & Delegation
  src=docs/education-panels.md
NODE Actor Token (RFC 8693 §2.2)
NODE Subject Token (RFC 8693 §2.1)
NODE Token Attribute Mappings (may_act / act)
  src=docs/user-guide/PINGONE_CONFIG.md
NODE How the AI acts on your behalf (\`MayActPanel\`)

EDGE Token Exchange & Delegation --contains--> RFC 8693 Token Exchange
EDGE TOKEN_TERMINOLOGY_GLOSSARY --contains--> Actor Token / Subject Token / JWT Claims`,
  },
  {
    id: 'path',
    verb: 'path',
    title: 'Path — how A reaches B',
    teaching:
      'Shortest path surfaces the real dependency chain. Grep cannot follow import → host → panel hops.',
    command: 'graphify path "RFC8693Panel" "TokenExchangePanel"',
    output: `Shortest path (4 hops):

  RFC8693Panel()
    ←contains— RFC8693Panel.js
      —imports_from→ EducationDrawer.js
        ←imports_from— TokenExchangePanel.js
          —contains→ TokenExchangePanel()

Both education panels share EducationDrawer — the graph found that without opening either file first.`,
  },
  {
    id: 'explain',
    verb: 'explain',
    title: 'Explain — one concept',
    teaching:
      'explain returns the node plus its immediate neighbors — enough context to decide what to open next.',
    command: 'graphify explain "HITL"',
    output: `Node: HITL
  Source:    docs/archive/CONTEXT.md L115
  Type:      document
  Community: 505
  Degree:    1

Connections:
  ← Acronyms [contains]

Related neighborhood (query "HITL human in the loop"):
  HITL · CIBA · MCP · Controls · Attacks · Foundations
  (glossary + use-case catalog communities)`,
  },
];
