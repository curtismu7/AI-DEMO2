/**
 * Log Viewer API Routes
 * Provides endpoints to fetch application logs and Vercel deployment logs
 */

const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { logger } = require('../utils/logger');
const exchangeAuditStore = require('../services/exchangeAuditStore');

/**
 * Get application logs from file system
 * Supports filtering by level, time range, and search
 */
router.get('/app', async (req, res) => {
  try {
    const { level, search, limit = 100, since } = req.query;
    
    // In production, logs might be in different locations
    const logPaths = [
      path.join(__dirname, '../../logs/app.log'),
      path.join(__dirname, '../../logs/error.log'),
      '/var/log/app.log',
      process.env.LOG_FILE_PATH
    ].filter(Boolean);

    let allLogs = [];

    // Try to read from available log files
    for (const logPath of logPaths) {
      try {
        if (fs.existsSync(logPath)) {
          const content = fs.readFileSync(logPath, 'utf8');
          const lines = content.split('\n').filter(line => line.trim());
          allLogs = allLogs.concat(lines);
        }
      } catch (err) {
        // Continue to next log file
      }
    }

    // Parse logs (assuming JSON format)
    let parsedLogs = allLogs
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          // Handle plain text logs
          return {
            timestamp: new Date().toISOString(),
            level: 'info',
            message: line,
            raw: true
          };
        }
      })
      .filter(log => {
        // Filter by level
        if (level && log.level !== level) return false;
        
        // Filter by search term
        if (search && !JSON.stringify(log).toLowerCase().includes(search.toLowerCase())) {
          return false;
        }
        
        // Filter by time
        if (since) {
          const logTime = new Date(log.timestamp).getTime();
          const sinceTime = new Date(since).getTime();
          if (logTime < sinceTime) return false;
        }
        
        return true;
      });

    // Sort by timestamp (newest first)
    parsedLogs.sort((a, b) => {
      const timeA = new Date(a.timestamp).getTime();
      const timeB = new Date(b.timestamp).getTime();
      return timeB - timeA;
    });

    // Limit results
    parsedLogs = parsedLogs.slice(0, parseInt(limit));

    res.json({
      logs: parsedLogs,
      total: parsedLogs.length,
      hasMore: allLogs.length > parseInt(limit)
    });
  } catch (error) {
    console.error('Error fetching app logs:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get Vercel deployment logs
 * Uses Vercel CLI or API to fetch logs
 */
router.get('/vercel', async (req, res) => {
  try {
    const { limit = 100 } = req.query;

    // On Vercel serverless the CLI is not available — serve in-process logs directly.
    let logs = [...recentLogs];

    // Limit results
    logs = logs.slice(0, parseInt(limit));

    res.json({
      logs,
      total: logs.length,
      source: 'vercel'
    });
  } catch (error) {
    console.error('Error fetching Vercel logs:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get token-exchange audit events from Redis.
 * Survives Vercel Lambda isolation — events written by any Lambda are visible here.
 * Returns empty array when Redis (Upstash KV) is not configured.
 */
router.get('/exchange', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit || '200', 10), 500);
    const events = await exchangeAuditStore.readExchangeEvents(limit);

    // Normalise to the same shape as /console so LogViewer can handle both.
    const logs = events.map((ev, idx) => ({
      id: `redis:${ev.timestamp || idx}:${ev.type || 'exchange'}`,
      timestamp: ev.timestamp || new Date().toISOString(),
      level: ev.level || (ev.type === 'exchange-failed' ? 'error' : 'info'),
      message: ev.message || JSON.stringify(ev),
      args: [ev],
      _src: 'exchange',
    }));

    res.json({
      logs,
      total: logs.length,
      source: 'in-process',
    });
  } catch (error) {
    res.status(500).json({ error: error.message, logs: [] });
  }
});

/**
 * Get recent console logs from memory
 * This captures logs from the current Node.js process
 */
const recentLogs = [];
const MAX_LOGS = 1000;
let nextConsoleLogId = 1;

// Intercept console methods
const originalConsoleLog = console.log;
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleInfo = console.info;

console.log = function(...args) {
  captureLog('info', args);
  originalConsoleLog.apply(console, args);
};

console.error = function(...args) {
  captureLog('error', args);
  originalConsoleError.apply(console, args);
};

console.warn = function(...args) {
  captureLog('warn', args);
  originalConsoleWarn.apply(console, args);
};

console.info = function(...args) {
  captureLog('info', args);
  originalConsoleInfo.apply(console, args);
};

function captureLog(level, args) {
  const logEntry = {
    id: nextConsoleLogId++,
    timestamp: new Date().toISOString(),
    level,
    message: args.map(arg => 
      typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' '),
    args: args.map(arg => 
      typeof arg === 'object' ? arg : String(arg)
    )
  };

  recentLogs.push(logEntry);
  
  // Keep only recent logs
  if (recentLogs.length > MAX_LOGS) {
    recentLogs.shift();
  }
}

router.get('/console', async (req, res) => {
  const { level, search, limit = 100, since } = req.query;

  let filteredLogs = [...recentLogs];

  // Merge in-memory exchange audit events
  {
    try {
      const auditEvents = await exchangeAuditStore.readExchangeEvents(200);
      const inProcessMessages = new Set(recentLogs.map((l) => l.message));
      for (const ev of auditEvents) {
        const msg = ev.message || JSON.stringify(ev);
        if (inProcessMessages.has(msg)) continue;
        filteredLogs.push({
          id: `audit:${ev.timestamp || Date.now()}:${ev.type || 'exchange'}`,
          timestamp: ev.timestamp || new Date().toISOString(),
          level: ev.level || (ev.type === 'exchange-failed' ? 'error' : 'info'),
          message: msg,
          args: [ev],
          _src: 'exchange',
        });
      }
    } catch (_) {
      // Non-fatal — serve in-process logs without Redis augmentation
    }
  }

  // Filter by level
  if (level) {
    filteredLogs = filteredLogs.filter(log => log.level === level);
  }

  // Filter by search
  if (search) {
    const searchLower = search.toLowerCase();
    filteredLogs = filteredLogs.filter(log => 
      log.message.toLowerCase().includes(searchLower)
    );
  }

  // Filter by time
  if (since) {
    const sinceTime = new Date(since).getTime();
    filteredLogs = filteredLogs.filter(log => 
      new Date(log.timestamp).getTime() >= sinceTime
    );
  }

  // Sort by timestamp (newest first)
  filteredLogs.sort((a, b) => 
    new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );

  // Limit results
  filteredLogs = filteredLogs.slice(0, parseInt(limit));

  res.json({
    logs: filteredLogs,
    total: filteredLogs.length,
    totalAvailable: recentLogs.length
  });
});

/**
 * Clear console logs from memory
 */
router.delete('/console', (req, res) => {
  const count = recentLogs.length;
  recentLogs.length = 0;
  res.json({ cleared: count });
});

/**
 * Get log statistics
 */
router.get('/stats', (req, res) => {
  const stats = {
    total: recentLogs.length,
    byLevel: {
      error: recentLogs.filter(l => l.level === 'error').length,
      warn: recentLogs.filter(l => l.level === 'warn').length,
      info: recentLogs.filter(l => l.level === 'info').length,
      debug: recentLogs.filter(l => l.level === 'debug').length
    },
    oldest: recentLogs.length > 0 ? recentLogs[0].timestamp : null,
    newest: recentLogs.length > 0 ? recentLogs[recentLogs.length - 1].timestamp : null
  };

  res.json(stats);
});

/**
 * Capture frontend runtime messages (for toast notifications and similar UI events).
 */
router.post('/runtime-message', (req, res) => {
  try {
    const {
      message = 'runtime event',
      level = 'info',
      source = 'ui',
      status = 'added',
      toastId = null,
    } = req.body || {};

    const normalizedLevel = String(level).toLowerCase();
    const category = 'runtime messages';
    const metadata = {
      source,
      status,
      toastId,
      path: req.headers.referer || null,
      ip: req.ip,
    };

    if (normalizedLevel === 'error') {
      logger.error(category, String(message), metadata);
    } else if (normalizedLevel === 'warn' || normalizedLevel === 'warning') {
      logger.warn(category, String(message), metadata);
    } else if (normalizedLevel === 'debug') {
      logger.debug(category, String(message), metadata);
    } else {
      logger.info(category, String(message), metadata);
    }

    return res.json({ ok: true });
  } catch (error) {
    console.error('Error capturing runtime message:', error);
    return res.status(500).json({ ok: false, error: 'Failed to capture runtime message' });
  }
});

module.exports = router;
