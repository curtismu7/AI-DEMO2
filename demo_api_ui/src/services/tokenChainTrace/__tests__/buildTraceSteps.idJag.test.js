import { buildRunStory, buildTraceSteps, isNativeIdJagTrace, isMockIdJagTrace } from "../buildTraceSteps";
import { createMockIdJagTrace } from "../../../utils/idJagMockTrace";

/**
 * Native ID-JAG hops on the trace rail.
 *
 * buildTraceSteps is a HARDCODED step registry, not a generic event mapper, and
 * seven surfaces derive from it — TokenChainFilmstrip (movie roll),
 * TokenChainTraceRail (stepper), TraceStepCard, TokenTopologyPanel,
 * TokenFlowDetailModal, TraceMcpPanel, TraceTokenSummary. So an ID-JAG event
 * that the token-chain event list renders fine is still invisible on every one
 * of those until it has a step here.
 *
 * That is the failure this repo keeps hitting: right code, wrong surface.
 */

const EMPTY_TRACE = {
  startedAt: null, prompt: null, routingMode: null, routingDetail: null,
  llmDetail: null, llmReply: null,
  phases: [], tokenEvents: [], mcpResult: null, authorize: null, outcome: null,
};

const idJagEvents = () => [
  {
    id: "id-jag-issued",
    label: "Enterprise IdP issued an ID-JAG",
    status: "active",
    alg: "RS256",
    claims: { iss: "https://idp.ping.demo", sub: "user-123", aud: "https://as", scope: "banking:read" },
    idJagStandIn: false,
    resource: "https://mcpserver.ping.demo",
  },
  {
    id: "id-jag-redeemed",
    label: "MCP Authorization Server redeemed the ID-JAG",
    status: "active",
    alg: "RS256",
    claims: { iss: "https://mcpserver.ping.demo:8080", sub: "user-123", scope: "banking:read" },
    idJagStandIn: false,
    scope: "banking:read",
  },
];

const pfEvents = () => [
  { id: "pf-id-jag-issued", status: "active", provider: "pingfederate", provenance: "live-id-jag", mode: "id-jag", claims: { iss: "https://pf.example", sub: "demo-user" }, resource: "https://mcp.example" },
  { id: "pf-id-jag-redeemed", status: "exchanged", provider: "pingfederate", provenance: "live-id-jag", mode: "id-jag", claims: { iss: "https://as.example", sub: "demo-user" }, scope: "balance:read" },
];
const pfTrace = () => ({ ...EMPTY_TRACE, provenance: "live-id-jag", mode: "id-jag", tokenEvents: pfEvents() });

describe("ID-JAG provenance", () => {
  test("only a validated PF pair or explicit live run selects native ID-JAG", () => {
    expect(isNativeIdJagTrace({ ...EMPTY_TRACE, tokenEvents: pfEvents() })).toBe(true);
    expect(isNativeIdJagTrace({ ...EMPTY_TRACE, tokenEvents: idJagEvents() })).toBe(false);
    expect(isNativeIdJagTrace({ ...EMPTY_TRACE, provenance: "live-id-jag", mode: "id-jag" })).toBe(true);
    expect(isNativeIdJagTrace({ ...EMPTY_TRACE, provenance: "live-id-jag", mode: "live-id-jag" })).toBe(true);
    expect(isNativeIdJagTrace(createMockIdJagTrace())).toBe(false);
    expect(isNativeIdJagTrace({ ...EMPTY_TRACE, tokenEvents: [{ ...pfEvents()[0], provider: "pingone" }, pfEvents()[1]] })).toBe(false);
  });

  test("mock hops stay labeled mock and are never treated as native PF evidence", () => {
    const trace = createMockIdJagTrace();
    expect(isMockIdJagTrace(trace)).toBe(true);
    const steps = buildTraceSteps(trace);
    expect(steps.find((step) => step.id === "id-jag-issued").title).toMatch(/Mock replay/i);
    expect(steps.find((step) => step.id === "id-jag-issued").detail.response.text).toContain("mock-pingfederate");
    expect(steps.find((step) => step.id === "id-jag-redeemed").title).toMatch(/Mock replay/i);
  });

  test("mock browser and prompt details describe a replay, and the run story is complete", () => {
    const trace = createMockIdJagTrace();
    const steps = buildTraceSteps(trace);
    const browser = steps.find((step) => step.id === "website");
    const prompt = steps.find((step) => step.id === "prompt");
    expect(browser.detail.narrative).toMatch(/mock|sample|replay/i);
    expect(browser.detail.narrative).not.toMatch(/sending requests over HTTP/i);
    expect(prompt.detail.request?.title).not.toMatch(/actual/i);
    expect(prompt.detail.request?.text ?? "").not.toMatch(/POST \/api\/agent\/run/i);
    const mcp = steps.find((step) => step.id === "mcp");
    expect(mcp.detail.why).toMatch(/mock|sample|replay/i);
    expect(mcp.detail.request?.title).not.toMatch(/actual/i);
    expect(buildRunStory(trace, steps)).toMatchObject({ outcome: "ok" });
    expect(buildRunStory(trace, steps).headline).toMatch(/mock replay.*complete/i);
  });

  test("PF events create native hops; ordinary traces omit them", () => {
    const liveSteps = buildTraceSteps({ ...EMPTY_TRACE, tokenEvents: pfEvents() });
    expect(liveSteps.find((step) => step.id === "id-jag-issued").title).toMatch(/PingFederate ID-JAG/i);
    expect(liveSteps.find((step) => step.id === "id-jag-issued").lane).toBe("PINGFEDERATE");
    expect(liveSteps.find((step) => step.id === "id-jag-redeemed").detail.response.text).toContain("https://as.example");
    expect(liveSteps.find((step) => step.id === "exchange").status).toBe("notinpath");
    const ordinary = buildTraceSteps({ ...EMPTY_TRACE, tokenEvents: [{ id: "exchanged-token", status: "exchanged" }] });
    expect(ordinary.map((step) => step.id)).not.toContain("id-jag-issued");
    expect(ordinary.map((step) => step.id)).not.toContain("id-jag-redeemed");
  });
});

