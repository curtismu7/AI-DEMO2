'use strict';

// Throwaway signer generated per run (node crypto + the openssl CLI for the self-signed cert); no PEM is committed.
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { SignedXml } = require('xml-crypto');
const { DOMParser } = require('@xmldom/xmldom');
const { samlUnavailableReason, buildAssertion, describeAssertion, signerCertPem } = require('../../services/samlAssertion');

const b64 = (s) => Buffer.from(s).toString('base64');
let keyPem; let certPem; let ENV; let otherKeyPem;

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'saml-test-'));
  try {
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    keyPem = privateKey.export({ type: 'pkcs8', format: 'pem' });
    otherKeyPem = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    const keyFile = path.join(dir, 'k.pem');
    const certFile = path.join(dir, 'c.pem');
    fs.writeFileSync(keyFile, keyPem, { mode: 0o600 });
    execFileSync('openssl', ['req', '-new', '-x509', '-key', keyFile, '-subj', '/CN=saml-test', '-days', '2', '-out', certFile], { stdio: 'ignore' });
    certPem = fs.readFileSync(certFile, 'utf8');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  ENV = { SAML_SIGNING_KEY_PEM_B64: b64(keyPem), SAML_SIGNING_CERT_PEM_B64: b64(certPem) };
});

const NOW = Date.UTC(2026, 9, 19, 12, 0, 0);
const args = (over = {}) => ({ subject: 'demo.user@example.com', audience: 'idJagDemoSamlAud', issuer: 'https://app.test/saml', nowMs: NOW, ...over });
const parse = (xml) => new DOMParser().parseFromString(xml, 'text/xml');
const one = (doc, ns, name) => doc.getElementsByTagNameNS(ns, name)[0];
const SAML = 'urn:oasis:names:tc:SAML:2.0:assertion';
const DS = 'http://www.w3.org/2000/09/xmldsig#';
const verifies = (xml) => {
  const check = new SignedXml({ publicCert: certPem });
  check.loadSignature(one(parse(xml), DS, 'Signature'));
  return check.checkSignature(xml);
};

describe('samlUnavailableReason', () => {
  it('is null with a matching key and certificate', () => {
    expect(samlUnavailableReason(ENV)).toBeNull();
  });
  it('names the missing key variable', () => {
    expect(samlUnavailableReason({ SAML_SIGNING_CERT_PEM_B64: ENV.SAML_SIGNING_CERT_PEM_B64 })).toMatch(/SAML_SIGNING_KEY_PEM_B64/);
  });
  it('names the missing certificate variable', () => {
    expect(samlUnavailableReason({ SAML_SIGNING_KEY_PEM_B64: ENV.SAML_SIGNING_KEY_PEM_B64 })).toMatch(/SAML_SIGNING_CERT_PEM_B64/);
  });
  it('names both when neither is set', () => {
    const r = samlUnavailableReason({});
    expect(r).toMatch(/SAML_SIGNING_KEY_PEM_B64/);
    expect(r).toMatch(/SAML_SIGNING_CERT_PEM_B64/);
  });
  it('rejects a value that is not base64 of a PEM', () => {
    expect(samlUnavailableReason({ ...ENV, SAML_SIGNING_KEY_PEM_B64: '!!!not base64!!!' })).toMatch(/SAML_SIGNING_KEY_PEM_B64/);
    expect(samlUnavailableReason({ ...ENV, SAML_SIGNING_CERT_PEM_B64: b64('hello') })).toMatch(/SAML_SIGNING_CERT_PEM_B64/);
  });
  it('rejects a certificate that does not match the key', () => {
    expect(samlUnavailableReason({ ...ENV, SAML_SIGNING_KEY_PEM_B64: b64(otherKeyPem) })).toMatch(/does not match/);
  });
  it('never echoes key material in its reason', () => {
    const r = samlUnavailableReason({ ...ENV, SAML_SIGNING_KEY_PEM_B64: b64(otherKeyPem) });
    expect(r).not.toContain('PRIVATE KEY');
    expect(r).not.toContain(ENV.SAML_SIGNING_KEY_PEM_B64);
  });
});

