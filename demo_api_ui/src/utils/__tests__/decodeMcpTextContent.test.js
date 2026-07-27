import { describe, expect, test } from "vitest";
import { decodeMcpTextContent } from "../decodeMcpTextContent";

describe("decodeMcpTextContent", () => {
  test("parses a JSON-encoded text part while keeping the MCP envelope", () => {
    const raw = {
      content: [{ type: "text", text: '{"success":true,"count":1,"accounts":[{"id":"a1"}]}' }],
    };
    expect(decodeMcpTextContent(raw)).toEqual({
      content: [
        { type: "text", text: { success: true, count: 1, accounts: [{ id: "a1" }] } },
      ],
    });
  });

  test("leaves prose text exactly as the tool wrote it", () => {
    const raw = { content: [{ type: "text", text: "Transfer completed." }] };
    expect(decodeMcpTextContent(raw)).toBe(raw);
  });

  test("leaves malformed JSON alone rather than dropping the payload", () => {
    const raw = { content: [{ type: "text", text: '{"truncated":' }] };
    expect(decodeMcpTextContent(raw)).toBe(raw);
  });

  test("passes through non-MCP values untouched", () => {
    expect(decodeMcpTextContent(null)).toBeNull();
    const plain = { error: "boom" };
    expect(decodeMcpTextContent(plain)).toBe(plain);
  });

  test("decodes only the JSON parts of a mixed content array", () => {
    const raw = {
      content: [
        { type: "text", text: "Here are your accounts:" },
        { type: "text", text: '[{"id":"a1"}]' },
        { type: "image", data: "…" },
      ],
    };
    expect(decodeMcpTextContent(raw).content).toEqual([
      { type: "text", text: "Here are your accounts:" },
      { type: "text", text: [{ id: "a1" }] },
      { type: "image", data: "…" },
    ]);
  });
});
