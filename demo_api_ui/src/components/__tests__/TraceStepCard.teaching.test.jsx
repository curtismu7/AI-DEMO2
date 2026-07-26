import { render, screen, fireEvent } from "@testing-library/react";
import { vi } from "vitest";
import TraceStepCard, { openStepTeachingWindow } from "../TraceStepCard";
import { EducationUIProvider, useEducationUI } from "../../context/EducationUIContext";

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

function EduProbe() {
  const { panel, tab } = useEducationUI();
  return <div data-testid="edu-probe">{panel || ""}:{tab || ""}</div>;
}

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

test("Learn more opens the education drawer when moreDetail.edu is set", () => {
  const step = {
    ...STEP_WITH_EVIDENCE,
    detail: {
      ...STEP_WITH_EVIDENCE.detail,
      moreDetail: { edu: "token-exchange", tab: "why", label: "Learn: Token Exchange (RFC 8693)" },
    },
  };
  render(
    <EducationUIProvider>
      <EduProbe />
      <TraceStepCard step={step} onInspect={() => {}} defaultOpen />
    </EducationUIProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: /Learn: Token Exchange/i }));
  expect(screen.getByTestId("edu-probe").textContent).toBe("token-exchange:why");
});

test("openStepTeachingWindow includes before/after evidence and more detail links", () => {
  const write = vi.fn();
  const close = vi.fn();
  const focus = vi.fn();
  const mockWindow = { document: { write, close }, focus };
  const openSpy = vi.spyOn(window, "open").mockReturnValue(mockWindow);

  const step = {
    ...STEP_WITH_EVIDENCE,
    detail: {
      ...STEP_WITH_EVIDENCE.detail,
      beforeAfter: {
        before: { title: "Before exchange", text: '{"scope":"read write"}' },
        after: { title: "After exchange", text: '{"scope":"write"}' },
      },
      moreDetail: { href: "https://example.com/more", label: "Show more detail" },
    },
  };

  openStepTeachingWindow(step);

  expect(openSpy).toHaveBeenCalled();
  expect(write).toHaveBeenCalledWith(expect.stringContaining("Before exchange"));
  expect(write).toHaveBeenCalledWith(expect.stringContaining("After exchange"));
  expect(write).toHaveBeenCalledWith(expect.stringContaining("Show more detail"));

  openSpy.mockRestore();
});
