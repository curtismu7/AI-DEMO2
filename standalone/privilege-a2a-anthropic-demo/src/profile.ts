/** Defensive parsing of the optional per-vertical profile the BFF forwards. Anything invalid is treated as absent. */

export interface Profile {
  vertical: string;
  agentName: string;
  specialistName: string;
  tools: string[];
  subtaskHint: string;
}

const str = (v: unknown): string => (typeof v === 'string' && v.trim().length > 0 && v.length <= 120 && !/[\r\n]/.test(v) ? v.trim() : '');

/** `{ vertical, tools }`: the part of the profile that rides in A2A message metadata. */
export function parseMetadata(raw: unknown): { vertical: string; tools: string[] } | null {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const vertical = typeof m.vertical === 'string' && /^[a-z0-9-]{1,64}$/.test(m.vertical) ? m.vertical : '';
  const tools = m.tools;
  if (!vertical || !Array.isArray(tools) || tools.length === 0 || tools.length > 8
    || !tools.every(t => typeof t === 'string' && /^[a-z0-9_]{1,64}$/.test(t))) return null;
  return { vertical, tools: tools as string[] };
}

/** The full profile from a /chat or /chain body, or null when absent or invalid. */
export function parseProfile(raw: unknown): Profile | null {
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const base = parseMetadata(b);
  const agentName = str(b.agentName);
  const specialistName = str(b.specialistName);
  const subtaskHint = str(b.subtaskHint);
  if (!base || !agentName || !specialistName || !subtaskHint) return null;
  return { ...base, agentName, specialistName, subtaskHint };
}

/** The signed-in user's name as the BFF reports it (from its own session, never the browser), or '' when absent or invalid. */
export function parseUserName(raw: unknown): string {
  return str(((raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>).userName);
}

const clip = (s: string): string => s.slice(0, 80);

/** Display labels for a role key: main -> agent, analyst -> specialist, mcp -> its tool set. */
export function labelFor(profile: Profile, key: string): string | undefined {
  if (key === 'main') return clip(profile.agentName);
  if (key === 'analyst') return clip(profile.specialistName);
  if (key === 'mcp') return clip(`${profile.specialistName} data tools`);
  return undefined;
}

/** Add fromLabel/toLabel to an event with from/to keys; the event is returned unchanged without a profile. */
export function withLabels<T extends { from?: unknown; to?: unknown }>(event: T, profile: Profile | null): T & { fromLabel?: string; toLabel?: string } {
  if (!profile) return event;
  const fromLabel = typeof event.from === 'string' ? labelFor(profile, event.from) : undefined;
  const toLabel = typeof event.to === 'string' ? labelFor(profile, event.to) : undefined;
  return { ...event, ...(fromLabel ? { fromLabel } : {}), ...(toLabel ? { toLabel } : {}) };
}

/** 'heuristics' when the caller asked for the model-free path; anything else keeps the model. */
export function parseMode(raw: unknown): 'heuristics' | 'llm' {
  const m = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return m.mode === 'heuristics' ? 'heuristics' : 'llm';
}

const TOOL_HINTS: Array<[RegExp, string]> = [
  [/transaction|trade|dividend|activity/i, 'get_investment_transactions'],
  [/account/i, 'get_investment_accounts'],
  [/balance/i, 'get_investment_balance'],
];

/** Keyword tool pick for the model-free path: the first hinted tool on offer, else the first tool (single-tool verticals). */
export function pickTool(tools: string[], question: string): string {
  for (const [re, name] of TOOL_HINTS) if (tools.includes(name) && re.test(question)) return name;
  return tools[0] ?? '';
}
