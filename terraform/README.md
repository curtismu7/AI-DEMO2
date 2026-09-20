# Terraform local Docker deployment

This target gives the local Docker stack a Terraform lifecycle without copying
the repository's Compose service definitions into a second configuration
system. Terraform owns the stack operation; `docker-compose.yml` remains the
source of truth for service images, environment files, profiles, dependencies,
health checks, and mounts.

Terraform does not bootstrap PingOne credentials. Run the repository installer
first. It asks for all three required Worker app values:

```text
PingOne Environment ID
PingOne Worker Client ID
PingOne Worker Client Secret
```

The Worker app must have the `Identity Data Admin` role. The credentials are
passed to `setup:fresh` and are not Terraform variables.

## First run

```bash
cd /path/to/AI-DEMO2
./install.sh --mode docker-terraform

cd terraform
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -check -recursive
terraform validate
terraform plan -out=ai-demo.tfplan
terraform apply ai-demo.tfplan
```

The current installer may also be run without an explicit mode; choose Docker
when prompted.

## Optional Compose profiles

Edit `terraform.tfvars`:

```hcl
compose_profiles = ["agents", "tracing"]
```

Then apply again:

```bash
terraform plan -out=ai-demo.tfplan
terraform apply ai-demo.tfplan
```

The supported profiles are the same profiles documented by Compose, including
`agents`, `rag`, `tracing`, `demo-auth`, and `observability`.

## SE namespace deployment

Terraform does not create or delete an SE namespace. The namespace must already
be provisioned for the user.

First-time setup asks for the PingOne Environment ID, Worker Client ID,
Worker Client Secret, and existing SE namespace:

```bash
./install.sh --mode se-terraform
```

For a repeat deployment, authenticate to the SE cluster and build/push images.
Use the same owner for both commands so the image names match:

```bash
kubectl config use-context us
gh auth login
export GITHUB_OWNER=alex
./run-pingaws.sh build
```

Create the namespace-scoped secrets from the PingOne bootstrap output:

```bash
export SE_NAMESPACE=ping-devops-alex
K8S_NAMESPACE="$SE_NAMESPACE" ./k8s/create-secrets.sh
```

Copy the Terraform variables and select the SE target:

```hcl
target             = "se"
namespace          = "ping-devops-alex"
kubernetes_context = "us"
image_repository   = "ghcr.io/alex"
```

`image_repository` must match the `GITHUB_OWNER` used by
`run-pingaws.sh build`; change both values together for another owner.

Then validate and deploy. The wrapper asks for the existing namespace if
`SE_NAMESPACE` is not set:

```bash
./deploy-se.sh
```

Terraform verifies that the namespace exists, that the caller can create
Deployments and PersistentVolumeClaims there, and that `ai-demo-secrets` is
present. It never creates or deletes the namespace. PVCs are retained by
default during `terraform destroy`; set `retain_volumes = false` when the
persistent data should also be removed.

## Status and logs

```bash
terraform output status_command
terraform output logs_command
docker compose -p ai-demo -f ../docker-compose.yml ps
docker compose -p ai-demo -f ../docker-compose.yml logs -f
```

Open:

```text
https://local.ping-devops.com:4000
```

## Stop and destroy

Terraform destroy keeps named volumes by default:

```bash
terraform destroy
```

To delete the containers and persistent Docker volumes, explicitly override
the safety default:

```bash
terraform destroy -var='retain_volumes=false'
```

Do not commit `terraform.tfvars`, Terraform state, or generated plan files.
