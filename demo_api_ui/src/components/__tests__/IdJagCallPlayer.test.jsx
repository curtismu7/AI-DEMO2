import { act, fireEvent, render, screen } from "@testing-library/react";
import { tokenChainTraceStore } from "../../services/tokenChainTrace/tokenChainTraceStore";
import IdJagCallPlayer from "../IdJagCallPlayer";
import { CALLS } from "../../utils/idJagCallSequence";

function withTrace(trace) {
  vi.spyOn(tokenChainTraceStore, "getState").mockReturnValue({ trace, steps: [], history: [] });
  vi.spyOn(tokenChainTraceStore, "subscribe").mockImplementation((fn) => { fn({ trace, steps: [], history: [] }); return () => {}; });
}
const NO_RUN = { tokenEvents: [], provenance: "live" };

beforeEach(() => { try { window.localStorage.clear(); } catch { /* ignore */ } withTrace(NO_RUN); });
afterEach(() => vi.restoreAllMocks());

describe("IdJagCallPlayer", () => {
  it("starts as a movie reel with a card for every call", () => {
    render(<IdJagCallPlayer />);
    expect(screen.getByTestId("idjag-reel")).toBeInTheDocument();
    expect(screen.queryByTestId("idjag-sequence")).toBeNull();
    expect(screen.getAllByRole("button", { name: /^Call \d+:/ })).toHaveLength(CALLS.length);
  });

  it("lets the user pick one view or the other, and remembers it", () => {
    const { unmount } = render(<IdJagCallPlayer />);
    fireEvent.click(screen.getByRole("button", { name: "Sequence diagram" }));
    expect(screen.getByTestId("idjag-sequence")).toBeInTheDocument();
    expect(screen.queryByTestId("idjag-reel")).toBeNull();
    unmount();
    render(<IdJagCallPlayer />);
    expect(screen.getByTestId("idjag-sequence")).toBeInTheDocument();
  });

  it("shows every call as a row in the sequence diagram", () => {
    render(<IdJagCallPlayer />);
    fireEvent.click(screen.getByRole("button", { name: "Sequence diagram" }));
    expect(screen.getAllByRole("button", { name: /^Call \d+:/ })).toHaveLength(CALLS.length);
  });

  it("steps and selects calls, updating the detail", () => {
    render(<IdJagCallPlayer />);
    expect(screen.getByTestId("idjag-call-detail").textContent).toContain("Start the live run");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByTestId("idjag-call-detail").textContent).toContain("Sign in");
    fireEvent.click(screen.getByRole("button", { name: "Call 12: Verify, then mint" }));
    expect(screen.getByTestId("idjag-call-detail").textContent).toContain("The ID-JAG is spent");
    expect(screen.getByText("Call 12 of 19")).toBeInTheDocument();
  });

  it("plays through the calls on a timer and stops at the end", () => {
    vi.useFakeTimers();
    render(<IdJagCallPlayer speedMs={100} />);
    fireEvent.click(screen.getByRole("button", { name: "Simulate" }));
    // each step schedules the next from an effect, so advance one tick per call
    for (let i = 0; i < CALLS.length; i += 1) act(() => { vi.advanceTimersByTime(100); });
    expect(screen.getByText(`Call ${CALLS.length} of ${CALLS.length}`)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Simulate" })).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("shows the request, mock tokens and standards for every call, and resets", () => {
    render(<IdJagCallPlayer />);
    fireEvent.click(screen.getByRole("button", { name: "Call 8: Ask for an ID-JAG" }));
    const wire = screen.getByTestId("idjag-call-wire");
    expect(wire.textContent).toContain("requested_token_type=urn:ietf:params:oauth:token-type:id-jag");
    expect(wire.textContent).toContain("MOCK, teaching values only");
    expect(screen.getByTestId("idjag-call-refs").textContent).toContain("emerging");
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(screen.getByText(`Call 1 of ${CALLS.length}`)).toBeInTheDocument();
  });

  it("says plainly when a hop was not traced", () => {
    render(<IdJagCallPlayer />);
    fireEvent.click(screen.getByRole("button", { name: "Call 14: Check and route" }));
    expect(screen.getByTestId("idjag-call-detail").textContent).toMatch(/Not traced/);
  });

  it("shows real claims on the issue call after a run, only the allowed fields", () => {
    withTrace({ provenance: "live-id-jag", tokenEvents: [{ id: "pf-id-jag-issued", claims: { claims: { sub: "demouser", client_id: "ai-demo-pf-user", password: "nope" } } }] });
    render(<IdJagCallPlayer />);
    fireEvent.click(screen.getByRole("button", { name: "Call 8: Ask for an ID-JAG" }));
    const live = screen.getByTestId("idjag-call-live");
    expect(live.textContent).toContain("Real claims from your last run");
    expect(live.textContent).toContain("ai-demo-pf-user");
    expect(live.textContent).not.toContain("nope");
  });

  it("labels mock claims as mock and says when nothing has run", () => {
    withTrace({ provenance: "mock-id-jag", tokenEvents: [{ id: "pf-id-jag-issued", claims: { sub: "mock-user" } }] });
    render(<IdJagCallPlayer />);
    fireEvent.click(screen.getByRole("button", { name: "Call 8: Ask for an ID-JAG" }));
    expect(screen.getByTestId("idjag-call-live").textContent).toContain("Mock replay claims");
    fireEvent.click(screen.getByRole("button", { name: "Call 12: Verify, then mint" }));
    expect(screen.queryByTestId("idjag-call-live")).toBeNull();
    expect(screen.getByTestId("idjag-call-detail").textContent).toContain("No run recorded yet");
  });
});
