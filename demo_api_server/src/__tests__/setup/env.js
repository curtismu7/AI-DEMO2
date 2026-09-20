'use strict';

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
