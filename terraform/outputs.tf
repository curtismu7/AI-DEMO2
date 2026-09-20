output "target" {
  value = var.target
}

output "project_name" {
  value = var.project_name
}

output "public_app_url" {
  value = var.public_app_url
}

output "status_command" {
  value = "docker compose -p ${var.project_name} -f ${local.compose_path} ps"
}

output "logs_command" {
  value = "docker compose -p ${var.project_name} -f ${local.compose_path} logs -f"
}
