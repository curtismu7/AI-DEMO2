# Sensor enforcement: demo runbook

October 13, 2026 · SE demo script · run live on this Mac (OrbStack, arm64,
kernel `7.2.9-orbstack`) the same day

## The story in one sentence

The Privilege sensor does not just report AI workloads — when a policy denies a
process it **kills it**, and you can show that safely on a laptop with a
throwaway container and no console.

Background and the full policy model: [SENSOR-ENFORCEMENT-POLICIES](SENSOR-ENFORCEMENT-POLICIES.md).
Master index row: [feature 21](../docs/privilege-agent-features.md).

## Before you present

- OrbStack running (`docker context show` → `orbstack`). Not Docker Desktop.
- The image pulls anonymously and matches the Mac's architecture (verified
  2026-10-13: `public.ecr.aws/v2s2h8i9/procyon-nodesensor`, arm64, ~79 MB).
- Nothing else named `enf-target` / `enf-sensor`: `docker rm -f enf-sensor enf-target`.
- The denied name must exist nowhere else. `-all-namespaces` applies to every
  container on the host — a name like `python` would kill real workloads. This
  demo uses `denyme`.

## Act 1 — Audit: count, don't kill

```bash
docker run -d --name enf-target debian:stable-slim \
  sh -c 'cp /bin/sleep /tmp/denyme; sleep 3600'

docker run -d --name enf-sensor --pid=host --cap-add BPF --cap-add PERFMON \
  --security-opt label=disable -v /sys:/sys:ro \
  -v /var/lib/docker/containers:/var/lib/docker/containers:ro \
  public.ecr.aws/v2s2h8i9/procyon-nodesensor \
  -docker -cluster enforce-test -controller "" \
  -enforce audit -deny denyme -all-namespaces

sleep 8
docker exec enf-target sh -c '/tmp/denyme 2; echo exit=$?'
```

**Measured:** `exit=0` — the program ran to completion. Within ~30 s the stats
line reads `killed=0 would_kill=1`, and the exec was seen:

```
exec    pid=50586   denyme           host
nodesensor: started ... tier=terminate ... enforce=audit
nodesensor: stats ... killed=0 would_kill=1 ...
```

**What to say:** "Audit mode. The sensor saw `denyme` start and counted what it
*would* have terminated. Nothing died. This is how you roll a policy out."

## Act 2 — Enforce: the same program dies

```bash
docker rm -f enf-sensor
# same docker run as Act 1, with:  -enforce enforce
sleep 8
docker exec enf-target sh -c '/tmp/denyme 2; echo exit=$?'
```

**Measured:** `Killed`, `exit=137` (SIGKILL), and the stats line flips to
`killed=1 would_kill=0`. Same container, same program, one flag different.

**What to say:** "Enforcement means killing. The sensor lets the process start
and terminates it straight away — it doesn't prevent the launch. And in the real
deployment the console, not this flag, decides: a sensor started as an observer
begins enforcing when the console sends an enforcing policy."

## Reading the log

`docker logs` on OrbStack summarizes and truncates the output (it showed three
"errors" that were only DEBUG probe lines). To see the real lines, read the raw
log through the Docker API socket:

```bash
S=$(docker context inspect orbstack -f '{{.Endpoints.docker.Host}}' | sed 's#unix://##')
curl -s --unix-socket "$S" "http://d/containers/enf-sensor/logs?stdout=1&stderr=1&tail=300" \
  | LC_ALL=C tr -c '[:print:]\n' ' ' | grep -a -E "started|stats|exec|denyme"
```

## Clean up

```bash
docker rm -f enf-sensor enf-target
```

## What this proves, and what it does not

- **Proves:** workload-level enforcement works, audit-first rollout works, and
  the enforce/audit difference is a single flag.
- **Does not prove:** console-pushed policy. This run used the `-controller ""`
  standalone mode (flags only, reports nothing). The console→sensor policy path
  is documented in the policies guide but was not exercised here.
- **Platform note:** the sensor's own `probe unreachable` DEBUG lines are noise
  from the other containers on the host; they don't affect enforcement.
