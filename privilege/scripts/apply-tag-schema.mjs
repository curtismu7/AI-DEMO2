#!/usr/bin/env node
// Apply the 4-key tag schema (env / source / capability / protection) across the
// Privilege tenant, and keep the declarative tag-map-* tag policies in sync.
//
// What it does:
//   1. POST/PUT one `tag-map-*` tag policy per name family (the declarative
//      record — policies never auto-tag anything, they are documentation).
//   2. Back-fill ObjectMeta.CTags on every application, agent access key and
//      PAC policy whose name matches a family, via read-modify-write PUT.
//   3. Report anything with no matching family (untagged drift).
//
// Tag schema:
//   env         prod | demo | redteam | sandbox
//   source      ai-demo2 | standalone-LAB | manual
//   capability  free-form, what the resource can do (banking-transfers, ...)
//   protection  governed | ungoverned-allow-all | hostile | step-up-mfa
//
// Auth: local console "For Developers" key/secret (x-api-key / x-api-secret).
// Usage:
//   node privilege/scripts/apply-tag-schema.mjs \
//     --tenant <uuid> --key <api-key> --secret <api-secret> \
//     [--url https://local.procyon.ai:8643] [--dry-run] [--skip-policies]
const CONSOLE = process.env.PROCYON_URL || 'https://local.procyon.ai:8643';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]]);
  return acc;
}, []));

const TENANT = args.tenant;
const KEY = args.key;
const SECRET = args.secret;
const TOKEN = args.token; // x-auth-token cookie JSON (browser session route)
const DRY = 'dry-run' in args;
const SKIP_POLICIES = 'skip-policies' in args;
if ((!TENANT || !KEY || !SECRET) && !(TENANT && TOKEN)) {
  console.error('usage: apply-tag-schema.mjs (--tenant <uuid> --key <api-key> --secret <api-secret> | --tenant <uuid> --token <x-auth-token-json>) [--url <console-url>] [--dry-run] [--skip-policies]');
  process.exit(1);
}

const crypto = await import('node:crypto');
const SID = crypto.randomUUID();

if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, process.argv.slice(1), {
    env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' }, stdio: 'inherit',
  });
  process.exit(r.status ?? 1);
}

const headers = TOKEN
  ? {
      'x-auth-token': TOKEN,
      'x-procyon-session-id': SID,
      'content-type': 'application/json',
      accept: 'application/json',
    }
  : {
      'x-api-key': KEY,
      'x-api-secret': SECRET,
      'x-procyon-session-id': SID,
      'content-type': 'application/json',
      accept: 'application/json',
    };

