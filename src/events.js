import { ApiError } from './domain.js';
export function createEvents({ heartbeatMs = 15000, maxClients = 50 } = {}) {
  const clients = new Set();
  function send(res, text) {
    if (res.destroyed || !res.write(text)) { clients.delete(res); res.end(); }
  }
  const timer = setInterval(() => { for (const res of clients) send(res, ': heartbeat\n\n'); }, heartbeatMs);
  timer.unref();
  return {
    connect(req, res) {
      if (clients.size >= maxClients) throw new ApiError(503, 'STREAM_LIMIT', 'Límite de conexiones alcanzado.');
      res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      res.flushHeaders(); clients.add(res);
      send(res, 'retry: 3000\nevent: ready\ndata: {"connected":true}\n\n');
      res.on('close', () => clients.delete(res));
    },
    publish(action, task) {
      const data = JSON.stringify({ action, task, emittedAt: new Date().toISOString() });
      for (const res of clients) send(res, `event: task.changed\ndata: ${data}\n\n`);
    },
    get size() { return clients.size; },
    close() { clearInterval(timer); for (const res of clients) res.end(); clients.clear(); }
  };
}
