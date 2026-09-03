// demo_api_ui/src/pages/__tests__/PrivilegeMcpClientPage.policies.test.jsx
//
// The Policies tab and the enriched denial modal exist because the agentless
// gateway answers a policy denial with a bare 403 and logs nothing, so it can
// never tell us WHICH policy denied. Everything here is about not overclaiming:
// the pacpolicy Spec schema is undocumented, so the page text-searches it and
// must say "mentions", never "grants".
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import PrivilegeMcpClientPage from "../PrivilegeMcpClientPage";

vi.mock("../../services/apiClient", () => ({
  default: { get: vi.fn(() => new Promise(() => {})), post: vi.fn(() => new Promise(() => {})) },
}));

const GATEWAY = "https://cmuir-agentless-mcpgw.ping-devops.com/cmuir/mcp";
const EXTERNAL = "https://cmuir-agentless-mcpgw.ping-devops.com/external/mcp";

const INVENTORY = {
  applications: [
    { name: "cmuir", mcpUrl: GATEWAY, backends: ["http://pingone-mcp-server-2:8080/mcp"], status: "" },
    { name: "external", mcpUrl: EXTERNAL, backends: ["http://mcp-server:8080/mcp"], status: "Ready" },
  ],
  policies: [
    { name: "cmuir-tools", spec: { Apps: ["cmuir"], Principals: ["someone-else@pingone.com"] } },
    { name: "banking-tools", spec: { Apps: ["external"], Principals: ["cmuir+demo@pingone.com"] } },
  ],
};

function mockApi({ connectStatus = 200 } = {}) {
  const posted = [];
  global.fetch = vi.fn((url, opts) => {
    const u = String(url);
    const ok = (body, status = 200) => Promise.resolve({
      ok: status >= 200 && status < 300, status,
      headers: { get: () => null },
      text: async () => JSON.stringify(body),
    });
    if (u.endsWith("/api/privilege-mcp/state")) {
      return ok({
        config: { mcpUrl: GATEWAY, clientId: "a6219652", scopes: "openid profile email" },
        gatewayMode: "agentless",
        gatewayConfigs: { agent: {}, agentless: {} },
        oauth: { authenticated: true },
        mainAppAuthenticated: true,
        user: { email: "cmuir+demo@pingone.com" },
        // Must stay empty: a non-empty list fires the page's "land on the Tools
        // tab the first time tools are discovered" effect, which steals the tab.
        tools: [],
        presets: [],
      });
    }
    if (u.endsWith("/api/privilege-mcp/console/connect")) {
      posted.push(JSON.parse(opts.body));
      return connectStatus === 200 ? ok(INVENTORY) : ok({ error: "Console API 401" }, connectStatus);
    }
    return new Promise(() => {});
  });
  return posted;
}

function renderPage() {
  render(
    <MemoryRouter initialEntries={["/privilege-mcp-client"]}>
      <PrivilegeMcpClientPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  global.EventSource = class { addEventListener() {} close() {} };
});

async function openPoliciesAndConnect(token = "console-cookie") {
  renderPage();
  // Select the tab by its class: "Policies" also appears as a section heading
  // once connected, and getByText would go ambiguous.
  await waitFor(() => expect(document.querySelectorAll(".cur-tab").length).toBeGreaterThan(0));
  fireEvent.click([...document.querySelectorAll(".cur-tab")].find((b) => b.textContent === "Policies"));
  const field = await screen.findByPlaceholderText("paste the auth_token cookie value");
  fireEvent.change(field, { target: { value: token } });
  fireEvent.click(screen.getByText("Connect"));
}

describe("Policies tab", () => {
  it("sends the pasted token to the BFF and lists doors and policies", async () => {
    const posted = mockApi();
    await openPoliciesAndConnect();

    await waitFor(() => expect(screen.getByText("Doors (2)")).toBeTruthy());
    expect(posted).toEqual([{ authToken: "console-cookie" }]);
    expect(screen.getByText("Policies (2)")).toBeTruthy();
    // Policies moved from a stack of accordions to a picker, so the names live
    // in its options rather than as standalone text.
    const picker = screen.getByLabelText("Inspect a policy");
    const optionText = Array.from(picker.querySelectorAll("option")).map((o) => o.textContent).join("|");
    expect(optionText).toContain("cmuir-tools");
    expect(optionText).toContain("banking-tools");
    // The door currently in use is marked, not offered as a switch. Scoped to
    // the Doors row: the policy detail pane marks the covered door "current"
    // too, so an unscoped query now matches twice.
    const activeDoorRow = document.querySelector(".cur-console-row--active");
    expect(activeDoorRow).toBeTruthy();
    expect(activeDoorRow.textContent).toContain("current");
  });

  it("does not keep the token in the DOM after connecting", async () => {
    mockApi();
    await openPoliciesAndConnect("super-secret-cookie");
    await waitFor(() => expect(screen.getByText("Doors (2)")).toBeTruthy());
    expect(document.body.innerHTML).not.toContain("super-secret-cookie");
  });

  it('says "mentions", never "grants" — the Spec schema is undocumented', async () => {
    mockApi();
    await openPoliciesAndConnect();
    await waitFor(() => expect(screen.getByText("Policies (2)")).toBeTruthy());

    // cmuir-tools mentions the current door; banking-tools mentions the user.
    // The tags now ride on the picker's options, which is where both are visible
    // at once — the detail pane only ever shows the selected policy.
    const picker = screen.getByLabelText("Inspect a policy");
    const labels = Array.from(picker.querySelectorAll("option")).map((o) => o.textContent);
    // Exactly one of each: the door "cmuir" is a SUBSTRING of the principal
    // "cmuir+demo@pingone.com" on the other policy, so a substring match would
    // tag both and quietly tell the operator something false.
    expect(labels.filter((l) => l.includes("mentions this door"))).toHaveLength(1);
    expect(labels.filter((l) => l.includes("mentions you"))).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/\bgrants you\b/i);
  });

  it("surfaces a rejected console token instead of rendering an empty inventory", async () => {
    mockApi({ connectStatus: 401 });
    await openPoliciesAndConnect();
    await waitFor(() => expect(screen.queryByText("Doors (2)")).toBeNull());
    expect(screen.getByPlaceholderText("paste the auth_token cookie value")).toBeTruthy();
  });
});
