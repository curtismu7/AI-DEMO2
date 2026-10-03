{{- define "agentless-mcpgw.name" -}}
agentless-mcpgw
{{- end }}

{{- /* Service the ingresses route to: the gateway itself unless frontService
       names a load balancer in front of it. */ -}}
{{- define "agentless-mcpgw.front" -}}
{{ default (include "agentless-mcpgw.name" .) .Values.frontService }}
{{- end }}

{{- define "agentless-mcpgw.labels" -}}
app: {{ include "agentless-mcpgw.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}
