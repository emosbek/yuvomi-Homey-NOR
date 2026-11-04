import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { createKidsChoresServer, interpretWebhookApproval } from '../sidecar/server.js';
import { createStore, localDateKey, localIsoWeekday } from '../sidecar/store.js';

/** Mirrors modules/kids-chores/browser.js maxDailyPoints for Node tests. */
function maxDailyPoints(chores = []) {
  let max = 0;
  for (let day = 1; day <= 7; day += 1) {
    let sum = 0;
    for (const chore of chores) {
      if (chore?.active === false) continue;
      if (!Array.isArray(chore?.days) || !chore.days.includes(day)) continue;
      sum += Math.max(0, Number(chore.points) || 0);
    }
    if (sum > max) max = sum;
  }
  return max;
}

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
    ...(csrf ? { 'X-Kids-Chores-CSRF': csrf } : {}),
  };
  const response = await fetch(`${base}${pathname}`, {
    method,
    headers,
    body: json !== undefined ? JSON.stringify(json) : undefined,
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body, cookie: cookiePair(response) };
}

function startMe(handler) {
  const server = http.createServer((req, res) => handler(req, res));
  return server;
}

function admin(res) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    user: { id: 7, role: 'admin', username: 'ada', display_name: 'Ada' },
    permissions: { admin: true, modules: { 'ext:kids-chores': 'write' } },
  }));
}

test('local date helpers use the household timezone', () => {
  const noonUtc = new Date('2026-11-03T12:00:00Z');
  assert.equal(localDateKey('Europe/Oslo', noonUtc), '2026-11-03');
  assert.equal(localIsoWeekday('Europe/Oslo', noonUtc), 2);
});

