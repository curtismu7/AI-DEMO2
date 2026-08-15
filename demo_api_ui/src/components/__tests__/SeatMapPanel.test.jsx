import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SeatMapPanel from "../SeatMapPanel";

// Real cabin values (demo_mcp_resource_server/seed/airlines.seed.json) carry
// spaces and airline-specific names — "business"/"economy" were fabricated
// placeholders that never matched real data.
const SEATS = [
  { seat: "1A", cabin: "United First", available: true },
  { seat: "1B", cabin: "United First", available: false },
  { seat: "6A", cabin: "Economy", available: true },
  { seat: "6B", cabin: "Economy", available: true },
];

describe("SeatMapPanel", () => {
  it("renders one seat cell per row entry, grouped by cabin", () => {
    render(<SeatMapPanel flightNumber="UA328" seats={SEATS} />);
    expect(screen.getByText("United First")).toBeInTheDocument();
    expect(screen.getByText("Economy")).toBeInTheDocument();
    expect(screen.getAllByTestId("seat-cell")).toHaveLength(4);
  });

  it("slugifies a multi-word cabin name into its CSS class", () => {
    render(<SeatMapPanel flightNumber="UA328" seats={SEATS} />);
    const seat = screen.getByRole("button", { name: "1A" });
    expect(seat.className).toContain("smp-seat--united-first");
  });

  it("clicking an available seat updates the summary bar; occupied seats are not clickable", () => {
    render(<SeatMapPanel flightNumber="UA328" seats={SEATS} />);
    expect(screen.getByText(/Pick a seat/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "6A" }));
    expect(screen.getByText(/6A/)).toBeInTheDocument();
    const occupied = screen.getByRole("button", { name: "1B" });
    expect(occupied).toBeDisabled();
  });
});
