import { render, screen } from "@testing-library/react";
import TraceStepCard from "../TraceStepCard";

const STEP_WITH_EVIDENCE = {
  id: "exchange",
  num: 6,
  title: "Token exchange — delegation",
  lane: "BFF",
  status: "done",
  detail: {
    narrative: "BFF exchanges subject + actor for one delegated token.",
    why: "This run issued a delegated token with scope “gateway:mcp:invoke”.",
    request: { title: "Exchange request (actual)", text: '{\n  "audience": "mcpgateway"\n}' },
    response: { title: "Delegated token claims", text: '{\n  "sub": "user-1"\n}' },
  },
};

test("renders why line and keeps evidence collapsed by default", () => {
  const { container } = render(
    <TraceStepCard step={STEP_WITH_EVIDENCE} onInspect={() => {}} defaultOpen />,
  );
  expect(screen.getByText(/Why this run:/)).toBeInTheDocument();
  expect(screen.getByText(/delegated token with scope/)).toBeInTheDocument();
  const evidence = container.querySelector("details.tctr-evidence");
  expect(evidence).toBeTruthy();
  expect(evidence).not.toHaveAttribute("open");
  expect(screen.getByRole("button", { name: /Pop out full detail/i })).toBeInTheDocument();
});

test("evidence summary mentions prefer Pop out when payload is large", () => {
  const big = "x".repeat(700);
  const step = {
    ...STEP_WITH_EVIDENCE,
    detail: {
      ...STEP_WITH_EVIDENCE.detail,
      request: { title: "Request", text: big },
      response: { title: "Response", text: big },
    },
  };
  render(<TraceStepCard step={step} onInspect={() => {}} defaultOpen />);
  expect(screen.getByText(/prefer Pop out/i)).toBeInTheDocument();
});
