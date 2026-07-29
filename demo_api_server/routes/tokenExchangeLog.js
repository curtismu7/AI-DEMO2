const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const router = express.Router();

const LOG_FILE = path.join(__dirname, '../data/token-exchanges.log');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Resolve the express-session id. Prefer sessionID (always set by
 * express-session); fall back to session.id for stores that mirror it.
 * Never trust a client-supplied sessionId from the request body.
 */
function resolveSessionId(req) {
  return req.sessionID || req.session?.id || null;
}

router.post('/log', (req, res) => {
  try {
    const { timestamp, exchangeType, subjectToken, resultToken, metadata } = req.body;
    const sessionId = resolveSessionId(req);

    // Validate required fields
    if (!timestamp || !exchangeType || !sessionId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Hash tokens
    const subjectTokenHash = subjectToken ? hashToken(subjectToken) : null;
    const resultTokenHash = resultToken ? hashToken(resultToken) : null;

    // Create log entry
    const entry = {
      timestamp,
      exchangeType,
      subjectTokenHash,
      resultTokenHash,
      metadata: metadata || {},
      sessionId,
      loggedAt: new Date().toISOString()
    };

    // Append to log file
    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');

    res.json({ logged: true });
  } catch (error) {
    console.error('Error logging token exchange:', error);
    res.status(500).json({ error: 'Failed to log exchange' });
  }
});

router.get('/', (req, res) => {
  try {
    // Enforce session validation — mandatory
    const currentSessionId = resolveSessionId(req);
    if (!currentSessionId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const limit = parseInt(req.query.limit) || 50;
    const offset = parseInt(req.query.offset) || 0;
    const type = req.query.type;

    // Ensure log file exists
    if (!fs.existsSync(LOG_FILE)) {
      return res.json({ exchanges: [], total: 0, limit, offset });
    }

    // Read all log entries
    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = content.split('\n').filter(line => line.trim());

    let entries = [];
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        // Filter by session — only return entries from the current session
        if (entry.sessionId !== currentSessionId) {
          continue;
        }
        entries.push(entry);
      } catch (parseErr) {
        console.warn('Failed to parse log entry:', parseErr.message);
      }
    }

    // Filter by type if provided
    if (type) {
      entries = entries.filter(entry => entry.exchangeType === type);
    }

    // Calculate total
    const total = entries.length;

    // Apply pagination
    const paginatedEntries = entries.slice(offset, offset + limit);

    res.json({
      exchanges: paginatedEntries,
      total,
      limit,
      offset
    });
  } catch (error) {
    console.error('Error retrieving token exchanges:', error);
    res.status(500).json({ error: 'Failed to retrieve exchanges' });
  }
});

module.exports = router;
