'use strict';

const nodemailer = require('nodemailer');
const { SMTPServer } = require('smtp-server');

// CIBA email channel: a tiny in-process SMTP sink plus a one-shot mailer.
// The sink accepts any RCPT (it is a demo mailbox, not a relay) and discards
// the message; the browser-side "email inbox" is out of scope. The mailer
// delivers over SMTP to the sink on localhost, so a real SMTP round trip
// happens in-process with no external account or container.

const DEFAULT_PORT = 0; // OS-assigned port
const MESSAGE_TIMEOUT_MS = 30 * 1000;

let server = null;
let listeningPort = 0;

function startSink({ logger = console } = {}) {
  if (server) return listeningPort;
  server = new SMTPServer({
    authOptional: true,
    disabledCommands: ['STARTTLS'],
    onRcptTo(address, session, callback) {
      // Accept everything: the sink is the demo's own mailbox.
      callback();
    },
    onAuth(auth, session, callback) {
      callback(null, { user: auth.username || 'demo' });
    },
    onMailFrom(address, session, callback) { callback(); },
    onData(stream, session, callback) {
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('end', () => callback());
      stream.on('error', () => callback());
    },
    onClose() {},
  });
  server.on('error', (err) => logger.warn?.('[cibaEmailSink] smtp error:', err.message));
  server.listen(DEFAULT_PORT, '127.0.0.1', () => {
    listeningPort = server.server.address().port;
    logger.info?.(`[cibaEmailSink] SMTP sink listening on 127.0.0.1:${listeningPort}`);
  });
  server.maxSize = 256 * 1024;
  server.socketTimeout = MESSAGE_TIMEOUT_MS;
  return () => listeningPort;
}

function sinkPort() {
  return listeningPort;
}

function stopSink() {
  if (!server) return;
  const s = server;
  server = null;
  listeningPort = 0;
  try { s.close(); } catch { /* already closed */ }
}

// Send the approval email. Resolves { messageId, to } or throws.
async function sendApprovalEmail({ to, subject, text, html, logger = console } = {}) {
  startSink({ logger });
  // The listen callback is async — wait (briefly) for the OS-assigned port.
  for (let waited = 0; !listeningPort && waited < 2000; waited += 25) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!listeningPort) throw new Error('SMTP sink is not listening');
  const transporter = nodemailer.createTransport({
    host: '127.0.0.1',
    port: listeningPort,
    secure: false,
    ignoreTLS: true,
    connectionTimeout: MESSAGE_TIMEOUT_MS,
  });
  const info = await transporter.sendMail({
    from: 'CIBA Demo <ciba-demo@local.ping-devops.com>',
    to,
    subject,
    text,
    ...(html ? { html } : {}),
  });
  transporter.close();
  return { messageId: info.messageId, to };
}

module.exports = { startSink, stopSink, sinkPort, sendApprovalEmail };
