#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TF_DIR="$ROOT_DIR/terraform"

for file in versions.tf providers.tf variables.tf main.tf outputs.tf terraform.tfvars.example README.md; do
  test -f "$TF_DIR/$file" || { echo "missing terraform/$file" >&2; exit 1; }
done

grep -q 'variable "target"' "$TF_DIR/variables.tf"
grep -q 'variable "retain_volumes"' "$TF_DIR/variables.tf"
grep -q 'terraform_data' "$TF_DIR/main.tf"
grep -Eq 'retain_volumes[[:space:]]*=[[:space:]]*var\.retain_volumes' "$TF_DIR/main.tf"
grep -q 'AI_DEMO_RETAIN_VOLUMES = tostring(self.input.retain_volumes)' "$TF_DIR/main.tf"
grep -q 'docker compose' "$TF_DIR/scripts/docker-up.sh"
grep -q 'docker compose' "$TF_DIR/scripts/docker-down.sh"
grep -q 'PingOne Environment ID' "$TF_DIR/README.md"
grep -q 'terraform destroy' "$TF_DIR/README.md"
grep -q 'docker-terraform' "$ROOT_DIR/install.sh"
grep -q 'ensure_terraform' "$ROOT_DIR/install.sh"
grep -q 'NODE_REQUIRED_MAJOR="22"' "$ROOT_DIR/install.sh"
grep -q 'NODE_MIN_MAJOR="22"' "$ROOT_DIR/install.sh"
grep -q '^NODE_MIN_VERSION=22$' "$ROOT_DIR/run.sh"
grep -q '^NODE_MIN=22$' "$ROOT_DIR/scripts/run-node.sh"
grep -q -- '--deployment-only' "$ROOT_DIR/install.sh"
grep -q 'Set SE_NAMESPACE for non-interactive setup' "$ROOT_DIR/install.sh"
grep -q 'contains(\["docker", "se"\]' "$TF_DIR/variables.tf"
grep -q 'se_namespace_preflight' "$TF_DIR/main.tf"
grep -q 'image_repository is required for target=se' "$TF_DIR/main.tf"
grep -q 'image_repository must be a registry host followed by a repository path' "$TF_DIR/variables.tf"
grep -q '"ping-devops-cmuir"' "$TF_DIR/main.tf"
grep -q 'kubectl_manifest' "$TF_DIR/main.tf"
grep -q 'TF_VAR_image_repository' "$TF_DIR/deploy-se.sh"
grep -q -- '-var="target=se"' "$TF_DIR/deploy-se.sh"
grep -q -- '-var="image_repository=$TF_VAR_image_repository"' "$TF_DIR/deploy-se.sh"
test -x "$TF_DIR/scripts/k8s-preflight.sh"
test -x "$TF_DIR/deploy-se.sh"
grep -q 'se-terraform' "$ROOT_DIR/install.sh"
grep -q 'Terraform does not create or delete an SE namespace' "$TF_DIR/README.md"
grep -q 'Deployment prerequisites' "$TF_DIR/README.md"
grep -q 'Verify the deployment' "$TF_DIR/README.md"
grep -q 'Troubleshooting' "$TF_DIR/README.md"

echo "terraform Docker contract: PASS"
