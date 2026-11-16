import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import ProtocolTrace from "../ProtocolTrace";

const steps = [
  {
    id: "par",
    title: "Push the request to PingFederate (PAR)",
    request: {
      method: "POST",
      url: "https://pf.example.test/as/par.oauth2",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      params: {
        client_id: "ai-demo-pf-rar",
        authorization_details: [{ type: "banking_transaction", amount: 125 }],
      },
    },
    response: { status: 201, body: { request_uri: "urn:ietf:params:oauth:request_uri:abc...", expires_in: 90 } },
  },
  {
    id: "token",
    title: "Redeem the code for tokens",
    request: { method: "POST", url: "https://pf.example.test/as/token.oauth2", params: { code: "<redacted opaque, 25 chars>" } },
    response: { status: 200, body: { access_token: "<redacted JWT, 40 chars>" } },
    claims: { idToken: { sub: "demouser" }, accessToken: null },
  },
];

// The pane's Form | JSON choice is page-wide and persisted; a test that clicks JSON must not leak it.
beforeEach(() => localStorage.clear());

describe("ProtocolTrace", () => {
  it("shows each step's request, response and explanation", () => {
    render(<ProtocolTrace steps={steps} explain={{ par: "The transaction goes in the body, not the URL." }} />);

    expect(screen.getByText("Push the request to PingFederate (PAR)")).toBeInTheDocument();
    expect(screen.getByText("The transaction goes in the body, not the URL.")).toBeInTheDocument();
    expect(screen.getByText("https://pf.example.test/as/par.oauth2")).toBeInTheDocument();
    expect(screen.getByText("HTTP 201")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Step 1 response body" })).getByText("request_uri")).toBeInTheDocument();
  });

  it("shows the parameters as the JSON pane by default and as a form body when asked", async () => {
    render(<ProtocolTrace steps={steps} />);
    const [firstParams] = screen.getAllByTestId("ptrace-params");

    // The shared pane, named per step, in its Form view (the default): the key, then its value, in rows.
    expect(firstParams).toHaveAttribute("aria-label", "Step 1 request parameters");
    expect(firstParams).toHaveTextContent("client_id");
    expect(firstParams).toHaveTextContent("ai-demo-pf-rar");
    expect(firstParams.tagName).toBe("DIV");

    fireEvent.click(screen.getAllByRole("button", { name: "As form-encoded body" })[0]);
    const encoded = screen.getAllByTestId("ptrace-params")[0];
    expect(encoded.tagName).toBe("PRE");
    expect(encoded).toHaveTextContent("client_id=ai-demo-pf-rar&");
    expect(encoded).toHaveTextContent(/authorization_details=%5B/);

    fireEvent.click(screen.getAllByRole("button", { name: "As JSON body" })[0]);
    const pane = screen.getAllByTestId("ptrace-params")[0];
    expect(pane).toHaveAttribute("aria-label", "Step 1 request parameters");
    // Choosing JSON in the pane gives the exact pretty-printed text; wait for it before reading.
    fireEvent.click(within(screen.getByRole("group", { name: "Step 1 request parameters view" })).getByRole("button", { name: "JSON" }));
    const raw = await waitFor(() => {
      const el = document.querySelector('pre.jp-raw[aria-label="Step 1 request parameters"]');
      expect(el).not.toBeNull();
      return el;
    });
    expect(raw.textContent).toBe(JSON.stringify(steps[0].request.params, null, 2));
  });

  it("each step has its own encoding toggle", () => {
    render(<ProtocolTrace steps={steps} />);

    fireEvent.click(screen.getAllByRole("button", { name: "As form-encoded body" })[1]);

    expect(screen.getAllByTestId("ptrace-params")[0].tagName).toBe("DIV");
    expect(screen.getAllByTestId("ptrace-params")[1].tagName).toBe("PRE");
    expect(screen.getAllByTestId("ptrace-params")[1]).toHaveTextContent("code=");
  });

  it("shows each response body and decoded claim set as a named pane, and decoded claims only where there are some", () => {
    render(<ProtocolTrace steps={steps} />);

    expect(screen.getByText(/Decoded ID token claims/)).toBeInTheDocument();
    expect(screen.queryByText(/Decoded access token claims/)).not.toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Step 1 response body" })).toHaveTextContent("urn:ietf:params:oauth:request_uri:abc...");
    expect(screen.getByRole("group", { name: "Step 2 response body" })).toHaveTextContent("<redacted JWT, 40 chars>");
    const claims = screen.getByRole("group", { name: "Step 2 decoded ID token claims (who signed in)" });
    expect(claims).toHaveTextContent("sub");
    expect(claims).toHaveTextContent("demouser");
    // No hand-rolled <pre> is left for a JSON body: the only <pre> in Form view is a form-encoded body.
    expect(document.querySelectorAll("pre")).toHaveLength(0);
  });

  it("renders nothing for an empty or missing trace", () => {
    const { container, rerender } = render(<ProtocolTrace steps={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ProtocolTrace />);
    expect(container).toBeEmptyDOMElement();
  });

  it("leads every pane name with the trace's context, so two traces on one page stay apart", () => {
    render(<><ProtocolTrace steps={steps} context="CIMD" /><ProtocolTrace steps={steps} context="CIBA" /></>);
    expect(screen.queryAllByRole("group", { name: "Step 1 response body" })).toHaveLength(0);
    expect(screen.getByRole("group", { name: "CIMD, Step 1 response body" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "CIBA, Step 1 response body" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "CIBA, Step 2 decoded ID token claims (who signed in)" })).toBeInTheDocument();
  });
});
