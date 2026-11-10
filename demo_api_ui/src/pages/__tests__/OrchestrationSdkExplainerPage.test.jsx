// The explainer's whole promise is that it teaches correctly in ANY environment,
// including one with no PINGONE_DAVINCI_* config — that is why the first SDK page
// attempt in this repo died on load (REGRESSION_PLAN.md, 2026-09-02). So the
// load-bearing test here is the negative one: zero network calls. Everything else
// is content a reader would notice missing.
//
// The lifecycle diagram is drawn with React Flow, which needs ResizeObserver in jsdom
// (same stub A2AFlowVisualizer.test.jsx uses); its source is checked with expectDrawable.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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

  it("gives the lifecycle diagram Simulate, Reset and step-time controls", () => {
    render(<OrchestrationSdkExplainerPage />);
    // pingStyle StaticFlowDiagram draws its own Simulate bar just above the diagram group
    const bar = screen.getByTestId("osx-lifecycle-diagram-steps");
    expect(within(bar).getByText("Simulate")).toBeTruthy();
    expect(within(bar).getByText("Reset")).toBeTruthy();
    expect(within(bar).getByText("Step time:")).toBeTruthy();
  });

  it("shows all three invocation modes, with the SDK one marked as the subject", () => {
    const { container } = render(<OrchestrationSdkExplainerPage />);
    // Scoped to the comparison: the family switcher also has a "Widget" link.
    const modes = within(container.querySelector(".osx-modes"));
    expect(modes.getByText("Redirect")).toBeInTheDocument();
    expect(modes.getByText("Widget")).toBeInTheDocument();
    const sdk = modes.getByText("Orchestration SDK");
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

  describe("Ping UI Standard", () => {
    it("opens with a role=note banner that says the page is static and what is simulated", () => {
      const { container } = render(<OrchestrationSdkExplainerPage />);
      const root = container.querySelector(".pu-page.osx-page");
      expect(root).toBeTruthy();
      const banner = within(root).getByRole("note");
      expect(banner).toHaveAttribute("data-testid", "osx-banner");
      expect(root.firstElementChild).toContainElement(banner);
      // Honest copy: nothing live here, the diagram is a drawn sequence, the demos make the real calls.
      expect(banner.textContent).toMatch(/Static lesson/);
      expect(banner.textContent).toMatch(/Simulate steps through a drawn sequence, not a live flow/);
      // Not an unconditional promise: the live pages only run the real flow where DaVinci is set up.
      expect(banner.textContent).toMatch(/real flows when DaVinci is configured/);
      expect(banner.textContent).not.toMatch(/run the real flows\./);
      // The banner comes before the title band.
      const h1 = screen.getByRole("heading", { level: 1 });
      expect(banner.compareDocumentPosition(h1) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it("does not promise a real flow without the setup it needs, next to the primary link either", () => {
      const { container } = render(<OrchestrationSdkExplainerPage />);
      const note = container.querySelector(".osx-cta-note");
      expect(note.textContent).toMatch(/when DaVinci is configured/i);
    });

    it("lets the primary link's note wrap a long value inside a narrow column", () => {
      const css = readFileSync(resolve(__dirname, "../OrchestrationSdkExplainerPage.css"), "utf8");
      const rule = css.match(/\.osx-page \.osx-cta-note\s*\{[^}]*\}/)[0];
      expect(rule).toMatch(/overflow-wrap:\s*anywhere/);
    });

    it("has exactly one primary: the live SDK login, a link that takes the shared primary class", () => {
      const { container } = render(<OrchestrationSdkExplainerPage />);
      const primaries = container.querySelectorAll(".pu-btn--primary");
      expect(primaries).toHaveLength(1);
      expect(primaries[0].tagName).toBe("A");
      expect(primaries[0]).toHaveAttribute("href", "/davinci-orchestration-sdk");
    });

    it("labels every section by its h2 and keeps one h1 and no second main", () => {
      const { container } = render(<OrchestrationSdkExplainerPage />);
      const sections = container.querySelectorAll(".pu-frame > section");
      expect(sections.length).toBe(7);
      for (const section of sections) {
        const id = section.getAttribute("aria-labelledby");
        expect(id).toBeTruthy();
        expect(section.querySelector(`h2#${id}`)).toBeTruthy();
      }
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
      expect(container.querySelector("main")).toBeNull();
    });

    it("shows each mode and category as a card with a key-value list, and the subject chip carries a word", () => {
      const { container } = render(<OrchestrationSdkExplainerPage />);
      expect(container.querySelectorAll(".osx-modes > .pu-card .pu-kv")).toHaveLength(3);
      expect(container.querySelectorAll(".osx-cat.pu-card .pu-kv")).toHaveLength(4);
      const chips = container.querySelectorAll(".pu-chip");
      expect(chips).toHaveLength(1);
      expect(chips[0].textContent.trim()).toBe("Subject of this lesson");
      expect(chips[0].closest(".osx-mode")).toHaveClass("is-featured");
    });
  });
});
