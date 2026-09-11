import React from "react";
import { render, screen } from "@testing-library/react";
import { InspectorFieldProvider, useInspectorFields } from "../InspectorFieldContext";

// Stable references: a fresh object each render would re-run the effect below,
// re-register, re-render and loop.
const ONE_INSPECTORS_FIELDS = { user_id: "u1" };
const WANTED = ["userId"];

function Probe({ id, data, want }) {
  const { registerFields, getMatchingFields } = useInspectorFields();
  React.useEffect(() => {
    if (data) registerFields(id, data);
  }, [id, data, registerFields]);
  const matches = want ? getMatchingFields(want) : {};
  return <div data-testid={`probe-${id}`}>{JSON.stringify(matches)}</div>;
}

describe("useInspectorFields", () => {
  it("renders without a provider instead of crashing the page (just no cross-inspector suggestions)", () => {
    // Any page that mounts an inspector without InspectorFieldProvider used to
    // throw "useInspectorFields must be used within InspectorFieldProvider" and
    // take the whole page down (/agent-gateway-capabilities, 2026-08-31 on).
    render(<Probe id="solo" data={ONE_INSPECTORS_FIELDS} want={WANTED} />);
    expect(screen.getByTestId("probe-solo").textContent).toBe("{}");
  });

  it("with a provider, a field registered by one inspector is suggested to another", async () => {
    render(
      <InspectorFieldProvider>
        <Probe id="a" data={ONE_INSPECTORS_FIELDS} />
        <Probe id="b" want={WANTED} />
      </InspectorFieldProvider>
    );
    expect(await screen.findByText('{"userId":"u1"}')).toBeInTheDocument();
  });
});
