// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.skinPicker.test.jsx
// The costume picker persists the pick and navigates to that shell's route.
// The client page itself no longer carries the picker (it navigates to
// protected /demo/* routes which require a logged-in user; removed to prevent
// the redirect-to-home crash). Only the live shells host the picker now.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import FootprintLiveShellPage from "../FootprintLiveShellPage";
import { readMockSelection } from "../../components/aiFootprintMocks/mockSelection";

const navigate = vi.fn();
vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return { ...actual, useNavigate: () => navigate };
});

vi.mock("../../services/apiClient", () => ({
  default: {
    get: vi.fn(() => new Promise(() => {})),
    post: vi.fn(() => new Promise(() => {})),
  },
}));

beforeEach(() => {
  navigate.mockClear();
  localStorage.clear();
  global.fetch = vi.fn(() => new Promise(() => {}));
  global.EventSource = class {
    addEventListener() {}
    close() {}
  };
});

function renderShell(category = "coding") {
  render(
    <MemoryRouter initialEntries={[`/demo/${category}`]}>
      <FootprintLiveShellPage category={category} />
    </MemoryRouter>,
  );
  return screen.getByRole("combobox");
}

describe("costume picker inside a live shell", () => {
  it("shows the costume currently being worn", () => {
    localStorage.setItem(
      "ai-footprint-mock-selection-v1",
      JSON.stringify({ coding: "cursor" }),
    );
    expect(renderShell("coding")).toHaveValue("coding:cursor");
  });

  it("switches to another costume without backing out", () => {
    fireEvent.change(renderShell("coding"), { target: { value: "saas:glean" } });
    expect(readMockSelection().saas).toBe("glean");
    expect(navigate).toHaveBeenCalledWith("/demo/saas-embedded?v=glean");
  });

  it("returns to the client page via the default option", () => {
    fireEvent.change(renderShell("coding"), { target: { value: "" } });
    expect(navigate).toHaveBeenCalledWith("/privilege-mcp-client");
  });
});
