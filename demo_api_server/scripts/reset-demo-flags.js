// demo_api_server/scripts/reset-demo-flags.js
//
// Reset the runtime demo flags that silently change agent behavior back to
// the demo defaults. These live in the LMDB runtime KV (which beats env for
// non-bootstrap keys), so a QuickFlags click or Gateway Tester preset from a
// previous session persists across deploys — that drift is how the live demo
// ended up with heuristics off and the mock Authorize engine on.
//
// Run inside the BFF container (deploy.sh execs it before the rollout
// restart so fresh pods boot with these values):
//   node scripts/reset-demo-flags.js
'use strict';

const configStore = require('../services/configStore');

const DEMO_DEFAULTS = {
  agent_mode: 'heuristics',        // deterministic chip->tool routing
  ff_heuristic_enabled: 'true',    // heuristic floor stays on
  ff_authorize_real: 'true',     // real PingOne Authorize, no mock
};

(async () => {
  await configStore.setRaw(DEMO_DEFAULTS);
  for (const [key, target] of Object.entries(DEMO_DEFAULTS)) {
    const effective = configStore.getEffective(key);
    const ok = String(effective) === target ? 'ok' : `MISMATCH (effective ${JSON.stringify(effective)})`;
    console.log(`[reset-demo-flags] ${key} -> ${target} ${ok}`);
  }
  process.exit(0);
})().catch((err) => {
  console.error('[reset-demo-flags] failed:', err.message);
  process.exit(1);
});
