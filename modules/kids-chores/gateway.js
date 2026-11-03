/**
 * Same-origin gateway for Kids Chores alone (no Homey).
 * On the Pi, Homey's gateway mounts this module when present.
 *
 *   KIDS_CHORES_GATEWAY_PORT=3000 node modules/kids-chores/gateway.js
 */

import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createKidsChoresHandler } from './sidecar/server.js';

const HOP = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'upgrade', 'transfer-encoding']);

function splitOrigin(value) {
  const url = new URL(value);
  return { hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80) };
}

function forwardHeaders(incoming) {
  const headers = { ...incoming };
  for (const name of Object.keys(headers)) {
    if (HOP.has(name.toLowerCase())) delete headers[name];
  }
  return headers;
}

export function createGateway({
  upstream = process.env.YUVOMI_UPSTREAM || 'http://127.0.0.1:3001',
  yuvomiUrl = process.env.YUVOMI_INTERNAL_URL || upstream,
  dataDir = process.env.KIDS_CHORES_DATA_DIR || path.resolve('data/kids-chores'),
} = {}) {
  const target = splitOrigin(upstream);
  const chores = createKidsChoresHandler({ dataDir, yuvomiUrl });

  function isChores(req) {
    const pathName = (req.url || '/').split('?')[0];
    return pathName === '/api/extensions/kids-chores'
      || pathName.startsWith('/api/extensions/kids-chores/');
  }

  function proxy(req, res) {
    const headers = forwardHeaders(req.headers);
    const preq = http.request({
      hostname: target.hostname,
      port: target.port,
      method: req.method,
      path: req.url,
      headers,
    }, (pres) => {
      res.writeHead(pres.statusCode || 502, forwardHeaders(pres.headers));
      pres.pipe(res);
    });
    preq.on('error', () => {
      if (res.headersSent || res.writableEnded) {
        res.destroy();
        return;
      }
      const body = JSON.stringify({ error: 'Yuvomi is not reachable.', code: 502, reason: 'upstream' });
      res.writeHead(502, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(body),
        'Cache-Control': 'no-store',
      });
      res.end(body);
    });
    req.pipe(preq);
  }

  const server = http.createServer((req, res) => {
    if (isChores(req)) {
      chores(req, res);
      return;
    }
    proxy(req, res);
  });

  return server;
}

function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(path.resolve(entry)).href;
}

if (isMain()) {
  const port = Number(process.env.KIDS_CHORES_GATEWAY_PORT || process.env.PORT || 3000);
  const host = process.env.KIDS_CHORES_BIND || '::';
  const server = createGateway();
  server.listen({ port, host, ipv6Only: false }, () => {
    console.log(`Kids Chores gateway listening on ${host}:${port}`);
  });
}
