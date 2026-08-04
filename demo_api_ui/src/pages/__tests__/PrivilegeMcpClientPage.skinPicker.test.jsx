// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.skinPicker.test.jsx
// The costume picker in the Privilege client titlebar must persist the pick and
// navigate straight to that costume's live shell — no intermediate page.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";
import { readMockSelection } from "../../components/aiFootprintMocks/mockSelection";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

beforeEach(() => {
  navigate.mockClear();
  localStorage.clear();
  global.fetch = vi.fn(() => new Promise(() => {}));
  global.EventSource = class {
    addEventListener() {}
    close() {}
  };
});

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
  return screen.getByRole("combobox");
}

describe("Privilege MCP client costume picker", () => {
  it("defaults to the Cursor IDE page and lists every costume variant", () => {
    const select = renderPage();
    expect(select).toHaveValue("");
    expect(screen.getByRole("option", { name: "Cursor IDE (this page)" })).toBeInTheDocument();
    // 4 categories x 3 variants + the default option
    expect(screen.getAllByRole("option")).toHaveLength(13);
  });

  it("selecting a costume persists the pick and loads that shell immediately", () => {
    const select = renderPage();
    fireEvent.change(select, { target: { value: "chatgpt:web" } });
    expect(readMockSelection().chatgpt).toBe("web");
    expect(navigate).toHaveBeenCalledWith("/demo/chatgpt-desktop");
  });

  it("selecting the default option stays put", () => {
    const select = renderPage();
    fireEvent.change(select, { target: { value: "" } });
    expect(navigate).not.toHaveBeenCalled();
  });
});
