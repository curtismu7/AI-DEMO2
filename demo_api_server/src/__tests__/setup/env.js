'use strict';

// Tests run against the same environment CI has: no developer .env. Local checkouts keep a .env
// with PingFederate and MCP settings that these suites pin to their own values. Calls to load the
// two local files are skipped; every other path (temp files, fixtures) loads as normal.
{
  const path = require('path');
  const LOCAL_ENV_FILES = [
    path.resolve(__dirname, '..', '..', '..', '..', '.env'), // repo root
    path.resolve(__dirname, '..', '..', '..', '.env'),       // demo_api_server
  ];
  const skipLocal = (config) => function skipLocalEnv(options, ...rest) {
    if (options && options.path && LOCAL_ENV_FILES.includes(path.resolve(options.path))) return { parsed: {} };
    return config.call(this, options, ...rest);
  };
  for (const name of ['dotenv', '@dotenvx/dotenvx']) {
    const mod = require(name);
    if (typeof mod.config === 'function' && !mod.config.skipLocalEnv) {
      mod.config = skipLocal(mod.config);
      mod.config.skipLocalEnv = true;
    }
  }
}

// These values must be installed before Jest evaluates test modules. Several
// suites require server.js at module scope, and server.js loads LMDB-backed
// services during that evaluation.
process.env.NODE_ENV = 'test';
process.env.DEBUG_TOKENS = 'true';
process.env.SKIP_TOKEN_SIGNATURE_VALIDATION = 'true';
process.env.LMDB_PATH = require('./lmdbTestDir').workerDir();
process.env.SESSION_SECRET = 'test-session-secret';
process.env.OAUTH_CLIENT_ID = 'test-client-id';
process.env.OAUTH_CLIENT_SECRET = 'test-client-secret';
process.env.OAUTH_ISSUER = 'https://auth.pingone.com/test-env';
