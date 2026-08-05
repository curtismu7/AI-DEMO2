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

test("highlights changed audience and scope claims in the before/after comparison", () => {
  const step = {
    ...STEP_WITH_EVIDENCE,
    detail: {
      ...STEP_WITH_EVIDENCE.detail,
      beforeAfter: {
        before: {
          title: "Before exchange",
          text: '{"aud":["enduser.ping.demo"],"scope":"read write","sub":"user-1"}',
        },
        after: {
          title: "After exchange",
          text: '{"aud":["https://api.ping.demo:3036/mcp"],"scope":"gateway:mcp:invoke","sub":"user-1"}',
        },
      },
    },
  };
  const { container } = render(<TraceStepCard step={step} onInspect={() => {}} defaultOpen />);

  const beforeHighlighted = [...container.querySelectorAll(".tctr-claim-diff--before")]
    .map((element) => element.textContent).join("");
  const afterHighlighted = [...container.querySelectorAll(".tctr-claim-diff--after")]
    .map((element) => element.textContent).join("");

  expect(beforeHighlighted).toContain('"aud":["enduser.ping.demo"]');
  expect(beforeHighlighted).toContain('"scope":"read write"');
  expect(afterHighlighted).toContain('"aud":["https://api.ping.demo:3036/mcp"]');
  expect(afterHighlighted).toContain('"scope":"gateway:mcp:invoke"');
  expect(beforeHighlighted).not.toContain('"sub"');
  expect(afterHighlighted).not.toContain('"sub"');
});

test("renders nested policy statement payloads as readable JSON", () => {
  const step = {
    ...STEP_WITH_EVIDENCE,
    detail: {
      ...STEP_WITH_EVIDENCE.detail,
      kv: [[
        "statements",
        [{
          name: "MCP Tool Authorization Denied",
          payload: '{"denied":true,"message":"Audience validation failed."}',
        }],
      ]],
    },
  };
  const { container } = render(<TraceStepCard step={step} onInspect={() => {}} defaultOpen />);
  const statements = container.querySelector(".tctr-kv-v--json");

  expect(statements).not.toBeNull();
  expect(statements.textContent).toContain('"payload": {');
  expect(statements.textContent).toContain('"denied": true');
  expect(statements.textContent).not.toContain('\\"denied\\"');
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

/** Captures the single HTML string openStepTeachingWindow writes to the popup. */
function popoutHtml(step, useCase) {
  const write = vi.fn();
  const mockWindow = { document: { write, close: vi.fn() }, focus: vi.fn() };
  const openSpy = vi.spyOn(window, "open").mockReturnValue(mockWindow);
  openStepTeachingWindow(step, useCase);
  openSpy.mockRestore();
  return write.mock.calls[0][0];
}

const SPEC = {
  refs: [
    { label: "RFC 8693 §2.1", title: "Token exchange request", href: "https://www.rfc-editor.org/rfc/rfc8693#section-2.1" },
  ],
  mandate: "Posts grant_type=urn:ietf:params:oauth:grant-type:token-exchange with subject_token and actor_token.",
  why: "One token carries both parties, so the resource server sees who acts for whom.",
  failure: "Requesting the same broad scope the user holds keeps the delegation but loses least privilege.",
};

test("pop-out carries the spec citation, the mandate, the rationale and the failure mode", () => {
  const html = popoutHtml({
    ...STEP_WITH_EVIDENCE,
    detail: { ...STEP_WITH_EVIDENCE.detail, spec: SPEC },
  });

  expect(html).toContain("Why it works this way");
  expect(html).toContain("One token carries both parties");
  expect(html).toContain("What the specification requires");
  expect(html).toContain("https://www.rfc-editor.org/rfc/rfc8693#section-2.1");
  expect(html).toContain("RFC 8693 §2.1");
  expect(html).toContain("Token exchange request");
  expect(html).toContain("grant_type=urn:ietf:params:oauth:grant-type:token-exchange");
  expect(html).toContain("Common failure mode");
  expect(html).toContain("loses least privilege");
});

test("pop-out falls back to the short rfcs chips when a step has no spec block", () => {
  const html = popoutHtml({
    ...STEP_WITH_EVIDENCE,
    detail: { ...STEP_WITH_EVIDENCE.detail, rfcs: ["RFC 6749", "RFC 7636"] },
  });
  expect(html).toContain("Specification");
  expect(html).toContain("RFC 6749");
  expect(html).toContain("RFC 7636");
});

test("pop-out names the use case, its expected outcome and the verdict", () => {
  const html = popoutHtml(STEP_WITH_EVIDENCE, {
    id: "UC7",
    useCaseId: "step-up-required",
    title: "Step-up required",
    expectedOutcome: "STEP_UP",
    state: "denied-as-expected",
    vertical: "banking",
    tool: "create_transfer",
    resultText: "Step-up MFA required as expected — then permitted",
  });

  expect(html).toContain("UC7 — Step-up required");
  expect(html).toContain("expected STEP_UP");
  expect(html).toContain("denied-as-expected");
  expect(html).toContain("tool create_transfer");
  expect(html).toContain("Step-up MFA required as expected");
});

test("pop-out omits the use-case banner entirely when no verdict is available", () => {
  const html = popoutHtml(STEP_WITH_EVIDENCE, null);
  expect(html).not.toContain('class="uc"');
});

test("pop-out shows which scopes this hop dropped", () => {
  const html = popoutHtml({
    ...STEP_WITH_EVIDENCE,
    detail: {
      ...STEP_WITH_EVIDENCE.detail,
      scopeDiff: { before: ["banking:read", "banking:write"], after: ["banking:read"] },
    },
  });
  expect(html).toContain("Scope narrowing");
  expect(html).toContain("banking:write (dropped)");
  expect(html).toContain("Scope after this hop: banking:read");
});

test("pop-out deep-formats nested policy statement payloads", () => {
  const html = popoutHtml({
    ...STEP_WITH_EVIDENCE,
    detail: {
      ...STEP_WITH_EVIDENCE.detail,
      kv: [[
        "statements",
        [{ name: "Denied", payload: '{"denied":true,"reason":"invalid_aud"}' }],
      ]],
    },
  });

  expect(html).toContain('"payload":');
  expect(html).toContain('"denied":');
  expect(html).not.toContain('\\"denied\\"');
});

test("pop-out renders the replay payload read-only and never stages a live re-issue", () => {
  const setItem = vi.spyOn(Storage.prototype, "setItem");
  const html = popoutHtml({
    ...STEP_WITH_EVIDENCE,
    detail: {
      ...STEP_WITH_EVIDENCE.detail,
      replay: {
        target: "gateway",
        href: "/agent-gateway-inspector?subtab=tester",
        label: "Replay in Gateway Tester",
        tool: "get_account_balance",
        arguments: { accountId: "acct-1" },
      },
    },
  });

  expect(html).toContain("Re-issuable request");
  expect(html).toContain("get_account_balance");
  expect(html).toContain("acct-1");
  expect(html).toContain("Replay in Gateway Tester");
  // Staging writes a one-shot payload the next inspector visit consumes and
  // FIRES as a live tool call — opening a teaching window must never do that.
  expect(setItem).not.toHaveBeenCalled();
  expect(html).not.toContain("?replay=");
  setItem.mockRestore();
});
