import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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

describe("ProtocolTrace", () => {
  it("shows each step's request, response and explanation", () => {
    render(<ProtocolTrace steps={steps} explain={{ par: "The transaction goes in the body, not the URL." }} />);

    expect(screen.getByText("Push the request to PingFederate (PAR)")).toBeInTheDocument();
    expect(screen.getByText("The transaction goes in the body, not the URL.")).toBeInTheDocument();
    expect(screen.getByText("https://pf.example.test/as/par.oauth2")).toBeInTheDocument();
    expect(screen.getByText("HTTP 201")).toBeInTheDocument();
    expect(screen.getByText(/request_uri/)).toBeInTheDocument();
  });

  it("shows the parameters as JSON by default and as a form body when asked", () => {
    render(<ProtocolTrace steps={steps} />);
    const [firstParams] = screen.getAllByTestId("ptrace-params");

    expect(firstParams).toHaveTextContent('"authorization_details": [');
    fireEvent.click(screen.getAllByRole("button", { name: "Form" })[0]);

    expect(screen.getAllByTestId("ptrace-params")[0]).toHaveTextContent("client_id=ai-demo-pf-rar&");
    expect(screen.getAllByTestId("ptrace-params")[0]).toHaveTextContent(/authorization_details=%5B/);
    fireEvent.click(screen.getAllByRole("button", { name: "JSON" })[0]);
    expect(screen.getAllByTestId("ptrace-params")[0]).toHaveTextContent('"client_id": "ai-demo-pf-rar"');
  });

  it("each step has its own toggle", () => {
    render(<ProtocolTrace steps={steps} />);

    fireEvent.click(screen.getAllByRole("button", { name: "Form" })[1]);

    expect(screen.getAllByTestId("ptrace-params")[0]).toHaveTextContent('"client_id"');
    expect(screen.getAllByTestId("ptrace-params")[1]).toHaveTextContent("code=");
  });

  it("shows decoded claims only where there are some", () => {
    render(<ProtocolTrace steps={steps} />);

    expect(screen.getByText(/Decoded ID token claims/)).toBeInTheDocument();
    expect(screen.queryByText(/Decoded access token claims/)).not.toBeInTheDocument();
    expect(screen.getByText(/"sub": "demouser"/)).toBeInTheDocument();
  });

  it("renders nothing for an empty or missing trace", () => {
    const { container, rerender } = render(<ProtocolTrace steps={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ProtocolTrace />);
    expect(container).toBeEmptyDOMElement();
  });
});
