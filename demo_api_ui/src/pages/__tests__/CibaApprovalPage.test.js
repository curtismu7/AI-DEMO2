import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import CibaApprovalPage from "../CibaApprovalPage";

describe("CibaApprovalPage", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  function renderAt(search) {
    return render(
      <MemoryRouter initialEntries={[`/ciba-approve${search}`]}>
        <CibaApprovalPage />
      </MemoryRouter>,
    );
  }

  it("renders the pending request's amount and account labels", async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        binding_message: "Approve your banking transaction",
        amount: 600,
        from_account_label: "Checking",
        to_account_label: "Savings",
      }),
    });

    renderAt("?authReqId=sim-abc123");

    expect(await screen.findByText(/\$600/)).toBeInTheDocument();
    expect(screen.getByText(/Checking/)).toBeInTheDocument();
    expect(screen.getByText(/Savings/)).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/ciba/request/sim-abc123"),
      expect.objectContaining({ credentials: "include" }),
    );
  });

  it("shows an expired state on a 410 response", async () => {
    fetch.mockResolvedValueOnce({
      ok: false,
      status: 410,
      json: async () => ({ error: "request_expired" }),
    });

    renderAt("?authReqId=sim-abc123");

    expect(await screen.findByText(/expired/i)).toBeInTheDocument();
  });

  it("Approve calls approve-now and shows an approved result", async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          binding_message: "Approve your banking transaction",
          amount: 600,
          from_account_label: "Checking",
          to_account_label: "Savings",
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    renderAt("?authReqId=sim-abc123");
    await screen.findByText(/\$600/);

    await userEvent.click(screen.getByRole("button", { name: /approve/i }));

    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/auth/ciba/approve-now/sim-abc123"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(await screen.findByText(/approved/i)).toBeInTheDocument();
  });

  it("Deny calls the deny endpoint and shows a denied result", async () => {
    fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          binding_message: "Approve your banking transaction",
          amount: 600,
          from_account_label: "Checking",
          to_account_label: "Savings",
        }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) });

    renderAt("?authReqId=sim-abc123");
    await screen.findByText(/\$600/);

    await userEvent.click(screen.getByRole("button", { name: /deny/i }));

    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining("/api/auth/ciba/deny/sim-abc123"),
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    expect(await screen.findByText(/denied/i)).toBeInTheDocument();
  });
});
