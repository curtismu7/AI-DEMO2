#!/usr/bin/env bash
# install-se.sh — Standalone bootstrapper for the AI Demo on the Ping SE DevOps cluster.
#
# For Ping Sales Engineers only. Sets up everything needed to demo on the
# shared SE DevOps cluster (ping-dev-aws-us-east-2) — no OrbStack, no local
# Kubernetes. Uses Docker Desktop to build images and push to GHCR, then
# deploys via kubectl to your pre-provisioned SE namespace.
#
# Designed to be curl-piped on a brand-new Mac:
#   curl -fsSL https://raw.githubusercontent.com/curtismu7/AI-demo/main/install-se.sh | bash
#
# What it does (in order):
#   1. Installs Homebrew if missing.
#   2. Installs git, Node 20, GitHub CLI, Python 3.10+.
#   3. Installs Docker Desktop (to build + push images).
#   4. Installs SE K8s tools: kubelogin, kubectx, kubectl.
#   5. Installs mkcert + trusts root CA.
#   6. Confirms the install directory (default: ~/AI-demo).
#   7. Clones the repo (or pulls latest main on an existing checkout).
#   8. Generates TLS certs for api.ping.demo into certs/.
#   9. Runs `npm run setup:fresh` — provisions PingOne, writes .env files.
#  10. Prints step-by-step instructions to deploy.
#
# Prerequisites:
#   - Your SE namespace provisioned in the SE cluster (JIRA DEVHELP ticket)
#   - kubectl context for ping-dev-aws-us-east-2 added (run: kubectl config use-context us)
#   - gh CLI authenticated (run: gh auth login, then: gh auth refresh -s write:packages)
#
# Env-var overrides:
#   INSTALL_DIR   Override the install path (default: ~/AI-demo)
#   REPO_URL      Override the git repo URL
#   ASSUME_YES    Set to 1 to skip confirmation prompts

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/curtismu7/AI-demo.git}"
BRANCH="${BANKING_BRANCH:-main}"
DEFAULT_DIR_NAME="AI-demo"
NODE_REQUIRED_MAJOR="20"
NODE_MIN_MAJOR="20"

if [[ -t 1 ]]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; RED=''; GREEN=''; YELLOW=''; BLUE=''; RESET=''
fi

info()  { echo "${BLUE}${BOLD}==>${RESET} $*"; }
ok()    { echo "${GREEN}✓${RESET}  $*"; }
warn()  { echo "${YELLOW}!${RESET}  $*"; }
err()   { echo "${RED}✗${RESET}  $*" >&2; }
fatal() { err "$*"; exit 1; }

ensure_homebrew() {
  if command -v brew >/dev/null 2>&1; then return 0; fi
  if [[ "$(uname)" != "Darwin" ]]; then return 0; fi
  info "Homebrew not found — installing..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  command -v brew >/dev/null 2>&1 || fatal "Homebrew install failed. Install manually: https://brew.sh"
  ok "Homebrew installed."
}

ensure_git() {
  if command -v git >/dev/null 2>&1; then return 0; fi
  if command -v brew >/dev/null 2>&1; then
    info "Installing git via Homebrew..."
    brew install git --quiet && ok "git installed." || fatal "git install failed."
  else
    fatal "git not found. Install it: https://git-scm.com/downloads"
  fi
}

install_gh_cli() {
  if command -v gh >/dev/null 2>&1; then return 0; fi
  if command -v brew >/dev/null 2>&1; then
    info "Installing GitHub CLI (gh) via Homebrew..."
    brew install gh --quiet && ok "GitHub CLI installed." \
      || warn "gh install failed — install later: brew install gh"
  else
    warn "gh CLI not found. Install: https://cli.github.com"
  fi
}

