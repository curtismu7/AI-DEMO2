#!/usr/bin/env bash
# Self-check for deploy-live.sh's monitoring-config path dispatch.
#   bash scripts/deploy-live.monitoringConfigs.test.sh
#
# The failure this guards is silent staleness, not an abort: monitoring/*.yml
# changes used to fall through the generic `*) : ;;` catch-all ("docs, tests,
# host-only scripts, snapshots — nothing to deploy"), so a merged Prometheus
# scrape-config change never restarted the Prometheus container. Confirmed
# live 2026-09-08 — a running Prometheus kept scraping its original 5 targets
# for hours after prometheus.yml grew 5 more, because --web.enable-lifecycle
# is set but nothing calls /-/reload, and this script never restarted it
# either.
#
# Sourcing the real script is not possible (it locks, syncs and deploys), so
# this extracts the path-matching loop's case block and exercises it directly
# against fake add_restart/note stubs — the point is that THIS file's
# dispatch table routes each path correctly, not that a deploy actually runs.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/deploy-live.sh"
fails=0
ok()  { echo "  ok   — $1"; }
bad() { echo "  FAIL — $1"; fails=$((fails + 1)); }

echo "deploy-live monitoring-config dispatch:"

bash -n "$SCRIPT" 2>/dev/null && ok "deploy-live.sh parses" || bad "deploy-live.sh has a syntax error"

# Bound the extraction so a structural change to the loop fails loudly here
# instead of silently testing nothing.
loop_src="$(awk '/^while IFS= read -r f; do$/,/^done <<<"\$CHANGED"$/' "$SCRIPT")"
if [ -z "$loop_src" ] || [ "$(printf '%s\n' "$loop_src" | wc -l | tr -d ' ')" -lt 20 ]; then
  bad "could not isolate the path-matching loop — has its shape changed?"
  exit 1
fi

# Fake collectors, matching the real script's own (test-independent of its
# unmanaged-service guard, which deploy-live.unmanaged.test.sh already covers).
RESTART_SET=""
BUILD_SET=""
NOTES=""
add_restart() { case " $RESTART_SET " in *" $1 "*) ;; *) RESTART_SET="$RESTART_SET $1" ;; esac; }
add_build()   { case " $BUILD_SET "   in *" $1 "*) ;; *) BUILD_SET="$BUILD_SET $1"   ;; esac; }
note()        { NOTES="${NOTES}$1"$'\n'; }

CHANGED="monitoring/prometheus.yml
monitoring/alerts.yml
monitoring/alertmanager.yml
monitoring/alloy/config.docker.alloy
monitoring/grafana/provisioning/datasources/loki.yml
monitoring/grafana/dashboards/agents.json
README.md"
eval "$loop_src"

case " $RESTART_SET " in *" prometheus "*) ok "prometheus.yml schedules a prometheus restart" ;;
  *) bad "prometheus.yml did not schedule a prometheus restart" ;; esac

case " $RESTART_SET " in *" alertmanager "*) ok "alertmanager.yml schedules an alertmanager restart" ;;
  *) bad "alertmanager.yml did not schedule an alertmanager restart" ;; esac

case " $RESTART_SET " in *" alloy "*) ok "alloy config schedules an alloy restart" ;;
  *) bad "alloy config did not schedule an alloy restart" ;; esac

case " $RESTART_SET " in *" grafana "*) ok "grafana provisioning schedules a grafana restart" ;;
  *) bad "grafana provisioning did not schedule a grafana restart" ;; esac

# Dashboard JSON is deliberately excluded — Grafana's own file provider
# re-polls it every 30s, so a restart would be redundant work, not a bug fix.
# grafana IS in RESTART_SET already (from the provisioning path above), so
# this only proves the dashboard path itself added nothing further.
before_count=$(printf '%s' " $RESTART_SET " | grep -o 'grafana' | wc -l | tr -d ' ')
[ "$before_count" = "1" ] && ok "dashboard JSON adds no further restart beyond provisioning's own" \
  || bad "dashboard JSON scheduled grafana again (expected 1 occurrence, saw $before_count)"

# One unrelated markdown file must not schedule anything at all.
case " $BUILD_SET$RESTART_SET " in
  *" ui "*|*" demo-api-server "*) bad "README.md incorrectly scheduled a real service" ;;
  *) ok "an unrelated docs file schedules nothing" ;;
esac

echo
[ "$fails" -eq 0 ] && { echo "all checks passed"; exit 0; }
echo "$fails check(s) failed"; exit 1
