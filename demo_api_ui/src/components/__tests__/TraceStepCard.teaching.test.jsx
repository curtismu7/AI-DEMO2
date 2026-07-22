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

const STEP_NARRATIVE_ONLY = {
  id: "prompt",
  num: 2,
  title: "Chatbot — prompt sent",
  lane: "CHAT",
  status: "pending",
  detail: {
    narrative: "The browser sends only the message — no tokens.",
    rfcs: ["RFC 6749"],
  },
};

test("shows JSON request/response inline and offers Pop out when evidence exists", () => {
  render(
    <TraceStepCard step={STEP_WITH_EVIDENCE} onInspect={() => {}} defaultOpen />,
  );
  expect(screen.getByText(/Why this run:/)).toBeInTheDocument();
  expect(screen.getByText(/delegated token with scope/)).toBeInTheDocument();
  expect(screen.getByText("Exchange request (actual)")).toBeInTheDocument();
  expect(screen.getByText(/"audience"/)).toBeInTheDocument();
  expect(screen.getByText("Delegated token claims")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Pop out full detail/i })).toBeInTheDocument();
});

test("does not offer Pop out when only default narrative text is present", () => {
  render(
    <TraceStepCard step={STEP_NARRATIVE_ONLY} onInspect={() => {}} defaultOpen />,
  );
  expect(screen.getByText(/browser sends only the message/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Pop out full detail/i })).toBeNull();
});

test("large evidence hints to prefer Pop out without hiding the JSON", () => {
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
  expect(screen.getByText(/use Pop out for a bigger view/i)).toBeInTheDocument();
  expect(screen.getByText("Request")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Pop out full detail/i })).toBeInTheDocument();
});
