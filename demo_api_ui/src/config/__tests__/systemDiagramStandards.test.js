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

  it("forms are accurate to the repo: real PingOne decision endpoint, 8-char CIBA message, no invented worker scope", () => {
    const pdp = formFor("PingGW", "PDP");
    expect(pdp).toMatch(/\/decisionEndpoints\/\{endpointId\}/);
    expect(pdp).not.toMatch(/policyDecisionPoints/);
    expect(formFor("AuthorizeService", "PingOneAuthorize")).toMatch(/"parameters"/);
    const msg = formFor("CibaRoutes", "OIDC_AS").match(/binding_message=(\S+)/)[1];
    expect(msg.length).toBeLessThanOrEqual(8);
    for (const e of arrowsOf(MMD)) for (const t of tokensFor(e.from, e.to)) expect(t.claims.scope).not.toBe("p1:read:policy");
  });

  it("WebSocket hops show a WebSocket form and do not cite MCP authorization (HTTP only)", () => {
    for (const [f, t] of [["GwProxy", "MCPProtocol"], ["McpInspectorRoutes", "MCPProtocol"], ["MCPClientPy", "MCPProtocol"], ["AgentService", "GwProxy"]]) {
      expect(formFor(f, t)).toMatch(/WebSocket/);
      expect(refsFor(f, t).map((r) => r.id)).toContain("RFC 6455");
      expect(refsFor(f, t).map((r) => r.id)).not.toContain("MCP authorization 2025-11-25");
    }
    expect(formFor("PingGW", "WeatherMcp")).toMatch(/^POST \/mcp/);
  });

  it("every HTTP or protocol call that the diagram names has a request form; token-bearing hops carry a MOCK token", () => {
    const calls = [
      ["AdminBrowser", "UI"], ["Login", "AuthRoutes"], ["Dashboard", "AdminRoutes"], ["SecuritySettings", "AdminRoutes"], ["UserDash", "TxRoutes"],
      ["McpInspector", "HealthInsp"], ["ConfigPage", "ValidationRoutes"], ["ChatWidget", "FastAPI"], ["AgentService", "A2AOrch"], ["A2AOrch", "Specialist"],
      ["A2AOrch", "PDP"], ["GwAuthorize", "PDP"], ["PingGW", "PDP"], ["PingGW", "AuthzMock"], ["AuthRoutes", "AGUIRoutes"], ["AGUIRoutes", "MastraAgent"],
    ];
    expect(calls.filter(([f, t]) => !formFor(f, t))).toEqual([]);
    for (const [f, t] of [["MCPClientPy", "MCPProtocol"], ["McpInspectorRoutes", "MCPProtocol"], ["PingGW", "PDP"], ["A2AOrch", "PDP"], ["GwAuthorize", "PDP"]]) {
      expect(tokensFor(f, t).length).toBeGreaterThan(0);
    }
  });

  it("in-process gates carry a stated reason, not a standard", () => {
    for (const [f, t] of [["TxRoutes", "StepUpGate"], ["StepUpGate", "AuthorizeGate"], ["AuthorizeGate", "AuthorizeService"], ["HITLSvc", "AuthRoutes"]]) {
      expect(refsFor(f, t)).toEqual([]);
      expect(whyNoRefs(f, t)).toBeTruthy();
    }
  });
});
