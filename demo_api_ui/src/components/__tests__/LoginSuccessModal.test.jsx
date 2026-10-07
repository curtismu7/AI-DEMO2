import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import LoginSuccessModal from "../LoginSuccessModal";

const base = { firstName: "Demo", lastName: "User", email: "demo@example.test", username: "demoUser" };
const open = (user) => render(<LoginSuccessModal user={user} isOpen onClose={() => {}} />);

describe("LoginSuccessModal says which server signed the user in", () => {
  it("names PingFederate, its host, and what that means for the PingFederate features", () => {
    open({ ...base, oauthProvider: "pingfederate", oauthIssuer: "https://local.ping-devops.com:9031" });

    const block = screen.getByTestId("lsm-provider");
    expect(block).toHaveTextContent("Signed in through");
    expect(block).toHaveTextContent("PingFederate");
    expect(block).toHaveTextContent("local.ping-devops.com:9031");
    expect(block).toHaveTextContent("so the PingFederate features use this sign-in");
    expect(screen.getByText("Signed in through PingFederate")).toBeInTheDocument();
  });

  it("names PingOne and warns that the PingFederate features need their own sign-in", () => {
    open({ ...base, oauthProvider: "pingone", oauthIssuer: "https://auth.pingone.com/01d89b06-env/as" });

    const block = screen.getByTestId("lsm-provider");
    expect(block).toHaveTextContent("PingOne");
    expect(block).toHaveTextContent("auth.pingone.com");
    expect(block).toHaveTextContent("ask for a separate PingFederate sign-in");
    expect(screen.getByText("Signed in through PingOne")).toBeInTheDocument();
  });

  it("matches the provider whatever its casing", () => {
    open({ ...base, oauthProvider: "PingFederate" });

    expect(screen.getByTestId("lsm-provider")).toHaveTextContent("PingFederate");
  });

  it("still shows the provider when the issuer is missing or not a URL", () => {
    open({ ...base, oauthProvider: "pingone", oauthIssuer: "not a url" });

    const block = screen.getByTestId("lsm-provider");
    expect(block).toHaveTextContent("PingOne");
    expect(block).not.toHaveTextContent("·");
  });

  it("trusts the live session over the stored user record when they disagree", () => {
    render(
      <LoginSuccessModal
        user={{ ...base, oauthProvider: "pingone", oauthIssuer: "https://auth.pingone.com/env" }}
        signIn={{ provider: "pingfederate", issuer: "https://local.ping-devops.com:9031" }}
        isOpen
        onClose={() => {}}
      />,
    );

    const block = screen.getByTestId("lsm-provider");
    expect(block).toHaveTextContent("PingFederate");
    expect(block).toHaveTextContent("local.ping-devops.com:9031");
    expect(block).not.toHaveTextContent("PingOne");
  });

  it("claims nothing when the provider is unknown", () => {
    open({ ...base, oauthProvider: null });

    expect(screen.queryByTestId("lsm-provider")).not.toBeInTheDocument();
    expect(screen.getByText("Verified and secure")).toBeInTheDocument();
    expect(screen.queryByText(/Signed in through/)).not.toBeInTheDocument();
  });

  it("claims nothing for a provider it has never heard of", () => {
    open({ ...base, oauthProvider: "someone-else" });

    expect(screen.queryByTestId("lsm-provider")).not.toBeInTheDocument();
  });

  it("still shows the identity fields", () => {
    open({ ...base, oauthProvider: "pingfederate" });

    expect(screen.getByText("Demo User")).toBeInTheDocument();
    expect(screen.getByText(/demo@example.test/)).toBeInTheDocument();
  });
});
