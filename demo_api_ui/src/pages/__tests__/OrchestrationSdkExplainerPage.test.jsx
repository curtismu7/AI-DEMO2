// The explainer's whole promise is that it teaches correctly in ANY environment,
// including one with no PINGONE_DAVINCI_* config — that is why the first SDK page
// attempt in this repo died on load (REGRESSION_PLAN.md, 2026-09-02). So the
// load-bearing test here is the negative one: zero network calls. Everything else
// is content a reader would notice missing.
//
// mermaid.render() needs real layout measurement, so it is mocked and the diagram
// source is validated with mermaid.parse instead — the pattern from
// TokenChainArchitecturePage.test.jsx.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: "<svg data-testid='osx-svg'></svg>" })),
    parse: vi.fn(async () => true),
  },
}));

import mermaid from "mermaid";
import OrchestrationSdkExplainerPage, { LIFECYCLE_DIAGRAM } from "../OrchestrationSdkExplainerPage";

describe("OrchestrationSdkExplainerPage", () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.reject(new Error("the explainer must not call the network")));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes no network calls at all", async () => {
    render(<OrchestrationSdkExplainerPage />);
    await waitFor(() => expect(mermaid.render).toHaveBeenCalled());
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("renders the diagram through mermaid rather than dumping the source", async () => {
    render(<OrchestrationSdkExplainerPage />);
    await waitFor(() => expect(mermaid.render).toHaveBeenCalled());
    expect(mermaid.render.mock.calls[0][1]).toBe(LIFECYCLE_DIAGRAM);
    await waitFor(() => expect(screen.getByTestId("osx-svg")).toBeTruthy());
  });

  it("shows all three invocation modes, with the SDK one marked as the subject", () => {
    render(<OrchestrationSdkExplainerPage />);
    expect(screen.getByText("Redirect")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
    const sdk = screen.getByText("Orchestration SDK");
    expect(sdk).toBeInTheDocument();
    expect(sdk.closest(".osx-mode")).toHaveClass("is-featured");
  });

  it("links out to both sibling login pages so the comparison is clickable", () => {
    // Scoped to the comparison itself: the "where to go next" list links to the
    // same two routes, so an unscoped query matches twice.
    render(<OrchestrationSdkExplainerPage />);
    const modes = within(document.querySelector(".osx-modes"));
    expect(modes.getByRole("link", { name: "/davinci-login" })).toHaveAttribute(
      "href",
      "/davinci-login",
    );
    expect(modes.getByRole("link", { name: "/davinci-sdk-login" })).toHaveAttribute(
      "href",
      "/davinci-sdk-login",
    );
    // Redirect mode has no page of its own, so it must not render as a link.
    expect(modes.queryByRole("link", { name: /own sign-in/ })).toBeNull();
  });

  it("covers all four collector categories", () => {
    render(<OrchestrationSdkExplainerPage />);
    for (const category of ["Input", "Action", "Display", "Automatic"]) {
      expect(screen.getByRole("heading", { name: category })).toBeInTheDocument();
    }
  });

  it("keeps the developer-depth traps collapsed so an SE can present the page", () => {
    // The audience decision was "both, with the developer detail collapsible".
    // An open <details> would put five paragraphs of API minutiae in front of a
    // presenter who wants the narrative.
    render(<OrchestrationSdkExplainerPage />);
    const traps = document.querySelectorAll("details.osx-trap");
    expect(traps.length).toBe(5);
    for (const trap of traps) expect(trap.open).toBe(false);
  });
});