ensure_node() {
  local NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

  _load_nvm() {
    if [[ -s "$NVM_DIR/nvm.sh" ]]; then
      export NVM_DIR
      \. "$NVM_DIR/nvm.sh" --no-use || true
    fi
  }

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

  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    info "Installing nvm (Node Version Manager)..."
    curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash \
      || fatal "nvm install failed. Install manually: https://github.com/nvm-sh/nvm"
    _load_nvm
    command -v nvm >/dev/null 2>&1 || fatal "nvm installed but not on PATH. Open a new terminal and re-run install-se.sh."
    ok "nvm installed."
  fi

  info "Installing Node ${NODE_REQUIRED_MAJOR} via nvm..."
  nvm install "${NODE_REQUIRED_MAJOR}" || fatal "nvm install ${NODE_REQUIRED_MAJOR} failed."
  nvm use "${NODE_REQUIRED_MAJOR}"     || fatal "nvm use ${NODE_REQUIRED_MAJOR} failed."
  ok "Node $(node --version) installed via nvm."

  local profile=""
  if [[ -f "$HOME/.zshrc" ]]; then profile="$HOME/.zshrc"
  elif [[ -f "$HOME/.bashrc" ]]; then profile="$HOME/.bashrc"
  elif [[ -f "$HOME/.bash_profile" ]]; then profile="$HOME/.bash_profile"
  fi
  if [[ -n "$profile" ]] && ! grep -q 'NVM_DIR' "$profile" 2>/dev/null; then
    cat >> "$profile" <<'NVMRC'

# Added by AI Demo installer — loads nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
NVMRC
    ok "Added nvm init to ${profile}."
  fi
}

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
    brew link python@3.12 --force --overwrite 2>/dev/null || true
    ok "Python $(python3.12 --version 2>&1 | awk '{print $2}') installed."
  else
    warn "Python 3.10+ not found and Homebrew unavailable."
    warn "Install Python 3.10+ from https://python.org and re-run."
  fi
}

ensure_docker_desktop() {
  if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    ok "Docker already running."
    return 0
  fi

  if [[ "$(uname)" != "Darwin" ]]; then
    warn "Docker not found. Install Docker: https://docs.docker.com/get-docker/"
    return 0
  fi

  if command -v brew >/dev/null 2>&1; then
    info "Installing Docker Desktop via Homebrew..."
    brew install --cask docker-desktop --quiet \
      || fatal "Docker Desktop install failed. Install manually: https://www.docker.com/products/docker-desktop/"
    ok "Docker Desktop installed."
    info "Launching Docker Desktop..."
    open -a Docker 2>/dev/null || true
    local waited=0
    while [[ $waited -lt 60 ]]; do
      if docker info >/dev/null 2>&1; then
        ok "Docker daemon ready."
        return 0
      fi
      sleep 3; (( waited += 3 ))
    done
    warn "Docker Desktop installed but daemon not yet ready."
    warn "Open Docker Desktop, wait for it to start, then re-run."
  else
    warn "Docker not found and Homebrew unavailable."
    warn "Install Docker Desktop from https://www.docker.com/products/docker-desktop/"
  fi
}

# Install K8s tools needed for the Ping SE DevOps cluster:
#   kubelogin — OIDC kubectl auth (browser popup via PingOne)
#   jwt-cli   — inspect tokens during debugging
#   kubectx   — switch K8s contexts; includes kubens
#   kubectl   — K8s CLI
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

ensure_mkcert() {
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
}

setup_certs() {
  local dir="$1"
  local certs_dir="${dir}/certs"

  command -v mkcert >/dev/null 2>&1 || { warn "mkcert not found — skipping cert generation."; return 0; }

  local ca_root cert_file key_file
  ca_root="$(mkcert -CAROOT 2>/dev/null)" || ca_root=""
  cert_file="${certs_dir}/api.ping.demo+2.pem"
  key_file="${certs_dir}/api.ping.demo+2-key.pem"

  mkdir -p "$certs_dir"

  if [[ -n "$ca_root" && -f "$ca_root/rootCA.pem" && ! -f "$certs_dir/rootCA.pem" ]]; then
    cp "$ca_root/rootCA.pem" "$certs_dir/rootCA.pem"
    ok "Copied mkcert rootCA.pem into certs/."
  fi

  if [[ -f "$cert_file" && -f "$key_file" ]]; then
    ok "TLS certs already present in certs/."
    return 0
  fi

  info "Generating TLS certs for api.ping.demo..."
  ( cd "$certs_dir" && mkcert api.ping.demo localhost 127.0.0.1 ) \
    && ok "TLS certs generated in certs/." \
    || warn "mkcert cert generation failed — run 'cd ${certs_dir} && mkcert api.ping.demo localhost 127.0.0.1' manually."
}

ask_yes_no() {
  local prompt="$1"
  local default="${2:-yes}"
  local answer=""
  if [[ -t 0 ]]; then
    read -r -p "$prompt" answer
  elif [[ -r /dev/tty ]]; then
    read -p "$prompt" answer </dev/tty
  else
    [[ "${ASSUME_YES:-0}" == "1" ]] || warn "No TTY available — using default ($default)."
    [[ "$default" == "yes" ]] && return 0 || return 1
  fi

  if [[ -z "$answer" ]]; then
    [[ "$default" == "yes" ]] && return 0 || return 1
  fi
  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    n|N|no|NO)   return 1 ;;
    *) [[ "$default" == "yes" ]] && return 0 || return 1 ;;
  esac
}

