import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PrivilegeDocsIndexPage from "../PrivilegeDocsIndexPage";

// Smoke + data-contract checks for the Drive-first docs index rewrite.
describe("PrivilegeDocsIndexPage", () => {
  it("renders sections with computed counts and the Drive-first subtitle", () => {
    render(<PrivilegeDocsIndexPage />);
    expect(screen.getByRole("heading", { name: /Privilege documentation index/i })).toBeTruthy();
    // Section label appears in both the TOC chip and the section heading.
    expect(screen.getAllByText(/Demos & environments/).length).toBeGreaterThan(0);
    // The Drive-folder phrase appears in the subtitle and the legend note.
    expect(screen.getAllByText(/shared Google Drive folder/).length).toBeGreaterThan(0);
    // Counts are computed from data (the source HTML's "56" header was stale;
    // the demos table follows the canonical MD). The numbers interpolate into
    // separate text nodes, so match on the subtitle's full textContent.
    const sub = screen.getByText(/Every Privilege doc we own/);
    expect(sub.textContent).toMatch(/\d+ documents across 10 sections/);
  });

  it("links doc titles at Drive and keeps the repo path as reference", () => {
    render(<PrivilegeDocsIndexPage />);
    const a2a = screen.getAllByRole("link", { name: "A2A demo & setup" })[0];
    expect(a2a.getAttribute("href")).toMatch(/^https:\/\/drive\.google\.com\/file\/d\//);
    expect(screen.getAllByText(/A2A-DEMO-AND-SETUP-OUR-ENVIRONMENT\.md/).length).toBeGreaterThan(0);
  });

  it("filters by title and shows the empty state", () => {
    render(<PrivilegeDocsIndexPage />);
    const input = screen.getByLabelText(/search the privilege documentation index/i);
    fireEvent.change(input, { target: { value: "policies in depth" } });
    expect(screen.getAllByText("Policies in depth").length).toBeGreaterThan(0);
    expect(screen.queryByText("Sensor on Docker (guide)")).toBeNull();
    fireEvent.change(input, { target: { value: "zzzznodoc" } });
    expect(screen.getByText(/No documents match/)).toBeTruthy();
  });
});
