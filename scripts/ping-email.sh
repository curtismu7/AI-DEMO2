#!/usr/bin/env bash
# scripts/ping-email.sh — shared Ping Identity email validation for SE K8 namespace.
#
# PING_EMAIL must end in @pingidentity.com. Personal emails are rejected.
# Source from other scripts:  source "$(dirname "$0")/scripts/ping-email.sh"

PING_EMAIL_DOMAIN='@pingidentity.com'

# Return 0 when $1 is a valid Ping Identity email.
is_valid_ping_email() {
  local email
  email="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d ' "')"
  [[ -n "$email" && "$email" == *"${PING_EMAIL_DOMAIN}" ]]
}

# Print a normalized Ping email, or nothing when invalid.
sanitize_ping_email() {
  local email
  email="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d ' "')"
  if is_valid_ping_email "$email"; then
    printf '%s' "$email"
  fi
}

# Prompt until the user enters a valid @pingidentity.com email or leaves blank.
# Usage: read_ping_email "  Your Ping email: "
read_ping_email() {
  local prompt="${1:-  Your Ping email (e.g. cmuir@pingidentity.com): }"
  local _input="" _valid=""
  while true; do
    _input=""
    if [[ -r /dev/tty ]]; then
      read -r -p "$prompt" _input </dev/tty 2>/dev/null || true
    elif [[ -t 0 ]]; then
      read -r -p "$prompt" _input
    fi
    _input="$(printf '%s' "$_input" | tr -d ' "')"
    [[ -z "$_input" ]] && return 0
    _valid="$(sanitize_ping_email "$_input")"
    if [[ -n "$_valid" ]]; then
      printf '%s' "$_valid"
      return 0
    fi
    echo "  Must be a @pingidentity.com address (personal email is not allowed)." >&2
  done
}
