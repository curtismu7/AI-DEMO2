// The explainer's whole promise is that it teaches correctly in ANY environment,
// including one with no PINGONE_DAVINCI_* config — that is why the first SDK page
// attempt in this repo died on load (REGRESSION_PLAN.md, 2026-09-02). So the
// load-bearing test here is the negative one: zero network calls. Everything else
// is content a reader would notice missing.
//
// The lifecycle diagram is drawn with React Flow, which needs ResizeObserver in jsdom
// (same stub A2AFlowVisualizer.test.jsx uses); its source is checked with expectDrawable.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { expectDrawable } from "../../utils/__tests__/diagramSource";
import OrchestrationSdkExplainerPage, { LIFECYCLE_DIAGRAM } from "../OrchestrationSdkExplainerPage";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
window.ResizeObserver = window.ResizeObserver || ResizeObserverStub;

describe("OrchestrationSdkExplainerPage", () => {
  let fetchSpy;

  beforeEach(() => {
    fetchSpy = vi.fn(() => Promise.reject(new Error("the explainer must not call the network")));
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("makes no network calls at all", () => {
    render(<OrchestrationSdkExplainerPage />);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("draws the lifecycle as a React Flow sequence rather than dumping the source", () => {
    expectDrawable(LIFECYCLE_DIAGRAM);
    render(<OrchestrationSdkExplainerPage />);
    expect(screen.getByRole("group", { name: "DaVinci SDK client lifecycle" })).toBeTruthy();
    expect(document.querySelector(".react-flow")).toBeTruthy();
  });

  it("shows all three invocation modes, with the SDK one marked as the subject", () => {
    render(<OrchestrationSdkExplainerPage />);
    expect(screen.getByText("Redirect")).toBeInTheDocument();
    expect(screen.getByText("Widget")).toBeInTheDocument();
    const sdk = screen.getByText("Orchestration SDK");
    expect(sdk).toBeInTheDocument();
    expect(sdk.closest(".osx-mode")).toHaveClass("is-featured");
  });

  it("offers the live SDK login before anything else", () => {
    // Regression: the page opened with the three-mode comparison, whose Widget
    // card links out — so the first click from a page named "Orchestration SDK"
    // went to the widget, and the SDK's own UI was the one thing not offered.
    render(<OrchestrationSdkExplainerPage />);
    const cta = screen.getByRole("link", { name: /Open the live SDK login/ });
    expect(cta).toHaveAttribute("href", "/davinci-orchestration-sdk");

    // And it must come before the comparison in document order.
    const modes = document.querySelector(".osx-modes");
    expect(cta.compareDocumentPosition(modes) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("links out to both sibling login pages so the comparison is clickable", () => {
    // Scoped to the comparison itself: the "where to go next" list links to the
    // same two routes, so an unscoped query matches twice.
    render(<OrchestrationSdkExplainerPage />);
    const modes = within(document.querySelector(".osx-modes"));
    expect(modes.getByRole("link", { name: "/davinci-widget" })).toHaveAttribute(
      "href",
      "/davinci-widget",
    );
    expect(modes.getByRole("link", { name: "/davinci-orchestration-sdk" })).toHaveAttribute(
      "href",
      "/davinci-orchestration-sdk",
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
