import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import SeatMapPanel from "../SeatMapPanel";

const SEATS = [
  { seat: "1A", cabin: "business", available: true },
  { seat: "1B", cabin: "business", available: false },
  { seat: "6A", cabin: "economy", available: true },
  { seat: "6B", cabin: "economy", available: true },
];

describe("SeatMapPanel", () => {
  it("renders one seat cell per row entry, grouped by cabin", () => {
    render(<SeatMapPanel flightNumber="UA328" seats={SEATS} />);
    expect(screen.getByText("business")).toBeInTheDocument();
    expect(screen.getByText("economy")).toBeInTheDocument();
    expect(screen.getAllByTestId("seat-cell")).toHaveLength(4);
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
