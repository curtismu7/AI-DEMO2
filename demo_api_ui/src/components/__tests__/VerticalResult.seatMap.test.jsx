import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import VerticalResult from "../VerticalResult";

describe("VerticalResult seatMap branch", () => {
  it("renders a SeatMapPanel from real seat data", () => {
    const descriptor = { type: "seatMap" };
    const data = { flightNumber: "UA328", seats: [{ seat: "1A", cabin: "business", available: true }] };
    render(<VerticalResult descriptor={descriptor} data={data} />);
    expect(screen.getByText("business")).toBeInTheDocument();
  });
});
