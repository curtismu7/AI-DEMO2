import { diffTokenClaims } from "../diffTokenClaims";

test("detects scope narrowing", () => {
  const rows = diffTokenClaims({ scope: "read write" }, { scope: "write" });
  expect(rows).toContainEqual({ claim: "scope", from: "read write", to: "write", note: "narrowed" });
});

test("detects audience rebinding", () => {
  const rows = diffTokenClaims({ aud: "banking-api" }, { aud: "mcp-gw" });
  expect(rows).toContainEqual({ claim: "aud", from: "banking-api", to: "mcp-gw", note: "rebound (RFC 8707)" });
});

test("detects act added", () => {
  const rows = diffTokenClaims({}, { act: { sub: "agent-001" } });
  expect(rows).toContainEqual({
    claim: "act", from: "—", to: '{"sub":"agent-001"}', note: "delegation proof added (RFC 8693)",
  });
});

test("detects exp shortened, ignores unchanged claims", () => {
  const rows = diffTokenClaims({ exp: 1000, scope: "write" }, { exp: 500, scope: "write" });
  expect(rows).toEqual([{ claim: "exp", from: "1000", to: "500", note: "shortened" }]);
});

test("returns empty array when nothing changed", () => {
  expect(diffTokenClaims({ scope: "a" }, { scope: "a" })).toEqual([]);
});
