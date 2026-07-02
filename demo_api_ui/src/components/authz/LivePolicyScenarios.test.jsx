import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, test, expect, vi, beforeEach } from "vitest";

vi.mock("../../services/apiClient", () => ({
  default: { post: vi.fn() },
}));

import apiClient from "../../services/apiClient";
import LivePolicyScenarios from "./LivePolicyScenarios";

describe("LivePolicyScenarios", () => {
  beforeEach(() => apiClient.post.mockReset());

  test("renders the 5 real-policy scenario cards", () => {
    render(<LivePolicyScenarios configured />);
    expect(screen.getByText("Small transfer")).toBeInTheDocument();
    expect(screen.getByText("Consent required")).toBeInTheDocument();
    expect(screen.getByText("Step-up required")).toBeInTheDocument();
    expect(screen.getByText("Step-up satisfied by MFA")).toBeInTheDocument();
    expect(screen.getByText("Denied")).toBeInTheDocument();
  });

  test("not configured: shows notice and disables Run buttons", () => {
    render(<LivePolicyScenarios configured={false} />);
    expect(screen.getByText(/isn.t configured yet/i)).toBeInTheDocument();
    for (const b of screen.getAllByRole("button", { name: /Run live/i })) expect(b).toBeDisabled();
  });

  test("Run live posts force-live and renders the decision", async () => {
    apiClient.post.mockResolvedValue({ data: { ok: true, engine: "pingone", decision: "DENY", stepUpRequired: false, consentRequired: false, raw: {} } });
    render(<LivePolicyScenarios configured />);
    // the "Denied" ($2500) card
    const denyCard = screen.getByText("Denied").closest(".lps-card");
    fireEvent.click(denyCard.querySelector("button"));
    await waitFor(() => expect(screen.getByText("DENY")).toBeInTheDocument());
    const [, body] = apiClient.post.mock.calls[0];
    expect(body).toMatchObject({ amount: 2500, type: "transfer", live: true });
  });
});
