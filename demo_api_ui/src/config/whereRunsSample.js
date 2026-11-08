// whereRunsSample.js - a bundled, sanitized sample in the env-map/1 shape for /where-everything-runs.
// Workload names, kinds and replica counts only. No hostnames, URLs, IPs, tenant or environment ids, client ids,
// emails or secrets: this repo is public, and the BFF cannot run kubectl or docker. The standalone env-map-LAB app
// (http://localhost:7805) reads a Real snapshot of your own machine.
const w = (name, kind, ready, want, group, role) => ({ name, kind, ready, want, group, role });
const up = (name, group, role) => w(name, "container", 1, 1, group, role);
const off = (name, group, role) => w(name, "container", 0, 0, group, role);
const svc = (name) => ({ name, kind: "service", role: "external" });

export const WHERE_RUNS_SAMPLE = {
  schema: "env-map/1",
  takenAt: "2026-11-08T12:00:00Z",
  environments: [
    {
      id: "mac", label: "This Mac (Docker)", kind: "local",
      workloads: [
        up("ui", "Web front ends", "frontend"),
        up("grafana", "Web front ends", "frontend"),
        up("kibana", "Web front ends", "frontend"),
        up("demo-api-server", "Demo app servers", "server"),
        up("demo-agent-service", "Demo app servers", "server"),
        up("demo-hitl-service", "Demo app servers", "server"),
        off("langchain-agent", "Demo app servers", "server"),
        up("demo-mcp-gateway", "Gateway and MCP", "server"),
        up("oauth-mcp", "Gateway and MCP", "server"),
        up("pingfederate", "Identity and data", "server"),
        up("postgres", "Identity and data", "server"),
        up("redis", "Identity and data", "server"),
        up("prometheus", "Observability", "server"),
        up("loki", "Observability", "server"),
        up("id-jag-lab", "Standalone labs", "lab"),
        up("privilege-demo-lab", "Standalone labs", "lab"),
        up("env-map-lab", "Standalone labs", "lab"),
        off("attack-gallery-lab", "Standalone labs", "lab"),
      ],
    },
    {
      id: "ai-demo", label: "Namespace ai-demo", kind: "k8s",
      workloads: [
        w("ui", "deployment", 2, 2, "Demo app", "frontend"),
        w("demo-api-server", "deployment", 2, 2, "Demo app", "server"),
        w("demo-agent-service", "deployment", 1, 1, "Demo app", "server"),
        w("demo-hitl-service", "deployment", 1, 1, "Demo app", "server"),
        w("mcp-gateway", "deployment", 2, 2, "Gateway", "server"),
        w("oauth-mcp", "deployment", 1, 1, "Gateway", "server"),
        w("hostile-mcp", "deployment", 1, 1, "Gateway", "server"),
        w("cimd-lab", "deployment", 1, 1, "Labs", "lab"),
        w("legacy-console", "deployment", 0, 0, "Legacy", "frontend"),
      ],
    },
    {
      id: "monitoring", label: "Namespace monitoring", kind: "k8s",
      workloads: [
        w("prometheus", "statefulset", 1, 1, "Observability", "server"),
        w("alertmanager", "deployment", 1, 1, "Observability", "server"),
        w("grafana", "deployment", 1, 1, "Observability", "frontend"),
        w("loki", "statefulset", 0, 0, "Observability", "server"),
      ],
    },
    { id: "pingone", label: "PingOne (SaaS)", kind: "saas", workloads: [svc("sign-in"), svc("token-exchange"), svc("davinci")] },
    { id: "llm", label: "Model provider (SaaS)", kind: "saas", workloads: [svc("chat-completions")] },
  ],
  links: [
    { from: "mac/ui", to: "mac/demo-api-server", label: "BFF calls", source: "seen" },
    { from: "mac/demo-api-server", to: "pingone/sign-in", label: "Sign-in", source: "seen" },
    { from: "mac/demo-api-server", to: "pingone/token-exchange", label: "Token exchange", source: "seen" },
    { from: "mac/demo-api-server", to: "mac/demo-agent-service", label: "Agent runs", source: "seen" },
    { from: "mac/demo-agent-service", to: "mac/demo-mcp-gateway", label: "Tool calls", source: "seen" },
    { from: "mac/demo-mcp-gateway", to: "mac/oauth-mcp", label: "MCP", source: "seen" },
    { from: "mac/demo-agent-service", to: "llm/chat-completions", label: "Model calls", source: "seen" },
    { from: "mac/privilege-demo-lab", to: "ai-demo/mcp-gateway", label: "Real-mode calls", source: "configured" },
    { from: "mac/id-jag-lab", to: "pingone/davinci", label: "Flows", source: "configured" },
    { from: "ai-demo/ui", to: "ai-demo/demo-api-server", label: "BFF calls", source: "seen" },
    { from: "ai-demo/demo-api-server", to: "ai-demo/demo-agent-service", label: "Agent runs", source: "seen" },
    { from: "ai-demo/demo-agent-service", to: "ai-demo/mcp-gateway", label: "Tool calls", source: "seen" },
    { from: "ai-demo/mcp-gateway", to: "ai-demo/oauth-mcp", label: "MCP", source: "seen" },
    { from: "ai-demo/mcp-gateway", to: "ai-demo/hostile-mcp", label: "MCP", source: "seen" },
    { from: "monitoring/prometheus", to: "monitoring/alertmanager", label: "Alerts", source: "seen" },
    { from: "monitoring/grafana", to: "monitoring/prometheus", label: "Queries", source: "seen" },
  ],
};