test('store completes a weekday chore and resets after the day key changes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kc-'));
  try {
    const store = createStore(dir);
    await store.addChore({ title: 'Wash hands', points: 2, days: [1, 2, 3, 4, 5] });
    const chore = store.listChores()[0];
    const monday = new Date('2026-11-02T10:00:00Z'); // Mon in Oslo
    await store.completeChore(chore.id, 7, monday);
    const mondayKey = localDateKey('Europe/Oslo', monday);
    assert.ok(store.snapshot().completions[mondayKey][chore.id]);

    const tuesday = new Date('2026-11-03T10:00:00Z');
    const tueKey = localDateKey('Europe/Oslo', tuesday);
    assert.equal(store.snapshot().completions[tueKey], undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('API: admin creates chore, member completes it, goal fires webhook once', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kc-'));
  const hooks = [];
  const webhook = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      hooks.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(200);
      res.end('ok');
    });
  });
  const me = startMe((_req, res) => admin(res));
  try {
    const meUrl = await listen(me);
    const hookUrl = await listen(webhook);
    const fixed = new Date('2026-11-03T10:00:00Z'); // Tue Oslo
    const server = createKidsChoresServer({
      dataDir: dir,
      yuvomiUrl: meUrl,
      now: () => fixed,
    });
    const base = await listen(server);
    const first = await call(base, '/api/extensions/kids-chores/today', { cookie: 'yuvomi.sid=ok' });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const jar = `yuvomi.sid=ok; ${first.cookie}`;
    const csrf = first.body.csrfToken;

    const created = await call(base, '/api/extensions/kids-chores/chores', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: { title: 'Do homework', points: 5, days: [1, 2, 3, 4, 5] },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const choreId = created.body.chores[0].id;

    const settings = await call(base, '/api/extensions/kids-chores/settings', {
      method: 'PUT',
      cookie: jar,
      csrf,
      json: { pointGoal: 5, webhookUrl: `${hookUrl}/reward`, notifyAdmin: true },
    });
    assert.equal(settings.status, 200, JSON.stringify(settings.body));

    const done = await call(base, '/api/extensions/kids-chores/complete', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: { id: choreId },
    });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.goalReached, true);
    assert.equal(done.body.open.length, 0);
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0].event, 'kids_chores.goal_reached');

    const today = await call(base, '/api/extensions/kids-chores/today', { cookie: jar });
    assert.equal(today.status, 200);
    assert.ok(today.body.notices?.length >= 1);
    const notice = today.body.notices[0];
    assert.equal(notice.kind, 'goal');
    assert.equal(notice.date, '2026-11-03');
    assert.equal(notice.earned, 5);
    assert.equal(notice.goal, 5);
    assert.equal(notice.message, undefined, 'UI localizes notices; no English message stored');

    const again = await call(base, '/api/extensions/kids-chores/complete', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: { id: choreId },
    });
    assert.equal(again.status, 200);
    assert.equal(hooks.length, 1, 'webhook only once per day');

    await close(server);
  } finally {
    await close(me);
    await close(webhook);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('API resets today’s completions before midnight', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kc-'));
  const me = startMe((_req, res) => admin(res));
  try {
    const meUrl = await listen(me);
    const fixed = new Date('2026-11-03T10:00:00Z');
    const server = createKidsChoresServer({ dataDir: dir, yuvomiUrl: meUrl, now: () => fixed });
    const base = await listen(server);
    const first = await call(base, '/api/extensions/kids-chores/today', { cookie: 'yuvomi.sid=ok' });
    const jar = `yuvomi.sid=ok; ${first.cookie}`;
    const csrf = first.body.csrfToken;

    const created = await call(base, '/api/extensions/kids-chores/chores', {
      method: 'POST', cookie: jar, csrf, json: { title: 'Wash', points: 3, days: [1, 2, 3, 4, 5] },
    });
    const choreId = created.body.chores[0].id;
    const done = await call(base, '/api/extensions/kids-chores/complete', {
      method: 'POST', cookie: jar, csrf, json: { id: choreId },
    });
    assert.equal(done.body.open.length, 0);

    const reset = await call(base, '/api/extensions/kids-chores/reset-today', {
      method: 'POST', cookie: jar, csrf, json: {},
    });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal(reset.body.open.length, 1);
    assert.equal(reset.body.earned, 0);
    assert.equal(reset.body.goalReached, false);

    await close(server);
  } finally {
    await close(me);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('API reorders chores and updates a chore', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kc-'));
  const me = startMe((_req, res) => admin(res));
  try {
    const meUrl = await listen(me);
    const server = createKidsChoresServer({ dataDir: dir, yuvomiUrl: meUrl });
    const base = await listen(server);
    const first = await call(base, '/api/extensions/kids-chores/today', { cookie: 'yuvomi.sid=ok' });
    const jar = `yuvomi.sid=ok; ${first.cookie}`;
    const csrf = first.body.csrfToken;

    const a = await call(base, '/api/extensions/kids-chores/chores', {
      method: 'POST', cookie: jar, csrf, json: { title: 'First', points: 1, days: [1, 2, 3, 4, 5] },
    });
    const b = await call(base, '/api/extensions/kids-chores/chores', {
      method: 'POST', cookie: jar, csrf, json: { title: 'Second', points: 2, days: [1, 2, 3, 4, 5] },
    });
    const idA = a.body.chores.find((c) => c.title === 'First').id;
    const idB = b.body.chores.find((c) => c.title === 'Second').id;

    const reordered = await call(base, '/api/extensions/kids-chores/chores/reorder', {
      method: 'PUT',
      cookie: jar,
      csrf,
      json: { ids: [idB, idA] },
    });
    assert.equal(reordered.status, 200, JSON.stringify(reordered.body));
    assert.deepEqual(reordered.body.chores.map((c) => c.id), [idB, idA]);

    const edited = await call(base, `/api/extensions/kids-chores/chores/${idB}`, {
      method: 'PUT',
      cookie: jar,
      csrf,
      json: { title: 'Second edited', points: 9, days: [6, 7] },
    });
    assert.equal(edited.status, 200, JSON.stringify(edited.body));
    const row = edited.body.chores.find((c) => c.id === idB);
    assert.equal(row.title, 'Second edited');
    assert.equal(row.points, 9);
    assert.deepEqual(row.days, [6, 7]);

    await close(server);
  } finally {
    await close(me);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('API reset-today sends reward webhook with earned 0', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kc-'));
  const hooks = [];
  const webhook = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      hooks.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(200);
      res.end('ok');
    });
  });
  const me = startMe((_req, res) => admin(res));
  try {
    const meUrl = await listen(me);
    const hookUrl = await listen(webhook);
    const fixed = new Date('2026-11-03T10:00:00Z');
    const server = createKidsChoresServer({
      dataDir: dir,
      yuvomiUrl: meUrl,
      now: () => fixed,
    });
    const base = await listen(server);
    const first = await call(base, '/api/extensions/kids-chores/today', { cookie: 'yuvomi.sid=ok' });
    const jar = `yuvomi.sid=ok; ${first.cookie}`;
    const csrf = first.body.csrfToken;

    await call(base, '/api/extensions/kids-chores/settings', {
      method: 'PUT',
      cookie: jar,
      csrf,
      json: { pointGoal: 5, webhookUrl: `${hookUrl}/reward` },
    });
    const created = await call(base, '/api/extensions/kids-chores/chores', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: { title: 'Task', points: 5, days: [1, 2, 3, 4, 5] },
    });
    const choreId = created.body.chores[0].id;
    await call(base, '/api/extensions/kids-chores/complete', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: { id: choreId },
    });
    assert.equal(hooks[0].event, 'kids_chores.goal_reached');
    assert.equal(hooks[0].earned, 5);

    const reset = await call(base, '/api/extensions/kids-chores/reset-today', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: {},
    });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal(reset.body.earned, 0);
    assert.equal(reset.body.pointsResetWebhookSent, true);
    assert.equal(hooks.length, 2);
    assert.equal(hooks[1].event, 'kids_chores.points_reset');
    assert.equal(hooks[1].earned, 0);
    assert.equal(hooks[1].goal, 5);
    assert.equal(hooks[1].percent, 0);
    assert.equal(hooks[1].previousEarned, 5);
    assert.equal(hooks[1].state, 'no');
    assert.equal(hooks[1].done, false);

    await close(server);
  } finally {
    await close(me);
    await close(webhook);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('API fires reset (No) webhooks when admin resets today', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kc-'));
  const hooks = [];
  const webhook = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      hooks.push({
        path: req.url,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      });
      res.writeHead(200);
      res.end('ok');
    });
  });
  const me = startMe((_req, res) => admin(res));
  try {
    const meUrl = await listen(me);
    const hookUrl = await listen(webhook);
    const fixed = new Date('2026-11-03T10:00:00Z');
    const server = createKidsChoresServer({
      dataDir: dir,
      yuvomiUrl: meUrl,
      now: () => fixed,
    });
    const base = await listen(server);
    const first = await call(base, '/api/extensions/kids-chores/today', { cookie: 'yuvomi.sid=ok' });
    const jar = `yuvomi.sid=ok; ${first.cookie}`;
    const csrf = first.body.csrfToken;

    const created = await call(base, '/api/extensions/kids-chores/chores', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: {
        title: 'Walk the dog',
        points: 2,
        days: [1, 2, 3, 4, 5],
        webhookUrl: `${hookUrl}/yes`,
        resetWebhookUrl: `${hookUrl}/no`,
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const chore = created.body.chores[0];
    assert.equal(chore.webhookUrl, `${hookUrl}/yes`);
    assert.equal(chore.resetWebhookUrl, `${hookUrl}/no`);

    const done = await call(base, '/api/extensions/kids-chores/complete', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: { id: chore.id },
    });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.choreWebhookSent, true);
    assert.equal(hooks[0].path, '/yes');
    assert.equal(hooks[0].body.state, 'yes');
    assert.equal(hooks[0].body.done, true);

    const reset = await call(base, '/api/extensions/kids-chores/reset-today', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: {},
    });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal(reset.body.open.length, 1);
    assert.equal(reset.body.resetWebhookTargets, 1);
    assert.equal(reset.body.resetWebhooksSent, 1);
    assert.equal(hooks.length, 2);
    assert.equal(hooks[1].path, '/no');
    assert.equal(hooks[1].body.state, 'no');
    assert.equal(hooks[1].body.done, false);

    await close(server);
  } finally {
    await close(me);
    await close(webhook);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('API test-webhook sends yes/no payloads', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kc-'));
  const hooks = [];
  const webhook = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      hooks.push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(200);
      res.end('ok');
    });
  });
  const me = startMe((_req, res) => admin(res));
  try {
    const meUrl = await listen(me);
    const hookUrl = await listen(webhook);
    const server = createKidsChoresServer({ dataDir: dir, yuvomiUrl: meUrl });
    const base = await listen(server);
    const first = await call(base, '/api/extensions/kids-chores/today', { cookie: 'yuvomi.sid=ok' });
    const jar = `yuvomi.sid=ok; ${first.cookie}`;
    const csrf = first.body.csrfToken;

    const settings = await call(base, '/api/extensions/kids-chores/settings', {
      method: 'PUT',
      cookie: jar,
      csrf,
      json: { webhookUrl: `${hookUrl}/reward` },
    });
    assert.equal(settings.status, 200, JSON.stringify(settings.body));

    const yes = await call(base, '/api/extensions/kids-chores/test-webhook', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: { state: 'yes' },
    });
    assert.equal(yes.status, 200, JSON.stringify(yes.body));
    assert.deepEqual(yes.body.payload, { state: 'yes', done: true });
    assert.deepEqual(hooks[0], { state: 'yes', done: true });

    const no = await call(base, '/api/extensions/kids-chores/test-webhook', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: { state: 'no' },
    });
    assert.equal(no.status, 200, JSON.stringify(no.body));
    assert.deepEqual(no.body.payload, { state: 'no', done: false });
    assert.deepEqual(hooks[1], { state: 'no', done: false });

    await close(server);
  } finally {
    await close(me);
    await close(webhook);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('interpretWebhookApproval treats negative replies as denied', () => {
  assert.equal(interpretWebhookApproval(true, null), true);
  assert.equal(interpretWebhookApproval(true, { ok: true }), true);
  assert.equal(interpretWebhookApproval(true, { state: 'yes' }), true);
  assert.equal(interpretWebhookApproval(true, { ok: false }), false);
  assert.equal(interpretWebhookApproval(true, { state: 'no' }), false);
  assert.equal(interpretWebhookApproval(true, { approved: false }), false);
  assert.equal(interpretWebhookApproval(true, -1), false);
  assert.equal(interpretWebhookApproval(true, 0), false);
  assert.equal(interpretWebhookApproval(true, 1), true);
  assert.equal(interpretWebhookApproval(false, { ok: true }), false);
});

test('API blocks chore completion when webhook returns negative', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kc-'));
  const webhook = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, state: 'no' }));
  });
  const me = startMe((_req, res) => admin(res));
  try {
    const meUrl = await listen(me);
    const hookUrl = await listen(webhook);
    const fixed = new Date('2026-11-03T10:00:00Z');
    const server = createKidsChoresServer({
      dataDir: dir,
      yuvomiUrl: meUrl,
      now: () => fixed,
    });
    const base = await listen(server);
    const first = await call(base, '/api/extensions/kids-chores/today', { cookie: 'yuvomi.sid=ok' });
    const jar = `yuvomi.sid=ok; ${first.cookie}`;
    const csrf = first.body.csrfToken;

    const created = await call(base, '/api/extensions/kids-chores/chores', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: {
        title: 'Walk the dog',
        points: 2,
        days: [1, 2, 3, 4, 5],
        webhookUrl: `${hookUrl}/gate`,
      },
    });
    const choreId = created.body.chores[0].id;

    const done = await call(base, '/api/extensions/kids-chores/complete', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: { id: choreId },
    });
    assert.equal(done.status, 409, JSON.stringify(done.body));
    assert.equal(done.body.reason, 'webhook_denied');

    const today = await call(base, '/api/extensions/kids-chores/today', { cookie: jar });
    assert.equal(today.body.items[0].done, false);
    assert.equal(today.body.earned, 0);

    await close(server);
  } finally {
    await close(me);
    await close(webhook);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('API fires per-chore webhook when a chore is completed', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kc-'));
  const hooks = [];
  const webhook = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      hooks.push({
        path: req.url,
        body: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      });
      res.writeHead(200);
      res.end('ok');
    });
  });
  const me = startMe((_req, res) => admin(res));
  try {
    const meUrl = await listen(me);
    const hookUrl = await listen(webhook);
    const fixed = new Date('2026-11-03T10:00:00Z');
    const server = createKidsChoresServer({
      dataDir: dir,
      yuvomiUrl: meUrl,
      now: () => fixed,
    });
    const base = await listen(server);
    const first = await call(base, '/api/extensions/kids-chores/today', { cookie: 'yuvomi.sid=ok' });
    const jar = `yuvomi.sid=ok; ${first.cookie}`;
    const csrf = first.body.csrfToken;

    const created = await call(base, '/api/extensions/kids-chores/chores', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: {
        title: 'Walk the dog',
        points: 2,
        days: [1, 2, 3, 4, 5],
        webhookUrl: `${hookUrl}/dog`,
      },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const chore = created.body.chores[0];
    assert.equal(chore.webhookUrl, `${hookUrl}/dog`);

    const done = await call(base, '/api/extensions/kids-chores/complete', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: { id: chore.id },
    });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.choreWebhookSent, true);
    assert.equal(hooks.length, 1);
    assert.equal(hooks[0].path, '/dog');
    assert.equal(hooks[0].body.state, 'yes');
    assert.equal(hooks[0].body.done, true);

    const again = await call(base, '/api/extensions/kids-chores/complete', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: { id: chore.id },
    });
    assert.equal(again.status, 200);
    assert.equal(again.body.choreWebhookSent, false);
    assert.equal(hooks.length, 1, 'chore webhook only on first completion');

    const today = await call(base, '/api/extensions/kids-chores/today', { cookie: jar });
    assert.equal(today.body.items[0].webhookUrl, undefined, 'today must not leak chore webhook URLs');

    await close(server);
  } finally {
    await close(me);
    await close(webhook);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('maxDailyPoints follows weekday chore sums', () => {
  const chores = [
    { title: 'Weekday', points: 5, days: [1, 2, 3, 4, 5], active: true },
    { title: 'Weekend', points: 8, days: [6, 7], active: true },
    { title: 'Off', points: 100, days: [1], active: false },
  ];
  assert.equal(maxDailyPoints(chores), 8);
  assert.equal(maxDailyPoints([]), 0);
});

test('API keeps webhook URL visible on admin settings round-trip', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kc-'));
  const me = startMe((_req, res) => admin(res));
  try {
    const meUrl = await listen(me);
    const server = createKidsChoresServer({ dataDir: dir, yuvomiUrl: meUrl });
    const base = await listen(server);
    const first = await call(base, '/api/extensions/kids-chores/today', { cookie: 'yuvomi.sid=ok' });
    const jar = `yuvomi.sid=ok; ${first.cookie}`;
    const csrf = first.body.csrfToken;
    const hook = 'https://webhook.homey.app/kids-chores-test';

    const saved = await call(base, '/api/extensions/kids-chores/settings', {
      method: 'PUT',
      cookie: jar,
      csrf,
      json: { webhookUrl: hook, pointGoal: 10 },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.settings.webhookSet, true);
    assert.equal(saved.body.settings.webhookUrl, hook);

    const chores = await call(base, '/api/extensions/kids-chores/chores', { cookie: jar });
    assert.equal(chores.body.settings.webhookUrl, hook);

    const today = await call(base, '/api/extensions/kids-chores/today', { cookie: jar });
    assert.equal(today.body.settings.webhookUrl, undefined, 'overview must not leak the webhook URL');
    assert.equal(today.body.settings.webhookSet, true);

    const bare = await call(base, '/api/extensions/kids-chores/settings', {
      method: 'PUT',
      cookie: jar,
      csrf,
      json: { webhookUrl: 'webhook.homey.app/no-scheme' },
    });
    assert.equal(bare.status, 200, JSON.stringify(bare.body));
    assert.equal(bare.body.settings.webhookUrl, 'https://webhook.homey.app/no-scheme');

    const bad = await call(base, '/api/extensions/kids-chores/settings', {
      method: 'PUT',
      cookie: jar,
      csrf,
      json: { webhookUrl: 'not a url at all @@' },
    });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.reason, 'invalid');

    await close(server);
  } finally {
    await close(me);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('API stores displayTitle for the overview widget', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kc-'));
  const me = startMe((_req, res) => admin(res));
  try {
    const meUrl = await listen(me);
    const server = createKidsChoresServer({ dataDir: dir, yuvomiUrl: meUrl });
    const base = await listen(server);
    const first = await call(base, '/api/extensions/kids-chores/today', { cookie: 'yuvomi.sid=ok' });
    const jar = `yuvomi.sid=ok; ${first.cookie}`;
    const csrf = first.body.csrfToken;

    const saved = await call(base, '/api/extensions/kids-chores/settings', {
      method: 'PUT',
      cookie: jar,
      csrf,
      json: { displayTitle: 'Emma', pointGoal: 12 },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.settings.displayTitle, 'Emma');
    assert.equal(saved.body.settings.pointGoal, 12);

    const today = await call(base, '/api/extensions/kids-chores/today', { cookie: jar });
    assert.equal(today.body.settings.displayTitle, 'Emma');

    await close(server);
  } finally {
    await close(me);
    rmSync(dir, { recursive: true, force: true });
  }
});

test('API refuses completing a chore not scheduled today', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kc-'));
  const me = startMe((_req, res) => admin(res));
  try {
    const meUrl = await listen(me);
    const sunday = new Date('2026-11-01T12:00:00Z'); // Sun Oslo
    const server = createKidsChoresServer({
      dataDir: dir,
      yuvomiUrl: meUrl,
      now: () => sunday,
    });
    const base = await listen(server);
    const first = await call(base, '/api/extensions/kids-chores/today', { cookie: 'yuvomi.sid=ok' });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const jar = `yuvomi.sid=ok; ${first.cookie}`;
    const csrf = first.body.csrfToken;

    const created = await call(base, '/api/extensions/kids-chores/chores', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: { title: 'School only', points: 1, days: [1, 2, 3, 4, 5] },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const choreId = created.body.chores[0].id;

    const today = await call(base, '/api/extensions/kids-chores/today', { cookie: jar });
    assert.equal(today.body.items.length, 0);

    const done = await call(base, '/api/extensions/kids-chores/complete', {
      method: 'POST',
      cookie: jar,
      csrf,
      json: { id: choreId },
    });
    assert.equal(done.status, 400);
    assert.equal(done.body.reason, 'day');

    await close(server);
  } finally {
    await close(me);
    rmSync(dir, { recursive: true, force: true });
  }
});
