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

// Skeptic findings on PR 3516.
const PAR_ERROR = {
  sim: "par-error", status: 403, errorCode: "par_push_failed", reason: "invalid_client", live: true,
  parRequest: { method: "POST", url: "https://auth.example/par", form: {} },
  parResponse: { error: "par_push_failed", error_description: "invalid_client" },
  tokenChainEvents: [{ id: "par-push", label: "PAR Endpoint Push", status: "error" }],
};
const LIVE_PERMIT = {
  sim: "par-permit", status: 200, errorCode: null, reason: "PERMIT", live: true, requestUri: "urn:x",
  parRequest: { method: "POST", url: "https://auth.example/par", form: {} },
  parResponse: { request_uri: "urn:x", expires_in: 60 },
  tokenChainEvents: [
    { id: "par-push", label: "PAR Endpoint Push", status: "active" },
    { id: "p1az-permit", label: "Amount check — PERMIT (made by this app's backend)", status: "active" },
  ],
};

describe("a failed live PAR push is an error, not a policy DENY", () => {
  test("shows PAR push failed and No decision made, never DENY or a success engine chip", async () => {
    global.fetch.mockResolvedValueOnce(ok(PAR_ERROR));
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /run drift/i }));
    const result = screen.getByTestId("ib-result-drift");
    await within(result).findByText("PAR push failed");
    expect(within(result).getByText("No decision made")).toBeInTheDocument();
    expect(result).toHaveTextContent(/par_push_failed — invalid_client/);
    expect(result).not.toHaveTextContent(/DENY/);
    expect(within(result).queryByText("Live PAR push")).toBeNull();
    expect(result.querySelector(".ib-status--error")).toBeTruthy();
  });

  test("the reel has no Decision frame and the failed run does not advance the primary Run", async () => {
    global.fetch.mockResolvedValueOnce(ok(PAR_ERROR));
    const { container } = renderPage();
    fireEvent.click(runButton("permit"));
    const reel = await screen.findByTestId("ib-reel-permit");
    expect(reel).toHaveTextContent("1 / 2");
    expect(within(reel).queryByRole("button", { name: /decision/i })).toBeNull();
    expect(reel).not.toHaveTextContent(/Decision — DENY/);
    expect(primaries(container)).toEqual([runButton("permit")]);
  });
});

describe("tone follows what was checked", () => {
  test("Expected chips and card edges are neutral before a run, then follow the outcome", async () => {
    global.fetch.mockResolvedValueOnce(ok(PERMIT));
    renderPage();
    for (const kind of ["permit", "drift"]) {
      const col = screen.getByTestId(`ib-col-${kind}`);
      expect(col.className).not.toMatch(/pu-card--(ok|danger)/);
      expect(within(col).getByText(/^Expected: /).className).toContain("pu-chip--neutral");
    }
    fireEvent.click(runButton("permit"));
    await screen.findByText("PERMIT");
    expect(screen.getByTestId("ib-col-permit").className).toMatch(/pu-card--ok/);
    expect(screen.getByTestId("ib-col-drift").className).not.toMatch(/pu-card--(ok|danger)/);
  });
});

describe("wording follows the engine in use", () => {
  test("Simulated mode says the PAR push and request_uri do not happen; Live says what it does", () => {
    renderPage();
    expect(screen.getByTestId("ib-step-3")).toHaveTextContent(/PingOne returns a reference URI/);
    expect(screen.getByTestId("ib-col-permit")).toHaveTextContent(/PingOne stores the pushed request without checking the amount/);
    expect(screen.getByTestId("ib-col-permit")).not.toHaveTextContent(/Steps 3-4 complete/);
    expect(screen.getByTestId("ib-flow")).not.toHaveTextContent(/via Agent Gateway/);
    fireEvent.click(screen.getByTestId("ib-live-toggle"));
    expect(screen.getByTestId("ib-step-2")).toHaveTextContent(/Not made in Simulated mode/);
    expect(screen.getByTestId("ib-step-3")).toHaveTextContent(/Not issued in Simulated mode/);
    expect(screen.getByTestId("ib-step-3")).not.toHaveTextContent(/PingOne returns a reference URI/);
    expect(screen.getByTestId("ib-flow")).toHaveTextContent(/not issued: Simulated/);
    expect(screen.getByTestId("ib-col-drift")).toHaveTextContent(/The simulated run denies it/);
    expect(screen.getByTestId("ib-col-drift")).not.toHaveTextContent(/PingOne still stores/);
  });

  test("a live run does not credit PingOne Authorize with the amount check", async () => {
    global.fetch.mockResolvedValueOnce(ok(LIVE_PERMIT));
    renderPage();
    fireEvent.click(runButton("permit"));
    const result = screen.getByTestId("ib-result-permit");
    await within(result).findByText("PERMIT");
    expect(result).not.toHaveTextContent(/PingOne Authorize/);
    expect(result).toHaveTextContent(/Amount check — PERMIT \(made by this app's backend\)/);
  });
});

describe("notices do not leak across modes or columns", () => {
  test("a 401 on both columns shows one sign-in strip", async () => {
    renderPage();
    const unauth = { ok: false, status: 401, json: async () => ({ error: "authentication_required" }) };
    global.fetch.mockResolvedValueOnce(unauth).mockResolvedValueOnce(unauth);
    fireEvent.click(runButton("permit"));
    await screen.findByRole("alert");
    fireEvent.click(runButton("drift"));
    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(2));
    await screen.findByRole("alert");
    expect(screen.getAllByRole("button", { name: /^sign in$/i })).toHaveLength(1);
  });

  test("flipping the mode clears an earlier error and the sign-in strip", async () => {
    renderPage();
    global.fetch.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: "demo_execution_failed" }) });
    fireEvent.click(runButton("permit"));
    await within(screen.getByTestId("ib-result-permit")).findByText("Error");
    fireEvent.click(screen.getByTestId("ib-live-toggle"));
    expect(within(screen.getByTestId("ib-result-permit")).queryByText("Error")).toBeNull();

    global.fetch.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({}) });
    fireEvent.click(runButton("drift"));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByTestId("ib-live-toggle"));
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("page-scoped CSS", () => {
  test("every ib- selector in the sheet starts at .pu-page.intent-binding-page", () => {
    const fs = require("fs");
    const path = require("path");
    const css = fs.readFileSync(path.join(__dirname, "..", "IntentBindingLearningPage.css"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "");
    const selectors = css.split("}").map((b) => b.split("{")[0]).join(",").split(",").map((x) => x.trim()).filter((x) => x && !x.startsWith("@") && /\.ib-/.test(x));
    expect(selectors.length).toBeGreaterThan(20);
    const bad = selectors.filter((x) => !x.startsWith(".pu-page.intent-binding-page"));
    expect(bad).toEqual([]);
  });
});
