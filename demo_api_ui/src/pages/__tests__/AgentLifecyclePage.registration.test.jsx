import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Step 1 of the lifecycle page used to be a recorded video captioned "live
 * registration isn't built yet". That stopped being true: PingOne Agent Builder
 * creates real applications, and the Agent Registry shows the result.
 *
 * A stale "not built yet" caption is worse than no caption — it tells a viewer
 * the product cannot do something it demonstrably can, on the page whose whole
 * job is to walk through the lifecycle.
 *
 * Asserted against the source rather than a render because the surrounding page
 * pulls in MCP calls, the control-plane API and the agent UI-mode context; this
 * check is about the claim the copy makes, and should not depend on any of that.
 */
const SRC = fs.readFileSync(
  path.join(__dirname, '..', 'AgentLifecyclePage.jsx'),
  'utf8',
);

describe('AgentLifecyclePage — registration step', () => {
  it('no longer claims live registration is unbuilt', () => {
    // \s+ not a literal space: the JSX wraps mid-phrase ("isn't\n  built yet"),
    // so a space-only pattern passes while the claim is still on the page.
    expect(SRC).not.toMatch(/(isn't|is\s+not)\s+built\s+yet/i);
    expect(SRC).not.toMatch(/not\s+\(yet\)\s+implemented/i);
  });

  it('points at the real Agent Builder', () => {
    expect(SRC).toMatch(/\/agent-builder/);
  });

  it('points at the Agent Registry, where the created identity shows up', () => {
    expect(SRC).toMatch(/\/agent-registry/);
  });
});
