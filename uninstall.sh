#!/usr/bin/env bash
# uninstall.sh — reverse install.sh for blank-machine testing.
#
# What this removes:
#   - The project directory (default: ~/AI-demo, or INSTALL_DIR if set)
#   - mkcert root CA from the system trust store + generated certs
#   - nvm and the Node version it installed
#   - Python venvs inside the project (pip-installed packages)
#   - Brew packages installed by install.sh that are NOT commonly pre-existing:
#     git, gh, python@3.12, mkcert, ollama, orbstack, kubectl, kubectx,
#     kubelogin (tap: int128/kubelogin), jwt-cli (tap: mike-engel/jwt-cli),
#     awscli, docker (cask)
#   - Shell profile lines added by nvm installer
#
# What this intentionally does NOT remove:
#   - Homebrew itself (too risky — user may have other things installed)
#   - Any Ollama models already pulled (large, slow to re-download)
#   - npm global packages (none installed by install.sh)
#   - redis (not installed by install.sh; used via Docker)
#
# Usage:
#   ./uninstall.sh                   # interactive
#   ASSUME_YES=1 ./uninstall.sh      # non-interactive (CI / testing)
#   INSTALL_DIR=/custom/path ./uninstall.sh

set -euo pipefail

BOLD=$'\033[1m'
RED=$'\033[0;31m'
YELLOW=$'\033[0;33m'
GREEN=$'\033[0;32m'
RESET=$'\033[0m'

info()  { echo "  ${BOLD}→${RESET} $*"; }
ok()    { echo "  ${GREEN}✓${RESET}  $*"; }
warn()  { echo "  ${YELLOW}⚠${RESET}  $*" >&2; }
err()   { echo "  ${RED}✗${RESET}  $*" >&2; }
sep()   { echo ""; echo "──────────────────────────────────────────"; echo ""; }

ask_yes_no() {
  local prompt="$1" default="${2:-yes}" answer=""
  if [[ "${ASSUME_YES:-0}" == "1" ]]; then
    [[ "$default" == "yes" ]] && return 0 || return 1
  fi
  if [[ -t 0 ]]; then
    read -r -p "$prompt" answer
  elif [[ -r /dev/tty ]]; then
    read -r -p "$prompt" answer </dev/tty
  else
    [[ "$default" == "yes" ]] && return 0 || return 1
  fi
  [[ -z "$answer" ]] && { [[ "$default" == "yes" ]] && return 0 || return 1; }
  case "$answer" in
    y|Y|yes|YES) return 0 ;;
    n|N|no|NO)   return 1 ;;
    *) [[ "$default" == "yes" ]] && return 0 || return 1 ;;
  esac
}

# ── Config ────────────────────────────────────────────────────────────────────

INSTALL_DIR="${INSTALL_DIR:-$HOME/AI-demo}"
NVM_DIR="${NVM_DIR:-$HOME/.nvm}"

echo ""
echo "${BOLD}AI Demo — Uninstaller${RESET}"
echo "This script undoes what install.sh set up for blank-machine testing."
sep

echo "  Install dir : ${BOLD}${INSTALL_DIR}${RESET}"
echo "  NVM dir     : ${BOLD}${NVM_DIR}${RESET}"
echo ""
echo "  ${YELLOW}Homebrew itself is NOT removed${RESET} (you may have other things using it)."
echo "  ${YELLOW}Ollama models are NOT removed${RESET} (large; re-download is slow)."
echo ""

if ! ask_yes_no "Proceed with uninstall? [y/N] " no; then
  echo "Aborted."
  exit 0
fi

sep

# ── 1. Project directory ──────────────────────────────────────────────────────

if [[ -d "$INSTALL_DIR" ]]; then
  info "Removing project directory: $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
  ok "Removed $INSTALL_DIR"
else
  warn "Project directory not found: $INSTALL_DIR — skipping."
fi

# ── 2. mkcert root CA ─────────────────────────────────────────────────────────

