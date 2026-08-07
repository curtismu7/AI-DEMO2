#!/usr/bin/env bash
# install.sh — Standalone bootstrapper for the AI Demo.
#
# Designed to be curl-piped on a brand-new Mac — no prior tooling required:
#   curl -fsSL https://raw.githubusercontent.com/curtismu7/AI-demo/main/install.sh | bash
#
# What it does (in order):
#   1. Asks how you want to run the demo — determines what gets installed:
#        • Local server    (./run.sh)          — Node + Python, no Docker/K8s
#        • K8s / OrbStack  (./run-k8.sh)       — Docker + kubectl via OrbStack
#        • Ping SE cluster (./run-pingaws.sh) — Docker Desktop + kubelogin + kubectx
#        • K8s / EKS       (./run-k8.sh aws-all) — Docker + kubectl + AWS CLI
#   2. Installs Homebrew if missing (macOS).
#   3. Installs git via Homebrew if missing.
#   4. Installs nvm + Node 20 if Node is missing or below v20.
#   5. Installs GitHub CLI (gh) — used for GHCR image pushes on the EKS path.
#   6. Installs Python 3.12 via Homebrew if Python 3.10+ is not present
#      (required by the AI agent services on all paths).
#   7. Installs mkcert + trusts root CA (sudo) — TLS certs needed everywhere.
#   8. Mode-specific tool installs:
#        Local     — offers llama.cpp (local LLM for NL routing)
#        OrbStack  — installs OrbStack (Docker + kubectl); llama.cpp runs in-cluster
#        SE        — installs Docker Desktop + kubelogin + kubectx + kubectl
#        EKS       — installs OrbStack + AWS CLI; llama.cpp runs in-cluster
#   9. Confirms the install directory (default: $PWD/AI-demo).
#  10. Clones the repo (or pulls latest main on an existing checkout).
#  11. Generates TLS certs for api.ping.demo into certs/.
#  11b. Prompts for the PingOne Worker app creds (Environment ID, Client ID,
#       Client Secret). Provided → setup runs hands-free via PINGONE_BOOTSTRAP_*;
#       skipped → setup falls back to its browser cred form.
#  12. Runs `npm run setup:fresh` — provisions PingOne, writes .env files,
#      builds the codegraph index.
#  13. Offers optional LLM provider setup (all skippable):
#        • Anthropic — Claude cloud API (sk-ant-… key, billed per token)
#        • OpenAI    — GPT-4o etc.   (sk-… key, billed per token)
#        • LM Studio — local OpenAI-compatible server (local mode only)
#  14. Points Claude Code's `pingone` admin MCP server (.mcp.json) at your
#      PingOne env: prompts for the environment id (defaults to the provisioned
#      env) + OAuth clientId and patches .mcp.json. Skippable.
#  15. Builds the `banking-dev` MCP server (dev_mcp/banking-dev) and sets the
#      `banking-gateway` MCP URL scheme (https for local, http for Docker/K8s)
#      so both Claude Code dev-tool servers connect.
#
# Designed to be safe to re-run: already-installed tools are skipped,
# an existing checkout just pulls latest, and setup:fresh is idempotent.
#
# Env-var overrides (mostly for testing / CI):
#   INSTALL_DIR       Override the install path (default: ./AI-demo)
#   REPO_URL          Override the git repo URL
#   BANKING_BRANCH    Branch to check out (default: main)
#   DRY_RUN           Set to 1 to print commands without executing
#   ASSUME_YES        Set to 1 to skip the confirmation prompt

set -euo pipefail

# ── Constants ─────────────────────────────────────────────────────────────────

REPO_URL="${REPO_URL:-https://github.com/curtismu7/AI-demo.git}"
BRANCH="${BANKING_BRANCH:-main}"
DEFAULT_DIR_NAME="AI-demo"
NODE_REQUIRED_MAJOR="20"
NODE_MIN_MAJOR="20"

# ── Style ─────────────────────────────────────────────────────────────────────

# Detect TTY for color
if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; BLUE=''; RESET=''
fi

info()   { echo "${BLUE}${BOLD}==>${RESET} $*"; }
ok()     { echo "${GREEN}✓${RESET}  $*"; }
warn()   { echo "${YELLOW}!${RESET}  $*"; }
err()    { echo "${RED}✗${RESET}  $*" >&2; }
fatal()  { err "$*"; exit 1; }

# Ping email validation — install.sh runs via curl before the repo exists, so keep
# this inline (scripts/ping-email.sh is used after clone by run-k8.sh etc.).
is_valid_ping_email() {
  local email
  email="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d ' "')"
  [[ -n "$email" && "$email" == *@pingidentity.com ]]
}

read_ping_email_install() {
  local prompt="${1:-  Your Ping email (e.g. cmuir@pingidentity.com): }"
  local _input="" _valid=""
  while true; do
    _input=""
    if [[ -r /dev/tty ]]; then
      read -r -p "$prompt" _input </dev/tty 2>/dev/null || true
    fi
    _input="$(printf '%s' "$_input" | tr -d ' "')"
    [[ -z "$_input" ]] && return 1
    if is_valid_ping_email "$_input"; then
      printf '%s' "$(printf '%s' "$_input" | tr '[:upper:]' '[:lower:]')"
      return 0
    fi
    warn "Must be a @pingidentity.com address — personal email is not allowed."
  done
}

# ── Pre-flight ────────────────────────────────────────────────────────────────

# Install Homebrew if missing (macOS only). On Linux this is a no-op.
ensure_homebrew() {
  if command -v brew >/dev/null 2>&1; then return 0; fi
  if [[ "$(uname)" != "Darwin" ]]; then return 0; fi
  info "Homebrew not found — installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  # Add brew to PATH for the rest of this session (Apple Silicon vs Intel paths)
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  command -v brew >/dev/null 2>&1 || fatal "Homebrew install failed. Install manually: https://brew.sh"
  ok "Homebrew installed."
}

# Ensure git is available, installing via brew on macOS if needed.
ensure_git() {
  if command -v git >/dev/null 2>&1; then return 0; fi
  if command -v brew >/dev/null 2>&1; then
    info "Installing git via Homebrew..."
    brew install git --quiet && ok "git installed." || fatal "git install failed."
  else
    fatal "git not found. Install it: https://git-scm.com/downloads"
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || fatal "Required command not found: $1
  Install it and re-run install.sh.
  $2"
}

install_gh_cli() {
  if command -v gh >/dev/null 2>&1; then
    return 0
  fi
  if command -v brew >/dev/null 2>&1; then
    info "Installing GitHub CLI (gh) via Homebrew..."
    brew install gh --quiet && ok "GitHub CLI installed." || warn "gh install failed — you can install it later: brew install gh"
  else
    warn "GitHub CLI (gh) not found. Install it for PR workflows: https://cli.github.com"
  fi
}

# Install Node via nvm if missing or below the required major.
# After install, exports NVM_DIR and sources nvm.sh so the rest of this
# shell session can use `node` and `npm` without a shell restart.
ensure_node() {
  local NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

  # Helper: load nvm into the current shell if it exists but isn't active.
  # nvm.sh performs internal `return N` calls (auto-use, version checks) that
  # can be non-zero. Guard with || true so set -e doesn't abort the installer.
  _load_nvm() {
    if [[ -s "$NVM_DIR/nvm.sh" ]]; then
      export NVM_DIR
      # shellcheck disable=SC1091
      \. "$NVM_DIR/nvm.sh" --no-use || true
    fi
  }

  # Helper: return the current Node major (empty if node not found).
  _node_major() {
    command -v node >/dev/null 2>&1 || { echo ''; return; }
    node -e "process.stdout.write(process.version.replace('v','').split('.')[0])" 2>/dev/null
  }

  _load_nvm
  local major
  major="$(_node_major)"

  if [[ -n "$major" && "$major" -ge "${NODE_MIN_MAJOR}" ]]; then
    ok "Node $(node --version) already installed."
    return 0
  fi

  # Node missing or too old — install nvm if needed, then install Node.
  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    info "Installing nvm (Node Version Manager)..."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash \
      || fatal "nvm install failed. Install manually: https://github.com/nvm-sh/nvm"
    _load_nvm
    command -v nvm >/dev/null 2>&1 || fatal "nvm installed but not on PATH. Open a new terminal and re-run install.sh."
    ok "nvm installed."
  fi

  if [[ -n "$major" && "$major" -lt "${NODE_MIN_MAJOR}" ]]; then
    info "Node ${major} found but ${NODE_MIN_MAJOR}+ required — installing Node ${NODE_REQUIRED_MAJOR}..."
  else
    info "Node not found — installing Node ${NODE_REQUIRED_MAJOR} via nvm..."
  fi

  nvm install "${NODE_REQUIRED_MAJOR}" || fatal "nvm install ${NODE_REQUIRED_MAJOR} failed."
  nvm use "${NODE_REQUIRED_MAJOR}"     || fatal "nvm use ${NODE_REQUIRED_MAJOR} failed."
  ok "Node $(node --version) installed via nvm."

  # Ensure nvm is sourced in the user's shell profile so future terminals work.
  local profile=""
  if [[ -f "$HOME/.zshrc" ]];  then profile="$HOME/.zshrc"
  elif [[ -f "$HOME/.bashrc" ]]; then profile="$HOME/.bashrc"
  elif [[ -f "$HOME/.bash_profile" ]]; then profile="$HOME/.bash_profile"
  fi
  if [[ -n "$profile" ]] && ! grep -q 'NVM_DIR' "$profile" 2>/dev/null; then
    cat >> "$profile" <<'NVMRC'

# Added by AI Demo installer — loads nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
NVMRC
    ok "Added nvm init to ${profile} (takes effect in new shells)."
  fi
}

