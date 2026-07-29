const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const router = express.Router();
const LOG_FILE = path.join(__dirname, '../data/token-exchanges.log');

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

router.post('/log', (req, res) => {
  try {
    const { timestamp, exchangeType, subjectToken, resultToken, metadata, sessionId } = req.body;

    if (!timestamp || !exchangeType || !sessionId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const subjectTokenHash = subjectToken ? hashToken(subjectToken) : null;
    const resultTokenHash = resultToken ? hashToken(resultToken) : null;

    const entry = {
      timestamp,
      exchangeType,
      subjectTokenHash,
      resultTokenHash,
      metadata: metadata || {},
      sessionId,
      loggedAt: new Date().toISOString()
    };

    fs.appendFileSync(LOG_FILE, JSON.stringify(entry) + '\n', 'utf8');
    res.json({ logged: true });
  } catch (error) {
    console.error('Error logging token exchange:', error);
    res.status(500).json({ error: 'Failed to log exchange' });
  }
});

module.exports = router;
