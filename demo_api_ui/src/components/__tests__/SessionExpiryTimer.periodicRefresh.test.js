// Regression guard for the orphaned-component fix (TECH_DEBT 2026-08-18
// honourable mentions): the mount-time fetch used to run ONCE (`useEffect`
// deps `[]`, no interval), so a session extended by a SILENT token refresh
// was never picked up — `expiresAt` stayed pinned to the value read at
// mount, and the header would eventually render "Expired" against a session
// that was actually still live. It now polls on the same 30s cadence the
// countdown itself already re-renders on.

import React from "react";
import { act, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import bffAxios from "../../services/bffAxios";
import { getCachedJson } from "../../services/cachedStatusService";
import SessionExpiryTimer from "../SessionExpiryTimer";

vi.mock("../../services/bffAxios", () => ({
  __esModule: true,
  default: { get: vi.fn(), post: vi.fn(() => Promise.resolve({ data: {} })) },
}));
vi.mock("../../services/cachedStatusService", () => ({
  getCachedJson: vi.fn(),
}));

describe("SessionExpiryTimer — periodic refresh", () => {
  beforeEach(() => {
    bffAxios.get.mockReset().mockResolvedValue({ data: { tokenEvents: [] } });
    getCachedJson.mockReset().mockResolvedValue({ data: {} });
  });

  it("re-fetches on a 30s interval, not just once at mount", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render(
        <MemoryRouter initialEntries={["/dashboard"]}>
          <SessionExpiryTimer />
        </MemoryRouter>,
      );
      await waitFor(() => expect(bffAxios.get).toHaveBeenCalledTimes(1));

      await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
      await waitFor(() => expect(bffAxios.get).toHaveBeenCalledTimes(2));

      await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
      await waitFor(() => expect(bffAxios.get).toHaveBeenCalledTimes(3));
    } finally {
      vi.useRealTimers();
    }
  });

  it("a session extended by a silent refresh is no longer reported as Expired after the old value's window passes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const soonExpiry = Math.floor(Date.now() / 1000) + 20; // expires in 20s
      const laterExpiry = Math.floor(Date.now() / 1000) + 3600; // refreshed: 1h out
      bffAxios.get
        .mockResolvedValueOnce({
          data: { tokenEvents: [{ id: "user-token", decoded: { payload: { exp: soonExpiry } } }] },
        })
        .mockResolvedValue({
          data: { tokenEvents: [{ id: "user-token", decoded: { payload: { exp: laterExpiry } } }] },
        });

      const { container } = render(
        <MemoryRouter initialEntries={["/dashboard"]}>
          <SessionExpiryTimer />
        </MemoryRouter>,
      );
      await waitFor(() => expect(bffAxios.get).toHaveBeenCalledTimes(1));

      // Past the FIRST expiry, but the poll (30s) has re-fetched the extended
      // value by then — the mount-once version would show "Expired" here.
      await act(async () => { await vi.advanceTimersByTimeAsync(30000); });
      await waitFor(() => expect(bffAxios.get).toHaveBeenCalledTimes(2));

      expect(container.textContent).not.toMatch(/Expired/);
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears the interval on unmount (no leaked timer / no post-unmount state update)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const { unmount } = render(
        <MemoryRouter initialEntries={["/dashboard"]}>
          <SessionExpiryTimer />
        </MemoryRouter>,
      );
      await waitFor(() => expect(bffAxios.get).toHaveBeenCalledTimes(1));

      unmount();
      const callsAtUnmount = bffAxios.get.mock.calls.length;
      await act(async () => { await vi.advanceTimersByTimeAsync(120000); });
      expect(bffAxios.get.mock.calls.length).toBe(callsAtUnmount);
    } finally {
      vi.useRealTimers();
    }
  });
});
