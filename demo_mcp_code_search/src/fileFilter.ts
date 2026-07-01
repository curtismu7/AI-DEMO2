/**
 * Translate a file glob (the optional `file_filter` on a search request) into a
 * matcher. Supports `*` (within a path segment), `**` (across segments),
 * `**\/` (zero or more leading segments), and `?` (single non-separator char).
 * All other characters — including regex metacharacters — are matched literally.
 */

function escapeLiteral(ch: string): string {
  return ch.replace(/[.+^${}()|[\]\\/]/g, '\\$&');
}

export function globToMatcher(glob: string): (path: string) => boolean {
  let body = '';
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (ch === '*') {
      if (glob[i + 1] === '*') {
        i++; // consume second '*'
        if (glob[i + 1] === '/') {
          i++; // consume '/': `**/` matches zero or more leading segments
          body += '(?:.*/)?';
        } else {
          body += '.*';
        }
      } else {
        body += '[^/]*';
      }
    } else if (ch === '?') {
      body += '[^/]';
    } else {
      body += escapeLiteral(ch);
    }
  }

  const re = new RegExp(`^${body}$`);
  return (path: string) => re.test(path);
}
