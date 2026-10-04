import { render, screen, fireEvent, act } from "@testing-library/react";
import TokenChainFilmstrip from "../TokenChainFilmstrip";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";
import { createMockIdJagTrace } from "../../utils/idJagMockTrace";

vi.mock("../../context/TokenChainContext", () => ({
  useTokenChainOptional: () => ({ clearEvents: vi.fn() }),
}));
vi.mock("../../context/ProofOfEnforcementContext", () => ({
  useProofOfEnforcementOptional: () => null,
}));
// TokenChainDemoTrackTab (Demo Track view) fetches via apiClient.
vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("../ClaimDetailsModal", () => ({
  default: ({ isOpen, tokenType }) =>
    isOpen ? <div data-testid="claims-modal">{tokenType}</div> : null,
}));
vi.mock("../TokenLegendModal", () => ({
  default: ({ isOpen }) => (isOpen ? <div data-testid="legend-modal" /> : null),
}));

function mockFeatureFlags() {
  global.fetch = vi.fn(async (url) => {
    if (String(url).includes("/api/admin/feature-flags")) {
      return { ok: true, json: async () => ({ flags: [] }) };
    }
    return { ok: false, json: async () => ({}) };
  });
}

function openStepDetail() {
  act(() => tokenChainTraceStore.beginTrace({ prompt: "check my balance" }));
  act(() => tokenChainTraceStore.ingestTokenEvents([
    { id: "user-token", status: "active", claims: { sub: "u1", scope: "read" } },
  ]));
  const signin = screen.getAllByText(/Sign-in/)[0];
  fireEvent.click(signin.closest("button"));
}

beforeEach(() => {
  tokenChainTraceStore.reset();
  localStorage.clear();
  mockFeatureFlags();
});

test("Views > Topology dispatches token-topology-open instead of opening an inline sheet", async () => {
  const onTopologyOpen = vi.fn();
  window.addEventListener("token-topology-open", onTopologyOpen);
  render(<TokenChainFilmstrip />);
  fireEvent.click(screen.getByRole("button", { name: "Views" }));
  fireEvent.click(screen.getByRole("button", { name: "Topology" }));
  expect(onTopologyOpen).toHaveBeenCalledTimes(1);
  // No inline sheet opened for it — only the spotlight's empty state shows.
  expect(document.querySelector(".tcfs-sheet")).not.toBeInTheDocument();
  window.removeEventListener("token-topology-open", onTopologyOpen);
});

test("zoom controls resize the step-detail sheet and persist across the same key the rail uses", () => {
  render(<TokenChainFilmstrip />);
  openStepDetail();

  const bigger = screen.getByRole("button", { name: "Increase token chain text size" });
  const smaller = screen.getByRole("button", { name: "Decrease token chain text size" });
  const reset = screen.getByRole("button", { name: "Reset token chain text size" });
  const sheetBody = document.querySelector(".tcfs-sheet-body");

  // Opens at the 120% default, not 100% — the sheet is read off a projector.
  expect(reset).toBeDisabled();
  expect(sheetBody.style.zoom).toBe("1.2");

  fireEvent.click(bigger);
  expect(sheetBody.style.zoom).toBe("1.3");
  expect(reset).not.toBeDisabled();
  expect(localStorage.getItem("tctr:zoom:v2")).toBe("1.3");

  fireEvent.click(smaller);
  fireEvent.click(smaller);
  expect(sheetBody.style.zoom).toBe("1.1");

  fireEvent.click(reset);
  expect(sheetBody.style.zoom).toBe("1.2");
  expect(reset).toBeDisabled();
});

test("zoom clamps at the rail's own min/max", () => {
  render(<TokenChainFilmstrip />);
  openStepDetail();
  const bigger = screen.getByRole("button", { name: "Increase token chain text size" });
  const smaller = screen.getByRole("button", { name: "Decrease token chain text size" });
  for (let i = 0; i < 10; i += 1) fireEvent.click(bigger);
  expect(bigger).toBeDisabled();
  const sheetBody = document.querySelector(".tcfs-sheet-body");
  expect(sheetBody.style.zoom).toBe("1.6");
  for (let i = 0; i < 10; i += 1) fireEvent.click(smaller);
  expect(smaller).toBeDisabled();
  expect(sheetBody.style.zoom).toBe("0.8");
});

test("mock replay populates the movie reel with labeled mock ID-JAG nodes", () => {
  render(<TokenChainFilmstrip />);
  act(() => tokenChainTraceStore.replayTrace(createMockIdJagTrace()));
  expect(screen.getByText("Mock replay", { selector: ".trace-provenance" })).toBeInTheDocument();
  expect(screen.getByTitle("Mock replay — ID-JAG issued")).toBeInTheDocument();
  expect(screen.getByTitle("Mock replay — ID-JAG redeemed")).toBeInTheDocument();
  expect(screen.queryByText("Live run", { selector: ".trace-provenance" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Live claims you can inspect/)).not.toBeInTheDocument();
});

test("live PF evidence labels the movie reel as PingFederate ID-JAG", () => {
  render(<TokenChainFilmstrip />);
  act(() => {
    tokenChainTraceStore.beginTrace({ prompt: "show my balance", provenance: "live-id-jag", mode: "id-jag" });
    tokenChainTraceStore.ingestTokenEvents([
      { id: "pf-id-jag-issued", provider: "pingfederate", provenance: "live-id-jag", mode: "id-jag", status: "active" },
      { id: "pf-id-jag-redeemed", provider: "pingfederate", provenance: "live-id-jag", mode: "id-jag", status: "exchanged" },
    ]);
  });
  expect(screen.getByText("PingFederate ID-JAG", { selector: ".trace-provenance" })).toBeInTheDocument();
  expect(screen.getByTitle("PingFederate ID-JAG issued")).toBeInTheDocument();
});

test("validated PF evidence labels the reel even when beginTrace used the ordinary default", () => {
  render(<TokenChainFilmstrip />);
  act(() => {
    tokenChainTraceStore.beginTrace({ prompt: "show my balance" });
    tokenChainTraceStore.ingestTokenEvents([
      { id: "pf-id-jag-issued", provider: "pingfederate", provenance: "live-id-jag", mode: "id-jag", status: "active" },
      { id: "pf-id-jag-redeemed", provider: "pingfederate", provenance: "live-id-jag", mode: "id-jag", status: "exchanged" },
    ]);
  });
  expect(screen.getByText("PingFederate ID-JAG", { selector: ".trace-provenance" })).toBeInTheDocument();
});

test("the ID-JAG teaching page mounts without loading live trust flags", () => {
  const previousPath = window.location.pathname;
  window.history.replaceState({}, "", "/pingfederate-id-jag/demo");
  try {
    render(<TokenChainFilmstrip />);
    expect(global.fetch).not.toHaveBeenCalled();
  } finally {
    window.history.replaceState({}, "", previousPath);
  }
});

test("a Privilege A2A chain run gets its own intro, not the token-exchange one", () => {
  render(<TokenChainFilmstrip />);
  act(() => {
    tokenChainTraceStore.beginTrace({ prompt: "Refund order 7 (via refunds)" });
    tokenChainTraceStore.ingestTokenEvent({ id: "pa2a-0", kind: "delegate", from: "main", to: "langchainagent", status: "ok" });
  });

  expect(screen.getByText(/sits between every pair of agents/)).toBeInTheDocument();
  expect(screen.queryByText(/Token exchange means/)).not.toBeInTheDocument();
});
