// demo_api_server/services/structuredLogger.js
const fs = require('fs');
const path = require('path');
const { redactObject, redactMessage } = require('../utils/logRedact');

class StructuredLogger {
  constructor(filePath = '/tmp/demo-api-structured.jsonl') {
    this.filePath = filePath;
    // Ensure directory exists
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.writeStream = fs.createWriteStream(filePath, { flags: 'a' });
  }

  /**
   * Append one structured log line (secrets redacted).
   * Preferred fields: event_type, level, category, message, correlationId, requestId, sessionId.
   */
  log(event) {
    const safe = redactObject(event || {});
    if (typeof safe.message === 'string') {
      safe.message = redactMessage(safe.message);
    }
    const entry = {
      timestamp: new Date().toISOString(),
      requestId: safe.requestId || 'unknown',
      correlationId: safe.correlationId || safe.flowId || null,
      event_type: safe.event_type,
      ...Object.entries(safe)
        .filter(([k]) => !['requestId', 'event_type'].includes(k))
        .reduce((acc, [k, v]) => ({ ...acc, [k]: v }), {}),
    };

    this.writeStream.write(JSON.stringify(entry) + '\n');
  }

  close() {
    return new Promise((resolve, reject) => {
      this.writeStream.end(() => resolve());
      this.writeStream.on('error', reject);
    });
  }
}

// Export both the class and a singleton instance for convenience
const singleton = new StructuredLogger();
module.exports = singleton;
module.exports.StructuredLogger = StructuredLogger;
