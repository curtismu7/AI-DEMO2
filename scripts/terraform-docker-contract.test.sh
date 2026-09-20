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
grep -q 'docker compose' "$TF_DIR/scripts/docker-up.sh"
grep -q 'docker compose' "$TF_DIR/scripts/docker-down.sh"
grep -q 'PingOne Environment ID' "$TF_DIR/README.md"
grep -q 'terraform destroy' "$TF_DIR/README.md"
grep -q 'docker-terraform' "$ROOT_DIR/install.sh"
grep -q 'ensure_terraform' "$ROOT_DIR/install.sh"
grep -q 'contains(\["docker", "se"\]' "$TF_DIR/variables.tf"
grep -q 'se_namespace_preflight' "$TF_DIR/main.tf"
grep -q 'kubectl_manifest' "$TF_DIR/main.tf"
test -x "$TF_DIR/scripts/k8s-preflight.sh"
test -x "$TF_DIR/deploy-se.sh"
grep -q 'se-terraform' "$ROOT_DIR/install.sh"
grep -q 'Terraform does not create or delete an SE namespace' "$TF_DIR/README.md"

echo "terraform Docker contract: PASS"
