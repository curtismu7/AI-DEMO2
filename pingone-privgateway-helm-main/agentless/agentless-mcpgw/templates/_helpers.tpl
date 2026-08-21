{{- define "agentless-mcpgw.name" -}}
agentless-mcpgw
{{- end }}

{{- define "agentless-mcpgw.labels" -}}
app: {{ include "agentless-mcpgw.name" . }}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
{{- end }}
