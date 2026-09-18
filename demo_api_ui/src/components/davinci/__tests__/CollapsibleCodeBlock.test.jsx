import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import CollapsibleCodeBlock from "../CollapsibleCodeBlock";

describe("CollapsibleCodeBlock", () => {
  it("starts closed, toggles from its native summary, and preserves the supplied source", () => {
    const code = "const response = await client.next();";
    const { container } = render(<CollapsibleCodeBlock title="Advance the flow" code={code} />);
    const disclosure = container.querySelector("details");

    expect(disclosure).not.toHaveAttribute("open");
    expect(screen.getByText("Show code: Advance the flow")).toBeInTheDocument();
    expect(screen.getByText(code)).toBeInTheDocument();

    fireEvent.click(screen.getByText("Show code: Advance the flow"));
    expect(disclosure).toHaveAttribute("open");

    fireEvent.click(screen.getByText("Show code: Advance the flow"));
    expect(disclosure).not.toHaveAttribute("open");
  });

  it("opens initially when requested", () => {
    const { container } = render(<CollapsibleCodeBlock title="Open sample" code="client.start()" defaultOpen />);

    expect(container.querySelector("details")).toHaveAttribute("open");
  });
});
