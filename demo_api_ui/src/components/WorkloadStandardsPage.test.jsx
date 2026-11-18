import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import WorkloadStandardsPage from "./WorkloadStandardsPage";

describe("WorkloadStandardsPage", () => {
  const renderPage = () =>
    render(
      <MemoryRouter>
        <WorkloadStandardsPage />
      </MemoryRouter>,
    );

  it("renders the slide headline and subhead", () => {
    renderPage();
    expect(screen.getByRole("heading", { name: /what we build to/i })).toBeInTheDocument();
    expect(screen.getByText(/design to the concepts/i)).toBeInTheDocument();
  });

  it("lists all four standards with their status badges", () => {
    renderPage();
    for (const name of ["SPIFFE", "OIDC", "OAuth", "WIMSE"]) {
      expect(screen.getByRole("row", { name: new RegExp(name, "i") })).toBeInTheDocument();
    }
    expect(screen.getByText(/CNCF Graduated/i)).toBeInTheDocument();
    expect(screen.getByText(/Shipping Widely/i)).toBeInTheDocument();
    expect(screen.getByText(/Stable/i)).toBeInTheDocument();
    expect(screen.getByText(/No RFC Yet/i)).toBeInTheDocument();
  });

  it("marks WIMSE as the not-finished row and keeps the closing line", () => {
    renderPage();
    const wimseRow = screen.getByRole("row", { name: /wimse/i });
    expect(wimseRow.textContent).toMatch(/no rfc yet/i);
    expect(wimseRow.textContent).toMatch(/eight drafts/i);
    expect(screen.getByText(/where a target can federate itself/i)).toBeInTheDocument();
  });
});
