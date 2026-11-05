import { describe, expect, it } from "vitest";
import { getConfig } from "../index";
import { validateConfig } from "../validate";
import { validateSteps, stepDetailForBeat } from "../stepDetail";

const IDS = ["UC16", "UC16b", "UC17", "UC18", "UC19", "UC2.5", "UC2.6", "UC2.7", "UC2", "UC21"];
const JWT_LITERAL = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/;

describe.each(IDS)("Ping-style use-case config %s", (id) => {
  const cfg = getConfig(id);
  it("resolves, is pingStyle and structurally valid", () => {
    expect(cfg).toBeTruthy();
    expect(cfg.pingStyle).toBe(true);
    expect(validateConfig(cfg).errors).toEqual([]);
  });
  it("steps validate and cover every walk beat", () => {
    expect(validateSteps(cfg)).toEqual([]);
    cfg.walk.forEach((_, b) => expect(stepDetailForBeat(cfg, b)).toBeTruthy());
  });
  it("every step has a form, a tokens array and a refs array of well-formed standards", () => {
    for (const s of cfg.steps) {
      expect(typeof s.detail.form).toBe("string");
      expect(Array.isArray(s.detail.tokens)).toBe(true);
      expect(Array.isArray(s.detail.refs)).toBe(true);
      for (const r of s.detail.refs) {
        expect(r.id && r.title).toBeTruthy();
        expect(["rfc", "spec", "emerging"]).toContain(r.kind);
      }
      for (const t of s.detail.tokens) {
        expect(t.note).toMatch(/MOCK/);
        expect(typeof t.claims).toBe("object");
      }
    }
  });
  it("carries no JWT literal and no real-looking secret", () => {
    const text = JSON.stringify(cfg.steps);
    expect(JWT_LITERAL.test(text)).toBe(false);
    expect(text).not.toMatch(/client_secret=(?!CLIENT_SECRET)/);
  });
});
