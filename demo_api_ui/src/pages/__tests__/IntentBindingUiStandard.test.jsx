// /intent-binding-learning on the Ping UI Standard: banner honesty per mode, one primary per state,
// results that keep their own run's facts, and keyboard-safe disabled controls.
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import IntentBindingLearningPage from "../IntentBindingLearningPage";

const PERMIT = {
  status: 200, errorCode: null, reason: "PERMIT", live: false,
  tokenChainEvents: [{ id: "a", label: "Intent Verified", status: "active" }],
};
const DENY = {
  status: 403, errorCode: "rar_amount_exceeded", reason: "DENY", live: false,
  tokenChainEvents: [{ id: "b", label: "Gateway DENY", status: "error" }],
};
const ok = (body) => ({ ok: true, status: 200, json: async () => body });

beforeEach(() => {
  global.fetch = vi.fn();
});

function renderPage() {
  return render(
    <MemoryRouter>
      <IntentBindingLearningPage />
    </MemoryRouter>,
  );
}

const primaries = (container) => [...container.querySelectorAll("button.pu-btn--primary")];
const runButton = (kind) => screen.getByRole("button", { name: new RegExp(`run ${kind}`, "i") });

describe("banner (P2)", () => {
  test("is the first thing on the page, a note, and says what the selected mode does", () => {
    const { container } = renderPage();
    const banner = screen.getByTestId("ib-banner");
    expect(banner).toHaveAttribute("role", "note");
    const page = container.querySelector(".pu-page");
    expect(page.firstElementChild).toBe(banner.closest(".pu-banner-wrap"));
    expect(banner).toHaveTextContent(/LIVE PAR/);
    expect(banner).toHaveTextContent(/PingOne stores the request without checking the amount/);
  });

  test("switches to Simulated wording, with no claim about PingOne, when Live mode is turned off", () => {
    renderPage();
    fireEvent.click(screen.getByTestId("ib-live-toggle"));
    const banner = screen.getByTestId("ib-banner");
    expect(banner).toHaveTextContent(/SIMULATED/);
    expect(banner).toHaveTextContent(/no PAR push is\s+made/);
    expect(banner).not.toHaveTextContent(/LIVE PAR/);
    expect(screen.getByTestId("ib-flow-note")).toHaveTextContent(/local simulator/);
  });
});

describe("one primary button per state (P9)", () => {
  test("Run permit, then Run drift, then Run permit again; never two", async () => {
    const { container } = renderPage();
    expect(primaries(container)).toEqual([runButton("permit")]);

    global.fetch.mockResolvedValueOnce(ok(PERMIT));
    fireEvent.click(runButton("permit"));
    await screen.findByText("PERMIT");
    expect(primaries(container)).toEqual([runButton("drift")]);

    global.fetch.mockResolvedValueOnce(ok(DENY));
    fireEvent.click(runButton("drift"));
    await screen.findByText(/^DENY \(rar_amount_exceeded\)/);
    expect(primaries(container)).toEqual([runButton("permit")]);
  });

  test("after a 401 the sign-in strip owns the one action and no Run is primary", async () => {
    const { container } = renderPage();
    global.fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: "authentication_required" }) });
    fireEvent.click(runButton("permit"));
    await screen.findByText(/needs a signed-in session/i);
    expect(primaries(container)).toEqual([]);
    expect(screen.getByRole("button", { name: /^sign in$/i })).toBeInTheDocument();
  });

  test("the sign-in message names the mode in use: no PAR push is promised in Simulated mode", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("ib-live-toggle"));
    global.fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ error: "authentication_required" }) });
    fireEvent.click(runButton("permit"));
    const strip = await screen.findByRole("alert");
    expect(strip).toHaveTextContent(/simulated decision/);
    expect(strip).not.toHaveTextContent(/PAR push/);
  });
});

describe("a run in flight keeps keyboard focus", () => {
  test("Run takes aria-disabled, not disabled, and a second press does not post again", async () => {
    let release;
    global.fetch.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    renderPage();
    const run = runButton("permit");
    run.focus();
    fireEvent.click(run);
    await waitFor(() => expect(run).toHaveAttribute("aria-disabled", "true"));
    expect(run).not.toBeDisabled();
    expect(document.activeElement).toBe(run);
    fireEvent.click(run);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    release(ok(PERMIT));
    await screen.findByText("PERMIT");
    expect(run).not.toHaveAttribute("aria-disabled");
    expect(document.activeElement).toBe(run);
  });
});

describe("results (P7)", () => {
  test("each result carries words: the outcome and the engine the server says it used", async () => {
    global.fetch
      .mockResolvedValueOnce(ok({ ...PERMIT, live: true }))
      .mockResolvedValueOnce(ok(DENY));
    renderPage();
    fireEvent.click(runButton("permit"));
    const permitResult = screen.getByTestId("ib-result-permit");
    await within(permitResult).findByText("PERMIT");
    expect(within(permitResult).getByText("Live PAR push")).toBeInTheDocument();

    fireEvent.click(runButton("drift"));
    const driftResult = screen.getByTestId("ib-result-drift");
    await within(driftResult).findByText(/^DENY \(rar_amount_exceeded\)/);
    expect(within(driftResult).getByText("Simulated")).toBeInTheDocument();
  });

  test("the result region is a live status region, present before any run", () => {
    renderPage();
    expect(screen.getByTestId("ib-result-permit")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("ib-result-drift")).toHaveAttribute("role", "status");
  });

  test("the reel keeps what the run was sent with, even if Live mode is flipped afterwards", async () => {
    global.fetch.mockResolvedValueOnce(ok({ ...PERMIT, live: false }));
    renderPage();
    fireEvent.click(screen.getByTestId("ib-live-toggle")); // off: simulated
    fireEvent.click(runButton("permit"));
    const reel = await screen.findByTestId("ib-reel-permit");
    expect(reel.textContent).toContain('"live": false');
    fireEvent.click(screen.getByTestId("ib-live-toggle")); // back on, after the run
    fireEvent.change(screen.getAllByRole("spinbutton")[0], { target: { value: "5" } });
    expect(screen.getByTestId("ib-reel-permit").textContent).toContain('"live": false');
    expect(screen.getByTestId("ib-reel-permit").textContent).toContain('"requestedAmount": 80');
  });

  test("the rationale follows the amount typed, not the column name", () => {
    renderPage();
    const col = screen.getByTestId("ib-col-permit");
    expect(col).toHaveTextContent(/\$80 is within the \$100 cap/);
    fireEvent.change(within(col).getByRole("spinbutton"), { target: { value: "250" } });
    expect(col).toHaveTextContent(/\$250 exceeds the \$100 cap/);
  });
});

describe("reel controls", () => {
  test("Prev and Next are aria-disabled at the ends, never disabled, so focus is not lost", async () => {
    global.fetch.mockResolvedValueOnce(ok(PERMIT));
    renderPage();
    fireEvent.click(runButton("permit"));
    const reel = await screen.findByTestId("ib-reel-permit");
    const prev = within(reel).getByRole("button", { name: "Prev" });
    const next = within(reel).getByRole("button", { name: "Next" });
    expect(prev).toHaveAttribute("aria-disabled", "true");
    expect(prev).not.toBeDisabled();
    expect(next).not.toHaveAttribute("aria-disabled");
    next.focus();
    fireEvent.click(next);
    expect(next).toHaveAttribute("aria-disabled", "true");
    expect(document.activeElement).toBe(next);
    expect(reel).toHaveTextContent("2 / 2");
    fireEvent.click(next);
    expect(reel).toHaveTextContent("2 / 2");
  });
});
