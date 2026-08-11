import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import VerticalResult from "../VerticalResult";

describe("VerticalResult seatMap branch", () => {
  it("renders a SeatMapPanel from real seat data", () => {
    const descriptor = { type: "seatMap" };
    // "United Polaris" — a real cabin value from
    // demo_mcp_resource_server/seed/airlines.seed.json, not a fabricated one.
    const data = { flightNumber: "UA328", seats: [{ seat: "1A", cabin: "United Polaris", available: true }] };
    render(<VerticalResult descriptor={descriptor} data={data} />);
    expect(screen.getByText("United Polaris")).toBeInTheDocument();
  });
});
