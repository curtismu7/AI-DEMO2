// The fixtures below are the shapes a LIVE run actually returned from the
// "PingOne Sign On with Registration, Password Reset and Recovery" flow on
// 2026-09-12 — not invented, and not merely read off the type definitions.
// Its sign-on screen sends exactly five collectors: TextCollector `username`,
// PasswordCollector `password`, SubmitCollector `SIGNON`, and FlowCollectors
// `REGISTER` and `TROUBLE`.
//
// The load-bearing tests are the silent-failure ones: that values reach the SDK
// through the updater rather than by assignment, that an updater rejection is
// surfaced, and that an unknown collector renders something visible.
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CollectorField, { SUPPORTED_COLLECTORS } from "../CollectorField";

const textCollector = {
  category: "SingleValueCollector",
  type: "TextCollector",
  id: "username-0",
  name: "username",
  error: null,
  input: { key: "username", value: "", type: "TEXT" },
  output: { key: "username", label: "Username", type: "TEXT", value: "" },
};

const validatedTextCollector = {
  ...textCollector,
  category: "ValidatedSingleValueCollector",
  id: "username-v",
  input: { ...textCollector.input, validation: [{ type: "REQUIRED" }] },
};

const passwordCollector = {
  category: "SingleValueCollector",
  type: "PasswordCollector",
  id: "password-1",
  name: "password",
  error: null,
  input: { key: "password", value: "", type: "PASSWORD" },
  // No output.value — PasswordCollector deliberately omits it. `verify` marks
  // the confirm half of a password pair.
  output: { key: "password", label: "Password", type: "PASSWORD", verify: false },
};

const submitCollector = {
  category: "ActionCollector",
  type: "SubmitCollector",
  id: "SIGNON-2",
  name: "SIGNON",
  error: null,
  output: { key: "SIGNON", label: "Sign On", type: "SUBMIT_BUTTON" },
};

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
    render(<CollectorField collector={textCollector} updater={() => null} />);
    expect(screen.getByLabelText("Username")).toHaveAttribute("type", "text");
  });

  it("renders a PasswordCollector masked", () => {
    render(<CollectorField collector={passwordCollector} updater={() => null} />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("writes through the updater and never mutates the collector", () => {
    // The silent-failure guard. SDK state is immer-frozen: assigning to
    // collector.input.value throws nothing, changes nothing, and fails only at
    // submit with an empty field. The updater is the only write path.
    const updater = vi.fn(() => null);
    const frozen = Object.freeze({
      ...textCollector,
      input: Object.freeze({ ...textCollector.input }),
    });
    render(<CollectorField collector={frozen} updater={updater} />);

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "ada" } });

    expect(updater).toHaveBeenCalledWith("ada");
    expect(frozen.input.value).toBe("");
  });

  it("surfaces an updater rejection immediately, not at submit", () => {
    // update() returns null on success or an internal_error object. Ignoring it
    // discards the SDK's only report that the write did not land.
    const updater = vi.fn(() => ({ error: { message: "Value not allowed" }, type: "internal_error" }));
    render(<CollectorField collector={textCollector} updater={updater} />);

    fireEvent.change(screen.getByLabelText("Username"), { target: { value: "!!" } });

    expect(screen.getByText("Value not allowed")).toBeInTheDocument();
    expect(screen.getByLabelText("Username")).toHaveAttribute("aria-invalid", "true");
  });

  it("marks a validated text field by category, not by type", () => {
    // ValidatedTextCollector has type 'TextCollector' with a different
    // category. Switching on type alone silently drops its validation rules.
    render(<CollectorField collector={validatedTextCollector} updater={() => null} />);
    expect(screen.getByLabelText("Username")).toHaveAttribute("data-validated", "true");
  });

  it("renders a SubmitCollector as a button that advances the flow", () => {
    const onSubmit = vi.fn();
    render(<CollectorField collector={submitCollector} onSubmit={onSubmit} />);
    fireEvent.click(screen.getByRole("button", { name: "Sign On" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("gives an action collector no input and no updater", () => {
    // ActionCollectors carry no value; CollectorValueType resolves to never.
    render(<CollectorField collector={submitCollector} onSubmit={() => {}} />);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("shows a per-field server error against the right field", () => {
    render(<CollectorField collector={passwordCollector} updater={() => null} serverError="Invalid credentials" />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Invalid credentials")).toBeInTheDocument();
  });

  it("routes a FlowCollector to onFlow, never to onSubmit", () => {
    // A FlowCollector branches the flow (client.flow) instead of submitting
    // this screen. Wiring it to onSubmit would submit the form down the wrong
    // path.
    const onSubmit = vi.fn();
    const onFlow = vi.fn();
    render(<CollectorField collector={flowCollector} onSubmit={onSubmit} onFlow={onFlow} />);

    fireEvent.click(screen.getByRole("button", { name: "Having trouble signing on?" }));

    expect(onFlow).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("uses new-password autocomplete for the verify half of a password pair", () => {
    const verify = { ...passwordCollector, output: { ...passwordCollector.output, verify: true } };
    render(<CollectorField collector={verify} updater={() => null} />);
    expect(screen.getByLabelText("Password")).toHaveAttribute("autocomplete", "new-password");
  });

  it("seeds its displayed value from collector.input.value", () => {
    // Half of the stale-value fix found by driving the live flow. The field
    // shows what the SDK holds; the page supplies the other half by folding a
    // step counter into the React key, so consecutive screens that reuse a
    // collector id (the flow's sign-on and enter-username screens both send
    // `username-0`) remount instead of keeping the previous screen's state.
    const prefilled = {
      ...textCollector,
      input: { ...textCollector.input, value: "carried-forward" },
    };
    render(<CollectorField collector={prefilled} updater={() => null} />);
    expect(screen.getByLabelText("Username")).toHaveValue("carried-forward");
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
