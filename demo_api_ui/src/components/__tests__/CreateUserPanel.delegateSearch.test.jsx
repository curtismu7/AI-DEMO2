/**
 * searchDelegate swallowed any GET /api/users/search/:q error with
 * `catch { setDelegateResults([]); }` -- the same empty array a genuine
 * zero-match search produces, with no signal distinguishing the two.
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";

const bffGet = vi.fn();
vi.mock("../../services/bffAxios", () => ({
  default: { get: (...a) => bffGet(...a) },
}));

import CreateUserPanel from "../CreateUserPanel";

function renderPanel() {
  return render(
    <MemoryRouter>
      <CreateUserPanel onClose={vi.fn()} onCreated={vi.fn()} />
    </MemoryRouter>,
  );
}

async function enableDelegationAndSearch(query) {
  fireEvent.click(screen.getByLabelText(/Enable delegation/i));
  const input = screen.getByPlaceholderText(/Search PingOne users/i);
  fireEvent.change(input, { target: { value: query } });
}

beforeEach(() => {
  bffGet.mockReset();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

describe("CreateUserPanel — delegate search failure vs zero-match", () => {
  it("shows a search-failed message, not a silent empty dropdown, when the search errors", async () => {
    bffGet.mockRejectedValue(new Error("network down"));
    renderPanel();
    await enableDelegationAndSearch("ana");

    await vi.advanceTimersByTimeAsync(400);
    await waitFor(() => expect(screen.getByText(/Search failed/i)).toBeInTheDocument());
  });

  it("clears the search-failed message once a later search succeeds", async () => {
    bffGet
      .mockRejectedValueOnce(new Error("network down"))
      .mockResolvedValueOnce({ data: { users: [{ id: "u1", firstName: "Ana", lastName: "Lee", email: "ana@example.com" }] } });
    renderPanel();
    await enableDelegationAndSearch("ana");
    await vi.advanceTimersByTimeAsync(400);
    await waitFor(() => expect(screen.getByText(/Search failed/i)).toBeInTheDocument());

    const input = screen.getByPlaceholderText(/Search PingOne users/i);
    fireEvent.change(input, { target: { value: "ana2" } });
    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() => expect(screen.getByText(/ana@example.com/i)).toBeInTheDocument());
    expect(screen.queryByText(/Search failed/i)).not.toBeInTheDocument();
  });

  it("does not show the search-failed message for a genuine zero-match result", async () => {
    bffGet.mockResolvedValue({ data: { users: [] } });
    renderPanel();
    await enableDelegationAndSearch("zzz");
    await vi.advanceTimersByTimeAsync(400);

    await waitFor(() => expect(bffGet).toHaveBeenCalled());
    expect(screen.queryByText(/Search failed/i)).not.toBeInTheDocument();
  });
});
