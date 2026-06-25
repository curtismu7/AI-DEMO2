function createEvents({ getInitialActiveId } = {}) {
  const clients = new Set();

  // Write to one client; a thrown write means the socket is gone (the 'close'
  // event may not have fired yet), so drop it from the Set immediately rather
  // than emitting to it on every future event. Returns false if removed.
  function _send(res, type, payload) {
    try {
      res.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
      return true;
    } catch (_) {
      clients.delete(res);
      return false;
    }
  }

  function emit(type, payload) {
    for (const res of clients) _send(res, type, payload);
  }

  function onClient(req, res) {
    if (typeof res.setHeader === 'function') {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
    }
    if (typeof res.writeHead === 'function') res.writeHead(200);
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    clients.add(res);

    // Hydration: send current active id immediately so client can skip a /me round-trip.
    // Session-scoped: prefer this session's preference over the process-global so a
    // reconnect doesn't briefly theme to another session's vertical.
    const sessVal = req && req.session && req.session.active_vertical;
    const initial = sessVal || (getInitialActiveId ? getInitialActiveId() : null);
    if (initial) _send(res, 'vertical-switched', { activeId: initial });

    // Heartbeat every 25s to keep proxies open. A failed write drops the client
    // and stops the interval, so a socket whose 'close' never fires can't linger.
    const hb = setInterval(() => {
      try {
        res.write(': hb\n\n');
      } catch (_) {
        clients.delete(res);
        clearInterval(hb);
      }
    }, 25_000);
    if (typeof hb.unref === 'function') hb.unref();

    const cleanup = () => { clearInterval(hb); clients.delete(res); };
    if (typeof res.on === 'function') {
      res.on('close', cleanup);
      res.on('error', cleanup);
    }
  }

  function _clientCount() { return clients.size; }

  return { emit, onClient, _clientCount };
}

module.exports = { createEvents };
