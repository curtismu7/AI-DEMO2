'use strict';

// The refresh middleware was correct; the bug was where server.js mounted it. This pins the
// wiring so the mount cannot quietly shrink back to a list of prefixes.
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../server.js'), 'utf8');
const MOUNT = "app.use('/api', refreshIfExpiring);";

describe('silent token refresh mount in server.js', () => {
  it('covers every /api route, not a hand-kept list of prefixes', () => {
    expect(src).toContain(MOUNT);
    // the old shape: app.use([ '/api/users', ... ], refreshIfExpiring)
    expect(src).not.toMatch(/app\.use\(\s*\[[^\]]*\],\s*refreshIfExpiring/);
  });

  it('is registered before the routes that failed with "jwt expired"', () => {
    const mount = src.indexOf(MOUNT);
    expect(mount).toBeGreaterThan(-1); // absent would make every ordering check below pass vacuously
    for (const route of ["app.use('/api/verticals'", "app.use('/api', delegationGate, agentInvokeRoutes)"]) {
      const at = src.indexOf(route);
      expect(at).toBeGreaterThan(-1);
      expect(mount).toBeLessThan(at);
    }
  });
});
