import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import VerticalResult from "../VerticalResult";

describe("VerticalResult productGrid branch", () => {
  it("renders a ProductCardGrid and forwards the click to onAction", () => {
    const onAction = vi.fn();
    const descriptor = { type: "productGrid", title: "Gear for Your Next Hike" };
    const data = { products: [{ id: "prod-boots", name: "Trail Runner Hiking Boots", icon: "boots", price: 129.99, rating: 4.6, reviewCount: 312, stock: "In stock" }] };
    render(<VerticalResult descriptor={descriptor} data={data} onAction={onAction} />);
    expect(screen.getByText("Trail Runner Hiking Boots")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Add to Cart" }));
    expect(onAction).toHaveBeenCalledWith("add_to_cart", { productId: "prod-boots" });
  });
});
