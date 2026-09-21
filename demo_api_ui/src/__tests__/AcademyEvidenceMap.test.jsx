import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import AcademyEvidenceMap from "../components/learning/AcademyEvidenceMap";
import { getLesson } from "../learning/lessonCatalog";

describe("AcademyEvidenceMap", () => {
  it("shows the five company maturity stages and the product ownership map", () => {
    render(
      <MemoryRouter>
        <AcademyEvidenceMap lesson={getLesson("authorize")} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("heading", { name: "Evidence timeline" })).toBeInTheDocument();
    expect(screen.getByText("Discover")).toBeInTheDocument();
    expect(screen.getByText("Register")).toBeInTheDocument();
    expect(screen.getByText("Authenticate")).toBeInTheDocument();
    expect(screen.getByText("Authorize")).toBeInTheDocument();
    expect(screen.getByText("Govern")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Ping product map" })).toBeInTheDocument();
    expect(screen.getByText("Agent Gateway / Broker")).toBeInTheDocument();
    expect(screen.getByText("PingOne Authorize")).toBeInTheDocument();
  });
});
