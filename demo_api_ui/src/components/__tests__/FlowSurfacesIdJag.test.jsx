import { render, screen, act } from "@testing-library/react";
import TokenChainFilmstrip from "../TokenChainFilmstrip";
import TokenChainTraceRail from "../TokenChainTraceRail";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";

/**
 * Every flow surface must be able to SHOW the ID-JAG hops.
 *
 * buildTraceSteps is a hardcoded registry feeding seven surfaces, so a step that
 * builds correctly can still be invisible on the one a presenter actually has
 * open. This repo has shipped that exact bug before — gateway filter stages
 * rendered into TraceStepCard, which focus mode never mounts.
 *
 * These assert against the rendered DOM, not the step model.
 */

vi.mock("../../context/TokenChainContext", () => ({
  useTokenChainOptional: () => ({ clearEvents: vi.fn() }),
}));
vi.mock("../../context/ProofOfEnforcementContext", () => ({
  useProofOfEnforcementOptional: () => null,
}));
vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("../ClaimDetailsModal", () => ({
  default: ({ isOpen, tokenType }) => (isOpen ? <div data-testid="claims-modal">{tokenType}</div> : null),
}));
vi.mock("../TokenLegendModal", () => ({
  default: ({ isOpen }) => (isOpen ? <div data-testid="legend-modal" /> : null),
}));

const ID_JAG_EVENTS = [
  { id: "user-token", status: "active", claims: { sub: "u1", scope: "banking:read" } },
  {
    id: "pf-id-jag-issued",
    label: "PingFederate issued an ID-JAG",
    status: "active",
    alg: "RS256",
    claims: { iss: "https://idp.ping.demo", sub: "u1", aud: "https://as", scope: "banking:read" },
    idJagStandIn: false,
    resource: "https://mcpserver.ping.demo",
    provider: "pingfederate", provenance: "live-id-jag", mode: "id-jag",
  },
  {
    id: "pf-id-jag-redeemed",
    label: "Downstream AS redeemed the ID-JAG",
    status: "active",
    alg: "RS256",
    claims: { iss: "https://mcpserver.ping.demo:8080", sub: "u1", scope: "banking:read" },
    idJagStandIn: false,
    scope: "banking:read",
    provider: "pingfederate", provenance: "live-id-jag", mode: "id-jag",
  },
];

function seedIdJagTrace() {
  act(() => tokenChainTraceStore.beginTrace({ prompt: "show my balance", provenance: "live-id-jag", mode: "id-jag" }));
  act(() => tokenChainTraceStore.ingestTokenEvents(ID_JAG_EVENTS));
}

function seedStandInTrace() {
  act(() => tokenChainTraceStore.beginTrace({ prompt: "show my balance" }));
  act(() => tokenChainTraceStore.ingestTokenEvents([ID_JAG_EVENTS[0]]));
}

beforeEach(() => {
  global.fetch = vi.fn(async (url) => {
    if (String(url).includes("/api/admin/feature-flags")) {
      return { ok: true, json: async () => ({ flags: [] }) };
    }
    return { ok: false, json: async () => ({}) };
  });
});

describe("movie-roll filmstrip shows ID-JAG", () => {
  it("renders both ID-JAG hops as frames", () => {
    render(<TokenChainFilmstrip />);
    seedIdJagTrace();
    expect(screen.getByTitle("PingFederate ID-JAG issued")).toBeInTheDocument();
    expect(screen.getByTitle("PingFederate ID-JAG redeemed")).toBeInTheDocument();
  });

  it("STAND-IN UNCHANGED: no ID-JAG frames without the events", () => {
    render(<TokenChainFilmstrip />);
    seedStandInTrace();
    expect(screen.queryByText(/ID-JAG issued/i)).toBeNull();
    expect(screen.queryByText(/ID-JAG redeemed/i)).toBeNull();
  });
});

describe("trace rail stepper shows ID-JAG", () => {
  it("renders both ID-JAG hops as steps", () => {
    render(<TokenChainTraceRail />);
    seedIdJagTrace();
    expect(screen.getAllByText(/ID-JAG issued/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ID-JAG redeemed/i).length).toBeGreaterThan(0);
  });

  it("STAND-IN UNCHANGED: no ID-JAG steps without the events", () => {
    render(<TokenChainTraceRail />);
    seedStandInTrace();
    expect(screen.queryByText(/ID-JAG issued/i)).toBeNull();
    expect(screen.queryByText(/ID-JAG redeemed/i)).toBeNull();
  });
});