# Ensure Python 3.10+ is available. The Python agents (langchain, openai,
# pydantic) require it; run.sh creates per-service venvs at startup.
# Installs python@3.12 via Homebrew on macOS if no suitable version is found.
ensure_python() {
  local py=""
  for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null 2>&1; then
      local _major _minor
      _major=$("$candidate" -c "import sys; print(sys.version_info.major)" 2>/dev/null || echo 0)
      _minor=$("$candidate" -c "import sys; print(sys.version_info.minor)" 2>/dev/null || echo 0)
      if [[ "$_major" -ge 3 && "$_minor" -ge 10 ]]; then
        py="$candidate"
        break
      fi
    fi
  done

  if [[ -n "$py" ]]; then
    ok "Python $($py --version 2>&1 | awk '{print $2}') already installed."
    return 0
  fi

  if command -v brew >/dev/null 2>&1; then
    info "Python 3.10+ not found — installing python@3.12 via Homebrew..."
    brew install python@3.12 --quiet || fatal "python@3.12 install failed."
    # Homebrew installs python3.12 as a keg; link it onto PATH.
    brew link python@3.12 --force --overwrite 2>/dev/null || true
    ok "Python $(python3.12 --version 2>&1 | awk '{print $2}') installed."
  else
    warn "Python 3.10+ not found and Homebrew is unavailable."
    warn "Install Python 3.10+ manually from https://python.org and re-run install.sh."
  fi
}

# Install OrbStack (Docker + Kubernetes) if Docker is not already present.
# OrbStack provides both `docker` and `kubectl` on macOS in a single install.
# If Docker Desktop is already installed we leave it alone.
ensure_orbstack() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    ok "Docker already running."
    # Still check kubectl — user may have Docker but not K8s tools.
    if ! command -v kubectl >/dev/null 2>&1; then
      if command -v brew >/dev/null 2>&1; then
        info "kubectl not found — installing via Homebrew..."
        brew install kubectl --quiet && ok "kubectl installed." \
          || warn "kubectl install failed — install manually: brew install kubectl"
      else
        warn "kubectl not found. Install it: brew install kubectl"
      fi
    else
      ok "kubectl already installed."
    fi
    return 0
  fi

  if [[ "$(uname)" != "Darwin" ]]; then
    warn "Docker not found. Install Docker for your platform: https://docs.docker.com/get-docker/"
    return 0
  fi

  if command -v brew >/dev/null 2>&1; then
    info "Docker not found — installing OrbStack (Docker + Kubernetes for Mac)..."
    brew install orbstack --quiet || fatal "OrbStack install failed. Install manually: https://orbstack.dev"
    ok "OrbStack installed."
    info "Launching OrbStack..."
    open -a OrbStack 2>/dev/null || true
    # Wait up to 30 s for the Docker socket to appear.
    local waited=0
    while [[ $waited -lt 30 ]]; do
      if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
        ok "Docker daemon ready."
        return 0
      fi
      sleep 2; (( waited += 2 ))
    done
    warn "OrbStack installed but Docker daemon not yet ready."
    warn "Open OrbStack from your Applications folder, then re-run ./run.sh or ./run-k8.sh."
  else
    warn "Docker not found and Homebrew is unavailable."
    warn "Install OrbStack from https://orbstack.dev (includes Docker + Kubernetes)."
  fi
}

# Install Docker Desktop — used for the SE cluster path where we only need
# Docker to build/push images; OrbStack's local K8s is not required.
ensure_docker_desktop() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    ok "Docker already running."
    return 0
  fi

  if [[ "$(uname)" != "Darwin" ]]; then
    warn "Docker not found. Install Docker for your platform: https://docs.docker.com/get-docker/"
    return 0
  fi

  if command -v brew >/dev/null 2>&1; then
    info "Docker not found — installing Docker Desktop via Homebrew..."
    brew install --cask docker-desktop --quiet || fatal "Docker Desktop install failed. Install manually: https://www.docker.com/products/docker-desktop/"
    ok "Docker Desktop installed."
    info "Launching Docker Desktop..."
    open -a Docker 2>/dev/null || true
    local waited=0
    while [[ $waited -lt 45 ]]; do
      if docker info >/dev/null 2>&1; then
        ok "Docker daemon ready."
        return 0
      fi
      sleep 3; (( waited += 3 ))
    done
    warn "Docker Desktop installed but daemon not yet ready."
    warn "Open Docker Desktop from your Applications folder, wait for it to start, then re-run."
  else
    warn "Docker not found and Homebrew is unavailable."
    warn "Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
  fi
}

# Install K8s tools needed for the Ping SE DevOps cluster:
#   kubelogin  — OIDC kubectl auth (PingOne browser login popup)
#   jwt-cli    — inspect tokens during debugging
#   kubectx    — switch K8s contexts; includes kubens
#   kubectl    — K8s CLI
ensure_se_k8s_tools() {
  if ! command -v brew >/dev/null 2>&1; then
    warn "Homebrew unavailable — install K8s tools manually:"
    warn "  brew install int128/kubelogin/kubelogin mike-engel/jwt-cli/jwt-cli kubectx kubectl"
    return 0
  fi

  local missing=()
  command -v kubelogin >/dev/null 2>&1 || missing+=("int128/kubelogin/kubelogin")
  command -v jwt       >/dev/null 2>&1 || missing+=("mike-engel/jwt-cli/jwt-cli")
  command -v kubectx   >/dev/null 2>&1 || missing+=("kubectx")
  command -v kubectl   >/dev/null 2>&1 || missing+=("kubectl")

  if [[ ${#missing[@]} -eq 0 ]]; then
    ok "SE K8s tools already installed (kubelogin, jwt-cli, kubectx, kubectl)."
    return 0
  fi

  info "Installing SE K8s tools: ${missing[*]}..."
  for pkg in "${missing[@]}"; do
    case "$pkg" in
      int128/kubelogin/kubelogin)
        brew tap int128/kubelogin 2>/dev/null || true
        brew install int128/kubelogin/kubelogin --quiet \
          && ok "kubelogin installed." \
          || warn "kubelogin install failed — run: brew install int128/kubelogin/kubelogin"
        ;;
      mike-engel/jwt-cli/jwt-cli)
        brew tap mike-engel/jwt-cli 2>/dev/null || true
        brew install mike-engel/jwt-cli/jwt-cli --quiet \
          && ok "jwt-cli installed." \
          || warn "jwt-cli install failed — brew tap mike-engel/jwt-cli && brew install jwt-cli"
        ;;
      *)
        brew install "$pkg" --quiet \
          && ok "$pkg installed." \
          || warn "$pkg install failed — run: brew install $pkg"
        ;;
    esac
  done
}

# Install AWS CLI — required for the EKS/Ping deployment path.
ensure_aws_cli() {
  if command -v aws >/dev/null 2>&1; then
    ok "AWS CLI already installed."
    return 0
  fi
  if command -v brew >/dev/null 2>&1; then
    info "Installing AWS CLI via Homebrew..."
    brew install awscli --quiet && ok "AWS CLI installed." \
      || warn "AWS CLI install failed — install manually: brew install awscli"
  else
    warn "AWS CLI not found. Install it: https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html"
  fi
}

