import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";
import PingFederateIdJagImplementationPage from "../PingFederateIdJagImplementationPage";

const renderPage = () => render(<MemoryRouter><PingFederateIdJagImplementationPage /></MemoryRouter>);

function withLastRun(trace) {
  vi.spyOn(tokenChainTraceStore, "getState").mockReturnValue({ trace, steps: [], history: [] });
  vi.spyOn(tokenChainTraceStore, "subscribe").mockImplementation((fn) => { fn({ trace, steps: [], history: [] }); return () => {}; });
}

afterEach(() => vi.restoreAllMocks());

describe("ID-JAG implementation page", () => {
  it("is the last stop of the learning path", () => {
    renderPage();
    expect(screen.getByTestId("idjag-path")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back: See the protocol" })).toBeInTheDocument();
  });

  it("has a step for every hop through the banking API", () => {
    renderPage();
    expect(screen.getByRole("button", { name: "7 · MCP server → banking API" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "8 · Banking API verifies" })).toBeInTheDocument();
  });

  it("explains a step in plain language when asked", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "4 · Redeem at oauth-mcp" }));
    expect(screen.queryByTestId("idjag-simple")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Explain it simply" }));
    expect(screen.getByTestId("idjag-simple").textContent).toMatch(/visitor sticker/);
  });

  it("shows the real claims from the last run on the issue and redeem steps", () => {
    withLastRun({
      provenance: "live-id-jag",
      tokenEvents: [{ id: "pf-id-jag-issued", claims: { header: { typ: "oauth-id-jag+jwt" }, claims: { iss: "https://pf.test", sub: "demouser", client_id: "ai-demo-pf-user", scope: "mcp:invoke", secret: "must-not-show" } } }],
    });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "3 · PF issues ID-JAG" }));
    const live = screen.getByTestId("idjag-live");
    expect(live.textContent).toContain("ai-demo-pf-user");
    expect(live.textContent).toContain("Decoded from the live token chain");
    expect(live.textContent).not.toContain("must-not-show");
  });

  it("labels a mock replay as mock and says when nothing has run yet", () => {
    withLastRun({ provenance: "mock-id-jag", tokenEvents: [{ id: "pf-id-jag-issued", claims: { sub: "mock-user" } }] });
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: "3 · PF issues ID-JAG" }));
    expect(screen.getByTestId("idjag-live").textContent).toContain("Mock replay");
    fireEvent.click(screen.getByRole("button", { name: "4 · Redeem at oauth-mcp" }));
    expect(screen.getByTestId("idjag-live").textContent).toContain("No run recorded yet");
  });
});
