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
  it("shows an emerging standard where one applies", () => {
    const kinds = Object.values(PA_STEP_DETAIL).flatMap((d) => d.refs.map((r) => r.kind));
    expect(kinds).toContain("emerging");
  });
});
