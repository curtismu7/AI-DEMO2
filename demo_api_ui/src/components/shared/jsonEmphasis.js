// The colour emphasis JsonHighlight has always applied, for call sites that use the JSON pane directly: the old
// focus fields stand out as important keys, the old critical fields in the alert colour. JsonPane merges these with
// its own defaults, so passing them only adds keys. (aud and scope are already in the pane's default important keys.)
export const LEGACY_HOT = ["payload", "RarAuthorizationDetails", "rarauthorizationdetails", "authorization_details"];
export const LEGACY_ALERT = ["status", "errorCode", "error_code", "result"];
