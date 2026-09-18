const express = require('express');
const fs = require('fs');
const path = require('path');
const { requireSession } = require('../middleware/auth');

const router = express.Router();
const TRANSFER_APPROVAL_RESOURCE = path.join(
  __dirname,
  '..',
  'public',
  'mcp-apps',
  'transfer-approval.html',
);

router.get('/transfer-approval', requireSession, (_req, res) => {
  // The default BFF security headers deny all framing. This resource is
  // intentionally rendered in the same-origin chat iframe, so relax only the
  // framing directives for this credential-free, sandboxed App document.
  const contentSecurityPolicy = res.get('Content-Security-Policy');
  if (contentSecurityPolicy) {
    res.set(
      'Content-Security-Policy',
      contentSecurityPolicy.replace(/frame-ancestors\s+[^;]+/i, "frame-ancestors 'self'"),
    );
  } else {
    res.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'self'; base-uri 'self'; object-src 'none'",
    );
  }
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.type('text/html;profile=mcp-app');
  res.send(fs.readFileSync(TRANSFER_APPROVAL_RESOURCE, 'utf8'));
});

module.exports = router;
