export function sequenceDiagramLabel(label, verticalName) {
  const agentName = verticalName?.trim() ? `${verticalName.trim()} Agent` : "AI Agent";
  return String(label || "").replace(/Banking Agent/gi, (match) =>
    match === match.toUpperCase() ? agentName.toUpperCase() : agentName,
  );
}
