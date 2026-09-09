// Deterministic "fun face" avatar: same seed (user id/email) always picks
// the same look, different users land on visibly different faces, no
// external avatar service or dependency involved.

const FACES = [
  { bg: '#f97316', mouth: 'smile' },
  { bg: '#22c55e', mouth: 'open' },
  { bg: '#3b82f6', mouth: 'zigzag' },
  { bg: '#a855f7', mouth: 'smirk' },
  { bg: '#ef4444', mouth: 'flat' },
  { bg: '#14b8a6', mouth: 'smile' },
  { bg: '#eab308', mouth: 'open' },
  { bg: '#ec4899', mouth: 'zigzag' },
];

export function pickFunAvatar(seed) {
  const s = String(seed || 'user');
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return FACES[Math.abs(hash) % FACES.length];
}
