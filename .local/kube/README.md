# SE DevOps kubeconfig (local only)

**Do not commit** files in this folder except this README.

The Ping SE cluster kubeconfig is stored here as a convenience copy alongside the repo:

    .local/kube/ping-se-devops-config

Canonical backup (same file):

    ~/.kube/backups/ping-se-devops-config

## Install or restore

From repo root:

```bash
./scripts/install-se-kubeconfig.sh
kubectl config use-context us
kubens ping-devops-cmuir
```

Source: Ping Secret Server — https://pingidentity.delinea.app/view/vault/secrets/32608/general

Refresh the backup when Ping rotates cluster access:

```bash
cp ~/Downloads/config .local/kube/ping-se-devops-config
cp ~/Downloads/config ~/.kube/backups/ping-se-devops-config
./scripts/install-se-kubeconfig.sh
```
