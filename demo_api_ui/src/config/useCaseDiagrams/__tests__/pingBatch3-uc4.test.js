import { describe, expect, it } from "vitest";
import { getConfig } from "../index";
import { validateConfig } from "../validate";
import { validateSteps, stepDetailForBeat } from "../stepDetail";

const IDS = ["UC22", "UC24", "UC25", "UC26", "UC27", "UC28", "UC3", "UC33", "UC34", "UC35"];
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/;
const KINDS = ["rfc", "spec", "emerging"];

describe("Ping-style use-case configs, batch 3 group 4", () => {
  it.each(IDS)("%s: resolves, is valid and opts into the Ping style", (id) => {
    const cfg = getConfig(id);
    expect(cfg).toBeTruthy();
    expect(cfg.id).toBe(id);
    expect(cfg.pingStyle).toBe(true);
    expect(validateConfig(cfg).errors).toEqual([]);
  });

  it.each(IDS)("%s: steps validate and every walk beat has a step", (id) => {
    const cfg = getConfig(id);
    expect(validateSteps(cfg)).toEqual([]);
    cfg.walk.forEach((_w, beat) => expect(stepDetailForBeat(cfg, beat)).toBeTruthy());
  });

  it.each(IDS)("%s: every step has a form, a tokens list and well-formed refs", (id) => {
    const cfg = getConfig(id);
    for (const s of cfg.steps) {
      expect(typeof s.detail.form).toBe("string");
      expect(Array.isArray(s.detail.tokens)).toBe(true);
      // a step with no token explains why in its form text
      for (const t of s.detail.tokens) expect(t.note).toMatch(/MOCK/);
      for (const r of s.detail.refs || []) {
        expect(r.id && r.title).toBeTruthy();
        expect(KINDS).toContain(r.kind);
      }
      expect(JWT.test(JSON.stringify(s.detail))).toBe(false);
    }
  });
});
