// toolSafetyScanner.js
//
// Browser port of the mcp-scanner heuristics (standalone/mcp-scanner/scanner.mjs),
// covering all four Tool & Agent Safety categories:
//   tool poisoning   — hidden instructions / exfil sinks in served metadata
//   schema violation — a tools/call request that does not match the tool schema
//   tool abuse       — schema-valid arguments with hostile intent
//   inter-agent abuse — orchestrator-impersonation / safety-check-disablement
// It reports; it does not enforce. Enforcement is the gateway's job (the other
// Attack Lab runners show the gateway's verdicts on live calls).

const INSTRUCTION_TAG = /<\/?\s*(important|system|secret|instructions?|admin)\s*>/i;
const SECRECY = /\bdo not (tell|mention|inform|reveal|disclose|notify)\b/i;
const AGENT_IMPERATIVE = /\b(ignore (all )?previous|before (calling|using) (any|another) tool|you must (always|first)|always call)\b/i;
const LEAK_HINT = /\b(full (conversation )?context|credentials?|api[- ]?keys?|secrets?|passwords?|bearer|auth(entication)? tokens?|tokens?)\b/i;
const SENSITIVE_ACTION = /\b(transfer|payment|payout|wire|remit)\b/i;
const APPROVAL_BYPASS = /\b(bypass|skip|without|no)\b[^.\n]{0,40}\b(approval|consent|authorization)\b/i;
const ABUSE_OVERRIDE_ARG = /\b(override|bypass|force|skip)[-_ ]?(limits?|guard|policy|check|validation)s?\b/i;
const ABUSE_DIRECTIVE = /\[\s*(system|admin|operator|internal)\s*[:\]]/i;
const ABUSE_FOREIGN_ID = /^(?!sim-|acct-|acc-|usr-|user-)[a-z0-9_-]*(external|attacker|hostile|fraud|unknown)[a-z0-9_-]*$/i;

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

// scanTools(tools) — tool poisoning on served metadata.
export function scanTools(tools) {
  const findings = [];
  for (const t of tools || []) {
    const desc = t.description || '';
    const why = describeInstruction(desc);
    if (why) findings.push({ target: t.name, kind: 'tool-poisoning', detail: why });

    const props = t.inputSchema?.properties || {};
    for (const [arg, spec] of Object.entries(props)) {
      const reasons = [];
      if (typeof spec.default === 'string' && isOffBoxUrl(spec.default)) reasons.push(`off-box default ${spec.default}`);
      if (LEAK_HINT.test(spec.description || '')) reasons.push('description instructs including sensitive context');
      if (reasons.length) findings.push({ target: t.name, kind: 'tool-poisoning', detail: `arg "${arg}": ${reasons.join('; ')}` });
    }
  }
  return findings;
}

// scanContent(label, text) — poisoning in resource/prompt content.
export function scanContent(label, text) {
  const findings = [];
  const instruction = describeInstruction(text);
  if (instruction) findings.push({ target: label, kind: 'tool-poisoning', detail: instruction });
  if (SENSITIVE_ACTION.test(text)) {
    findings.push({ target: label, kind: 'tool-poisoning', detail: 'content directs the agent toward a fund-moving or payment action' });
  }
  if (APPROVAL_BYPASS.test(text)) {
    findings.push({ target: label, kind: 'tool-poisoning', detail: 'content instructs the agent to bypass approval or consent' });
  }
  return findings;
}

// validateToolCall(tool, args) — schema violation + tool abuse on a call.
export function validateToolCall(tool, args) {
  const findings = [];
  if (!tool) return [{ target: '(unknown)', kind: 'schema-violation', detail: 'unknown tool: no schema to validate against' }];
  const schema = tool.inputSchema?.properties || {};
  const required = tool.inputSchema?.required || [];
  for (const req of required) {
    if (args?.[req] === undefined) findings.push({ target: tool.name, kind: 'schema-violation', detail: `missing required argument "${req}"` });
  }
  for (const [arg, value] of Object.entries(args || {})) {
    const spec = schema[arg];
    if (!spec) { findings.push({ target: tool.name, kind: 'schema-violation', detail: `argument "${arg}" is not defined in the tool schema` }); continue; }
    if (spec.type === 'number' && typeof value !== 'number') {
      findings.push({ target: tool.name, kind: 'schema-violation', detail: `argument "${arg}" must be a number, got ${typeof value}` });
    } else if (spec.type === 'string' && typeof value !== 'string') {
      findings.push({ target: tool.name, kind: 'schema-violation', detail: `argument "${arg}" must be a string, got ${typeof value}` });
    } else if (spec.type === 'boolean' && typeof value !== 'boolean') {
      findings.push({ target: tool.name, kind: 'schema-violation', detail: `argument "${arg}" must be a boolean, got ${typeof value}` });
    }
  }
  for (const [arg, value] of Object.entries(args || {})) {
    if (typeof value !== 'string' && typeof value !== 'boolean' && typeof value !== 'number') continue;
    const strValue = String(value);
    if (ABUSE_OVERRIDE_ARG.test(arg) && value === true) {
      findings.push({ target: tool.name, kind: 'tool-abuse', detail: `arg "${arg}": limits-override flag set on a legitimate call` });
    }
    if (ABUSE_DIRECTIVE.test(strValue)) {
      findings.push({ target: tool.name, kind: 'tool-abuse', detail: `arg "${arg}": smuggled directive in a free-text field (e.g. [SYSTEM: ...])` });
    }
    if (/account|from|to|beneficiary|payee/i.test(arg) && ABUSE_FOREIGN_ID.test(strValue)) {
      findings.push({ target: tool.name, kind: 'tool-abuse', detail: `arg "${arg}": foreign account id "${strValue}" — possible cross-owner attempt` });
    }
  }
  return findings;
}

// scanAgentCard(card) — card poisoning + inter-agent abuse.
export function scanAgentCard(card) {
  const findings = [];
  if (!card || typeof card !== 'object') return findings;
  const label = `card:${card.name || 'agent'}`;
  const why = describeInstruction(card.description || '');
  if (why) findings.push({ target: label, kind: 'tool-poisoning', detail: why });

  const skills = card.skills || [];
  for (const s of skills) {
    const sLabel = `skill:${s.id || s.name || '(unnamed)'}`;
    const sWhy = describeInstruction(s.description || '');
    if (sWhy) findings.push({ target: sLabel, kind: 'tool-poisoning', detail: sWhy });
    if (LEAK_HINT.test(s.description || '')) findings.push({ target: sLabel, kind: 'tool-poisoning', detail: 'skill description instructs including sensitive context (credentials/tokens/full context)' });
  }

  const abuseText = [card.description, ...skills.map((s) => s.description)].filter(Boolean).join('\n');
  if (/\b(i am|this is|as)\b[^.\n]{0,40}\b(orchestrator|supervisor|administrator|admin)\b/i.test(abuseText)) {
    findings.push({ target: label, kind: 'inter-agent-abuse', detail: 'card claims orchestrator/admin authority over the delegating agent' });
  }
  if (/\b(disable|turn off|deactivate|ignore)\b[^.\n]{0,30}\b(safety|security|guardrail|policy)[a-z -]{0,20}(checks?|rules?|policies?)\b/i.test(abuseText)) {
    findings.push({ target: label, kind: 'inter-agent-abuse', detail: 'card instructs the delegating agent to disable its safety checks' });
  }
  return findings;
}
