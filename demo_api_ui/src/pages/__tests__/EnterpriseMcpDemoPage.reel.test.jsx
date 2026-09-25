import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import EnterpriseMcpDemoPage from "../EnterpriseMcpDemoPage";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";
import { clearIdJagRunState } from "../../utils/idJagRunMode";

vi.mock("../../context/TokenChainContext", () => ({
  useTokenChainOptional: () => ({ clearEvents: vi.fn() }),
}));
vi.mock("../../context/ProofOfEnforcementContext", () => ({
  useProofOfEnforcementOptional: () => null,
}));
vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));
vi.mock("../../components/ClaimDetailsModal", () => ({ default: () => null }));
vi.mock("../../components/TokenLegendModal", () => ({ default: () => null }));

const previousPath = window.location.pathname;
beforeEach(() => {
  tokenChainTraceStore.reset();
  clearIdJagRunState();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState({}, "", "/pingfederate-id-jag/demo");
});
afterEach(() => {
  window.history.replaceState({}, "", previousPath);
  vi.unstubAllGlobals();
});

it("shows the shared mock movie reel and inspectable replay steps without a live request", () => {
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  render(<EnterpriseMcpDemoPage />);

  act(() => fireEvent.click(screen.getByRole("button", { name: "Run mock demo" })));

  const reel = screen.getByRole("region", { name: "Token chain" });
  expect(reel).toHaveTextContent("Mock replay");
  expect(screen.getByTitle("Mock replay — ID-JAG issued")).toBeInTheDocument();
  expect(screen.getByTitle("Mock replay — ID-JAG redeemed")).toBeInTheDocument();
  expect(fetchSpy).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTitle("Mock replay — ID-JAG issued"));
  expect(screen.getByRole("region", { name: "Step detail" })).toHaveTextContent(/sample issuance/i);
  fireEvent.click(screen.getByTitle("Chatbot — prompt sent"));
  const promptDetail = screen.getByRole("region", { name: "Step detail" });
  expect(promptDetail).toHaveTextContent("Sample prompt (replay)");
  expect(promptDetail).not.toHaveTextContent("Request (actual)");
  expect(promptDetail).not.toHaveTextContent("POST /api/agent/run");

  act(() => tokenChainTraceStore.ingestTokenEvent({ id: "late-live", status: "active" }));
  expect(screen.getByTitle("Mock replay — ID-JAG issued")).toBeInTheDocument();
  expect(reel).not.toHaveTextContent("late-live");
});
