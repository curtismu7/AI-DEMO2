import React from "react";
import { render, waitFor } from "@testing-library/react";
import useAdminSkin from "../useAdminSkin";

function Probe() {
  useAdminSkin();
  return null;
}

// The flag-on / flag-off / fetch-failed cases are gone with the flag: there is
// one admin skin now, so the hook has nothing to decide. What is still worth
// pinning is that the class goes on, comes off on unmount, and that no network
// call is involved — a fetch here would reintroduce the failure mode the flag
// version had, where a slow or failed response left the admin chrome unstyled.
describe("useAdminSkin", () => {
  afterEach(() => {
    document.body.classList.remove("admin-skin-p1");
    jest.restoreAllMocks();
  });

  it("applies the body class unconditionally", async () => {
    render(<Probe />);
    await waitFor(() =>
      expect(document.body.classList.contains("admin-skin-p1")).toBe(true),
    );
  });

  it("does not fetch feature flags", () => {
    const fetchSpy = jest.spyOn(global, "fetch");
    render(<Probe />);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("removes the body class on unmount", async () => {
    const { unmount } = render(<Probe />);
    await waitFor(() =>
      expect(document.body.classList.contains("admin-skin-p1")).toBe(true),
    );
    unmount();
    expect(document.body.classList.contains("admin-skin-p1")).toBe(false);
  });
});
