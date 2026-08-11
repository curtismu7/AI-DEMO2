import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import ProductCardGrid from "../ProductCardGrid";

const PRODUCTS = [
  { id: "p1", name: "Trail Runner Hiking Boots", icon: "boots", price: 129.99, priceWas: 149.99, rating: 4.6, reviewCount: 312, stock: "In stock" },
  { id: "p2", name: "65L Trekking Backpack", icon: "backpack", price: 189, rating: 4.8, reviewCount: 94, stock: "In stock" },
];

const BRANCHES = [
  { id: "branch-austin-main", name: "Super Banking Main Branch", city: "Austin", state: "TX", address: "100 Congress Ave, Austin, TX 78701", hours: "Mon–Fri 9:00–17:00, Sat 10:00–14:00", atm: true },
];

describe("ProductCardGrid", () => {
  it("renders a product card and fires onAction with the tool + productId on click", () => {
    const onAction = vi.fn();
    render(<ProductCardGrid kind="products" title="Gear" items={PRODUCTS} onAction={onAction} />);
    expect(screen.getByText("Trail Runner Hiking Boots")).toBeInTheDocument();
    expect(screen.getByText("$129.99")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Add to Cart" })[0]);
    expect(onAction).toHaveBeenCalledWith("add_to_cart", { productId: "p1" });
  });

  it("renders a location card with a real maps link and no onAction call", () => {
    const onAction = vi.fn();
    render(<ProductCardGrid kind="locations" title="Branches" items={BRANCHES} onAction={onAction} />);
    expect(screen.getByText("Super Banking Main Branch")).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "Get Directions" });
    expect(link).toHaveAttribute(
      "href",
      "https://www.google.com/maps/search/?api=1&query=100%20Congress%20Ave%2C%20Austin%2C%20TX%2078701",
    );
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener");
    fireEvent.click(link);
    expect(onAction).not.toHaveBeenCalled();
  });
});
