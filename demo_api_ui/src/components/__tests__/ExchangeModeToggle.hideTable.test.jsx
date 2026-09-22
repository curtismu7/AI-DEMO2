import { render } from "@testing-library/react";
import ExchangeModeToggle from "../ExchangeModeToggle";

vi.mock("../../services/bffAxios", () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: { tokenExchangeMode: "chained" } })) },
}));

test("default renders the token-role table", async () => {
  const { container } = render(<ExchangeModeToggle />);
  await container.querySelector(".emt-tokens-table");
  expect(container.querySelector(".emt-tokens-table")).not.toBeNull();
  expect(container.querySelector(".emt-label").textContent).toBe("Token Chain");
});

test("hideTable suppresses the table and security note but keeps the header", async () => {
  const { container } = render(<ExchangeModeToggle hideTable />);
  await new Promise((r) => setTimeout(r, 50));
  expect(container.querySelector(".emt-tokens-table")).toBeNull();
  expect(container.querySelector(".emt-label").textContent).toBe("Token Chain");
  expect(container.querySelector(".emt-note")).toBeNull();
  expect(container.querySelector(".emt-header")).not.toBeNull();
  // Embedded token chain starts collapsed (body hidden until header click).
  expect(container.querySelector(".emt-desc-main")).toBeNull();
  expect(container.querySelector(".emt-explainer")).toBeNull();
  expect(container.querySelector(".emt-chevron")?.textContent).toBe("▶");
});
