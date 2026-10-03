{{- define "agentless-mcpgw.name" -}}
agentless-mcpgw
{{- end }}

{{- define "agentless-mcpgw.lbName" -}}
{{ .Values.loadBalancer.name | default "mcpgw-lb" }}
{{- end }}

{{- /* Service the ingresses route to. An explicit frontService wins; otherwise the
       chart's own load balancer when it is enabled; otherwise the gateway itself. */ -}}
{{- define "agentless-mcpgw.front" -}}
{{- if .Values.frontService -}}
{{ .Values.frontService }}
{{- else if .Values.loadBalancer.enabled -}}
{{ include "agentless-mcpgw.lbName" . }}
{{- else -}}
{{ include "agentless-mcpgw.name" . }}
{{- end -}}
{{- end }}

{{- define "agentless-mcpgw.labels" -}}
app: {{ include "agentless-mcpgw.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}
