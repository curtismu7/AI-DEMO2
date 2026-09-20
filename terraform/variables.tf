variable "target" {
  description = "Runtime target managed by this Terraform configuration."
  type        = string
  default     = "docker"

  validation {
    condition     = contains(["docker", "se"], var.target)
    error_message = "target must be docker or se."
  }
}

variable "namespace" {
  description = "Existing Kubernetes namespace for the SE target. Terraform never creates or deletes it."
  type        = string
  default     = ""

  validation {
    condition     = var.namespace == "" || can(regex("^[a-z0-9]([-a-z0-9]*[a-z0-9])?$", var.namespace))
    error_message = "namespace must be empty or a Kubernetes DNS label."
  }
}

variable "kubernetes_context" {
  description = "kubectl context used by the SE target."
  type        = string
  default     = "us"
}

variable "kubeconfig_path" {
  description = "Optional kubeconfig path. Empty uses kubectl's normal resolution."
  type        = string
  default     = ""
}

variable "image_repository" {
  description = "Optional image repository prefix for SE images, for example ghcr.io/alex."
  type        = string
  default     = ""
}

variable "project_name" {
  description = "Docker Compose project name."
  type        = string
  default     = "ai-demo"
}

variable "compose_file" {
  description = "Path to the repository Compose source, relative to the Terraform directory."
  type        = string
  default     = "../docker-compose.yml"
}

variable "compose_profiles" {
  description = "Optional Compose profiles to enable, for example [\"agents\", \"tracing\"]."
  type        = list(string)
  default     = []
}

variable "build_images" {
  description = "Build images before starting the local Docker stack."
  type        = bool
  default     = true
}

variable "retain_volumes" {
  description = "Keep persistent Docker volumes and Kubernetes PVCs during terraform destroy."
  type        = bool
  default     = true
}

variable "public_app_url" {
  description = "Browser URL used by the already-bootstrapped application."
  type        = string
  default     = "https://local.ping-devops.com:4000"

  validation {
    condition     = can(regex("^https?://", var.public_app_url))
    error_message = "public_app_url must begin with http:// or https://."
  }
}
