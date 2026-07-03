import { render } from "@testing-library/react";
import TraceStepCard from "../TraceStepCard";

const STEP = { id: "mcp", title: "MCP server — tool executes", lane: "MCP",
  status: "done", detail: { narrative: "did a thing" } };

test("defaultOpen renders the card expanded", () => {
  const { container } = render(<TraceStepCard step={STEP} onInspect={() => {}} defaultOpen />);
  expect(container.querySelector("details.tctr-step")).toHaveAttribute("open");
});

test("without defaultOpen the card is collapsed", () => {
  const { container } = render(<TraceStepCard step={STEP} onInspect={() => {}} />);
  expect(container.querySelector("details.tctr-step")).not.toHaveAttribute("open");
});