# Install mkcert, trust the root CA, and generate TLS certs for api.ping.demo.
# Both run.sh (local) and run-k8.sh (K8s via create-secrets.sh) need the cert
# files in certs/ before they can start. setupFresh.js does the same steps but
# runs after this function, so doing it here means certs exist from the very
# first ./run.sh / ./run-k8.sh call even if setupFresh later no-ops on them.
ensure_mkcert() {
  # Step 1 — install mkcert binary
  if ! command -v mkcert >/dev/null 2>&1; then
    if command -v brew >/dev/null 2>&1; then
      info "Installing mkcert via Homebrew..."
      brew install mkcert --quiet \
        && ok "mkcert installed." \
        || { warn "mkcert install failed — install manually: brew install mkcert"; return 0; }
    else
      warn "mkcert not found and Homebrew unavailable — install manually: brew install mkcert"
      return 0
    fi
  else
    ok "mkcert already installed."
  fi

  # Step 2 — install root CA so browsers/curl trust the generated certs
  local ca_root
  ca_root="$(mkcert -CAROOT 2>/dev/null)" || ca_root=""
  if [[ -n "$ca_root" && ! -f "$ca_root/rootCA.pem" ]]; then
    info "Installing mkcert root CA (requires sudo — enables HTTPS in your browser)..."
    if sudo mkcert -install 2>/dev/null; then
      sudo chown -R "$(whoami)" "$ca_root" 2>/dev/null || true
      ok "mkcert root CA installed and trusted."
    else
      warn "Could not install root CA — run 'sudo mkcert -install' manually."
    fi
  else
    ok "mkcert root CA already trusted."
  fi

  # Step 3 — generate TLS certs for api.ping.demo into certs/
  # The install dir isn't known yet at this point, so we skip cert generation
  # here; setup_certs() is called after clone_or_update() with the real path.
  # This function is intentionally split: binary+CA now, cert files after clone.
  :
}

# Generate TLS certs in <install_dir>/certs/ and copy in the root CA.
# Called after the repo is cloned so we know the exact install path.
# Safe to re-run: skips if cert files already exist.
setup_certs() {
  local dir="$1"
  local certs_dir="${dir}/certs"

  command -v mkcert >/dev/null 2>&1 || { warn "mkcert not found — skipping cert generation."; return 0; }

  local ca_root cert_file key_file
  ca_root="$(mkcert -CAROOT 2>/dev/null)" || ca_root=""
  cert_file="${certs_dir}/api.ping.demo+2.pem"
  key_file="${certs_dir}/api.ping.demo+2-key.pem"

  mkdir -p "$certs_dir"

  # Copy root CA into certs/ so Docker nginx (run.sh) and K8s secret
  # (create-secrets.sh) can mount and trust it.
  if [[ -n "$ca_root" && -f "$ca_root/rootCA.pem" && ! -f "$certs_dir/rootCA.pem" ]]; then
    cp "$ca_root/rootCA.pem" "$certs_dir/rootCA.pem"
    ok "Copied mkcert rootCA.pem into certs/."
  fi

  if [[ -f "$cert_file" && -f "$key_file" ]]; then
    ok "TLS certs already present in certs/."
    return 0
  fi

  info "Generating TLS certs for api.ping.demo..."
  ( cd "$certs_dir" && mkcert -cert-file api.ping.demo+2.pem -key-file api.ping.demo+2-key.pem api.ping.demo local.ping-devops.com demo-api-server localhost 127.0.0.1 ) \
    && ok "TLS certs generated in certs/." \
    || warn "mkcert cert generation failed — run 'cd ${certs_dir} && mkcert -cert-file api.ping.demo+2.pem -key-file api.ping.demo+2-key.pem api.ping.demo local.ping-devops.com demo-api-server localhost 127.0.0.1' manually."
}

# Offer to install llama.cpp (local LLM for NL intent fallback).
# - run.sh (Docker Compose / bare-metal): uses a host-native llama-server on localhost:8090.
# - run-k8.sh (Kubernetes): deploys an in-cluster llama.cpp pod automatically —
#   no host install required for the K8s path.
# We ask rather than auto-install because the GGUF model is a multi-GB download.
ensure_llamacpp() {
  if command -v llama-server >/dev/null 2>&1; then
    ok "llama.cpp already installed."
    return 0
  fi

  echo ""
  echo "  ${BOLD}llama.cpp${RESET} (local LLM) enables the NL intent fallback in the demo."
  echo "  Without it, the demo still works but will not route natural-language"
  echo "  requests through a local model."
  echo ""
  echo "  Note: if you plan to use ${BOLD}./run-k8.sh${RESET} (Kubernetes), llama.cpp runs"
  echo "  in-cluster automatically — you can skip this host install."
  echo ""

  local install_it
  if ask_yes_no "Install llama.cpp now? [Y/n] " yes; then
    install_it=true
  else
    install_it=false
  fi

  if [[ "$install_it" != "true" ]]; then
    warn "Skipping llama.cpp — NL fallback disabled for run.sh. Install later: https://github.com/ggml-org/llama.cpp"
    return 0
  fi

  if [[ "$(uname)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
    info "Installing llama.cpp via Homebrew..."
    brew install llama.cpp --quiet && ok "llama.cpp installed." \
      || { warn "brew install llama.cpp failed — build manually from https://github.com/ggml-org/llama.cpp"; return 0; }
  else
    warn "llama.cpp not found and Homebrew unavailable — build from source: https://github.com/ggml-org/llama.cpp"
    return 0
  fi

  # Local models are served through the 2-tier LLM proxy on :8090
  # (demo_llm_proxy/router.js) in swap mode — one tier loaded at a time,
  # swapped by the tier-manager (:8097). Never a raw llama-server on :8090.
  if command -v llama-server >/dev/null 2>&1; then
    info "Local models are served via the 2-tier LLM proxy on :8090 (swap mode)."
    info "  Verify tier GGUFs:   bash demo_llm_proxy/download-models.sh"
    info "  Load smallest tier:  bash demo_llm_proxy/start-local-models.sh ensure 8091"
  fi
}

# Offer oMLX on macOS as the recommended Mac fast path for agent chip sessions.
# Optional — llama.cpp remains the cross-platform default.
ensure_omlx() {
  [[ "$(uname)" == "Darwin" ]] || return 0
  if command -v omlx >/dev/null 2>&1; then
    ok "oMLX already installed (Mac fast path: LLM_BACKEND=omlx)."
    return 0
  fi

  echo ""
  echo "  ${BOLD}oMLX${RESET} (optional Mac fast path) speeds up agent chip and tool-loop"
  echo "  sessions with SSD-persisted KV cache. Recommended on Apple Silicon for"
  echo "  daily dev; Docker/K8s still use llama.cpp by default."
  echo ""
  echo "  After install: bash demo_llm_proxy/download-omlx-models.sh fetch"
  echo "  Then run with:  LLM_BACKEND=omlx ./run.sh"
  echo ""

  if ! ask_yes_no "Install oMLX for Mac agent dev? [y/N] " no; then
    info "Skipping oMLX — use llama.cpp (default) or install later from demo_llm_proxy/README.md"
    return 0
  fi

  if ! command -v brew >/dev/null 2>&1; then
    warn "Homebrew required for oMLX — see https://github.com/jundot/omlx"
    return 0
  fi

  info "Adding oMLX tap and trusting it (Homebrew 6.0+)..."
  brew tap jundot/omlx https://github.com/jundot/omlx 2>/dev/null || true
  brew trust jundot/omlx 2>/dev/null || true
  info "Installing oMLX..."
  if brew install omlx --quiet; then
    ok "oMLX installed. Download MLX models: bash demo_llm_proxy/download-omlx-models.sh fetch"
    ok "Run with: LLM_BACKEND=omlx ./run.sh"
  else
    warn "brew install omlx failed — see https://github.com/jundot/omlx"
  fi
}

# Install the launchd watchdog that keeps llama-server tiers alive across logins.
# macOS only. Without this, tiers die and stay dead until a manual kick.
ensure_llm_launchd() {
  [[ "$(uname)" == "Darwin" ]] || return 0
  if ! command -v llama-server >/dev/null 2>&1 && ! command -v omlx >/dev/null 2>&1; then
    return 0  # nothing to supervise
  fi
  info "Installing LLM launchd watchdog (keeps tiers alive at login and every 3 min)..."
  bash demo_llm_proxy/install-launchd.sh \
    && ok "LLM launchd watchdog installed (com.ai-demo.llama-models)" \
    || warn "launchd install failed — run manually: bash demo_llm_proxy/install-launchd.sh"
}

# Ensure llama.cpp is installed and the 2-tier LLM proxy is serving :8090.
# :8090 is ALWAYS the proxy (demo_llm_proxy/router.js → tier llama-servers on
# :8091 and :8096) — never a raw llama-server pointing straight at one model.
# Called for all run modes where the host needs a local LLM (local, docker, se).
ensure_codegraph_llamacpp() {
  # Install if missing
  if ! command -v llama-server >/dev/null 2>&1; then
    info "Installing llama.cpp (required for Code Explorer)..."
    if [[ "$(uname)" == "Darwin" ]] && command -v brew >/dev/null 2>&1; then
      brew install llama.cpp --quiet && ok "llama.cpp installed." \
        || { warn "brew install llama.cpp failed — build from https://github.com/ggml-org/llama.cpp"; return 0; }
    else
      warn "llama.cpp not found and Homebrew unavailable — build from https://github.com/ggml-org/llama.cpp"
      return 0
    fi
  else
    ok "llama.cpp already installed."
  fi

  # Reuse whatever healthy proxy already serves :8090 (llm-proxy container in
  # docker mode, or a host router started earlier).
  if curl -sf --max-time 2 http://localhost:8090/health >/dev/null 2>&1; then
    ok "LLM proxy already serving :8090."
    return 0
  fi

  if [[ -f demo_llm_proxy/start-local-models.sh ]]; then
    info "Starting LLM proxy stack in swap mode (tier-manager :8097 + smallest tier + router :8090)..."
    if ! curl -sf --max-time 2 http://localhost:8097/health >/dev/null 2>&1; then
      nohup node demo_llm_proxy/tier-manager.js > /tmp/demo-tier-manager.log 2>&1 &
      echo $! > /tmp/demo-tier-manager.pid
    fi
    bash demo_llm_proxy/start-local-models.sh ensure 8091 \
      || { warn "smallest tier failed to start — verify GGUFs: bash demo_llm_proxy/download-models.sh"; return 0; }
    LLAMA_HOST=127.0.0.1 LLM_PROXY_PORT=8090 nohup node demo_llm_proxy/router.js > /tmp/demo-llm-proxy.log 2>&1 &
    echo $! > /tmp/demo-llm-proxy.pid
    local waited=0
    while [[ $waited -lt 60 ]]; do
      if curl -sf --max-time 2 http://localhost:8090/health >/dev/null 2>&1; then
        ok "LLM proxy ready on :8090 (routing tiers 8091 + 8096)."
        return 0
      fi
      sleep 3; (( waited += 3 ))
    done
    warn "LLM proxy not ready yet — check /tmp/demo-llm-proxy.log and /tmp/llama-models/"
  else
    warn "demo_llm_proxy/ not found (run from the repo root) — :8090 left unserved; no raw llama-server fallback."
  fi
}

# ── Confirm install directory ─────────────────────────────────────────────────

confirm_dir() {
  local target="$1"
  local exists="$2"

  echo ""
  echo "${BOLD}AI Demo install${RESET}"
  echo "────────────────────"
  echo "  Repo:        ${REPO_URL}"
  echo "  Branch:      ${BRANCH}"
  echo "  Install to:  ${BOLD}${target}${RESET}"
  if [[ "$exists" == "yes" ]]; then
    if [[ -d "$target/.git" ]]; then
      echo "               (existing checkout — will fetch latest if remote matches)"
    else
      echo "               (directory exists — will refuse to clobber if non-empty)"
    fi
  else
    echo "               (directory will be created)"
  fi
  echo ""

  if [[ "${ASSUME_YES:-0}" == "1" ]]; then
    return 0
  fi

  if ask_yes_no "Proceed? [Y/n] " yes; then
    return 0
  fi

  # User said no — let them type a different path instead of just exiting.
  echo ""
  local custom=""
  if [[ -r /dev/tty ]]; then
    read -r -p "  Enter a different install path (or press Enter to cancel): " custom </dev/tty 2>/dev/null || true
  fi
  custom="${custom/#\~/$HOME}"   # expand leading ~
  custom="${custom%/}"           # strip trailing slash
  if [[ -n "$custom" ]]; then
    export INSTALL_DIR="$custom"
    return 0
  fi

  info "Aborted. To install elsewhere set INSTALL_DIR and re-run:"
  echo "  curl -fsSL ${REPO_URL%.git}/raw/main/install.sh | INSTALL_DIR=~/my-path bash"
  exit 0
}

# Ask a yes/no question, reading from /dev/tty under curl-pipe (where stdin is
# the HTTP body). Second arg is the default ('yes' or 'no'). Returns 0 on yes,
# 1 on no. Returns the default if no TTY is available.
ask_yes_no() {
  local prompt="$1"
  local default="${2:-yes}"
  local answer=""
  if [[ -t 0 ]]; then
    read -r -p "$prompt" answer
  elif [[ -r /dev/tty ]]; then
    # Stdin is the curl-pipe HTTP body, but the user's keyboard is at /dev/tty.
    # We test for readability with `-r` (not `-t 0`, which checks for immediately
    # available input — wrong test; the user hasn't typed yet).
    # shellcheck disable=SC2162
    read -p "$prompt" answer </dev/tty
  else
    [[ "${ASSUME_YES:-0}" == "1" ]] || warn "No TTY available — using default ($default). Set ASSUME_YES=1 to silence this warning."
    [[ "$default" == "yes" ]] && return 0 || return 1
  fi

  # Empty answer → default
  if [[ -z "$answer" ]]; then
    [[ "$default" == "yes" ]] && return 0 || return 1
  fi
  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    n|N|no|NO)   return 1 ;;
    *) [[ "$default" == "yes" ]] && return 0 || return 1 ;;
  esac
}

