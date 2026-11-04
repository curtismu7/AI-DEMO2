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
//   tool-abuse — a call to a legitimate tool with hostile arguments: a
//     cross-owner account id, a limits-override flag, or a smuggled directive
//     in a free-text field ("[SYSTEM: ...]").
//   schema-violation — a call whose arguments do not match the tool's declared
//     inputSchema: a string where a number is required, a missing required arg,
//     or an argument the schema does not define.
//
// This is where a defense CAN sit: MCP has nothing to inspect metadata with, so
// the check belongs in front of the consumer. Heuristic and honest about it —
// it reports, it does not block, and it can miss a novel phrasing.

const INSTRUCTION_TAG = /<\/?\s*(important|system|secret|instructions?|admin)\s*>/i;
const SECRECY = /\bdo not (tell|mention|inform|reveal|disclose|notify)\b/i;
const AGENT_IMPERATIVE = /\b(ignore (all )?previous|before (calling|using) (any|another) tool|you must (always|first)|always call)\b/i;
const LEAK_HINT = /\b(full (conversation )?context|credentials?|api[- ]?keys?|secrets?|passwords?|bearer|auth(entication)? tokens?|tokens?)\b/i;
const SENSITIVE_ACTION = /\b(transfer|payment|payout|wire|remit)\b/i;
const APPROVAL_BYPASS = /\b(bypass|skip|without|no)\b[^.\n]{0,40}\b(approval|consent|authorization)\b/i;

// Tool-abuse heuristics on the ARGUMENTS of a legitimate call (right tool,
// wrong intent — the arguments, not the metadata, are the weapon).
const ABUSE_OVERRIDE_ARG = /\b(override|bypass|force|skip)[-_ ]?(limits?|guard|policy|check|validation)s?\b/i;
const ABUSE_DIRECTIVE = /\[\s*(system|admin|operator|internal)\s*[:\]]/i;
const ABUSE_FOREIGN_ID = /^(?!sim-|acct-|acc-|usr-|user-)[a-z0-9_-]*(external|attacker|hostile|fraud|unknown)[a-z0-9_-]*$/i;

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

export function scanResources(resources) {
  return (resources || []).flatMap((resource) => {
    const uriId = String(resource.uri || '').split('/').filter(Boolean).pop();
    const label = `resource:${uriId || resource.name || '(unnamed)'}`;
    const text = [resource.description, ...(resource.contents || []).map((content) => content.text || '')]
      .filter(Boolean).join('\n');
    return scanContent(label, text);
  });
}

export function scanPrompts(prompts) {
  return (prompts || []).flatMap((prompt) => {
    const label = `prompt:${prompt.name || '(unnamed)'}`;
    const text = [
      prompt.description,
      ...(prompt.messages || []).map((message) => message.content?.text || ''),
    ].filter(Boolean).join('\n');
    return scanContent(label, text);
  });
}

// scanAgentCard(card) -> [{ tool, kind, detail }]. Same heuristics, applied to an
// A2A Agent Card: the card `description` a generalist reads to delegate, and each
// skill's `description`. The agent-layer analog of scan() — catches Agent Card
// poisoning (inter-agent abuse) before a generalist trusts a specialist's card.
export function scanAgentCard(card) {
  const findings = [];
  if (!card || typeof card !== 'object') return findings;

  const why = describeInstruction(card.description || '');
  if (why) findings.push({ tool: `card:${card.name || 'agent'}`, kind: 'hidden-instruction', detail: why });

  for (const s of card.skills || []) {
    const label = `skill:${s.id || s.name || '(unnamed)'}`;
    const sWhy = describeInstruction(s.description || '');
    if (sWhy) findings.push({ tool: label, kind: 'hidden-instruction', detail: sWhy });
    if (LEAK_HINT.test(s.description || '')) findings.push({ tool: label, kind: 'exfil-sink', detail: 'skill description instructs including sensitive context (credentials/tokens/full context)' });
  }
  return findings;
}

function describeInstruction(desc) {
  if (INSTRUCTION_TAG.test(desc)) return 'instruction-tag in description (e.g. <IMPORTANT>)';
  if (SECRECY.test(desc)) return 'description tells the agent to hide something from the user';
  if (AGENT_IMPERATIVE.test(desc)) return 'agent-directed imperative smuggled into the description';
  return null;
}

function scanContent(label, text) {
  const findings = [];
  const instruction = describeInstruction(text);
  if (instruction) findings.push({ tool: label, kind: 'hidden-instruction', detail: instruction });
  if (SENSITIVE_ACTION.test(text)) {
    findings.push({ tool: label, kind: 'sensitive-action', detail: 'content directs the agent toward a fund-moving or payment action' });
  }
  if (APPROVAL_BYPASS.test(text)) {
    findings.push({ tool: label, kind: 'sensitive-action', detail: 'content instructs the agent to bypass approval or consent' });
  }
  return findings;
}