if command -v mkcert >/dev/null 2>&1; then
  ca_root="$(mkcert -CAROOT 2>/dev/null)" || ca_root=""
  if [[ -n "$ca_root" && -f "$ca_root/rootCA.pem" ]]; then
    info "Removing mkcert root CA from system trust store..."
    if sudo mkcert -uninstall 2>/dev/null; then
      ok "mkcert root CA removed."
    else
      warn "mkcert -uninstall failed — you can remove it manually: sudo mkcert -uninstall"
    fi
  else
    ok "mkcert root CA not installed — skipping."
  fi
  if [[ -n "$ca_root" && -d "$ca_root" ]]; then
    info "Removing mkcert CA directory: $ca_root"
    rm -rf "$ca_root"
    ok "mkcert CA directory removed."
  fi
else
  ok "mkcert not installed — skipping."
fi

# ── 3. nvm + Node ─────────────────────────────────────────────────────────────

if [[ -d "$NVM_DIR" ]]; then
  info "Removing nvm directory: $NVM_DIR"
  rm -rf "$NVM_DIR"
  ok "nvm removed."

  info "Removing nvm lines from shell profiles..."
  for profile in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
    if [[ -f "$profile" ]]; then
      # Remove the block nvm installer adds (export NVM_DIR + two source lines)
      # Use a temp file to avoid sed -i portability issues.
      tmp=$(mktemp)
      grep -v 'NVM_DIR\|nvm\.sh\|bash_completion' "$profile" > "$tmp" || true
      # Remove blank lines left at the boundary (at most 2 consecutive)
      awk 'NF || prev { print; prev = NF }' "$tmp" > "$profile"
      rm "$tmp"
      ok "Cleaned $profile"
    fi
  done
else
  ok "nvm not found at $NVM_DIR — skipping."
fi

# ── 4. Brew packages installed by install.sh ─────────────────────────────────

if ! command -v brew >/dev/null 2>&1; then
  warn "Homebrew not found — skipping brew package removal."
