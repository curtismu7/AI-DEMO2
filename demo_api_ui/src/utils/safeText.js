// Control and bidirectional-format characters in displayed data become visible escapes, so a claim value
// cannot reorder or hide what the reader sees. Newline and tab stay as they are.
// Ranges (code points): C0 controls except \t \n, DEL and C1 controls, soft hyphen, zero-width and direction marks
// (U+200B-200F), line / paragraph separators, bidi embeddings and isolates (U+202A-202E, U+2060-2069), BOM.
const RANGES = [[0x00, 0x08], [0x0b, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x200b, 0x200f], [0x2028, 0x2029], [0x202a, 0x202e], [0x2060, 0x2069], [0xfeff, 0xfeff]];
const hex4 = (n) => n.toString(16).padStart(4, '0');
const HIDDEN = new RegExp(`[${RANGES.map(([a, b]) => `\\u${hex4(a)}-\\u${hex4(b)}`).join('')}]`, 'g');

export const visible = (s) => String(s).replace(HIDDEN, (c) => `\\u${hex4(c.charCodeAt(0))}`);
