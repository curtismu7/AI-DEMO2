import { describe, expect, it } from "vitest";
import { isKnownSpec, resolveRefs } from "../specRefs";

describe("resolveRefs", () => {
  it("links an RFC to rfc-editor.org, with its section and its title", () => {
    expect(resolveRefs([{ spec: "RFC 8693", section: "2.1" }])).toEqual([
      { id: "RFC 8693 section 2.1", kind: "rfc", title: "OAuth 2.0 Token Exchange", href: "https://www.rfc-editor.org/rfc/rfc8693#section-2.1" },
    ]);
  });
  it("keeps an RFC with no known title, and adds the step's own note to the title", () => {
    const [r] = resolveRefs([{ spec: "RFC 1234", note: "only the header form" }]);
    expect(r).toMatchObject({ id: "RFC 1234", kind: "rfc", title: "only the header form", href: "https://www.rfc-editor.org/rfc/rfc1234" });
  });
  it("knows the listed specs, and nothing else", () => {
    expect(resolveRefs([{ spec: "CIBA Core 1.0" }])[0]).toMatchObject({ kind: "spec", href: expect.stringMatching(/^https:\/\/openid\.net\//) });
    expect(resolveRefs([{ spec: "my own spec" }, { spec: "http://evil.example/x" }, { spec: "MCP" }]).map((r) => r.id)).toEqual(["MCP"]);
    expect(isKnownSpec({ spec: "RFC 6749" })).toBe(true);
    expect(isKnownSpec({ spec: "rfc 6749" })).toBe(false);
    expect(isKnownSpec(null)).toBe(false);
  });
  it("ignores a section that is not a short number, so no markup or URL ends up in a link", () => {
    expect(resolveRefs([{ spec: "RFC 8693", section: "<script>" }])[0].href).toBe("https://www.rfc-editor.org/rfc/rfc8693");
    expect(resolveRefs([{ spec: "RFC 8693", section: "../../x" }])[0].id).toBe("RFC 8693");
  });
});