else
  sep
  echo "  ${BOLD}Brew packages${RESET}"
  echo "  The following were installed by install.sh. Uncheck any you want to keep."
  echo ""

  # Casks and formulae installed by install.sh.
  # Format: "formula_or_cask|display_name|is_cask"
  PACKAGES=(
    "git|git|formula"
    "gh|GitHub CLI (gh)|formula"
    "python@3.12|Python 3.12|formula"
    "mkcert|mkcert|formula"
    "ollama|Ollama|formula"
    "orbstack|OrbStack|cask"
    "docker-desktop|Docker Desktop|cask"
    "kubectl|kubectl|formula"
    "kubectx|kubectx|formula"
    "int128/kubelogin/kubelogin|kubelogin|formula"
    "mike-engel/jwt-cli/jwt-cli|jwt-cli|formula"
    "awscli|AWS CLI|formula"
  )

  TO_REMOVE=()
  for entry in "${PACKAGES[@]}"; do
    pkg="${entry%%|*}"
    name="${entry#*|}"; name="${name%|*}"
    kind="${entry##*|}"
    base="${pkg##*/}"  # strip tap prefix for brew list check

    if [[ "$kind" == "cask" ]]; then
      if brew list --cask "$base" >/dev/null 2>&1; then
        if ask_yes_no "  Remove ${BOLD}${name}${RESET} (${base})? [Y/n] " yes; then
          TO_REMOVE+=("${kind}:${pkg}")
        else
          warn "Keeping $name."
        fi
      fi
    else
      if brew list "$base" >/dev/null 2>&1; then
        if ask_yes_no "  Remove ${BOLD}${name}${RESET} (${base})? [Y/n] " yes; then
          TO_REMOVE+=("${kind}:${pkg}")
        else
          warn "Keeping $name."
        fi
      fi
    fi
  done

  if [[ ${#TO_REMOVE[@]} -gt 0 ]]; then
    sep
    info "Uninstalling selected packages..."
    for entry in "${TO_REMOVE[@]}"; do
      kind="${entry%%:*}"
      pkg="${entry#*:}"
      base="${pkg##*/}"
      if [[ "$kind" == "cask" ]]; then
        brew uninstall --cask "$base" --force 2>/dev/null \
          && ok "Removed cask: $base" \
          || warn "Failed to remove cask: $base (may not have been installed as a cask)"
      else
        brew uninstall "$base" --force 2>/dev/null \
          && ok "Removed: $base" \
          || warn "Failed to remove: $base"
      fi
    done

    # Remove Docker Desktop app data if Docker was uninstalled
    if printf '%s\n' "${TO_REMOVE[@]}" | grep -q '^cask:docker-desktop$'; then
      info "Removing Docker Desktop app data..."
      rm -rf "$HOME/Library/Application Support/Docker Desktop" 2>/dev/null || true
      rm -rf "$HOME/Library/Containers/com.docker.docker" 2>/dev/null || true
      rm -rf "$HOME/Library/Group Containers/group.com.docker" 2>/dev/null || true
      rm -rf "$HOME/.docker" 2>/dev/null || true
      ok "Docker app data removed."
    fi

    # Remove OrbStack app data if OrbStack was uninstalled
    if printf '%s\n' "${TO_REMOVE[@]}" | grep -q '^cask:orbstack$'; then
      info "Removing OrbStack app data..."
      rm -rf "$HOME/Library/Application Support/OrbStack" 2>/dev/null || true
      rm -rf "$HOME/Library/Containers/dev.orbstack.OrbStack" 2>/dev/null || true
      rm -rf "$HOME/Library/Group Containers/dev.orbstack" 2>/dev/null || true
      rm -rf "$HOME/.orbstack" 2>/dev/null || true
      ok "OrbStack app data removed."
      # OrbStack leaves docker/docker-compose symlinks in /usr/local/bin pointing
      # into OrbStack.app. After OrbStack is removed they become dangling and
      # block Docker Desktop's Homebrew cask from installing (it won't overwrite
      # an existing file at that path). Remove them so Docker Desktop can install.
      for _bin in docker docker-compose docker-credential-osxkeychain; do
        _orblink="/usr/local/bin/$_bin"
        if [[ -L "$_orblink" ]] && [[ "$(readlink "$_orblink")" == *OrbStack* ]]; then
          info "Removing stale OrbStack symlink: $_orblink"
          sudo rm -f "$_orblink" 2>/dev/null || rm -f "$_orblink" 2>/dev/null || true
        fi
      done
    fi

    # Remove ~/.kube if kube tools were uninstalled (kubectl or kubectx)
    if printf '%s\n' "${TO_REMOVE[@]}" | grep -qE '^formula:kube'; then
      if [[ -d "$HOME/.kube" ]]; then
        info "Removing ~/.kube (Kubernetes config and credentials)..."
        rm -rf "$HOME/.kube"
        ok "~/.kube removed."
      fi
    fi

    # Remove taps added by install.sh if they're now empty-ish
    for tap in "int128/kubelogin" "mike-engel/jwt-cli"; do
      if brew tap | grep -q "^${tap}$" 2>/dev/null; then
        brew untap "$tap" 2>/dev/null \
          && ok "Removed tap: $tap" \
          || true
      fi
    done
  else
    ok "No brew packages selected for removal."
  fi
fi

# ── 5. Shell profile: PATH line added for python@3.12 ────────────────────────

for profile in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile"; do
  if [[ -f "$profile" ]] && grep -q "python@3.12" "$profile" 2>/dev/null; then
    tmp=$(mktemp)
    grep -v "python@3.12" "$profile" > "$tmp" || true
    mv "$tmp" "$profile"
    ok "Removed python@3.12 PATH line from $profile"
  fi
done

# ── Done ──────────────────────────────────────────────────────────────────────

sep
echo "  ${GREEN}${BOLD}Uninstall complete.${RESET}"
echo ""
echo "  Homebrew is still installed — use it for any other tools you need."
echo "  To re-install the demo, run:"
echo ""
echo "    curl -fsSL https://raw.githubusercontent.com/curtismu7/AI-demo/main/install.sh | bash"
echo ""