async function api(method, path, body) {
  const res = await fetch(`${CONSOLE}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

// ---------------------------------------------------------------------------
// The schema: one entry per name family. Edit HERE when apps are added or
// renamed — the maintenance rule from TAG-POLICIES.md applies: a family whose
// regex matches nothing silently does nothing.
// ---------------------------------------------------------------------------
const FAMILIES = [
  // Banking family — governed doors
  {
    name: 'tag-map-banking',
    regex: '^(banking-mcp|banking-openapi|banking-aggregate|lab-banking-(full|limited|blocked|hitl))$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'banking-transfers', protection: 'governed' },
  },
  {
    name: 'tag-map-aggregate',
    regex: '^(aggregate(-limited|-none)?|lab-agg-(full|limited|blocked))$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'multi-server-aggregate', protection: 'governed' },
  },
  {
    name: 'tag-map-opensearch',
    regex: '^opensearch(-hitl2?)?$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'access-review-search', protection: 'governed' },
  },
  {
    name: 'tag-map-hostile',
    regex: '^(hostile-mcp|hostile-mcp-governed|hostile-a2a|libre)',
    tags: { env: 'redteam', source: 'ai-demo2', capability: 'hostile-redteam', protection: 'hostile' },
  },
  {
    name: 'tag-map-a2a',
    regex: '^(worker-agent|langchain-midagent|refused-agent|a2a-mcp-tools|workeragentdemo2)$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'a2a-agent-chain', protection: 'governed' },
  },
  {
    name: 'tag-map-catalog',
    regex: '^(mcp-brave-search|mcp-grafana|brave)$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'catalog-sidecar', protection: 'governed' },
  },
  {
    name: 'tag-map-infra',
    regex: '^(agent-gateway|pingone-admin-local)$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'gateway-infra', protection: 'governed' },
  },
  {
    name: 'tag-map-idjag',
    regex: '^(obo-idjag-test|pftoken|pftoken-rs|testobo|lab-obo-full|lab-obo-pf|lab-pftoken-(full|limited))$',
    tags: { env: 'sandbox', source: 'ai-demo2', capability: 'id-jag-test', protection: 'governed' },
  },
  {
    name: 'tag-map-meridian',
    regex: '^meridian-',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'payments-demo', protection: 'governed' },
  },
  {
    name: 'tag-map-muse',
    regex: '^muse-',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'content-demo', protection: 'governed' },
  },
  // Agent access keys (keys inherit the family of the app they call)
  {
    name: 'tag-map-key-aggregate',
    regex: '^(agg-(delegate|guest)|lab-agent|lab-agg(-(delegate|guest))?-key)$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'multi-server-aggregate', protection: 'governed' },
  },
  {
    name: 'tag-map-key-a2a',
    regex: '^(langchain-caller|main-agent|worker-agent|aws-agent-caller|aws-agent-worker)$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'a2a-agent-chain', protection: 'governed' },
  },
  // gateway-client lab banking keys + LLM proxy keys
  {
    name: 'tag-map-key-lab-banking',
    regex: '^lab-banking-(full|limited|blocked|hitl)-key$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'banking-transfers', protection: 'governed' },
  },
  {
    name: 'tag-map-key-llm',
    regex: '^(anthropic|openai|ollama|groq|llama\\.cpp|meta\\.[a-z0-9.-]+|pgc-agent-llm|LM-Stuidio|audit-test|local)$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'llm-proxy', protection: 'governed' },
  },
  {
    name: 'tag-map-key-logging',
    regex: '^(priv-log-agent|privilege-logging-lab-fed)$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'logging-test', protection: 'governed' },
  },
  {
    name: 'tag-map-pol-lab-banking',
    regex: '^(lab-banking-(full|limited|hitl)(-permit|-key-grant)?|aws-agent-worker-permit|priv-log-agent-grant)$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'banking-transfers', protection: 'governed' },
  },
  {
    name: 'tag-map-key-idjag',
    regex: '^(pftoken-agent|pftoken-wl|tmp-pf-route-c-key|testobo-agent|privilege-logging-lab-fed|lab-pftoken-key|lab-obo-pf-key)$',
    tags: { env: 'sandbox', source: 'ai-demo2', capability: 'id-jag-test', protection: 'governed' },
  },
  {
    name: 'tag-map-key-obs',
    regex: '^obs-logging-test$',
    tags: { env: 'sandbox', source: 'ai-demo2', capability: 'logging-test', protection: 'governed' },
  },
  {
    name: 'tag-map-key-spiffe',
    regex: '^lab-spiffe-issuer-key$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'spiffe-identity-lab', protection: 'governed' },
  },
  {
    name: 'tag-map-pol-spiffe',
    regex: '^lab-spiffe-issuer-key-grant$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'spiffe-identity-lab', protection: 'governed' },
  },
  {
    name: 'tag-map-key-hitl',
    regex: '^lab-opensearch-hitl-key$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'access-review-search', protection: 'governed' },
  },
  {
    name: 'tag-map-pol-hitl',
    regex: '^lab-opensearch-hitl-key-grant$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'access-review-search', protection: 'governed' },
  },
  // HITL banking door (lab-banking-hitl, added 2026-11-25 by the move session)
  {
    name: 'tag-map-banking-hitl',
    regex: '^lab-banking-hitl(-key(-grant)?)?$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'banking-transfers', protection: 'governed' },
  },
  {
    name: 'tag-map-pol-banking-hitl',
    regex: '^lab-banking-hitl-(permit|key-grant)$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'banking-transfers', protection: 'governed' },
  },
  // PAC policies: console-generated per-principal "River-*" objects and
  // per-door permit rules. Policy names echo the app family they govern.
  {
    name: 'tag-map-pol-river',
    regex: '^[A-Za-z]+(River|Fork|Mersey)-',
    tags: { env: 'demo', source: 'manual', capability: 'console-generated-principal', protection: 'governed' },
  },
  {
    name: 'tag-map-pol-opensearch',
    regex: '^opensearch-hitl2?-permit$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'access-review-search', protection: 'governed' },
  },
  {
    name: 'tag-map-pol-aggregate',
    regex: '^(agg-(delegate|guest)-aggregate-limited|lab-agent-aggregate(-limited|-none)?|lab-agg-(delegate|guest)-key-grant|lab-agg-(full|limited)-permit|lab-agg-key-grant)$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'multi-server-aggregate', protection: 'governed' },
  },
  // lab-banking / lab-obo / lab-pftoken door permits and key grants
  {
    name: 'tag-map-pol-lab-banking',
    regex: '^lab-banking-(full|limited)(-permit|-key-grant)?$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'banking-transfers', protection: 'governed' },
  },
  {
    name: 'tag-map-pol-lab-idjag',
    regex: '^lab-(obo-full-permit|obo-pf-(permit|key-grant)|pftoken-(full|limited)-permit|pftoken-key-grant)$',
    tags: { env: 'sandbox', source: 'ai-demo2', capability: 'id-jag-test', protection: 'governed' },
  },
  // agg222 — stray scratch aggregate app (leftover test create, per
  // CURRENT-CONFIGURATION.md the miscreated duplicate pattern)
  {
    name: 'tag-map-scratch',
    regex: '^agg222$',
    tags: { env: 'sandbox', source: 'manual', capability: 'scratch-test', protection: 'governed' },
  },
  {
    name: 'tag-map-pol-a2a',
    regex: '^MainAgentA2aMcpTools$',
    tags: { env: 'demo', source: 'ai-demo2', capability: 'a2a-agent-chain', protection: 'governed' },
  },
];

function familyFor(name) {
  return FAMILIES.find((f) => {
    try { return new RegExp(f.regex).test(name); } catch { return false; }
  });
}

async function tagObject(kind, path, obj, name) {
  const fam = familyFor(name);
  if (!fam) {
    console.log(`  ? ${kind} "${name}" matches NO tag-map family — tag manually or add a family`);
    return 'orphan';
  }
  const desired = JSON.stringify(fam.tags);
  const curMap = obj.ObjectMeta?.CTags?.Map || {};
  const current = JSON.stringify(Object.fromEntries(fam.tags ? Object.keys(fam.tags).map((k) => [k, curMap[k]]) : []));
  if (current === desired) {
    console.log(`  = ${kind} "${name}" already tagged ${desired}`);
    return 'unchanged';
  }
  console.log(`  ~ ${kind} "${name}" -> family ${fam.name} tags ${desired}${DRY ? ' (dry-run)' : ''}`);
  if (!DRY) {
    const updated = JSON.parse(JSON.stringify(obj));
    updated.ObjectMeta.CTags = { Map: { ...(obj.ObjectMeta?.CTags?.Map || {}), ...fam.tags } };
    await api('PUT', path, updated);
  }
  return 'tagged';
}

(async () => {
  const stats = { tagged: 0, unchanged: 0, orphan: 0 };

  if (!SKIP_POLICIES) {
    console.log('== tag policies (declarative record) ==');
    const existing = await api('GET', `/api/${TENANT}/v1/tagpolicys`);
    const byName = new Map((existing.TagPolicys || []).map((p) => [p.ObjectMeta?.Name, p]));
    for (const fam of FAMILIES) {
      const body = {
        ObjectMeta: { Kind: 'TagPolicy', Tenant: TENANT, Namespace: 'default', Name: fam.name },
        RegExPattern: fam.regex,
        KindMap: { Map: { Application: 'true' } },
        Tags: { Map: fam.tags },
        FixedPatterns: { Elems: [] },
        PolicyOrigin: 'Default',
      };
      if (byName.has(fam.name)) {
        const cur = byName.get(fam.name);
        if (cur.RegExPattern === fam.regex && JSON.stringify(cur.Tags?.Map || {}) === JSON.stringify(fam.tags)) {
          console.log(`  = ${fam.name} up to date`);
        } else {
          console.log(`  ~ ${fam.name} differs — PUT${DRY ? ' (dry-run)' : ''}`);
          if (!DRY) {
            const merged = { ...cur, RegExPattern: fam.regex, Tags: { Map: fam.tags } };
            await api('PUT', `/api/${TENANT}/v1/tagpolicys/default/${fam.name}`, merged);
          }
        }
      } else {
        console.log(`  + ${fam.name} POST${DRY ? ' (dry-run)' : ''}`);
        if (!DRY) await api('POST', `/api/${TENANT}/v1/tagpolicys`, body);
      }
    }
    // stale families: live policies no longer in FAMILIES (ignoring legacy demo-map-*)
    for (const n of byName.keys()) {
      if (!n.startsWith('demo-map-') && !FAMILIES.some((f) => f.name === n)) {
        console.log(`  ! stale tag policy "${n}" is not in FAMILIES — delete or adopt it`);
      }
    }
  }

  console.log('== applications ==');
  const appsBody = await api('GET', `/api/${TENANT}/v1/applications`);
  for (const app of appsBody.Applications || []) {
    const n = app.ObjectMeta?.Name;
    if (!n) continue;
    const r = await tagObject('app', `/api/${TENANT}/v1/applications/default/${n}`, app, n);
    stats[r] += 1;
  }

  console.log('== agent access keys (namespaced PUT only) ==');
  const keysBody = await api('GET', `/api/${TENANT}/v1/agentaccesskeys`);
  for (const key of keysBody.AgentAccessKeys || keysBody.agentaccesskeys || keysBody.Items || []) {
    const n = key.ObjectMeta?.Name;
    if (!n) continue;
    try {
      const r = await tagObject('key', `/api/${TENANT}/v1/agentaccesskeys/default/${n}`, key, n);
      stats[r] += 1;
    } catch (e) {
      console.log(`  x key "${n}" PUT failed: ${e.message}`);
    }
  }

  console.log('== pac policies ==');
  const polBody = await api('GET', `/api/${TENANT}/v1/pacpolicys`);
  for (const pol of polBody.PacPolicys || []) {
    const n = pol.ObjectMeta?.Name;
    if (!n) continue;
    try {
      const r = await tagObject('policy', `/api/${TENANT}/v1/pacpolicys/default/${n}`, pol, n);
      stats[r] += 1;
    } catch (e) {
      console.log(`  x policy "${n}" PUT failed: ${e.message}`);
    }
  }

  console.log(`== summary: tagged ${stats.tagged}, unchanged ${stats.unchanged}, orphan ${stats.orphan}${DRY ? ' (DRY-RUN)' : ''} ==`);
  if (stats.orphan) process.exitCode = 2; // orphan resources need a family added
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
