/**
 * Drops sentences in the concierge's own reply that claim something the raw tool
 * output never said. Checked words: scope ("the only", "most recent"), time spans
 * ("three years", "four months") and status ("good standing", "expired"); and exact
 * ISO dates. A word or date is allowed only when the raw output contains it too.
 */
const SCOPE_WORDS = /\b(only|most recent|latest|complete|entire|full|every)\b/gi;
const TIME_SPAN_WORDS = /\b(years?|months?|weeks?|days?|hours?)\b/gi;
const STATUS_WORDS = /\b(good standing|in standing|active|inactive|expired|overdue|suspended|verified|approved|pending|cancell?ed)\b/gi;
const ISO_DATES = /\b\d{4}-\d{2}-\d{2}\b/g;

/** The raw tool outputs the worker attached to its reply metadata; anything else is ignored. */
export function toolOutputsFrom(metadata: unknown): string[] {
  const raw = (metadata as { toolOutputs?: unknown } | null | undefined)?.toolOutputs;
  return Array.isArray(raw) && raw.every(item => typeof item === 'string') ? raw : [];
}

/** Every checked claim word or date in a sentence, lowercased. */
function claimsIn(sentence: string): string[] {
  return [SCOPE_WORDS, TIME_SPAN_WORDS, STATUS_WORDS, ISO_DATES]
    .flatMap(pattern => [...sentence.matchAll(pattern)].map(match => match[0].toLowerCase()));
}

/** The plain text of a model turn, joined; tool-use blocks contribute nothing. */
export function textOfTurn(content: ReadonlyArray<{ type: string; text?: string }>): string {
  return content.map(block => (block.type === 'text' ? block.text ?? '' : '')).join('');
}

export function stripUnsourcedScope(reply: string, analystText: string): string {
  const source = analystText.toLowerCase();
  const sentences = reply.split(/(?<=[.!?])\s+/);
  return sentences
    .filter(sentence => claimsIn(sentence).every(claim => source.includes(claim)))
    .join(' ')
    .trim();
}
