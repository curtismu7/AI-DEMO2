/**
 * Optional per-step detail on a use-case config.
 *
 *   steps: [{ beats: [0, 1], detail: { form?, tokens?: [{ note, header?, claims }], refs?: [{ id, title, kind }] } }]
 *
 * `beats` are indexes into cfg.walk (a beat may have no arrow, so the walk — not EDGES —
 * is the key the page panel already follows). The detail shape matches withStepDetail in utils/diagramReel.js.
 */
export function stepDetailForBeat(cfg, beat) {
  if (!Array.isArray(cfg?.steps) || beat == null || beat < 0) return null;
  const s = cfg.steps.find((st) => Array.isArray(st.beats) && st.beats.includes(beat));
  return s?.detail || null;
}

const REF_KIND = /^(rfc|spec|emerging)$/;
// a real compact JWT: base64url header starting eyJ, then a dot. Mock tokens are shown decoded only.
const JWT_SHAPE = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/;
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

/** Returns an array of error strings for cfg.steps (empty when absent or well-formed). */
export function validateSteps(cfg) {
  if (cfg.steps === undefined) return [];
  if (!Array.isArray(cfg.steps)) return ["steps: must be an array"];
  const errors = [];
  const beatCount = cfg.walk.length;
  const claimed = new Set();
  cfg.steps.forEach((s, i) => {
    const at = `steps ${i}`;
    if (!isObj(s)) { errors.push(`${at}: must be an object`); return; }
    if (!Array.isArray(s.beats) || s.beats.length === 0) errors.push(`${at}: beats must be a non-empty array of walk indexes`);
    else s.beats.forEach((b) => {
      if (!Number.isInteger(b) || b < 0 || b >= beatCount) errors.push(`${at}: beat ${b} out of range`);
      else if (claimed.has(b)) errors.push(`${at}: beat ${b} already has a step`);
      else claimed.add(b);
    });
    const d = s.detail;
    if (!isObj(d)) { errors.push(`${at}: missing detail`); return; }
    if (!d.form && !d.tokens?.length && !d.refs?.length) errors.push(`${at}: detail needs a form, tokens or refs`);
    if (d.form !== undefined && (typeof d.form !== "string" || !d.form.trim())) errors.push(`${at}: form must be a non-empty string`);
    if (d.tokens !== undefined) {
      if (!Array.isArray(d.tokens)) errors.push(`${at}: tokens must be an array`);
      else d.tokens.forEach((t, j) => {
        if (!isObj(t) || typeof t.note !== "string" || !t.note.trim()) errors.push(`${at} token ${j}: missing note`);
        else if (!isObj(t.claims)) errors.push(`${at} token ${j}: claims must be an object`);
        else if (t.header !== undefined && !isObj(t.header)) errors.push(`${at} token ${j}: header must be an object`);
      });
    }
    if (d.refs !== undefined) {
      if (!Array.isArray(d.refs)) errors.push(`${at}: refs must be an array`);
      else d.refs.forEach((r, j) => {
        if (!isObj(r) || !r.id || !r.title || !REF_KIND.test(r.kind || "")) errors.push(`${at} ref ${j}: needs id, title and kind (rfc|spec|emerging)`);
      });
    }
    if (JWT_SHAPE.test(JSON.stringify(d))) errors.push(`${at}: looks like a real JWT — tokens must be decoded MOCK values`);
  });
  return errors;
}
