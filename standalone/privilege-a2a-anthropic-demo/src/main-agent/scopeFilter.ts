/**
 * Drops sentences in the concierge's own reply that claim a scope the analyst
 * never returned ("the only", "most recent", "complete list"). A scope word is
 * allowed only when the analyst's text contains it too.
 */
const SCOPE_WORDS = /\b(only|most recent|latest|complete|entire|full|every)\b/gi;

export function stripUnsourcedScope(reply: string, analystText: string): string {
  const source = analystText.toLowerCase();
  const sentences = reply.split(/(?<=[.!?])\s+/);
  return sentences
    .filter(sentence => {
      const words = [...sentence.matchAll(SCOPE_WORDS)].map(m => m[0].toLowerCase());
      return words.every(word => source.includes(word));
    })
    .join(' ')
    .trim();
}
