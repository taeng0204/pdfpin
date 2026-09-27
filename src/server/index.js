// pdfpin daemon: HTTP API + SSE + static viewer. Loopback only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { Store } from './store.js';
import { SseHub } from './sse.js';
import { DocManager, ApiError } from './docs.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.join(__dirname, '..', 'web');
const SHARED_ROOT = path.join(__dirname, '..', 'shared');
const require = createRequire(import.meta.url);
const PDFJS_ROOT = path.join(path.dirname(require.resolve('pdfjs-dist/package.json')), 'build');
export const VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')).version;
export const DEFAULT_PORT = 47831;

export function defaultHome() {
  return process.env.PDFPIN_HOME || path.join(os.homedir(), '.pdfpin');
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json',
  '.map': 'application/json', '.woff2': 'font/woff2', '.pdf': 'application/pdf', '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  const isJson = typeof body !== 'string' && !Buffer.isBuffer(body);
  const data = isJson ? JSON.stringify(body) : body;
  res.writeHead(status, { 'content-type': isJson ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(data);
}

function serveFile(res, root, rel, extraHeaders = {}) {
  const abs = path.resolve(root, rel);
  if (!abs.startsWith(path.resolve(root) + path.sep) && abs !== path.resolve(root)) return send(res, 404, { error: 'Not found' });
  let st;
  try { st = fs.statSync(abs); } catch { return send(res, 404, { error: 'Not found' }); }
  if (!st.isFile()) return send(res, 404, { error: 'Not found' });
  const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'content-length': st.size, 'cache-control': 'no-cache', ...extraHeaders });
  fs.createReadStream(abs).pipe(res);
}

function readBody(req, limit = 5 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new ApiError(413, 'Request body too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve(null);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new ApiError(400, 'Body must be valid JSON')); }
    });
    req.on('error', reject);
  });
}

