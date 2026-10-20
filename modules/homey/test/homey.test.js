import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inspectAddress } from '../sidecar/guard.js';
import { createHomeyServer } from '../sidecar/server.js';
import { createStore } from '../sidecar/store.js';
import { createGateway } from '../gateway.js';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const TOKEN = 'super-secret-token-value';

function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

function close(server) {
  return new Promise((resolve) => server.close(() => resolve()));
}

function cookiePair(response) {
  const set = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  return set.map((value) => value.split(';')[0]).join('; ');
}

async function call(base, pathname, { method = 'GET', cookie = '', json, csrf, origin } = {}) {
  const headers = {
    Accept: 'application/json',
    Origin: origin || base,
    ...(cookie ? { Cookie: cookie } : {}),
    ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
    ...(csrf ? { 'X-Homey-CSRF': csrf } : {}),
  };
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body, text, cookie: cookiePair(response) };
}

function startMe(handler) {
  const hits = { count: 0 };
  const server = http.createServer((req, res) => {
    hits.count += 1;
    handler(req, res, hits);
  });
  return { server, hits };
}

function admin(res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    user: { id: 7, role: 'admin', username: 'ada', display_name: 'Ada' },
    permissions: { admin: true, modules: { 'ext:homey': 'write' } },
  }));
}

test('guard allows a LAN address and rejects metadata, loopback and tricks', async () => {
  const lookupImpl = async (host) => {
    if (host === 'homey.local') return [{ address: '192.168.1.20', family: 4 }];
    if (host === 'evil.test') return [{ address: '169.254.169.254', family: 4 }];
    if (host === 'mapped.test') return [{ address: '::ffff:169.254.169.254', family: 6 }];
    const error = new Error('ENOTFOUND');
    error.code = 'ENOTFOUND';
    throw error;
  };
  const lan = await inspectAddress('http://10.1.2.3', { lookupImpl });
  assert.equal(lan.origin, 'http://10.1.2.3');
  assert.equal(lan.connectHost, '10.1.2.3');
  const named = await inspectAddress('http://homey.local:80', { lookupImpl });
  assert.equal(named.connectHost, '192.168.1.20');

  await assert.rejects(inspectAddress('http://169.254.169.254', { lookupImpl }), { detail: 'blocked' });
  await assert.rejects(inspectAddress('http://[::ffff:169.254.169.254]', { lookupImpl }), { detail: 'blocked' });
  await assert.rejects(inspectAddress('http://evil.test', { lookupImpl }), { detail: 'blocked' });
  await assert.rejects(inspectAddress('http://mapped.test', { lookupImpl }), { detail: 'blocked' });
  await assert.rejects(inspectAddress('http://127.0.0.1', { lookupImpl }), { detail: 'loopback' });
  await assert.rejects(inspectAddress('http://localhost', { lookupImpl }), { detail: 'loopback' });
  const loop = await inspectAddress('http://127.0.0.1:9', { lookupImpl, allowLoopback: true });
  assert.equal(loop.connectHost, '127.0.0.1');
  await assert.rejects(inspectAddress('http://user:pass@10.1.2.3', { lookupImpl }), { detail: 'userinfo' });
  await assert.rejects(inspectAddress('file:///etc/passwd', { lookupImpl }), { detail: 'scheme' });
  await assert.rejects(inspectAddress('http://10.1.2.3/api', { lookupImpl }), { detail: 'path' });
  await assert.rejects(inspectAddress('http://2130706433', { lookupImpl }), { detail: 'loopback' });
  await assert.rejects(inspectAddress('http://2852039166', { lookupImpl }), { detail: 'blocked' });
  await assert.rejects(inspectAddress('http://missing.local', { lookupImpl }), { detail: 'resolve' });
});

