// demo_api_ui/src/utils/__tests__/learningLogColors.test.js
import { describe, it, expect } from "vitest";
import {
  correlationTint,
  resolveCorrelationId,
  severityStyle,
  categoryColor,
} from "../learningLogColors";

describe("learningLogColors", () => {
  it("maps severity glyphs from the allowlist", () => {
    expect(severityStyle("error").glyph).toBe("❌");
    expect(severityStyle("warn").glyph).toBe("⚠️");
    expect(severityStyle("info").glyph).toBe("✅");
  });

  it("returns a stable tint for the same correlation id", () => {
    expect(correlationTint("abc")).toBe(correlationTint("abc"));
    expect(correlationTint("abc")).not.toBe(correlationTint("xyz"));
  });

  it("resolves correlationId with flowId fallback", () => {
    expect(resolveCorrelationId({ correlationId: "c1" })).toBe("c1");
    expect(resolveCorrelationId({ flowId: "f1" })).toBe("f1");
    expect(categoryColor("oauth")).toMatch(/^#/);
  });
});
