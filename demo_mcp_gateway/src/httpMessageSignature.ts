/**
 * RFC 9421 HTTP Message Signatures — signature-base canonicalization and
 * Ed25519 verification. Pure Node `crypto`, zero external deps (the gateway
 * has no `jose`) — mirrors the style of dpopVerify.ts.
 *
 * Scope: the subset needed to verify the Web Bot Auth profile
 * (draft-meunier-web-bot-auth-architecture) plus the RFC 9421 Appendix B
 * Ed25519 test vectors that validate this implementation:
 *   - Signature-Input / Signature structured-field parsing (RFC 8941 subset:
 *     dictionaries of inner lists / byte sequences, string/integer/token/
 *     boolean parameters)
 *   - Derived components @method, @path, @authority
 *   - Plain (non-parameterized) header field components
 *   - ed25519 signature verification
 *
 * Deliberately NOT supported (fails loudly rather than mis-canonicalizing):
 * component parameters (;req, ;sf, ;bs, ;key, ;tr, ;name), other derived
 * components, and non-Ed25519 algorithms.
 */

import * as crypto from 'crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CoveredComponent {
  /** Component name — lowercase field name or a derived component (leading @). */
  name: string;
  /** Exact serialization used as the base-line prefix, e.g. `"@authority"`. */
  serialized: string;
  /** Component-level parameters (unsupported here — presence is an error at base build). */
  params: Record<string, string | number | boolean>;
}

export interface SignatureParams {
  created?: number;
  expires?: number;
  keyid?: string;
  nonce?: string;
  tag?: string;
  alg?: string;
}

export interface SignatureInputEntry {
  label: string;
  components: CoveredComponent[];
  params: SignatureParams;
  /**
   * The exact member serialization after `label=` (inner list + params).
   * Used VERBATIM as the `"@signature-params"` base line so no re-serialization
   * ambiguity can corrupt the signature base.
   */
  rawParams: string;
}

export interface MessageContext {
  method: string;
  /** Target path (no query). */
  path: string;
  /** host[:port] of the target URI. */
  authority: string;
  /** Header map — Node IncomingMessage-style (lowercased keys ok, any case accepted). */
  headers: Record<string, string | string[] | undefined>;
}

// ---------------------------------------------------------------------------
// RFC 8941 structured-field subset parser
// ---------------------------------------------------------------------------

class Scanner {
  private i = 0;
  constructor(private readonly s: string) {}

  get pos(): number { return this.i; }
  eof(): boolean { return this.i >= this.s.length; }
  peek(): string { return this.s[this.i]; }
  next(): string { return this.s[this.i++]; }

  skipSp(): void {
    while (!this.eof() && (this.peek() === ' ' || this.peek() === '\t')) this.i++;
  }

  expect(ch: string): void {
    if (this.eof() || this.s[this.i] !== ch) {
      throw new Error(`expected '${ch}' at position ${this.i}`);
    }
    this.i++;
  }

  slice(from: number, to: number): string { return this.s.slice(from, to); }

  /** sf key: lcalpha/'*' then lcalpha, digit, '_', '-', '.', '*' */
  parseKey(): string {
    const m = /^[a-z*][a-z0-9_\-.*]*/.exec(this.s.slice(this.i));
    if (!m) throw new Error(`invalid key at position ${this.i}`);
    this.i += m[0].length;
    return m[0];
  }

  /** sf-string: DQUOTE *( unescaped / "\" ( DQUOTE / "\" ) ) DQUOTE */
  parseString(): string {
    this.expect('"');
    let out = '';
    while (!this.eof()) {
      const c = this.next();
      if (c === '"') return out;
      if (c === '\\') {
        const e = this.next();
        if (e !== '"' && e !== '\\') throw new Error('invalid string escape');
        out += e;
      } else {
        out += c;
      }
    }
    throw new Error('unterminated string');
  }

