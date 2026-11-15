{{- /* nameOverride lets a second release live in the SAME namespace as the first: every
       resource, label and hostPath below is built from this name. Absent or empty
       (including under --reuse-values) it is the historical "agentless-mcpgw". */ -}}
{{- define "agentless-mcpgw.name" -}}
{{ .Values.nameOverride | default "agentless-mcpgw" }}
{{- end }}

{{- /* False only when ingress.enabled is explicitly false. `default true` cannot be
       used: it would turn an explicit false back into true. */ -}}
{{- define "agentless-mcpgw.ingressEnabled" -}}
{{- $ing := .Values.ingress | default dict -}}
{{- if or (not (hasKey $ing "enabled")) $ing.enabled }}true{{ end -}}
{{- end }}

{{- /* `| default dict` throughout: a release upgraded with --reuse-values may not
       receive this chart's new default values, so loadBalancer (or any key in it)
       can be absent. Every read of it has to survive that. */ -}}
{{- define "agentless-mcpgw.lbName" -}}
{{ (.Values.loadBalancer | default dict).name | default "mcpgw-lb" }}
{{- end }}

{{- /* Service the ingresses route to. An explicit frontService wins; otherwise the
       chart's own load balancer when it is enabled; otherwise the gateway itself. */ -}}
{{- define "agentless-mcpgw.front" -}}
{{- if .Values.frontService -}}
{{ .Values.frontService }}
{{- else if (.Values.loadBalancer | default dict).enabled -}}
{{ include "agentless-mcpgw.lbName" . }}
{{- else -}}
{{ include "agentless-mcpgw.name" . }}
{{- end -}}
{{- end }}

{{- define "agentless-mcpgw.labels" -}}
app: {{ include "agentless-mcpgw.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}

{{- /* nginx backend-protocol for templates/ingress.yaml and ingress-mcp.yaml: whatever the front Service
       actually speaks. A load balancer front (the chart's own, or frontService)
       terminates TLS with this release's certificate: HTTPS. A gateway front serves
       TLS only when oidc.serverUrl's host matches its certificate (hostname), and
       plain HTTP otherwise. Measured 2026-11-15 on v1.261113: gateway-1 (serverUrl
       host = hostname) answered plain HTTP with "Client sent an HTTP request to an
       HTTPS server"; gateway-2 (serverUrl on another host) answered plain HTTP 200. */ -}}
{{- define "agentless-mcpgw.backendProtocol" -}}
{{- $oidc := .Values.oidc | default dict -}}
{{- if or .Values.frontService (.Values.loadBalancer | default dict).enabled -}}
HTTPS
{{- else if eq (urlParse ($oidc.serverUrl | default "")).hostname .Values.hostname -}}
HTTPS
{{- else -}}
HTTP
{{- end -}}
{{- end }}
