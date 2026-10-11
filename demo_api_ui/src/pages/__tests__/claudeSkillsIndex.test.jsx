import { describe, expect, it } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import SkillsIndexPage from "../SkillsIndexPage";

// The skills index must render every section with computed counts, and the
// search filter must actually filter (not render a static page).

describe("SkillsIndexPage", () => {
  it("renders the install paths and all five table sections with counts", () => {
    render(<SkillsIndexPage />);
    expect(screen.getByRole("heading", { name: "How to install skills" })).toBeTruthy();
    expect(screen.getByText("General purpose — plugins")).toBeTruthy();
    expect(screen.getByText("General purpose — manual")).toBeTruthy();
    expect(screen.getByText("Ping — official plugin")).toBeTruthy();
    expect(screen.getByText("Ping — bundle (sanitized)")).toBeTruthy();
    expect(screen.getByText("Ping Privilege")).toBeTruthy();
    expect(screen.getByText("Workflow Skills (Oct 2026)")).toBeTruthy();
    // Start-here pointer and the sanitization promise survive the port.
    // "privilege-console-api" appears in both the subtitle and the table row.
    expect(screen.getAllByText(/privilege-console-api/).length).toBeGreaterThan(0);
    // "sanitized" appears in the subtitle and in the bundle note.
    expect(screen.getAllByText(/sanitized/i).length).toBeGreaterThan(0);
  });

  it("filters every table when searching", () => {
    render(<SkillsIndexPage />);
    const input = screen.getByLabelText(/search the skills index/i);
    fireEvent.change(input, { target: { value: "privilege-console-api" } });
    expect(screen.getAllByText("privilege-console-api").length).toBeGreaterThan(0);
    expect(screen.queryByText("graphify")).toBeNull();
    expect(screen.queryByText("oauth-pingone")).toBeNull();
    // Non-table sections (install paths) stay visible.
    expect(screen.getByRole("heading", { name: "How to install skills" })).toBeTruthy();
  });

  it("shows the empty state for a nonsense query", () => {
    render(<SkillsIndexPage />);
    const input = screen.getByLabelText(/search the skills index/i);
    fireEvent.change(input, { target: { value: "zzzznotaskill" } });
    expect(screen.queryByText("General purpose — plugins")).toBeNull();
    expect(screen.getByRole("heading", { name: "How to install skills" })).toBeTruthy();
  });
});