export async function createServer({ home = defaultHome(), port = DEFAULT_PORT, host = '127.0.0.1', onShutdown = null } = {}) {
  fs.mkdirSync(home, { recursive: true });
  const store = new Store(home);
  const hub = new SseHub();
  const docs = new DocManager(store, hub);

  const routes = [];
  const route = (method, pattern, handler) => routes.push({ method, re: new RegExp(`^${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}/?$`), handler });

  route('GET', '/api/health', () => ({ ok: true, version: VERSION, pid: process.pid, home }));
  route('GET', '/api/docs', () => ({ docs: store.list() }));
  route('POST', '/api/docs', async ({ body }) => {
    if (!body?.path) throw new ApiError(400, '"path" is required');
    const doc = await docs.open(String(body.path));
    return { doc: withUrls(doc) };
  });
  route('GET', '/api/docs/current', () => ({ doc: withUrls(docs.resolve(null)) }));
  route('GET', '/api/docs/:id', ({ params }) => ({ doc: withUrls(docs.resolve(params.id)) }));
  route('POST', '/api/docs/:id/activate', ({ params }) => ({ doc: withUrls(docs.activate(docs.resolve(params.id))) }));
  route('POST', '/api/docs/:id/reveal', ({ params }) => docs.reveal(docs.resolve(params.id)));
  route('DELETE', '/api/docs/:id', async ({ params }) => { const d = docs.resolve(params.id); await docs.removeDocument(d); return { ok: true, removed: d.id }; });
  route('GET', '/api/docs/:id/file', ({ params, res }) => {
    const doc = docs.resolve(params.id);
    serveFile(res, path.dirname(doc.path), path.basename(doc.path), { 'content-type': 'application/pdf' });
    return null;
  });
  route('GET', '/api/docs/:id/text', async ({ params, query }) => ({ pages: await docs.text(docs.resolve(params.id), query.get('pages')) }));
  route('GET', '/api/docs/:id/find', async ({ params, query }) => {
    const page = query.get('page') ? Number(query.get('page')) : null;
    const limit = query.get('limit') ? Number(query.get('limit')) : 50;
    return { hits: await docs.find(docs.resolve(params.id), query.get('q') || '', { page, limit, fuzzy: query.get('fuzzy') !== '0' }) };
  });
  route('POST', '/api/docs/:id/annotations', async ({ params, body, res }) => {
    const doc = docs.resolve(params.id);
    if (Array.isArray(body)) {
      const results = [];
      for (const spec of body) {
        try {
          const r = await docs.add(doc, spec);
          results.push({ ok: true, ...r });
        } catch (e) {
          if (!(e instanceof ApiError)) throw e;
          results.push({ ok: false, error: e.message, ...e.extra, spec: { text: spec?.text, page: spec?.page } });
        }
      }
      return { results, added: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length };
    }
    res.statusCode = 201;
    return docs.add(doc, body);
  });
  route('PATCH', '/api/docs/:id/annotations/:aid', ({ params, body }) => ({ annotation: docs.update(docs.resolve(params.id), params.aid, body || {}) }));
  route('DELETE', '/api/docs/:id/annotations/:aid', ({ params }) => { docs.remove(docs.resolve(params.id), params.aid); return { ok: true, removed: params.aid }; });
  route('DELETE', '/api/docs/:id/annotations', ({ params, query }) => ({ ok: true, removed: docs.clear(docs.resolve(params.id), { tag: query.get('tag') || undefined }) }));
  route('POST', '/api/docs/:id/sessions', async ({ params, body, res }) => { res.statusCode = 201; return docs.addSession(docs.resolve(params.id), body || {}); });
  route('PATCH', '/api/docs/:id/sessions/:sid', ({ params, body }) => ({ session: docs.updateSession(docs.resolve(params.id), params.sid, body || {}) }));
  route('DELETE', '/api/docs/:id/sessions/:sid', ({ params }) => { const d = docs.resolve(params.id); return { ok: true, removed: params.sid, removedAnnotations: docs.removeSession(d, params.sid) }; });
  route('POST', '/api/docs/:id/sessions/:sid/use', ({ params }) => ({ currentSessionId: docs.useSession(docs.resolve(params.id), params.sid === 'none' ? null : params.sid) }));
  route('POST', '/api/docs/:id/focus', ({ params, body }) => docs.focus(docs.resolve(params.id), body || {}));
  route('POST', '/api/docs/:id/export', async ({ params, body }) => {
    const { exportDocument } = await import('./export.js');
    return exportDocument(docs, docs.resolve(params.id), body || {});
  });
  route('GET', '/api/docs/:id/events', ({ params, req, res }) => { hub.subscribe(docs.resolve(params.id).id, req, res); return null; });
  route('POST', '/api/shutdown', () => { setTimeout(() => { handle.close().then(() => onShutdown?.()); }, 50); return { ok: true }; });

  function withUrls(doc) {
    return { ...doc, viewerUrl: `/view/${doc.id}`, fileUrl: `/api/docs/${doc.id}/file`, viewers: hub.clientCount(doc.id) };
  }

  const server = http.createServer(async (req, res) => {
    let p = '';
    try {
      // Loopback only, and only when the browser believes it is talking to loopback: a DNS-rebinding
      // page would arrive with its own Host header and must not read documents or drive the viewer.
      const hostName = String(req.headers.host || '').replace(/:\d+$/, '').replace(/^\[(.*)\]$/, '$1');
      if (!['127.0.0.1', 'localhost', '::1'].includes(hostName)) throw new ApiError(403, 'Forbidden host');
      const url = new URL(req.url, 'http://localhost');
      p = decodeURIComponent(url.pathname);
      if (p.startsWith('/api/')) {
        for (const r of routes) {
          if (r.method !== req.method) continue;
          const m = p.match(r.re);
          if (!m) continue;
          let body = null;
          if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
            // Only JSON declared as JSON: a cross-origin HTML form cannot send this content type
            // without a CORS preflight, which closes the CSRF hole on the loopback API.
            const ct = String(req.headers['content-type'] || '');
            const len = Number(req.headers['content-length'] || 0);
            if ((len > 0 || req.headers['transfer-encoding']) && !/^application\/json\b/i.test(ct)) throw new ApiError(415, 'Send JSON with content-type: application/json');
            body = await readBody(req);
          }
          const out = await r.handler({ params: m.groups || {}, query: url.searchParams, body, req, res });
          if (out !== null && !res.writableEnded && !res.headersSent) send(res, res.statusCode === 200 ? 200 : res.statusCode, out);
          return;
        }
        return send(res, 404, { error: `No route: ${req.method} ${p}` });
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
      if (p === '/' || p.startsWith('/view/')) return serveFile(res, WEB_ROOT, 'index.html');
      if (p.startsWith('/assets/')) return serveFile(res, WEB_ROOT, p.slice('/assets/'.length));
      if (p.startsWith('/shared/')) return serveFile(res, SHARED_ROOT, p.slice('/shared/'.length));
      if (p.startsWith('/vendor/pdfjs/')) return serveFile(res, PDFJS_ROOT, p.slice('/vendor/pdfjs/'.length));
      return send(res, 404, { error: 'Not found' });
    } catch (e) {
      if (res.writableEnded) return;
      if (e instanceof ApiError) return send(res, e.status, { error: e.message, ...e.extra });
      if (e instanceof URIError) return send(res, 400, { error: 'Malformed URL' });
      console.error(`[pdfpin] ${req.method} ${p} failed:`, e);
      return send(res, 500, { error: e.message || 'Internal error' });
    }
  });
  server.keepAliveTimeout = 65000;

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const actualPort = server.address().port;
  const handle = {
    server, port: actualPort, host, home, store, docs, hub,
    url: `http://${host}:${actualPort}`,
    close: async () => {
      hub.close();
      await docs.close();
      await new Promise((r) => server.close(() => r()));
    },
  };
  return handle;
}

