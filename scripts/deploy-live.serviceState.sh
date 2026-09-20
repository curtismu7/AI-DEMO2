#!/usr/bin/env bash
# Shared, side-effect-free helpers for deploy-live's per-service state.

deploy_live_service_stamp() {
  local state_root="$1" service="$2"
  printf '%s/services/%s.sha\n' "$state_root" "$service"
}

deploy_live_service_old() {
  local state_root="$1" service="$2" legacy_stamp="$3" stamp
  stamp="$(deploy_live_service_stamp "$state_root" "$service")"
  if [ -s "$stamp" ]; then
    tr -d '[:space:]' < "$stamp"
  elif [ -s "$legacy_stamp" ]; then
    tr -d '[:space:]' < "$legacy_stamp"
  else
    printf '\n'
  fi
}

deploy_live_service_selected() {
  local service="$1"
  case " ${TARGET_SERVICES:-} " in
    *" $service "*) return 0 ;;
    *) return 1 ;;
  esac
}

deploy_live_write_service_stamp() {
  local state_root="$1" service="$2" sha="$3" stamp
  stamp="$(deploy_live_service_stamp "$state_root" "$service")"
  mkdir -p "$(dirname "$stamp")"
  printf '%s\n' "$sha" > "$stamp"
}