confirm_dir() {
  local target="$1"
  local exists="$2"

  echo ""
  echo "${BOLD}AI Demo install (SE cluster mode)${RESET}"
  echo "──────────────────────────────────"
  echo "  Repo:        ${REPO_URL}"
  echo "  Branch:      ${BRANCH}"
  echo "  Install to:  ${BOLD}${target}${RESET}"
  if [[ "$exists" == "yes" ]]; then
    if [[ -d "$target/.git" ]]; then
      echo "               (existing checkout — will fetch latest)"
    else
      echo "               (directory exists — will refuse to clobber if non-empty)"
    fi
  else
    echo "               (directory will be created)"
  fi
  echo ""

  if [[ "${ASSUME_YES:-0}" == "1" ]]; then return 0; fi

  if ask_yes_no "Proceed? [Y/n] " yes; then return 0; fi

  echo ""
  local custom=""
  if [[ -r /dev/tty ]]; then
    read -r -p "  Enter a different install path (or press Enter to cancel): " custom </dev/tty 2>/dev/null || true
  fi
  custom="${custom/#\~/$HOME}"
  custom="${custom%/}"
  if [[ -n "$custom" ]]; then
    export INSTALL_DIR="$custom"
    return 0
  fi

  info "Aborted."
  exit 0
}

clone_or_update() {
  local dir="$1"

  if [[ -e "$dir" && ! -d "$dir" ]]; then
    fatal "Path exists and is not a directory: ${dir}"
  fi

  if [[ -d "$dir/.git" ]]; then
    local existing_remote
    existing_remote="$( cd "$dir" && git remote get-url origin 2>/dev/null || echo '' )"
    if [[ -n "$existing_remote" && "$existing_remote" != "$REPO_URL" ]]; then
      err "Existing git repo at ${dir} has a different remote:"
      echo "    expected: ${REPO_URL}" >&2
      echo "    found:    ${existing_remote}" >&2
      fatal "Pick a different install path or remove ${dir} and re-run."
    fi
    info "Existing checkout found — fetching latest ${BRANCH}..."
    ( cd "$dir" && git fetch origin "$BRANCH" --quiet && git checkout "$BRANCH" --quiet && git pull --ff-only --quiet )
    ok "Updated $dir to latest $BRANCH"
    return 0
  fi

  if [[ -d "$dir" ]]; then
    local entry_count
    entry_count=$(find "$dir" -mindepth 1 -maxdepth 1 2>/dev/null | wc -l | tr -d ' ')
    if [[ "$entry_count" != "0" ]]; then
      fatal "Directory ${dir} exists and is not a git checkout (${entry_count} files found). Remove it or choose a different path."
    fi
    info "Removing empty target directory before clone: ${dir}"
    rmdir "$dir"
  fi

  info "Cloning ${REPO_URL} into ${dir}..."
  git clone --branch "$BRANCH" --quiet "$REPO_URL" "$dir"
  ok "Cloned to $dir"
}

run_setup() {
  local dir="$1"
  info "Running setup:fresh inside ${dir}..."
  echo ""
  PUBLIC_APP_URL="https://ai-demo.ping-devops.com" \
    ( cd "$dir" && npm run setup:fresh -- --from-installer --skip-vault )
}

_set_env_key() {
  local env_file="$1" key="$2" value="$3"
  local dir
  dir="$(dirname "$env_file")"

  if [[ ! -f "$env_file" ]]; then
    if [[ -f "${env_file}.example" ]]; then
      cp "${env_file}.example" "$env_file"
    else
      mkdir -p "$dir"; touch "$env_file"
    fi
  fi

  if grep -qE "^${key}=" "$env_file" 2>/dev/null; then
    sed -i.bak "s|^${key}=.*|${key}=${value}|" "$env_file" && rm -f "${env_file}.bak"
  else
    echo "${key}=${value}" >> "$env_file"
  fi
}

