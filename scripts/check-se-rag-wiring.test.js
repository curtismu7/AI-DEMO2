const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const read = (file) => readFileSync(path.join(root, file), 'utf8');

test('SE deploy applies and verifies the RAG stack', () => {
  const deploy = read('k8s/aws/deploy.sh');
  const deployRag = read('k8s/aws/deploy-rag.sh');
  const runK8 = read('run-k8.sh');

  assert.match(
    deploy,
    /56-llm-stack\.yaml \\\s*\n\s*72-rag-stack\.yaml \\\s*\n\s*20-api-server-deployment\.yaml \\/,
  );
  assert.match(deploy, /weaviate embeddings \\\s*\n\s*mcp-code-search llamaindex-agent/);
  assert.match(deployRag, /ai-demo2-server/);
  assert.match(deployRag, /did not become ready/);
  assert.match(runK8, /--profile agents --profile demo-auth --profile rag build/);
  assert.match(runK8, /ai-demo-k8-mcp-code-search:ai-demo-mcp-code-search/);
  assert.match(runK8, /ai-demo-k8-llamaindex-agent:ai-demo-llamaindex-agent/);
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
