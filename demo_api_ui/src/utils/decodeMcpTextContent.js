// MCP tool results come back as { content: [{ type: "text", text: "<string>" }] },
// and for our banking tools that string is itself JSON. Rendering the envelope
// as-is prints the whole payload escaped — \" and \n everywhere — which is
// unreadable in the tester's Result tab.
//
// This replaces the inner `text` string with the parsed value while KEEPING the
// MCP envelope, so the protocol shape stays visible (it is a teaching surface)
// but the payload reads as normal JSON.

/**
 * @param {unknown} value a tool result, MCP envelope or otherwise
 * @returns {unknown} the same value, with JSON-encoded text parts decoded
 */
export function decodeMcpTextContent(value) {
  if (!value || typeof value !== "object" || !Array.isArray(value.content)) return value;

  let decodedAny = false;
  const content = value.content.map((part) => {
    if (!part || part.type !== "text" || typeof part.text !== "string") return part;
    const trimmed = part.text.trim();
    // Only attempt a parse for things that could be a JSON object/array —
    // a plain prose result must stay exactly as the tool wrote it.
    if (trimmed[0] !== "{" && trimmed[0] !== "[") return part;
    try {
      const parsed = JSON.parse(trimmed);
      decodedAny = true;
      return { ...part, text: parsed };
    } catch {
      return part; // not JSON after all — leave it alone
    }
  });

  return decodedAny ? { ...value, content } : value;
}