describe('signerCertPem', () => {
  it('returns the certificate PEM', () => {
    expect(signerCertPem(ENV)).toContain('BEGIN CERTIFICATE');
    expect(new crypto.X509Certificate(signerCertPem(ENV)).fingerprint).toBeTruthy();
  });
  it('returns null when signing is not configured', () => {
    expect(signerCertPem({})).toBeNull();
  });
});

describe('buildAssertion', () => {
  it('throws a plain error naming the variable when unconfigured', () => {
    expect(() => buildAssertion(args(), {})).toThrow(/SAML_SIGNING_KEY_PEM_B64/);
  });

  it('gives every assertion a unique ID', () => {
    const id = (xml) => parse(xml).documentElement.getAttribute('ID');
    const a = id(buildAssertion(args(), ENV));
    const b = id(buildAssertion(args(), ENV));
    expect(a).toMatch(/^_[0-9a-f]{32,}$/);
    expect(a).not.toBe(b);
  });

  it('sets IssueInstant, Issuer, backdated NotBefore and NotOnOrAfter +300s', () => {
    const doc = parse(buildAssertion(args(), ENV));
    expect(doc.documentElement.getAttribute('IssueInstant')).toBe('2026-10-19T12:00:00Z');
    expect(doc.documentElement.getAttribute('Version')).toBe('2.0');
    expect(one(doc, SAML, 'Issuer').textContent).toBe('https://app.test/saml');
    const cond = one(doc, SAML, 'Conditions');
    expect(cond.getAttribute('NotBefore')).toBe('2026-10-19T11:59:00Z');
    expect(cond.getAttribute('NotOnOrAfter')).toBe('2026-10-19T12:05:00Z');
  });

  it('restricts the audience', () => {
    const doc = parse(buildAssertion(args(), ENV));
    expect(one(one(doc, SAML, 'AudienceRestriction'), SAML, 'Audience').textContent).toBe('idJagDemoSamlAud');
  });

  it('uses an emailAddress NameID with a bearer SubjectConfirmation', () => {
    const doc = parse(buildAssertion(args(), ENV));
    const nameId = one(doc, SAML, 'NameID');
    expect(nameId.getAttribute('Format')).toBe('urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress');
    expect(nameId.textContent).toBe('demo.user@example.com');
    expect(one(doc, SAML, 'SubjectConfirmation').getAttribute('Method')).toBe('urn:oasis:names:tc:SAML:2.0:cm:bearer');
    expect(one(doc, SAML, 'SubjectConfirmationData').getAttribute('NotOnOrAfter')).toBe('2026-10-19T12:05:00Z');
  });

  it('carries an AuthnStatement', () => {
    const doc = parse(buildAssertion(args(), ENV));
    expect(one(doc, SAML, 'AuthnStatement').getAttribute('AuthnInstant')).toBe('2026-10-19T12:00:00Z');
  });

  it('places an enveloped RSA-SHA256 signature right after the Issuer', () => {
    const doc = parse(buildAssertion(args(), ENV));
    let next = one(doc, SAML, 'Issuer').nextSibling;
    while (next && next.nodeType !== 1) next = next.nextSibling;
    expect(next.localName).toBe('Signature');
    expect(next.namespaceURI).toBe(DS);
    expect(one(doc, DS, 'SignatureMethod').getAttribute('Algorithm')).toBe('http://www.w3.org/2001/04/xmldsig-more#rsa-sha256');
    expect(one(doc, DS, 'CanonicalizationMethod').getAttribute('Algorithm')).toBe('http://www.w3.org/2001/10/xml-exc-c14n#');
    expect(one(doc, DS, 'DigestMethod').getAttribute('Algorithm')).toBe('http://www.w3.org/2001/04/xmlenc#sha256');
    expect(one(doc, DS, 'Reference').getAttribute('URI')).toBe(`#${doc.documentElement.getAttribute('ID')}`);
  });

  it('signs so that the signature verifies with the certificate', () => {
    expect(verifies(buildAssertion(args(), ENV))).toBe(true);
  });

  it('does not verify once the content is tampered with', () => {
    const xml = buildAssertion(args(), ENV).replace('demo.user@example.com', 'mallory@example.com');
    expect(verifies(xml)).toBe(false);
  });

  it('escapes XML metacharacters in the subject and keeps the document well-formed and signed', () => {
    const evil = 'a"<b>&\'c@x.com';
    const xml = buildAssertion(args({ subject: evil }), ENV);
    expect(xml).not.toContain('<b>');
    const doc = parse(xml);
    expect(one(doc, SAML, 'NameID').textContent).toBe(evil);
    expect(doc.getElementsByTagNameNS(SAML, 'b')).toHaveLength(0);
    expect(verifies(xml)).toBe(true);
  });

  it('escapes XML metacharacters in the issuer and audience', () => {
    const xml = buildAssertion(args({ issuer: 'https://x/?a=1&b=<2>', audience: 'aud"><evil/>' }), ENV);
    const doc = parse(xml);
    expect(doc.getElementsByTagNameNS(SAML, 'evil')).toHaveLength(0);
    expect(one(doc, SAML, 'Issuer').textContent).toBe('https://x/?a=1&b=<2>');
  });

  it('refuses an empty subject, audience or issuer', () => {
    expect(() => buildAssertion(args({ subject: '' }), ENV)).toThrow(/subject/);
    expect(() => buildAssertion(args({ audience: '' }), ENV)).toThrow(/audience/);
    expect(() => buildAssertion(args({ issuer: '' }), ENV)).toThrow(/issuer/);
  });
});

