// The shared lesson shell. Both DaVinci lessons build on these props, so the
// contract is what is pinned here: Copy copies the exact sample, the nav scrolls
// to the section id it names, and Status never claims success it was not given.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor, screen } from "@testing-library/react";

vi.mock("mermaid", () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: "<svg data-testid='lesson-svg'></svg>" })),
  },
}));

import mermaid from "mermaid";
import {
  CodeBlock,
  LessonLayout,
  MermaidFigure,
  OnThisRun,
  Section,
  Status,
  TableBlock,
} from "..";

describe("CodeBlock", () => {
  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("copies exactly the sample it shows", async () => {
    const code = 'const node = await client.flow({ action: "TROUBLE" })();';
    render(<CodeBlock title="Branch" code={code} />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(code));
    expect(await screen.findByRole("button", { name: "Copied" })).toBeTruthy();
    expect(screen.getByText(code)).toBeTruthy();
  });

  it("says the copy failed instead of claiming it worked", async () => {
    navigator.clipboard.writeText.mockRejectedValue(new Error("denied"));
    render(<CodeBlock title="Branch" code="x" />);

    fireEvent.click(screen.getByRole("button", { name: "Copy" }));

    expect(await screen.findByRole("button", { name: "Copy failed" })).toBeTruthy();
  });
});

describe("LessonLayout", () => {
  it("renders one nav entry per section and scrolls to the id it names", () => {
    const scrollIntoView = vi.fn();
    render(
      <LessonLayout
        title="Lesson"
        sections={[
          { id: "try-it-live", label: "Try It Live" },
          { id: "pi-flow", label: "pi.flow" },
        ]}
      >
        <Section id="try-it-live" title="Try It Live" />
        <Section id="pi-flow" title="pi.flow" />
      </LessonLayout>,
    );
    document.getElementById("pi-flow").scrollIntoView = scrollIntoView;

    const nav = screen.getByRole("navigation", { name: "Lesson sections" });
    fireEvent.click(nav.querySelector("button:nth-child(2)"));

    expect(scrollIntoView).toHaveBeenCalled();
    expect(nav.querySelector("button:nth-child(2)").getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("heading", { level: 1, name: "Lesson" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "pi.flow" })).toBeTruthy();
  });
});

describe("TableBlock, Status, OnThisRun, MermaidFigure", () => {
  it("renders headers and cells", () => {
    render(<TableBlock headers={["Field", "Collector"]} rows={[["TEXT username", "TextCollector"]]} />);
    expect(screen.getByRole("columnheader", { name: "Collector" })).toBeTruthy();
    expect(screen.getByRole("cell", { name: "TextCollector" })).toBeTruthy();
  });

  it("marks ok and not-ok distinctly", () => {
    const { container } = render(
      <OnThisRun>
        <Status ok>pi.flow</Status>
        <Status ok={false}>query</Status>
      </OnThisRun>,
    );
    expect(container.querySelector(".lesson-run-title").textContent).toBe("On this run");
    expect(container.querySelector(".lesson-ok").textContent).toBe("✓ pi.flow");
    expect(container.querySelector(".lesson-warn").textContent).toBe("⚠️ query");
  });

  it("draws the diagram source it is given", async () => {
    render(<MermaidFigure source={"sequenceDiagram\n  A->>B: hi"} label="The flow" />);
    await waitFor(() => expect(mermaid.render).toHaveBeenCalled());
    expect(mermaid.render.mock.calls.at(-1)[1]).toBe("sequenceDiagram\n  A->>B: hi");
    expect(screen.getByRole("figure", { name: "The flow" })).toBeTruthy();
  });
});

describe("Export PDF (a customer handout)", () => {
  const lesson = (props = {}) => (
    <LessonLayout title="Lesson" sections={[{ id: "overview", label: "Overview" }]} {...props}>
      <Section id="try-it-live" title="Try It Live" />
      <Section id="overview" title="Overview" />
      <Section id="in-this-repo" title="In This Repo" />
    </LessonLayout>
  );

  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
  });

  it("prints in the light theme under a Ping Identity file name, then puts both back", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    document.title = "App";
    let themeWhilePrinting = null;
    let titleWhilePrinting = null;
    window.print = vi.fn(() => {
      themeWhilePrinting = document.documentElement.getAttribute("data-theme");
      titleWhilePrinting = document.title;
    });
    render(lesson());

    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(window.print).toHaveBeenCalledTimes(1);
    expect(themeWhilePrinting).toBe("light");
    // "Save as PDF" suggests document.title as the file name.
    expect(titleWhilePrinting).toBe("Ping Identity – Lesson");
    window.dispatchEvent(new Event("afterprint"));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.title).toBe("App");
  });

  it("restores theme and title at once if printing throws", () => {
    document.documentElement.setAttribute("data-theme", "dark");
    document.title = "App";
    window.print = vi.fn(() => {
      throw new Error("printing blocked");
    });
    render(lesson());

    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));

    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(document.title).toBe("App");
  });

  it("returns to the system theme when the viewer had none set", () => {
    window.print = vi.fn();
    render(lesson());

    fireEvent.click(screen.getByRole("button", { name: "Export PDF" }));
    window.dispatchEvent(new Event("afterprint"));

    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("leaves Try It Live and In This Repo out of the printout by default", () => {
    const { container } = render(lesson());
    expect(container.querySelector("#try-it-live").classList.contains("lesson-no-print")).toBe(true);
    expect(container.querySelector("#in-this-repo").classList.contains("lesson-no-print")).toBe(true);
    expect(container.querySelector("#overview").classList.contains("lesson-no-print")).toBe(false);
  });

  it("prints every section when a lesson asks for no exclusions", () => {
    const { container } = render(lesson({ printExclude: [] }));
    expect(container.querySelectorAll(".lesson-no-print")).toHaveLength(0);
  });

  it("carries Ping Identity branding and the copyright and trademark notice", () => {
    const { container } = render(lesson());
    // Text, not the repo's placeholder "P" badge image.
    expect(container.querySelector(".lesson-print-wordmark").textContent).toBe("Ping Identity");
    expect(container.querySelector(".lesson-print-brand img")).toBeNull();
    const legal = container.querySelector(".lesson-print-legal").textContent;
    expect(legal).toMatch(/Copyright © \d{4} Ping Identity Corporation\. All rights reserved\./);
    expect(legal).toContain("trademarks or registered trademarks of Ping Identity Corporation");
  });

  it("puts the legal notice in every printed page's footer only while a lesson is mounted", () => {
    const printRule = () => document.head.querySelector("style[data-lesson-print]");
    const { unmount } = render(lesson());

    const css = printRule()?.textContent || "";
    expect(css).toContain("@page");
    expect(css).toContain("@bottom-center");
    expect(css).toMatch(/Copyright © \d{4} Ping Identity Corporation\. All rights reserved\./);
    expect(css).toContain("trademarks or registered trademarks of Ping Identity Corporation");

    // @page is global, so it must not outlive the lesson.
    unmount();
    expect(printRule()).toBeNull();
  });
});
