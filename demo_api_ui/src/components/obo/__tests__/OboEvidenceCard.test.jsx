import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import OboEvidenceCard from "../OboEvidenceCard";

const evidence = {
  source: "claude",
  inbound: { aud: ["mcpgateway.ping.demo"], scope: "mcp:invoke", client_id: "c8392dc4", sha: "aaaaaaaaaaaaaaaa" },
  delegated: { aud: ["obo-demo.ping.demo"], scope: "obo:invoke", sub: "u1", act: { client_id: "f65664b2" }, exp: 1792010389, sha: "bbbbbbbbbbbbbbbb" },
  downstream: { delegated: 200, userToken: 401 },
  checks: [{ id: "sub-preserved", label: "same user", pass: true }, { id: "act-object", label: "act is an object", pass: false }],
};

describe("OboEvidenceCard", () => {
  it("shows the user token and the delegated token side by side, with act as an object", () => {
    render(<OboEvidenceCard evidence={evidence} />);
    expect(screen.getByRole("region", { name: /your token/i })).toHaveTextContent("mcpgateway.ping.demo");
    const delegated = screen.getByRole("region", { name: /delegated token/i });
    expect(delegated).toHaveTextContent("obo-demo.ping.demo");
    expect(delegated).toHaveTextContent('{"client_id":"f65664b2"}');
  });

  it("renders the checks as PASS/FAIL in an accessible list", () => {
    render(<OboEvidenceCard evidence={evidence} />);
    const list = screen.getByRole("list", { name: /delegation checks/i });
    expect(list).toHaveTextContent("PASS same user");
    expect(list).toHaveTextContent("FAIL act is an object");
  });

  it("shows the downstream accept/refuse result", () => {
    render(<OboEvidenceCard evidence={evidence} />);
    expect(screen.getByTestId("obo-downstream")).toHaveTextContent(/delegated: 200/i);
    expect(screen.getByTestId("obo-downstream")).toHaveTextContent(/your token: 401/i);
  });

  it("does not throw when only checks are present (older shape)", () => {
    render(<OboEvidenceCard evidence={{ checks: [{ id: "x", label: "only checks", pass: true }] }} />);
    expect(screen.getByRole("list", { name: /delegation checks/i })).toHaveTextContent("PASS only checks");
    expect(screen.queryByRole("region", { name: /delegated token/i })).toBeNull();
  });

  it("shows a bare-string act as text, not [object Object]", () => {
    const str = { ...evidence, delegated: { ...evidence.delegated, act: "f65664b2" } };
    render(<OboEvidenceCard evidence={str} />);
    expect(screen.getByRole("region", { name: /delegated token/i })).toHaveTextContent("f65664b2");
    expect(document.body.textContent).not.toMatch(/\[object Object\]/);
  });

  it("never prints a JWT-shaped string", () => {
    render(<OboEvidenceCard evidence={evidence} />);
    expect(document.body.textContent).not.toMatch(/eyJ/);
  });
});
