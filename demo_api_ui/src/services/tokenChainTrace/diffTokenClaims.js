// Compares the security-relevant claims of a token against its parent in the
// delegation chain. Returns only CHANGED rows, with a teaching note.

const str = (v) => (v === undefined || v === null || v === "" ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export function diffTokenClaims(parentClaims = {}, childClaims = {}) {
  const rows = [];

  if (str(parentClaims.scope) !== str(childClaims.scope)) {
    const before = String(parentClaims.scope || "").split(" ").filter(Boolean);
    const after = String(childClaims.scope || "").split(" ").filter(Boolean);
    rows.push({ claim: "scope", from: str(parentClaims.scope), to: str(childClaims.scope),
      note: after.length && after.length < before.length ? "narrowed" : "changed" });
  }
  if (str(parentClaims.aud) !== str(childClaims.aud)) {
    rows.push({ claim: "aud", from: str(parentClaims.aud), to: str(childClaims.aud),
      note: "rebound (RFC 8707)" });
  }
  if (str(parentClaims.act) !== str(childClaims.act)) {
    rows.push({ claim: "act", from: str(parentClaims.act), to: str(childClaims.act),
      note: childClaims.act && !parentClaims.act
        ? "delegation proof added (RFC 8693)" : "changed" });
  }
  if (parentClaims.exp != null && childClaims.exp != null &&
      Number(parentClaims.exp) !== Number(childClaims.exp)) {
    rows.push({ claim: "exp", from: str(parentClaims.exp), to: str(childClaims.exp),
      note: Number(childClaims.exp) < Number(parentClaims.exp) ? "shortened" : "extended" });
  }
  return rows;
}
