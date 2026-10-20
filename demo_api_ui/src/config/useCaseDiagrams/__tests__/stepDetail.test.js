import { describe, expect, it } from "vitest";
import { validateConfig } from "../validate";
import { stepDetailForBeat } from "../stepDetail";
import { CONFIGS, getConfig } from "../index";

const base = () => ({
  result: { label: "X", tone: "ok" },
  NODES: [{ id: "a", detail: "d" }, { id: "b", detail: "d" }],
  EDGES: [["a", "b"]],
  walk: [{ title: "t", nodes: ["a", "b"], edges: [0], tech: [] }, { title: "u", nodes: ["b"], edges: [], tech: [] }],
});
const withSteps = (steps) => ({ ...base(), steps });
const ok = { beats: [0], detail: { form: "GET /x", tokens: [{ note: "n · m", claims: { sub: "u" } }], refs: [{ id: "RFC 1", title: "t", kind: "rfc" }] } };

describe("optional steps on a use-case config", () => {
  it("a config without steps validates and has no detail", () => {
    expect(validateConfig(base()).ok).toBe(true);
    expect(stepDetailForBeat(base(), 0)).toBeNull();
  });

  it("accepts well-formed steps and finds the detail by beat", () => {
    const cfg = withSteps([ok, { beats: [1], detail: { refs: [{ id: "RFC 2", title: "t", kind: "emerging" }] } }]);
    expect(validateConfig(cfg).errors).toEqual([]);
    expect(stepDetailForBeat(cfg, 0).form).toBe("GET /x");
    expect(stepDetailForBeat(cfg, 1).refs[0].id).toBe("RFC 2");
    expect(stepDetailForBeat(cfg, -1)).toBeNull();
  });

  it.each([
    ["not an array", { beats: [0] }, /must be an array/],
    ["beat out of range", [{ ...ok, beats: [5] }], /out of range/],
    ["beat claimed twice", [ok, { ...ok, beats: [0] }], /already has a step/],
    ["empty detail", [{ beats: [0], detail: {} }], /needs a form, tokens or refs/],
    ["token without claims", [{ beats: [0], detail: { tokens: [{ note: "n" }] } }], /claims must be an object/],
    ["bad ref kind", [{ beats: [0], detail: { refs: [{ id: "x", title: "t", kind: "blog" }] } }], /needs id, title and kind/],
    ["real-looking JWT", [{ beats: [0], detail: { form: "Authorization: Bearer eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1In0.sig" } }], /real JWT/],
  ])("rejects %s", (_n, steps, re) => {
    const res = validateConfig(withSteps(steps));
    expect(res.ok).toBe(false);
    expect(res.errors.join("\n")).toMatch(re);
  });

  it("the pilot UC-NHI2 carries a step for every beat", () => {
    const pilot = getConfig("UC-NHI2");
    expect(pilot.steps.length).toBe(pilot.walk.length);
  });

  it("every config that carries steps passes the validator", () => {
    const withSteps = CONFIGS.filter((c) => c.steps);
    expect(withSteps.map((c) => c.id)).toContain("UC-NHI2");
    for (const c of withSteps) {
      expect(validateConfig(c).errors.filter((e) => /steps/i.test(e))).toEqual([]);
    }
  });
});
