/**
 * ElicitationDialog regression tests.
 *
 * Bug #57 (reverse tabnabbing): URL-mode "Open in Browser" must open the
 * MCP-supplied URL with `noopener,noreferrer` so the opened page cannot reach
 * back through `window.opener` and navigate this banking tab.
 *
 * Bug #58 (NaN -> null to BFF): a non-required number field cleared to empty
 * (parseFloat('') === NaN) used to pass validation and JSON-encode to null on
 * submit. It must now be rejected client-side and never reach onSubmit.
 */
import "@testing-library/jest-dom";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import React from "react";
import ElicitationDialog from "../ElicitationDialog";

describe("ElicitationDialog — submit-error display (finding #33)", () => {
  it("shows the error message in form mode when the error prop is set", () => {
    render(
      <ElicitationDialog
        elicitation={{ mode: "form", message: "Enter", requestedSchema: { properties: {}, required: [] } }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        error="Failed to send your response. Please try again."
      />
    );
    expect(screen.getByText(/failed to send your response/i)).toBeInTheDocument();
  });

  it("renders nothing extra when there is no error", () => {
    render(
      <ElicitationDialog
        elicitation={{ mode: "form", message: "Enter", requestedSchema: { properties: {}, required: [] } }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
      />
    );
    expect(screen.queryByText(/failed to send/i)).not.toBeInTheDocument();
  });

  it("shows the error message in URL mode when the error prop is set", () => {
    render(
      <ElicitationDialog
        elicitation={{ mode: "url", message: "Authorize", url: "https://example.com" }}
        onSubmit={vi.fn()}
        onCancel={vi.fn()}
        error="Failed to send your response. Please try again."
      />
    );
    expect(screen.getByText(/failed to send your response/i)).toBeInTheDocument();
  });
});

describe("ElicitationDialog — URL mode (Bug #57 reverse tabnabbing)", () => {
  it("opens the URL with noopener,noreferrer", async () => {
    const url = "https://evil-mcp.example.com/authorize?x=1";
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);

    render(
      <ElicitationDialog
        elicitation={{ mode: "url", message: "Authorize", url }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /open in browser/i }));

    await waitFor(() => expect(openSpy).toHaveBeenCalledTimes(1));
    expect(openSpy).toHaveBeenCalledWith(url, "_blank", "noopener,noreferrer");

    openSpy.mockRestore();
  });
});

describe("ElicitationDialog — form mode number field (Bug #58 NaN->null)", () => {
  const numberSchema = {
    properties: { amount: { type: "number", description: "Amount" } },
    required: [],
  };

  it("rejects a cleared non-required number field and does NOT submit null", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ElicitationDialog
        elicitation={{ mode: "form", message: "Enter", requestedSchema: numberSchema }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    const input = screen.getByLabelText(/amount/i);
    // Enter a value, then clear it back to empty (the parseFloat('') === NaN case).
    fireEvent.change(input, { target: { value: "5" } });
    fireEvent.change(input, { target: { value: "" } });

    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

    // Client-side rejection: validation error shown, onSubmit never fired,
    // so `amount: null` can never reach the BFF.
    expect(await screen.findByText(/amount must be a valid number/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("submits a valid number as a number (no regression, no null)", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ElicitationDialog
        elicitation={{ mode: "form", message: "Enter", requestedSchema: numberSchema }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: "42" } });
    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    expect(onSubmit).toHaveBeenCalledWith({ action: "accept", content: { amount: 42 } });
    expect(typeof onSubmit.mock.calls[0][0].content.amount).toBe("number");
  });

  it("still enforces required-presence (existing behavior preserved)", async () => {
    const onSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <ElicitationDialog
        elicitation={{
          mode: "form",
          message: "Enter",
          requestedSchema: {
            properties: { amount: { type: "number", description: "Amount" } },
            required: ["amount"],
          },
        }}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /^submit$/i }));

    expect(await screen.findByText(/amount is required/i)).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});
