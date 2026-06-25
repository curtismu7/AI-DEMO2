import React from "react";
import { render, waitFor } from "@testing-library/react";
import useAdminSkin from "../useAdminSkin";

function Probe() {
  useAdminSkin();
  return null;
}

const flagsResponse = (value) => ({
  ok: true,
  json: async () => ({ flags: [{ id: "ff_admin_skin_ping2026", value }] }),
});

describe("useAdminSkin", () => {
  afterEach(() => {
    document.body.classList.remove("admin-skin-p1");
    jest.restoreAllMocks();
  });

  it("applies the body class when the flag is on", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(flagsResponse(true));
    render(<Probe />);
    await waitFor(() =>
      expect(document.body.classList.contains("admin-skin-p1")).toBe(true),
    );
  });

  it("removes the body class when the flag is off", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(flagsResponse(false));
    render(<Probe />);
    await waitFor(() =>
      expect(document.body.classList.contains("admin-skin-p1")).toBe(false),
    );
  });

  it("defaults to the new skin when the fetch fails", async () => {
    jest.spyOn(global, "fetch").mockRejectedValue(new Error("network"));
    render(<Probe />);
    await waitFor(() =>
      expect(document.body.classList.contains("admin-skin-p1")).toBe(true),
    );
  });

  it("removes the body class on unmount", async () => {
    jest.spyOn(global, "fetch").mockResolvedValue(flagsResponse(true));
    const { unmount } = render(<Probe />);
    await waitFor(() =>
      expect(document.body.classList.contains("admin-skin-p1")).toBe(true),
    );
    unmount();
    expect(document.body.classList.contains("admin-skin-p1")).toBe(false);
  });
});
