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

### Deployment prerequisites

- macOS for the guided installer; other operating systems need the tools below
  installed directly.
- Node.js 22+, Python 3.10+, Git, mkcert, Terraform 1.6+, and Docker with its
  daemon running (OrbStack or Docker Desktop on Mac).
- A PingOne Worker application with the `Identity Data Admin` role, plus its
  Environment ID, Client ID, and Client Secret.
- Network access to GitHub, the Node/Python package registries, and PingOne.

The installer bootstraps PingOne and writes the local environment files needed
by Compose. `--deployment-only` skips optional LLM provider and editor/developer
MCP setup. It still performs required PingOne bootstrap. For noninteractive
bootstrap, also set `ASSUME_YES=1` and provide all three
`PINGONE_BOOTSTRAP_ENV_ID`, `PINGONE_BOOTSTRAP_CLIENT_ID`, and
`PINGONE_BOOTSTRAP_CLIENT_SECRET` variables.

```bash
cd /path/to/AI-DEMO2
./install.sh --mode docker-terraform --deployment-only

cd ~/AI-demo/terraform # or the install directory printed by the installer
cp terraform.tfvars.example terraform.tfvars
terraform init
terraform fmt -check -recursive
terraform validate
terraform plan -out=ai-demo.tfplan
terraform apply ai-demo.tfplan
```

The current installer may also be run without an explicit mode; choose Docker
when prompted.

### Verify the deployment

After apply completes, inspect the Compose status. The API should report
`healthy`, the UI should be `running`, and no required container should be
restarting:

```bash
docker compose -p ai-demo -f ../docker-compose.yml ps
```

Then open `https://local.ping-devops.com:4000`. A browser certificate warning
usually means mkcert's local CA was not trusted or the browser needs restarting.

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
be provisioned for the user. The guided installer requires Node.js 22+, Python
3.10+, Git, Docker, Terraform 1.6+, kubectl, `kubelogin`, and `gh`. The deployer
needs cluster access and permission to manage the app's Kubernetes resources in
the namespace (including Deployments and PersistentVolumeClaims), a GitHub
account authorized to publish to GHCR, and a PingOne Worker application with
the `Identity Data Admin` role.

First-time setup asks for the PingOne Environment ID, Worker Client ID,
Worker Client Secret, and existing SE namespace:

```bash
SE_NAMESPACE=ping-devops-YOURNAME ./install.sh --mode se-terraform --deployment-only
```

Before deploying or updating, authenticate to the SE cluster and build/push the
images. Use the same owner for both commands so the image names match:

```bash
kubectl config use-context us
gh auth login
export GITHUB_OWNER=alex
./run-pingaws.sh build
```

Copy the Terraform variables file if it does not already exist. The wrapper
supplies the SE target, namespace, and context to the Terraform plan. It derives
`image_repository` from `GITHUB_OWNER`, or accepts an explicit
`IMAGE_REPOSITORY` if you publish elsewhere:

For future plans and teardown, also set these values in `terraform.tfvars`:
`target = "se"`, the existing `namespace`, `kubernetes_context`, and the same
`image_repository`. The wrapper passes its resolved values directly to the
first plan; matching the file keeps later plans and destroy pointed at the SE
deployment.

```hcl
target             = "se"
namespace          = "ping-devops-YOURNAME"
kubernetes_context = "us"
image_repository   = "ghcr.io/YOUR_GITHUB_OWNER"
```

The image repository must match the repository used by `run-pingaws.sh build`.
The wrapper creates namespace-scoped secrets from the bootstrap output and
checks that they exist before applying Terraform.

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

### Troubleshooting

- **`docker info` fails:** Start Docker Desktop or OrbStack and retry.
- **PingOne bootstrap fails:** Confirm the Environment ID, region, Worker
  Client ID, and Client Secret, and verify the Worker has `Identity Data Admin`.
- **Terraform reports a missing `.env`:** Complete `install.sh` bootstrap in
  the repository before applying Terraform.
- **SE preflight fails:** Confirm `kubectl config current-context`, namespace
  access, and that the existing namespace has `ai-demo-secrets`.
- **SE pods show `ImagePullBackOff`:** Confirm `GITHUB_OWNER` matches the GHCR
  repository used to build and push, and that the cluster can pull those images.
- **The UI does not load:** Check `docker compose ... ps` and inspect service
  output with `docker compose -p ai-demo -f ../docker-compose.yml logs -f`.

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
