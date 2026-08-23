import { buildTraceSteps } from "../buildTraceSteps";

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

describe("buildTraceSteps — native ID-JAG", () => {
  test("adds both ID-JAG hops when the events are present", () => {
    const ids = buildTraceSteps({ ...EMPTY_TRACE, tokenEvents: idJagEvents() }).map((s) => s.id);
    expect(ids).toContain("id-jag-issued");
    expect(ids).toContain("id-jag-redeemed");
  });

  test("issuance comes before redemption, and both before the exchange slot", () => {
    const ids = buildTraceSteps({ ...EMPTY_TRACE, tokenEvents: idJagEvents() }).map((s) => s.id);
    expect(ids.indexOf("id-jag-issued")).toBeLessThan(ids.indexOf("id-jag-redeemed"));
    expect(ids.indexOf("id-jag-redeemed")).toBeLessThan(ids.indexOf("exchange"));
  });

  test("both hops carry a title and a lane — an unregistered id renders blank", () => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, tokenEvents: idJagEvents() });
    for (const id of ["id-jag-issued", "id-jag-redeemed"]) {
      const step = steps.find((s) => s.id === id);
      expect(step.title).toBeTruthy();
      expect(step.lane).toBeTruthy();
      expect(step.detail.narrative).toBeTruthy();
    }
  });

  test("both hops cite the specs they implement", () => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, tokenEvents: idJagEvents() });
    const issued = steps.find((s) => s.id === "id-jag-issued");
    expect(issued.detail.rfcs.join(" ")).toMatch(/8693|id-jag/i);
    const redeemed = steps.find((s) => s.id === "id-jag-redeemed");
    expect(redeemed.detail.rfcs.join(" ")).toMatch(/7523|jwt-bearer|Enterprise/i);
  });

  test("the hops report done once their events land", () => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, tokenEvents: idJagEvents() });
    expect(steps.find((s) => s.id === "id-jag-issued").status).toBe("done");
    expect(steps.find((s) => s.id === "id-jag-redeemed").status).toBe("done");
  });

  test("the RFC 8693 exchange is marked not-in-path — it genuinely did not run", () => {
    const steps = buildTraceSteps({ ...EMPTY_TRACE, tokenEvents: idJagEvents() });
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
    const steps = buildTraceSteps({ ...EMPTY_TRACE, tokenEvents: idJagEvents() });
    expect(steps.map((s) => s.num)).toEqual(steps.map((_, i) => i + 1));
  });
});
