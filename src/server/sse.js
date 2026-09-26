// Minimal Server-Sent Events hub keyed by document id.
export class SseHub {
  constructor() {
    this.clients = new Map(); // docId -> Set<res>
    this.timer = setInterval(() => this.heartbeat(), 25000);
    this.timer.unref?.();
  }

  subscribe(docId, req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    if (!this.clients.has(docId)) this.clients.set(docId, new Set());
    const set = this.clients.get(docId);
    set.add(res);
    req.on('close', () => {
      set.delete(res);
      if (!set.size) this.clients.delete(docId);
    });
  }

  broadcast(docId, event, data) {
    const set = this.clients.get(docId);
    if (!set) return 0;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const res of set) res.write(payload);
    return set.size;
  }

  clientCount(docId) {
    return this.clients.get(docId)?.size ?? 0;
  }

  heartbeat() {
    for (const set of this.clients.values()) for (const res of set) res.write(': ping\n\n');
  }

  close() {
    clearInterval(this.timer);
    for (const set of this.clients.values()) for (const res of set) res.end();
    this.clients.clear();
  }
}
