locals {
  repo_root       = abspath("${path.root}/..")
  compose_path    = abspath("${path.root}/${var.compose_file}")
  profile_args    = join(" ", [for profile in var.compose_profiles : "--profile ${profile}"])
  compose_digest  = filesha256(local.compose_path)
  launcher_digest = filesha256("${local.repo_root}/run-docker.sh")
  k8s_excluded_files = toset([
    "00-sealed-secrets-install.yaml",
    "54-seed-llm-models.yaml",
  ])
  k8s_documents = var.target == "se" ? flatten([
    for file_name in fileset("${local.repo_root}/k8s", "*.yaml") : [
      for index, document in split("\n---", file("${local.repo_root}/k8s/${file_name}")) : {
        key    = "${file_name}#${index}"
        yaml   = document
        is_pvc = can(regex("(?m)^kind: PersistentVolumeClaim$", document))
      }
      if !contains(local.k8s_excluded_files, file_name)
      && !(file_name == "01-namespace.yaml" && index == 0)
    ]
  ]) : []
}

resource "terraform_data" "docker_stack" {
  count = var.target == "docker" ? 1 : 0
  input = {
    target           = var.target
    project_name     = var.project_name
    compose_file     = local.compose_path
    compose_profiles = var.compose_profiles
    build_images     = var.build_images
    public_app_url   = var.public_app_url
    retain_volumes   = var.retain_volumes
    compose_digest   = local.compose_digest
    launcher_digest  = local.launcher_digest
  }

  triggers_replace = [
    local.compose_digest,
    local.launcher_digest,
    jsonencode(var.compose_profiles),
    tostring(var.build_images),
    var.public_app_url,
  ]

  provisioner "local-exec" {
    command = "${path.module}/scripts/docker-up.sh"

    environment = {
      AI_DEMO_COMPOSE_FILE   = local.compose_path
      AI_DEMO_PROJECT_NAME   = var.project_name
      AI_DEMO_PROFILE_ARGS   = local.profile_args
      AI_DEMO_BUILD_IMAGES   = tostring(var.build_images)
      AI_DEMO_PUBLIC_APP_URL = var.public_app_url
    }
  }

  provisioner "local-exec" {
    when    = destroy
    command = "${path.module}/scripts/docker-down.sh"

    environment = {
      AI_DEMO_COMPOSE_FILE   = self.input.compose_file
      AI_DEMO_PROJECT_NAME   = self.input.project_name
      AI_DEMO_RETAIN_VOLUMES = tostring(self.input.retain_volumes)
    }
  }
}

resource "terraform_data" "se_namespace_preflight" {
  count = var.target == "se" ? 1 : 0

  lifecycle {
    precondition {
      condition     = var.namespace != ""
      error_message = "namespace is required for target=se. Terraform will not create the namespace."
    }
  }

  input = {
    namespace = var.namespace
    context   = var.kubernetes_context
  }

  provisioner "local-exec" {
    command = "${path.module}/scripts/k8s-preflight.sh"

    environment = {
      AI_DEMO_K8S_NAMESPACE = var.namespace
      AI_DEMO_K8S_CONTEXT   = var.kubernetes_context
      KUBECONFIG            = var.kubeconfig_path
    }
  }
}

resource "kubectl_manifest" "se_app" {
  for_each = {
    for document in local.k8s_documents : document.key => document
  }

  yaml_body = replace(
    replace(
      replace(each.value.yaml, "namespace: ai-demo", "namespace: ${var.namespace}"),
      "kubernetes.io/metadata.name: ai-demo",
      "kubernetes.io/metadata.name: ${var.namespace}"
    ),
    "image: ai-demo-k8-",
    var.image_repository == "" ? "image: ai-demo-k8-" : "image: ${var.image_repository}/ai-demo-k8-"
  )

  wait       = false
  apply_only = var.retain_volumes && each.value.is_pvc
  depends_on = [terraform_data.se_namespace_preflight]
}
