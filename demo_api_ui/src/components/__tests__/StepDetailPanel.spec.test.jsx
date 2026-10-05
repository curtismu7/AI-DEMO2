import { act, render, screen } from "@testing-library/react";
import StepDetailPanel from "../StepDetailPanel";

const STEP = {
  id: "pa2a-1-gateway",
  title: "Checks key, scope, policy and guardrail",
  lane: "GATEWAY",
  status: "done",
  detail: {
    narrative: "The gateway checked the call.",
    kv: [["Scope", "a2a"]],
    rfcs: ["A2A message/send"],
    spec: {
      refs: [{ label: "A2A specification", href: "https://a2a-protocol.org/latest/specification/", title: "A2A" }],
      mandate: "A2A leaves authentication to the HTTP layer.",
      why: "The gateway is that intermediary.",
      failure: "Assuming every caller is screened.",
    },
  },
};

const setRfcInfo = (on) => act(() => { window.dispatchEvent(new CustomEvent("agent-rfc-info-toggle", { detail: { on } })); });

test("the specification notes show only with RFC info on, with a link to the source", () => {
  render(<StepDetailPanel step={STEP} />);
  setRfcInfo(false);
  expect(screen.queryByText("A2A leaves authentication to the HTTP layer.")).toBeNull();

  setRfcInfo(true);
  expect(screen.getByText("The gateway is that intermediary.")).toBeInTheDocument();
  expect(screen.getByText("A2A leaves authentication to the HTTP layer.")).toBeInTheDocument();
  expect(screen.getByText("Assuming every caller is screened.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "A2A specification" })).toHaveAttribute("href", "https://a2a-protocol.org/latest/specification/");
  // The links replace the plain chips, so a reference is not listed twice.
  expect(screen.queryByText("A2A message/send")).toBeNull();
});

test("a step with references but no spec block still shows its chips", () => {
  render(<StepDetailPanel step={{ ...STEP, detail: { narrative: "x", rfcs: ["RFC 8693"] } }} />);
  setRfcInfo(true);
  expect(screen.getByText("RFC 8693")).toBeInTheDocument();
});
