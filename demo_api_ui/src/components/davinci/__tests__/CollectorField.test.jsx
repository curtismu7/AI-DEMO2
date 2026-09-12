// The fixtures below are the shapes a LIVE run actually returned from the
// "PingOne Sign On with Registration, Password Reset and Recovery" flow on
// 2026-09-12 — not invented, and not merely read off the type definitions.
// Its sign-on screen sends exactly five collectors: TextCollector `username`,
// PasswordCollector `password`, SubmitCollector `SIGNON`, and FlowCollectors
// `REGISTER` and `TROUBLE`.
//
// The load-bearing tests are the two silent-failure ones: that a value is
// written through the updater and never by assignment, and that an unknown
// collector renders something visible rather than nothing.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CollectorField, { SUPPORTED_COLLECTORS } from "../CollectorField";

const textCollector = {
  category: "SingleValueCollector",
  type: "TextCollector",
  id: "email-1",
  name: "email",
  error: null,
  input: { key: "email", value: "", type: "TEXT" },
  output: { key: "email", label: "Email", type: "TEXT", value: "" },
};

const validatedTextCollector = {
  ...textCollector,
  category: "ValidatedSingleValueCollector",
  id: "email-2",
  input: { ...textCollector.input, validation: [{ type: "REQUIRED" }] },
};

const passwordCollector = {
  category: "SingleValueCollector",
  type: "PasswordCollector",
  id: "pw-1",
  name: "password",
  error: null,
  input: { key: "password", value: "", type: "PASSWORD" },
  // Note: no output.value — PasswordCollector deliberately omits it.
  output: { key: "password", label: "Password", type: "PASSWORD", verify: false },
};

const submitCollector = {
  category: "ActionCollector",
  type: "SubmitCollector",
  id: "submit-1",
  name: "buttonValue",
  error: null,
  output: { key: "buttonValue", label: "Sign On", type: "SUBMIT_BUTTON" },
};

// Verbatim from a live run against the flow's sign-on screen (2026-09-12):
// FlowCollector carries type FLOW_BUTTON and branches the flow rather than
// submitting the form.
const flowCollector = {
  category: "ActionCollector",
  type: "FlowCollector",
  id: "TROUBLE-4",
  name: "TROUBLE",
  error: null,
  output: { key: "TROUBLE", label: "Having trouble signing on?", type: "FLOW_BUTTON" },
};

describe("CollectorField", () => {
  it("renders a TextCollector as a text input labelled from output.label", () => {
    render(<CollectorField collector={textCollector} value="" onChange={() => {}} />);
    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("type", "text");
  });

  it("renders a PasswordCollector masked", () => {
    render(<CollectorField collector={passwordCollector} value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("reports the typed value upward instead of mutating the collector", () => {
    // The silent-failure guard. SDK state is immer-frozen: assigning to
    // collector.input.value throws nothing, changes nothing, and fails only at
    // submit with an empty field. The component must never write to the
    // collector — it reports the value and the page routes it to the updater.
    const onChange = vi.fn();
    const frozen = Object.freeze({ ...textCollector, input: Object.freeze({ ...textCollector.input }) });
    render(<CollectorField collector={frozen} value="" onChange={onChange} />);

    fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });

    expect(onChange).toHaveBeenCalledWith("ada@example.com");
    expect(frozen.input.value).toBe("");
  });

  it("treats a validated text field by category, not by type", () => {
    // ValidatedTextCollector has type 'TextCollector' with a different
    // category. Switching on type alone silently drops its validation rules.
    render(<CollectorField collector={validatedTextCollector} value="" onChange={() => {}} />);
    expect(screen.getByLabelText("Email")).toHaveAttribute("data-validated", "true");
  });

  it("renders a SubmitCollector as a button that advances the flow", () => {
    const onSubmit = vi.fn();
    render(<CollectorField collector={submitCollector} onSubmit={onSubmit} />);
    const btn = screen.getByRole("button", { name: "Sign On" });
    fireEvent.click(btn);
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("does not offer a value channel for an action collector", () => {
    // ActionCollectors carry no value; CollectorValueType resolves to never.
    const onChange = vi.fn();
    render(<CollectorField collector={submitCollector} onChange={onChange} onSubmit={() => {}} />);
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows a per-field server error against the right field", () => {
    render(
      <CollectorField collector={passwordCollector} value="x" onChange={() => {}} error="Invalid credentials" />,
    );
    const input = screen.getByLabelText("Password");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Invalid credentials")).toBeInTheDocument();
  });

  it("routes a FlowCollector to onFlow, never to onSubmit", () => {
    // A FlowCollector branches the flow (client.flow) instead of submitting
    // this screen. Wiring it to onSubmit would write values and call next(),
    // submitting a half-filled form down the wrong path.
    const onSubmit = vi.fn();
    const onFlow = vi.fn();
    render(<CollectorField collector={flowCollector} onSubmit={onSubmit} onFlow={onFlow} />);

    fireEvent.click(screen.getByRole("button", { name: "Having trouble signing on?" }));

    expect(onFlow).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("renders a VISIBLE fallback for an unsupported collector", () => {
    // The other silent-failure guard: a collector we cannot draw must not
    // render blank, or the flow appears to be missing a field.
    render(<CollectorField collector={{ type: "QrCodeCollector", category: "NoValueCollector" }} />);
    expect(screen.getByText(/Unsupported collector/)).toBeInTheDocument();
    expect(screen.getByText("QrCodeCollector")).toBeInTheDocument();
  });

  it("renders a fallback rather than throwing when the collector is absent", () => {
    render(<CollectorField collector={undefined} />);
    expect(screen.getByText(/Unsupported collector/)).toBeInTheDocument();
  });

  it("declares exactly what it supports, so the page can report honestly", () => {
    expect(SUPPORTED_COLLECTORS).toEqual([
      "TextCollector",
      "PasswordCollector",
      "ValidatedPasswordCollector",
      "SubmitCollector",
      "FlowCollector",
    ]);
  });
});
