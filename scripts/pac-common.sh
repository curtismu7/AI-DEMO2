#!/usr/bin/env bash
# Shared setup for the pac (Policy as Code) wrapper scripts. Source, don't run.
#
# Resolves the jar and a working Java runtime, then materialises pac's endpoint
# config in a throwaway HOME rather than ~/.pac/endpoints.json.
#
# Why the throwaway HOME: pac reads connection details, including the worker
# CLIENT SECRET, from $HOME/.pac/endpoints.json in cleartext. Writing it there
# leaves a second long-lived copy of a live PingOne credential outside the
# gitignored .env files that are supposed to be the only place secrets live.
# Instead we build the file under a mktemp dir, point the JVM at it with
# -Duser.home, and delete it on exit — so demo_api_server/.env stays the single
# source of truth and nothing persists after the command finishes.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# The endpoint pac owns. Deploys REPLACE everything at this endpoint, so it must
# never point at the console-authored Transactions / MCP-first-tool endpoints.
PAC_DECISION_ENDPOINT_ID="${PAC_DECISION_ENDPOINT_ID:-ad5fc1d4-0227-45c6-8612-bd982bb6593e}"
PAC_ENDPOINT_ALIAS="${PAC_ENDPOINT_ALIAS:-demo}"

pac_fallback() {
  echo "" >&2
  echo "pac path failed. Fallback: generate a console import file instead." >&2
  echo "  Use the p1az-import-generator skill with the same rules, then import" >&2
  echo "  the JSON via PingOne console -> Authorize -> policy editor -> Import." >&2
  exit 1
}

pac_resolve_java() {
  # macOS ships /usr/bin/java as a stub that exists on PATH even with no JDK
  # installed — it only prints "Unable to locate a Java Runtime". So probe by
  # running it, not with `command -v`. Homebrew's openjdk is keg-only and is not
  # on PATH by default, hence the explicit fallback location.
  if ! java -version >/dev/null 2>&1; then
    if [ -x /opt/homebrew/opt/openjdk/bin/java ]; then
      export PATH="/opt/homebrew/opt/openjdk/bin:$PATH"
    else
      echo "ERROR: no working java runtime. pac.jar needs Java 21+." >&2
      echo "       Install one: brew install openjdk" >&2
      pac_fallback
    fi
  fi

  # pac.jar is built for Java 21 (see its MANIFEST Java-Version). An older JVM
  # fails with UnsupportedClassVersionError, which is a confusing way to find out.
  local major
  major="$(java -version 2>&1 | sed -n '1s/.*version "\([0-9]*\).*/\1/p')"
  if [ -n "$major" ] && [ "$major" -lt 21 ]; then
    echo "ERROR: java $major found, but pac.jar needs Java 21+." >&2
    echo "       Install a newer one: brew install openjdk" >&2
    pac_fallback
  fi
}

pac_resolve_jar() {
  # pac.jar is a 33MB Ping-supplied binary, so it is not committed.
  PAC_JAR="${PAC_JAR:-$ROOT/pac/pac.jar}"
  if [ ! -f "$PAC_JAR" ]; then
    echo "ERROR: pac.jar not found at $PAC_JAR" >&2
    echo "       Set PAC_JAR=/path/to/pac.jar (see pac/README.md)." >&2
    pac_fallback
  fi
}

# Builds $PAC_HOME/.pac/endpoints.json from demo_api_server/.env and registers a
# trap to shred it. Call once; then invoke pac as `java -Duser.home="$PAC_HOME"`.
pac_build_ephemeral_home() {
  local envf="${PAC_ENV_FILE:-$ROOT/demo_api_server/.env}"

  # demo_api_server/.env is gitignored, so it does not exist inside a worktree
  # under .claude/worktrees/ — only in the main checkout. Fall back to that via
  # the shared git dir, so these scripts work from either place.
  if [ ! -f "$envf" ] && [ -z "${PAC_ENV_FILE:-}" ]; then
    local common_dir main_root
    if common_dir="$(git -C "$ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null)"; then
      main_root="$(dirname "$common_dir")"
      if [ -f "$main_root/demo_api_server/.env" ]; then
        envf="$main_root/demo_api_server/.env"
      fi
    fi
  fi

  if [ ! -f "$envf" ]; then
    echo "ERROR: $envf not found — cannot resolve PingOne worker credentials." >&2
    echo "       Set PAC_ENV_FILE=/path/to/demo_api_server/.env to override." >&2
    pac_fallback
  fi

  local get env_id client_id client_secret
  get() { grep -E "^$1=" "$envf" | head -1 | cut -d= -f2- | tr -d '"'\''\r'; }
  env_id="$(get PINGONE_ENVIRONMENT_ID)"
  client_id="$(get PINGONE_WORKER_CLIENT_ID)"
  client_secret="$(get PINGONE_WORKER_CLIENT_SECRET)"

  if [ -z "$env_id" ] || [ -z "$client_id" ] || [ -z "$client_secret" ]; then
    echo "ERROR: PINGONE_ENVIRONMENT_ID / PINGONE_WORKER_CLIENT_ID /" >&2
    echo "       PINGONE_WORKER_CLIENT_SECRET missing from $envf." >&2
    pac_fallback
  fi

  PAC_HOME="$(mktemp -d)"
  chmod 700 "$PAC_HOME"
  mkdir -p "$PAC_HOME/.pac"
  # shellcheck disable=SC2064  # expand PAC_HOME now, so the trap still fires if it is reassigned
  trap "rm -rf '$PAC_HOME'" EXIT INT TERM

  # Written via python3 so the secret is passed as argv to a local process and
  # never interpolated into a shell string that could land in a trace or history.
  PAC_ENDPOINT_ALIAS="$PAC_ENDPOINT_ALIAS" python3 - \
    "$PAC_HOME/.pac/endpoints.json" "$env_id" "$PAC_DECISION_ENDPOINT_ID" "$client_id" "$client_secret" <<'PY'
import json, os, sys
path, env_id, endpoint_id, client_id, client_secret = sys.argv[1:6]
cfg = {"endpoints": {os.environ["PAC_ENDPOINT_ALIAS"]: {
    "decisionEndpointUrl":
        f"https://api.pingone.com/v1/environments/{env_id}/decisionEndpoints/{endpoint_id}",
    "clientId": client_id,
    "clientSecret": client_secret,
}}}
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, "w") as fh:
    json.dump(cfg, fh, indent=2)
PY
}

pac_setup() {
  pac_resolve_java
  pac_resolve_jar
  pac_build_ephemeral_home
}
