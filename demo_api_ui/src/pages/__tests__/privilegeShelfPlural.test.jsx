import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

// One feature on the first page, none elsewhere: the chip must read "1 feature", not "1 features".
vi.mock("../../data/privilegeFeatures.json", () => ({ default: [{ id: "only-one", page: "identity" }] }));
import PrivilegeShelfPage from "../PrivilegeShelfPage";
import { PRIVILEGE_MAP_PAGES } from "../../config/privilegeMapPages";

describe("PrivilegeShelfPage counts", () => {
  it("says '1 feature' for a single feature and '0 features' for none", () => {
    render(<MemoryRouter><PrivilegeShelfPage /></MemoryRouter>);
    const region = screen.getByRole("region", { name: "Privilege Map" });
    expect(within(region).getByText("1 feature")).toBeTruthy();
    expect(within(region).queryByText("1 features")).toBeNull();
    expect(within(region).getAllByText("0 features").length).toBe(PRIVILEGE_MAP_PAGES.length - 1);
  });
});
