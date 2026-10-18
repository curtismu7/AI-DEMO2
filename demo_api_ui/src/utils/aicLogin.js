// aic_login_enabled arrives from /api/admin/config as a string; one parse for every reader.
export function isAicLoginEnabled(cfg) {
  return String(cfg?.aic_login_enabled).toLowerCase() === 'true';
}

// ciba_login_enabled ships OFF (the PingOne login apps need the CIBA grant first).
export function isCibaLoginEnabled(cfg) {
  return String(cfg?.ciba_login_enabled).toLowerCase() === 'true';
}
