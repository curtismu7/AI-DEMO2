// Deterministic "fun face" avatar: same seed (user id/email) always picks
// the same look, different users land on visibly different faces, no
// external avatar service or dependency involved.

// Ping palette only (red, dark red, Core Dark, Ping blue); no purple.
const FACES = [
  { bg: '#d20e0f', mouth: 'smile' },
  { bg: '#051727', mouth: 'open' },
  { bg: '#12538d', mouth: 'zigzag' },
  { bg: '#aa0005', mouth: 'smirk' },
  { bg: '#051727', mouth: 'flat' },
  { bg: '#12538d', mouth: 'smile' },
  { bg: '#d20e0f', mouth: 'open' },
  { bg: '#aa0005', mouth: 'zigzag' },
];

export function pickFunAvatar(seed) {
  const s = String(seed || 'user');
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = (hash * 31 + s.charCodeAt(i)) | 0;
  }
  return FACES[Math.abs(hash) % FACES.length];
}