// ---- daemon entry point -------------------------------------------------------------------
export function serverInfoPath(home = defaultHome()) {
  return path.join(home, 'server.json');
}

async function main() {
  const args = process.argv.slice(2);
  const get = (flag) => { const i = args.indexOf(flag); return i >= 0 ? args[i + 1] : undefined; };
  const home = get('--home') || defaultHome();
  fs.mkdirSync(home, { recursive: true });
  const logFile = path.join(home, 'server.log');
  const log = fs.createWriteStream(logFile, { flags: 'a' });
  const stamp = () => new Date().toISOString();
  console.log = (...a) => log.write(`${stamp()} ${a.join(' ')}\n`);
  console.error = (...a) => log.write(`${stamp()} ERROR ${a.map((x) => (x instanceof Error ? x.stack : String(x))).join(' ')}\n`);

  let port = Number(get('--port') || DEFAULT_PORT);
  let handle;
  const shutdown = () => {
    try {
      const info = JSON.parse(fs.readFileSync(serverInfoPath(home), 'utf8'));
      if (info.pid === process.pid) fs.unlinkSync(serverInfoPath(home));
    } catch { /* ignore */ }
    process.exit(0);
  };
  try {
    handle = await createServer({ home, port, onShutdown: shutdown });
  } catch (e) {
    if (e.code !== 'EADDRINUSE') { console.error('failed to start', e); process.exit(1); }
    // Another pdfpin daemon may have won the race for the port: defer to it instead of forking a second one.
    const other = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.json()).catch(() => null);
    if (other?.ok && other.home === home) { console.log(`another pdfpin daemon already serves port ${port}; exiting`); process.exit(0); }
    handle = await createServer({ home, port: 0, onShutdown: shutdown });
  }
  fs.writeFileSync(serverInfoPath(home), JSON.stringify({ port: handle.port, pid: process.pid, startedAt: stamp(), version: VERSION, url: handle.url }, null, 2));
  console.log(`pdfpin ${VERSION} listening on ${handle.url} (home ${home})`);
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('uncaughtException', (e) => console.error('uncaught', e));
  process.on('unhandledRejection', (e) => console.error('unhandled', e));
}

const isMain = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase();
if (isMain) main();
