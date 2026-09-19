export type RecoveryResult =
  | { status: 'recovered' }
  | { status: 'no-server' }
  | { status: 'in-flight' }
  | { status: 'authentication-required' }
  | { status: 'reconnect-failed' }
  | { status: 'timeout' }
  | { status: 'delete-failed' };

export function normalizeMcpServerNames(serverNames: readonly string[]): string[] {
  return [...new Set(serverNames.map((serverName) => serverName.trim()).filter(Boolean))];
}