# ── Clone or update ───────────────────────────────────────────────────────────

clone_or_update() {
  local dir="$1"

  # Existing-target handling:
  #   - $dir doesn't exist        → fresh clone (the happy path)
  #   - $dir is a file             → refuse (user pointed at a regular file)
  #   - $dir/.git exists, remote matches → fetch + ff-only pull
  #   - $dir/.git exists, remote different → refuse (probably a fork/unrelated repo)
  #   - $dir exists but is not a git repo → refuse unless empty
  if [[ -e "$dir" && ! -d "$dir" ]]; then
    err "Path exists and is not a directory: ${dir}"
    echo "" >&2
    echo "  Remove or rename it, then re-run." >&2
    exit 1
  fi

  if [[ -d "$dir/.git" ]]; then
    # Verify the existing checkout actually points at this repo. If it points
    # somewhere else (a fork, an unrelated project), pulling could destroy work.
    local existing_remote
    existing_remote="$( cd "$dir" && git remote get-url origin 2>/dev/null || echo '' )"
    if [[ -n "$existing_remote" && "$existing_remote" != "$REPO_URL" ]]; then
      err "Existing git repo at ${dir} has a different remote:"
      echo "    expected: ${REPO_URL}" >&2
      echo "    found:    ${existing_remote}" >&2
      echo "" >&2
      echo "  This is likely an unrelated checkout (a fork? a different project?)." >&2
      echo "  Pick a different install path, or remove ${dir} and re-run:" >&2
      echo "    curl -fsSL ${REPO_URL%.git}/raw/main/install.sh | INSTALL_DIR=/some/other/path bash" >&2
      exit 1
    fi
    info "Existing checkout found — fetching latest ${BRANCH}..."
    if [[ "${DRY_RUN:-0}" == "1" ]]; then
      echo "  DRY: cd $dir && git fetch origin $BRANCH && git checkout $BRANCH && git pull --ff-only"
    else
      ( cd "$dir" && git fetch origin "$BRANCH" --quiet && git checkout "$BRANCH" --quiet && git pull --ff-only --quiet )
    fi
    ok "Updated $dir to latest $BRANCH"
    return 0
  fi

  if [[ -d "$dir" ]]; then
    # Directory exists but isn't a git checkout. Empty dirs we'll use; non-empty
    # dirs we refuse so we don't clobber whatever's there.
    local entry_count
    entry_count=$(find "$dir" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$entry_count" != "0" ]]; then
      err "Directory exists and is not a git checkout: ${dir}"
      echo "" >&2
      echo "  ${dir} contains ${entry_count} file(s) we don't recognize." >&2
      echo "  This is probably an unrelated directory we shouldn't touch." >&2
      echo "" >&2
      echo "  Either remove it:" >&2
      echo "    rm -rf ${dir}" >&2
      echo "  Or install somewhere else:" >&2
      echo "    curl -fsSL ${REPO_URL%.git}/raw/main/install.sh | INSTALL_DIR=/some/other/path bash" >&2
      exit 1
    fi
    # Empty existing dir — git clone refuses to clone INTO an existing dir,
    # so we remove the empty dir first. Safe because we just verified it's empty.
    info "Removing empty target directory before clone: ${dir}"
    [[ "${DRY_RUN:-0}" == "1" ]] || rmdir "$dir"
  fi

  info "Cloning ${REPO_URL} into ${dir}..."
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    echo "  DRY: git clone --branch $BRANCH $REPO_URL $dir"
  else
    git clone --branch "$BRANCH" --quiet "$REPO_URL" "$dir"
  fi
  ok "Cloned to $dir"
}

# ── PingOne worker-token credentials ─────────────────────────────────────────
#
# Bootstrap needs an existing PingOne Worker app (role: Identity Data Admin) to
# call the Management API and provision everything else. That app is created by
# hand in the PingOne console — we can't bootstrap it. Collect its creds here and
# hand them to setup:fresh via the documented PINGONE_BOOTSTRAP_* env vars
# (+ --non-interactive) so the user never has to touch the browser cred form.
# Pressing Enter at the first prompt skips this and falls back to setup:fresh's
# own form (which also reuses creds cached at ~/.ai-demo-creds).
NONINT_FLAG=""
prompt_worker_creds() {
  # Already provided via env (scripted / CI) → honor and go non-interactive.
  if [[ -n "${PINGONE_BOOTSTRAP_ENV_ID:-}" && -n "${PINGONE_BOOTSTRAP_CLIENT_ID:-}" && -n "${PINGONE_BOOTSTRAP_CLIENT_SECRET:-}" ]]; then
    NONINT_FLAG="--non-interactive"
    ok "Using PINGONE_BOOTSTRAP_* from environment for worker creds."
    return 0
  fi

  echo ""
  echo "${BOLD}── PingOne worker-token credentials ────────────────────────────────${RESET}"
  echo ""
  echo "  Setup provisions PingOne using a ${BOLD}Worker app${RESET} you create once in the"
  echo "  PingOne admin console with the ${BOLD}Identity Data Admin${RESET} role."
  echo "  Enter that app's credentials now to provision hands-free, or press Enter"
  echo "  to skip and use setup's browser form instead."
  if [[ -f "$HOME/.ai-demo-creds" ]]; then
    echo "  ${DIM}(Cached creds found at ~/.ai-demo-creds — press Enter to reuse them.)${RESET}"
  fi
  echo ""

  # Probe that /dev/tty is actually usable. On macOS `[[ -r /dev/tty ]]` is true
  # even with no controlling terminal (the open then fails "Device not
  # configured"), so test a real write and skip cleanly if it fails.
  if ! { : >/dev/tty; } 2>/dev/null; then
    info "No interactive terminal — skipping inline cred prompt (setup uses env/cache or its form)."
    return 0
  fi

  local env_id="" region="" client_id="" client_secret=""
  printf "  PingOne Environment ID (UUID) [Enter to skip]: " >/dev/tty
  read -r env_id </dev/tty || true
  if [[ -z "$env_id" ]]; then
    info "Skipped inline creds — setup will prompt (browser form) or reuse cache."
    return 0
  fi

  printf "  Region (com | eu | ca | asia | com.au) [com]: " >/dev/tty
  read -r region </dev/tty || true
  [[ -z "$region" ]] && region="com"

  printf "  Worker Client ID: " >/dev/tty
  read -r client_id </dev/tty || true

  printf "  Worker Client Secret (hidden): " >/dev/tty
  read -rs client_secret </dev/tty || true
  printf "\n" >/dev/tty

  if [[ -z "$client_id" || -z "$client_secret" ]]; then
    warn "Client ID and Secret are both required — skipping inline creds; setup will prompt instead."
    return 0
  fi

  export PINGONE_BOOTSTRAP_ENV_ID="$env_id"
  export PINGONE_BOOTSTRAP_REGION="$region"
  export PINGONE_BOOTSTRAP_CLIENT_ID="$client_id"
  export PINGONE_BOOTSTRAP_CLIENT_SECRET="$client_secret"
  NONINT_FLAG="--non-interactive"
  ok "Worker creds captured — setup will provision PingOne non-interactively."
}

# ── Hand off to setup:fresh ───────────────────────────────────────────────────

run_setup() {
  local dir="$1"
  info "Running setup:fresh inside ${dir}..."
  echo ""

  # macOS ships bash 3.2, which incorrectly triggers `set -u` (nounset) on
  # `${arr[@]}` when the array is empty. Guard with `${arr[@]+"${arr[@]}"}`
  # so the expansion produces zero words instead of an unbound-var error.
  # NONINT_FLAG is "--non-interactive" when prompt_worker_creds collected creds
  # (exported as PINGONE_BOOTSTRAP_*), so bootstrap reads them from the env and
  # skips its browser cred form. Empty otherwise → setup falls back to the form.
  if [[ "${DRY_RUN:-0}" == "1" ]]; then
    echo "  DRY: cd $dir && npm run setup:fresh -- --from-installer ${NONINT_FLAG} ${EXTRA_ARGS[*]+${EXTRA_ARGS[*]}}"
    return 0
  fi
  ( cd "$dir" && npm run setup:fresh -- --from-installer --skip-vault ${NONINT_FLAG} ${EXTRA_ARGS[@]+"${EXTRA_ARGS[@]}"} )
}

# ── Optional LLM provider configuration ──────────────────────────────────────
#
# Asks whether to configure Anthropic (cloud Claude) and/or LM Studio (local
# OpenAI-compatible endpoint). Both are optional — the demo works with Helix
# (Ping AI, already handled by setup:fresh) or llama.cpp without either.
#
# Writes keys into the affected .env files so agents pick them up immediately.
# Safe to re-run: only appends if the key line is absent or empty.
configure_llm_providers() {
  local dir="$1"

  echo ""
  echo "${BOLD}── Optional LLM providers ──────────────────────────────────────────${RESET}"
  echo ""
  echo "  The demo ships with ${BOLD}Helix (Ping AI)${RESET} and ${BOLD}llama.cpp${RESET} pre-configured."
  echo "  You can optionally add cloud or local LLM providers now."
  echo "  All are skippable — press Enter to decline each one."
  echo ""

  # ── Anthropic (Claude) ───────────────────────────────────────────────────
  echo "  ${BOLD}Anthropic (Claude)${RESET}"
  echo "  Cloud API that powers Claude. Used by the LangChain agent"
  echo "  (provider=anthropic) and the Mastra agent. Requires an API key"
  echo "  from https://console.anthropic.com — billed per token."
  echo ""
  if ask_yes_no "  Configure Anthropic API key now? [y/N] " no; then
    local anthropic_key=""
    if [[ -r /dev/tty ]]; then
      printf "  Paste your Anthropic API key (sk-ant-…): " >/dev/tty
      read -r anthropic_key </dev/tty || true
    fi
    if [[ -n "$anthropic_key" ]]; then
      _set_env_key "${dir}/langchain_agent/.env"    "ANTHROPIC_API_KEY" "$anthropic_key"
      _set_env_key "${dir}/langchain_agent/.env"    "LANGCHAIN_LLM_PROVIDER" "anthropic"
      _set_env_key "${dir}/mastra_agent/.env"       "ANTHROPIC_API_KEY" "$anthropic_key"
      _set_env_key "${dir}/demo_agent_service/.env" "ANTHROPIC_API_KEY" "$anthropic_key"
      ok "Anthropic API key saved."
    else
      warn "No key entered — skipping Anthropic."
    fi
  else
    info "Skipping Anthropic — you can add ANTHROPIC_API_KEY to langchain_agent/.env later."
  fi

  echo ""

  # ── OpenAI ────────────────────────────────────────────────────────────────
  echo "  ${BOLD}OpenAI${RESET}"
  echo "  Cloud API for GPT-4o and other OpenAI models. Used by the OpenAI"
  echo "  Agents SDK agent, Pydantic AI agent, and Mastra agent."
  echo "  Requires an API key from https://platform.openai.com — billed per token."
  echo ""
  if ask_yes_no "  Configure OpenAI API key now? [y/N] " no; then
    local openai_key=""
    if [[ -r /dev/tty ]]; then
      printf "  Paste your OpenAI API key (sk-…): " >/dev/tty
      read -r openai_key </dev/tty || true
    fi
    if [[ -n "$openai_key" ]]; then
      _set_env_key "${dir}/openai_agent/.env"       "OPENAI_API_KEY" "$openai_key"
      _set_env_key "${dir}/pydantic_agent/.env"     "OPENAI_API_KEY" "$openai_key"
      _set_env_key "${dir}/mastra_agent/.env"       "OPENAI_API_KEY" "$openai_key"
      _set_env_key "${dir}/langchain_agent/.env"    "OPENAI_API_KEY" "$openai_key"
      ok "OpenAI API key saved."
    else
      warn "No key entered — skipping OpenAI."
    fi
  else
    info "Skipping OpenAI — you can add OPENAI_API_KEY to the agent .env files later."
  fi

  echo ""

  # ── LM Studio (local server mode only) ───────────────────────────────────
  # LM Studio runs on the host machine — it can't reach into a K8s pod, so
  # it only makes sense for run.sh (local) mode.
  if [[ "${RUN_MODE:-local}" == "local" ]]; then
    echo "  ${BOLD}LM Studio${RESET}"
    echo "  Runs LLMs locally on your Mac — no cloud account or API key needed."
    echo "  Download from https://lmstudio.ai, load a model, and start the local"
    echo "  server (default endpoint: http://localhost:1234/v1)."
    echo "  Used by the LangChain agent (provider=lmstudio or anthropic-lmstudio)."
    echo ""
    if ask_yes_no "  Configure LM Studio as the LangChain agent LLM provider? [y/N] " no; then
      local lms_url=""
      if [[ -r /dev/tty ]]; then
        printf "  LM Studio base URL [http://localhost:1234/v1]: " >/dev/tty
        read -r lms_url </dev/tty || true
      fi
      [[ -z "$lms_url" ]] && lms_url="http://localhost:1234/v1"
      _set_env_key "${dir}/langchain_agent/.env" "LMSTUDIO_BASE_URL"      "$lms_url"
      _set_env_key "${dir}/langchain_agent/.env" "LANGCHAIN_LLM_PROVIDER"  "lmstudio"
      ok "LM Studio configured (${lms_url}). Open LM Studio, load a model, and start the server before running the demo."
    else
      info "Skipping LM Studio — set LANGCHAIN_LLM_PROVIDER=lmstudio in langchain_agent/.env to enable later."
    fi
  else
    info "LM Studio: skipped for Kubernetes mode (host LM Studio can't reach in-cluster agents)."
  fi
}

# Write KEY=VALUE into an .env file, creating the file from .env.example if it
# doesn't exist. Updates an existing empty/placeholder line; appends if absent.
_set_env_key() {
  local env_file="$1" key="$2" value="$3"
  local dir
  dir="$(dirname "$env_file")"

  # Create from .env.example if the .env doesn't exist yet
  if [[ ! -f "$env_file" ]]; then
    if [[ -f "${env_file}.example" ]]; then
      cp "${env_file}.example" "$env_file"
    else
      mkdir -p "$dir"
      touch "$env_file"
    fi
  fi

  if grep -qE "^${key}=" "$env_file" 2>/dev/null; then
    # Replace existing line (even if empty or placeholder)
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$env_file" && rm -f "${env_file}.bak"
  else
    echo "${key}=${value}" >> "$env_file"
  fi
}

# ── PingOne admin MCP server (.mcp.json) ─────────────────────────────────────
#
# Patch .mcp.json's pingone entry deterministically with node so we don't depend
# on Claude Code's ${VAR} expansion rules (undocumented for url / oauth fields).
_patch_pingone_mcp() {
  local mcp_json="$1" env_id="$2" client_id="$3"
  node -e '
    const fs = require("fs");
    const [file, envId, clientId] = process.argv.slice(1);
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    if (!j.mcpServers || !j.mcpServers.pingone) process.exit(3);
    j.mcpServers.pingone.url = "https://api.pingone.com/v1/environments/" + envId + "/mcp";
    j.mcpServers.pingone.oauth = j.mcpServers.pingone.oauth || { callbackPort: 7464 };
    j.mcpServers.pingone.oauth.clientId = clientId;
    fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
  ' "$mcp_json" "$env_id" "$client_id"
}

# Cursor's project `.cursor/mcp.json` uses static OAuth (auth.CLIENT_ID) for the
# hosted PingOne MCP server. Seed from the example if missing, then patch url + CLIENT_ID.
_patch_cursor_pingone_mcp() {
  local dir="$1" env_id="$2" client_id="$3"
  local cursor_mcp="${dir}/.cursor/mcp.json"
  local cursor_example="${dir}/.cursor/mcp.json.example"
  mkdir -p "${dir}/.cursor"
  if [[ ! -f "$cursor_mcp" && -f "$cursor_example" ]]; then
    cp "$cursor_example" "$cursor_mcp"
  fi
  [[ -f "$cursor_mcp" ]] || return 1
  node -e '
    const fs = require("fs");
    const [file, envId, clientId] = process.argv.slice(1);
    let j = {};
    try { j = JSON.parse(fs.readFileSync(file, "utf8")); } catch { j = { mcpServers: {} }; }
    j.mcpServers = j.mcpServers || {};
    j.mcpServers.pingone = j.mcpServers.pingone || {};
    j.mcpServers.pingone.url = "https://api.pingone.com/v1/environments/" + envId + "/mcp";
    j.mcpServers.pingone.auth = j.mcpServers.pingone.auth || {};
    j.mcpServers.pingone.auth.CLIENT_ID = clientId;
    fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
  ' "$cursor_mcp" "$env_id" "$client_id"
}

# Claude Code's `pingone` MCP server (PingOne admin / management tools) is
# tenant-specific: the environment id in its URL and the OAuth clientId must
# belong to YOUR PingOne environment. Prefer the values bootstrap provisioned
# (PINGONE_ENVIRONMENT_ID + PINGONE_MCP_OAUTH_CLIENT_ID in demo_api_server/.env)
# and patch .mcp.json automatically; otherwise prompt. Skippable.
configure_pingone_mcp() {
  local dir="$1"
  local mcp_json="${dir}/.mcp.json"
  local env_file="${dir}/demo_api_server/.env"
  [[ -f "$mcp_json" ]] || return 0
  command -v node >/dev/null 2>&1 || { warn "node not found — skipping .mcp.json pingone setup."; return 0; }

  # Values bootstrap provisioned: the env id and the "PingOne MCP Server" app's
  # client id (PINGONE_MCP_OAUTH_CLIENT_ID). When both are present we wire
  # .mcp.json automatically — no prompt, works under curl-pipe.
  local prov_env="${PINGONE_BOOTSTRAP_ENV_ID:-}" prov_client="" prov_gw_client=""
  if [[ -f "$env_file" ]]; then
    [[ -z "$prov_env" ]] && prov_env="$(grep -E '^PINGONE_ENVIRONMENT_ID=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' )"
    prov_client="$(grep -E '^PINGONE_MCP_OAUTH_CLIENT_ID=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' )"
    prov_gw_client="$(grep -E '^PINGONE_GATEWAY_MCP_OAUTH_CLIENT_ID=' "$env_file" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' )"
  fi

  # Also point Claude Code's local `banking-gateway` MCP server at its provisioned
  # OAuth client (PINGONE_GATEWAY_MCP_OAUTH_CLIENT_ID) so its browser MCP-OAuth flow
  # works out of the box. set_gateway_scheme handles the url scheme separately.
  if [[ -n "$prov_gw_client" ]]; then
    if node -e '
      const fs = require("fs");
      const [file, clientId] = process.argv.slice(1);
      const j = JSON.parse(fs.readFileSync(file, "utf8"));
      const gw = j.mcpServers && j.mcpServers["banking-gateway"];
      if (!gw) process.exit(3);
      gw.oauth = gw.oauth || { callbackPort: 7465 };
      gw.oauth.clientId = clientId;
      fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
    ' "$mcp_json" "$prov_gw_client"; then
      ok "banking-gateway MCP OAuth client set (${prov_gw_client})."
    fi
  fi

  if [[ -n "$prov_env" && -n "$prov_client" ]]; then
    if _patch_pingone_mcp "$mcp_json" "$prov_env" "$prov_client"; then
      ok "pingone MCP server pointed at env ${prov_env} (provisioned app ${prov_client})."
      info "In Claude Code: run /mcp → pingone → Authenticate (browser OAuth; PingOne admin roles)."
    else
      warn "Could not patch .mcp.json — edit the 'pingone' entry's url + oauth.clientId by hand."
    fi
    if _patch_cursor_pingone_mcp "$dir" "$prov_env" "$prov_client"; then
      ok "Cursor pingone MCP server configured in .cursor/mcp.json."
      info "In Cursor: Customize → MCP → pingone → Connect (browser OAuth; PingOne admin roles)."
    else
      warn "Could not patch .cursor/mcp.json — copy .cursor/mcp.json.example and fill in url + auth.CLIENT_ID."
    fi
    return 0
  fi

  # Fallback: bootstrap didn't provide the values (e.g. --skip-vault / older env) —
  # prompt interactively. Skips cleanly with no controlling terminal.
  echo ""
  echo "${BOLD}── PingOne admin MCP server (Claude Code) ──────────────────────────${RESET}"
  echo ""
  echo "  The ${BOLD}pingone${RESET} entry in .mcp.json is the PingOne-hosted admin MCP server."
  echo "  It is tenant-specific — point it at your PingOne environment, or press"
  echo "  Enter to skip and edit .mcp.json later."
  echo ""

  if ! { : >/dev/tty; } 2>/dev/null; then
    info "No interactive terminal — leaving the .mcp.json pingone entry as-is."
    return 0
  fi

  local env_id="" client_id="" hint="[Enter to skip]"
  [[ -n "$prov_env" ]] && hint="[${prov_env}]"
  printf "  PingOne MCP environment ID %s: " "$hint" >/dev/tty
  read -r env_id </dev/tty || true
  [[ -z "$env_id" ]] && env_id="$prov_env"
  if [[ -z "$env_id" ]]; then
    info "No environment ID — leaving the .mcp.json pingone entry as-is."
    return 0
  fi

  printf "  PingOne MCP OAuth client ID (app in that env, redirect http://localhost:7464/callback): " >/dev/tty
  read -r client_id </dev/tty || true
  if [[ -z "$client_id" ]]; then
    warn "No client ID — leaving the .mcp.json pingone entry as-is (fill it in later)."
    return 0
  fi

  if _patch_pingone_mcp "$mcp_json" "$env_id" "$client_id"; then
    ok "Pointed the pingone MCP server at env ${env_id}."
    info "In Claude Code: run /mcp → pingone → Authenticate (browser OAuth; PingOne admin roles)."
  else
    warn "Could not patch .mcp.json — edit the 'pingone' entry's url + oauth.clientId by hand."
  fi
  if _patch_cursor_pingone_mcp "$dir" "$env_id" "$client_id"; then
    ok "Cursor pingone MCP server configured in .cursor/mcp.json."
    info "In Cursor: Customize → MCP → pingone → Connect (browser OAuth; PingOne admin roles)."
  else
    warn "Could not patch .cursor/mcp.json — copy .cursor/mcp.json.example and fill in url + auth.CLIENT_ID."
  fi
}

# Build the `banking-dev` MCP server (Claude Code dev tool). Its dist/ is
# gitignored, so a fresh clone has no build — and a stale local build breaks
# after dependency changes (e.g. the better-sqlite3 → LMDB migration). Rebuild
# it here so `/mcp` → banking-dev connects. Best-effort: never aborts install.
build_dev_mcp() {
  local dir="$1"
  local pkg="${dir}/dev_mcp/banking-dev"
  [[ -f "${pkg}/package.json" ]] || return 0
  command -v npm >/dev/null 2>&1 || { warn "npm not found — skipping banking-dev MCP build."; return 0; }

  info "Building the banking-dev MCP server (Claude Code dev tool)..."
  if ( cd "$pkg" && npm install --silent && npm run build --silent ) >/dev/null 2>&1; then
    ok "banking-dev MCP server built (dev_mcp/banking-dev/dist)."
  else
    warn "banking-dev MCP build failed — run 'cd dev_mcp/banking-dev && npm install && npm run build' by hand."
  fi
}

# Set the `banking-gateway` MCP URL scheme to match the run mode. The local
# native server (./run.sh) serves the gateway over HTTPS (mkcert); the Docker /
# Kubernetes modes expose it over plain HTTP on a forwarded port. A scheme
# mismatch makes Claude Code's connection fail outright ("Failed"), so align it.
set_gateway_scheme() {
  local dir="$1"
  local mcp_json="${dir}/.mcp.json"
  [[ -f "$mcp_json" ]] || return 0
  command -v node >/dev/null 2>&1 || return 0

  local scheme="https"
  [[ "${RUN_MODE:-local}" != "local" ]] && scheme="http"

  if node -e '
    const fs = require("fs");
    const [file, scheme] = process.argv.slice(1);
    const j = JSON.parse(fs.readFileSync(file, "utf8"));
    const gw = j.mcpServers && j.mcpServers["banking-gateway"];
    if (!gw || !gw.url) process.exit(3);
    gw.url = gw.url.replace(/^https?:/, scheme + ":");
    fs.writeFileSync(file, JSON.stringify(j, null, 2) + "\n");
  ' "$mcp_json" "$scheme"; then
    ok "banking-gateway MCP URL set to ${scheme} (matches ${RUN_MODE:-local} run mode)."
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  echo ""
  echo "${BOLD}AI Demo bootstrapper${RESET}"
  echo ""

  # ── Step 0: ask how the user plans to run the demo ─────────────────────────
  # The answer gates which tools we install — no point installing OrbStack for
  # a local run, or llama.cpp for a K8s run (it runs in-cluster there).
  echo "${BOLD}How do you want to run the AI Demo?${RESET}"
  echo ""
  echo "  ${BOLD}1)${RESET} Local server         ${DIM}(./run.sh — Node + Python on this Mac, no Docker)${RESET}"
  echo "  ${BOLD}2)${RESET} Kubernetes / OrbStack ${DIM}(./run-k8.sh — Docker + K8s locally via OrbStack)${RESET}"
  echo "  ${BOLD}3)${RESET} Ping SE cluster       ${DIM}(./run-pingaws.sh — deploy to the Ping SE DevOps${RESET}"
  echo "                         ${DIM} cluster; needs your SE namespace + gh auth)${RESET}"
  echo "  ${BOLD}4)${RESET} Kubernetes / EKS      ${DIM}(./run-k8.sh aws-all — deploy to a self-managed EKS${RESET}"
  echo "                         ${DIM} cluster; needs GITHUB_OWNER, AWS_REGION, EKS_CLUSTER_NAME)${RESET}"
  echo ""

  local run_mode_answer=""
  if [[ -r /dev/tty ]]; then
    read -r -p "  Enter 1, 2, 3, or 4 [default: 1]: " run_mode_answer </dev/tty 2>/dev/null || true
  fi
  [[ -z "$run_mode_answer" ]] && run_mode_answer="1"

  # Normalise: accept text aliases too
  case "$run_mode_answer" in
    1|local)                     RUN_MODE="local"     ;;
    2|orbstack|k8s|kubernetes)   RUN_MODE="orbstack"  ;;
    3|se|ping-se|pingse|se-cluster) RUN_MODE="se"     ;;
    4|eks|aws|cloud)             RUN_MODE="eks"       ;;
    *)
      warn "Unrecognised choice '${run_mode_answer}' — defaulting to local."
      RUN_MODE="local"
      ;;
  esac
  export RUN_MODE

  case "$RUN_MODE" in
    local)    ok "Run mode: ${BOLD}Local server${RESET} (./run.sh)" ;;
    orbstack) ok "Run mode: ${BOLD}Kubernetes / OrbStack${RESET} (./run-k8.sh)" ;;
    se)       ok "Run mode: ${BOLD}Ping SE cluster${RESET} (./run-pingaws.sh)" ;;
    eks)      ok "Run mode: ${BOLD}Kubernetes / EKS${RESET} (./run-k8.sh aws-all)" ;;
  esac
  echo ""

  # ── Pre-flight — install what this run mode needs ──────────────────────────
  ensure_homebrew    # must be first; all brew installs depend on it
  ensure_git
  ensure_node        # installs nvm + Node 20 if missing or too old
  install_gh_cli
  ensure_python      # Python 3.10+ for the AI agents (all modes)
  ensure_mkcert      # mkcert binary + root CA trust (all modes need TLS certs)

  case "$RUN_MODE" in
    local)
      # Local server runs Node + Python directly, but still needs Docker to run
      # PingGateway (the MCP authorization gateway, ping-gateway/docker-compose.yml).
      # Without Docker run.sh starts but silently skips PingGateway, so install it.
      ensure_orbstack  # Docker (+ kubectl) via OrbStack on macOS — used by PingGateway
      ensure_llamacpp     # offer local llama.cpp for NL intent routing (default backend)
      ensure_omlx         # optional Mac fast path for agent chip dev
      ensure_llm_launchd  # keep llama-server tiers alive across logins (macOS watchdog)
      ensure_codegraph_llamacpp  # Code Explorer requires tool-capable model
      ;;
    orbstack)
      # K8s on OrbStack: needs Docker + kubectl. llama.cpp runs in-cluster.
      ensure_orbstack
      info "llama.cpp: will run as an in-cluster pod — no host install needed."
      ;;
    se)
      # Ping SE cluster: Docker Desktop to build/push images + SE K8s tools.
      # No OrbStack K8s needed — the SE cluster is already provisioned.
      ensure_docker_desktop
      ensure_se_k8s_tools
      ensure_codegraph_llamacpp  # Code Explorer — host llama.cpp, docker compose points at host
      # Capture the user's Ping email now so run-k8.sh se-deploy can derive
      # the namespace without prompting later.
      if [[ -z "${PING_EMAIL:-}" ]]; then
        local _git_email
        _git_email="$(git config user.email 2>/dev/null || true)"
        if is_valid_ping_email "$_git_email"; then
          export PING_EMAIL="$(printf '%s' "$_git_email" | tr '[:upper:]' '[:lower:]' | tr -d ' "')"
        fi
      fi
      if [[ -z "${PING_EMAIL:-}" ]]; then
        local _ping_email=""
        _ping_email="$(read_ping_email_install "  Your Ping email (e.g. cmuir@pingidentity.com): " || true)"
        [[ -n "$_ping_email" ]] && export PING_EMAIL="$_ping_email"
      fi
      if [[ -n "${PING_EMAIL:-}" ]] && ! is_valid_ping_email "$PING_EMAIL"; then
        fatal "PING_EMAIL must be a @pingidentity.com address (personal email is not allowed)"
      fi
      ;;
    eks)
      # Self-managed EKS: Docker + kubectl + AWS CLI.
      ensure_orbstack
      ensure_aws_cli
      info "llama.cpp: will run as an in-cluster pod — no host install needed."
      ;;
  esac

  # Resolve target. We have to be defensive across three cases:
  #   1. INSTALL_DIR set (absolute or relative) → use it.
  #   2. INSTALL_DIR unset, $PWD valid          → $PWD/AI-demo.
  #   3. INSTALL_DIR unset, $PWD empty/missing  → fall back to `pwd` builtin.
  #
  # The previous implementation did `cd "$(dirname "$target")" && pwd` which
  # returned "/" when dirname produced "/", giving us "//AI-demo".
  local cwd="${PWD:-$(pwd 2>/dev/null)}"
  cwd="${cwd:-$HOME}"           # last-resort fallback if both PWD and pwd fail

  # If we're already inside a clone of this repo, defaulting to $PWD/AI-demo
  # would nest the install inside the existing checkout. Detect this by checking
  # whether the current directory's git remote matches REPO_URL, and default to
  # $HOME/AI-demo instead so the install lands in a clean location.
  local _default_base="$cwd"
  if [[ -z "${INSTALL_DIR:-}" ]]; then
    local _cur_remote
    _cur_remote="$(git remote get-url origin 2>/dev/null || true)"
    if [[ "$_cur_remote" == "$REPO_URL" || "$_cur_remote" == "${REPO_URL%.git}" ]]; then
      _default_base="$HOME"
      info "Running from inside the repo — defaulting install dir to \$HOME/${DEFAULT_DIR_NAME} to avoid nesting."
    fi
  fi
  local target="${INSTALL_DIR:-${_default_base}/${DEFAULT_DIR_NAME}}"

  # If relative, resolve against cwd.
  case "$target" in
    /*) ;;                            # already absolute
    *) target="${cwd}/${target}" ;;
  esac

  # Collapse repeated slashes (//foo, ///foo) and strip trailing slash.
  # Bash parameter expansion's `//\/\//\/` treatment of escapes is unreliable,
  # so we use sed — it's a coreutils binary, already required for the rest of
  # the script and has no install-script-specific risk.
  target="$(printf '%s' "$target" | sed 's|//*|/|g')"
  target="${target%/}"
  [[ -z "$target" ]] && target="/"

  # When the user is at filesystem root or pointing INSTALL_DIR there, offer
  # to redirect to $HOME instead. macOS SIP makes / read-only; on Linux this
  # would need sudo. Almost certainly an accident — but we ask rather than
  # silently picking, since the user might have a non-standard reason.
  local parent
  parent="$(dirname "$target")"
  if [[ "$target" == "/${DEFAULT_DIR_NAME}" || "$parent" == "/" ]]; then
    warn "Cannot install at filesystem root: ${target}"
    if [[ -z "${HOME:-}" ]]; then
      err "\$HOME is unset — cannot suggest an alternate path."
      echo "" >&2
      echo "  Set INSTALL_DIR explicitly and re-run:" >&2
      echo "    curl -fsSL ${REPO_URL%.git}/raw/main/install.sh | INSTALL_DIR=/path/to/AI-demo bash" >&2
      exit 1
    fi
    local suggested="${HOME%/}/${DEFAULT_DIR_NAME}"
    suggested="$(printf '%s' "$suggested" | sed 's|//*|/|g')"

    echo ""
    echo "  The filesystem root isn't writable (macOS SIP / Linux requires sudo)."
    echo "  Suggested install location:  ${BOLD}${suggested}${RESET}"
    echo ""
    if ask_yes_no "Install there instead? [Y/n] " yes; then
      target="$suggested"
      parent="$(dirname "$target")"
      ok "Redirecting to ${target}"
    else
      info "Aborted. cd into a writable directory and re-run:"
      echo "  cd ~ && curl -fsSL ${REPO_URL%.git}/raw/main/install.sh | bash"
      echo "  # or pick another path explicitly:"
      echo "  curl -fsSL ${REPO_URL%.git}/raw/main/install.sh | INSTALL_DIR=/path/to/AI-demo bash"
      exit 0
    fi
  fi

  if [[ ! -w "$parent" ]]; then
    err "Cannot write to parent directory: ${parent}"
    cat >&2 <<EOF

  The installer needs write permission on the parent of the install path so it
  can create '${DEFAULT_DIR_NAME}/' there. Either:

    1. Pick a path you can write to:    INSTALL_DIR=~/AI-demo
    2. Fix permissions on ${parent}    (typically: chmod u+w "${parent}")

EOF
    exit 1
  fi

  local exists="no"
  [[ -d "$target" ]] && exists="yes"

  confirm_dir "$target" "$exists"

  # confirm_dir may have updated INSTALL_DIR if the user typed a different path.
  if [[ "${INSTALL_DIR:-}" != "$target" && -n "${INSTALL_DIR:-}" ]]; then
    target="${INSTALL_DIR}"
    target="${target/#\~/$HOME}"
    target="$(printf '%s' "$target" | sed 's|//*|/|g')"
    target="${target%/}"
    exists="no"
    [[ -d "$target" ]] && exists="yes"
    parent="$(dirname "$target")"
  fi

  if [[ "$exists" == "no" ]]; then
    if [[ "${DRY_RUN:-0}" == "1" ]]; then
      echo "  DRY: mkdir -p $(dirname "$target")"
    else
      mkdir -p "$(dirname "$target")"
    fi
  fi

  clone_or_update "$target"

  # For SE cluster, cache PING_EMAIL into demo_api_server/.env now that we have
  # the install path. This means run-k8.sh se-deploy won't need to prompt for
  # it again, and bootstrapPingOne.js can see the value during setup:fresh.
  if [[ "${RUN_MODE:-local}" == "se" && -n "${PING_EMAIL:-}" ]]; then
    local _env_file="${target}/demo_api_server/.env"
    if [[ ! -f "$_env_file" && -f "${_env_file}.example" ]]; then
      cp "${_env_file}.example" "$_env_file"
    fi
    if [[ -f "$_env_file" ]]; then
      if grep -q '^PING_EMAIL=' "$_env_file" 2>/dev/null; then
        sed -i.bak "s|^PING_EMAIL=.*|PING_EMAIL=${PING_EMAIL}|" "$_env_file" && rm -f "${_env_file}.bak"
      else
        echo "PING_EMAIL=${PING_EMAIL}" >> "$_env_file"
      fi
      ok "Saved PING_EMAIL to demo_api_server/.env."
    fi
  fi

  setup_certs "$target"

  # Collect PingOne worker-token creds (or skip → setup's browser form).
  prompt_worker_creds

  # For SE cluster, bootstrap PingOne with the public K8s URL so redirect URIs
  # are registered correctly from the start (not localhost).
  if [[ "${RUN_MODE:-local}" == "se" ]]; then
    PUBLIC_APP_URL="https://ai-demo.ping-devops.com" run_setup "$target"
  else
    run_setup "$target"
  fi

  configure_llm_providers "$target"

  configure_pingone_mcp "$target"
  build_dev_mcp "$target"
  set_gateway_scheme "$target"
  configure_cursor_mcp "$target"

  echo ""
  ok "AI Demo installed at: $target"
  echo ""
  echo "Start it any time with:"
  case "${RUN_MODE:-local}" in
    local)
      echo "  cd $target && ./run.sh"
      ;;
    orbstack)
      echo "  cd $target && ./run-k8.sh"
      ;;
    se)
      echo "  cd $target && ./run-pingaws.sh"
      echo ""
      echo "  This will:"
      echo "    1. Build all Docker images"
      echo "    2. Push to GHCR (ghcr.io/<your-github-username>/...)"
      echo "    3. Deploy to the Ping SE cluster (namespace auto-derived from your Ping email)"
      echo "    4. App will be live at: https://ai-demo.ping-devops.com"
      echo ""
      echo "  Prerequisites:"
      echo "    • gh auth login  (GitHub CLI authentication for GHCR push)"
      echo "    • kubectl context pointing at ping-dev-aws-us-east-2"
      echo "      (run: kubectl config use-context us)"
      echo "    • Your SE namespace provisioned via JIRA DEVHELP"
      echo ""
      echo "  ${YELLOW}${BOLD}⚠  IMPORTANT — You must undeploy when finished:${RESET}"
      echo "  ${YELLOW}The app does NOT undeploy itself. Leaving it running on the SE cluster"
      echo "  may result in loss of your publishing rights.${RESET}"
      echo ""
      echo "  To undeploy:"
      echo "    cd $target && ./run-pingaws.sh undeploy"
      ;;
    eks)
      echo "  cd $target && ./run-k8.sh aws-all"
      echo ""
      echo "  Required env vars for EKS deploy:"
      echo "    export GITHUB_OWNER=<your-github-username-or-org>"
      echo "    export AWS_REGION=<e.g. us-east-1>"
      echo "    export EKS_CLUSTER_NAME=<your-eks-cluster-name>"
      echo "    export PUBLIC_APP_URL=<https://your-alb-domain>"
      echo "    export ACM_CERTIFICATE_ARN=<arn:aws:acm:...>"
      ;;
  esac
  echo ""
}

# Capture any extra args (e.g. tar archive path) to forward to setup:fresh.
EXTRA_ARGS=("$@")

main
