import { describe, expect, it } from "vitest";
import { getConfig } from "../index";
import { validateSteps, stepDetailForBeat } from "../stepDetail";
import { validateConfig } from "../validate";

const IDS = ["UC-TOOL1", "UC-TOOL3", "UC1", "UC10", "UC11", "UC12", "UC13", "UC14", "UC14b", "UC15"];
const JWT_LITERAL = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/;
const REAL_SECRET = /(Bearer|client_secret=)\s*[A-Za-z0-9_-]{24,}/;

describe.each(IDS)("%s Ping-style steps (batch 3)", (id) => {
  const cfg = getConfig(id);

  it("resolves, is pingStyle and passes structural validation", () => {
    expect(cfg).toBeTruthy();
    expect(cfg.pingStyle).toBe(true);
    expect(validateConfig(cfg).errors).toEqual([]);
  });

  it("steps validate and claim every walk beat exactly once", () => {
    expect(validateSteps(cfg)).toEqual([]);
    const claimed = cfg.steps.flatMap((s) => s.beats).sort((a, b) => a - b);
    expect(claimed).toEqual(cfg.walk.map((_, i) => i));
    cfg.walk.forEach((_, i) => expect(stepDetailForBeat(cfg, i)).toBeTruthy());
  });

  it("every step has a request form, a tokens array and refs with kind + id + title", () => {
    for (const s of cfg.steps) {
      expect(typeof s.detail.form).toBe("string");
      expect(s.detail.form.trim().length).toBeGreaterThan(0);
      expect(Array.isArray(s.detail.tokens)).toBe(true);
      expect(Array.isArray(s.detail.refs)).toBe(true);
      for (const r of s.detail.refs) {
        expect(r.id).toBeTruthy();
        expect(r.title).toBeTruthy();
        expect(r.kind).toMatch(/^(rfc|spec|emerging)$/);
      }
      for (const t of s.detail.tokens) {
        expect(t.note).toMatch(/MOCK/);
        expect(typeof t.claims).toBe("object");
      }
    }
  });

  it("carries no JWT literals or real-looking secrets", () => {
    const json = JSON.stringify(cfg.steps);
    expect(json).not.toMatch(JWT_LITERAL);
    expect(json).not.toMatch(REAL_SECRET);
  });

  it("every edge references real nodes", () => {
    const ids = new Set(cfg.NODES.map((n) => n.id));
    for (const [a, b] of cfg.EDGES) {
      expect(ids.has(a)).toBe(true);
      expect(ids.has(b)).toBe(true);
    }
  });
});

describe("batch 3 uc2 content spot checks", () => {
  it("UC1 exchange step shows both input tokens and the output", () => {
    const step = getConfig("UC1").steps.find((s) => s.beats.includes(2));
    expect(step.detail.tokens).toHaveLength(3);
    expect(step.detail.refs.some((r) => r.id === "RFC 8693")).toBe(true);
  });
  it("UC12 uses the DPoP RFC and the replay refusal", () => {
    const cfg = getConfig("UC12");
    expect(JSON.stringify(cfg.steps)).toMatch(/RFC 9449/);
    expect(cfg.steps.at(-1).detail.form).toMatch(/invalid_dpop_proof/);
  });
  it("UC14b pushes with PAR and RAR refs", () => {
    const ids = getConfig("UC14b").steps.flatMap((s) => s.detail.refs.map((r) => r.id));
    expect(ids).toEqual(expect.arrayContaining(["RFC 9126", "RFC 9396"]));
  });
});
