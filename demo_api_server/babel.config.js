// Babel config used ONLY by babel-jest (Jest's default transformer once
// @babel/core + a config are present). It transpiles the ESM-only node_modules
// whitelisted in jest.config.js's transformIgnorePatterns (jose + the A2A/MCP
// SDKs) down to CJS so Jest 29's CJS runtime can load suites that import
// server.js. Runtime (node) never reads this — it requires those packages
// natively. targets:node current keeps the transform minimal and leaves the
// repo's own CJS source untouched.
module.exports = {
  presets: [['@babel/preset-env', { targets: { node: 'current' } }]],
};
