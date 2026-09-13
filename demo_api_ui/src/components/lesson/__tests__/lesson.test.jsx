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
