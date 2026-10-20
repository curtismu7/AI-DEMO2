'use strict';

/**
 * Signed SAML 2.0 assertion for the ID-JAG playground.
 *
 * Written from the SAML 2.0 core / XMLDSig specs and NOT yet verified against a live PingFederate.
 * The signer key pair arrives as base64 PEMs in env (SAML_SIGNING_KEY_PEM_B64 / SAML_SIGNING_CERT_PEM_B64)
 * and is read at call time; nothing here logs, returns or caches key material.
 */

const crypto = require('crypto');
const { SignedXml } = require('xml-crypto');
const { DOMParser } = require('@xmldom/xmldom');

const KEY_VAR = 'SAML_SIGNING_KEY_PEM_B64';
const CERT_VAR = 'SAML_SIGNING_CERT_PEM_B64';

const NS_SAML = 'urn:oasis:names:tc:SAML:2.0:assertion';
const NS_DS = 'http://www.w3.org/2000/09/xmldsig#';
const NAMEID_EMAIL = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress';
const CM_BEARER = 'urn:oasis:names:tc:SAML:2.0:cm:bearer';
const AC_UNSPECIFIED = 'urn:oasis:names:tc:SAML:2.0:ac:classes:unspecified';
const ALG_RSA_SHA256 = 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256';
const ALG_DIGEST_SHA256 = 'http://www.w3.org/2001/04/xmlenc#sha256';
const ALG_EXC_C14N = 'http://www.w3.org/2001/10/xml-exc-c14n#';
const ALG_ENVELOPED = 'http://www.w3.org/2000/09/xmldsig#enveloped-signature';

const NOT_BEFORE_SKEW_S = 60;
const LIFETIME_S = 300;
const MASK = '[…]';

const xmlEscape = (v) => String(v)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const instant = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, 'Z');

/** Decode one base64 PEM variable. Returns { pem } or { reason } (the reason never contains the value). */
function readPem(env, name, label) {
  const raw = String((env || {})[name] || '').trim();
  if (!raw) return { reason: `${name} is not set.` };
  if (!/^[A-Za-z0-9+/=\s]+$/.test(raw)) return { reason: `${name} is not valid base64.` };
  const pem = Buffer.from(raw, 'base64').toString('utf8').trim();
  if (!new RegExp(`-----BEGIN ${label}-----[\\s\\S]+-----END ${label}-----`).test(pem)) {
    return { reason: `${name} does not decode to a PEM ${label.toLowerCase()}.` };
  }
  return { pem: `${pem}\n` };
}

/** Load and cross-check the signer. Returns { keyPem, certPem } or { reason }. */
function loadSigner(env = process.env) {
  const hasKey = Boolean(String((env || {})[KEY_VAR] || '').trim());
  const hasCert = Boolean(String((env || {})[CERT_VAR] || '').trim());
  if (!hasKey && !hasCert) return { reason: `${KEY_VAR} and ${CERT_VAR} are not set.` };
  const key = readPem(env, KEY_VAR, 'PRIVATE KEY');
  // Also accept a traditional RSA private key header.
  const keyResult = key.reason && /^-----BEGIN RSA PRIVATE KEY-----/.test(Buffer.from(String(env[KEY_VAR] || ''), 'base64').toString('utf8').trim())
    ? readPem(env, KEY_VAR, 'RSA PRIVATE KEY') : key;
  if (keyResult.reason) return { reason: keyResult.reason };
  const cert = readPem(env, CERT_VAR, 'CERTIFICATE');
  if (cert.reason) return { reason: cert.reason };
  let privateKey; let x509;
  try { privateKey = crypto.createPrivateKey(keyResult.pem); } catch { return { reason: `${KEY_VAR} is not a usable private key.` }; }
  try { x509 = new crypto.X509Certificate(cert.pem); } catch { return { reason: `${CERT_VAR} is not a usable certificate.` }; }
  if (privateKey.asymmetricKeyType !== 'rsa') return { reason: `${KEY_VAR} must be an RSA key.` };
  const a = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  const b = x509.publicKey.export({ type: 'spki', format: 'der' });
  if (!a.equals(b)) return { reason: `${CERT_VAR} does not match ${KEY_VAR}.` };
  return { keyPem: keyResult.pem, certPem: cert.pem };
}

/** Plain reason signing is unavailable, or null when the signer is usable. */
function samlUnavailableReason(env = process.env) {
  const s = loadSigner(env);
  if (!s.reason) return null;
  // One variable set without the other: say which one is missing.
  const e = env || {};
  if (e[KEY_VAR] && !e[CERT_VAR]) return `${CERT_VAR} is not set (${KEY_VAR} is).`;
  if (e[CERT_VAR] && !e[KEY_VAR]) return `${KEY_VAR} is not set (${CERT_VAR} is).`;
  return s.reason;
}

/** The signer certificate PEM (public), or null when signing is not configured. */
function signerCertPem(env = process.env) {
  const s = loadSigner(env);
  return s.reason ? null : s.certPem;
}

const requireText = (v, name) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`SAML assertion needs a ${name}.`);
  return v;
};

