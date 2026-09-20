# The local Docker target deliberately uses Terraform's built-in
# terraform_data resource to drive the repository's existing Compose source of
# truth. This keeps the 30+ service definitions, profiles, env_file rules, and
# health dependencies in one place instead of duplicating them in Terraform.

terraform {
  required_providers {
    kubectl = {
      source  = "gavinbunney/kubectl"
      version = "1.14.0"
    }
  }
}

provider "kubectl" {
  config_path      = var.target == "se" ? var.kubeconfig_path : ""
  config_context   = var.target == "se" ? var.kubernetes_context : ""
  load_config_file = var.target == "se"
}
