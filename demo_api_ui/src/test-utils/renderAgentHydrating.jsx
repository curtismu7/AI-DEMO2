/**
 * Shared agent-mount helpers for vitest specs — the hydration-window harness.
 *
 * In the real app `user` arrives asynchronously (isLoggedIn = !!(user ||
 * sessionUser), both resolved after mount), so EVERY load has a window where
 * the agent is mounted and signed-out-looking before the session lands.
 * Mounting with `user` already resolved skips that window entirely — a defect
 * living inside it is unreachable from such a spec. The queued-question resume
 * bug (#1963) shipped "fixed" three times against a green suite exactly this
 * way (TECH_DEBT 2026-08-18 "Agent tests pass `user` at first render").
 *
 * Usage (any spec touching auth-dependent effects):
 *
 *   import { renderAgentHydrating } from "../../test-utils/renderAgentHydrating";
 *   const { resolveSession } = renderAgentHydrating(AIAgent, { path: "/dashboard" });
 *   // ... assertions inside the hydration window ...
 *   await resolveSession(ADMIN);
 *   // ... assertions after the session lands ...
 *
 * The component is passed in (rather than imported here) so each spec keeps
 * its own vi.mock graph — importing AIAgent from a shared util would bind it
 * before the spec's mocks exist.
 */
import React from "react";
import { act, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ActivityNarrativeProvider } from "../context/ActivityNarrativeContext";
import { ProofOfEnforcementProvider } from "../context/ProofOfEnforcementContext";

function wrap(Agent, path, user, props) {
  return (
    <MemoryRouter initialEntries={[path]}>
      <ActivityNarrativeProvider>
        <ProofOfEnforcementProvider>
          <Agent user={user} mode="inline" {...props} />
        </ProofOfEnforcementProvider>
      </ActivityNarrativeProvider>
    </MemoryRouter>
  );
}

/**
 * Mount signed-out first (the hydration window every real load has), then let
 * the caller land the session with `resolveSession(user)`. Assertions made
 * between mount and resolveSession run inside the window a resolved-user mount
 * cannot create.
 */
export function renderAgentHydrating(Agent, { path = "/dashboard", props = {} } = {}) {
  const view = render(wrap(Agent, path, null, props));
  const resolveSession = async (user, settleMs = 300) => {
    view.rerender(wrap(Agent, path, user, props));
    await act(async () => { await new Promise((r) => setTimeout(r, settleMs)); });
  };
  return { ...view, resolveSession };
}
