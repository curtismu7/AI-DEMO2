import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseFlowchart } from "../../utils/parseFlowchart";
import { buildFocusDiagram, FOCUS_GROUPS } from "../../utils/architectureFocus";
import { enrichReelStep, formFor, refsFor, RULE_NODE_IDS, tokensFor, whyNoRefs } from "../systemDiagramStandards";

const MMD = readFileSync(resolve(process.cwd(), "public/architecture/architecture.mmd"), "utf8");
const slices = { full: MMD, ...Object.fromEntries(Object.keys(FOCUS_GROUPS).map((k) => [k, buildFocusDiagram(MMD, k)])) };

const arrowsOf = (src) => {
  const m = parseFlowchart(src);
  const known = new Set([...m.groups.map((g) => g.id), ...m.nodes.map((n) => n.id)]);
  return m.edges.filter((e) => known.has(e.from) && known.has(e.to));
};

describe("systemDiagramStandards", () => {
  it("only names boxes that exist in architecture.mmd", () => {
    const m = parseFlowchart(MMD);
    const ids = new Set([...m.groups.map((g) => g.id), ...m.nodes.map((n) => n.id)]);
    expect(RULE_NODE_IDS.filter((id) => !ids.has(id))).toEqual([]);
  });

  it.each(Object.keys(slices))("every arrow of the %s view has standards or a stated reason", (key) => {
    expect(arrowsOf(slices[key]).length).toBeGreaterThan(0);
    const bare = arrowsOf(slices[key]).filter((e) => !refsFor(e.from, e.to).length && !whyNoRefs(e.from, e.to));
    expect(bare.map((e) => `${e.from} -> ${e.to}`)).toEqual([]);
  });

  it("every standards entry has a kind, an id and a title", () => {
    const all = arrowsOf(MMD).flatMap((e) => refsFor(e.from, e.to));
    expect(all.length).toBeGreaterThan(0);
    for (const r of all) {
      expect(["rfc", "spec", "emerging"]).toContain(r.kind);
      expect(r.id).toBeTruthy();
      expect(r.title).toBeTruthy();
      if (r.kind === "rfc") expect(r.id).toMatch(/^RFC \d+$/);
    }
    expect(all.some((r) => r.kind === "emerging")).toBe(true);
  });

  it("request forms and MOCK tokens exist where the hop is an HTTP call or carries a token", () => {
    expect(formFor("AuthRoutes", "OIDC_AS")).toMatch(/grant_type=authorization_code/);
    expect(formFor("LangChain", "LLM")).toBeNull();
    // two tokens in: the dual-token path sends the access token and the ID token
    expect(tokensFor("GwProxy", "BankingRS")).toHaveLength(2);
    for (const e of arrowsOf(MMD)) for (const t of tokensFor(e.from, e.to)) expect(t.claims && t.note).toBeTruthy();
  });

  it("enrichReelStep adds the form, a MOCK-labelled token and the refs to a step", () => {
    const step = enrichReelStep({ from: "AuthRoutes", to: "OIDC_AS", lines: [{ who: "a", text: "b" }] });
    expect(step.lines.map((l) => l.who)).toEqual(["a", "Request on the wire", "Token in play"]);
    expect(step.lines[2].code).toMatch(/MOCK/);
    expect(step.refs.length).toBeGreaterThan(0);
    const bare = enrichReelStep({ from: "LangChain", to: "LLM", lines: [] });
    expect(bare.refs).toEqual([]);
    expect(bare.lines[0].who).toBe("Standards");
  });
});
