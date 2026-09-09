import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import PrivilegeFirstGatewayPage from "../PrivilegeFirstGatewayPage";

describe("PrivilegeFirstGatewayPage", () => {
  it("renders both figures with their claims and the three switches", () => {
    render(<PrivilegeFirstGatewayPage />);
    expect(screen.getByRole("img", { name: /callers on the left enter the Privilege AI Gateway/ })).toBeTruthy();
    expect(screen.getByRole("img", { name: /identity fork on the Privilege to Agent Gateway hop/ })).toBeTruthy();
    expect(screen.getByText("ff_privilege_llm_first")).toBeTruthy();
    expect(screen.getByText("ff_mcp_gateway_privilege_first")).toBeTruthy();
    expect(screen.getByText("AGENT_LLM_BASE_URL")).toBeTruthy();
  });
});
