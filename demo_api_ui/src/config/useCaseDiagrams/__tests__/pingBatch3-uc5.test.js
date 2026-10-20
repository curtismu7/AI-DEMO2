import { describe, expect, it } from "vitest";
import { getConfig } from "../index";
import { validateConfig } from "../validate";
import { validateSteps } from "../stepDetail";

const IDS = ["UC37", "UC38", "UC4", "UC40", "UC41", "UC42", "UC43", "UC44", "UC45", "UC46"];
const JWT = /eyJ[A-Za-z0-9_-]{8,}\./;

describe.each(IDS)("%s Ping-style config (batch 3, group 5)", (id) => {
  const cfg = getConfig(id);
  it("loads, is valid and uses the Ping style", () => {
    expect(cfg).toBeTruthy();
    expect(validateConfig(cfg).errors).toEqual([]);
    expect(cfg.pingStyle).toBe(true);
  });
  it("steps validate and cover every walk beat exactly once", () => {
    expect(validateSteps(cfg)).toEqual([]);
    const claimed = cfg.steps.flatMap((s) => s.beats).sort((a, b) => a - b);
    expect(claimed).toEqual(cfg.walk.map((_, i) => i));
  });
  it("every step has a form string, a tokens array and a refs array", () => {
    for (const s of cfg.steps) {
      expect(typeof s.detail.form).toBe("string");
      expect(Array.isArray(s.detail.tokens)).toBe(true);
      expect(Array.isArray(s.detail.refs)).toBe(true);
      for (const t of s.detail.tokens) expect(t.note).toBeTruthy();
      for (const r of s.detail.refs) {
        expect(r.id && r.title).toBeTruthy();
        expect(["rfc", "spec", "emerging"]).toContain(r.kind);
      }
    }
  });
  it("carries no JWT literals", () => {
    expect(JWT.test(JSON.stringify(cfg.steps))).toBe(false);
  });
});
