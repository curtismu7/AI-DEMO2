import { render } from "@testing-library/react";
import ExchangeModeToggle from "../ExchangeModeToggle";

vi.mock("../../services/bffAxios", () => ({
  default: { get: vi.fn(() => Promise.resolve({ data: { tokenExchangeMode: "chained" } })) },
}));

test("default renders the token-role table", async () => {
  const { container, findByText } = render(<ExchangeModeToggle />);
  await findByText(/Token Exchange Mode/i);
  expect(container.querySelector(".emt-tokens-table")).not.toBeNull();
});

test("hideTable suppresses the table and security note but keeps the header", async () => {
  const { container, findByText } = render(<ExchangeModeToggle hideTable />);
  await findByText(/Token Exchange Mode/i);
  expect(container.querySelector(".emt-tokens-table")).toBeNull();
  expect(container.querySelector(".emt-note")).toBeNull();
  expect(container.querySelector(".emt-header")).not.toBeNull();
});
