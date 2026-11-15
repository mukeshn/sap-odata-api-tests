#!/usr/bin/env node
// Lightweight system-under-test server: static pages + mock REST/OData APIs.
// Zero runtime dependencies so CI only needs Node.
import http from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { send } from './lib.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC = path.join(ROOT, 'public');
const PORT = Number(process.env.SUT_PORT || process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.csv': 'text/csv; charset=utf-8',
  '.ico': 'image/x-icon',
};

const routes = [];
export const router = {
  add(method, pattern, handler) {
    const keys = [];
    const regex = new RegExp(
      '^' + pattern.replace(/\/:([A-Za-z_]+)/g, (_, k) => (keys.push(k), '/([^/]+)')) + '/?$',
    );
    routes.push({ method, regex, keys, handler });
  },
  get(p, h) { this.add('GET', p, h); },
  post(p, h) { this.add('POST', p, h); },
  put(p, h) { this.add('PUT', p, h); },
  patch(p, h) { this.add('PATCH', p, h); },
  delete(p, h) { this.add('DELETE', p, h); },
};

async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  const type = req.headers['content-type'] || '';
  if (type.includes('application/json')) {
    try { return JSON.parse(raw); } catch { return { __invalidJson: true, raw }; }
  }
  if (type.includes('application/x-www-form-urlencoded')) {
    return Object.fromEntries(new URLSearchParams(raw));
  }
  return { raw };
}

async function serveStatic(urlPath, res) {
  let filePath = path.normalize(path.join(PUBLIC, decodeURIComponent(urlPath)));
  if (!filePath.startsWith(PUBLIC)) return false;
  if (existsSync(filePath) && (await stat(filePath)).isDirectory()) filePath = path.join(filePath, 'index.html');
  if (!existsSync(filePath)) return false;
  const data = await readFile(filePath);
  res.writeHead(200, { 'content-type': MIME[path.extname(filePath)] || 'application/octet-stream' });
  res.end(data);
  return true;
}

// Load every route module that ships with this copy of the SUT.
const routeDir = path.join(ROOT, 'routes');
if (existsSync(routeDir)) {
  for (const file of (await readdir(routeDir)).filter((f) => f.endsWith('.mjs')).sort()) {
    const mod = await import(pathToFileURL(path.join(routeDir, file)).href);
    mod.register(router);
  }
}

router.get('/health', (ctx) => send(ctx.res, 200, { status: 'UP' }));

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'OPTIONS') {
    return send(res, 204, '', {
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
      'access-control-allow-headers': '*',
    });
  }
  try {
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = url.pathname.match(r.regex);
      if (!m) continue;
      const params = Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
      const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {};
      return await r.handler({ req, res, params, query: url.searchParams, body, url });
    }
    if (req.method === 'GET' && (await serveStatic(url.pathname, res))) return;
    send(res, 404, { error: 'NOT_FOUND', path: url.pathname });
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'INTERNAL_ERROR', message: err.message });
  }
});

server.listen(PORT, () => console.log(`SUT listening on http://localhost:${PORT}`));
