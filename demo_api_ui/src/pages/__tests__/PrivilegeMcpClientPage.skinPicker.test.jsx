// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.skinPicker.test.jsx
// The costume picker must persist the pick and navigate straight to that
// costume's live shell — from the client page AND from inside a shell, so a
// skin can be swapped without backing out first.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";
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

function renderClientPage() {
  render(
    <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
  return screen.getByRole("combobox");
}

function renderShell(category = "coding") {
  render(
    <MemoryRouter initialEntries={[`/demo/${category}`]}>
      <FootprintLiveShellPage category={category} />
    </MemoryRouter>,
  );
  return screen.getByRole("combobox");
}

describe("costume picker on the Privilege client page", () => {
  it("defaults to the client page and lists every costume variant", () => {
    const select = renderClientPage();
    expect(select).toHaveValue("");
    // 4 categories x 3 variants + the client-page option
    expect(screen.getAllByRole("option")).toHaveLength(13);
  });

  it("selecting a costume persists the pick and loads that shell immediately", () => {
    fireEvent.change(renderClientPage(), { target: { value: "chatgpt:web" } });
    expect(readMockSelection().chatgpt).toBe("web");
    // Variant rides in the URL (?v=) so switching within a group re-renders — see
    // FootprintSkinPicker (#1560). Only variant picks carry it; the client-page
    // default navigates bare.
    expect(navigate).toHaveBeenCalledWith("/demo/chatgpt-desktop?v=web");
  });
});

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
