import { describe, it, expect } from "vitest";
import { DESIGNS } from "../components/personalAgent/personalAgentData";
import { PA_GROUPS, PA_STEP_DETAIL } from "./personalAgentStandards";

const KINDS = ["rfc", "spec", "emerging"];
const keys = [...new Set(Object.values(DESIGNS).flatMap((d) => d.steps.map((s) => s.key)))];

describe("personal agent step detail", () => {
  it("covers every step of both designs and nothing else", () => {
    expect(Object.keys(PA_STEP_DETAIL).sort()).toEqual([...keys].sort());
  });
  it("every node group has a Ping colour", () => {
    for (const d of Object.values(DESIGNS)) for (const n of d.nodes) expect(PA_GROUPS[n.group], n.id).toBeTruthy();
  });
  it.each(keys)("%s has a form, tokens or the reason for none, and standards", (k) => {
    const d = PA_STEP_DETAIL[k];
    expect(d.form).toBeTruthy();
    expect(Array.isArray(d.tokens)).toBe(true);
    if (!d.tokens.length) expect(d.form).toMatch(/No (OAuth )?token/i);
    for (const t of d.tokens) expect(t.note && t.claims).toBeTruthy();
    expect(d.refs.length).toBeGreaterThan(0);
    for (const r of d.refs) {
      expect(r.id && r.title, k).toBeTruthy();
      expect(KINDS).toContain(r.kind);
    }
    expect(new Set(d.refs.map((r) => r.id)).size, `${k} duplicate refs`).toBe(d.refs.length);
  });
  it("never shows a JWT literal or a real-looking secret", () => {
    const blob = JSON.stringify(PA_STEP_DETAIL);
    expect(blob).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
    expect(blob).not.toMatch(/client_secret=[^<&\\]/);
  });
  it("lays boxes on distinct cells and only draws a downward arrow where the config says so", () => {
    for (const d of Object.values(DESIGNS)) {
      const cells = d.nodes.map((n) => `${n.x},${n.y}`);
      expect(new Set(cells).size).toBe(cells.length);
      const at = Object.fromEntries(d.nodes.map((n) => [n.id, n]));
      for (const [src, tgt, , opts] of d.edges) if (opts?.vertical) expect(at[tgt].y, `${src}>${tgt}`).toBeGreaterThan(at[src].y);
    }
  });
  it("draws token arrows dashed and keeps the rest solid", () => {
    for (const d of Object.values(DESIGNS)) {
      const dashed = d.edges.filter((e) => e[3]?.dashed).map((e) => e[2]);
      expect(dashed).toEqual(["sign-in token, kept in the BFF", "exchange: token for one tool", "exchange: token for the facade"]);
    }
  });
  it("shows an emerging standard where one applies", () => {
    const kinds = Object.values(PA_STEP_DETAIL).flatMap((d) => d.refs.map((r) => r.kind));
    expect(kinds).toContain("emerging");
  });
  it("shows what PingOne issues: bearer on the wire, act.client_id, audience= on the exchange", () => {
    const blob = JSON.stringify(PA_STEP_DETAIL);
    expect(blob).not.toMatch(/Authorization: DPoP|\\nDPoP:|cnf|"act":\{"sub"|actor_token_type=urn:ietf:params:oauth:token-type:jwt|&resource=/);
    expect(PA_STEP_DETAIL.exchange1.form).toContain("&audience=");
    expect(PA_STEP_DETAIL.exchange1.form).toContain("actor_token_type=urn:ietf:params:oauth:token-type:access_token");
    for (const t of PA_STEP_DETAIL.exchange1.tokens.concat(PA_STEP_DETAIL.exchange2.tokens)) expect(JSON.stringify(t.claims)).not.toMatch(/"act":\{"sub"/);
  });
  it("attaches standards only to the hops they govern", () => {
    const ids = (k) => PA_STEP_DETAIL[k].refs.map((r) => r.id);
    expect(ids("policy")).not.toContain("OpenID AuthZEN");
    expect(ids("policy")).not.toContain("RFC 9396");
    expect(ids("model")).not.toContain("MCP authorization 2025-11-25");
    expect(ids("signin")).not.toContain("RFC 9396");
    expect(ids("ciba")).not.toContain("RFC 9470");
    expect(ids("ciba")).not.toContain("OpenID FAPI CIBA profile");
    expect(ids("checkout")).not.toContain("RFC 9470");
    for (const k of ["auditTarget", "auditDual", "entryDual", "facade"]) expect(ids(k)).not.toContain("RFC 8693");
    expect(ids("facade")).not.toContain("RFC 6265");
    expect(ids("gatewayGap")).toContain("RFC 7662");
    expect(ids("gatewayGap")).not.toContain("RFC 8705");
  });
});
