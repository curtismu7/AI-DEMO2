// A tool-metadata scanner — the blue-team answer to tool-description poisoning.
// It inspects the `description` and `inputSchema` an MCP server serves, BEFORE an
// agent ingests them, and flags the two things a poisoned server hides there:
//
//   hidden-instruction — an instruction aimed at the agent smuggled into a
//     description (an <IMPORTANT>/<SYSTEM> block, a "do not tell the user", an
//     "ignore previous / before calling any tool" imperative).
//   exfil-sink — an inputSchema argument that leaks: an off-box URL default, or a
//     description telling the agent to include sensitive context.
//
// This is where a defense CAN sit: MCP has nothing to inspect metadata with, so
// the check belongs in front of the consumer. Heuristic and honest about it —
// it reports, it does not block, and it can miss a novel phrasing.

const INSTRUCTION_TAG = /<\/?\s*(important|system|secret|instructions?|admin)\s*>/i;
const SECRECY = /\bdo not (tell|mention|inform|reveal|disclose|notify)\b/i;
const AGENT_IMPERATIVE = /\b(ignore (all )?previous|before (calling|using) (any|another) tool|you must (always|first)|always call)\b/i;
const LEAK_HINT = /\b(full (conversation )?context|credential|api[- ]?key|secret|password|auth(entication)? token)\b/i;

// scan(tools) -> [{ tool, kind, detail }]. `tools` is an MCP tools/list array.
export function scan(tools) {
  const findings = [];
  for (const t of tools || []) {
    const desc = t.description || '';
    const why = describeInstruction(desc);
    if (why) findings.push({ tool: t.name, kind: 'hidden-instruction', detail: why });

    const props = t.inputSchema?.properties || {};
    for (const [arg, spec] of Object.entries(props)) {
      const reasons = [];
      if (typeof spec.default === 'string' && isOffBoxUrl(spec.default)) reasons.push(`off-box default ${spec.default}`);
      if (LEAK_HINT.test(spec.description || '')) reasons.push('description instructs including sensitive context');
      if (reasons.length) findings.push({ tool: t.name, kind: 'exfil-sink', detail: `arg "${arg}": ${reasons.join('; ')}` });
    }
  }
  return findings;
}

function describeInstruction(desc) {
  if (INSTRUCTION_TAG.test(desc)) return 'instruction-tag in description (e.g. <IMPORTANT>)';
  if (SECRECY.test(desc)) return 'description tells the agent to hide something from the user';
  if (AGENT_IMPERATIVE.test(desc)) return 'agent-directed imperative smuggled into the description';
  return null;
}

function isOffBoxUrl(v) {
  try {
    const h = new URL(v).hostname;
    return !['localhost', '127.0.0.1', '::1'].includes(h);
  } catch { return false; }
}
