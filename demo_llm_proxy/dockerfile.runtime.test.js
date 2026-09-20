const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('llm-proxy image copies every local runtime module imported by router.js', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, 'Dockerfile'), 'utf8');
  assert.match(
    dockerfile,
    /COPY\s+router\.js\s+posthogAi\.js\s+metrics\.js\s+toolDiscoveryResponse\.js\s+\.\//,
    'Dockerfile must copy toolDiscoveryResponse.js, imported by router.js',
  );
});

test('tier-manager Dockerfile leaves kubectl architecture selection to the build target', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, 'Dockerfile.tier-manager'), 'utf8');
  assert.match(dockerfile, /ARG TARGETARCH\s*\n/);
  assert.doesNotMatch(dockerfile, /ARG TARGETARCH=amd64/);
});