configure_llm_providers() {
  local dir="$1"

  echo ""
  echo "${BOLD}── Optional LLM providers ──────────────────────────────────────────${RESET}"
  echo ""
  echo "  The demo ships with ${BOLD}Helix (Ping AI)${RESET} pre-configured."
  echo "  You can optionally add cloud LLM providers now (all skippable)."
  echo ""

  echo "  ${BOLD}Anthropic (Claude)${RESET}"
  echo "  Powers the LangChain and Mastra agents. API key from https://console.anthropic.com"
  echo ""
  if ask_yes_no "  Configure Anthropic API key now? [y/N] " no; then
    local anthropic_key=""
    if [[ -r /dev/tty ]]; then
      printf "  Paste your Anthropic API key (sk-ant-…): " >/dev/tty
      read -r anthropic_key </dev/tty || true
    fi
    if [[ -n "$anthropic_key" ]]; then
      _set_env_key "${dir}/langchain_agent/.env"    "ANTHROPIC_API_KEY"        "$anthropic_key"
      _set_env_key "${dir}/langchain_agent/.env"    "LANGCHAIN_LLM_PROVIDER"   "anthropic"
      _set_env_key "${dir}/mastra_agent/.env"       "ANTHROPIC_API_KEY"        "$anthropic_key"
      _set_env_key "${dir}/demo_agent_service/.env" "ANTHROPIC_API_KEY"        "$anthropic_key"
      ok "Anthropic API key saved."
    else
      warn "No key entered — skipping Anthropic."
    fi
  else
    info "Skipping Anthropic — add ANTHROPIC_API_KEY to langchain_agent/.env later if needed."
  fi

  echo ""

  echo "  ${BOLD}OpenAI${RESET}"
  echo "  Powers the OpenAI Agents SDK and Pydantic AI agents. API key from https://platform.openai.com"
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
    info "Skipping OpenAI — add OPENAI_API_KEY to the agent .env files later if needed."
  fi
}

