import { render, screen, act } from "@testing-library/react";
import SequenceReelDiagram from "../SequenceReelDiagram";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";
import { createMockIdJagTrace } from "../../utils/idJagMockTrace";

beforeEach(() => {
  tokenChainTraceStore.reset();
  localStorage.clear();
});

test("sequence diagram labels mock replay and draws only mock ID-JAG hops", () => {
  render(<SequenceReelDiagram slowMode={false} />);
  act(() => tokenChainTraceStore.replayTrace(createMockIdJagTrace()));
  expect(screen.getAllByText("Mock replay", { selector: ".trace-provenance" }).length).toBeGreaterThan(0);
  expect(screen.getByRole("img", { name: /Mock replay sequence diagram/i })).toBeInTheDocument();
  expect(screen.getByText(/Mock replay — ID-JAG issued/)).toBeInTheDocument();
  expect(screen.getByText(/Mock replay — ID-JAG redeemed/)).toBeInTheDocument();
});

test("sequence diagram draws native PF hops only in a PF ID-JAG run", () => {
  render(<SequenceReelDiagram slowMode={false} />);
  act(() => tokenChainTraceStore.beginTrace({ prompt: "ordinary request" }));
  expect(screen.queryByText(/PingFederate ID-JAG issued/)).not.toBeInTheDocument();
  act(() => {
    tokenChainTraceStore.beginTrace({ prompt: "show my balance", provenance: "live-id-jag", mode: "id-jag" });
    tokenChainTraceStore.ingestTokenEvents([
      { id: "pf-id-jag-issued", provider: "pingfederate", provenance: "live-id-jag", mode: "id-jag", status: "active" },
      { id: "pf-id-jag-redeemed", provider: "pingfederate", provenance: "live-id-jag", mode: "id-jag", status: "exchanged" },
    ]);
  });
  expect(screen.getAllByText("PingFederate ID-JAG", { selector: ".trace-provenance" }).length).toBeGreaterThan(0);
  expect(screen.getByText(/PingFederate ID-JAG issued/)).toBeInTheDocument();
  expect(screen.getAllByText("PINGFEDERATE").length).toBeGreaterThan(0);
  expect(document.querySelector(".srd-lane-pingfederate")).not.toBeNull();
});
