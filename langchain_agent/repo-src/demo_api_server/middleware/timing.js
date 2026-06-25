/**
 * Server timing middleware — adds X-Response-Time header to all responses.
 * Logs requests exceeding 2000ms as SLOW.
 */
module.exports = function timingMiddleware(req, res, next) {
  const start = Date.now();
  const origEnd = res.end;

  res.end = function (...args) {
    const duration = Date.now() - start;
    if (!res.headersSent) {
      res.setHeader('X-Response-Time', `${duration}ms`);
    }
    if (duration > 2000) {
      console.warn(`[timing] SLOW ${req.method} ${req.originalUrl} — ${duration}ms`);
    }
    origEnd.apply(this, args);
  };

  next();
};
