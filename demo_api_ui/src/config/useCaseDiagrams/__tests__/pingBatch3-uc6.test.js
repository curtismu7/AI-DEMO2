import { describe, expect, it } from "vitest";
import { getConfig } from "../index";
import { validateConfig } from "../validate";
import { validateSteps } from "../stepDetail";

const IDS = ["UC46A", "UC47", "UC48", "UC5", "UC6", "UC7", "UC9"];
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/;

describe.each(IDS)("Ping-style config %s", (id) => {
  const cfg = getConfig(id);

  it("loads, is pingStyle and structurally valid", () => {
    expect(cfg).toBeTruthy();
    expect(cfg.pingStyle).toBe(true);
    expect(validateConfig(cfg).errors).toEqual([]);
  });

  it("steps validate and cover every walk beat exactly once", () => {
    expect(validateSteps(cfg)).toEqual([]);
    const claimed = cfg.steps.flatMap((s) => s.beats).sort((a, b) => a - b);
    expect(claimed).toEqual(cfg.walk.map((_w, i) => i));
  });

  it("every step has a form, a tokens array and well-formed refs", () => {
    for (const s of cfg.steps) {
      expect(typeof s.detail.form).toBe("string");
      expect(Array.isArray(s.detail.tokens)).toBe(true);
      for (const t of s.detail.tokens) expect(t.note).toMatch(/MOCK/);
      if (s.detail.tokens.length === 0) expect(s.detail.form.length).toBeGreaterThan(20);
      for (const r of s.detail.refs || []) {
        expect(r.id && r.title).toBeTruthy();
        expect(["rfc", "spec", "emerging"]).toContain(r.kind);
      }
    }
  });

  it("carries no JWT literal", () => {
    expect(JSON.stringify(cfg.steps)).not.toMatch(JWT);
  });
});