function isOffBoxUrl(v) {
  try {
    const h = new URL(v).hostname;
    return !['localhost', '127.0.0.1', '::1'].includes(h);
  } catch { return false; }
}

// validateToolCall(tools, name, args) -> [{ tool, kind, detail }]
// Checks a tools/call REQUEST, not the metadata — the second half of the story.
// Two findings kinds:
//   schema-violation — args that do not match the tool's declared inputSchema
//     (string where a number is required, missing required arg, unknown arg).
//   tool-abuse — schema-valid args with hostile intent: an override/bypass
//     flag, a foreign account id (cross-owner), or a smuggled [SYSTEM: ...]
//     directive in a free-text field.
export function validateToolCall(tools, name, args) {
  const findings = [];
  const tool = (tools || []).find((t) => t.name === name);
  if (!tool) return [{ tool: name, kind: 'schema-violation', detail: 'unknown tool: no schema to validate against' }];

  const schema = tool.inputSchema?.properties || {};
  const required = tool.inputSchema?.required || [];
  for (const req of required) {
    if (args?.[req] === undefined) findings.push({ tool: name, kind: 'schema-violation', detail: `missing required argument "${req}"` });
  }
  for (const [arg, value] of Object.entries(args || {})) {
    const spec = schema[arg];
    if (!spec) { findings.push({ tool: name, kind: 'schema-violation', detail: `argument "${arg}" is not defined in the tool schema` }); continue; }
    if (spec.type === 'number' && typeof value !== 'number') {
      findings.push({ tool: name, kind: 'schema-violation', detail: `argument "${arg}" must be a number, got ${typeof value}` });
    } else if (spec.type === 'string' && typeof value !== 'string') {
      findings.push({ tool: name, kind: 'schema-violation', detail: `argument "${arg}" must be a string, got ${typeof value}` });
    } else if (spec.type === 'boolean' && typeof value !== 'boolean') {
      findings.push({ tool: name, kind: 'schema-violation', detail: `argument "${arg}" must be a boolean, got ${typeof value}` });
    }
  }

  for (const [arg, value] of Object.entries(args || {})) {
    if (typeof value !== 'string' && typeof value !== 'boolean' && typeof value !== 'number') continue;
    const strValue = String(value);
    if (ABUSE_OVERRIDE_ARG.test(arg) && value === true) {
      findings.push({ tool: name, kind: 'tool-abuse', detail: `arg "${arg}": limits-override flag set on a legitimate call` });
    }
    if (ABUSE_DIRECTIVE.test(strValue)) {
      findings.push({ tool: name, kind: 'tool-abuse', detail: `arg "${arg}": smuggled directive in a free-text field (e.g. [SYSTEM: ...])` });
    }
    if (/account|from|to|beneficiary|payee/i.test(arg) && ABUSE_FOREIGN_ID.test(strValue)) {
      findings.push({ tool: name, kind: 'tool-abuse', detail: `arg "${arg}": foreign account id "${strValue}" — possible cross-owner attempt` });
    }
  }
  return findings;
}

// scanAgentAbuse(card) -> [{ tool, kind, detail }]
// The inter-agent abuse check beyond card poisoning: flags a card whose
// description claims authority the peer has no way to verify ("I am the
// orchestrator", "with admin authority") or tells the delegating agent to
// disable its safety checks — the orchestrator-impersonation pattern the
// gateway guardrails classify as inter_agent_abuse.
export function scanAgentAbuse(card) {
  const findings = [];
  if (!card || typeof card !== 'object') return findings;
  const text = [card.description, ...(card.skills || []).map((s) => s.description)]
    .filter(Boolean).join('\n');
  if (/\b(i am|this is|as)\b[^.\n]{0,40}\b(orchestrator|supervisor|administrator|admin)\b/i.test(text)) {
    findings.push({ tool: `card:${card.name || 'agent'}`, kind: 'inter-agent-abuse', detail: 'card claims orchestrator/admin authority over the delegating agent' });
  }
  if (/\b(disable|turn off|deactivate|ignore)\b[^.\n]{0,30}\b(safety|security|guardrail|policy)[a-z -]{0,20}(checks?|rules?|policies?)\b/i.test(text)) {
    findings.push({ tool: `card:${card.name || 'agent'}`, kind: 'inter-agent-abuse', detail: 'card instructs the delegating agent to disable its safety checks' });
  }
  return findings;
}
