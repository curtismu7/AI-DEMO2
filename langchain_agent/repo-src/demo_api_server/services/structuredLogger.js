// demo_api_server/services/structuredLogger.js
const fs = require('fs');
const path = require('path');

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

  log(event) {
    const entry = {
      timestamp: new Date().toISOString(),
      requestId: event.requestId || 'unknown',
      event_type: event.event_type,
      ...Object.entries(event)
        .filter(([k]) => k !== 'requestId' && k !== 'event_type')
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
