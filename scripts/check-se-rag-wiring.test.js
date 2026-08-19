const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

test('SE deploy creates dormant RAG resources', () => {
  const deploy = read('k8s/aws/deploy.sh');
  const manifest = read('k8s/72-rag-stack.yaml');

  assert.match(
    deploy,
    /56-llm-stack\.yaml \\\s*\n\s*72-rag-stack\.yaml \\\s*\n\s*20-api-server-deployment\.yaml \\/,
  );
  assert.equal((manifest.match(/replicas: 0/g) || []).length, 4);
});

test('Ping AWS launcher routes RAG control through the SE-safe command', () => {
  const launcher = read('run-pingaws.sh');
  const runK8 = read('run-k8.sh');
  const deployRag = read('k8s/aws/deploy-rag.sh');

  assert.match(launcher, /rag\)\s*\n\s*exec "\$RUN_K8" se-rag "\$@"/);
  assert.match(runK8, /se-rag\)\s+se_rag "\$\{2:-on\}"/);
  assert.match(
    runK8,
    /K8S_NAMESPACE="\$ns" bash "\$K8S_DIR\/deploy\.sh" rag off/,
  );
  assert.match(
    runK8,
    /K8S_NAMESPACE="\$ns" RAG_ACTION="\$action"[\s\S]*bash "\$K8S_DIR\/aws\/deploy-rag\.sh"/,
  );
  assert.match(
    deployRag,
    /kubectl rollout restart deployment\/demo-api-server -n "\$NS"/,
  );
});