  /** Bare item: string / integer / token / boolean / byte sequence. */
  parseBareItem(): string | number | boolean | Buffer {
    const c = this.peek();
    if (c === '"') return this.parseString();
    if (c === ':') return this.parseByteSequence();
    if (c === '?') {
      this.next();
      const b = this.next();
      if (b === '1') return true;
      if (b === '0') return false;
      throw new Error('invalid boolean');
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      const m = /^-?\d+(\.\d+)?/.exec(this.s.slice(this.i));
      if (!m) throw new Error('invalid number');
      this.i += m[0].length;
      return Number(m[0]);
    }
    // token
    const m = /^[a-zA-Z*][a-zA-Z0-9:/!#$%&'*+\-.^_`|~]*/.exec(this.s.slice(this.i));
    if (!m) throw new Error(`invalid item at position ${this.i}`);
    this.i += m[0].length;
    return m[0];
  }

  parseByteSequence(): Buffer {
    this.expect(':');
    const end = this.s.indexOf(':', this.i);
    if (end < 0) throw new Error('unterminated byte sequence');
    const b64 = this.s.slice(this.i, end);
    if (!/^[A-Za-z0-9+/=]*$/.test(b64)) throw new Error('invalid byte sequence');
    this.i = end + 1;
    return Buffer.from(b64, 'base64');
  }

  /** *( ";" *SP key [ "=" bare-item ] ) */
  parseParameters(): Record<string, string | number | boolean> {
    const params: Record<string, string | number | boolean> = {};
    while (!this.eof() && this.peek() === ';') {
      this.next();
      this.skipSp();
      const key = this.parseKey();
      let value: string | number | boolean = true;
      if (!this.eof() && this.peek() === '=') {
        this.next();
        const v = this.parseBareItem();
        if (Buffer.isBuffer(v)) throw new Error('byte-sequence parameter unsupported');
        value = v;
      }
      params[key] = value;
    }
    return params;
  }
}

/**
 * Parse a Signature-Input header value (sf-dictionary whose members are inner
 * lists of string items). Returns one entry per label.
 */
export function parseSignatureInput(headerValue: string): SignatureInputEntry[] {
  const sc = new Scanner(headerValue.trim());
  const entries: SignatureInputEntry[] = [];
  for (;;) {
    sc.skipSp();
    const label = sc.parseKey();
    sc.expect('=');
    if (sc.peek() !== '(') throw new Error(`Signature-Input member '${label}' is not an inner list`);
    const memberStart = sc.pos;
    // inner list of covered components
    sc.expect('(');
    const components: CoveredComponent[] = [];
    for (;;) {
      sc.skipSp();
      if (sc.eof()) throw new Error('unterminated inner list');
      if (sc.peek() === ')') { sc.next(); break; }
      const itemStart = sc.pos;
      const item = sc.parseBareItem();
      if (typeof item !== 'string') throw new Error('covered component must be a string item');
      const params = sc.parseParameters();
      components.push({
        name: item,
        serialized: sc.slice(itemStart, sc.pos),
        params,
      });
    }
    const params = sc.parseParameters();
    const rawParams = sc.slice(memberStart, sc.pos);
    const sig: SignatureParams = {};
    if (typeof params.created === 'number') sig.created = params.created;
    if (typeof params.expires === 'number') sig.expires = params.expires;
    if (typeof params.keyid === 'string') sig.keyid = params.keyid;
    if (typeof params.nonce === 'string') sig.nonce = params.nonce;
    if (typeof params.tag === 'string') sig.tag = params.tag;
    if (typeof params.alg === 'string') sig.alg = params.alg;
    entries.push({ label, components, params: sig, rawParams });

    sc.skipSp();
    if (sc.eof()) break;
    sc.expect(',');
  }
  return entries;
}

/** Parse a Signature header value (sf-dictionary of byte sequences). */
export function parseSignatureHeader(headerValue: string): Map<string, Buffer> {
  const sc = new Scanner(headerValue.trim());
  const out = new Map<string, Buffer>();
  for (;;) {
    sc.skipSp();
    const label = sc.parseKey();
    sc.expect('=');
    out.set(label, sc.parseByteSequence());
    sc.skipSp();
    if (sc.eof()) break;
    sc.expect(',');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Signature base construction (RFC 9421 §2.5)
// ---------------------------------------------------------------------------

function headerFieldValue(headers: MessageContext['headers'], name: string): string {
  const lower = name.toLowerCase();
  let raw: string | string[] | undefined = headers[lower];
  if (raw === undefined) {
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === lower) { raw = headers[k]; break; }
    }
  }
  if (raw === undefined) throw new Error(`covered header field '${name}' is not present in the message`);
  const values = Array.isArray(raw) ? raw : [raw];
  // RFC 9421 §2.1: strip leading/trailing whitespace, collapse obs-fold,
  // join multiple field lines with ", ".
  return values
    .map((v) => String(v).replace(/[ \t]*\r?\n[ \t]*/g, ' ').trim())
    .join(', ');
}

function derivedComponentValue(name: string, msg: MessageContext): string {
  switch (name) {
    case '@method': return msg.method.toUpperCase();
    case '@path': return msg.path;
    case '@authority': return msg.authority.toLowerCase();
    default:
      throw new Error(`unsupported derived component '${name}'`);
  }
}

/**
 * Build the RFC 9421 signature base for one Signature-Input entry against the
 * message context. Throws on anything this subset cannot canonicalize exactly.
 */
export function buildSignatureBase(entry: SignatureInputEntry, msg: MessageContext): string {
  const lines: string[] = [];
  const seen = new Set<string>();
  for (const c of entry.components) {
    if (Object.keys(c.params).length > 0) {
      throw new Error(`component parameters are not supported ('${c.serialized}')`);
    }
    if (seen.has(c.serialized)) throw new Error(`duplicate covered component '${c.serialized}'`);
    seen.add(c.serialized);
    const value = c.name.startsWith('@')
      ? derivedComponentValue(c.name, msg)
      : headerFieldValue(msg.headers, c.name);
    lines.push(`${c.serialized}: ${value}`);
  }
  lines.push(`"@signature-params": ${entry.rawParams}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Ed25519 verification + RFC 7638 thumbprint
// ---------------------------------------------------------------------------

/** Verify a raw Ed25519 signature over the signature base. Never throws. */
export function verifyEd25519Signature(publicKey: crypto.KeyObject, base: string, signature: Buffer): boolean {
  try {
    return crypto.verify(null, Buffer.from(base, 'utf-8'), publicKey, signature);
  } catch {
    return false;
  }
}

/**
 * RFC 7638 JWK thumbprint (SHA-256, base64url) over the required members in
 * lexicographic order. OKP (Ed25519): crv, kty, x. Used as the Web Bot Auth
 * `keyid` per draft-meunier-web-bot-auth-architecture.
 */
export function jwkThumbprint(jwk: { kty: string; crv?: string; x?: string; y?: string }): string {
  let canonical: string;
  if (jwk.kty === 'OKP') {
    canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x });
  } else if (jwk.kty === 'EC') {
    canonical = JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
  } else {
    throw new Error(`unsupported kty '${jwk.kty}' for thumbprint`);
  }
  return crypto.createHash('sha256').update(canonical).digest('base64url');
}