describe("buildTraceSteps — native ID-JAG", () => {
  test("partial issuance evidence keeps the PF lane and marks failed redemption", () => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, provenance: "live-id-jag", mode: "live-id-jag",
      outcome: "error", tokenEvents: [pfEvents()[0]] });
    expect(steps.find((step) => step.id === "id-jag-issued")).toMatchObject({ status: "done", lane: "PINGFEDERATE" });
    expect(steps.find((step) => step.id === "id-jag-redeemed")).toMatchObject({ status: "error" });
  });

  test("adds both ID-JAG hops when the events are present", () => {
    const ids = buildTraceSteps(pfTrace()).map((s) => s.id);
    expect(ids).toContain("id-jag-issued");
    expect(ids).toContain("id-jag-redeemed");
  });

  test("issuance comes before redemption, and both before the exchange slot", () => {
    const ids = buildTraceSteps(pfTrace()).map((s) => s.id);
    expect(ids.indexOf("id-jag-issued")).toBeLessThan(ids.indexOf("id-jag-redeemed"));
    expect(ids.indexOf("id-jag-redeemed")).toBeLessThan(ids.indexOf("exchange"));
  });

  test("both hops carry a title and a lane — an unregistered id renders blank", () => {
    const steps = buildTraceSteps(pfTrace());
    for (const id of ["id-jag-issued", "id-jag-redeemed"]) {
      const step = steps.find((s) => s.id === id);
      expect(step.title).toBeTruthy();
      expect(step.lane).toBeTruthy();
      expect(step.detail.narrative).toBeTruthy();
    }
  });

  test("both hops cite the specs they implement", () => {
    const steps = buildTraceSteps(pfTrace());
    const issued = steps.find((s) => s.id === "id-jag-issued");
    expect(issued.detail.rfcs.join(" ")).toMatch(/8693|id-jag/i);
    const redeemed = steps.find((s) => s.id === "id-jag-redeemed");
    expect(redeemed.detail.rfcs.join(" ")).toMatch(/7523|jwt-bearer|Enterprise/i);
  });

  test("the hops report done once their events land", () => {
    const steps = buildTraceSteps(pfTrace());
    expect(steps.find((s) => s.id === "id-jag-issued").status).toBe("done");
    expect(steps.find((s) => s.id === "id-jag-redeemed").status).toBe("done");
  });

  test("the RFC 8693 exchange is marked not-in-path — it genuinely did not run", () => {
    const steps = buildTraceSteps(pfTrace());
    const exchange = steps.find((s) => s.id === "exchange");
    expect(exchange.status).toBe("notinpath");
    // Say WHY, so a viewer can tell "replaced" from "broken".
    expect(exchange.detail.why).toMatch(/ID-JAG/i);
  });

  test("STAND-IN UNCHANGED: no ID-JAG events means no ID-JAG hops", () => {
    const ids = buildTraceSteps(EMPTY_TRACE).map((s) => s.id);
    expect(ids).not.toContain("id-jag-issued");
    expect(ids).not.toContain("id-jag-redeemed");
    expect(ids).toContain("exchange");
  });

  test("the ID-JAG hops are not counted as MCP tool-call hops", async () => {
    // exchange is deliberately excluded from MCP_STEP_IDS because the MCP tab
    // must open on a tool call, not a token mint. ID-JAG mints tokens too.
    const { MCP_STEP_IDS } = await import("../buildTraceSteps");
    expect(MCP_STEP_IDS).not.toContain("id-jag-issued");
    expect(MCP_STEP_IDS).not.toContain("id-jag-redeemed");
  });

  test("step numbering stays contiguous with the extra hops", () => {
    const steps = buildTraceSteps(pfTrace());
    expect(steps.map((s) => s.num)).toEqual(steps.map((_, i) => i + 1));
  });
});