test('store keeps the API key on disk and out of the public connection', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'homey-store-'));
  try {
    const store = createStore(dir);
    assert.equal(store.connection().tokenSet, false);
    await store.saveConnection({ address: 'http://10.1.2.3', token: TOKEN });
    assert.equal(store.connection().tokenSet, true);
    assert.equal(JSON.stringify(store.connection()).includes(TOKEN), false);
    const mode = statSync(path.join(dir, 'state.json')).mode & 0o777;
    assert.equal(mode, 0o600);
    for (let i = 0; i < store.maxPins; i += 1) {
      await store.addPin({ kind: 'webhook', label: `Knapp ${i}`, event: `ev${i}`, tag: '' });
    }
    await assert.rejects(store.addPin({ kind: 'webhook', label: 'for mange', event: 'overflow', tag: '' }), { reason: 'limit' });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('sidecar pins a device, toggles it, triggers a flow and a webhook', async () => {
  const homeyState = {
    onoff: false,
    requests: [],
  };
  const homeyServer = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    homeyState.requests.push({
      method: req.method,
      path: url.pathname,
      search: url.search,
      authorization: req.headers.authorization || '',
    });
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      const auth = req.headers.authorization || '';
      if (url.pathname.startsWith('/api/') && auth !== `Bearer ${TOKEN}`) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: `rejected ${TOKEN}` }));
        return;
      }
      if (url.pathname === '/api/manager/devices/device/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          lamp: {
            id: 'lamp',
            name: 'Taklampe',
            zoneName: 'Stue',
            capabilities: ['onoff', 'dim', 'button'],
            capabilitiesObj: {
              onoff: { value: homeyState.onoff, setable: true, type: 'boolean', title: 'På' },
              dim: { value: 0.2, setable: true, type: 'number', title: 'Dim' },
              button: { value: false, setable: false, type: 'button', title: 'Skjult' },
              measure: { value: 1, setable: false, type: 'number', title: 'Måler' },
            },
          },
        }));
        return;
      }
      if (req.method === 'PUT' && url.pathname === '/api/manager/devices/device/lamp/capability/onoff') {
        homeyState.onoff = JSON.parse(raw).value;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      if (url.pathname === '/api/manager/flow/flow/') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ night: { id: 'night', name: 'God natt', enabled: true } }));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/manager/flow/flow/night/trigger') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      if (url.pathname === '/api/manager/flow/advancedflow/') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      if (url.pathname === '/webhook') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
        return;
      }
      res.writeHead(404);
      res.end();
    });
  });

  const me = startMe((req, res) => {
    if (!String(req.headers.cookie || '').includes('yuvomi.sid=ok')) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end('{"error":"Unauthorized"}');
      return;
    }
    admin(res);
  });
  const dir = mkdtempSync(path.join(tmpdir(), 'homey-side-'));
  const homeyUrl = await listen(homeyServer);
  const meUrl = await listen(me.server);
  const sidecar = createHomeyServer({
    dataDir: dir,
    yuvomiUrl: meUrl,
    allowLoopback: true,
  });
  const base = await listen(sidecar);

  try {
    const anon = await call(base, '/api/extensions/homey/status');
    assert.equal(anon.status, 401);
    assert.equal(anon.text.includes(TOKEN), false);

    const first = await call(base, '/api/extensions/homey/status', { cookie: 'yuvomi.sid=ok' });
    assert.equal(first.status, 200);
    assert.equal(first.body.configured, false);
    assert.equal(first.body.admin, true);
    const jar = `yuvomi.sid=ok; ${first.cookie}`;
    const warmed = await call(base, '/api/extensions/homey/status', { cookie: jar });
    assert.equal(warmed.status, 200);
    const before = me.hits.count;
    const second = await call(base, '/api/extensions/homey/status', { cookie: jar });
    assert.equal(second.status, 200);
    assert.equal(me.hits.count, before, 'a second call inside the cache window does not ask Yuvomi again');

    const saved = await call(base, '/api/extensions/homey/connection', {
      method: 'PUT',
      cookie: jar,
      csrf: first.body.csrfToken,
      json: { address: homeyUrl, token: TOKEN },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.reachable, true);
    assert.equal(saved.body.tokenSet, true);
    assert.equal(saved.text.includes(TOKEN), false);

    const catalog = await call(base, '/api/extensions/homey/catalog', { cookie: jar });
    assert.equal(catalog.status, 200);
    assert.equal(catalog.body.devices[0].name, 'Taklampe');
    assert.deepEqual(catalog.body.devices[0].capabilities.map((cap) => cap.id), ['onoff', 'dim']);
    assert.equal(catalog.body.flows[0].name, 'God natt');
    assert.equal(catalog.body.warning, null);
    assert.equal(catalog.text.includes(TOKEN), false);

    const pin = await call(base, '/api/extensions/homey/pins', {
      method: 'POST',
      cookie: jar,
      csrf: first.body.csrfToken,
      json: {
        kind: 'capability',
        label: 'Taklampe',
        detail: 'Stue · På',
        deviceId: 'lamp',
        capabilityId: 'onoff',
        mode: 'toggle',
      },
    });
    assert.equal(pin.status, 201, JSON.stringify(pin.body));
    const pressed = await call(base, `/api/extensions/homey/pins/${pin.body.pin.id}/activate`, {
      method: 'POST',
      cookie: jar,
      csrf: first.body.csrfToken,
      json: {},
    });
    assert.equal(pressed.status, 200, JSON.stringify(pressed.body));
    assert.equal(pressed.body.value, true);
    assert.equal(homeyState.onoff, true);
    const put = homeyState.requests.find((item) => item.method === 'PUT');
    assert.equal(put.path, '/api/manager/devices/device/lamp/capability/onoff');
    assert.equal(put.authorization, `Bearer ${TOKEN}`);

    const flow = await call(base, '/api/extensions/homey/pins', {
      method: 'POST',
      cookie: jar,
      csrf: first.body.csrfToken,
      json: { kind: 'flow', label: 'God natt', flowId: 'night', advanced: false },
    });
    const triggered = await call(base, `/api/extensions/homey/pins/${flow.body.pin.id}/activate`, {
      method: 'POST',
      cookie: jar,
      csrf: first.body.csrfToken,
      json: {},
    });
    assert.equal(triggered.status, 200);
    assert.ok(homeyState.requests.some((item) => item.path === '/api/manager/flow/flow/night/trigger' && item.method === 'POST'));

    const hook = await call(base, '/api/extensions/homey/pins', {
      method: 'POST',
      cookie: jar,
      csrf: first.body.csrfToken,
      json: { kind: 'webhook', label: 'Kveld', event: 'night', tag: 'home' },
    });
    const hooked = await call(base, `/api/extensions/homey/pins/${hook.body.pin.id}/activate`, {
      method: 'POST',
      cookie: jar,
      csrf: first.body.csrfToken,
      json: {},
    });
    assert.equal(hooked.status, 200);
    const webhook = homeyState.requests.find((item) => item.path === '/webhook');
    assert.equal(webhook.authorization, '');
    assert.equal(webhook.search, '?event=night&tag=home');

    const pins = await call(base, '/api/extensions/homey/pins', { cookie: jar });
    const lamp = pins.body.pins.find((item) => item.id === pin.body.pin.id);
    assert.equal(lamp.value, true);
    assert.equal(pins.text.includes(TOKEN), false);

    const noCsrf = await call(base, '/api/extensions/homey/pins', {
      method: 'POST',
      cookie: jar,
      json: { kind: 'webhook', label: 'Uten', event: 'nope' },
    });
    assert.equal(noCsrf.status, 403);
    assert.equal(noCsrf.body.reason, 'csrf');

    const noOrigin = await fetch(`${base}/api/extensions/homey/connection/test`, {
      method: 'POST',
      headers: {
        Cookie: jar,
        'Content-Type': 'application/json',
        'X-Homey-CSRF': first.body.csrfToken,
      },
      body: '{}',
    });
    assert.equal(noOrigin.status, 403);
  } finally {
    await close(sidecar);
    await close(homeyServer);
    await close(me.server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('read-only can look, a member cannot save the key, and none is refused', async () => {
  const roles = { current: 'read' };
  const me = startMe((req, res) => {
    if (!String(req.headers.cookie || '').includes('yuvomi.sid=')) {
      res.writeHead(401);
      res.end('{}');
      return;
    }
    const access = roles.current;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      user: { id: 3, role: access === 'member' ? 'member' : 'admin', display_name: 'Noa' },
      permissions: { modules: { 'ext:homey': access === 'member' ? 'write' : access } },
    }));
  });
  const homeyServer = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  const dir = mkdtempSync(path.join(tmpdir(), 'homey-acl-'));
  const meUrl = await listen(me.server);
  const homeyUrl = await listen(homeyServer);
  const sidecar = createHomeyServer({ dataDir: dir, yuvomiUrl: meUrl, allowLoopback: true });
  const base = await listen(sidecar);
  try {
    const read = await call(base, '/api/extensions/homey/status', { cookie: 'yuvomi.sid=ok' });
    assert.equal(read.body.access, 'read');
    const jar = `yuvomi.sid=ok; ${read.cookie}`;
    const denied = await call(base, '/api/extensions/homey/pins', {
      method: 'POST',
      cookie: jar,
      csrf: read.body.csrfToken,
      json: { kind: 'webhook', label: 'Nei', event: 'nope' },
    });
    assert.equal(denied.status, 403);
    assert.equal(denied.body.reason, 'read_only');

    roles.current = 'member';
    const member = await call(base, '/api/extensions/homey/status', { cookie: 'yuvomi.sid=member' });
    const memberJar = `yuvomi.sid=member; ${member.cookie}`;
    const save = await call(base, '/api/extensions/homey/connection', {
      method: 'PUT',
      cookie: memberJar,
      csrf: member.body.csrfToken,
      json: { address: homeyUrl, token: TOKEN },
    });
    assert.equal(save.status, 403);
    assert.equal(save.body.reason, 'admin_required');
    assert.equal(save.text.includes(TOKEN), false);

    roles.current = 'none';
    const none = await call(base, '/api/extensions/homey/pins', { cookie: 'yuvomi.sid=none' });
    assert.equal(none.status, 403);
    assert.equal(none.body.reason, 'forbidden');
  } finally {
    await close(sidecar);
    await close(homeyServer);
    await close(me.server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a bad API key is not stored and is not echoed', async () => {
  const homeyServer = http.createServer((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: TOKEN }));
  });
  const me = startMe((req, res) => admin(res));
  const dir = mkdtempSync(path.join(tmpdir(), 'homey-auth-'));
  const homeyUrl = await listen(homeyServer);
  const meUrl = await listen(me.server);
  const sidecar = createHomeyServer({ dataDir: dir, yuvomiUrl: meUrl, allowLoopback: true });
  const base = await listen(sidecar);
  try {
    const first = await call(base, '/api/extensions/homey/status', { cookie: 'yuvomi.sid=ok' });
    const saved = await call(base, '/api/extensions/homey/connection', {
      method: 'PUT',
      cookie: `yuvomi.sid=ok; ${first.cookie}`,
      csrf: first.body.csrfToken,
      json: { address: homeyUrl, token: TOKEN },
    });
    assert.equal(saved.status, 401);
    assert.equal(saved.body.reason, 'homey_unauthorized');
    assert.equal(saved.text.includes(TOKEN), false);
    const after = await call(base, '/api/extensions/homey/status', { cookie: 'yuvomi.sid=ok' });
    assert.equal(after.body.configured, false);
  } finally {
    await close(sidecar);
    await close(homeyServer);
    await close(me.server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the gateway serves Homey itself and forwards everything else', async () => {
  const upstream = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('from-yuvomi');
  });
  const me = startMe((req, res) => admin(res));
  const dir = mkdtempSync(path.join(tmpdir(), 'homey-gw-'));
  const upstreamUrl = await listen(upstream);
  const meUrl = await listen(me.server);
  const gateway = createGateway({
    upstream: upstreamUrl,
    yuvomiUrl: meUrl,
    dataDir: dir,
    allowLoopback: true,
  });
  const base = await listen(gateway);
  try {
    const forwarded = await fetch(`${base}/health`);
    assert.equal(await forwarded.text(), 'from-yuvomi');
    const status = await call(base, '/api/extensions/homey/status', { cookie: 'yuvomi.sid=ok' });
    assert.equal(status.status, 200);
    assert.equal(status.body.configured, false);
  } finally {
    await close(gateway);
    await close(upstream);
    await close(me.server);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Yuvomi accepts the Homey manifest', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'homey-manifest-'));
  const dbPath = path.join(dir, 'manifest.db');
  const script = `
    const svc = await import(${JSON.stringify(pathToFileURL(path.join(root, 'server/services/modules.js')).href)});
    const mods = await svc.listModules({ admin: true });
    const homey = mods.find((mod) => mod.id === 'homey');
    if (!homey) throw new Error('homey missing from ' + mods.map((mod) => mod.id).join(','));
    if (homey.status !== 'enabled') throw new Error(homey.error || homey.status);
    if (homey.capabilities?.apiPrefix !== '/api/extensions/homey') throw new Error('prefix ' + homey.capabilities?.apiPrefix);
    if (homey.route?.path !== '/m/homey') throw new Error('route ' + homey.route?.path);
    if (!homey.i18n?.availableLocales?.includes('nb')) throw new Error('locales ' + homey.i18n?.availableLocales);
    console.log('manifest-ok');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...process.env,
      DB_PATH: dbPath,
      DB_ENCRYPTION_KEY: '',
      MODULES_DIR: path.join(root, 'modules'),
      SESSION_SECRET: 'manifest-check-secret-manifest-check-secret',
    },
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stdout, /manifest-ok/);
  rmSync(dir, { recursive: true, force: true });
});
