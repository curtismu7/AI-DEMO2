import { render, screen, fireEvent, act } from "@testing-library/react";
import TokenChainFilmstrip from "../TokenChainFilmstrip";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";

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
