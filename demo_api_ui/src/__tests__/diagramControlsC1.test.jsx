// Diagram rule: movable boxes (sequence views exempt), Simulate/Play, Reset, speed control.
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import InvestDualAuthDiagramPage from "../components/InvestDualAuthDiagramPage";
import PrivilegeGatewayTopologyPage, { TABS } from "../components/PrivilegeGatewayTopologyPage";
import ServerTopologyPage from "../components/ServerTopologyPage";

const flow = vi.hoisted(() => ({ props: [] }));
vi.mock("@xyflow/react", async (importOriginal) => {
  const actual = await importOriginal();
  const ReactModule = await import("react");
  return {
    ...actual,
    ReactFlow: (p) => {
      flow.props.push(p);
      return ReactModule.createElement(actual.ReactFlow, p);
    },
  };
});
vi.mock("../services/apiClient", () => ({ default: { get: vi.fn(() => Promise.reject(new Error("403"))), post: vi.fn() } }));

const renderPage = (el) => render(<MemoryRouter>{el}</MemoryRouter>);
const hasSpeed = () => screen.queryAllByRole("combobox", { name: /Step time/ }).length > 0;
const draggable = () => flow.props.length > 0 && flow.props.every((p) => p.nodesDraggable && p.onNodesChange);

describe("diagram controls — batch c1", () => {
  it("/invest-dual-auth (sequence): Simulate, Reset, speed", () => {
    renderPage(<InvestDualAuthDiagramPage />);
    expect(screen.getByRole("button", { name: /Simulate/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Reset$/ })).toBeTruthy();
    expect(hasSpeed()).toBe(true);
  });

  it.each(TABS.map((t) => [t.label]))("/privilege-gateway-topologies %s tab: draggable, Simulate, Reset, speed", (label) => {
    renderPage(<PrivilegeGatewayTopologyPage />);
    fireEvent.click(screen.getAllByRole("button").find((b) => b.textContent === label));
    flow.props = [];
    fireEvent.click(screen.getByRole("button", { name: /Simulate/ }));
    expect(draggable()).toBe(true);
    expect(screen.getByRole("button", { name: /^Reset$/ })).toBeTruthy();
    expect(hasSpeed()).toBe(true);
  });

  it("/architecture/server-topology: draggable, Play, Reset clears the walkthrough, speed", () => {
    flow.props = [];
    renderPage(<ServerTopologyPage />);
    expect(draggable()).toBe(true);
    expect(screen.getByRole("button", { name: /^Play$/ })).toBeTruthy();
    expect(hasSpeed()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /Next hop/ }));
    expect(screen.getByText(/Step 2 of/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /^Reset$/ }));
    expect(screen.getByText(/Step 1 of/)).toBeTruthy();
  });
});