main() {
  echo ""
  echo "${BOLD}AI Demo — Ping SE Cluster Setup${RESET}"
  echo ""
  echo "  This script sets up the AI Demo for deployment to the Ping SE DevOps"
  echo "  cluster (ping-dev-aws-us-east-2). It installs all prerequisites,"
  echo "  clones the repo, configures PingOne, and gives you one command to deploy."
  echo ""

  # Prompt for Ping email up front — needed for namespace derivation later.
  local PING_EMAIL="${PING_EMAIL:-}"
  if [[ -z "$PING_EMAIL" ]]; then
    if [[ -r /dev/tty ]]; then
      read -r -p "  Your Ping email (e.g. cmuir@pingidentity.com): " PING_EMAIL </dev/tty 2>/dev/null || true
    fi
  fi
  if [[ -z "$PING_EMAIL" ]]; then
    warn "No Ping email entered — you will be prompted for it when deploying."
  else
    ok "Ping email: ${PING_EMAIL}"
    export PING_EMAIL
  fi
  echo ""

  info "Installing prerequisites..."
  ensure_homebrew
  ensure_git
  ensure_node
  install_gh_cli
  ensure_python
  ensure_docker_desktop
  ensure_se_k8s_tools
  ensure_mkcert

  echo ""
  info "Checking gh CLI authentication..."
  if command -v gh >/dev/null 2>&1; then
    if ! gh auth status >/dev/null 2>&1; then
      warn "gh CLI not authenticated."
      warn "Run:  gh auth login"
      warn "Then: gh auth refresh -h github.com -s write:packages"
      warn "(write:packages scope is required to push Docker images to GHCR)"
    else
      ok "gh CLI authenticated."
      if ! gh auth token | docker login ghcr.io -u "$(gh api user --jq .login 2>/dev/null || echo placeholder)" --password-stdin >/dev/null 2>&1; then
        warn "GHCR login check: may need write:packages scope."
        warn "Run: gh auth refresh -h github.com -s write:packages"
      else
        ok "GHCR login verified."
        docker logout ghcr.io >/dev/null 2>&1 || true
      fi
    fi
  fi

  echo ""
  info "Checking kubectl context..."
  if command -v kubectl >/dev/null 2>&1; then
    local ctx
    ctx="$(kubectl config current-context 2>/dev/null || echo 'none')"
    if [[ "$ctx" == "us" || "$ctx" == "ping-dev-aws-us-east-2-oidc" ]]; then
      ok "kubectl context: $ctx (SE cluster)"
    else
      warn "kubectl context is '${ctx}', not 'us' (the SE cluster context)."
      warn "Before deploying, run: kubectl config use-context us"
      warn "If 'us' context is missing, add it per the SE cluster access guide."
    fi
  fi

  # Resolve install directory
  local cwd="${PWD:-$(pwd 2>/dev/null)}"
  cwd="${cwd:-$HOME}"

  local _default_base="$cwd"
  if [[ -z "${INSTALL_DIR:-}" ]]; then
    local _cur_remote
    _cur_remote="$(git remote get-url origin 2>/dev/null || true)"
    if [[ "$_cur_remote" == "$REPO_URL" || "$_cur_remote" == "${REPO_URL%.git}" ]]; then
      _default_base="$HOME"
      info "Running from inside the repo — defaulting install dir to \$HOME/${DEFAULT_DIR_NAME}."
    fi
  fi
  local target="${INSTALL_DIR:-${_default_base}/${DEFAULT_DIR_NAME}}"

  case "$target" in /*) ;; *) target="${cwd}/${target}" ;; esac
  target="$(printf '%s' "$target" | sed 's|//*|/|g')"
  target="${target%/}"
  [[ -z "$target" ]] && target="/"

  local parent
  parent="$(dirname "$target")"
  if [[ ! -w "$parent" ]]; then
    fatal "Cannot write to parent directory: ${parent}"
  fi

  local exists="no"
  [[ -d "$target" ]] && exists="yes"

  confirm_dir "$target" "$exists"

  if [[ "${INSTALL_DIR:-}" != "$target" && -n "${INSTALL_DIR:-}" ]]; then
    target="${INSTALL_DIR}"
    target="${target/#\~/$HOME}"
    target="$(printf '%s' "$target" | sed 's|//*|/|g')"
    target="${target%/}"
    exists="no"
    [[ -d "$target" ]] && exists="yes"
    parent="$(dirname "$target")"
  fi

  [[ "$exists" == "no" ]] && mkdir -p "$(dirname "$target")"

  clone_or_update "$target"

  # Cache the Ping email into demo_api_server/.env before setup:fresh runs
  # so the bootstrap can prompt for PingOne with the right namespace context.
  if [[ -n "${PING_EMAIL:-}" && -d "$target/demo_api_server" ]]; then
    local env_file="${target}/demo_api_server/.env"
    if [[ ! -f "$env_file" && -f "${env_file}.example" ]]; then
      cp "${env_file}.example" "$env_file"
    fi
    if [[ -f "$env_file" ]]; then
      if grep -q '^PING_EMAIL=' "$env_file" 2>/dev/null; then
        sed -i.bak "s|^PING_EMAIL=.*|PING_EMAIL=${PING_EMAIL}|" "$env_file" && rm -f "${env_file}.bak"
      else
        echo "PING_EMAIL=${PING_EMAIL}" >> "$env_file"
      fi
      ok "Saved PING_EMAIL to demo_api_server/.env."
    fi
  fi

  setup_certs "$target"
  run_setup "$target"
  configure_llm_providers "$target"

  echo ""
  ok "AI Demo installed at: ${BOLD}${target}${RESET}"
  echo ""
  echo "${BOLD}── Next steps ──────────────────────────────────────────────────────${RESET}"
  echo ""
  echo "  1. Make sure your SE namespace is provisioned:"
  echo "     ${DIM}Request via JIRA DEVHELP ticket if you don't have one yet.${RESET}"
  echo ""
  echo "  2. Set kubectl context to the SE cluster:"
  echo "     ${BOLD}kubectl config use-context us${RESET}"
  echo ""
  echo "  3. Authenticate gh CLI with GHCR push access:"
  echo "     ${BOLD}gh auth login${RESET}"
  echo "     ${BOLD}gh auth refresh -h github.com -s write:packages${RESET}"
  echo ""
  echo "  4. Build and deploy:"
  echo "     ${BOLD}cd $target && ./run-k8.sh se-all${RESET}"
  echo ""
  echo "     This will:"
  echo "       - Build all Docker images"
  echo "       - Push to GHCR (ghcr.io/<your-github-username>/...)"
  echo "       - Deploy to your SE namespace (ping-devops-<localpart>)"
  echo "       - App live at: ${BOLD}https://ai-demo.ping-devops.com${RESET}"
  echo ""
  echo "  ${YELLOW}${BOLD}⚠  IMPORTANT — Undeploy when done:${RESET}"
  echo "  ${YELLOW}The SE cluster is shared. Leaving the app running may result in"
  echo "  loss of your publishing rights.${RESET}"
  echo ""
  echo "  To undeploy:"
  echo "     ${BOLD}cd $target && ./run-k8.sh se-undeploy${RESET}"
  echo ""
}

main "$@"