describe('describeAssertion', () => {
  const xml = () => buildAssertion(args(), ENV);

  it('reports the claims a reader needs', () => {
    const d = describeAssertion(xml());
    expect(d).toEqual(expect.objectContaining({
      issuer: 'https://app.test/saml',
      nameId: 'demo.user@example.com',
      nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
      audience: 'idJagDemoSamlAud',
      issueInstant: '2026-10-19T12:00:00Z',
      notBefore: '2026-10-19T11:59:00Z',
      notOnOrAfter: '2026-10-19T12:05:00Z',
    }));
    expect(d.signature.algorithm).toBe('http://www.w3.org/2001/04/xmldsig-more#rsa-sha256');
    expect(d.signature.canonicalization).toBe('http://www.w3.org/2001/10/xml-exc-c14n#');
  });

  it('gives the SHA-1 thumbprint of the signing certificate', () => {
    const want = crypto.createHash('sha1').update(new crypto.X509Certificate(certPem).raw).digest('hex').toUpperCase().match(/../g).join(':');
    expect(describeAssertion(xml()).signature.certSha1).toBe(want);
  });

  it('masks DigestValue, SignatureValue and X509Certificate; nothing raw survives', () => {
    const raw = xml();
    const d = describeAssertion(raw);
    const digest = /<ds:DigestValue>([^<]+)</.exec(raw)[1];
    const sigValue = /<ds:SignatureValue>([^<]+)</.exec(raw)[1];
    const cert = /<ds:X509Certificate>([^<]+)</.exec(raw)[1];
    for (const secret of [digest, sigValue, cert]) expect(d.xml).not.toContain(secret.slice(0, 40));
    expect(d.xml).toMatch(/<ds:DigestValue>\[…\]<\/ds:DigestValue>/);
    expect(d.xml).toMatch(/<ds:SignatureValue>\[…\]<\/ds:SignatureValue>/);
    expect(d.xml).toMatch(/<ds:X509Certificate>\[…\]<\/ds:X509Certificate>/);
    expect(d.xml).toContain('demo.user@example.com');
    expect(d.xml).toContain('\n');
  });

  it('reports a plain error for a document that is not an assertion', () => {
    expect(() => describeAssertion('<a/>')).toThrow(/assertion/i);
    expect(() => describeAssertion('')).toThrow(/assertion/i);
  });
});