/** Build and sign an assertion. Throws a plain Error when the signer is not configured. */
function buildAssertion({ subject, audience, issuer, nowMs = Date.now() } = {}, env = process.env) {
  const signer = loadSigner(env);
  if (signer.reason) throw new Error(`SAML signing is not configured: ${samlUnavailableReason(env)}`);
  requireText(subject, 'subject');
  requireText(audience, 'audience');
  requireText(issuer, 'issuer');

  const id = `_${crypto.randomBytes(16).toString('hex')}`;
  const issued = instant(nowMs);
  const notBefore = instant(nowMs - NOT_BEFORE_SKEW_S * 1000);
  const notOnOrAfter = instant(nowMs + LIFETIME_S * 1000);
  const unsigned = [
    `<saml:Assertion xmlns:saml="${NS_SAML}" ID="${id}" Version="2.0" IssueInstant="${issued}">`,
    `<saml:Issuer>${xmlEscape(issuer)}</saml:Issuer>`,
    '<saml:Subject>',
    `<saml:NameID Format="${NAMEID_EMAIL}">${xmlEscape(subject)}</saml:NameID>`,
    `<saml:SubjectConfirmation Method="${CM_BEARER}"><saml:SubjectConfirmationData NotOnOrAfter="${notOnOrAfter}"/></saml:SubjectConfirmation>`,
    '</saml:Subject>',
    `<saml:Conditions NotBefore="${notBefore}" NotOnOrAfter="${notOnOrAfter}">`,
    `<saml:AudienceRestriction><saml:Audience>${xmlEscape(audience)}</saml:Audience></saml:AudienceRestriction>`,
    '</saml:Conditions>',
    `<saml:AuthnStatement AuthnInstant="${issued}" SessionIndex="${id}"><saml:AuthnContext><saml:AuthnContextClassRef>${AC_UNSPECIFIED}</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>`,
    '</saml:Assertion>',
  ].join('');

  const sig = new SignedXml({
    privateKey: signer.keyPem,
    publicCert: signer.certPem,
    signatureAlgorithm: ALG_RSA_SHA256,
    canonicalizationAlgorithm: ALG_EXC_C14N,
    idAttribute: 'ID',
  });
  sig.addReference({
    xpath: "/*[local-name(.)='Assertion']",
    transforms: [ALG_ENVELOPED, ALG_EXC_C14N],
    digestAlgorithm: ALG_DIGEST_SHA256,
    uri: `#${id}`,
    isEmptyUri: false,
  });
  sig.computeSignature(unsigned, {
    prefix: 'ds',
    location: { reference: "/*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' },
  });
  return sig.getSignedXml();
}

const firstText = (doc, ns, name) => doc.getElementsByTagNameNS(ns, name)[0]?.textContent || null;

/** Indent XML for display. Elements holding only text stay on one line. */
function prettyXml(xml) {
  const parts = xml.replace(/>\s+</g, '><').split(/(<[^>]+>)/).filter(Boolean);
  const lines = [];
  let depth = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const p = parts[i];
    const pad = '  '.repeat(depth);
    if (!p.startsWith('<')) { lines[lines.length - 1] += p; continue; }
    if (p.startsWith('</')) {
      depth = Math.max(0, depth - 1);
      // closing tag of a text-only element joins the open line
      if (parts[i - 1] && !parts[i - 1].startsWith('<')) lines[lines.length - 1] += p;
      else lines.push('  '.repeat(depth) + p);
    } else if (p.endsWith('/>') || p.startsWith('<?')) {
      lines.push(pad + p);
    } else {
      lines.push(pad + p);
      depth += 1;
    }
  }
  return lines.join('\n');
}

/** Browser view of an assertion: claims plus pretty XML with digest, signature and certificate masked. */
function describeAssertion(xml) {
  let doc;
  try { doc = new DOMParser({ onError: () => {} }).parseFromString(String(xml || ''), 'text/xml'); } catch { doc = null; }
  const root = doc?.documentElement;
  if (!root || root.localName !== 'Assertion' || root.namespaceURI !== NS_SAML) throw new Error('Not a SAML assertion.');
  const cond = doc.getElementsByTagNameNS(NS_SAML, 'Conditions')[0];
  const nameId = doc.getElementsByTagNameNS(NS_SAML, 'NameID')[0];
  const alg = (name) => doc.getElementsByTagNameNS(NS_DS, name)[0]?.getAttribute('Algorithm') || null;
  const certB64 = (firstText(doc, NS_DS, 'X509Certificate') || '').replace(/\s+/g, '');
  const certSha1 = certB64
    ? crypto.createHash('sha1').update(Buffer.from(certB64, 'base64')).digest('hex').toUpperCase().match(/../g).join(':')
    : null;
  const masked = String(xml).replace(
    /(<(?:[\w-]+:)?(?:DigestValue|SignatureValue|X509Certificate)(?:\s[^>]*)?>)[^<]*(<\/)/g,
    `$1${MASK}$2`,
  );
  return {
    issuer: firstText(doc, NS_SAML, 'Issuer'),
    nameId: nameId?.textContent || null,
    nameIdFormat: nameId?.getAttribute('Format') || null,
    audience: firstText(doc, NS_SAML, 'Audience'),
    issueInstant: root.getAttribute('IssueInstant') || null,
    notBefore: cond?.getAttribute('NotBefore') || null,
    notOnOrAfter: cond?.getAttribute('NotOnOrAfter') || null,
    signature: { algorithm: alg('SignatureMethod'), canonicalization: alg('CanonicalizationMethod'), certSha1 },
    xml: prettyXml(masked),
  };
}

module.exports = { samlUnavailableReason, buildAssertion, describeAssertion, signerCertPem };
